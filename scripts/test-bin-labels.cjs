const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('../web/node_modules/typescript');
const source=fs.readFileSync(require('node:path').join(__dirname,'../web/src/lib/bin-labels.ts'),'utf8');
const context={exports:{},require:name=>require('../web/node_modules/'+name)};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,context);
const {binLabelFormats,binLabelGrid,buildBinLabelDocument}=context.exports;
for(const [id,count] of [['full',1],['half',2],['quarter',4],['4x2',10],['2x1',40],['1.5x1',50]]){const f=binLabelFormats.find(f=>f.id===id);const l={...f,left:f.margin,top:.5,gapX:0,gapY:0};assert.equal(binLabelGrid(l).perPage,count);}
assert.throws(()=>binLabelGrid({width:2,height:1,left:5,top:0,gapX:0,gapY:0}),/do not fit/);
assert.throws(()=>binLabelGrid({width:2,height:1,left:0,top:0,gapX:-1,gapY:0}),/valid dimensions/);
const layout={width:1.5,height:1,left:.5,top:.5,gapX:0,gapY:0};
assert.throws(()=>buildBinLabelDocument([], 'Warehouse',layout,1),/Select at least/);
assert.throws(()=>buildBinLabelDocument([{code:'A'}], 'Warehouse',layout,0),/copies/);
assert.throws(()=>buildBinLabelDocument([{code:'A'}], 'Warehouse',layout,1.5),/copies/);
console.log('Bin label formats: Letter geometry, 50-up 1.5x1 labels, invalid alignment and copy limits passed.');
