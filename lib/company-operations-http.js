const crypto = require('node:crypto');
const { LEGACY_TENANT, LEGACY_COMPANY } = require('./company-workspaces');
const { defaultQuoteExpiration, normalizeQuoteExpiration, normalizeQuoteTermIds } = require('./quote-documents');
const emptyState = () => ({ orders: [], orderDrafts: [], returns: [], customers: [], connections: [], warehouses: [], inventory: [], purchaseOrders: [], suppliers: [], vendors: [], brands: [], sequence: {}, orderViews: [] });
const failure = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
const customerString = value => String(value || '').trim();
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
function createCompanyOperationsHandler({ store, selection, sendJson, parseBody, normalizeDraft, buildOrder, exportDraft }) {
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
      if(method==='GET' && p==='/api/app/bootstrap') return ok({changed:true,version:companyVersion,versions:{company:companyVersion},connections:[],systemSettings:{organizationName:company.name},connectorState:{}});
      if(method==='GET' && p==='/api/app/summary') return ok({version:companyVersion,versions:{company:companyVersion},workerStatus:{},summary:null});
      if(method==='GET' && p==='/api/app/references') {
        const requested=[...new Set(String(url.searchParams.get('include') || '').split(',').map(value=>value.trim()).filter(Boolean))];
        const supported=new Set(['vendors','vendorDetails','brands','warehouses','connections','systemSettings']);
        if(!requested.length || requested.some(name=>!supported.has(name)))failure('Choose valid company references.');
        const references={changed:true,version:companyVersion,versions:Object.fromEntries(requested.map(name=>[name,companyVersion]))};
        for(const name of requested)references[name]=name==='systemSettings'?{organizationName:company.name}:[];
        return ok(references);
      }
      if(method==='GET' && p==='/api/state') return ok({...await read(),systemSettings:{organizationName:company.name},company:{id:company.id,name:company.name},ordersLoaded:true});
      if(method==='GET' && p==='/api/import-jobs') return ok({importJobs:[],activeJobs:[],total:0,page:1,limit:10,workerStatus:{},companyId:company.id});
      if(method==='GET' && p==='/api/import-jobs/progress') return ok({jobs:[],total:0,page:1,companyId:company.id});
      if(method==='GET' && p==='/api/orders') {
        const data=await read(),q=(url.searchParams.get('q') || '').toLowerCase();
        const orders=data.orders.filter(o=>!q || [o.orderNumber,o.buyer,...o.items.map(i=>i.sku)].join(' ').toLowerCase().includes(q));
        return ok({orders,orderDrafts:data.orderDrafts.filter(d=>!d.convertedOrderId),returns:data.returns,customers:data.customers,ordersLoaded:true,metrics:{totalOrders:data.orders.length},scope:'company',storage:'postgres',limit:5000});
      }
      if(method==='GET' && p==='/api/orders/references')return ok({connections:[],warehouses:[],companyId:company.id});
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
        if(!draft)failure('Draft not found.',404);return ok({draft,warehouses:[]});
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
        if(!order)failure('Order not found.',404);return ok({order,inventory:[],warehouses:[],purchaseOrders:[],customer:null});
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
      if(method==='GET' && p==='/api/channels')return ok({channels:[],connections:[]});
      if(method==='GET' && p==='/api/warehouses')return ok({warehouses:[]});
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
