#!/usr/bin/env node
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const CONFIG_PATH = process.env.DATAPLUS_PRINT_AGENT_CONFIG || path.join(os.homedir(), ".dataplus-print-agent.json");
const args = process.argv.slice(2);
const argValue = (name, fallback = "") => {
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] || fallback) : fallback;
};
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")); }
  catch { return {}; }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

function detectPrinters() {
  if (process.platform === "win32") {
    const command = "Get-CimInstance Win32_Printer | Select-Object Name,Default | ConvertTo-Json -Compress";
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8", windowsHide: true });
    if (result.status !== 0) return { printers: [], defaultPrinter: "" };
    try {
      const parsed = JSON.parse(result.stdout || "[]");
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      return { printers: rows.map((row) => String(row.Name || "")).filter(Boolean), defaultPrinter: String(rows.find((row) => row.Default)?.Name || "") };
    } catch { return { printers: [], defaultPrinter: "" }; }
  }
  const result = spawnSync("lpstat", ["-p", "-d"], { encoding: "utf8" });
  const output = String(result.stdout || "");
  const printers = [...output.matchAll(/^printer\s+([^\s]+)/gm)].map((match) => match[1]);
  const defaultPrinter = output.match(/system default destination:\s*(.+)$/m)?.[1]?.trim() || "";
  return { printers, defaultPrinter };
}

async function request(config, pathname, options = {}) {
  const response = await fetch(`${String(config.url || "").replace(/\/$/, "")}${pathname}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(config.agentToken ? { Authorization: `Bearer ${config.agentToken}` } : {}), ...(options.headers || {}) }
  });
  if (!response.ok) {
    let message = `DataPlus returned ${response.status}.`;
    try { message = (await response.json()).error || message; } catch { /* keep status message */ }
    throw new Error(message);
  }
  return response;
}

async function pair() {
  const code = argValue("--pair").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const url = argValue("--url", "https://dataplusapp.duckdns.org");
  const name = argValue("--name", os.hostname());
  if (!code) throw new Error("Use --pair CODE from Fulfillment > Settings.");
  const detected = detectPrinters();
  const config = { url };
  const response = await request(config, "/api/fulfillment/print-agent/pair", {
    method: "POST",
    body: JSON.stringify({ code, name, hostname: os.hostname(), platform: `${process.platform} ${os.release()}`, ...detected })
  });
  const result = await response.json();
  saveConfig({ url, stationId: result.station.id, stationName: result.station.name, agentToken: result.agentToken, defaultPrinter: result.station.defaultPrinter || detected.defaultPrinter });
  console.log(`Paired ${result.station.name}. Configuration saved to ${CONFIG_PATH}.`);
}

function printPdf(filePath, printerName) {
  if (process.platform === "win32") {
    const sumatra = process.env.SUMATRA_PDF_PATH || [
      path.join(process.env.LOCALAPPDATA || "", "SumatraPDF", "SumatraPDF.exe"),
      path.join(process.env.ProgramFiles || "", "SumatraPDF", "SumatraPDF.exe")
    ].find((candidate) => candidate && fs.existsSync(candidate));
    if (sumatra) return spawnSync(sumatra, ["-print-to", printerName, "-silent", filePath], { encoding: "utf8", windowsHide: true });
    const escapedFile = filePath.replaceAll("'", "''");
    return spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Start-Process -FilePath '${escapedFile}' -Verb Print -WindowStyle Hidden -Wait`], { encoding: "utf8", windowsHide: true });
  }
  return spawnSync("lp", printerName ? ["-d", printerName, filePath] : [filePath], { encoding: "utf8" });
}

async function acknowledge(config, jobId, status, error = "") {
  await request(config, `/api/fulfillment/print-agent/jobs/${encodeURIComponent(jobId)}/status`, { method: "POST", body: JSON.stringify({ status, error }) });
}

async function pollOnce(config) {
  const detected = detectPrinters();
  await request(config, "/api/fulfillment/print-agent/heartbeat", { method: "POST", body: JSON.stringify({ hostname: os.hostname(), platform: `${process.platform} ${os.release()}`, ...detected }) });
  const response = await request(config, "/api/fulfillment/print-agent/jobs");
  const { job } = await response.json();
  if (!job) return false;
  const printerName = String(job.printerName || config.defaultPrinter || detected.defaultPrinter || "");
  const filePath = path.join(os.tmpdir(), `${String(job.printNumber || job.id).replace(/[^A-Za-z0-9_-]/g, "-")}.pdf`);
  try {
    await acknowledge(config, job.id, "printing");
    const documentResponse = await request(config, job.documentUrl, { headers: { Accept: "application/pdf" } });
    fs.writeFileSync(filePath, Buffer.from(await documentResponse.arrayBuffer()));
    const result = printPdf(filePath, printerName);
    if (result.status !== 0) throw new Error(String(result.stderr || result.stdout || `Print command exited ${result.status}.`).trim());
    await acknowledge(config, job.id, "printed");
    console.log(`Printed ${job.printNumber} on ${printerName || "the default printer"}.`);
  } catch (error) {
    await acknowledge(config, job.id, "failed", error.message || "Printing failed.").catch(() => {});
    console.error(`Failed ${job.printNumber}: ${error.message}`);
  } finally {
    try { fs.unlinkSync(filePath); } catch { /* temporary file already removed */ }
  }
  return true;
}

async function main() {
  if (args.includes("--pair")) return pair();
  const config = loadConfig();
  if (!config.url || !config.agentToken) throw new Error(`Print agent is not paired. Create a code in DataPlus, then run this script with --pair CODE. Config: ${CONFIG_PATH}`);
  const once = args.includes("--once");
  do {
    try { await pollOnce(config); }
    catch (error) { console.error(`${new Date().toISOString()} ${error.message}`); }
    if (!once) await sleep(5000);
  } while (!once);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
