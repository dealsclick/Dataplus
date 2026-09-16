const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../server.js'), 'utf8');
const start = source.indexOf('  if (req.method === "PATCH" && parts[0] === "api" && parts[1] === "categories" && parts[2])');
const end = source.indexOf('\n  if (req.method === "POST"', start);
const route = source.slice(start, end);
assert(!route.includes('readCategoryWorkflowDb'), 'No full-state reads');
assert(!route.includes('publicCategories('), 'No full catalog response');
async function run(locked) {
  const category = {id:'setting-id', categoryId:'main-test', name:'Computers', mappings:{shopify:{categoryId:'old',locked},ebay:{categoryId:'keep'}}};
  const db = {categorySettings:[category]}; let writes = 0;
  const context = {
    req:{method:'PATCH'},res:{}, parts:['api','categories','main-test'],url:new URL('https://example.test/api/categories/main-test?scope=main'),
    parseBody:async()=>({channel:'shopify',mapping:{categoryId:'new',categoryPath:'Electronics > Computers'}}),
    readCategoryReviewContext:async(id,scope)=>{ assert.equal(id,'main-test'); assert.equal(scope,'main'); return {db,source:{id:'main-test',name:'Computers',productCount:123}}; },
    normalizeCategorySettings: rows=>rows, formatCategoryName:value=>value,
    normalizeChannelCategoryMapping:m=>m, categoryMappingIsLocked:m=>m.locked,
    enrichShopifyCategoryMapping:m=>m,withCategoryMappingHistory:(old,next)=>next,
    normalizeSmartCollectionProfile:m=>m, persistCategoryWorkflowDb:async(d,options)=>{assert.equal(options.category,category);writes++;},
    clearCategoryResponseCache:()=>{},categorySettingsMap:d=>d.categorySettings,
    publicCategoryRow:(row,settings)=>({...row,mappings:settings[0].mappings}),
    sendJson:(res,status,body)=>({status,body}),notFound:()=>({status:404})
  };
  vm.createContext(context);
  const result = await vm.runInContext(`(async()=>{${route}})()`,context);
  assert.equal(result.status,locked?423:200);
  assert.equal(writes,locked?0:1);
  if (!locked) { assert.equal(result.body.category.productCount,123); assert.equal(result.body.category.mappings.ebay.categoryId,'keep'); assert.equal(result.body.category.mappings.shopify.categoryId,'new'); assert.equal(result.body.categories,undefined); }
}
Promise.resolve().then(()=>run(false)).then(()=>run(true)).then(()=>console.log('PASS targeted category save, single-row response, retained counts/channels and lock protection')).catch(error=>{console.error(error);process.exitCode=1;});
