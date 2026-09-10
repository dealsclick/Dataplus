// Catalog status gates marketplace selling, never the physical inventory ledger.
function productIsMasterInactive(item = {}) {
  const active = item.active;
  return active === false || active === 0 || ['false', '0'].includes(String(active).trim().toLowerCase())
    || ['inactive', 'disabled', 'deleted'].includes(String(item.status || '').trim().toLowerCase())
    || item.deleted === true;
}

module.exports = { productIsMasterInactive };
