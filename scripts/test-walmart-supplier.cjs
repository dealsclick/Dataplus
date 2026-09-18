const assert=require('node:assert/strict');const {walmartSupplierBlock}=require('../lib/walmart-supplier');
const main={id:'main',name:'RJ Schinner Company',status:'active',catalogSettings:{sourceCodes:['RJS']}};const alias={id:'alias',name:'RJS',status:'inactive'};const p={supplier:'RJ Schinner Company',vendor:'RJ Schinner Company',supplierCode:'RJS'};
assert.equal(walmartSupplierBlock(p,[main,alias]),null);
assert.equal(walmartSupplierBlock(p,[{...main,status:'inactive'},alias]).id,'main');
assert.equal(walmartSupplierBlock({...p,vendorId:'main'},[main,alias]),null);
assert.ok(walmartSupplierBlock({supplierCode:'RJS'},[main,alias]));
assert.ok(walmartSupplierBlock({...p,supplierRetirement:{retiredAt:'2026-01-01'}},[main,alias]));
assert.ok(walmartSupplierBlock(p,[main,{...alias,retirement:{retiredAt:'2026-01-01'}}]));
console.log('PASS Walmart canonical supplier status, alias fallback, inactive and retirement guards');
