const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const UPS_ENVIRONMENTS = new Set(["production", "test"]);

function clean(value) {
  return String(value ?? "").trim();
}

function createCarrierCredentials({ directory, env = process.env }) {
  const file = path.join(directory, "carrier-runtime-credentials.json");

  function read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
      if (error.code === "ENOENT") return {};
      throw new Error("Carrier credential storage could not be read.");
    }
  }

  function write(value) {
    fs.mkdirSync(directory, { recursive: true });
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
      fs.renameSync(temporary, file);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }

  function normalizeEnvironment(environment) {
    const normalized = clean(environment || "production").toLowerCase();
    if (!UPS_ENVIRONMENTS.has(normalized)) throw new Error("Select the UPS production or test environment.");
    return normalized;
  }

  function environmentFallback(environment) {
    const test = environment === "test";
    const prefix = test ? "UPS_TEST_" : "UPS_";
    return {
      clientId: clean(env[`${prefix}CLIENT_ID`] || env.UPS_CLIENT_ID),
      clientSecret: clean(env[`${prefix}CLIENT_SECRET`] || env.UPS_CLIENT_SECRET),
      accountNumber: clean(env[`${prefix}ACCOUNT_NUMBER`] || env[`${prefix}SHIPPER_NUMBER`] || env.UPS_ACCOUNT_NUMBER || env.UPS_SHIPPER_NUMBER).toUpperCase(),
    };
  }

  function activeEnvironment() {
    const saved = clean(read().ups?.activeEnvironment).toLowerCase();
    if (UPS_ENVIRONMENTS.has(saved)) return saved;
    return ["1", "true", "yes"].includes(clean(env.UPS_TEST_MODE).toLowerCase()) ? "test" : "production";
  }

  function getUps(environment = activeEnvironment()) {
    const normalized = normalizeEnvironment(environment);
    const saved = read().ups?.environments?.[normalized] || {};
    const fallback = environmentFallback(normalized);
    return {
      environment: normalized,
      clientId: clean(saved.clientId || fallback.clientId),
      clientSecret: clean(saved.clientSecret || fallback.clientSecret),
      accountNumber: clean(saved.accountNumber || fallback.accountNumber).toUpperCase(),
      updatedAt: clean(saved.updatedAt),
      lastTestedAt: clean(saved.lastTestedAt),
      lastTestStatus: clean(saved.lastTestStatus),
      lastTestMessage: clean(saved.lastTestMessage),
    };
  }

  function publicUpsEnvironment(environment) {
    const credentials = getUps(environment);
    return {
      environment: credentials.environment,
      clientId: credentials.clientId,
      secretConfigured: Boolean(credentials.clientSecret),
      accountConfigured: Boolean(credentials.accountNumber),
      accountEnding: credentials.accountNumber ? credentials.accountNumber.slice(-4) : "",
      configured: Boolean(credentials.clientId && credentials.clientSecret && credentials.accountNumber),
      updatedAt: credentials.updatedAt,
      lastTestedAt: credentials.lastTestedAt,
      lastTestStatus: credentials.lastTestStatus,
      lastTestMessage: credentials.lastTestMessage,
    };
  }

  function status() {
    const environment = activeEnvironment();
    const environments = {
      production: publicUpsEnvironment("production"),
      test: publicUpsEnvironment("test"),
    };
    return {
      id: "ups",
      name: "UPS",
      available: true,
      environment,
      ...environments[environment],
      environments,
    };
  }

  function resolveUpsPatch(environment, patch = {}) {
    const normalized = normalizeEnvironment(environment);
    const current = getUps(normalized);
    const submittedSecret = clean(patch.clientSecret);
    const submittedAccount = clean(patch.accountNumber).toUpperCase();
    const clientId = clean(patch.clientId || current.clientId);
    const clientSecret = submittedSecret || current.clientSecret;
    const accountNumber = submittedAccount || current.accountNumber;
    if (!clientId || !clientSecret || !accountNumber) throw new Error("UPS Client ID, Client Secret, and billing account number are required.");
    if (clientId !== current.clientId && !submittedSecret) throw new Error("Enter the matching UPS Client Secret when changing the Client ID.");
    if (clientId.length > 512 || clientSecret.length > 4096 || /[\r\n]/.test(`${clientId}${clientSecret}`)) throw new Error("Invalid UPS credentials.");
    if (!/^[A-Z0-9]{6}$/.test(accountNumber)) throw new Error("Enter the 6-character UPS billing account number shown in the UPS Developer Portal.");
    return { environment: normalized, clientId, clientSecret, accountNumber };
  }

  function saveUps(environment, patch = {}) {
    const resolved = resolveUpsPatch(environment, patch);
    const currentStore = read();
    const currentEnvironment = currentStore.ups?.environments?.[resolved.environment] || {};
    const next = {
      ...currentStore,
      ups: {
        ...(currentStore.ups || {}),
        activeEnvironment: resolved.environment,
        environments: {
          ...(currentStore.ups?.environments || {}),
          [resolved.environment]: {
            ...currentEnvironment,
            clientId: resolved.clientId,
            clientSecret: resolved.clientSecret,
            accountNumber: resolved.accountNumber,
            updatedAt: new Date().toISOString(),
          },
        },
      },
    };
    write(next);
    return status();
  }

  function recordUpsTest(environment, result = {}) {
    const normalized = normalizeEnvironment(environment);
    const currentStore = read();
    const currentEnvironment = currentStore.ups?.environments?.[normalized] || {};
    const next = {
      ...currentStore,
      ups: {
        ...(currentStore.ups || {}),
        environments: {
          ...(currentStore.ups?.environments || {}),
          [normalized]: {
            ...currentEnvironment,
            lastTestedAt: new Date().toISOString(),
            lastTestStatus: result.ok ? "verified" : "failed",
            lastTestMessage: clean(result.message),
          },
        },
      },
    };
    write(next);
    return status();
  }

  return { activeEnvironment, getUps, publicUpsEnvironment, recordUpsTest, resolveUpsPatch, saveUps, status };
}

module.exports = { createCarrierCredentials };
