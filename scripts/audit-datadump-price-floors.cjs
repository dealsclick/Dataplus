// Read only: enumerate price-floor evidence in the exact saved import file.
const fs=require('fs');
const {forEachDumpRecord}=require('./import-product-dump');
const source=process.argv[2],output=process.argv[3];
if(!source||!output)throw Error('Usage: node audit-datadump-price-floors.cjs SOURCE OUTPUT');
const report={source,scanned:0,fields:{},complete:false};
const pattern=/^(map|lap|map_?price|lap_?price|minimum_?advertised_?price|lowest_?advertised_?price|minimum_?allowed_?price)$/i;
function inspect(row,sku,supplier,prefix='',depth=0){if(!row||typeof row!=='object'||Array.isArray(row)||depth>3)return;for(const [k,v]of Object.entries(row)){const name=prefix+k;if(pattern.test(k)){const field=report.fields[name]||={present:0,positive:0,examples:[]};field.present++;const n=Number(v?.$numberDecimal??v?.toString?.()??v);if(n>0){field.positive++;if(field.examples.length<3)field.examples.push({sku,supplier,value:n});}}if(['original','productManagerFields','raw','pricing'].includes(k))inspect(v,sku,supplier,name+'.',depth+1);}}
const save=()=>fs.writeFileSync(output,JSON.stringify(report,null,2));
(async()=>{const before=fs.statSync(source);await forEachDumpRecord(source,{},row=>{report.scanned++;inspect(row,String(row.sku||row._id||''),row.supplier||row.supplier_code||'');if(report.scanned%100000===0){save();console.log('Scanned '+report.scanned);}});const after=fs.statSync(source);if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw Error('Source changed during audit');report.complete=true;save();console.log(JSON.stringify(report));})().catch(e=>{report.error=e.message;save();console.error(e.message);process.exitCode=1});
