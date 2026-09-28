const cachedTrees = new WeakMap();
// Build navigation ancestors without inventing selectable marketplace IDs.
function categoryTree(rows, channel, metadata = {}) {
  const signature = JSON.stringify([channel, metadata]);
  const cached = cachedTrees.get(rows);
  if (cached?.signature === signature) return cached.tree;
  const nodes = new Map();
  for (const row of rows) {
    const id = String(row.categoryId || row.id || row.productType || '');
    const parts = (Array.isArray(row.path) ? row.path : String(row.fullName || row.categoryPath || row.path || row.name || '').split(' > ')).map(String).map(s => s.trim()).filter(Boolean);
    if (!id || !parts.length) continue;
    let parent = '';
    parts.forEach((name, i) => {
      const key = JSON.stringify(parts.slice(0, i + 1));
      if (!nodes.has(key)) nodes.set(key, { key, parent, name, path: parts.slice(0, i + 1).join(' > '), id: '', selectable: false, hasChildren: false });
      if (parent) nodes.get(parent).hasChildren = true;
      if (i === parts.length - 1) Object.assign(nodes.get(key), {
        id, selectable: channel !== 'ebay' || row.leafCategoryTreeNode === true,
        taxonomyVersion: metadata.taxonomyVersion || metadata.version || '', categoryHandle: row.handle || '', googleCategory: row.googleCategory || null,
      });
      parent = key;
    });
  }
  const list = [...nodes.values()].sort((a, b) => a.path.localeCompare(b.path));
  if (channel === 'ebay') for (const node of list) if (node.hasChildren) node.selectable = false;
  const tree = { nodes, list, metadata: { ...metadata, channel, categoryCount: rows.length } };
  cachedTrees.set(rows, { signature, tree });
  return tree;
}

function treePage(tree, { parent = '', q = '', offset = 0 } = {}) {
  const start = Math.max(0, Math.floor(Number(offset) || 0));
  const terms = String(q).trim().toLowerCase().slice(0, 200).split(/\s+/).filter(Boolean);
  const matches = tree.list.filter(node => terms.length
    ? terms.every(term => `${node.path} ${node.id}`.toLowerCase().includes(term))
    : node.parent === parent);
  return { ...tree.metadata, rows: matches.slice(start, start + 50), total: matches.length, offset: start, hasMore: start + 50 < matches.length };
}
module.exports = { categoryTree, treePage };
