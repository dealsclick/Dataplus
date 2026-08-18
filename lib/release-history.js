const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const RECORD_SEPARATOR = "\u001e";
const FIELD_SEPARATOR = "\u001f";
const HISTORY_FILE = path.join(__dirname, "..", "generated", "release-history.json");
const DEPLOYMENT_STATUS_FILE = path.join(__dirname, "..", "generated", "deployment-status.json");
const HISTORY_CACHE_MS = 60 * 1000;

let cache = { loadedAt: 0, value: null };

function repositoryWebUrl(remote = "") {
  const value = String(remote || "").trim().replace(/\.git$/i, "");
  if (!value) return "";
  if (value.startsWith("git@")) {
    const match = value.match(/^git@([^:]+):(.+)$/);
    return match ? `https://${match[1]}/${match[2]}` : "";
  }
  return value.replace(/^ssh:\/\/git@/i, "https://");
}

function classifyRelease(subject = "") {
  const text = String(subject).toLowerCase();
  if (/security|credential|oauth|auth|token|scope|permission/.test(text)) return "security";
  if (/deploy|docker|workflow|production|digitalocean|release/.test(text)) return "deployment";
  if (/performance|faster|speed|cache|index|optimi[sz]e|pagination/.test(text)) return "performance";
  if (/ui|layout|mobile|responsive|style|color|tab|dialog|modal|sidebar|table/.test(text)) return "interface";
  if (/fix|repair|correct|prevent|resolve|restore|handle|stabili[sz]e|stop/.test(text)) return "fix";
  if (/import|backfill|migrat|rebuild|map|sync|normalize|reclassif|inventory|catalog/.test(text)) return "data";
  if (/docs|readme|guide|instruction|document/.test(text)) return "documentation";
  if (/add|create|enable|implement|support|introduce|build|complete/.test(text)) return "feature";
  return "maintenance";
}

function changedAreas(files = []) {
  const areas = new Set();
  for (const file of files) {
    const value = String(file || "");
    if (value.startsWith("web/")) areas.add("React app");
    else if (value === "server.js" || value.startsWith("lib/")) areas.add("API & services");
    else if (value.startsWith("scripts/")) areas.add("Jobs & automation");
    else if (value.startsWith(".github/") || /docker/i.test(value)) areas.add("Deployment");
    else if (/readme|agents\.md|docs\//i.test(value)) areas.add("Documentation");
    else if (value) areas.add("Configuration");
  }
  return Array.from(areas);
}

function releaseDateLabel(dateKey = "") {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  if (!year || !month || !day) return "Unscheduled release";
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, day)));
}

function groupReleases(releases = []) {
  const groups = new Map();
  for (const release of releases) {
    const dateKey = String(release.committedAt || "").slice(0, 10) || "unknown";
    if (!groups.has(dateKey)) groups.set(dateKey, []);
    groups.get(dateKey).push(release);
  }
  return Array.from(groups.entries()).map(([dateKey, changes], index) => {
    const tags = Array.from(new Set(changes.flatMap((change) => change.tags || [])));
    const areas = Array.from(new Set(changes.flatMap((change) => change.areas || [])));
    const types = changes.reduce((counts, change) => {
      const type = change.type || "maintenance";
      counts[type] = (counts[type] || 0) + 1;
      return counts;
    }, {});
    const primaryType = Object.entries(types).sort((left, right) => right[1] - left[1])[0]?.[0] || "maintenance";
    const version = tags[0] || (dateKey === "unknown" ? "unversioned" : dateKey.replaceAll("-", "."));
    return {
      id: `release-${dateKey}`,
      version,
      name: `${releaseDateLabel(dateKey)} release`,
      date: dateKey,
      publishedAt: changes[0]?.committedAt || "",
      firstCommitAt: changes[changes.length - 1]?.committedAt || "",
      revision: changes[0]?.id || "",
      shortRevision: changes[0]?.shortId || "",
      primaryType,
      changeCount: changes.length,
      fileCount: changes.reduce((total, change) => total + Number(change.fileCount || 0), 0),
      areas,
      types,
      tags,
      current: index === 0,
      changes
    };
  });
}

function parseHistoryOutput(output, remote) {
  const repositoryUrl = repositoryWebUrl(remote);
  const commits = String(output || "")
    .split(RECORD_SEPARATOR)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const fields = chunk.split(FIELD_SEPARATOR);
      if (fields.length < 7) return null;
      const [id, shortId, committedAt, author, subject, body, refsAndFiles] = fields;
      const lines = String(refsAndFiles || "").split(/\r?\n/);
      const refs = String(lines.shift() || "").trim();
      const files = Array.from(new Set(lines.map((line) => line.trim()).filter(Boolean)));
      const tags = Array.from(refs.matchAll(/tag:\s*([^,)]+)/g)).map((match) => match[1].trim());
      return {
        id,
        shortId,
        committedAt,
        author,
        title: String(subject || "Untitled change").trim(),
        notes: String(body || "").trim(),
        type: classifyRelease(subject),
        tags,
        files,
        fileCount: files.length,
        areas: changedAreas(files),
        commitUrl: repositoryUrl && id ? `${repositoryUrl}/commit/${id}` : ""
      };
    })
    .filter(Boolean);
  const releaseGroups = groupReleases(commits);
  return {
    generatedAt: new Date().toISOString(),
    repositoryUrl,
    total: commits.length,
    current: commits[0] || null,
    currentGroup: releaseGroups[0] || null,
    releaseGroups,
    releases: commits
  };
}

function readGitHistory(root) {
  const format = `%x1e%H%x1f%h%x1f%aI%x1f%an%x1f%s%x1f%b%x1f%D`;
  const result = spawnSync("git", ["log", "--date=iso-strict", `--pretty=format:${format}`, "--name-only", "--no-renames"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true
  });
  if (result.status !== 0) throw new Error(String(result.stderr || "Unable to read Git history.").trim());
  const remote = spawnSync("git", ["remote", "get-url", "origin"], { cwd: root, encoding: "utf8", windowsHide: true });
  return parseHistoryOutput(result.stdout, remote.status === 0 ? remote.stdout : "");
}

function readGeneratedHistory() {
  if (!fs.existsSync(HISTORY_FILE)) return null;
  const parsed = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
  return parsed && Array.isArray(parsed.releases) ? parsed : null;
}

function readDeploymentStatus() {
  if (!fs.existsSync(DEPLOYMENT_STATUS_FILE)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(DEPLOYMENT_STATUS_FILE, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeDeploymentStatus(status = {}, target = DEPLOYMENT_STATUS_FILE) {
  const value = {
    environment: "production",
    status: "unknown",
    updatedAt: new Date().toISOString(),
    ...status
  };
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, target);
  return value;
}

function loadReleaseHistory(options = {}) {
  const now = Date.now();
  if (!options.force && cache.value && now - cache.loadedAt < HISTORY_CACHE_MS) return cache.value;
  const root = path.join(__dirname, "..");
  let value = null;
  let source = "generated";
  try {
    if (options.forceGit || fs.existsSync(path.join(root, ".git"))) {
      value = readGitHistory(root);
      source = "git";
    }
  } catch {}
  if (!value) value = readGeneratedHistory();
  if (!value) value = { generatedAt: new Date().toISOString(), repositoryUrl: "", total: 0, current: null, releases: [] };
  if (!Array.isArray(value.releaseGroups)) value.releaseGroups = groupReleases(value.releases || []);
  if (!value.currentGroup) value.currentGroup = value.releaseGroups[0] || null;
  value.source = source;
  cache = { loadedAt: now, value };
  return value;
}

function writeReleaseHistory(target = HISTORY_FILE) {
  const value = readGitHistory(path.join(__dirname, ".."));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
  cache = { loadedAt: Date.now(), value: { ...value, source: "git" } };
  return value;
}

module.exports = {
  HISTORY_FILE,
  DEPLOYMENT_STATUS_FILE,
  classifyRelease,
  groupReleases,
  loadReleaseHistory,
  readDeploymentStatus,
  writeDeploymentStatus,
  writeReleaseHistory
};
