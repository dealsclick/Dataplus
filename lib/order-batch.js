const { isDeepStrictEqual } = require('node:util');
// Never pick an arbitrary winner when snapshots disagree about one identity.
function uniqueRecords(rows, key, label) {
  const unique = new Map();
  for (const row of rows) {
    const id = row[key];
    if (unique.has(id) && !isDeepStrictEqual(unique.get(id), row)) throw new Error(`Conflicting ${label} identity ${id} in import batch; this batch was not written. Review source records before retrying.`);
    unique.set(id, row);
  }
  return [...unique.values()];
}
module.exports = { uniqueRecords };
