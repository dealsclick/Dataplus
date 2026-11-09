const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { LEGACY_TENANT, LEGACY_COMPANY } = require('./company-workspaces');
const { defaultQuoteExpiration, defaultQuoteTermIds, normalizeQuoteExpiration, normalizeQuoteTermIds, normalizeQuoteTermLibrary, quoteTermSnapshot } = require('./quote-documents');
const { buildInvoicePdf, buildOutlookDraft, invoiceEmailContent, orderCompanyProfile, safeFileName } = require('./customer-documents');
const emptyState = () => ({ orders: [], orderDrafts: [], returns: [], customers: [], connections: [], warehouses: [], inventory: [], purchaseOrders: [], suppliers: [], vendors: [], brands: [], sequence: {}, orderViews: [], quoteTerms: normalizeQuoteTermLibrary() });
const failure = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
const customerString = value => String(value || '').trim();
const COMPANY_CHANNELS = [
  ['company-shopify','Shopify'],
  ['company-ebay','eBay'],
  ['company-temu','Temu'],
  ['company-tiktok','TikTok Shop'],
  ['company-whatnot','Whatnot']
];
const COMPANY_RATE_PROVIDERS = new Set(['ups','usps','veeqo']);
const TERMINAL_FULFILLMENT = new Set(['shipped','fulfilled','closed','delivered','expired','canceled','cancelled','void','voided']);
const warehouseText = (value,max=500) => String(value ?? '').trim().slice(0,max);
const companyOrderLineCount = order => Array.isArray(order.items) && order.items.length ? order.items.length : 1;
const escapeHtml = value => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function companyQuoteTermLibrary(input) {
  if(!Array.isArray(input) || input.length>100)failure('Enter up to 100 valid quote terms.');
  const ids=new Set(),defaults=new Set();
  for(const [index,term] of input.entries()){
    const id=customerString(term?.id).toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,100);
    if(!id || !customerString(term?.group) || !customerString(term?.label) || !customerString(term?.text))failure(`Quote term ${index+1} requires an ID, group, label, and customer wording.`);
    if(ids.has(id))failure(`Quote term ID ${id} is duplicated.`);ids.add(id);
    const exclusive=customerString(term?.exclusiveGroup).toLowerCase().replace(/[^a-z0-9_-]+/g,'-');
    if(term?.active!==false && term?.defaultSelected===true && exclusive){if(defaults.has(exclusive))failure(`Only one ${exclusive.replace(/[-_]+/g,' ')} term can be selected by default.`);defaults.add(exclusive);}
  }
  const now=new Date().toISOString();
  return normalizeQuoteTermLibrary(input).map((term,index)=>({...term,sortOrder:index,createdAt:term.createdAt || now,updatedAt:now}));
}
function companyDraftTermSelection(data, requestedIds, previousSnapshot = [], useDefaults = false) {
  const library=normalizeQuoteTermLibrary(data.quoteTerms),ids=normalizeQuoteTermIds(useDefaults?defaultQuoteTermIds(library):requestedIds,library);
  return {selectedTermIds:ids,selectedTermsSnapshot:quoteTermSnapshot(library,ids,previousSnapshot)};
}
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
  if(input.salesOwner !== undefined) {
    if(typeof input.salesOwner !== 'string' || input.salesOwner.length>160)failure('Enter a valid sales owner.');
    result.salesOwner=input.salesOwner.trim();
  }
  if(input.nextAction !== undefined) {
    if(typeof input.nextAction !== 'string' || input.nextAction.length>500)failure('Enter a valid next action.');
    result.nextAction=input.nextAction.trim();
  }
  if(input.nextFollowUpAt !== undefined) {
    if(typeof input.nextFollowUpAt !== 'string' || (input.nextFollowUpAt && !Number.isFinite(Date.parse(input.nextFollowUpAt))))failure('Select a valid follow-up date and time.');
    result.nextFollowUpAt=input.nextFollowUpAt ? new Date(input.nextFollowUpAt).toISOString() : '';
  }
  if(input.expiresAt !== undefined) {
    const expiresAt=normalizeQuoteExpiration(input.expiresAt);
    if(!expiresAt) failure('Select a valid quote expiration date.');
    result.expiresAt=expiresAt;
  }
  if(input.selectedTermIds !== undefined) {
    if(!Array.isArray(input.selectedTermIds)) failure('Select valid quote terms.');
    result.selectedTermIds=[...new Set(input.selectedTermIds.map(value=>customerString(value)).filter(Boolean))].slice(0,100);
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
      const qty=Number(item.qty), price=Number(item.price), listPrice=Number(item.listPrice ?? item.msrp ?? 0), mapPrice=Number(item.mapPrice || 0);
      if(!Number.isFinite(qty) || qty <= 0 || qty > 1000000 || !Number.isFinite(price) || price < 0 || price > 100000000 || !Number.isFinite(listPrice) || listPrice < 0 || listPrice > 100000000 || !Number.isFinite(mapPrice) || mapPrice < 0 || mapPrice > 100000000) failure('Enter valid quantities and prices.');
      if(item.priceOverridden !== undefined && typeof item.priceOverridden !== 'boolean')failure('Choose a valid quote price mode.');
      const competitorPrice=item.competitorPrice === null || item.competitorPrice === undefined || item.competitorPrice === '' ? null : Number(item.competitorPrice);
      if(competitorPrice !== null && (!Number.isFinite(competitorPrice) || competitorPrice < 0 || competitorPrice > 100000000))failure('Enter a valid competitor price.');
      const competitorObservedAt=String(item.competitorObservedAt || '').trim();
      if(competitorObservedAt && !Number.isFinite(Date.parse(competitorObservedAt)))failure('Enter a valid competitor observation time.');
      return {
        sku:item.sku.trim(), title:String(item.title || item.sku).slice(0,1000), qty, price, priceOverridden:item.priceOverridden === true, msrp:listPrice, listPrice, mapPrice, cost:null,
        image:String(item.image || item.defaultImage || '').trim().slice(0,2048),
        catalogProductId:String(item.catalogProductId || '').trim().slice(0,300),
        catalogMatchedSku:String(item.catalogMatchedSku || '').trim().slice(0,200),
        catalogMatchReviewRequired:item.catalogMatchReviewRequired === true,
        manufacturerPartNumber:String(item.manufacturerPartNumber || item.mfrPartNumber || '').trim().slice(0,200),
        barcode:String(item.barcode || '').trim().slice(0,120),
        selectedSupplierKey:String(item.selectedSupplierKey || '').trim().slice(0,300),
        selectedSupplierId:String(item.selectedSupplierId || '').trim().slice(0,300),
        selectedSupplierName:String(item.selectedSupplierName || '').trim().slice(0,300),
        selectedSupplierCode:String(item.selectedSupplierCode || '').trim().slice(0,120),
        selectedSupplierSku:String(item.selectedSupplierSku || '').trim().slice(0,300),
        selectedSupplierProductId:String(item.selectedSupplierProductId || '').trim().slice(0,300),
        selectedSupplierUom:String(item.selectedSupplierUom || '').trim().slice(0,120),
        sourceUrl:String(item.sourceUrl || '').trim().slice(0,2048),
        sourceHost:String(item.sourceHost || '').trim().slice(0,255),
        sourcePageSku:String(item.sourcePageSku || '').trim().slice(0,160),
        competitorPrice,
        competitorCurrency:String(item.competitorCurrency || 'USD').trim().toUpperCase().slice(0,3) || 'USD',
        competitorObservedAt:competitorObservedAt ? new Date(competitorObservedAt).toISOString() : '',
        catalogMatchBasis:String(item.catalogMatchBasis || '').trim().slice(0,120),
        note:String(item.note || '').trim().slice(0,4000)
      };
    });
  }
  if(input.shippingEstimate !== undefined) {
    if(input.shippingEstimate === null) result.shippingEstimate=null;
    else {
      const estimate=input.shippingEstimate;
      if(!estimate || typeof estimate!=='object' || Array.isArray(estimate))failure('Select a valid shipping estimate.');
      const amount=Number(estimate.amount);
      if(!Number.isFinite(amount) || amount<0 || amount>1000000)failure('Select a valid shipping amount.');
      const packageInput=estimate.package;
      if(!packageInput || typeof packageInput!=='object' || Array.isArray(packageInput))failure('Enter the shipping package.');
      const packageValues={};
      for(const key of ['weight','length','width','height']){
        const value=Number(packageInput[key]);
        if(!Number.isFinite(value) || value<=0 || value>100000)failure('Enter valid package measurements.');
        packageValues[key]=value;
      }
      const providerId=String(estimate.providerId || '').trim().toLowerCase();
      if(!COMPANY_RATE_PROVIDERS.has(providerId))failure('Select a supported company shipping rate.');
      const carrier=String(estimate.carrier || '').trim().slice(0,120);
      if(!carrier)failure('Select a shipping carrier.');
      const expiresAt=String(estimate.expiresAt || '').trim();
      if(!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt)<=Date.now())failure('Refresh the carrier rate before saving it.');
      result.shippingEstimate={
        providerId,carrier,service:String(estimate.service || '').trim().slice(0,200),serviceCode:String(estimate.serviceCode || '').trim().slice(0,80),
        amount,currency:String(estimate.currency || 'USD').trim().slice(0,10),deliveryDays:Number.isFinite(Number(estimate.deliveryDays))?Number(estimate.deliveryDays):null,
        deliveryEstimate:String(estimate.deliveryEstimate || '').trim().slice(0,200),warehouseId:String(estimate.warehouseId || '').trim().slice(0,200),
        quotedAt:String(estimate.quotedAt || new Date().toISOString()).trim().slice(0,40),expiresAt:expiresAt.slice(0,40),package:packageValues
      };
    }
  }
  return result;
}

function companyQuoteActivityEvent(fromStatus,toStatus,user,createdAt,type='status_changed') {
  const from=String(fromStatus || '').trim().toLowerCase(),to=String(toStatus || 'draft').trim().toLowerCase();
  return {id:crypto.randomUUID(),type,fromStatus:from,toStatus:to,message:from&&from!==to?`Quote moved from ${from.replaceAll('_',' ')} to ${to.replaceAll('_',' ')}.`:`Quote entered ${to.replaceAll('_',' ')}.`,user:customerString(user || 'DataPlus user').slice(0,160),createdAt};
}

function importedCompanyDraftMatch(drafts,source,reference) {
  const normalizedSource=String(source || '').trim().toLowerCase();
  const normalizedReference=String(reference || '').trim().toLowerCase();
  if(!normalizedSource || !normalizedReference)return null;
  return (Array.isArray(drafts)?drafts:[]).find(d=>String(d.source || '').trim().toLowerCase()===normalizedSource
    && String(d.marketplaceOrderNumber || '').trim().toLowerCase()===normalizedReference) || null;
}
function importedCompanyDraftMatches(drafts,source,references) {
  const normalizedSource=String(source || '').trim().toLowerCase(),unique=[],seen=new Set();
  for(const value of Array.isArray(references)?references:[]){
    const reference=String(value || '').trim().slice(0,160),key=reference.toLowerCase();
    if(!reference || seen.has(key))continue;seen.add(key);unique.push({reference,key});
  }
  if(!normalizedSource || !unique.length)return [];
  const wanted=new Set(unique.map(item=>item.key)),matches=new Map();
  for(const draft of Array.isArray(drafts)?drafts:[]){
    if(String(draft.source || '').trim().toLowerCase()!==normalizedSource)continue;
    const key=String(draft.marketplaceOrderNumber || '').trim().toLowerCase();
    if(wanted.has(key) && !matches.has(key))matches.set(key,draft);
  }
  return unique.map(({reference,key})=>{const draft=matches.get(key) || null;return {reference,exists:Boolean(draft),draft:draft?{id:draft.id,draftNumber:draft.draftNumber || '',status:draft.status || 'draft'}:null};});
}
function normalizedCatalogIdentifier(value) {
  return String(value || '').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]+/g,'');
}
function companyCatalogCandidate(row, input) {
  const candidate=String(input || '').trim(),lower=candidate.toLowerCase(),normalized=normalizedCatalogIdentifier(candidate);
  if(!candidate)return null;
  const exact=[
    ['company_sku','Company SKU',0,false],
    ['source_sku','Catalog SKU',1,false],
    ['barcode','UPC / GTIN',2,false],
    ['mfr_part_number','Manufacturer part number candidate',3,true]
  ];
  for(const [field,basis,score,reviewRequired] of exact){
    if(String(row?.[field] || '').trim().toLowerCase()===lower)return {row,basis,score,reviewRequired,input:candidate};
  }
  if(normalized.length<5)return null;
  const normalizedFields=[
    ['company_sku','Normalized company SKU candidate',4,true],
    ['source_sku','Normalized catalog SKU candidate',5,true],
    ['mfr_part_number','Normalized manufacturer part number candidate',6,true]
  ];
  for(const [field,basis,score,reviewRequired] of normalizedFields){
    if(normalizedCatalogIdentifier(row?.[field])===normalized)return {row,basis,score,reviewRequired,input:candidate};
  }
  return null;
}
async function findCompanyCatalogProduct({store,user,scope,candidates}) {
  const searches=[...new Set((Array.isArray(candidates)?candidates:[candidates]).map(value=>String(value || '').trim()).filter(Boolean))];
  if(!searches.length)return null;
  const pages=await Promise.all(searches.map(search=>store.catalog(user,scope,search,1,false)));
  const matches=[];
  pages.forEach((page,pageIndex)=>{
    for(const row of page.rows || []){
      for(const candidate of searches){
        const match=companyCatalogCandidate(row,candidate);
        if(match)matches.push({...match,score:match.score+(candidate===searches[pageIndex]?0:0.25)});
      }
    }
  });
  matches.sort((left,right)=>left.score-right.score || String(left.row.source_sku || '').localeCompare(String(right.row.source_sku || '')));
  return matches[0] || null;
}
function companyCatalogProductProjection(match) {
  if(!match?.row)return null;
  const row=match.row;
  return {
    id:String(row.product_id || ''),sku:String(row.company_sku || row.source_sku || ''),sourceSku:String(row.source_sku || ''),
    title:String(row.title || ''),image:String(row.default_image || ''),brand:String(row.brand || ''),manufacturer:String(row.manufacturer || ''),
    manufacturerPartNumber:String(row.mfr_part_number || ''),barcode:String(row.barcode || ''),uom:String(row.uom || ''),
    matchBasis:match.basis,reviewRequired:match.reviewRequired === true
  };
}
async function resolveCompanyDraftCatalogLines({store,user,scope,items}) {
  const rows=Array.isArray(items)?items:[],cache=new Map();
  const keyFor=item=>[item.sku,item.catalogMatchedSku,item.sourcePageSku].map(value=>String(value || '').trim()).filter(Boolean).join('\0').toLowerCase();
  const keys=[...new Set(rows.map(keyFor).filter(Boolean))];
  let cursor=0;
  await Promise.all(Array.from({length:Math.min(4,keys.length)},async()=>{
    while(cursor<keys.length){
      const key=keys[cursor++],item=rows.find(row=>keyFor(row)===key);
      cache.set(key,await findCompanyCatalogProduct({store,user,scope,candidates:[item.sku,item.catalogMatchedSku,item.sourcePageSku]}));
    }
  }));
  return rows.map(item=>{
    const match=cache.get(keyFor(item));
    if(!match?.row)return {...item,catalogProductId:'',catalogMatchedSku:'',catalogMatchReviewRequired:false,image:String(item.image || '')};
    const product=companyCatalogProductProjection(match);
    return {...item,title:product.title || item.title,image:product.image || item.image || '',catalogProductId:product.id,catalogMatchedSku:product.sku,
      catalogMatchBasis:product.matchBasis,catalogMatchReviewRequired:product.reviewRequired,manufacturerPartNumber:product.manufacturerPartNumber,barcode:product.barcode};
  });
}
async function companyQuoteSupplierOptions({store,user,scope,sku}) {
  const search=String(sku || '').trim();
  if(!search)return {product:null,options:[],lowestCost:null};
  const match=await findCompanyCatalogProduct({store,user,scope,candidates:[search]});
  const product=match?.row || null;
  if(!product)return {product:null,productProjection:null,options:[],lowestCost:null};
  const costs=await store.costs(user,scope,product.product_id);
  const options=(costs || []).map(row=>{
    const cost=row.unit_cost === null || row.unit_cost === undefined || row.unit_cost === '' ? null : Number(row.unit_cost);
    return {
      key:`vendor:${String(row.vendor_account_id || '').trim()}`,
      productId:String(product.product_id || ''),vendorId:String(row.vendor_account_id || ''),
      supplierName:String(row.supplier_name || 'Company supplier'),supplierCode:'',
      supplierSku:String(product.company_sku || product.source_sku || ''),sourceSku:String(product.source_sku || ''),vendorSku:'',managedSku:String(product.company_sku || product.source_sku || ''),
      cost:Number.isFinite(cost) && cost >= 0 ? cost : null,qty:null,uom:String(row.uom || ''),
      matchType:'company-cost',requiresReview:false,selectable:true,related:false,isPrimary:false
    };
  }).sort((left,right)=>{
    if((left.cost === null)!==(right.cost === null))return left.cost === null ? 1 : -1;
    if(left.cost !== null && right.cost !== null && left.cost!==right.cost)return left.cost-right.cost;
    return left.supplierName.localeCompare(right.supplierName);
  });
  const known=options.filter(option=>option.cost !== null).map(option=>option.cost);
  return {product,productProjection:companyCatalogProductProjection(match),options,lowestCost:known.length?Math.min(...known):null};
}
async function companyCatalogDetail({store,user,scope,key}) {
  const row=await store.catalogProduct(user,scope,key);
  if(!row)failure('Product not found.',404);
  const costs=row.selected ? await store.costs(user,scope,row.product_id) : [];
  const companyCosts=(costs || []).map(cost=>{
    const numeric=cost.unit_cost === null || cost.unit_cost === undefined || cost.unit_cost === '' ? null : Number(cost.unit_cost);
    return {
      vendorId:String(cost.vendor_account_id || ''),supplierName:String(cost.supplier_name || 'Company supplier'),
      cost:Number.isFinite(numeric) && numeric >= 0 ? numeric : null,uom:String(cost.uom || ''),updatedAt:cost.updated_at || null
    };
  }).sort((left,right)=>{
    if((left.cost === null)!==(right.cost === null))return left.cost === null ? 1 : -1;
    if(left.cost !== null && right.cost !== null && left.cost!==right.cost)return left.cost-right.cost;
    return left.supplierName.localeCompare(right.supplierName);
  });
  const knownCosts=companyCosts.map(cost=>cost.cost).filter(cost=>cost !== null);
  const lowestCost=knownCosts.length ? Math.min(...knownCosts) : null;
  const sellPrice=row.sell_price === null || row.sell_price === undefined || row.sell_price === '' ? null : Number(row.sell_price);
  const status=String(row.company_status || (row.selected?'draft':'shared'));
  return {
    id:String(row.product_id || ''),sku:String(row.company_sku || row.source_sku || ''),sourceSku:String(row.source_sku || ''),
    title:String(row.title || ''),marketplaceTitle:String(row.title || ''),brand:String(row.brand || ''),manufacturer:String(row.manufacturer || ''),
    mfrPartNumber:String(row.mfr_part_number || ''),barcode:String(row.barcode || ''),mainCategory:String(row.main_category || ''),
    defaultImage:String(row.default_image || ''),images:row.default_image?[String(row.default_image)]:[],uom:String(row.uom || ''),uomDisplay:String(row.uom || 'Each'),
    status,active:status==='active'?true:status==='inactive'?false:undefined,inProducts:true,sourceOnly:false,
    price:Number.isFinite(sellPrice) && sellPrice >= 0 ? sellPrice : null,websitePrice:Number.isFinite(sellPrice) && sellPrice >= 0 ? sellPrice : null,
    cost:lowestCost,sellUnitCost:lowestCost,companyCatalogView:true,companySelected:row.selected === true,
    companyInventoryConnected:false,companyCosts
  };
}
async function hydrateCompanyDraftSupplierSelections({store,user,scope,items}) {
  const rows=Array.isArray(items)?items:[];
  const lookups=new Map();
  await Promise.all([...new Set(rows.filter(item=>item.selectedSupplierKey).map(item=>item.sku))].map(async sku=>{
    lookups.set(String(sku).toLowerCase(),await companyQuoteSupplierOptions({store,user,scope,sku}));
  }));
  return rows.map(item=>{
    if(!item.selectedSupplierKey)return {...item,cost:null,selectedSupplierId:'',selectedSupplierName:'',selectedSupplierCode:'',selectedSupplierSku:'',selectedSupplierProductId:'',selectedSupplierUom:''};
    const result=lookups.get(String(item.sku || '').toLowerCase());
    const selection=result?.options?.find(option=>option.key===item.selectedSupplierKey);
    if(!selection)failure(`The selected supplier for ${item.sku || 'this quote line'} is no longer available.`,409);
    return {...item,cost:selection.cost,selectedSupplierKey:selection.key,selectedSupplierId:selection.vendorId,
      selectedSupplierName:selection.supplierName,selectedSupplierCode:selection.supplierCode,selectedSupplierSku:selection.supplierSku,
      selectedSupplierProductId:selection.productId,selectedSupplierUom:selection.uom};
  });
}
function companyCarrierAddress(source = {}, fallbackName = '') {
  return {
    company:customerString(source.company || fallbackName),name:customerString(source.name || fallbackName),
    line1:customerString(source.line1 || source.address1 || source.addressLine1),line2:customerString(source.line2 || source.address2 || source.addressLine2),
    city:customerString(source.city || source.town),state:customerString(source.state || source.province),
    postalCode:customerString(source.postalCode || source.zip || source.postcode),country:customerString(source.country || 'US') || 'US',
    phone:customerString(source.phone || source.phoneNumber),email:customerString(source.email)
  };
}
function companyQuotePackage(input = {}) {
  const source=input.package && typeof input.package==='object' ? input.package : input;
  const result={};
  for(const key of ['weight','length','width','height']){
    const aliases={weight:['weight','packageWeight','weightPounds'],length:['length','packageLength','lengthInches'],width:['width','packageWidth','widthInches'],height:['height','packageHeight','heightInches']};
    const value=Number(aliases[key].map(alias=>source[alias]).find(candidate=>candidate!==undefined && candidate!==null && candidate!=='') || 0);
    if(!Number.isFinite(value) || value<=0 || value>100000)failure('Enter weight and all package dimensions.');
    result[key]=value;
  }
  result.weightUnit=customerString(source.weightUnit || 'lb') || 'lb';
  result.dimensionUnit=customerString(source.dimensionUnit || 'in') || 'in';
  result.type=customerString(source.packageType || source.type || 'box') || 'box';
  return result;
}
function companyRateExpired(estimate, now = Date.now()) {
  if(!estimate)return false;
  const expiresAt=Date.parse(String(estimate.expiresAt || ''));
  return !Number.isFinite(expiresAt) || expiresAt<=now;
}
function assertFreshCompanyRate(draft) {
  if(companyRateExpired(draft?.shippingEstimate))failure('The saved shipping rate has expired. Refresh the carrier rates before accepting or converting this quote.',409);
}
function companyShippingBasisChanged(draft, input) {
  const items=(value)=>JSON.stringify((Array.isArray(value)?value:[]).map(item=>({sku:String(item.sku || '').trim(),title:String(item.title || '').trim(),qty:Number(item.qty || 0),price:Number(item.price || 0),msrp:Number(item.msrp || 0)})));
  const address=(value)=>JSON.stringify(companyCarrierAddress(value || {}));
  return (input.items!==undefined && items(input.items)!==items(draft.items))
    || (input.shippingAddress!==undefined && address(input.shippingAddress)!==address(draft.shippingAddress));
}
function companyAttachmentDirectory(root, scope) {
  const base=typeof root==='function'?root():root;
  if(!base)failure('Company label storage is not configured.',503);
  const key=crypto.createHash('sha256').update(`${scope.tenantId}\0${scope.companyId}`).digest('hex');
  return path.join(base,key);
}
function companyRateRules(data = {}) {
  const settings=data.fulfillmentSettings || {};
  return {
    autoSelectRule:customerString(settings.shippingLabelAutoSelectRule || 'cheapest') || 'cheapest',
    preferredCarrier:customerString(settings.shippingLabelPreferredCarrier),preferredService:customerString(settings.shippingLabelPreferredService),
    maxCost:Math.max(0,Number(settings.shippingLabelMaxCost || 0) || 0),
    printPackingSlipWithLabel:settings.shippingLabelPrintPackingSlipWithLabel===true,
    requireConfirmationAboveMax:settings.shippingLabelRequireConfirmationAboveMax===true
  };
}
async function requestCompanyCarrierRates({store,user,scope,company,data,subject,input,quoteUps,quoteUsps,quoteVeeqo,validateAddress}) {
  const carriers=await store.companyCarrierAccess(user,scope);
  const adapters={ups:quoteUps,usps:quoteUsps,veeqo:quoteVeeqo};
  const enabledCarriers=carriers.filter(provider=>provider.enabled && provider.companyRates && typeof adapters[provider.id]==='function');
  if(!enabledCarriers.length)failure('No rate-capable carrier account is enabled for this company. Ask an organization owner to share UPS, USPS, or Veeqo.',403);
  const packageInfo=companyQuotePackage(input),warehouseId=customerString(input.warehouseId);
  const warehouse=(warehouseId?data.warehouses.find(row=>String(row.id)===warehouseId):null)
    || data.warehouses.find(row=>row.status!=='inactive' && row.isDefaultReceiving)
    || data.warehouses.find(row=>row.status!=='inactive' && row.isPhysical!==false)
    || null;
  const settings=companySystemSettings(company);
  const from=companyCarrierAddress(warehouse || settings.organizationAddress,warehouse?.name || settings.organizationName);
  if(!from.phone)from.phone=settings.organizationPhone;
  const to=companyCarrierAddress(subject.shippingAddress || subject.address,subject.buyer || subject.customerName);
  if(!from.line1 || !from.city || !from.state || !from.postalCode)failure('Add a complete company or warehouse ship-from address before requesting rates.',409);
  if(!to.line1 || !to.city || !to.state || !to.postalCode)failure('Add a complete customer ship-to address before requesting rates.',409);
  const preference=await store.companyCarrierPreference(user,scope),providerIds=enabledCarriers.map(provider=>provider.id);
  let addressValidation={status:'not_available',providerId:'',address:to,message:'No enabled carrier address validator was available.'};
  if(typeof validateAddress==='function'){
    try { addressValidation=await validateAddress({address:to,providerIds,reference:subject.draftNumber || subject.orderNumber || subject.id}); }
    catch(error) { addressValidation={status:'warning',providerId:'',address:to,message:error.message || 'The address could not be validated.'}; }
  }
  const validatedTo=companyCarrierAddress(addressValidation?.address || to,subject.buyer || subject.customerName);
  if(!validatedTo.phone)validatedTo.phone=to.phone;
  const quotedAt=new Date().toISOString(),ttlExpiry=Date.now()+Number(preference.rateTtlMinutes || 30)*60_000;
  const items=Array.isArray(subject.items)?subject.items:[];
  const quoteInput={package:packageInfo,from,to:validatedTo,reference:subject.draftNumber || subject.orderNumber || subject.id,
    items:items.map(item=>({sku:item.sku,title:item.title,qty:item.qty || item.quantity,price:item.price})),
    itemValue:Number(subject.subtotal || subject.total || items.reduce((sum,item)=>sum+Number(item.price || 0)*Number(item.qty || item.quantity || 0),0)),currency:String(subject.currency || 'USD'),sellerDisplayName:settings.organizationName};
  const settled=await Promise.all(enabledCarriers.map(async provider=>{
    try { return {provider,result:await adapters[provider.id](quoteInput)}; }
    catch(error) { return {provider,error:error.message || `${provider.name} did not return rates.`}; }
  }));
  const providerErrors=[],rates=[];
  for(const entry of settled){
    if(entry.error){providerErrors.push({providerId:entry.provider.id,provider:entry.provider.name,message:entry.error});continue;}
    const sourceRates=Array.isArray(entry.result?.rates)?entry.result.rates:[];
    for(const [index,rate] of sourceRates.entries()){
      const amount=Number(rate.amount);if(!Number.isFinite(amount) || amount<=0)continue;
      const sourceExpiry=Date.parse(String(rate.expiresAt || ''));
      const expiresAt=new Date(Number.isFinite(sourceExpiry) && sourceExpiry>Date.now()?Math.min(sourceExpiry,ttlExpiry):ttlExpiry).toISOString();
      rates.push({id:`${entry.provider.id}:${String(rate.serviceCode || rate.service || rate.id || index).toLowerCase().replace(/[^a-z0-9]+/g,'-')}:${index}`,
        provider:entry.provider.id,providerId:entry.provider.id,providerName:entry.provider.name,carrier:String(rate.carrier || entry.provider.name),
        service:String(rate.service || 'Shipping'),serviceCode:String(rate.serviceCode || rate.serviceType || ''),amount,currency:String(rate.currency || 'USD'),
        deliveryDays:Number(rate.deliveryDays || 0) || null,deliveryEstimate:String(rate.deliveryEstimate || rate.deliveryDate || ''),warning:String(rate.warning || ''),
        quotedAt:String(rate.quotedAt || quotedAt),expiresAt});
    }
  }
  const preferred=preference.selectionMode==='preferred_carrier'?preference.preferredProviderId:'';
  rates.sort((left,right)=>((preferred && left.providerId===preferred)?0:(preferred?1:0))-((preferred && right.providerId===preferred)?0:(preferred?1:0)) || left.amount-right.amount || left.service.localeCompare(right.service));
  return {warehouse:warehouse?{id:warehouse.id,name:warehouse.name}:null,package:packageInfo,rates,providerErrors,preference,addressValidation:{...addressValidation,address:validatedTo},from,to:validatedTo};
}
async function companyCompetitorCatalogMatches({ store, user, scope, service, extracted }) {
  if (!service) failure('Competitor product lookup is temporarily unavailable.',503);
  const terms=[...new Set([extracted?.gtin,extracted?.sku,extracted?.mpn].map(value=>String(value || '').trim()).filter(Boolean))];
  const pages=await Promise.all(terms.map(term=>store.catalog(user,scope,term,1,false)));
  const rows=[],seen=new Set();
  for(const page of pages)for(const row of page.rows || []){
    const key=String(row.product_id || row.company_sku || row.source_sku || '').toLowerCase();
    if(!key || seen.has(key))continue;seen.add(key);rows.push(row);
  }
  return service.matchCatalogCandidates(extracted,rows);
}

function createCompanyOperationsHandler({ store, selection, sendJson, sendHtml, parseBody, normalizeDraft, buildOrder, exportDraft, quoteUps, quoteUsps, quoteVeeqo, purchaseUps, validateAddress, competitorProducts, competitorInspectOptions, createCompetitorDraftProduct, attachmentRoot }) {
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
      if(method==='GET' && p==='/api/quote-terms')return ok({quoteTerms:normalizeQuoteTermLibrary((await read()).quoteTerms),companyOwned:true});
      if(method==='PUT' && p==='/api/quote-terms'){
        const body=await parseBody(req),quoteTerms=companyQuoteTermLibrary(body.quoteTerms);
        return ok(await mutate('company_quote_terms_saved',data=>{data.quoteTerms=quoteTerms;return {quoteTerms,companyOwned:true,message:'Quote terms saved.'};}));
      }
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
      if(method==='GET' && parts[1]==='order-drafts' && parts[2]==='import-match' && parts.length===3) {
        const source=String(url.searchParams.get('source') || '').trim(),reference=String(url.searchParams.get('reference') || '').trim();
        if(!source || !reference)failure('Choose an import source and reference.');
        const draft=importedCompanyDraftMatch((await read()).orderDrafts,source,reference);
        return ok({exists:Boolean(draft),draft});
      }
      if(method==='POST' && parts[1]==='order-drafts' && parts[2]==='import-matches' && parts.length===3) {
        const body=await parseBody(req),source=String(body.source || '').trim(),references=Array.isArray(body.references)?body.references.slice(0,100):[];
        if(!source || !references.length)failure('Choose an import source and at least one reference.');
        return ok({matches:importedCompanyDraftMatches((await read()).orderDrafts,source,references)});
      }
      if(method==='GET' && parts[1]==='order-drafts' && parts.length===3) {
        const data=await read(),draft=data.orderDrafts.find(d=>d.id===parts[2] || d.draftNumber===parts[2]);
        if(!draft)failure('Draft not found.',404);
        const resolvedItems=await resolveCompanyDraftCatalogLines({store,user,scope,items:draft.items});
        return ok({draft:{...draft,items:resolvedItems},warehouses:data.warehouses,quoteTerms:normalizeQuoteTermLibrary(data.quoteTerms),carriers:await store.companyCarrierAccess(user,scope),carrierPreference:await store.companyCarrierPreference(user,scope)});
      }
      if(method==='POST' && parts[1]==='order-drafts' && parts[3]==='competitor-product' && ['inspect','create'].includes(parts[4]) && parts.length===5) {
        const data=await read(),draft=data.orderDrafts.find(d=>d.id===parts[2] || d.draftNumber===parts[2]);
        if(!draft)failure('Draft not found.',404);
        if(!competitorProducts)failure('Competitor product lookup is temporarily unavailable.',503);
        const body=await parseBody(req),scopeKey=`${scope.tenantId}:${scope.companyId}:${user.id}:${draft.id}`;
        if(parts[4]==='inspect'){
          const inspectOptions=typeof competitorInspectOptions==='function'?await competitorInspectOptions({user,scope,company}):{};
          const inspection=body.extractedProduct && typeof body.extractedProduct==='object'
            ? competitorProducts.registerExtractedProduct(body.extractedProduct,{scopeKey,sourceUrl:body.url})
            : await competitorProducts.inspectCompetitorUrl(body.url,{scopeKey,...inspectOptions});
          const matches=await companyCompetitorCatalogMatches({store,user,scope,service:competitorProducts,extracted:inspection.product});
          return ok({inspectionId:inspection.inspectionId,sourceUrl:inspection.sourceUrl,sourceHost:inspection.sourceHost,inspectedAt:inspection.inspectedAt,expiresAt:inspection.expiresAt,
            extractionProvider:inspection.extractionProvider,providerWarning:inspection.providerWarning,product:inspection.product,matches,confirmedMatchCount:matches.filter(match=>match.confirmedIdentifier).length,
            message:matches.length?`${matches.length} possible catalog match${matches.length===1?'':'es'} found.`:'No catalog SKU matched the product identifiers.'});
        }
        if(body.confirmNoMatch!==true)failure('Confirm that none of the suggested catalog SKUs match this product.');
        if(typeof createCompetitorDraftProduct!=='function')failure('Draft SKU creation is temporarily unavailable.',503);
        const inspection=competitorProducts.readInspection(body.inspectionId,scopeKey);
        const matches=await companyCompetitorCatalogMatches({store,user,scope,service:competitorProducts,extracted:inspection.product});
        if(matches.some(match=>match.confirmedIdentifier))failure('A catalog SKU matches this UPC or GTIN. Use the matching SKU instead.',409);
        const product=await createCompetitorDraftProduct({inspection,overrides:body.product || {},actor:user.name || user.id});
        await store.selectProduct(user,scope,{productId:product.id,sku:product.sku,status:'draft'});
        return ok({product:{...competitorProducts.candidateProjection(product),status:product.status,catalogReviewStatus:product.catalogReviewStatus,sharedCatalog:true},
          message:`${product.sku} was created as a shared draft SKU and selected for ${company.name}.`});
      }
      if(method==='GET' && parts[1]==='order-drafts' && parts[3]==='supplier-options' && parts.length===4) {
        const data=await read(),draft=data.orderDrafts.find(d=>d.id===parts[2] || d.draftNumber===parts[2]);
        if(!draft)failure('Draft not found.',404);
        const sku=String(url.searchParams.get('sku') || '').trim();
        if(!sku)failure('Choose a quote line SKU.');
        const result=await companyQuoteSupplierOptions({store,user,scope,sku});
        return ok({sku,product:result.productProjection,options:result.options,lowestCost:result.lowestCost,mapPrice:null,listPrice:null,costScope:'company'});
      }
      if(method==='GET' && parts[1]==='order-drafts' && parts[3]==='export' && parts.length===5) {
        const draft=(await read()).orderDrafts.find(d=>d.id===parts[2] || d.draftNumber===parts[2]);
        if(!draft)failure('Draft not found.',404);
        if(typeof exportDraft!=='function')failure('Quote exports are temporarily unavailable.',503);
        await exportDraft(res,{...draft,companyProfile:companySystemSettings(company)},parts[4],String(url.searchParams.get('variant') || 'standard').toLowerCase());
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
      if(method==='POST' && parts[1]==='order-drafts' && parts[3]==='shipping-rates' && parts.length===4) {
        const data=await read(),draft=data.orderDrafts.find(row=>row.id===parts[2] || row.draftNumber===parts[2]);
        if(!draft)failure('Draft not found.',404);
        const result=await requestCompanyCarrierRates({store,user,scope,company,data,subject:draft,input:await parseBody(req),quoteUps,quoteUsps,quoteVeeqo,validateAddress});
        const labelPurchase=result.rates.some(rate=>rate.provider==='ups' && rate.serviceCode);
        return ok({...result,labelPurchase});
      }
      if(method==='POST' && p==='/api/order-drafts') {
        const input=draftInput(await parseBody(req));
        if(input.items){input.items=await resolveCompanyDraftCatalogLines({store,user,scope,items:input.items});input.items=await hydrateCompanyDraftSupplierSelections({store,user,scope,items:input.items});}
        return ok(await mutate('draft_created',data=>{const importReference=String(input.marketplaceOrderNumber || '').trim(),importSource=String(input.source || '').trim().toLowerCase();const existing=importReference && importSource==='buysupply dw rfq' ? importedCompanyDraftMatch(data.orderDrafts,importSource,importReference) : null;if(existing)return {draft:existing,duplicate:true};const terms=companyDraftTermSelection(data,input.selectedTermIds,[],input.selectedTermIds===undefined),createdAt=new Date().toISOString(),actor=user.name || user.id || 'DataPlus user';const draft=normalizeDraft(data,{...input,...terms,status:'draft',salesOwner:input.salesOwner || actor,expiresAt:input.expiresAt || defaultQuoteExpiration(30),statusChangedAt:createdAt,statusChangedBy:actor,quoteActivity:[companyQuoteActivityEvent('','draft',actor,createdAt,'created')],createdAt,updatedAt:createdAt});data.orderDrafts.unshift(draft);return {draft,duplicate:false};}));
      }
      if(parts[1]==='order-drafts' && ((method==='PATCH' && parts.length===3) || (method==='POST' && parts.length===4 && ['duplicate','convert'].includes(parts[3])))) {
        const input=method==='PATCH'?draftInput(await parseBody(req)):{};
        if(input.items){input.items=await resolveCompanyDraftCatalogLines({store,user,scope,items:input.items});input.items=await hydrateCompanyDraftSupplierSelections({store,user,scope,items:input.items});}
        return ok(await mutate('draft_'+(parts[3] || 'updated'),data=>{
          const draft=data.orderDrafts.find(d=>d.id===parts[2]);if(!draft)failure('Draft not found.',404);
          if(parts[3]==='convert') {
            if(draft.convertedOrderId)return {order:data.orders.find(o=>o.id===draft.convertedOrderId)};
            if(!draft.items.length)failure('Draft has no line items.');
            assertFreshCompanyRate(draft);
            const order=buildOrder(data,draft,user.name || user.id);
            order.companyId=scope.companyId;order.tenantId=scope.tenantId;
            data.orders.unshift(order);draft.convertedOrderId=order.id;draft.status='converted';return {order};
          }
          if(parts[3]==='duplicate') {
            const group=draft.quoteGroupId || draft.id;
            const revision=Math.max(0,...data.orderDrafts.filter(d=>(d.quoteGroupId || d.id)===group).map(d=>Number(d.revisionNumber || 1)))+1;
            const duplicatedAt=new Date().toISOString(),actor=user.name || user.id || 'DataPlus user';
            const duplicate=normalizeDraft(data,{...draft,id:crypto.randomUUID(),draftNumber:'',quoteGroupId:group,parentDraftId:draft.id,revisionNumber:revision,marketplaceOrderNumber:'',convertedOrderId:undefined,createdAt:duplicatedAt,updatedAt:duplicatedAt,status:'draft',nextAction:'Review quote revision',nextFollowUpAt:'',statusChangedAt:duplicatedAt,statusChangedBy:actor,quoteActivity:[companyQuoteActivityEvent('','draft',actor,duplicatedAt,'revision_created')],expiresAt:defaultQuoteExpiration(30),shippingEstimate:null});data.orderDrafts.unshift(duplicate);return {draft:duplicate};
          }
          if(draft.convertedOrderId)failure('This draft has already been converted.');
          const changesShippingBasis=companyShippingBasisChanged(draft,input);
          const terms=input.selectedTermIds===undefined?{selectedTermIds:draft.selectedTermIds,selectedTermsSnapshot:draft.selectedTermsSnapshot}:companyDraftTermSelection(data,input.selectedTermIds,draft.selectedTermsSnapshot);
          const updatedAt=new Date().toISOString(),actor=user.name || user.id || 'DataPlus user',statusChanged=input.status!==undefined && input.status!==draft.status;
          const quoteActivity=Array.isArray(draft.quoteActivity)?draft.quoteActivity.slice(-99):[];
          if(statusChanged)quoteActivity.push(companyQuoteActivityEvent(draft.status,input.status,actor,updatedAt));
          const next={...draft,...input,...terms,statusChangedAt:statusChanged?updatedAt:draft.statusChangedAt,statusChangedBy:statusChanged?actor:draft.statusChangedBy,quoteActivity,updatedAt};
          if(changesShippingBasis && input.shippingEstimate===undefined)next.shippingEstimate=null;
          if(input.status==='accepted')assertFreshCompanyRate(next);
          Object.assign(draft,normalizeDraft(data,next));return {draft};
        }));
      }
      if(method==='GET' && parts[1]==='orders' && parts.length===3) {
        const order=(await read()).orders.find(o=>o.id===parts[2] || o.orderNumber===parts[2]);
        if(!order)failure('Order not found.',404);return ok({order,inventory:[],warehouses:(await read()).warehouses,purchaseOrders:[],customer:null});
      }
      if(method==='POST' && parts[1]==='orders' && parts[3]==='shipping' && parts[4]==='rates' && parts.length===5) {
        const data=await read(),order=data.orders.find(row=>row.id===parts[2] || row.orderNumber===parts[2]);
        if(!order)failure('Order not found.',404);
        const input=await parseBody(req);
        const result=await requestCompanyCarrierRates({store,user,scope,company,data,subject:order,input,quoteUps,quoteUsps,quoteVeeqo,validateAddress});
        const ratedAt=new Date().toISOString(),requestedRouteIds=new Set((Array.isArray(input.routeIds)?input.routeIds:[]).map(String).filter(Boolean));
        const routeIds=Array.from({length:companyOrderLineCount(order)},(_,index)=>`company-route:${order.id}:${index}`).filter(routeId=>!requestedRouteIds.size || requestedRouteIds.has(routeId));
        const rateReview={source:'company_order',rowStatus:result.rates.length?'rated':'failed',selectedRate:null,rates:result.rates,package:result.package,
          warehouseId:result.warehouse?.id || '',warehouseName:result.warehouse?.name || '',ratedAt,attemptedAt:ratedAt,error:result.rates.length?'':result.providerErrors.map(entry=>`${entry.provider}: ${entry.message}`).join(' ')};
        const packageValues={packageWeight:result.package.weight,packageLength:result.package.length,packageWidth:result.package.width,packageHeight:result.package.height,
          weightUnit:result.package.weightUnit,dimensionUnit:result.package.dimensionUnit,packageType:result.package.type};
        await mutate('company_shipping_rates_loaded',state=>{const current=state.orders.find(row=>row.id===order.id);if(!current)failure('Order not found.',404);
          current.package=packageValues;current.fulfillmentPackage=packageValues;current.fulfillmentWarehouseId=result.warehouse?.id || current.fulfillmentWarehouseId || '';
          current.shippingRateReview=rateReview;current.companyFulfillment=current.companyFulfillment || {};
          for(const routeId of routeIds)current.companyFulfillment[routeId]={...(current.companyFulfillment[routeId] || {}),warehouseId:result.warehouse?.id || '',warehouseName:result.warehouse?.name || '',package:packageValues,shippingRateReview:rateReview,updatedAt:ratedAt,updatedBy:user.id};
          current.updatedAt=ratedAt;return {order:current};});
        return ok({...result,rates:rateReview.rates,rateReview,warehouseId:rateReview.warehouseId,warehouseName:rateReview.warehouseName,
          blockers:[],packagePresets:[],labelRules:companyRateRules(data),message:result.rates.length?'Shipping rates loaded for this BuySupply order.':'No shipping rates were returned.'});
      }
      if(method==='PATCH' && parts[1]==='fulfillment' && parts[2]==='rates' && parts[3] && parts.length===4) {
        const input=await parseBody(req),routeId=decodeURIComponent(parts[3]),selectedRateId=customerString(input.selectedRateId);
        return ok(await mutate('company_shipping_rate_selected',data=>{const order=data.orders.find(row=>routeId.startsWith(`company-route:${row.id}:`));if(!order)failure('Shipment route not found.',404);
          const review=order.companyFulfillment?.[routeId]?.shippingRateReview || order.shippingRateReview;if(!review)failure('Load current shipping rates first.',409);
          const selectedRate=(review.rates || []).find(rate=>String(rate.id)===selectedRateId);if(!selectedRate)failure('Choose a current shipping rate.',409);
          if(Date.parse(String(selectedRate.expiresAt || ''))<=Date.now())failure('This shipping rate expired. Refresh rates before buying a label.',409);
          const nextReview={...review,selectedRate};order.shippingRateReview=nextReview;order.companyFulfillment=order.companyFulfillment || {};
          for(const selectedRouteId of (Array.isArray(input.routeIds)&&input.routeIds.length?input.routeIds:[routeId]))if(order.companyFulfillment[selectedRouteId])order.companyFulfillment[selectedRouteId]={...order.companyFulfillment[selectedRouteId],shippingRateReview:nextReview,updatedAt:new Date().toISOString(),updatedBy:user.id};
          order.updatedAt=new Date().toISOString();return {rateReview:nextReview,affectedOrderIds:[order.id]};}));
      }
      if(method==='POST' && parts[1]==='orders' && parts[3]==='shipping' && parts[4]==='labels' && parts.length===5) {
        if(typeof purchaseUps!=='function')failure('UPS label purchase is temporarily unavailable.',503);
        const input=await parseBody(req),snapshot=await read(),order=snapshot.orders.find(row=>row.id===parts[2] || row.orderNumber===parts[2]);
        if(!order)failure('Order not found.',404);
        const provider=customerString(input.provider || input.rate?.provider || input.rate?.providerId).toLowerCase();
        const carrierAccess=(await store.companyCarrierAccess(user,scope)).find(row=>row.id===provider);
        if(!carrierAccess?.enabled || !carrierAccess.companyLabels)failure(`${provider?provider.toUpperCase():'This carrier'} is not enabled to buy labels for ${company.name}.`,403);
        if(provider!=='ups')failure('Direct company label purchase is currently available through UPS.',409);
        const review=order.shippingRateReview || {},requestedRateId=customerString(input.rate?.id),rate=(review.rates || []).find(row=>String(row.id)===requestedRateId);
        if(!rate || rate.provider!=='ups' || !rate.serviceCode)failure('Load a current UPS rate and choose a service before buying the label.',409);
        if(Date.parse(String(rate.expiresAt || ''))<=Date.now())failure('This UPS rate expired. Refresh rates before buying the label.',409);
        const rules=companyRateRules(snapshot);
        if(rules.maxCost>0 && Number(rate.amount)>rules.maxCost && rules.requireConfirmationAboveMax && input.confirmAboveMaxCost!==true)failure(`This label is $${Number(rate.amount).toFixed(2)} and exceeds the configured max of $${rules.maxCost.toFixed(2)}. Confirm the over-limit purchase to continue.`,409);
        const packageInfo=companyQuotePackage(input),warehouse=snapshot.warehouses.find(row=>String(row.id)===String(input.warehouseId || review.warehouseId))
          || snapshot.warehouses.find(row=>row.status!=='inactive' && row.isDefaultReceiving) || snapshot.warehouses.find(row=>row.status!=='inactive' && row.isPhysical!==false) || null;
        const settings=companySystemSettings(company),from=companyCarrierAddress(warehouse || settings.organizationAddress,warehouse?.name || settings.organizationName),to=companyCarrierAddress(order.shippingAddress || order.address,order.buyer || order.customerName);
        if(!from.phone)from.phone=settings.organizationPhone;
        if(!to.phone)to.phone=customerString(order.phone || order.customerPhone);
        const validRouteIds=Array.from({length:companyOrderLineCount(order)},(_,index)=>`company-route:${order.id}:${index}`),requestedRouteIds=(Array.isArray(input.routeIds)?input.routeIds:[]).map(String);
        if(requestedRouteIds.some(routeId=>!validRouteIds.includes(routeId)))failure('Shipment route not found for this order.',404);
        const routeIds=requestedRouteIds.length?requestedRouteIds:validRouteIds;
        const purchaseKey=crypto.createHash('sha256').update(JSON.stringify([order.id,rate.id,packageInfo,routeIds])).digest('hex');
        const existing=(order.shipments || []).find(row=>row.purchaseKey===purchaseKey && row.status!=='voided');
        if(existing){const document=(order.documents || []).find(row=>row.id===existing.documents?.[0]?.documentId);return ok({order,shipment:existing,document,message:'This UPS label was already purchased and is ready to print.'});}
        await mutate('company_label_purchase_started',data=>{const current=data.orders.find(row=>row.id===order.id);if(!current)failure('Order not found.',404);
          const active=current.companyLabelPurchase;if(active?.status==='purchasing' && active.purchaseKey!==purchaseKey && Date.now()-Date.parse(active.startedAt || 0)<120000)failure('Another label purchase is already running for this order.',409);
          if(active?.status==='purchasing' && active.purchaseKey===purchaseKey && Date.now()-Date.parse(active.startedAt || 0)<120000)failure('This label purchase is already running.',409);
          current.companyLabelPurchase={purchaseKey,status:'purchasing',startedAt:new Date().toISOString(),startedBy:user.id};return {order:current};});
        let purchased;
        try { purchased=await purchaseUps({from,to,package:packageInfo,reference:order.orderNumber || order.id,description:`${company.name} order ${order.orderNumber || ''}`,
          serviceCode:rate.serviceCode,residential:input.residential!==false,sellerDisplayName:settings.organizationName}); }
        catch(error){await mutate('company_label_purchase_failed',data=>{const current=data.orders.find(row=>row.id===order.id);if(current)current.companyLabelPurchase={purchaseKey,status:'failed',failedAt:new Date().toISOString(),error:customerString(error.message).slice(0,1000)};return {order:current};}).catch(()=>{});throw Object.assign(error,{statusCode:502});}
        const directory=companyAttachmentDirectory(attachmentRoot,scope);fs.mkdirSync(directory,{recursive:true});
        const documentId=crypto.randomUUID(),storageKey=`${documentId}.gif`,filePath=path.join(directory,storageKey);fs.writeFileSync(filePath,purchased.content);
        const now=new Date().toISOString(),shipmentId=crypto.randomUUID();
        const saved=await mutate('company_ups_label_purchased',data=>{const current=data.orders.find(row=>row.id===order.id);if(!current)failure('Order not found.',404);
          const document={id:documentId,name:`UPS label ${current.orderNumber || current.id}.gif`,type:'shipping_label',note:`UPS ${rate.service}`,
            mimeType:'image/gif',size:purchased.content.length,storage:'company_local',storageKey,url:`/api/orders/${encodeURIComponent(current.id)}/attachments/${documentId}`,createdAt:now,createdBy:user.name || user.id};
          const shipment={id:shipmentId,reference:`${current.orderNumber || current.id}-UPS${(current.shipments || []).length+1}`,status:'label_purchased',trackingStatus:'awaiting_pickup',provider:'ups',labelProvider:'UPS',purchaseOrigin:'dataplus_company',
            carrier:'UPS',carrierName:'UPS',service:purchased.service || rate.service,serviceCode:rate.serviceCode,trackingNumber:purchased.trackingNumber || '',shippingCost:Number(purchased.amount || rate.amount),currency:purchased.currency || rate.currency || 'USD',
            package:packageInfo,packages:[{id:crypto.randomUUID(),...packageInfo}],lines:Array.isArray(input.lines)?input.lines:[],warehouseId:warehouse?.id || '',warehouseName:warehouse?.name || '',routeIds,purchaseKey,
            documents:[{url:document.url,format:'GIF',documentType:'shipping_label',documentId}],upsShipmentIdentificationNumber:purchased.shipmentIdentificationNumber || '',upsTransactionId:purchased.transactionId || '',createdAt:now};
          current.documents=[document,...(Array.isArray(current.documents)?current.documents:[])];current.shipments=[shipment,...(Array.isArray(current.shipments)?current.shipments:[])];
          current.shippingCarrier='UPS';current.trackingNumber=shipment.trackingNumber;current.companyFulfillment=current.companyFulfillment || {};
          const selectedReview={...(current.shippingRateReview || review),selectedRate:rate};current.shippingRateReview=selectedReview;
          for(const routeId of routeIds)current.companyFulfillment[routeId]={...(current.companyFulfillment[routeId] || {}),status:'label_purchased',shippingRateReview:selectedReview,shipmentId,updatedAt:now,updatedBy:user.id};
          current.timeline=[{id:crypto.randomUUID(),type:'shipping_label',title:'UPS shipping label purchased',message:`UPS ${shipment.service}${shipment.trackingNumber?` tracking ${shipment.trackingNumber}`:''}.`,createdAt:now,user:user.name || user.id},...(Array.isArray(current.timeline)?current.timeline:[])];
          current.companyLabelPurchase={purchaseKey,status:'purchased',shipmentId,purchasedAt:now,purchasedBy:user.id};current.updatedAt=now;return {order:current,document,shipment};});
        return ok({...saved,message:'UPS label purchased and ready to print.'});
      }
      if(method==='GET' && parts[1]==='orders' && parts[3]==='attachments' && parts[4] && parts.length===5) {
        const order=(await read()).orders.find(row=>row.id===parts[2] || row.orderNumber===parts[2]);if(!order)failure('Order not found.',404);
        const document=(order.documents || []).find(row=>String(row.id)===String(parts[4]) && row.storage==='company_local');if(!document?.storageKey)failure('Label document not found.',404);
        const filePath=path.join(companyAttachmentDirectory(attachmentRoot,scope),path.basename(String(document.storageKey)));if(!fs.existsSync(filePath))failure('The label file is no longer available.',404);
        res.writeHead(200,{'Content-Type':document.mimeType || 'application/octet-stream','Content-Length':fs.statSync(filePath).size,'Content-Disposition':`inline; filename="${String(document.name || 'shipping-label').replace(/["\r\n]/g,'')}"`,'Cache-Control':'private, max-age=3600'});
        fs.createReadStream(filePath).pipe(res);return true;
      }
      if(method==='GET' && parts[1]==='orders' && parts[3]==='shipments' && parts[4] && parts[5]==='print-packet.pdf' && parts.length===6) {
        const order=(await read()).orders.find(row=>row.id===parts[2] || row.orderNumber===parts[2]);if(!order)failure('Order not found.',404);
        const shipment=(order.shipments || []).find(row=>String(row.id)===String(parts[4]));if(!shipment)failure('Shipment not found.',404);
        const document=(order.documents || []).find(row=>String(row.id)===String(shipment.documents?.[0]?.documentId));if(!document?.storageKey)failure('This shipment has no printable label.',409);
        const filePath=path.join(companyAttachmentDirectory(attachmentRoot,scope),path.basename(String(document.storageKey)));if(!fs.existsSync(filePath))failure('The label file is no longer available.',404);
        res.writeHead(200,{'Content-Type':document.mimeType || 'image/gif','Content-Length':fs.statSync(filePath).size,'Content-Disposition':`inline; filename="${String(document.name || 'shipping-label').replace(/["\r\n]/g,'')}"`,'Cache-Control':'private, no-store'});
        fs.createReadStream(filePath).pipe(res);return true;
      }
      if(method==='GET' && parts[1]==='orders' && ['invoice.pdf','invoice-email.eml'].includes(parts[3]) && parts.length===4) {
        const order=(await read()).orders.find(row=>row.id===parts[2] || row.orderNumber===parts[2]);if(!order)failure('Order not found.',404);
        const profile=companySystemSettings(company),pdf=await buildInvoicePdf(order,profile),reference=safeFileName(order.orderNumber || order.id || 'order','order');
        if(parts[3]==='invoice-email.eml'){
          const message=invoiceEmailContent(order,orderCompanyProfile(profile).name),email=buildOutlookDraft({...message,attachmentName:`invoice-${reference}.pdf`,attachment:pdf});
          res.writeHead(200,{'Content-Type':'message/rfc822','Content-Length':email.length,'Content-Disposition':`attachment; filename="invoice-${reference}-outlook.eml"`,'Cache-Control':'private, no-store'});res.end(email);return true;
        }
        res.writeHead(200,{'Content-Type':'application/pdf','Content-Length':pdf.length,'Content-Disposition':`inline; filename="invoice-${reference}.pdf"`,'Cache-Control':'private, no-store'});res.end(pdf);return true;
      }
      if(method==='POST' && parts[1]==='orders' && parts[3]==='shipments' && parts[4] && parts[5]==='printed' && parts.length===6) {
        return ok(await mutate('company_shipping_label_printed',data=>{const order=data.orders.find(row=>row.id===parts[2] || row.orderNumber===parts[2]);if(!order)failure('Order not found.',404);
          const shipment=(order.shipments || []).find(row=>String(row.id)===String(parts[4]));if(!shipment)failure('Shipment not found.',404);
          const now=new Date().toISOString();shipment.status='label_printed';shipment.labelPrintCount=Number(shipment.labelPrintCount || 0)+1;shipment.lastPrintedAt=now;shipment.firstPrintedAt=shipment.firstPrintedAt || now;shipment.printedBy=user.name || user.id;
          order.companyFulfillment=order.companyFulfillment || {};for(const routeId of shipment.routeIds || [])order.companyFulfillment[routeId]={...(order.companyFulfillment[routeId] || {}),status:'shipped',shipmentId:shipment.id,updatedAt:now,updatedBy:user.id};
          const allShipped=Array.from({length:companyOrderLineCount(order)},(_,index)=>order.companyFulfillment[`company-route:${order.id}:${index}`]).every(route=>TERMINAL_FULFILLMENT.has(String(route?.status || '').toLowerCase()));
          if(allShipped){order.operationalStatus='shipped';order.status='shipped';order.shippedAt=order.shippedAt || now;}order.updatedAt=now;
          return {order,shipment,message:`Label print recorded${shipment.trackingNumber?` for ${shipment.trackingNumber}`:''}.`};}));
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
      if(method==='GET' && p==='/api/fulfillment/console'){
        const carriers=await store.companyCarrierAccess(user,scope),result=companyFulfillmentConsole(await read(),url);
        result.carriers=carriers;result.capabilities.carrierRates=carriers.some(provider=>provider.enabled && provider.companyRates);
        result.capabilities.orderLabelPurchase=carriers.some(provider=>provider.enabled && provider.companyLabels && (provider.id!=='ups' || typeof purchaseUps==='function'));
        return ok(result);
      }
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
      if(['GET','POST'].includes(method) && parts[1]==='inventory' && parts[3]==='competitors' && parts.length===4) {
        const key=decodeURIComponent(parts[2]);
        if(method==='GET')return ok({...await store.competitorOffers(user,scope,key),scope});
        return ok(await store.saveCompetitorOffer(user,scope,key,await parseBody(req)));
      }
      if(method==='GET' && parts[1]==='inventory' && parts.length===3) {
        return ok({item:await companyCatalogDetail({store,user,scope,key:decodeURIComponent(parts[2])}),scope:'company',companyOwned:true});
      }
      if(method==='GET' && parts[1]==='inventory' && parts[3]==='operations' && parts.length===4) {
        const item=await companyCatalogDetail({store,user,scope,key:decodeURIComponent(parts[2])});
        return ok({item,warehouses:[],orders:[],allocations:[],stockSources:[],ledger:[],purchaseOrders:[],returns:[],health:[],channelAvailability:[],metrics:{},companyOwned:true,inventoryConnected:false});
      }
      if(method==='GET' && parts[1]==='inventory' && parts[3]==='channel-availability' && parts.length===4) {
        await companyCatalogDetail({store,user,scope,key:decodeURIComponent(parts[2])});
        return ok({availability:[],companyOwned:true,inventoryConnected:false});
      }
      if(method==='GET' && parts[1]==='inventory' && parts[3]==='suppliers' && parts.length===4) {
        const item=await companyCatalogDetail({store,user,scope,key:decodeURIComponent(parts[2])});
        const matches=(item.companyCosts || []).map(cost=>({supplier:cost.supplierName,sku:item.sku,sourceSku:item.sourceSku,cost:cost.cost,uom:cost.uom,matchType:'primary',matchStatus:'approved',stockStatus:'Not reported'}));
        return ok({matchType:matches.length?'primary':'none',supplierCount:matches.length,pendingReviewCount:0,matches,relatedSkuCount:0,relatedSkus:[],companyOwned:true,inventoryConnected:false});
      }
      if(method==='GET' && p==='/api/inventory') {
        const catalog=await store.catalog(user,scope,url.searchParams.get('q') || '',Number(url.searchParams.get('page') || 1));
        return ok({inventory:catalog.rows.map(p=>({id:p.product_id,sku:p.company_sku || p.source_sku,sourceSku:p.source_sku,title:p.title,barcode:p.barcode,brand:p.brand,manufacturer:p.manufacturer,mfrPartNumber:p.mfr_part_number,defaultImage:p.default_image,uom:p.uom,status:p.company_status || (p.selected?'draft':'shared'),supplier:p.company_suppliers || '',cost:p.company_cost === null || p.company_cost === undefined ? null : Number(p.company_cost),mapPrice:null,qty:null,reserved:null,available:null,inventoryConnected:false,price:p.sell_price === null || p.sell_price === undefined ? null : Number(p.sell_price)})),hasMore:catalog.hasMore});
      }
      // No fallthrough into LINQ's global databases, settings, queues, or channel credentials.
      failure(`${company.name} has not enabled ${method} ${p} yet. No LINQ data was accessed.`,409);
    } catch(error) { sendJson(res,error.statusCode || 500,{error:error.statusCode?error.message:'Unable to load this company workspace.'});return true; }
  };
}
module.exports={createCompanyOperationsHandler,draftInput};
