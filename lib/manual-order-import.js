const XLSX = require('xlsx');
const crypto = require('node:crypto');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const fields = {
  orderId: ['so','order_id','order_number'], lineId: ['line_id','order_line_id'], date: ['order_date','date'],
  sku: ['item__','sku','item'], quantity: ['qty','quantity'], unitPrice: ['unit_price'], sales: ['ext_price','line_total','sales'],
  unitCost: ['unit_cost'], cost: ['ext_cost','line_cost'], customer: ['name','customer'], reference: ['reference'],
  status: ['status'], description: ['description'], vendor: ['vendor'], uom: ['uom'], reportedProfit: ['difference','profit']
};
function fail(message) { throw Object.assign(new Error(message), { statusCode:400 }); }
function parseFile(input) {
  if (!input || typeof input.content !== 'string' || input.content.length > 14_000_000 || !/\.(csv|xlsx|xls)$/i.test(input.filename || '')) fail('Upload a CSV, XLSX, or XLS file up to 10 MB.');
  const bytes=Buffer.from(input.content,'base64');
  if (!bytes.length || bytes.length>10*1024*1024) fail('Upload a file up to 10 MB.');
  const book=XLSX.read(bytes,{type:'buffer',cellDates:true,sheetRows:10002,cellFormula:false,cellHTML:false,raw:true});
  const sheetName=input.sheet || book.SheetNames[0];
  if(!book.SheetNames.includes(sheetName)) fail('Select a worksheet from this file.');
  const fullRange=book.Sheets[sheetName]['!fullref'];
  if(fullRange && XLSX.utils.decode_range(fullRange).e.r>10000) fail('The worksheet exceeds 10,000 data rows. Split the export; no rows have been imported.');
  const grid=XLSX.utils.sheet_to_json(book.Sheets[sheetName],{header:1,defval:'',raw:true,blankrows:false});
  if(grid.length<2 || grid.length>10001) fail('The worksheet must contain a header and 1–10,000 lines. Split larger exports before importing.');
  const headers=grid[0].map(v=>String(v).trim());
  if(headers.length>100 || headers.some(h=>!h) || new Set(headers).size!==headers.length) fail('Use at most 100 uniquely named, nonblank column headers.');
  const rows=grid.slice(1).map(row=>Object.fromEntries(headers.map((h,i)=>[h,row[i] instanceof Date ? row[i].toISOString().slice(0,10) : row[i] ?? ''])));
  const suggested=Object.fromEntries(Object.entries(fields).map(([field,aliases])=>[field,headers.find(h=>aliases.includes(h.toLowerCase())) || '']));
  return {headers,rows,sheets:book.SheetNames,sheet:sheetName,suggested,hash:crypto.createHash('sha256').update(bytes).digest('hex')};
}
function parseUpload(input) {
  return new Promise((resolve,reject)=>{
    const worker=new Worker(__filename,{workerData:input,resourceLimits:{maxOldGenerationSizeMb:192}});
    const timer=setTimeout(()=>{void worker.terminate();reject(Object.assign(new Error('File parsing timed out. Split the export into smaller files.'),{statusCode:400}));},15000);
    worker.once('message',result=>{clearTimeout(timer);if(result.error)reject(Object.assign(new Error(result.error),{statusCode:400}));else resolve(result);});
    worker.once('error',()=>{clearTimeout(timer);reject(Object.assign(new Error('Unable to parse this file. Check the format or split the export.'),{statusCode:400}));});
    worker.once('exit',code=>{clearTimeout(timer);if(code!==0)reject(Object.assign(new Error('File parser stopped.'),{statusCode:400}));});
  });
}
function normalize(parsed,mapping) {
  for(const field of ['orderId','date','sku','quantity']) if(!mapping[field] || !parsed.headers.includes(mapping[field])) fail(`Map ${field}.`);
  if(!mapping.sales && !mapping.unitPrice) fail('Map extended sales or unit price.');
  for(const [key,column] of Object.entries(mapping)) if(!(key in fields) || (column && !parsed.headers.includes(column))) fail('Invalid column mapping.');
  const issues=[],lines=[],keys=new Set();
  const number=(v,label,optional=false)=>{
    if(v==='' || v===null || v===undefined) {if(optional)return null;throw new Error(`${label} is missing.`);}
    const s=String(v).trim().replace(/^\((.*)\)$/,'-$1').replace(/[$,]/g,'');
    if(!/^-?\d+(\.\d+)?$/.test(s) || !Number.isFinite(Number(s)) || Math.abs(Number(s))>1e9) throw new Error(`${label} is invalid.`);
    return Number(s);
  };
  parsed.rows.forEach((raw,index)=>{
    const row=index+2, get=f=>mapping[f]?raw[mapping[f]]:'', str=f=>String(get(f)??'').trim();
    try {
      const orderId=str('orderId'),sku=str('sku'),date=str('date');
      if(!orderId || !sku || orderId.length>120 || sku.length>120) throw new Error('Order reference and SKU are required (maximum 120 characters).');
      let iso=date;
      if(/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(date)){const [m,d,y]=date.split('/');iso=`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;}
      if(!/^\d{4}-\d{2}-\d{2}$/.test(iso) || !Number.isFinite(Date.parse(iso)) || new Date(iso).toISOString().slice(0,10)!==iso) throw new Error('Use an order date in YYYY-MM-DD or MM/DD/YYYY format.');
      const quantity=number(get('quantity'),'Quantity');
      if(quantity===0) throw new Error('Quantity cannot be zero.');
      const unitPrice=number(get('unitPrice'),'Unit price',true),unitCost=number(get('unitCost'),'Unit cost',true);
      let sales=number(get('sales'),'Extended sales',true),cost=number(get('cost'),'Extended cost',true);
      if(sales===null) {if(unitPrice===null)throw new Error('Sales amount is missing.');sales=quantity*unitPrice;}
      if(cost===null && unitCost!==null)cost=quantity*unitCost;
      const cents=v=>{const n=Math.round((v+Math.sign(v)*Number.EPSILON)*100);if(!Number.isSafeInteger(n))throw new Error('Amount is too large.');return n;};
      const salesMinor=cents(sales),costMinor=cost===null?null:cents(cost);
      const lineId=str('lineId') || sku;
      if(lineId.length>160) throw new Error('Source line ID is too long.');
      const key=JSON.stringify([orderId,lineId]);
      if(keys.has(key))throw new Error('Repeated order/line key. Map a stable source line ID when an order contains the same SKU more than once.');
      keys.add(key);
      const warn=message=>issues.push({row,level:'warning',message});
      if(costMinor===null)warn('Historical cost is unknown; profit will remain unknown.');
      if(unitPrice!==null && Math.abs(cents(quantity*unitPrice)-salesMinor)>2)warn('Extended sales differs from quantity × unit price; imported extended sales is used.');
      if(unitCost!==null && costMinor!==null && Math.abs(cents(quantity*unitCost)-costMinor)>2)warn('Extended cost differs from quantity × unit cost; imported extended cost is used.');
      const reported=number(get('reportedProfit'),'Reported profit',true);
      if(reported!==null && costMinor!==null && Math.abs(cents(reported)-(salesMinor-costMinor))>2)warn('Source profit differs from sales minus cost; source profit is retained only as evidence.');
      const line={orderId,lineId,date:iso,sku,quantity,salesMinor,costMinor,unitCost,unitPrice,customer:str('customer'),reference:str('reference'),status:str('status') || 'Unspecified',description:str('description'),vendor:str('vendor'),uom:str('uom'),reportedProfit:reported};
      for(const value of Object.values(line))if(typeof value==='string' && value.length>2000)throw new Error('A text field exceeds 2,000 characters.');
      lines.push({...line,fingerprint:crypto.createHash('sha256').update(JSON.stringify(line)).digest('hex'),sourceRow:row});
    } catch(error){issues.push({row,level:'error',message:error.message});}
  });
  return {lines,issues,summary:{lineCount:lines.length,orderCount:new Set(lines.map(l=>l.orderId)).size,salesMinor:lines.reduce((s,l)=>s+l.salesMinor,0),knownCostMinor:lines.reduce((s,l)=>s+(l.costMinor??0),0),missingCostLines:lines.filter(l=>l.costMinor===null).length,errors:issues.filter(i=>i.level==='error').length,warnings:issues.filter(i=>i.level==='warning').length}};
}
if(!isMainThread) {try{parentPort.postMessage(parseFile(workerData));}catch(error){parentPort.postMessage({error:error.message});}}
module.exports={fields,parseUpload,parseFile,normalize};
