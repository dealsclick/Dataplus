const crypto = require('node:crypto');
const { LEGACY_TENANT, LEGACY_COMPANY } = require('./company-workspaces');
const { defaultQuoteExpiration, normalizeQuoteExpiration, normalizeQuoteTermIds } = require('./quote-documents');
const emptyState = () => ({ orders: [], orderDrafts: [], returns: [], customers: [], connections: [], warehouses: [], inventory: [], purchaseOrders: [], suppliers: [], vendors: [], brands: [], sequence: {}, orderViews: [] });
const failure = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
const customerString = value => String(value || '').trim();
const COMPANY_CHANNELS = [
  ['company-shopify','Shopify'],
  ['company-ebay','eBay'],
  ['company-temu','Temu'],
  ['company-tiktok','TikTok Shop'],
  ['company-whatnot','Whatnot']
];
const TERMINAL_FULFILLMENT = new Set(['shipped','fulfilled','closed','delivered','expired','canceled','cancelled','void','voided']);
const warehouseText = (value,max=500) => String(value ?? '').trim().slice(0,max);
const companyOrderLineCount = order => Array.isArray(order.items) && order.items.length ? order.items.length : 1;
const escapeHtml = value => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function companySystemSettings(company) {
  const profile=company.profile && typeof company.profile==='object' ? company.profile : {};
  const address=profile.address && typeof profile.address==='object' ? profile.address : {};
  return {
    organizationName:customerString(profile.displayName || company.name),
    organizationLegalName:customerString(profile.legalName),
    organizationEmail:customerString(profile.email),
    organizationPhone:customerString(profile.phone),
    organizationWebsite:customerString(profile.website),
    organizationAddress:{...address}
  };
}
function companyChannels(data) {
  const catalog=new Map(COMPANY_CHANNELS);
  return (Array.isArray(data.connections)?data.connections:[]).filter(record=>catalog.has(String(record.id || ''))).map(record=>{
    const id=String(record.id),name=catalog.get(id);
    return {
      ...record,id,name:record.name || name,connected:false,status:'setup',companyOwned:true,operationsEnabled:false,
      settings:{...(record.settings || {}),channelEnabled:false}
    };
  });
}
function warehousePatch(input, partial = false) {
  if(!input || typeof input!=='object' || Array.isArray(input))failure('Enter valid warehouse details.');
  const textFields=['name','code','status','warehouseType','inventorySourceType','fulfillmentNetwork','dropshipVendorId','contactName','managerName','phone','email','timezone','operatingHours','carrierCutoffTime','receivingInstructions','addressLine1','addressLine2','city','state','postalCode','country','shopifyLocationId','shopifyLocationName','notes'];
  const booleanFields=['isPhysical','allowReceiving','allowAudits','isSellable','isDefaultReceiving','isDefaultReturns','requireAppointment','allowBlindReceipts','requireSerialScan','requirePhotoForDamage','autoRouteReturns','requireBinValidation','shopifyInventoryPushEnabled'];
  const result={};
  for(const key of textFields)if(input[key]!==undefined)result[key]=warehouseText(input[key],key==='notes' || key==='receivingInstructions'?4000:500);
  for(const key of booleanFields)if(input[key]!==undefined){if(typeof input[key]!=='boolean')failure(`Choose a valid ${key}.`);result[key]=input[key];}
  if(input.capacityUnits!==undefined){const value=Number(input.capacityUnits);if(!Number.isFinite(value)||value<0||value>1e9)failure('Enter a valid warehouse capacity.');result.capacityUnits=value;}
  if(input.channelWarehouseMappings!==undefined){
    if(!Array.isArray(input.channelWarehouseMappings)||input.channelWarehouseMappings.length>100)failure('Enter valid channel warehouse mappings.');
    result.channelWarehouseMappings=input.channelWarehouseMappings.map(mapping=>({channel:warehouseText(mapping?.channel,100),localDisplayName:warehouseText(mapping?.localDisplayName,200),externalWarehouseId:warehouseText(mapping?.externalWarehouseId,300),externalWarehouseName:warehouseText(mapping?.externalWarehouseName,300),enabled:mapping?.enabled!==false}));
  }
  if(!partial && !result.name)failure('Warehouse name is required.');
  if(result.status && !['active','inactive'].includes(result.status.toLowerCase()))failure('Select a valid warehouse status.');
  return result;
}
function warehouseBinPatch(input, partial = false) {
  if(!input || typeof input!=='object' || Array.isArray(input))failure('Enter valid bin details.');
  const result={};
  for(const key of ['code','name','type','section','aisle','nickname','notes'])if(input[key]!==undefined)result[key]=warehouseText(input[key],key==='notes'?2000:300);
  for(const key of ['active','isDefault'])if(input[key]!==undefined){if(typeof input[key]!=='boolean')failure(`Choose a valid ${key}.`);result[key]=input[key];}
  if(!partial && !result.code)failure('Bin code is required.');
  return result;
}
function companyFulfillmentRows(data, includeTerminal = false) {
  const warehouses=Array.isArray(data.warehouses)?data.warehouses:[];
  const defaultWarehouse=warehouses.find(row=>row.status!=='inactive' && row.isDefaultReceiving) || warehouses.find(row=>row.status!=='inactive' && row.isPhysical!==false) || null;
  return (data.orders || []).flatMap(order=>{
    const orderStatus=customerString(order.operationalStatus || order.status).toLowerCase();
    if(!includeTerminal && TERMINAL_FULFILLMENT.has(orderStatus))return [];
    const address=order.shippingAddress || order.address || {};
    const items=Array.isArray(order.items) && order.items.length ? order.items : [{sku:order.sku,title:order.title,qty:order.qty || 1}];
    return items.map((item,lineIndex)=>{
      const routeId=`company-route:${order.id}:${lineIndex}`;
      const saved=(order.companyFulfillment || {})[routeId] || {};
      const selectedWarehouse=warehouses.find(row=>String(row.id)===String(saved.warehouseId || order.fulfillmentWarehouseId)) || defaultWarehouse;
      const packageInfo=saved.package || order.fulfillmentPackage || {};
      const weight=Number(packageInfo.packageWeight || 0),length=Number(packageInfo.packageLength || 0),width=Number(packageInfo.packageWidth || 0),height=Number(packageInfo.packageHeight || 0);
      const hasAddress=Boolean(address.line1 || address.address1) && Boolean(address.city || address.town) && Boolean(address.postalCode || address.zip || address.postcode);
      const routeStatus=customerString(saved.status || orderStatus || 'new').toLowerCase();
      const terminal=TERMINAL_FULFILLMENT.has(routeStatus) || TERMINAL_FULFILLMENT.has(orderStatus);
      const blockers=[!selectedWarehouse?'Warehouse missing':'',!weight?'Package weight missing':'',(!length||!width||!height)?'Package dimensions missing':'',!hasAddress?'Shipping address incomplete':''].filter(Boolean);
      const status=terminal ? (routeStatus || orderStatus) : blockers.length ? 'exception' : 'ready_to_ship';
      return {
        id:routeId,routeId,routeType:'warehouse',lineIndex,sku:customerString(item.sku),catalogSku:customerString(item.sku),productTitle:customerString(item.title || item.sku),qty:Number(item.qty || item.quantity || 1),
        orderId:order.id,orderNumber:order.orderNumber || order.internalOrderNumber,orderDate:order.orderDate || order.createdAt || '',customer:order.buyer || order.customerName || '',channel:order.channelSource || order.source || 'Manual',
        destination:address,shipBy:order.shipBy || '',shipDeadline:order.shipDeadline || order.shipBy || '',paymentStatus:order.financialStatus || '',operationalStatus:orderStatus,
        status,displayStatus:status,warehouseStage:routeStatus,warehouseId:selectedWarehouse?.id || '',warehouseName:selectedWarehouse?.name || '',supplierName:'Internal stock',allocationStatus:'unallocated',allocatedQty:0,
        supplyStatus:'none',supplyLabel:'No PO',package:packageInfo,packageSource:Object.keys(packageInfo).length?'manual':'missing',packageGroupKey:routeId,packageRouteIds:[routeId],shipAlone:saved.shipAlone!==false,
        shipment:(Array.isArray(order.shipments)?order.shipments:[])[0] || null,labelReadiness:{ready:!terminal && blockers.length===0,blockers,weight,length,width,height}
      };
    });
  });
}
function companyFulfillmentConsole(data,url) {
  const allWork=companyFulfillmentRows(data,true);
  let work=companyFulfillmentRows(data,false);
  const q=customerString(url.searchParams.get('q')).toLowerCase();
  if(q)work=work.filter(row=>[row.orderNumber,row.customer,row.channel,row.sku,row.destination?.city,row.destination?.state,row.destination?.postalCode].join(' ').toLowerCase().includes(q));
  const status=customerString(url.searchParams.get('status')).toLowerCase();
  if(status && !['all','late'].includes(status))work=work.filter(row=>String(row.status).toLowerCase()===status.toLowerCase());
  const requestedPage=Number(url.searchParams.get('page') || 1),requestedPageSize=Number(url.searchParams.get('pageSize') || 25);
  const page=Number.isSafeInteger(requestedPage) && requestedPage>0 ? requestedPage : 1,pageSize=Number.isSafeInteger(requestedPageSize) && requestedPageSize>0 ? Math.min(100,requestedPageSize) : 25;
  const total=work.length,paged=url.searchParams.get('paged')==='1';
  if(paged)work=work.slice((page-1)*pageSize,page*pageSize);
  const shipments=(data.orders || []).flatMap(order=>(Array.isArray(order.shipments)?order.shipments:[]).map(shipment=>({...shipment,orderId:order.id,orderNumber:order.orderNumber,customer:order.buyer || order.customerName,channel:order.channelSource || order.source,destination:order.shippingAddress || order.address || {}})));
  const pending=companyFulfillmentRows(data,false),exceptions=pending.filter(row=>row.status==='exception').map(row=>({id:`exception:${row.id}`,type:'readiness',orderId:row.orderId,orderNumber:row.orderNumber,message:row.labelReadiness.blockers.join(', '),createdAt:row.orderDate}));
  const channels=[...new Set(allWork.map(row=>String(row.channel || 'Unassigned')))];
  return {work,allWork,batches:[],printQueue:[],printStations:[],shipments,doNotShip:[],exceptions,manifests:[],reports:{},settings:data.fulfillmentSettings || {},warehouses:data.warehouses || [],capabilities:{localWorkflow:true,packageEditing:true,carrierRates:false,labelPurchase:false,carrierTracking:false},counts:{pending:pending.length,late:0,readyForLabel:pending.filter(row=>row.labelReadiness.ready).length,purchasedLabels:shipments.filter(row=>String(row.status).includes('purchased')).length,shipped:shipments.filter(row=>['shipped','in_transit','delivered'].includes(String(row.status || row.trackingStatus).toLowerCase())).length,doNotShip:0,exceptions:exceptions.length},facets:{channel:channels.map(label=>({value:label.toLowerCase(),label,count:allWork.filter(row=>row.channel===label).length}))},page,pageSize,total,totalPages:Math.max(1,Math.ceil(total/pageSize)),scope:'company'};
}
function secretPreview(value) {
  const text=String(value || '');
  if(!text)return '';
  return text.length<=8 ? `${text.slice(0,2)}...${text.slice(-2)}` : `${text.slice(0,4)}...${text.slice(-4)}`;
}
function customerIdentity(record = {}) {
  const address = record.shippingAddress || record.address || {};
  const email = customerString(record.buyerEmail || record.customerEmail || record.email).toLowerCase();
  const phone = customerString(record.phone || record.customerPhone || address.phone).replace(/\D/g, '');
  const name = customerString(record.buyer || record.customerName || record.name || address.name).toLowerCase().replace(/\s+/g, ' ');
  return email ? `email:${email}` : phone ? `phone:${phone}` : name ? `name:${name}` : '';
}
function companyCustomerId(scope, matchKey) {
  return `cc-${crypto.createHash('sha256').update(`${scope.tenantId}\0${scope.companyId}\0${matchKey}`).digest('hex').slice(0,20)}`;
}
function companyCustomers(data, scope) {
  const profiles = new Map((data.customers || []).map(profile => [profile.matchKey || customerIdentity(profile), profile]).filter(([key]) => key));
  const grouped = new Map();
  const add = (record, isOrder = false) => {
    const matchKey = customerIdentity(record);
    if (!matchKey) return;
    const address = record.shippingAddress || record.address || {};
    const id = companyCustomerId(scope, matchKey);
    const current = grouped.get(matchKey) || {
      id, matchKey, customerNumber: `C-${id.slice(-8).toUpperCase()}`,
      name: '', email: '', phone: '', company: '', defaultAddress: {}, marketplaceAccounts: [], orders: [], returns: [], lifetimeValue: 0, totalOrders: 0, lastOrderAt: '', createdAt: record.createdAt || new Date().toISOString()
    };
    current.name = current.name || customerString(record.buyer || record.customerName || record.name || address.name);
    current.email = current.email || customerString(record.buyerEmail || record.customerEmail || record.email);
    current.phone = current.phone || customerString(record.phone || record.customerPhone || address.phone);
    current.company = current.company || customerString(record.company || address.company);
    if (!Object.keys(current.defaultAddress).length) current.defaultAddress = { ...address };
    const channel = customerString(record.channelSource || record.salesChannel || record.sourceChannel || record.source);
    if (channel && !current.marketplaceAccounts.some(account => account.type === channel)) {
      current.marketplaceAccounts.push({ type: channel, value: customerString(record.marketplaceOrderNumber || record.channelOrderNumber) });
    }
    if (isOrder) {
      current.orders.push(record);
      current.totalOrders += 1;
      const items = Array.isArray(record.items) ? record.items : [];
      const total = Number(record.total ?? items.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0), 0));
      if (Number.isFinite(total)) current.lifetimeValue += total;
      const date = customerString(record.orderAt || record.createdAt || record.updatedAt);
      if (date && (!current.lastOrderAt || date > current.lastOrderAt)) current.lastOrderAt = date;
    }
    grouped.set(matchKey, current);
  };
  (data.orders || []).forEach(record => add(record, true));
  (data.orderDrafts || []).filter(record => !record.convertedOrderId).forEach(record => add(record, false));
  for (const [matchKey, profile] of profiles) {
    const id = companyCustomerId(scope, matchKey);
    const current = grouped.get(matchKey) || { id, matchKey, customerNumber: `C-${id.slice(-8).toUpperCase()}`, orders: [], returns: [], lifetimeValue: 0, totalOrders: 0, lastOrderAt: '', marketplaceAccounts: [], defaultAddress: {}, createdAt: profile.createdAt || new Date().toISOString() };
    grouped.set(matchKey, { ...current, ...profile, id: current.id, matchKey, orders: current.orders, returns: current.returns, lifetimeValue: current.lifetimeValue, totalOrders: current.totalOrders, lastOrderAt: current.lastOrderAt, marketplaceAccounts: current.marketplaceAccounts, defaultAddress: profile.defaultAddress || current.defaultAddress });
  }
  for (const record of data.returns || []) {
    const order = (data.orders || []).find(item => item.id === record.orderId || item.orderNumber === record.orderNumber);
    const matchKey = customerIdentity(order || record);
    const customer = grouped.get(matchKey);
    if (customer) customer.returns.push(record);
  }
  const now = Date.now();
  return [...grouped.values()].map(customer => {
    const last = Date.parse(customer.lastOrderAt || '');
    const days = Number.isFinite(last) ? Math.max(0, Math.floor((now - last) / 86400000)) : null;
    const segment = customer.totalOrders >= 2 ? 'repeat' : customer.totalOrders === 1 && days !== null && days > 120 ? 'at_risk' : customer.totalOrders === 1 ? 'new' : 'prospect';
    return { ...customer, segment, returnCount: customer.returns.length, averageOrderValue: customer.totalOrders ? customer.lifetimeValue / customer.totalOrders : 0, daysSinceLastOrder: days, identities: [customer.email && { type: 'email', value: customer.email }, customer.phone && { type: 'phone', value: customer.phone }].filter(Boolean) };
  });
}
function draftInput(input) {
  if(!input || typeof input !== 'object' || Array.isArray(input)) failure('Enter a valid draft.');
  const result = {};
  if(input.status !== undefined) {
    if(!['draft','reviewing','quoted','sent','accepted','lost'].includes(input.status)) failure('Select a valid quote status.');
    result.status=input.status;
  }
  for (const key of ['source','buyer','buyerEmail','phone','marketplaceOrderNumber','note','customerNote','customTerms']) {
    if (input[key] !== undefined) { if(typeof input[key] !== 'string' || input[key].length > 4000) failure(`Invalid ${key}.`); result[key] = input[key]; }
  }
  if(input.expiresAt !== undefined) {
    const expiresAt=normalizeQuoteExpiration(input.expiresAt);
    if(!expiresAt) failure('Select a valid quote expiration date.');
    result.expiresAt=expiresAt;
  }
  if(input.selectedTermIds !== undefined) {
    if(!Array.isArray(input.selectedTermIds)) failure('Select valid quote terms.');
    result.selectedTermIds=normalizeQuoteTermIds(input.selectedTermIds);
  }
  for(const key of ['shippingAddress','billingAddress']) if(input[key] !== undefined) {
    if(!input[key] || typeof input[key] !== 'object' || Array.isArray(input[key])) failure('Invalid address.');
    result[key] = Object.fromEntries(['name','line1','line2','city','state','province','postalCode','zip','country','phone'].filter(k => input[key][k] !== undefined).map(k => {
      if(typeof input[key][k] !== 'string' || input[key][k].length > 500) failure('Invalid address field.');
      return [k,input[key][k]];
    }));
  }
  if(input.items !== undefined) {
    if(!Array.isArray(input.items) || input.items.length > 500) failure('Use at most 500 draft lines.');
    result.items = input.items.map(item => {
      if(!item || typeof item.sku !== 'string' || item.sku.length > 200 || !item.sku.trim()) failure('Each line requires a SKU.');
      const qty=Number(item.qty), price=Number(item.price), msrp=Number(item.msrp || 0);
      if(!Number.isFinite(qty) || qty <= 0 || qty > 1000000 || !Number.isFinite(price) || price < 0 || price > 100000000 || !Number.isFinite(msrp) || msrp < 0 || msrp > 100000000) failure('Enter valid quantities and prices.');
      return {sku:item.sku.trim(), title:String(item.title || item.sku).slice(0,1000), qty, price, msrp, cost:null};
    });
  }
  return result;
}
function createCompanyOperationsHandler({ store, selection, sendJson, sendHtml, parseBody, normalizeDraft, buildOrder, exportDraft }) {
  return async (req,res,url,user) => {
    const scope=selection(req);
    if(!scope || (scope.tenantId===LEGACY_TENANT && scope.companyId===LEGACY_COMPANY)) return false;
    const ok=data => {sendJson(res,200,data); return true;};
    try {
      const company=await store.authorize(user,scope);
      const p=url.pathname, parts=p.split('/').filter(Boolean), method=req.method;
      const read=async()=>({...emptyState(),...await store.operationalState(user,scope)});
      const mutate=(action,work)=>store.updateOperationalState(user,scope,action,data=>{for(const [key,value] of Object.entries(emptyState()))data[key]??=value;return work(data);});
      const companyVersion=`company:${scope.tenantId}:${scope.companyId}:1`;
      if(method==='GET' && p==='/api/app/bootstrap') {
        const data=await read();
        return ok({changed:true,version:companyVersion,versions:{company:companyVersion},connections:companyChannels(data),warehouses:data.warehouses,systemSettings:companySystemSettings(company),connectorState:{}});
      }
      if(method==='GET' && p==='/api/app/summary') return ok({version:companyVersion,versions:{company:companyVersion},workerStatus:{},summary:null});
      if(method==='GET' && p==='/api/app/references') {
        const requested=[...new Set(String(url.searchParams.get('include') || '').split(',').map(value=>value.trim()).filter(Boolean))];
        const supported=new Set(['vendors','vendorDetails','brands','warehouses','connections','systemSettings']);
        if(!requested.length || requested.some(name=>!supported.has(name)))failure('Choose valid company references.');
        const data=await read(),references={changed:true,version:companyVersion,versions:Object.fromEntries(requested.map(name=>[name,companyVersion]))};
        for(const name of requested)references[name]=name==='systemSettings'?companySystemSettings(company):name==='warehouses'?data.warehouses:name==='connections'?companyChannels(data):[];
        return ok(references);
      }
      if(method==='GET' && p==='/api/state') {const data=await read();return ok({...data,connections:companyChannels(data),systemSettings:companySystemSettings(company),company:{id:company.id,name:company.name},ordersLoaded:true});}
      if(method==='GET' && p==='/api/import-jobs') return ok({importJobs:[],activeJobs:[],total:0,page:1,limit:10,workerStatus:{},companyId:company.id});
      if(method==='GET' && p==='/api/import-jobs/progress') return ok({jobs:[],total:0,page:1,companyId:company.id});
      if(method==='GET' && p==='/api/orders') {
        const data=await read(),q=(url.searchParams.get('q') || '').toLowerCase();
        const orders=data.orders.filter(o=>!q || [o.orderNumber,o.buyer,...o.items.map(i=>i.sku)].join(' ').toLowerCase().includes(q));
        return ok({orders,orderDrafts:data.orderDrafts.filter(d=>!d.convertedOrderId),returns:data.returns,customers:data.customers,ordersLoaded:true,metrics:{totalOrders:data.orders.length},scope:'company',storage:'postgres',limit:5000});
      }
      if(method==='GET' && p==='/api/orders/references'){const data=await read();return ok({connections:companyChannels(data),warehouses:data.warehouses,companyId:company.id});}
      if(method==='GET' && p==='/api/orders/views')return ok({views:(await read()).orderViews});
      if(method==='POST' && p==='/api/orders/views') {
        const body=await parseBody(req);
        if(typeof body.name !== 'string' || !body.name.trim() || body.name.length>100)failure('Enter a view name.');
        return ok(await mutate('order_view_created',data=>{const view={id:crypto.randomUUID(),name:body.name,filters:body.filters || {},dateRange:body.dateRange || {},sort:body.sort,columns:body.columns || []};data.orderViews.push(view);return {view,views:data.orderViews};}));
      }
      if(method==='DELETE' && parts[1]==='orders' && parts[2]==='views' && parts.length===4)return ok(await mutate('order_view_deleted',data=>{data.orderViews=data.orderViews.filter(v=>v.id!==parts[3]);return {views:data.orderViews};}));
      if(method==='GET' && p==='/api/order-drafts')return ok({orderDrafts:(await read()).orderDrafts.filter(d=>!d.convertedOrderId),draftsLoaded:true});
      if(method==='GET' && parts[1]==='order-drafts' && parts.length===3) {
        const draft=(await read()).orderDrafts.find(d=>d.id===parts[2] || d.draftNumber===parts[2]);
        if(!draft)failure('Draft not found.',404);return ok({draft,warehouses:(await read()).warehouses});
      }
      if(method==='GET' && parts[1]==='order-drafts' && parts[3]==='export' && parts.length===5) {
        const draft=(await read()).orderDrafts.find(d=>d.id===parts[2] || d.draftNumber===parts[2]);
        if(!draft)failure('Draft not found.',404);
        if(typeof exportDraft!=='function')failure('Quote exports are temporarily unavailable.',503);
        await exportDraft(res,draft,parts[4],String(url.searchParams.get('variant') || 'standard').toLowerCase());
        return true;
      }
      if(method==='GET' && parts[1]==='order-drafts' && parts[3]==='similar-skus' && parts.length===4) {
        const data=await read(),draft=data.orderDrafts.find(d=>d.id===parts[2] || d.draftNumber===parts[2]);
        if(!draft)failure('Draft not found.',404);
        const sku=String(url.searchParams.get('sku') || '').trim();
        const lineIndex=Number(url.searchParams.get('lineIndex'));
        const line=Number.isSafeInteger(lineIndex) && lineIndex >= 0 ? draft.items[lineIndex] : draft.items.find(item=>String(item.sku || '').toLowerCase()===sku.toLowerCase());
        const search=String(sku || line?.sku || url.searchParams.get('title') || line?.title || '').trim();
        const catalog=search ? await store.catalog(user,scope,search,1) : {rows:[]};
        const alternatives=catalog.rows.filter(item=>String(item.company_sku || item.source_sku || '').toLowerCase()!==String(line?.sku || sku).toLowerCase()).map(item=>({
          id:item.product_id,sku:item.company_sku || item.source_sku,title:item.title,brand:item.brand,manufacturer:item.manufacturer,
          manufacturerPartNumber:item.mfr_part_number,barcode:item.barcode,image:item.default_image,uom:item.uom,
          price:item.sell_price === null || item.sell_price === undefined ? null : Number(item.sell_price),msrp:null,available:null,sharedCatalog:true
        }));
        return ok({alternatives,message:alternatives.length?'Shared catalog matches use company-safe product facts. Enter BuySupply pricing on the quote.':'No similar company catalog SKUs were found.'});
      }
      if(method==='POST' && p==='/api/order-drafts') {
        const input=draftInput(await parseBody(req));
        return ok(await mutate('draft_created',data=>{const draft=normalizeDraft(data,{...input,status:'draft',expiresAt:input.expiresAt || defaultQuoteExpiration(30)});data.orderDrafts.unshift(draft);return {draft};}));
      }
      if(parts[1]==='order-drafts' && ((method==='PATCH' && parts.length===3) || (method==='POST' && parts.length===4 && ['duplicate','convert'].includes(parts[3])))) {
        const input=method==='PATCH'?draftInput(await parseBody(req)):{};
        return ok(await mutate('draft_'+(parts[3] || 'updated'),data=>{
          const draft=data.orderDrafts.find(d=>d.id===parts[2]);if(!draft)failure('Draft not found.',404);
          if(parts[3]==='convert') {
            if(draft.convertedOrderId)return {order:data.orders.find(o=>o.id===draft.convertedOrderId)};
            if(!draft.items.length)failure('Draft has no line items.');
            const order=buildOrder(data,draft,user.name || user.id);
            order.companyId=scope.companyId;order.tenantId=scope.tenantId;
            order.productCost=null;order.items=order.items.map(i=>({...i,cost:null}));
            data.orders.unshift(order);draft.convertedOrderId=order.id;draft.status='converted';return {order};
          }
          if(parts[3]==='duplicate') {
            const group=draft.quoteGroupId || draft.id;
            const revision=Math.max(0,...data.orderDrafts.filter(d=>(d.quoteGroupId || d.id)===group).map(d=>Number(d.revisionNumber || 1)))+1;
            const duplicate=normalizeDraft(data,{...draft,id:crypto.randomUUID(),draftNumber:'',quoteGroupId:group,parentDraftId:draft.id,revisionNumber:revision,marketplaceOrderNumber:'',convertedOrderId:undefined,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),status:'draft',expiresAt:defaultQuoteExpiration(30)});data.orderDrafts.unshift(duplicate);return {draft:duplicate};
          }
          if(draft.convertedOrderId)failure('This draft has already been converted.');
          Object.assign(draft,normalizeDraft(data,{...draft,...input,updatedAt:new Date().toISOString()}));return {draft};
        }));
      }
      if(method==='GET' && parts[1]==='orders' && parts.length===3) {
        const order=(await read()).orders.find(o=>o.id===parts[2] || o.orderNumber===parts[2]);
        if(!order)failure('Order not found.',404);return ok({order,inventory:[],warehouses:(await read()).warehouses,purchaseOrders:[],customer:null});
      }
      if(method==='GET' && parts[1]==='orders' && parts[3]==='packing-slip' && parts.length===4) {
        if(typeof sendHtml!=='function')failure('Packing slips are temporarily unavailable.',503);
        const data=await read(),order=data.orders.find(o=>o.id===parts[2] || o.orderNumber===parts[2]);
        if(!order)failure('Order not found.',404);
        const address=order.shippingAddress || order.address || {};
        const shipment=(Array.isArray(order.shipments)?order.shipments:[]).find(row=>String(row.status || '').toLowerCase()==='fulfilled') || (Array.isArray(order.shipments)?order.shipments:[])[0] || {};
        const savedRoutes=Object.values(order.companyFulfillment || {});
        const warehouse=data.warehouses.find(row=>String(row.id)===String(shipment.warehouseId || savedRoutes.find(route=>route?.warehouseId)?.warehouseId || order.fulfillmentWarehouseId)) || null;
        const items=Array.isArray(order.items) && order.items.length ? order.items : [{sku:order.sku,title:order.title,qty:order.qty || 1}];
        const addressLines=[address.name || order.buyer || order.customerName,address.company,address.line1 || address.address1,address.line2 || address.address2,[address.city || address.town,address.state || address.province,address.postalCode || address.zip || address.postcode].filter(Boolean).join(', '),address.country,address.phone].filter(Boolean);
        const channelName=customerString(order.channelSource || order.source || order.salesChannel || 'Manual');
        const batchNumber=customerString(shipment.fulfillmentBatchNumber || shipment.fulfillmentBatchId || 'Not assigned');
        const settings=companySystemSettings(company),profileAddress=settings.organizationAddress || {};
        const shipFrom=customerString(shipment.warehouseName || warehouse?.name || order.fulfillmentWarehouseName || settings.organizationName || company.name);
        const companyAddress=[profileAddress.line1,profileAddress.line2,[profileAddress.city,profileAddress.state,profileAddress.postalCode].filter(Boolean).join(', '),profileAddress.country].filter(Boolean);
        const shippingReference=[shipment.carrierName || shipment.carrier,shipment.service,shipment.trackingNumber].filter(Boolean).join(' / ');
        const html=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Packing slip ${escapeHtml(order.orderNumber || order.id)}</title><style>body{font-family:Arial,sans-serif;padding:28px;color:#111;max-width:1100px;margin:auto;font-size:14px;line-height:1.35}header{display:flex;justify-content:space-between;gap:32px;border-bottom:2px solid #111;padding-bottom:16px}h1{margin:0;font-size:30px}h2{font-size:15px;margin:22px 0 8px;text-transform:uppercase;letter-spacing:0}.muted,.references{font-size:14px}.references{display:grid;gap:4px;margin-top:10px}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #777;padding:10px;text-align:left;font-size:16px;font-weight:700}th{background:#f3f3f3}.qty{text-align:center;width:80px}.no-print{margin-top:20px;padding:9px 14px;border:1px solid #777;background:#fff;font-weight:700;cursor:pointer}@media(max-width:640px){body{padding:18px}header{display:block}.muted{margin-top:16px}}@media print{body{padding:0}.no-print{display:none}}</style></head><body><header><div><h1>${escapeHtml(settings.organizationName)} Packing Slip</h1>${settings.organizationLegalName && settings.organizationLegalName!==settings.organizationName?`<div class="muted">${escapeHtml(settings.organizationLegalName)}</div>`:''}<div class="references"><strong>Order ${escapeHtml(order.orderNumber || order.id)}</strong><span>Channel: ${escapeHtml(channelName)}</span><span>Batch ID: ${escapeHtml(batchNumber)}</span></div></div><div class="muted"><strong>Ship from</strong><br>${escapeHtml(shipFrom)}${shippingReference?`<br>${escapeHtml(shippingReference)}`:''}${companyAddress.length?`<br><br><strong>Company</strong><br>${companyAddress.map(line=>escapeHtml(line)).join('<br>')}`:''}</div></header><section><h2>Ship to</h2><p>${addressLines.map(line=>escapeHtml(line)).join('<br>') || 'Not provided'}</p></section><section><h2>Items</h2><table><thead><tr><th>SKU</th><th>Item</th><th class="qty">Qty</th></tr></thead><tbody>${items.map(item=>`<tr><td>${escapeHtml(item.sku || '')}</td><td>${escapeHtml(item.title || item.sku || '')}</td><td class="qty">${escapeHtml(item.qty || item.quantity || 0)}</td></tr>`).join('')}</tbody></table></section><button class="no-print" onclick="window.print()">Print</button></body></html>`;
        sendHtml(res,200,html);return true;
      }
      if(method==='GET' && p==='/api/customers') {
        const rows=companyCustomers(await read(),scope),q=customerString(url.searchParams.get('q')).toLowerCase(),segment=customerString(url.searchParams.get('segment') || 'all');
        const customers=rows.filter(customer=>(segment==='all' || customer.segment===segment) && (!q || [customer.name,customer.email,customer.phone,customer.company,customer.customerNumber].join(' ').toLowerCase().includes(q))).sort((left,right)=>String(right.lastOrderAt || right.updatedAt || '').localeCompare(String(left.lastOrderAt || left.updatedAt || '')));
        return ok({customers:customers.map(({orders,returns,...customer})=>customer),summary:{total:rows.length,repeat:rows.filter(row=>row.segment==='repeat').length,atRisk:rows.filter(row=>row.segment==='at_risk').length,lifetimeValue:rows.reduce((sum,row)=>sum+Number(row.lifetimeValue || 0),0)}});
      }
      if(parts[1]==='customers' && parts.length===3 && method==='GET') {
        const customer=companyCustomers(await read(),scope).find(row=>row.id===parts[2] || row.customerNumber===parts[2]);
        if(!customer)failure('Customer not found.',404);
        const {orders,returns,...profile}=customer;return ok({customer:profile,orders,returns});
      }
      if(parts[1]==='customers' && parts.length===3 && method==='PATCH') {
        const input=await parseBody(req),allowed=['name','email','phone','company','customerType','status','preferredChannel','notes'];
        if(!input || typeof input!=='object' || Array.isArray(input))failure('Enter valid customer details.');
        return ok(await mutate('customer_updated',data=>{
          const customer=companyCustomers(data,scope).find(row=>row.id===parts[2] || row.customerNumber===parts[2]);if(!customer)failure('Customer not found.',404);
          const existing=data.customers.find(row=>row.matchKey===customer.matchKey) || {};
          const patch=Object.fromEntries(allowed.filter(key=>input[key]!==undefined).map(key=>{if(typeof input[key]!=='string' || input[key].length>4000)failure(`Invalid ${key}.`);return [key,input[key].trim()];}));
          if(patch.status && !['active','inactive','do_not_contact'].includes(patch.status))failure('Select a valid customer status.');
          const tags=input.tags===undefined?(existing.tags || []):(Array.isArray(input.tags)?input.tags:String(input.tags).split(',')).map(value=>String(value).trim()).filter(Boolean).slice(0,100);
          const now=new Date().toISOString();
          const timeline=[...(Array.isArray(existing.timeline)?existing.timeline:[]),{id:crypto.randomUUID(),type:'edited',title:'Customer updated',message:'Company customer profile updated.',user:user.name || user.id,createdAt:now}];
          const saved={...existing,...patch,id:customer.id,matchKey:customer.matchKey,customerNumber:customer.customerNumber,tags,timeline,createdAt:existing.createdAt || now,updatedAt:now,updatedBy:user.id};
          const index=data.customers.findIndex(row=>row.matchKey===customer.matchKey);if(index>=0)data.customers[index]=saved;else data.customers.push(saved);
          return {customer:{...customer,...saved,orders:undefined,returns:undefined},message:'Customer profile saved.'};
        }));
      }
      if(method==='GET' && p==='/api/channels'){const connections=companyChannels(await read());return ok({channels:connections,connections,scope:'company'});}
      if(method==='PATCH' && parts[1]==='channels' && parts.length===3) {
        const input=await parseBody(req),known=COMPANY_CHANNELS.find(([id])=>id===parts[2]);
        if(!known)failure('Company channel not found.',404);
        if(!input || typeof input!=='object' || Array.isArray(input) || JSON.stringify(input).length>200000)failure('Enter valid channel settings.');
        const publicPatch={},credentialPatch={};
        for(const [key,value] of Object.entries(input)) {
          if(typeof value==='string' && value.trim() && !/configured$/i.test(key) && /(secret|token|password|appkey|clientid)/i.test(key)) {
            credentialPatch[key]=value.trim();publicPatch[`${key}Configured`]=true;
          } else publicPatch[key]=value;
        }
        if(Object.keys(credentialPatch).length)await store.saveChannelCredentials(user,scope,parts[2],credentialPatch);
        return ok(await mutate('company_channel_settings_saved',data=>{
          const channels=companyChannels(data),current=channels.find(channel=>channel.id===parts[2]);
          const channel={...current,connected:false,status:'setup',companyOwned:true,operationsEnabled:false,settings:{...(current.settings || {}),...publicPatch,channelEnabled:false},updatedAt:new Date().toISOString(),updatedBy:user.id};
          data.connections=[...(data.connections || []).filter(row=>row.id!==channel.id),channel];
          return {channel,message:'Channel setup saved. Live operations remain off until company workers are isolated.'};
        }));
      }
      if(method==='GET' && p==='/api/shopify/credentials') {
        const saved=await store.channelCredentials(user,scope,'company-shopify'),values=saved.values || {};
        return ok({credentials:{shop:values.storeDomain || '',apiVersion:values.apiVersion || '2026-04',hasAccessToken:Boolean(values.accessToken),hasClientCredentials:Boolean(values.clientId && values.clientSecret),clientIdPreview:secretPreview(values.clientId),clientSecretPreview:secretPreview(values.clientSecret),accessTokenPreview:secretPreview(values.accessToken),runtimeManaged:true,companyOwned:true,connected:false,updatedAt:saved.updatedAt}});
      }
      if(method==='PUT' && p==='/api/shopify/credentials') {
        const input=await parseBody(req),patch={};
        for(const key of ['storeDomain','apiVersion','clientId','clientSecret','accessToken'])if(typeof input?.[key]==='string' && input[key].trim())patch[key]=input[key].trim();
        if(patch.storeDomain && !/^[a-z0-9][a-z0-9.-]+$/i.test(patch.storeDomain))failure('Enter a valid Shopify store domain.');
        if(Object.values(patch).some(value=>value.length>10000))failure('A Shopify credential is too long.');
        await store.saveChannelCredentials(user,scope,'company-shopify',patch);
        const saved=await store.channelCredentials(user,scope,'company-shopify'),values=saved.values || {};
        return ok({credentials:{shop:values.storeDomain || '',apiVersion:values.apiVersion || '2026-04',hasAccessToken:Boolean(values.accessToken),hasClientCredentials:Boolean(values.clientId && values.clientSecret),clientIdPreview:secretPreview(values.clientId),clientSecretPreview:secretPreview(values.clientSecret),accessTokenPreview:secretPreview(values.accessToken),runtimeManaged:true,companyOwned:true,connected:false,updatedAt:saved.updatedAt},message:'Shopify credentials saved for this company. The channel was not connected.'});
      }
      if(method==='GET' && p==='/api/ebay/credentials') {
        const saved=await store.channelCredentials(user,scope,'company-ebay'),values=saved.values || {};
        return ok({credentials:{environment:values.environment || 'production',ruName:values.ruName || '',scope:values.scope || '',hasAccessToken:Boolean(values.accessToken),hasClientCredentials:Boolean(values.clientId && values.clientSecret),hasSellerAuthorization:false,configured:Boolean(values.clientId && values.clientSecret && values.ruName),clientIdPreview:secretPreview(values.clientId),clientSecretPreview:secretPreview(values.clientSecret),refreshTokenPreview:secretPreview(values.refreshToken),accessTokenPreview:secretPreview(values.accessToken),runtimeManaged:true,companyOwned:true,connected:false,updatedAt:saved.updatedAt}});
      }
      if(method==='PUT' && p==='/api/ebay/credentials') {
        const input=await parseBody(req),patch={};
        for(const key of ['environment','ruName','scope','clientId','clientSecret','refreshToken','accessToken'])if(typeof input?.[key]==='string' && input[key].trim())patch[key]=input[key].trim();
        if(patch.environment && !['production','sandbox'].includes(patch.environment))failure('Select a valid eBay environment.');
        if(Object.values(patch).some(value=>value.length>20000))failure('An eBay credential is too long.');
        await store.saveChannelCredentials(user,scope,'company-ebay',patch);
        const saved=await store.channelCredentials(user,scope,'company-ebay'),values=saved.values || {};
        return ok({credentials:{environment:values.environment || 'production',ruName:values.ruName || '',scope:values.scope || '',hasAccessToken:Boolean(values.accessToken),hasClientCredentials:Boolean(values.clientId && values.clientSecret),hasSellerAuthorization:false,configured:Boolean(values.clientId && values.clientSecret && values.ruName),clientIdPreview:secretPreview(values.clientId),clientSecretPreview:secretPreview(values.clientSecret),refreshTokenPreview:secretPreview(values.refreshToken),accessTokenPreview:secretPreview(values.accessToken),runtimeManaged:true,companyOwned:true,connected:false,updatedAt:saved.updatedAt},message:'eBay credentials saved for this company. Seller authorization was not started.'});
      }
      if(method==='GET' && p==='/api/warehouses')return ok({warehouses:(await read()).warehouses,scope:'company'});
      if(method==='POST' && p==='/api/warehouses') {
        const input=warehousePatch(await parseBody(req));
        return ok(await mutate('warehouse_created',data=>{
          if(data.warehouses.some(row=>input.code && String(row.code).toLowerCase()===input.code.toLowerCase()))failure('Warehouse code already exists.',409);
          const now=new Date().toISOString(),baseCode=(input.code || input.name.replace(/[^a-z0-9]/gi,'').slice(0,8) || 'WH').toUpperCase();let code=baseCode,suffix=2;
          while(data.warehouses.some(row=>String(row.code).toLowerCase()===code.toLowerCase()))code=`${baseCode}${suffix++}`;
          const warehouse={id:crypto.randomUUID(),code,status:'active',warehouseType:'Physical Warehouse',inventorySourceType:'physical',isPhysical:true,allowReceiving:true,allowAudits:true,isSellable:true,bins:[],...input,createdAt:now,updatedAt:now,createdBy:user.id,updatedBy:user.id,activity:[{id:crypto.randomUUID(),type:'created',title:'Warehouse created',message:`${input.name} was added to this company.`,user:user.name || user.id,createdAt:now}]};
          if(warehouse.isPhysical===false){warehouse.isDefaultReceiving=false;warehouse.isDefaultReturns=false;warehouse.requireBinValidation=false;}
          if(warehouse.isDefaultReceiving)data.warehouses.forEach(row=>{row.isDefaultReceiving=false;});
          if(warehouse.isDefaultReturns)data.warehouses.forEach(row=>{row.isDefaultReturns=false;});
          data.warehouses.push(warehouse);return {warehouse,warehouses:data.warehouses};
        }));
      }
      if(method==='PATCH' && parts[1]==='warehouses' && parts.length===3) {
        const input=warehousePatch(await parseBody(req),true);
        return ok(await mutate('warehouse_updated',data=>{
          const warehouse=data.warehouses.find(row=>row.id===parts[2]);if(!warehouse)failure('Warehouse not found.',404);
          if(input.code && data.warehouses.some(row=>row.id!==warehouse.id && String(row.code).toLowerCase()===input.code.toLowerCase()))failure('Warehouse code already exists.',409);
          if(input.isDefaultReceiving)data.warehouses.forEach(row=>{if(row.id!==warehouse.id)row.isDefaultReceiving=false;});
          if(input.isDefaultReturns)data.warehouses.forEach(row=>{if(row.id!==warehouse.id)row.isDefaultReturns=false;});
          Object.assign(warehouse,input,{updatedAt:new Date().toISOString(),updatedBy:user.id});
          if(warehouse.isPhysical===false){warehouse.isDefaultReceiving=false;warehouse.isDefaultReturns=false;warehouse.requireBinValidation=false;}
          warehouse.activity=[{id:crypto.randomUUID(),type:'updated',title:'Warehouse settings updated',message:'Company warehouse settings were saved.',user:user.name || user.id,createdAt:warehouse.updatedAt},...(warehouse.activity || [])].slice(0,100);
          return {warehouse,warehouses:data.warehouses};
        }));
      }
      if(method==='GET' && parts[1]==='warehouses' && parts[3]==='detail' && parts.length===4) {
        const data=await read(),warehouse=data.warehouses.find(row=>row.id===parts[2]);if(!warehouse)failure('Warehouse not found.',404);
        const receipts=(data.warehouseReceipts || []).filter(row=>row.warehouseId===warehouse.id),movements=(data.inventoryMovements || []).filter(row=>row.warehouseId===warehouse.id),audits=(data.warehouseAudits || []).filter(row=>row.warehouseId===warehouse.id);
        return ok({warehouse,summary:{totalBins:(warehouse.bins || []).length,activeBins:(warehouse.bins || []).filter(bin=>bin.active!==false).length,totalAudits:audits.length,openAudits:audits.filter(row=>!['closed','completed'].includes(String(row.status).toLowerCase())).length,receipts:receipts.length,movements:movements.length},activity:warehouse.activity || [],audits,receipts,movements});
      }
      if(method==='POST' && parts[1]==='warehouses' && parts[3]==='bins' && parts.length===4) {
        const input=warehouseBinPatch(await parseBody(req));
        return ok(await mutate('warehouse_bin_created',data=>{const warehouse=data.warehouses.find(row=>row.id===parts[2]);if(!warehouse)failure('Warehouse not found.',404);warehouse.bins=Array.isArray(warehouse.bins)?warehouse.bins:[];if(warehouse.bins.some(bin=>String(bin.code).toLowerCase()===input.code.toLowerCase()))failure('Bin code already exists in this warehouse.',409);if(input.isDefault)warehouse.bins.forEach(bin=>{bin.isDefault=false;});const now=new Date().toISOString(),bin={id:crypto.randomUUID(),active:true,...input,createdAt:now,updatedAt:now,createdBy:user.id};warehouse.bins.push(bin);warehouse.updatedAt=now;return {bin,warehouse};}));
      }
      if(method==='PATCH' && parts[1]==='warehouses' && parts[3]==='bins' && parts.length===5) {
        const input=warehouseBinPatch(await parseBody(req),true);
        return ok(await mutate('warehouse_bin_updated',data=>{const warehouse=data.warehouses.find(row=>row.id===parts[2]);if(!warehouse)failure('Warehouse not found.',404);warehouse.bins=Array.isArray(warehouse.bins)?warehouse.bins:[];const bin=warehouse.bins.find(row=>row.id===parts[4]);if(!bin)failure('Warehouse bin not found.',404);if(input.code && warehouse.bins.some(row=>row.id!==bin.id && String(row.code).toLowerCase()===input.code.toLowerCase()))failure('Bin code already exists in this warehouse.',409);if(input.isDefault)warehouse.bins.forEach(row=>{if(row.id!==bin.id)row.isDefault=false;});Object.assign(bin,input,{updatedAt:new Date().toISOString(),updatedBy:user.id});if(bin.active===false)bin.isDefault=false;warehouse.updatedAt=bin.updatedAt;return {bin,warehouse};}));
      }
      if(method==='GET' && p==='/api/fulfillment/console')return ok(companyFulfillmentConsole(await read(),url));
      if(method==='PUT' && p==='/api/fulfillment/settings') {
        const input=await parseBody(req);if(!input || typeof input!=='object' || Array.isArray(input) || JSON.stringify(input).length>200000)failure('Enter valid fulfillment settings.');
        return ok(await mutate('fulfillment_settings_saved',data=>{data.fulfillmentSettings={...data.fulfillmentSettings,...input,updatedAt:new Date().toISOString(),updatedBy:user.id};return {settings:data.fulfillmentSettings,message:'Company fulfillment settings saved.'};}));
      }
      if(method==='PATCH' && parts[1]==='orders' && parts[3]==='fulfillment-package' && parts.length===4) {
        const input=await parseBody(req);
        return ok(await mutate('fulfillment_package_saved',data=>{const order=data.orders.find(row=>row.id===parts[2] || row.orderNumber===parts[2]);if(!order)failure('Order not found.',404);const routeId=customerString(input.routeId || `company-route:${order.id}:0`);const lineIndex=Number(routeId.split(':').pop());if(!Number.isSafeInteger(lineIndex) || lineIndex<0 || lineIndex>=companyOrderLineCount(order))failure('Shipment route not found.',404);const values={};for(const key of ['packageWeight','packageLength','packageWidth','packageHeight']){const value=Number(input[key]);if(!Number.isFinite(value)||value<0||value>100000)failure('Enter valid package measurements.');values[key]=value;}if(input.warehouseId && !data.warehouses.some(row=>row.id===input.warehouseId))failure('Select a company warehouse.',404);order.companyFulfillment=order.companyFulfillment || {};order.companyFulfillment[routeId]={...(order.companyFulfillment[routeId] || {}),warehouseId:customerString(input.warehouseId),warehouseName:customerString(input.warehouseName),shipAlone:input.shipAlone!==false,package:values,status:input.markReady?'ready_to_ship':(order.companyFulfillment[routeId]?.status || 'new'),updatedAt:new Date().toISOString(),updatedBy:user.id};if(input.address && typeof input.address==='object')order.address={...(order.address || {}),...input.address};order.updatedAt=new Date().toISOString();const route=companyFulfillmentRows({...data,orders:[order]},true).find(row=>row.id===routeId);return {route,affectedOrderIds:[order.id],projectionUpdated:true};}));
      }
      if(method==='POST' && parts[1]==='orders' && parts[3]==='workflow-routes' && parts[5]==='status' && parts.length===6) {
        const input=await parseBody(req),next=customerString(input.status).toLowerCase();if(!['new','allocated','picked','packing','ready_to_ship','shipped','fulfilled','closed'].includes(next))failure('Select a valid fulfillment status.');
        return ok(await mutate('fulfillment_status_changed',data=>{const order=data.orders.find(row=>row.id===parts[2] || row.orderNumber===parts[2]);if(!order)failure('Order not found.',404);const routeId=decodeURIComponent(parts[4]);const lineIndex=Number(routeId.split(':').pop());if(!Number.isSafeInteger(lineIndex) || lineIndex<0 || lineIndex>=companyOrderLineCount(order))failure('Shipment route not found.',404);order.companyFulfillment=order.companyFulfillment || {};order.companyFulfillment[routeId]={...(order.companyFulfillment[routeId] || {}),status:next,updatedAt:new Date().toISOString(),updatedBy:user.id};const allLinesTerminal=Array.from({length:companyOrderLineCount(order)},(_,index)=>order.companyFulfillment[`company-route:${order.id}:${index}`]).every(route=>TERMINAL_FULFILLMENT.has(String(route?.status || '').toLowerCase()));if(['shipped','fulfilled','closed'].includes(next) && allLinesTerminal)order.operationalStatus=next;order.updatedAt=new Date().toISOString();return {route:companyFulfillmentRows({...data,orders:[order]},true).find(row=>row.id===routeId)};}));
      }
      if(method==='GET' && p==='/api/inventory') {
        const catalog=await store.catalog(user,scope,url.searchParams.get('q') || '',Number(url.searchParams.get('page') || 1));
        return ok({inventory:catalog.rows.map(p=>({id:p.product_id,sku:p.company_sku || p.source_sku,title:p.title,barcode:p.barcode,brand:p.brand,uom:p.uom,status:p.company_status || (p.selected?'draft':'shared'),cost:null,price:p.sell_price === null || p.sell_price === undefined ? null : Number(p.sell_price)})),hasMore:catalog.hasMore});
      }
      // No fallthrough into LINQ's global databases, settings, queues, or channel credentials.
      failure(`${company.name} has not enabled ${method} ${p} yet. No LINQ data was accessed.`,409);
    } catch(error) { sendJson(res,error.statusCode || 500,{error:error.statusCode?error.message:'Unable to load this company workspace.'});return true; }
  };
}
module.exports={createCompanyOperationsHandler,draftInput};
