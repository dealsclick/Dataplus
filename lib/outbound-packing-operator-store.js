const crypto = require("crypto");

function text(value) {
  return String(value || "").trim();
}

function fail(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function iso(value) {
  return value?.toISOString?.() || value || "";
}

function publicSession(row = {}, idleMinutes = 30) {
  const lastActivityAt = row.last_activity_at || row.assigned_at;
  const idleLocksAt = lastActivityAt ? new Date(new Date(lastActivityAt).getTime() + idleMinutes * 60 * 1000).toISOString() : "";
  return {
    id: row.operator_session_id || "",
    auditId: row.audit_id || "",
    stationId: row.station_id || "",
    stationName: row.station_name || "",
    operatorUserId: row.operator_user_id || "",
    operatorUserName: row.operator_user_name || "",
    assignedByName: row.assigned_by_name || "",
    assignedAt: iso(row.assigned_at),
    lastActivityAt: iso(lastActivityAt),
    idleLocksAt,
    expiresAt: iso(row.expires_at),
    lockedAt: iso(row.locked_at),
    status: row.locked_at ? "locked" : "active",
  };
}

function createOutboundPackingOperatorStore(getPool, options = {}) {
  async function pool() {
    const client = getPool();
    if (!client) throw fail("Packing-station operator sessions require PostgreSQL.", 503);
    if (typeof options.ensureSchema === "function") await options.ensureSchema();
    return client;
  }

  function policy() {
    const settings = typeof options.getSettings === "function" ? options.getSettings() || {} : {};
    return {
      required: settings.outboundPackingRequireOperator !== false,
      idleMinutes: Math.max(5, Math.min(240, Number(settings.outboundPackingIdleMinutes || 30) || 30)),
      maxHours: Math.max(1, Math.min(24, Number(settings.outboundPackingMaxSessionHours || 12) || 12)),
    };
  }

  async function expireAndLock(client, scope = {}, auditId = "", stationId = "") {
    const current = policy();
    await client.query(`
      update outbound_packing_operator_sessions operator set
        ended_at = now(), end_reason = case when audit.status <> 'open' then 'audit_closed' else 'shift_expired' end
      from outbound_audit_sessions audit
      where operator.audit_id = audit.audit_id
        and operator.tenant_id = $1 and operator.company_id = $2
        and operator.ended_at is null
        and ($3 = '' or operator.audit_id = $3)
        and ($4 = '' or operator.station_id = $4)
        and (audit.status <> 'open' or operator.expires_at <= now())
    `, [text(scope.tenantId), text(scope.companyId), text(auditId), text(stationId)]);
    await client.query(`
      update outbound_packing_operator_sessions set locked_at = coalesce(locked_at, now())
      where tenant_id = $1 and company_id = $2 and ended_at is null
        and ($3 = '' or audit_id = $3)
        and ($4 = '' or station_id = $4)
        and locked_at is null
        and last_activity_at <= now() - ($5::text || ' minutes')::interval
    `, [text(scope.tenantId), text(scope.companyId), text(auditId), text(stationId), current.idleMinutes]);
    return current;
  }

  async function list(scope = {}, auditId = "") {
    const client = await pool();
    const current = await expireAndLock(client, scope, auditId);
    const result = await client.query(`
      select * from outbound_packing_operator_sessions
      where tenant_id = $1 and company_id = $2 and audit_id = $3 and ended_at is null
      order by station_name, assigned_at
    `, [text(scope.tenantId), text(scope.companyId), text(auditId)]);
    return { sessions: result.rows.map((row) => publicSession(row, current.idleMinutes)), policy: current };
  }

  async function assign(scope = {}, auditId, input = {}, operator = {}, assignedBy = {}) {
    const client = await pool();
    const stationId = text(input.stationId);
    const stationName = text(input.stationName).slice(0, 80);
    if (!stationId || !stationName) throw fail("Choose a packing station before assigning an operator.");
    if (!operator.id) throw fail("Operator account not found.", 404);
    const current = policy();
    const connection = await client.connect();
    try {
      await connection.query("begin");
      const audit = await connection.query(`
        select status from outbound_audit_sessions
        where audit_id = $1 and tenant_id = $2 and company_id = $3
        for update
      `, [text(auditId), text(scope.tenantId), text(scope.companyId)]);
      if (!audit.rows.length) throw fail("Outbound audit not found.", 404);
      if (audit.rows[0].status !== "open") throw fail("This outbound audit is closed.", 409);
      await connection.query(`
        update outbound_packing_operator_sessions set ended_at = now(), end_reason = 'reassigned'
        where tenant_id = $1 and company_id = $2 and station_id = $3 and ended_at is null
      `, [text(scope.tenantId), text(scope.companyId), stationId]);
      const inserted = await connection.query(`
        insert into outbound_packing_operator_sessions (
          operator_session_id, tenant_id, company_id, audit_id, station_id, station_name,
          operator_user_id, operator_user_name, assigned_by_id, assigned_by_name, expires_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now() + ($11::text || ' hours')::interval)
        returning *
      `, [
        crypto.randomUUID(), text(scope.tenantId), text(scope.companyId), text(auditId), stationId, stationName,
        text(operator.id), text(operator.name || operator.username) || "Warehouse operator",
        text(assignedBy.id), text(assignedBy.name || assignedBy.username) || "DataPlus user", current.maxHours,
      ]);
      await connection.query("commit");
      return { session: publicSession(inserted.rows[0], current.idleMinutes), policy: current };
    } catch (error) {
      await connection.query("rollback").catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  async function active(scope = {}, auditId, stationId) {
    const client = await pool();
    const current = await expireAndLock(client, scope, auditId, stationId);
    const result = await client.query(`
      select * from outbound_packing_operator_sessions
      where tenant_id = $1 and company_id = $2 and audit_id = $3 and station_id = $4 and ended_at is null
      order by assigned_at desc limit 1
    `, [text(scope.tenantId), text(scope.companyId), text(auditId), text(stationId)]);
    return { row: result.rows[0] || null, policy: current };
  }

  async function requireActive(scope = {}, auditId, stationId) {
    const { row, policy: current } = await active(scope, auditId, stationId);
    if (!current.required) return { session: row ? publicSession(row, current.idleMinutes) : null, policy: current };
    if (!row) throw fail("Assign an operator with their badge and PIN before scanning at this station.", 423);
    if (row.locked_at) throw fail(`${row.operator_user_name || "Operator"}'s station is locked. Enter the operator PIN to continue.`, 423);
    return { session: publicSession(row, current.idleMinutes), operator: { id: row.operator_user_id, name: row.operator_user_name }, policy: current };
  }

  async function touch(scope = {}, auditId, stationId) {
    const client = await pool();
    await client.query(`
      update outbound_packing_operator_sessions set last_activity_at = now()
      where tenant_id = $1 and company_id = $2 and audit_id = $3 and station_id = $4 and ended_at is null and locked_at is null
    `, [text(scope.tenantId), text(scope.companyId), text(auditId), text(stationId)]);
  }

  async function lock(scope = {}, auditId, stationId) {
    const client = await pool();
    const current = policy();
    const result = await client.query(`
      update outbound_packing_operator_sessions set locked_at = now()
      where tenant_id = $1 and company_id = $2 and audit_id = $3 and station_id = $4 and ended_at is null
      returning *
    `, [text(scope.tenantId), text(scope.companyId), text(auditId), text(stationId)]);
    if (!result.rows.length) throw fail("No active operator is assigned to this station.", 404);
    return { session: publicSession(result.rows[0], current.idleMinutes), policy: current };
  }

  async function unlock(scope = {}, auditId, stationId) {
    const client = await pool();
    const current = policy();
    const result = await client.query(`
      update outbound_packing_operator_sessions set locked_at = null, last_activity_at = now()
      where tenant_id = $1 and company_id = $2 and audit_id = $3 and station_id = $4 and ended_at is null
      returning *
    `, [text(scope.tenantId), text(scope.companyId), text(auditId), text(stationId)]);
    if (!result.rows.length) throw fail("No active operator is assigned to this station.", 404);
    return { session: publicSession(result.rows[0], current.idleMinutes), policy: current };
  }

  async function end(scope = {}, auditId, stationId, reason = "manual") {
    const client = await pool();
    await client.query(`
      update outbound_packing_operator_sessions set ended_at = now(), end_reason = $5
      where tenant_id = $1 and company_id = $2 and audit_id = $3 and station_id = $4 and ended_at is null
    `, [text(scope.tenantId), text(scope.companyId), text(auditId), text(stationId), text(reason) || "manual"]);
    return { ended: true };
  }

  return { list, assign, active, requireActive, touch, lock, unlock, end };
}

module.exports = { createOutboundPackingOperatorStore };
