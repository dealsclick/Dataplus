const crypto = require("crypto");

function text(value) {
  return String(value || "").trim();
}

function iso(value) {
  return value?.toISOString?.() || value || "";
}

function fail(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function publicSession(row = {}) {
  const sequence = Number(row.audit_number || 0);
  return {
    id: row.audit_id || "",
    auditNumber: sequence ? `OA-${String(sequence).padStart(6, "0")}` : "",
    warehouseId: row.warehouse_id || "",
    warehouseName: row.warehouse_name || "",
    carrier: row.carrier || "",
    status: row.status || "open",
    handoffMethod: row.handoff_method || "pickup",
    driverName: row.driver_name || "",
    pickupConfirmation: row.pickup_confirmation || "",
    notes: row.notes || "",
    packageCount: Number(row.package_count || 0),
    matchedCount: Number(row.matched_count || 0),
    unmatchedCount: Number(row.unmatched_count || 0),
    multipleMatchCount: Number(row.multiple_match_count || 0),
    startedById: row.started_by_id || "",
    startedByName: row.started_by_name || "",
    closedById: row.closed_by_id || "",
    closedByName: row.closed_by_name || "",
    startedAt: iso(row.started_at),
    closedAt: iso(row.closed_at),
    updatedAt: iso(row.updated_at),
  };
}

function publicScan(row = {}) {
  return {
    id: row.scan_id || "",
    clientScanId: row.client_scan_id || "",
    trackingRaw: row.tracking_raw || "",
    trackingNumber: row.tracking_number || row.tracking_raw || "",
    trackingNormalized: row.tracking_normalized || "",
    carrier: row.carrier || "",
    matchStatus: row.match_status || "unmatched",
    matches: Array.isArray(row.order_matches) ? row.order_matches : [],
    scannedById: row.scanned_by_id || "",
    scannedByName: row.scanned_by_name || "",
    scannedAt: iso(row.scanned_at),
  };
}

function createOutboundAuditStore(getPool, options = {}) {
  async function pool() {
    const client = getPool();
    if (!client) throw fail("Outbound audits require PostgreSQL.", 503);
    if (typeof options.ensureSchema === "function") await options.ensureSchema();
    return client;
  }

  async function refreshCounts(client, auditId) {
    await client.query(`
      update outbound_audit_sessions session set
        package_count = counts.package_count,
        matched_count = counts.matched_count,
        unmatched_count = counts.unmatched_count,
        multiple_match_count = counts.multiple_match_count,
        updated_at = now()
      from (
        select
          count(*)::integer as package_count,
          count(*) filter (where match_status in ('matched', 'multiple'))::integer as matched_count,
          count(*) filter (where match_status = 'unmatched')::integer as unmatched_count,
          count(*) filter (where match_status = 'multiple')::integer as multiple_match_count
        from outbound_audit_scans where audit_id = $1
      ) counts
      where session.audit_id = $1
    `, [auditId]);
  }

  async function list(scope = {}, input = {}) {
    const client = await pool();
    const limit = Math.max(1, Math.min(200, Number(input.limit || 50)));
    const result = await client.query(`
      select * from outbound_audit_sessions
      where tenant_id = $1 and company_id = $2
      order by case when status = 'open' then 0 else 1 end, started_at desc
      limit $3
    `, [text(scope.tenantId), text(scope.companyId), limit]);
    return result.rows.map(publicSession);
  }

  async function read(scope = {}, auditId) {
    const client = await pool();
    const [sessionResult, scanResult] = await Promise.all([
      client.query(`select * from outbound_audit_sessions where audit_id = $1 and tenant_id = $2 and company_id = $3 limit 1`, [text(auditId), text(scope.tenantId), text(scope.companyId)]),
      client.query(`
        select scan.* from outbound_audit_scans scan
        join outbound_audit_sessions session on session.audit_id = scan.audit_id
        where scan.audit_id = $1 and session.tenant_id = $2 and session.company_id = $3
        order by scan.scanned_at desc, scan.scan_id desc
      `, [text(auditId), text(scope.tenantId), text(scope.companyId)])
    ]);
    if (!sessionResult.rows.length) return null;
    return { session: publicSession(sessionResult.rows[0]), scans: scanResult.rows.map(publicScan) };
  }

  async function start(scope = {}, input = {}, actor = {}) {
    const client = await pool();
    const warehouseId = text(input.warehouseId);
    const warehouseName = text(input.warehouseName);
    if (!warehouseId) throw fail("Choose the warehouse performing this outbound audit.");
    const result = await client.query(`
      insert into outbound_audit_sessions (
        audit_id, tenant_id, company_id, warehouse_id, warehouse_name, carrier,
        handoff_method, status, notes, started_by_id, started_by_name
      ) values ($1,$2,$3,$4,$5,$6,$7,'open',$8,$9,$10)
      returning *
    `, [
      crypto.randomUUID(), text(scope.tenantId), text(scope.companyId), warehouseId,
      warehouseName, text(input.carrier), text(input.handoffMethod) || "pickup", text(input.notes),
      text(actor.id), text(actor.name || actor.username) || "DataPlus user"
    ]);
    return publicSession(result.rows[0]);
  }

  async function recordScan(scope = {}, auditId, input = {}, actor = {}) {
    const client = await pool();
    const trackingRaw = text(input.trackingRaw);
    const trackingNormalized = text(input.trackingNormalized).toUpperCase();
    if (!trackingRaw || !trackingNormalized) throw fail("Scan or enter a valid tracking barcode.");
    const connection = await client.connect();
    try {
      await connection.query("begin");
      const sessionResult = await connection.query(`
        select * from outbound_audit_sessions
        where audit_id = $1 and tenant_id = $2 and company_id = $3
        for update
      `, [text(auditId), text(scope.tenantId), text(scope.companyId)]);
      if (!sessionResult.rows.length) throw fail("Outbound audit not found.", 404);
      if (sessionResult.rows[0].status !== "open") throw fail("This outbound audit is closed and cannot accept more scans.", 409);

      const matches = Array.isArray(input.matches) ? input.matches.slice(0, 20) : [];
      const matchStatus = matches.length > 1 ? "multiple" : matches.length === 1 ? "matched" : "unmatched";
      const clientScanId = text(input.clientScanId) || crypto.randomUUID();
      const inserted = await connection.query(`
        insert into outbound_audit_scans (
          scan_id, audit_id, client_scan_id, tracking_raw, tracking_number,
          tracking_normalized, carrier, match_status, order_matches,
          scanned_by_id, scanned_by_name
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)
        on conflict do nothing
        returning *
      `, [
        crypto.randomUUID(), text(auditId), clientScanId, trackingRaw,
        text(input.trackingNumber) || trackingRaw, trackingNormalized, text(input.carrier),
        matchStatus, JSON.stringify(matches), text(actor.id), text(actor.name || actor.username) || "DataPlus user"
      ]);
      let row = inserted.rows[0];
      let duplicate = false;
      let sessionRow = sessionResult.rows[0];
      if (!row) {
        const existing = await connection.query(`
          select * from outbound_audit_scans
          where audit_id = $1 and (client_scan_id = $2 or tracking_normalized = $3)
          order by scanned_at desc limit 1
        `, [text(auditId), clientScanId, trackingNormalized]);
        row = existing.rows[0];
        duplicate = true;
      } else {
        const countUpdate = await connection.query(`
          update outbound_audit_sessions set
            package_count = package_count + 1,
            matched_count = matched_count + $1,
            unmatched_count = unmatched_count + $2,
            multiple_match_count = multiple_match_count + $3,
            updated_at = now()
          where audit_id = $4
          returning *
        `, [
          matchStatus === "matched" || matchStatus === "multiple" ? 1 : 0,
          matchStatus === "unmatched" ? 1 : 0,
          matchStatus === "multiple" ? 1 : 0,
          text(auditId)
        ]);
        sessionRow = countUpdate.rows[0] || sessionRow;
      }
      await connection.query("commit");
      return { scan: publicScan(row), session: publicSession(sessionRow), duplicate };
    } catch (error) {
      await connection.query("rollback").catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  async function replaceScanMatches(scope = {}, auditId, scanId, input = {}) {
    const client = await pool();
    const matches = Array.isArray(input.matches) ? input.matches.slice(0, 20) : [];
    const matchStatus = matches.length > 1 ? "multiple" : matches.length === 1 ? "matched" : "unmatched";
    const result = await client.query(`
      update outbound_audit_scans scan set
        tracking_number = $1,
        carrier = $2,
        match_status = $3,
        order_matches = $4::jsonb
      from outbound_audit_sessions session
      where scan.scan_id = $5 and scan.audit_id = $6
        and session.audit_id = scan.audit_id and session.tenant_id = $7 and session.company_id = $8
      returning scan.*
    `, [text(input.trackingNumber), text(input.carrier), matchStatus, JSON.stringify(matches), text(scanId), text(auditId), text(scope.tenantId), text(scope.companyId)]);
    if (!result.rows.length) throw fail("Outbound audit scan not found.", 404);
    await refreshCounts(client, text(auditId));
    return publicScan(result.rows[0]);
  }

  async function close(scope = {}, auditId, input = {}, actor = {}) {
    const client = await pool();
    const result = await client.query(`
      update outbound_audit_sessions set
        status = 'closed',
        handoff_method = $1,
        driver_name = $2,
        pickup_confirmation = $3,
        notes = case when $4 <> '' then $4 else notes end,
        closed_by_id = $5,
        closed_by_name = $6,
        closed_at = now(),
        updated_at = now()
      where audit_id = $7 and tenant_id = $8 and company_id = $9
        and status = 'open' and package_count > 0
      returning *
    `, [
      text(input.handoffMethod) || "pickup", text(input.driverName), text(input.pickupConfirmation),
      text(input.notes), text(actor.id), text(actor.name || actor.username) || "DataPlus user",
      text(auditId), text(scope.tenantId), text(scope.companyId)
    ]);
    if (!result.rows.length) {
      const existing = await read(scope, auditId);
      if (!existing) throw fail("Outbound audit not found.", 404);
      if (existing.session.status !== "open") return existing.session;
      throw fail("Scan at least one package before closing the handoff.", 409);
    }
    return publicSession(result.rows[0]);
  }

  return { list, read, start, recordScan, replaceScanMatches, close };
}

module.exports = { createOutboundAuditStore, publicSession, publicScan };
