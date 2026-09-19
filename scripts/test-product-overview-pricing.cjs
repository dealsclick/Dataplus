const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../web/src/App.tsx'), 'utf8');
const workspace = source.slice(source.indexOf('function CompleteProductWorkspace('));
const calculation = workspace.slice(workspace.indexOf('  const pricing ='), workspace.indexOf('  const pricingSourceLabel'));
function overview(product) {
  return vm.runInNewContext(`${calculation}\n;({cost, price, sellingUnit, profit: price - cost, margin})`, { product });
}

const each = overview({ sellUnitCost: 21.48, websitePrice: 6.87, uomDisplay: 'Pack of 4', pricingCalculation: { primarySellUnitCost: 5.37, finalPrice: 6.87, sellUnit: 'Each' } });
assert.equal(each.sellingUnit, 'Each');
assert.equal(each.cost, 5.37);
assert.equal(each.profit, 1.5);
assert.equal(each.margin.toFixed(1), '21.8');
const pack = overview({ pricingCalculation: { primarySellUnitCost: 21.48, finalPrice: 27.49, sellUnit: 'Case of 4' } });
assert.equal(pack.sellingUnit, 'Case of 4');
assert.equal(pack.profit.toFixed(2), '6.01');
const legacy = overview({ sellUnitCost: 10, websitePrice: 15, uomDisplay: 'Box of 2' });
assert.equal(legacy.profit, 5);
assert.equal(legacy.sellingUnit, 'Box of 2');
const zero = overview({ sellUnitCost: 9, websitePrice: 12, pricingCalculation: { primarySellUnitCost: 0, finalPrice: 0, sellUnit: 'Each' } });
assert.equal(zero.cost, 0);
assert.equal(zero.price, 0);
assert.equal(zero.margin, 0);
assert.ok(workspace.includes('<span>{sellingUnit}</span>'));
assert.ok(workspace.includes('["Selling UOM", sellingUnit]'));
assert.ok(workspace.includes('["Sell-unit cost", moneyLabel(cost)]'));
console.log('Product overview pricing tests passed.');
