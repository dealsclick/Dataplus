// Compare source minimums with the complete calculated selling price, including freight.
function sourcePriceFloors(item = {}) {
  const values = { minimumAllowedPrice: 0, mapPrice: 0, lapPrice: 0 };
  const groups = {
    minimumallowedprice: 'minimumAllowedPrice',
    map: 'mapPrice', mapprice: 'mapPrice', minimumadvertisedprice: 'mapPrice',
    lap: 'lapPrice', lapprice: 'lapPrice', lowestadvertisedprice: 'lapPrice'
  };
  const seen = new Set();
  function read(row, depth = 0) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || seen.has(row) || depth > 3) return;
    seen.add(row);
    for (const [key, value] of Object.entries(row)) {
      const field = groups[key.toLowerCase().replace(/[^a-z]/g, '')];
      if (field && value !== null && value !== '' && typeof value !== 'boolean') {
        const n = Number(value?.$numberDecimal ?? value?.toString?.() ?? value);
        if (Number.isFinite(n) && n > 0) values[field] = Math.max(values[field], n);
      }
    }
    for (const key of ['raw', 'original', 'productManagerFields', 'pricing']) read(row[key], depth + 1);
  }
  read(item);
  return { ...values, floor: Math.max(...Object.values(values)) };
}

function variantPriceFloor(item, variantQty = 1, sourceQty = 1) {
  const floor = sourcePriceFloors(item).floor;
  const quantity = Math.max(1, Number(variantQty) || 1);
  const basisQuantity = Math.max(1, Number(sourceQty) || 1);
  // Round upward so cents rounding never prices below a required minimum.
  return Math.ceil((floor * quantity / basisQuantity - 1e-9) * 100) / 100;
}
module.exports = { sourcePriceFloors, variantPriceFloor };
