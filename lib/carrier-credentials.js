const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const CARRIER_ENVIRONMENTS = new Set(["production", "test"]);

function clean(value) {
  return String(value ?? "").trim();
}

function scopeList(value) {
  return [...new Set(clean(value).split(/[\s,]+/).map(clean).filter(Boolean))];
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
    if (!CARRIER_ENVIRONMENTS.has(normalized)) throw new Error("Select the production or test environment.");
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
    if (CARRIER_ENVIRONMENTS.has(saved)) return saved;
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
      lastVerifiedAt: clean(saved.lastVerifiedAt),
      lastTokenScope: clean(saved.lastTokenScope),
      lastTokenExpiresIn: Math.max(0, Number(saved.lastTokenExpiresIn || 0) || 0),
      lastTokenStatus: clean(saved.lastTokenStatus),
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
      lastVerifiedAt: credentials.lastVerifiedAt,
      lastTokenScopes: scopeList(credentials.lastTokenScope),
      lastTokenLifetimeSeconds: credentials.lastTokenExpiresIn,
      lastTokenStatus: credentials.lastTokenStatus,
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
    const testedAt = new Date().toISOString();
    const verifiedMetadata = result.ok ? {
      lastVerifiedAt: testedAt,
      lastTokenScope: clean(result.scope),
      lastTokenExpiresIn: Math.max(0, Number(result.expiresIn || 0) || 0),
      lastTokenStatus: clean(result.tokenStatus),
    } : {};
    const next = {
      ...currentStore,
      ups: {
        ...(currentStore.ups || {}),
        environments: {
          ...(currentStore.ups?.environments || {}),
          [normalized]: {
            ...currentEnvironment,
            ...verifiedMetadata,
            lastTestedAt: testedAt,
            lastTestStatus: result.ok ? "verified" : "failed",
            lastTestMessage: clean(result.message),
          },
        },
      },
    };
    write(next);
    return status();
  }

  function uspsEnvironmentFallback(environment) {
    const test = environment === "test";
    const prefix = test ? "USPS_TEST_" : "USPS_";
    return {
      clientId: clean(env[`${prefix}CONSUMER_KEY`] || env[`${prefix}CLIENT_ID`] || env.USPS_CONSUMER_KEY || env.USPS_CLIENT_ID),
      clientSecret: clean(env[`${prefix}CONSUMER_SECRET`] || env[`${prefix}CLIENT_SECRET`] || env.USPS_CONSUMER_SECRET || env.USPS_CLIENT_SECRET),
      crid: clean(env[`${prefix}CRID`] || env.USPS_CRID),
      mid: clean(env[`${prefix}MID`] || env.USPS_MID),
      accountType: clean(env[`${prefix}ACCOUNT_TYPE`] || env.USPS_ACCOUNT_TYPE || "EPS").toUpperCase(),
      accountNumber: clean(env[`${prefix}ACCOUNT_NUMBER`] || env.USPS_ACCOUNT_NUMBER),
      webhookAdminEmail: clean(env[`${prefix}WEBHOOK_ADMIN_EMAIL`] || env.USPS_WEBHOOK_ADMIN_EMAIL),
    };
  }

  function activeUspsEnvironment() {
    const saved = clean(read().usps?.activeEnvironment).toLowerCase();
    if (CARRIER_ENVIRONMENTS.has(saved)) return saved;
    return ["1", "true", "yes"].includes(clean(env.USPS_TEST_MODE).toLowerCase()) ? "test" : "production";
  }

  function getUsps(environment = activeUspsEnvironment()) {
    const normalized = normalizeEnvironment(environment);
    const saved = read().usps?.environments?.[normalized] || {};
    const fallback = uspsEnvironmentFallback(normalized);
    return {
      environment: normalized,
      clientId: clean(saved.clientId || fallback.clientId),
      clientSecret: clean(saved.clientSecret || fallback.clientSecret),
      crid: clean(saved.crid || fallback.crid),
      mid: clean(saved.mid || fallback.mid),
      accountType: clean(saved.accountType || fallback.accountType || "EPS").toUpperCase(),
      accountNumber: clean(saved.accountNumber || fallback.accountNumber),
      webhookAdminEmail: clean(saved.webhookAdminEmail || fallback.webhookAdminEmail),
      webhookSecret: clean(saved.webhookSecret),
      updatedAt: clean(saved.updatedAt),
      lastTestedAt: clean(saved.lastTestedAt),
      lastTestStatus: clean(saved.lastTestStatus),
      lastTestMessage: clean(saved.lastTestMessage),
      lastVerifiedAt: clean(saved.lastVerifiedAt),
      lastTokenScope: clean(saved.lastTokenScope),
      lastTokenExpiresIn: Math.max(0, Number(saved.lastTokenExpiresIn || 0) || 0),
      lastTokenStatus: clean(saved.lastTokenStatus),
    };
  }

  function publicUspsEnvironment(environment) {
    const credentials = getUsps(environment);
    return {
      environment: credentials.environment,
      clientId: credentials.clientId,
      secretConfigured: Boolean(credentials.clientSecret),
      cridConfigured: Boolean(credentials.crid),
      cridEnding: credentials.crid ? credentials.crid.slice(-4) : "",
      midConfigured: Boolean(credentials.mid),
      midEnding: credentials.mid ? credentials.mid.slice(-4) : "",
      accountConfigured: Boolean(credentials.accountNumber),
      accountEnding: credentials.accountNumber ? credentials.accountNumber.slice(-4) : "",
      accountType: credentials.accountType,
      webhookAdminEmail: credentials.webhookAdminEmail,
      webhookSecretConfigured: Boolean(credentials.webhookSecret),
      configured: Boolean(credentials.clientId && credentials.clientSecret),
      updatedAt: credentials.updatedAt,
      lastTestedAt: credentials.lastTestedAt,
      lastTestStatus: credentials.lastTestStatus,
      lastTestMessage: credentials.lastTestMessage,
      lastVerifiedAt: credentials.lastVerifiedAt,
      lastTokenScopes: scopeList(credentials.lastTokenScope),
      lastTokenLifetimeSeconds: credentials.lastTokenExpiresIn,
      lastTokenStatus: credentials.lastTokenStatus,
    };
  }

  function uspsStatus() {
    const environment = activeUspsEnvironment();
    const environments = {
      production: publicUspsEnvironment("production"),
      test: publicUspsEnvironment("test"),
    };
    return {
      id: "usps",
      name: "USPS",
      available: true,
      environment,
      ...environments[environment],
      environments,
    };
  }

  function resolveUspsPatch(environment, patch = {}) {
    const normalized = normalizeEnvironment(environment);
    const current = getUsps(normalized);
    const submittedSecret = clean(patch.clientSecret);
    const clientId = clean(patch.clientId || current.clientId);
    const clientSecret = submittedSecret || current.clientSecret;
    if (!clientId || !clientSecret) throw new Error("USPS Consumer Key and Consumer Secret are required.");
    if (clientId !== current.clientId && !submittedSecret) throw new Error("Enter the matching USPS Consumer Secret when changing the Consumer Key.");
    if (clientId.length > 512 || clientSecret.length > 4096 || /[\r\n]/.test(`${clientId}${clientSecret}`)) throw new Error("Invalid USPS credentials.");
    const accountType = clean(patch.accountType || current.accountType || "EPS").toUpperCase();
    if (!new Set(["EPS", "PERMIT", "METER", "MID"]).has(accountType)) throw new Error("Select EPS, Permit, Meter, or MID for the USPS account type.");
    const webhookAdminEmail = clean(patch.webhookAdminEmail || current.webhookAdminEmail);
    if (webhookAdminEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(webhookAdminEmail)) throw new Error("Enter a valid USPS webhook administrator email.");
    return {
      environment: normalized,
      clientId,
      clientSecret,
      crid: clean(patch.crid || current.crid),
      mid: clean(patch.mid || current.mid),
      accountType,
      accountNumber: clean(patch.accountNumber || current.accountNumber),
      webhookAdminEmail,
      webhookSecret: current.webhookSecret || crypto.randomBytes(24).toString("base64url").slice(0, 32),
    };
  }

  function saveUsps(environment, patch = {}) {
    const resolved = resolveUspsPatch(environment, patch);
    const currentStore = read();
    const currentEnvironment = currentStore.usps?.environments?.[resolved.environment] || {};
    write({
      ...currentStore,
      usps: {
        ...(currentStore.usps || {}),
        activeEnvironment: resolved.environment,
        environments: {
          ...(currentStore.usps?.environments || {}),
          [resolved.environment]: {
            ...currentEnvironment,
            ...resolved,
            updatedAt: new Date().toISOString(),
          },
        },
      },
    });
    return uspsStatus();
  }

  function recordUspsTest(environment, result = {}) {
    const normalized = normalizeEnvironment(environment);
    const currentStore = read();
    const currentEnvironment = currentStore.usps?.environments?.[normalized] || {};
    const testedAt = new Date().toISOString();
    write({
      ...currentStore,
      usps: {
        ...(currentStore.usps || {}),
        environments: {
          ...(currentStore.usps?.environments || {}),
          [normalized]: {
            ...currentEnvironment,
            ...(result.ok ? {
              lastVerifiedAt: testedAt,
              lastTokenScope: clean(result.scope),
              lastTokenExpiresIn: Math.max(0, Number(result.expiresIn || 0) || 0),
              lastTokenStatus: clean(result.tokenStatus),
            } : {}),
            lastTestedAt: testedAt,
            lastTestStatus: result.ok ? "verified" : "failed",
            lastTestMessage: clean(result.message),
          },
        },
      },
    });
    return uspsStatus();
  }

  return {
    activeEnvironment,
    activeUspsEnvironment,
    getUps,
    getUsps,
    publicUpsEnvironment,
    publicUspsEnvironment,
    recordUpsTest,
    recordUspsTest,
    resolveUpsPatch,
    resolveUspsPatch,
    saveUps,
    saveUsps,
    status,
    uspsStatus,
  };
}

module.exports = { createCarrierCredentials };
