const assert = require('node:assert/strict');
const { categoryTree, treePage } = require('../lib/category-tree');
const tree = categoryTree([
  { id: '1', fullName: 'Tools', leafCategoryTreeNode: false },
  { id: '2', fullName: 'Tools > Hammers', leafCategoryTreeNode: true },
  { id: '3', fullName: 'Toys > Hammers', leafCategoryTreeNode: true },
], 'ebay', { version: 'v1' });
assert.equal(treePage(tree).rows.length, 2);
assert.equal(treePage(tree).rows.find(r => r.name === 'Tools').selectable, false);
assert.equal(treePage(tree, { parent: JSON.stringify(['Tools']) }).rows[0].id, '2');
assert.equal(treePage(tree, { q: 'hammers' }).rows.length, 2);
assert.equal(treePage(tree, { q: 'tools hammers' }).rows[0].id, '2');
assert.equal(treePage(tree, { q: '2' }).rows[0].selectable, true);
assert.equal(treePage(tree, { q: 'nonexistent' }).total, 0);
const walmart = categoryTree([{ productType: 'Hammer', path: 'Tools > Hammers' }], 'walmart');
assert.equal(treePage(walmart).rows[0].selectable, false);
assert.equal(treePage(walmart, { q: 'hammers' }).rows[0].id, 'Hammer');
const google = categoryTree([{ id: 'g1', fullName: 'Tools > Hammers' }], 'google');
assert.equal(treePage(google).rows[0].id, '');
const many = categoryTree(Array.from({length: 120}, (_, i) => ({id: String(i), fullName: `Category ${i}`})), 'shopify');
assert.equal(treePage(many).rows.length, 50);
assert.equal(treePage(many).hasMore, true);
assert.equal(treePage(many, { offset: 100 }).rows.length, 20);
assert.equal(treePage(many, { offset: -1 }).offset, 0);
assert.equal(treePage(tree, { parent: 'invalid' }).rows.length, 0);
console.log('Category tree: branches, IDs, duplicate leaves, leaf restrictions, search and pagination passed.');
