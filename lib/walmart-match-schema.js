// Official Walmart US MP_ITEM_MATCH v4.2 schema, published alongside the US item-spec version table.
// Preserve the original download; convert its draft-04 numeric exclusivity to draft-07 for Ajv.
const original = require('./walmart-schemas/MP_ITEM_MATCH_v4.2.json');
function convert(value) {
  if (Array.isArray(value)) return value.map(convert);
  if (!value || typeof value !== 'object') return value;
  const out = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, convert(item)]));
  if (out.$schema === 'http://json-schema.org/draft-04/schema#') out.$schema = 'http://json-schema.org/draft-07/schema#';
  for (const [exclusive, bound] of [['exclusiveMinimum', 'minimum'], ['exclusiveMaximum', 'maximum']]) {
    if (typeof out[exclusive] === 'boolean') {
      if (out[exclusive]) { out[exclusive] = out[bound]; delete out[bound]; }
      else delete out[exclusive];
    }
  }
  return out;
}
module.exports = convert(original);
