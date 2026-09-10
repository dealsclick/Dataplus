const crypto = require('node:crypto');
const { LEGACY_TENANT, LEGACY_COMPANY } = require('./company-workspaces');
const emptyState = () => ({ orders: [], orderDrafts: [], returns: [], customers: [], connections: [], warehouses: [], inventory: [], purchaseOrders: [], suppliers: [], vendors: [], brands: [], sequence: {}, orderViews: [] });
const failure = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
function draftInput(input) {
  const result = {};
  for (const key of ['source','buyer','buyerEmail','phone','marketplaceOrderNumber','note']) {
    if (input[key] !== undefined) { if(typeof input[key] !== 'string' || input[key].length > 4000) failure(`Invalid ${key}.`); result[key] = input[key]; }
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
      const qty=Number(item.qty), price=Number(item.price);
      if(!Number.isFinite(qty) || qty <= 0 || qty > 1000000 || !Number.isFinite(price) || price < 0 || price > 100000000) failure('Enter valid quantities and prices.');
      return {sku:item.sku.trim(), title:String(item.title || item.sku).slice(0,1000), qty, price, cost:null};
    });
  }
  return result;
}
function createCompanyOperationsHandler({ store, selection, sendJson, parseBody, normalizeDraft, buildOrder }) {
  return async (req,res,url,user) => {
    const scope=selection(req);
    if(!scope || (scope.tenantId===LEGACY_TENANT && scope.companyId===LEGACY_COMPANY)) return false;
    const ok=data => {sendJson(res,200,data); return true;};
    try {
      const company=await store.authorize(user,scope);
      const p=url.pathname, parts=p.split('/').filter(Boolean), method=req.method;
      const read=async()=>({...emptyState(),...await store.operationalState(user,scope)});
      const mutate=(action,work)=>store.updateOperationalState(user,scope,action,data=>{for(const [key,value] of Object.entries(emptyState()))data[key]??=value;return work(data);});
      if(method==='GET' && p==='/api/state') return ok({...await read(),systemSettings:{organizationName:company.name},company:{id:company.id,name:company.name},ordersLoaded:true});
      if(method==='GET' && p==='/api/import-jobs') return ok({importJobs:[],activeJobs:[],total:0,page:1,limit:10,workerStatus:{},companyId:company.id});
      if(method==='GET' && p==='/api/import-jobs/progress') return ok({jobs:[],total:0,page:1,companyId:company.id});
      if(method==='GET' && p==='/api/orders') {
        const data=await read(),q=(url.searchParams.get('q') || '').toLowerCase();
        const orders=data.orders.filter(o=>!q || [o.orderNumber,o.buyer,...o.items.map(i=>i.sku)].join(' ').toLowerCase().includes(q));
        return ok({orders,orderDrafts:data.orderDrafts.filter(d=>!d.convertedOrderId),returns:data.returns,customers:data.customers,ordersLoaded:true,metrics:{totalOrders:data.orders.length},scope:'company',storage:'postgres',limit:5000});
      }
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
      if(method==='POST' && p==='/api/order-drafts') {
        const input=draftInput(await parseBody(req));
        return ok(await mutate('draft_created',data=>{const draft=normalizeDraft(data,{...input,status:'draft'});data.orderDrafts.unshift(draft);return {draft};}));
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
            const duplicate=normalizeDraft(data,{...draft,id:crypto.randomUUID(),draftNumber:'',createdAt:new Date().toISOString(),status:'draft'});data.orderDrafts.unshift(duplicate);return {draft:duplicate};
          }
          if(draft.convertedOrderId)failure('This draft has already been converted.');
          Object.assign(draft,normalizeDraft(data,{...draft,...input,updatedAt:new Date().toISOString()}));return {draft};
        }));
      }
      if(method==='GET' && parts[1]==='orders' && parts.length===3) {
        const order=(await read()).orders.find(o=>o.id===parts[2] || o.orderNumber===parts[2]);
        if(!order)failure('Order not found.',404);return ok({order,inventory:[],warehouses:[],purchaseOrders:[],customer:null});
      }
      if(method==='GET' && p==='/api/channels')return ok({channels:[],connections:[]});
      if(method==='GET' && p==='/api/warehouses')return ok({warehouses:[]});
      if(method==='GET' && p==='/api/inventory') {
        const catalog=await store.catalog(user,scope,url.searchParams.get('q') || '',Number(url.searchParams.get('page') || 1));
        return ok({inventory:catalog.rows.map(p=>({id:p.product_id,sku:p.company_sku || p.source_sku,title:p.title,barcode:p.barcode,brand:p.brand,uom:p.uom,cost:null,price:null})),hasMore:catalog.hasMore});
      }
      // No fallthrough into LINQ's global databases, settings, queues, or channel credentials.
      failure('This workflow is not yet connected to company-owned storage. No LINQ data was accessed.',409);
    } catch(error) { sendJson(res,error.statusCode || 500,{error:error.statusCode?error.message:'Unable to load this company workspace.'});return true; }
  };
}
module.exports={createCompanyOperationsHandler,draftInput};
