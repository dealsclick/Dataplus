const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { createCompanyStore, LEGACY_TENANT: tenantId, LEGACY_COMPANY, LEGACY_COMPANY_NUMBER, BUYSUPPLY_PUBLIC_PROFILE, money } = require('../lib/company-workspaces');
const { createCompanyHandler } = require('../lib/company-http');
const {parseFile,normalize}=require('../lib/manual-order-import');
const { PDFDocument } = require('pdf-lib');
const quoteDocuments=require('../lib/quote-documents');
const serverSource=require('node:fs').readFileSync(require.resolve('../server'),'utf8');
const draftFunctions={crypto:require('node:crypto'),normalizeAddress:value=>value,...quoteDocuments,...require('../lib/product-price-floors')};
require('node:vm').createContext(draftFunctions);
for(const name of ['quoteSupplierCost','nextDraftNumber','nextOrderNumber','normalizeDraftLine','orderDraftTotals','normalizeDraftShippingEstimate','normalizeQuotePipelineStatus','normalizeQuoteActivity','normalizeOrderDraft','buildOrderFromDraft']) {
  const start=serverSource.indexOf(`function ${name}(`);
  require('node:vm').runInContext(serverSource.slice(start,serverSource.indexOf('\nfunction ',start+1)),draftFunctions);
}

test('quote totals follow edited lines, including removal of all lines',()=>{
  const db={inventory:[],sequence:{}};
  const original=draftFunctions.normalizeOrderDraft(db,{items:[{sku:'A',qty:2,price:10}],total:999});
  assert.equal(original.total,20);
  const edited=draftFunctions.normalizeOrderDraft(db,{...original,items:[{sku:'A',qty:3,price:12.5}]});
  assert.equal(edited.total,37.5);
  assert.equal(draftFunctions.normalizeOrderDraft(db,{...edited,items:[]}).total,0);
  const shipped=draftFunctions.normalizeOrderDraft(db,{...edited,shippingEstimate:{amount:8.5,service:'UPS Ground',package:{weight:5,length:10,width:8,height:6}}});
  assert.equal(shipped.subtotal,37.5);
  assert.equal(shipped.total,46);
  assert.equal(shipped.shippingEstimate.service,'UPS Ground');
});

test('quote customer messages remain separate from internal notes',()=>{
  const db={inventory:[],orders:[],orderDrafts:[],sequence:{order:1000,draft:1000}};
  const draft=draftFunctions.normalizeOrderDraft(db,{
    buyer:'Buyer',
    note:'Staff follow-up only',
    customerNote:'Pricing is valid for 14 days.',
    items:[{sku:'A',qty:1,price:10}],
  });
  assert.equal(draft.note,'Staff follow-up only');
  assert.equal(draft.customerNote,'Pricing is valid for 14 days.');
  const order=draftFunctions.buildOrderFromDraft(db,draft,'Sales user');
  assert.equal(order.notes,'Staff follow-up only');
  assert.equal(order.customerNote,'Pricing is valid for 14 days.');
});

test('quote supplier selections preserve zero cost and make unknown total cost explicit',()=>{
  const db={inventory:[],orders:[],orderDrafts:[],sequence:{order:1000,draft:1000}};
  const selected=draftFunctions.normalizeOrderDraft(db,{items:[{
    sku:'A',qty:2,price:15,priceOverridden:true,cost:0,mapPrice:12,listPrice:20,selectedSupplierKey:'vendor:one',selectedSupplierId:'one',
    selectedSupplierName:'Supplier One',selectedSupplierSku:'SUP-A',selectedSupplierUom:'Each'
  }]});
  assert.equal(selected.items[0].cost,0);
  assert.equal(selected.items[0].mapPrice,12);
  assert.equal(selected.items[0].listPrice,20);
  assert.equal(selected.items[0].msrp,20);
  assert.equal(selected.items[0].priceOverridden,true);
  assert.equal(selected.items[0].selectedSupplierName,'Supplier One');
  const order=draftFunctions.buildOrderFromDraft(db,selected,'Sales user');
  assert.equal(order.productCost,0);
  assert.equal(order.items[0].mapPrice,12);
  assert.equal(order.items[0].listPrice,20);
  assert.equal(order.items[0].priceOverridden,true);
  assert.equal(order.items[0].selectedSupplierSku,'SUP-A');
  const unknown=draftFunctions.normalizeOrderDraft(db,{items:[{sku:'B',qty:1,price:20,cost:null}]});
  assert.equal(unknown.items[0].cost,null);
  assert.equal(draftFunctions.buildOrderFromDraft(db,unknown,'Sales user').productCost,null);
});

test('quote expiration, terms, MSRP, and savings remain structured',()=>{
  const db={inventory:[{sku:'A',title:'Item A',price:80,listPrice:100,cost:40}],orders:[],orderDrafts:[],sequence:{order:1000,draft:1000}};
  const draft=draftFunctions.normalizeOrderDraft(db,{
    expiresAt:'2026-12-05',
    selectedTermIds:['taxes','net_30','unknown','taxes'],
    customTerms:'Installation is excluded.',
    items:[{sku:'A',qty:2}],
  });
  assert.equal(draft.expiresAt,'2026-12-05');
  assert.deepEqual(Array.from(draft.selectedTermIds),['taxes','net_30']);
  assert.equal(draft.customTerms,'Installation is excluded.');
  assert.equal(draft.items[0].msrp,100);
  assert.equal(draft.items[0].price,80);
  assert.deepEqual(quoteDocuments.quoteSavingsTotals(draft.items),{quoteTotal:160,msrpTotal:200,savingsTotal:40,hasMsrp:true});
  assert.deepEqual(quoteDocuments.quoteSavingsTotals([{qty:1,price:25,msrp:0}]),{quoteTotal:25,msrpTotal:0,savingsTotal:0,hasMsrp:false});
  assert.equal(quoteDocuments.defaultQuoteExpiration(30,new Date('2026-11-05T12:00:00Z')),'2026-12-05');
});

test('all customer quote versions generate real multi-page-capable PDFs',async()=>{
  const draft={draftNumber:'QUOTE-1001',buyer:'Test customer',buyerEmail:'buyer@example.com',createdAt:'2026-11-05T12:00:00Z',expiresAt:'2026-12-05',selectedTermIds:['availability','taxes','net_30'],customTerms:'Installation is excluded.',customerNote:'Thank you for the opportunity.',shippingAddress:{line1:'1 Main St',city:'Staten Island',state:'NY',postalCode:'10303',country:'US'},items:Array.from({length:28},(_,index)=>({sku:`SKU-${index+1}`,title:`Product ${index+1} with a descriptive customer-facing title`,qty:2,msrp:25,price:20}))};
  for(const variant of quoteDocuments.QUOTE_EXPORT_VARIANTS){
    const buffer=await quoteDocuments.buildQuotePdf(draft,variant);
    assert.equal(buffer.subarray(0,4).toString(),'%PDF');
    const pdf=await PDFDocument.load(buffer);
    assert.ok(pdf.getPageCount()>=2);
  }
});

test('company draft quotes use scoped storage for fields, exports, catalog suggestions, and UPS labels',async(t)=>{
  const {createCompanyOperationsHandler}=require('../lib/company-operations-http');
  const scope={tenantId,companyId:'buysupply'};
  const attachmentRoot=require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(),'dataplus-company-labels-'));
  t.after(()=>require('node:fs').rmSync(attachmentRoot,{recursive:true,force:true}));
  let state={orders:[],orderDrafts:[],returns:[],customers:[],connections:[],warehouses:[],inventory:[],purchaseOrders:[],suppliers:[],vendors:[],brands:[],sequence:{},orderViews:[]};
  let response=null,exported=null,selectedCompanyProduct=null,directCatalogLookups=0,wildcardCatalogLookups=0;
  const catalogRows=[
    {product_id:'current',source_sku:'ABC',title:'Current item',default_image:'/current.jpg',cost:999,raw:{secret:true}},
    {product_id:'alternate',source_sku:'ALT-1',title:'Alternative item',brand:'Brand',manufacturer:'Maker',mfr_part_number:'MPN-1',barcode:'0123',default_image:'/image.jpg',uom:'Each',sell_price:'25.50',cost:888,raw:{secret:true}},
    {product_id:'rfq-product',source_sku:'4510-01-521-9866',title:'PURELL-SKILCRAFT Wall Dispenser',brand:'AbilityOne',manufacturer:'AbilityOne',mfr_part_number:'4510-01-521-9866',default_image:'/rfq-product.jpg',uom:'Each'},
  ];
  const store={
    authorize:async(_user,requested)=>{assert.deepEqual(requested,scope);return {id:'buysupply',name:'BuySupply',profile:BUYSUPPLY_PUBLIC_PROFILE};},
    operationalState:async()=>state,
    updateOperationalState:async(_user,_scope,_action,work)=>work(state),
    catalogProduct:async(_user,_scope,key)=>{directCatalogLookups++;return catalogRows.find(row=>String(row.source_sku).toLowerCase()===String(key).toLowerCase()) || null;},
    catalog:async()=>{wildcardCatalogLookups++;return {rows:catalogRows};},
    costs:async(_user,_scope,productId)=>productId==='current' ? [
      {vendor_account_id:'vendor-standard',unit_cost:'6.00',uom:'Each',supplier_name:'Standard Supply'},
      {vendor_account_id:'vendor-low',unit_cost:'4.00',uom:'Each',supplier_name:'Lowest Cost Supply'},
    ] : [],
    companyCarrierAccess:async()=>[
      {id:'ups',name:'UPS',enabled:true,companyRates:true,companyLabels:true},
      {id:'usps',name:'USPS',enabled:true,companyRates:true,companyLabels:false},
      {id:'veeqo',name:'Veeqo',enabled:true,companyRates:true,companyLabels:false},
    ],
    companyCarrierPreference:async()=>({selectionMode:'preferred_carrier',preferredProviderId:'usps',rateTtlMinutes:30}),
    selectProduct:async(_user,_scope,input)=>{selectedCompanyProduct=input;return {saved:true,product:input};},
  };
  const competitorHelpers=require('../lib/competitor-products');
  const competitorInspections=new Map();
  const competitorService={
    ...competitorHelpers,
    inspectCompetitorUrl:async(url,{scopeKey})=>{
      const noMatch=String(url).includes('no-match');
      const record={inspectionId:noMatch?'no-match-inspection':'match-inspection',scopeKey,sourceUrl:String(url),sourceHost:'example.com',inspectedAt:'2026-11-07T12:00:00.000Z',expiresAt:'2026-11-07T12:15:00.000Z',
        product:{title:noMatch?'New item':'Current item',brand:'Brand',description:'',gtin:'',sku:noMatch?'UNKNOWN':'ABC',mpn:'',imageUrl:'',competitorPrice:12.5,currency:'USD',structuredDataFound:true,identifiersFound:1}};
      competitorInspections.set(record.inspectionId,record);return record;
    },
    readInspection:(id,scopeKey)=>{const record=competitorInspections.get(id);assert.equal(record.scopeKey,scopeKey);return record;},
  };
  const operations=createCompanyOperationsHandler({
    store,selection:()=>scope,sendJson:(_res,status,data)=>{response={status,data};},parseBody:async req=>req.body,
    normalizeDraft:draftFunctions.normalizeOrderDraft,buildOrder:draftFunctions.buildOrderFromDraft,
    exportDraft:async(_res,draft,format,variant)=>{exported={draft,format,variant};},
    quoteUps:async input=>{
      assert.equal(input.from.line1,'388 South Avenue');
      assert.equal(input.to.postalCode,'10001');
      return {status:{ok:true},rates:[{id:'ups-ground',carrier:'UPS',service:'Ground',serviceCode:'03',amount:8.5,currency:'USD',quotedAt:'2026-11-06T12:00:00.000Z'}]};
    },
    quoteUsps:async()=>({status:{ok:true},rates:[{id:'usps-ground',carrier:'USPS',service:'Ground Advantage',amount:9,currency:'USD'}]}),
    quoteVeeqo:async()=>{throw new Error('Veeqo test account unavailable');},
    competitorProducts:competitorService,
    createCompetitorDraftProduct:async({inspection,overrides})=>({id:'shared-new',sku:'DPS20001',title:overrides.title || inspection.product.title,status:'Draft',catalogReviewStatus:'needs_details'}),
    readSharedQuoteSupplierOptions:async sku=>sku==='ABC'?{mapPrice:12,listPrice:20,options:[
      {key:'supplier:zoro',productId:'current',supplierName:'Zoro',supplierSku:'ABC-Z',managedSku:'ABC',cost:5,qty:3,uom:'Each',selectable:true,isPrimary:true},
      {key:'product:cei',productId:'cei-product',supplierName:'CEI',supplierSku:'ABC-C',managedSku:'BUY-ABC',cost:8,qty:14,uom:'Each',selectable:true,related:true}
    ]}:{options:[]},
    purchaseUps:async input=>{
      assert.equal(input.serviceCode,'03');assert.equal(input.package.weight,5);assert.equal(input.to.postalCode,'10001');
      return {content:Buffer.from('GIF89a'),mimeType:'image/gif',format:'GIF',trackingNumber:'1Z999AA10123456784',shipmentIdentificationNumber:'1Z999AA10123456784',service:'UPS Ground',serviceCode:'03',amount:8.5,currency:'USD',transactionId:'test-transaction'};
    },
    validateAddress:async({address})=>({status:'verified',providerId:'usps',address,message:'USPS verified the destination address.'}),
    attachmentRoot,
  });
  const op=async(path,method='GET',body={})=>{response=null;const handled=await operations({method,body},{},new URL(path,'http://localhost'),{id:'owner',name:'Owner'});return {handled,response};};
  assert.equal((await op('/api/app/bootstrap')).response.data.systemSettings.organizationName,'BuySupply');
  assert.equal((await op('/api/app/bootstrap')).response.data.systemSettings.organizationLegalName,'Buy Supply, Corp.');
  assert.equal((await op('/api/app/bootstrap')).response.data.systemSettings.organizationAddress.postalCode,'10303');
  assert.equal((await op('/api/app/summary')).response.data.summary,null);
  assert.deepEqual((await op('/api/app/references?include=warehouses,systemSettings')).response.data.warehouses,[]);
  assert.equal((await op('/api/channels')).response.data.connections.length,0);
  const companyTerms=(await op('/api/quote-terms')).response.data;
  assert.equal(companyTerms.companyOwned,true);
  assert.ok(companyTerms.quoteTerms.length>0);
  const editedTerms=companyTerms.quoteTerms.map(term=>term.id==='taxes'?{...term,text:'Company-specific tax wording.'}:term);
  assert.equal((await op('/api/quote-terms','PUT',{quoteTerms:editedTerms})).response.data.quoteTerms.find(term=>term.id==='taxes').text,'Company-specific tax wording.');
  const created=(await op('/api/order-drafts','POST',{
    buyer:'Buyer',customerNote:'Customer-facing note',note:'Internal note',expiresAt:'2026-12-20',
    selectedTermIds:['taxes','net_30','unknown'],customTerms:'Approved custom term.',
    shippingAddress:{line1:'1 Main St',city:'New York',state:'NY',postalCode:'10001',country:'US'},
    items:[{sku:'ABC',title:'Current item',qty:2,price:10,msrp:15,cost:777}],
  })).response.data.draft;
  assert.equal(created.customerNote,'Customer-facing note');
  assert.equal(created.expiresAt,'2026-12-20');
  assert.deepEqual(Array.from(created.selectedTermIds),['taxes','net_30']);
  assert.equal(created.selectedTermsSnapshot.find(term=>term.id==='taxes').text,'Company-specific tax wording.');
  assert.equal(created.items[0].msrp,15);
  assert.equal(created.items[0].cost,null,'Company quote input cannot persist a LINQ or caller-provided cost');
  assert.equal(created.items[0].catalogProductId,'current');
  assert.equal(created.items[0].catalogMatchedSku,'ABC');
  assert.equal(created.items[0].catalogMatchBasis,'Catalog SKU');
  assert.equal(created.items[0].image,'/current.jpg');
  assert.ok(directCatalogLookups>0);
  assert.equal(wildcardCatalogLookups,0,'Exact draft SKUs use the indexed product lookup instead of wildcard search');
  assert.equal(created.salesOwner,'Owner');
  assert.equal(created.statusChangedBy,'Owner');
  assert.equal(created.quoteActivity[0].type,'created');
  const importedRfq=(await op('/api/order-drafts','POST',{
    source:'BuySupply DW RFQ',buyer:'Buyer',marketplaceOrderNumber:'Q-IMAGE-MATCH',
    items:[{sku:'4510015219866',sourcePageSku:'4510-01-521-9866',title:'Imported description',qty:1,price:25}],
  })).response.data.draft;
  assert.equal(importedRfq.items[0].catalogProductId,'rfq-product');
  assert.equal(importedRfq.items[0].catalogMatchedSku,'4510-01-521-9866');
  assert.equal(importedRfq.items[0].title,'PURELL-SKILCRAFT Wall Dispenser');
  assert.equal(importedRfq.items[0].image,'/rfq-product.jpg');
  assert.equal(importedRfq.items[0].catalogMatchReviewRequired,false,'An exact source SKU remains a confirmed match even when the RFQ used a normalized form');
  const pipelineUpdate=(await op(`/api/order-drafts/${created.id}`,'PATCH',{status:'reviewing',salesOwner:'Salesperson A',nextAction:'Call purchasing manager',nextFollowUpAt:'2026-11-10T15:30:00.000Z'})).response.data.draft;
  assert.equal(pipelineUpdate.status,'reviewing');
  assert.equal(pipelineUpdate.salesOwner,'Salesperson A');
  assert.equal(pipelineUpdate.nextAction,'Call purchasing manager');
  assert.equal(pipelineUpdate.nextFollowUpAt,'2026-11-10T15:30:00.000Z');
  assert.equal(pipelineUpdate.quoteActivity.at(-1).fromStatus,'draft');
  assert.equal(pipelineUpdate.quoteActivity.at(-1).toStatus,'reviewing');
  const competitorMatch=(await op(`/api/order-drafts/${created.id}/competitor-product/inspect`,'POST',{url:'https://example.com/match'})).response.data;
  assert.equal(competitorMatch.matches[0].sku,'ABC');
  assert.equal(competitorMatch.matches[0].matchBasis,'Page SKU');
  const competitorNoMatch=(await op(`/api/order-drafts/${created.id}/competitor-product/inspect`,'POST',{url:'https://example.com/no-match'})).response.data;
  assert.equal(competitorNoMatch.matches.length,0);
  const competitorCreated=(await op(`/api/order-drafts/${created.id}/competitor-product/create`,'POST',{inspectionId:competitorNoMatch.inspectionId,confirmNoMatch:true,product:{title:'New item'}})).response.data;
  assert.equal(competitorCreated.product.sku,'DPS20001');
  assert.equal(selectedCompanyProduct.productId,'shared-new');
  assert.equal(selectedCompanyProduct.status,'draft');
  const supplierOptions=(await op(`/api/order-drafts/${created.id}/supplier-options?sku=ABC`)).response.data.options;
  assert.equal(supplierOptions.length,4);
  assert.equal(supplierOptions[0].supplierName,'Lowest Cost Supply');
  assert.equal(supplierOptions[0].cost,4);
  const supplierOptionsResponse=(await op(`/api/order-drafts/${created.id}/supplier-options?sku=ABC`)).response.data;
  assert.equal(supplierOptionsResponse.product.image,'/current.jpg');
  assert.equal(supplierOptionsResponse.costScope,'organization-shared');
  assert.equal(supplierOptionsResponse.mapPrice,12);
  assert.ok(supplierOptions.some(option=>option.supplierName==='CEI' && option.qty===14));
  const withSupplier=(await op(`/api/order-drafts/${created.id}`,'PATCH',{items:[{
    sku:'ABC',title:'Current item',qty:2,price:10,priceOverridden:true,listPrice:15,mapPrice:8,selectedSupplierKey:'vendor:vendor-low'
  }]})).response.data.draft;
  assert.equal(withSupplier.items[0].cost,4);
  assert.equal(withSupplier.items[0].selectedSupplierName,'Lowest Cost Supply');
  assert.equal(withSupplier.items[0].listPrice,15);
  assert.equal(withSupplier.items[0].mapPrice,8);
  assert.equal(withSupplier.items[0].priceOverridden,true);
  const rateResult=(await op(`/api/order-drafts/${created.id}/shipping-rates`,'POST',{package:{weight:5,length:10,width:8,height:6}})).response.data;
  assert.equal(rateResult.rates[0].providerId,'usps','Preferred carrier rates lead even when another carrier costs less');
  assert.equal(rateResult.rates[1].amount,8.5);
  assert.equal(rateResult.addressValidation.status,'verified');
  assert.match(rateResult.providerErrors[0].message,/Veeqo test account/);
  const withShipping=(await op(`/api/order-drafts/${created.id}`,'PATCH',{shippingEstimate:{...rateResult.rates[0],warehouseId:'',package:rateResult.package}})).response.data.draft;
  assert.equal(withShipping.total,29);
  assert.equal(withShipping.shippingEstimate.carrier,'USPS');
  assert.ok(Date.parse(withShipping.shippingEstimate.expiresAt)>Date.now());
  assert.equal((await op(`/api/order-drafts/${created.id}`,'PATCH',{note:'Internal note updated'})).response.data.draft.shippingEstimate.amount,9);
  state.orderDrafts.find((draft)=>draft.id===created.id).shippingEstimate.expiresAt='2020-01-01T00:00:00.000Z';
  const expiredAcceptance=(await op(`/api/order-drafts/${created.id}`,'PATCH',{status:'accepted'})).response;
  assert.equal(expiredAcceptance.status,409);
  assert.match(expiredAcceptance.data.error,/expired/);
  await op(`/api/order-drafts/${created.id}`,'PATCH',{shippingEstimate:{...rateResult.rates[0],warehouseId:'',package:rateResult.package}});
  assert.equal((await op(`/api/order-drafts/${created.id}`,'PATCH',{shippingAddress:{line1:'2 Main St',city:'New York',state:'NY',postalCode:'10001',country:'US'}})).response.data.draft.shippingEstimate,null);
  assert.equal((await op('/api/orders/references')).response.data.connections.length,0);
  const prospectList=(await op('/api/customers')).response.data;
  assert.equal(prospectList.customers.length,1);
  assert.equal(prospectList.customers[0].name,'Buyer');
  assert.equal(prospectList.customers[0].segment,'prospect');
  const customerId=prospectList.customers[0].id;
  const customerUpdate=(await op(`/api/customers/${customerId}`,'PATCH',{notes:'BuySupply-only note',tags:'Wholesale, Priority'})).response.data.customer;
  assert.equal(customerUpdate.notes,'BuySupply-only note');
  assert.deepEqual(customerUpdate.tags,['Wholesale','Priority']);
  assert.equal(customerUpdate.timeline.length,1);
  assert.equal((await op(`/api/customers/${customerId}`)).response.data.customer.notes,'BuySupply-only note');
  const suggestion=(await op(`/api/order-drafts/${created.id}/similar-skus?lineIndex=0&sku=ABC`)).response.data.alternatives[0];
  assert.equal(suggestion.sku,'ALT-1');
  assert.equal(suggestion.price,25.5);
  assert.equal(suggestion.cost,undefined);
  assert.equal(suggestion.raw,undefined);
  const exportResult=await op(`/api/order-drafts/${created.id}/export/pdf?variant=savings`);
  assert.equal(exportResult.handled,true);
  assert.equal(exported.draft.id,created.id);
  assert.equal(exported.draft.companyProfile.organizationName,'BuySupply');
  assert.equal(exported.format,'pdf');
  assert.equal(exported.variant,'savings');
  const warehouse=(await op('/api/warehouses','POST',{name:'BuySupply Warehouse',code:'BS',isDefaultReceiving:true,addressLine1:'388 South Avenue',city:'Staten Island',state:'NY',postalCode:'10303',country:'US',phone:'7185550100'})).response.data.warehouse;
  await op(`/api/order-drafts/${created.id}`,'PATCH',{shippingAddress:{line1:'1 Main St',city:'New York',state:'NY',postalCode:'10001',country:'US',phone:'2125550100'}});
  const freshQuote=(await op(`/api/order-drafts/${created.id}/shipping-rates`,'POST',{warehouseId:warehouse.id,package:{weight:5,length:10,width:8,height:6}})).response.data;
  const upsQuote=freshQuote.rates.find(rate=>rate.provider==='ups');
  await op(`/api/order-drafts/${created.id}`,'PATCH',{shippingEstimate:{...upsQuote,warehouseId:warehouse.id,package:freshQuote.package}});
  const converted=(await op(`/api/order-drafts/${created.id}/convert`,'POST')).response.data.order;
  assert.equal(converted.productCost,8);
  assert.equal(converted.items[0].selectedSupplierName,'Lowest Cost Supply');
  assert.equal(converted.items[0].listPrice,15);
  assert.equal(converted.items[0].mapPrice,8);
  assert.equal(converted.items[0].priceOverridden,true);
  const routeId=`company-route:${converted.id}:0`;
  const orderRates=(await op(`/api/orders/${converted.id}/shipping/rates`,'POST',{warehouseId:warehouse.id,packageWeight:5,packageLength:10,packageWidth:8,packageHeight:6,routeIds:[routeId]})).response.data;
  assert.equal(orderRates.rateReview.package.weight,5,'Order label dialog package field names are accepted');
  assert.equal(state.orders.find(row=>row.id===converted.id).package.packageWeight,5,'Saved order dimensions reopen in the label dialog');
  const selectedUps=orderRates.rates.find(rate=>rate.provider==='ups');
  await op(`/api/fulfillment/rates/${encodeURIComponent(routeId)}`,'PATCH',{selectedRateId:selectedUps.id,routeIds:[routeId]});
  assert.equal((await op(`/api/orders/${converted.id}/shipping/labels`,'POST',{provider:'ups',rate:selectedUps,warehouseId:warehouse.id,packageWeight:5,packageLength:10,packageWidth:8,packageHeight:6,routeIds:['company-route:another-order:0']})).response.status,404);
  const purchase=(await op(`/api/orders/${converted.id}/shipping/labels`,'POST',{provider:'ups',rate:selectedUps,warehouseId:warehouse.id,packageWeight:5,packageLength:10,packageWidth:8,packageHeight:6,routeIds:[routeId]})).response.data;
  assert.equal(purchase.shipment.trackingNumber,'1Z999AA10123456784');
  assert.equal(purchase.document.storage,'company_local');
  assert.ok(require('node:fs').existsSync(require('node:path').join(attachmentRoot,require('node:fs').readdirSync(attachmentRoot)[0],purchase.document.storageKey)));
  const duplicatePurchase=(await op(`/api/orders/${converted.id}/shipping/labels`,'POST',{provider:'ups',rate:selectedUps,warehouseId:warehouse.id,packageWeight:5,packageLength:10,packageWidth:8,packageHeight:6,routeIds:[routeId]})).response.data;
  assert.equal(duplicatePurchase.shipment.id,purchase.shipment.id,'Repeated clicks do not buy a duplicate UPS label');
  const printed=(await op(`/api/orders/${converted.id}/shipments/${purchase.shipment.id}/printed`,'POST')).response.data;
  assert.equal(printed.order.operationalStatus,'shipped');
  const unsupported=(await op('/api/shopify/orders/import','POST')).response;
  assert.equal(unsupported.status,409);
  assert.match(unsupported.data.error,/BuySupply has not enabled POST \/api\/shopify\/orders\/import yet/);
});

test('company membership routes require user permission management before reading or writing', async () => {
  let response;
  const handler=createCompanyHandler({store:{},parseBody:async()=>{throw new Error('Unauthorized body must not be processed');},sendJson:(_res,status,data)=>{response={status,data};},canManageMembers:()=>false});
  for(const method of ['GET','PUT']) {
    await handler({method},{},new URL('/api/organization/tenants/organization-default/members','http://localhost'),{id:'restricted'});
    assert.equal(response.status,403);assert.match(response.data.error,/permission management/);
  }
});

test('company product detail shares the complete normalized catalog while preserving company overrides',async()=>{
  const {createCompanyOperationsHandler}=require('../lib/company-operations-http');
  const scope={tenantId:'tenant-1',companyId:'buy'},user={id:'user-1'};
  const store={
    authorize:async()=>({id:'buy',name:'BuySupply'}),
    catalogProduct:async(_user,_scope,key)=>key==='BUSB1441513GEC'?{
      product_id:'product-1',source_sku:'BUSB1441513GEC',company_sku:'BUY-PAINT',title:'Touch Up Paint',brand:'Paint Brand',manufacturer:'Paint Brand',
      mfr_part_number:'B1441513GEC',barcode:'012345678905',main_category:'Paint',default_image:'https://example.com/paint.jpg',uom:'Each',
      company_status:'active',sell_price:'79.93',selected:true,shared_inventory_enabled:true,shared_qty:'14',shared_reserved:'2',shared_available:'12',
      shared_warehouse_stock:[{warehouseId:'staten-island-2',warehouseName:'Staten Island 2',qty:14,reserved:2,available:12,committed:0,incoming:0}]
    }:null,
    costs:async()=>[{vendor_account_id:'vendor-1',supplier_name:'BuySupply vendor',unit_cost:'51.25',uom:'Each',updated_at:'2026-11-09T12:00:00.000Z'}]
  };
  let response;
  const handler=createCompanyOperationsHandler({store,selection:()=>scope,sendJson:(_res,status,data)=>{response={status,data};},sendHtml:()=>{},parseBody:async()=>({}),
    readSharedCatalogProduct:async key=>key==='BUSB1441513GEC'?{
      id:'product-1',sku:'BUSB1441513GEC',title:'Touch Up Paint',marketplaceTitle:'Touch Up Paint, Munsell Green',supplier:'Global',vendorSku:'B1441513',
      shortDescription:'Shared description',cost:55.95,sellUnitCost:55.95,price:71.62,websitePrice:71.62,
      itemLength:2.7,itemWidth:2.7,itemHeight:7.75,itemWeight:1.1,packageLength:2.7,packageWidth:2.7,packageHeight:7.75,packageWeight:1.1
    }:null,
    readSharedCatalogSupplierCoverage:async key=>key==='BUSB1441513GEC'?{
      matchType:'upc',supplierCount:2,pendingReviewCount:0,
      matches:[
        {supplier:'Global',vendorSku:'B1441513',cost:55.95,qty:4,matchType:'primary',matchStatus:'confirmed'},
        {supplier:'CEI',vendorSku:'CEI-PAINT',cost:49.25,qty:11,matchType:'upc',matchStatus:'confirmed'}
      ],
      relatedSkuCount:1,relatedSkus:[
        {productId:'product-1',sku:'BUSB1441513GEC',supplier:'Global',cost:55.95,isCurrent:true},
        {productId:'product-2',sku:'BUYPAINTCEI',supplier:'CEI',cost:49.25,isCurrent:false,matchTypes:['upc']}
      ]
    }:null});
  const get=async(path)=>{await handler({method:'GET'},{},new URL(path,'http://localhost'),user);return response;};
  const detail=await get('/api/inventory/BUSB1441513GEC');
  assert.equal(detail.status,200);
  assert.equal(detail.data.item.sku,'BUY-PAINT');
  assert.equal(detail.data.item.sourceSku,'BUSB1441513GEC');
  assert.equal(detail.data.item.cost,55.95);
  assert.equal(detail.data.item.price,71.62);
  assert.equal(detail.data.item.companyLowestCost,51.25);
  assert.equal(detail.data.item.companySellPrice,79.93);
  assert.equal(detail.data.item.companyFullCatalogView,true);
  assert.equal(detail.data.item.companyCatalogReadOnly,true);
  assert.equal(detail.data.item.shortDescription,'Shared description');
  assert.equal(detail.data.item.packageWeight,1.1);
  assert.equal(detail.data.item.companyInventoryConnected,true);
  assert.equal(detail.data.item.inventorySharedAcrossCompanies,true);
  assert.equal(detail.data.item.qty,14);
  assert.equal(detail.data.item.available,12);
  const operations=await get('/api/inventory/BUSB1441513GEC/operations');
  assert.equal(operations.data.inventoryConnected,true);
  assert.equal(operations.data.warehouses[0].name,'Staten Island 2');
  assert.equal((await get('/api/inventory/BUSB1441513GEC/channel-availability')).data.availability.length,0);
  const supplierCoverage=(await get('/api/inventory/BUSB1441513GEC/suppliers')).data;
  assert.equal(supplierCoverage.supplierCount,2);
  assert.equal(supplierCoverage.matches[1].supplier,'CEI');
  assert.equal(supplierCoverage.relatedSkus[1].sku,'BUYPAINTCEI');
  assert.equal(supplierCoverage.inventorySharedAcrossCompanies,true);
  assert.equal((await get('/api/inventory/MISSING')).status,404);
});

test('manual order parsing preserves identifiers, dates, unknown cost and rejects ambiguous line keys',()=>{
  const input={filename:'orders.csv',content:Buffer.from('so,order_date,sku,qty,ext_price,ext_cost,difference\n0001,09/01/2026,00123,2,20,12,-999\n0002,2026-09-02,00124,1,10,,10').toString('base64')};
  const parsed=parseFile(input),result=normalize(parsed,parsed.suggested);
  assert.equal(result.summary.errors,0);assert.equal(result.lines[0].orderId,'0001');assert.equal(result.lines[0].sku,'00123');assert.equal(result.lines[0].date,'2026-09-01');
  assert.equal(result.lines[0].salesMinor,2000);assert.equal(result.lines[0].costMinor,1200);assert.equal(result.lines[1].costMinor,null);assert.equal(result.summary.warnings,2);
  parsed.rows.push({...parsed.rows[0]});assert.equal(normalize(parsed,parsed.suggested).summary.errors,1);
  parsed.rows[0].order_date='2026-02-30';assert.ok(normalize(parsed,parsed.suggested).issues.some(i=>/order date/.test(i.message)));
});

test('cost validation retains unknown and zero without coercing invalid input', () => {
  assert.equal(money(null),null); assert.equal(money(''),null); assert.equal(money('0'),'0'); assert.equal(money('1.234567'),'1.234567');
  for(const value of [undefined, false, -1, 'NaN', '1e4', '1.1234567', {}, ' ']) assert.throws(()=>money(value));
});

const connectionString=process.env.COMPANY_TEST_DATABASE_URL;
test('company isolation, catalog projection, access changes, persistence and HTTP boundaries', { skip: !connectionString }, async () => {
  const url=new URL(connectionString);
  assert.ok(['127.0.0.1','localhost'].includes(url.hostname) && url.pathname.endsWith('_company_test'),'Use an isolated local company test database only.');
  const schema=`company_test_${process.pid}`, admin=new Pool({connectionString});
  await admin.query(`create schema ${schema}`);
  const pool=new Pool({connectionString,options:`-c search_path=${schema}`});
  const owner={id:'owner',status:'active',isMasterAdmin:true}, staff={id:'staff',status:'active'}, outsider={id:'outsider',status:'active',isMasterAdmin:true};
  const buy={tenantId,companyId:'buysupply'}, linq={tenantId,companyId:LEGACY_COMPANY};
  const credentialEnv={DATAPLUS_CREDENTIALS_ENCRYPTION_KEY:'11'.repeat(32)};
  const store=createCompanyStore(()=>pool,{credentialEnv});
  try {
    await pool.query(`create table products(product_id text primary key,sku text,title text,brand text,manufacturer text,mfr_part_number text,barcode text,main_category text,default_image text,uom text,vendor_sku text,supplier text,supplier_code text,cost numeric,price numeric,qty numeric,raw jsonb);
      insert into products values('p1','SKU1','Test product','Brand','Manufacturer','MPN','012345','Category',null,'Each','VSKU1','Global','GLB',8.50,12.75,99,'{"secret":"LINQ-private","price":999}');
      create table inventory_levels(product_id text not null references products(product_id) on delete cascade,location_key text not null,on_hand numeric not null default 0,available numeric not null default 0,reserved numeric not null default 0,committed numeric not null default 0,incoming numeric not null default 0,updated_at timestamptz not null default now(),primary key(product_id,location_key));
      insert into inventory_levels(product_id,location_key,on_hand,available,reserved) values('p1','staten-island-2',12,10,2),('p1','datawarehouse',99,99,0);`);
    await store.init(); await store.legacyAccess(staff,null);
    await assert.rejects(store.bootstrap(staff,[owner,staff]),/master administrator/);
    const results=await Promise.all([store.bootstrap(owner,[owner,staff]),store.bootstrap(owner,[owner,staff])]);
    assert.equal(results.filter(r=>r.created).length,1);
    const initialDirectory=await store.directory(owner);
    assert.equal(initialDirectory.companies.length,2);
    assert.equal(initialDirectory.companies.find(company=>company.id===LEGACY_COMPANY).company_number,String(LEGACY_COMPANY_NUMBER));
    assert.equal(initialDirectory.companies.find(company=>company.id==='buysupply').company_number,'101');
    const publicProfile=await store.companyProfile(owner,buy);
    assert.equal(publicProfile.legalName,'Buy Supply, Corp.');
    assert.equal(publicProfile.website,'https://www.buysupply.com');
    assert.equal(publicProfile.email,'support@buysupply.com');
    assert.equal(publicProfile.address.line1,'388 South Avenue');
    assert.equal(publicProfile.address.postalCode,'10303');
    assert.equal(publicProfile.returnAddress,undefined,'Conditional return facilities are not saved as the business address');
    const initialCarrierAccess=await store.carrierAccess(owner,tenantId);
    assert.equal(initialCarrierAccess.providers.find(provider=>provider.id==='ups').companies.find(company=>company.id==='buysupply').enabled,true);
    assert.equal(initialCarrierAccess.providers.find(provider=>provider.id==='veeqo').companies.find(company=>company.id==='buysupply').enabled,false);
    assert.equal(initialCarrierAccess.providers.find(provider=>provider.id==='usps').companyRates,true);
    assert.equal(initialCarrierAccess.preferences.find(preference=>preference.companyId==='buysupply').selectionMode,'lowest_cost');
    assert.equal((await store.companyCarrierAccess(owner,buy)).find(provider=>provider.id==='ups').enabled,true);
    assert.equal((await store.companyCarrierPreference(owner,buy)).rateTtlMinutes,30);
    assert.equal((await store.saveCompanyCarrierPreference(owner,buy,{selectionMode:'preferred_carrier',preferredProviderId:'ups',rateTtlMinutes:60})).preferredProviderId,'ups');
    await assert.rejects(store.saveCompanyCarrierPreference(staff,buy,{selectionMode:'lowest_cost',rateTtlMinutes:30}),/access/);
    await assert.rejects(store.carrierAccess(staff,tenantId),/access/);
    assert.equal((await store.directory(staff)).companies.length,1);
    await assert.rejects(store.createCompany(staff,tenantId,{name:'Forbidden'}),/access/);
    await assert.rejects(store.createCompany(owner,tenantId,{name:'  '}),/company name/);
    const newCompany=await store.createCompany(owner,tenantId,{name:'  New Company  '});
    const newScope={tenantId,companyId:newCompany.id};
    assert.equal(newCompany.name,'New Company');
    assert.equal(newCompany.currency,'USD');
    assert.equal(newCompany.company_number,'102');
    assert.deepEqual(await store.companyProfile(owner,newScope),{});
    assert.equal((await store.companyCarrierAccess(owner,newScope)).find(provider=>provider.id==='ups').enabled,false);
    await store.saveCarrierAccess(owner,tenantId,'ups',{companyIds:[LEGACY_COMPANY,newCompany.id]});
    assert.equal((await store.companyCarrierAccess(owner,newScope)).find(provider=>provider.id==='ups').enabled,true);
    assert.equal((await store.companyCarrierAccess(owner,buy)).find(provider=>provider.id==='ups').enabled,false);
    assert.equal((await store.companyCarrierPreference(owner,buy)).selectionMode,'lowest_cost','Disabling the preferred carrier resets the company to lowest cost');
    await store.saveCarrierAccess(owner,tenantId,'ups',{companyIds:[LEGACY_COMPANY,'buysupply',newCompany.id]});
    assert.equal((await store.companyCarrierAccess(owner,buy)).find(provider=>provider.id==='ups').enabled,true);
    await assert.rejects(store.saveCarrierAccess(staff,tenantId,'ups',{companyIds:['buysupply']}),/access/);
    assert.deepEqual(await store.operationalState(owner,newScope),{});
    assert.equal((await store.vendorAccounts(owner,newScope)).length,0);
    const newCompanyCatalog=(await store.catalog(owner,newScope)).rows[0];
    assert.equal(newCompanyCatalog.source_sku,'SKU1');
    assert.equal(newCompanyCatalog.shared_inventory_enabled,true,'Companies in the organization inherit the shared physical warehouse pool');
    assert.equal((await store.catalog(owner,newScope,'',1,true)).rows.length,0);
    assert.equal((await store.directory(staff)).companies.length,1);
    await assert.rejects(store.createCompany(owner,tenantId,{name:'new company'}),/already exists/);
    assert.ok((await store.activity(owner,newScope)).some(event=>event.action==='company_created'));
    await assert.rejects(store.authorize(staff,buy),/access/);
    await assert.rejects(store.authorize(outsider,buy),/access/);
    await assert.rejects(store.legacyAccess(owner,buy),/migration/);
    await store.legacyAccess(staff,null);
    const initial=(await store.catalog(owner,buy)).rows[0];
    assert.equal(initial.selected,false);
    assert.equal(initial.shared_inventory_enabled,true,'BuySupply is explicitly connected to LINQ physical warehouses');
    for(const forbidden of ['raw','cost','price','qty','supplier']) assert.ok(!(forbidden in initial));
    await store.selectProduct(owner,buy,{productId:'p1',sku:'BUY1'});
    assert.equal((await store.catalog(owner,linq,'',1,true)).rows.length,0);
    await assert.rejects(store.selectProduct(owner,buy,{productId:'p1',sku:'BUY1',status:'active',sellPrice:'invalid'}),/Sell price/);
    await store.selectProduct(owner,buy,{productId:'p1',sku:'BUY1',status:'active',sellPrice:'13.97'});
    const buyProduct=(await store.catalog(owner,buy,'',1,true)).rows[0];
    assert.equal(buyProduct.company_status,'active');
    assert.equal(buyProduct.sell_price,'13.97');
    await store.selectProduct(owner,newScope,{productId:'p1',sku:'NEW1',status:'inactive',sellPrice:'99.00'});
    assert.equal((await store.catalog(owner,newScope,'',1,true)).rows[0].sell_price,'99.00');
    assert.equal((await store.catalog(owner,buy,'',1,true)).rows[0].sell_price,'13.97');
    const vendor=await store.createVendorAccount(owner,buy,{supplierName:'Supplier',accountReference:'BUY-account'});
    await store.saveCost(owner,buy,{productId:'p1',vendorAccountId:vendor.id,unitCost:'0',uom:'Each'});
    assert.equal((await store.costs(owner,buy,'p1'))[0].unit_cost,'0');
    await assert.rejects(store.selectProduct(owner,buy,{productId:'p1',sku:'SHOULD-ROLL-BACK',cost:{vendorAccountId:vendor.id,unitCost:'bad',uom:'Each'}}),/Cost/);
    assert.equal((await store.catalog(owner,buy,'',1,true)).rows[0].company_sku,'BUY1');
    await store.selectProduct(owner,buy,{productId:'p1',sku:'BUY1',cost:{vendorAccountId:vendor.id,unitCost:'7.25',uom:'Each'}});
    assert.equal((await store.costs(owner,buy,'p1'))[0].unit_cost,'7.25');
    await store.selectProduct(owner,linq,{productId:'p1',sku:'LINQ1'});
    await assert.rejects(store.saveCost(owner,linq,{productId:'p1',vendorAccountId:vendor.id,unitCost:'9',uom:'Each'}),error=>error.code==='23503');
    assert.equal((await store.costs(owner,linq,'p1')).length,0);
    assert.equal((await pool.query('select cost from products')).rows[0].cost,'888');
    await store.saveMember(owner,tenantId,{userId:staff.id,companyIds:['buysupply']},[owner,staff]);
    await store.authorize(staff,buy);
    assert.equal((await store.companyProfile(staff,buy)).displayName,'BuySupply');
    await assert.rejects(store.saveCompanyProfile(staff,buy,publicProfile),/access/);
    const savedProfile=await store.saveCompanyProfile(owner,buy,{...publicProfile,phone:'646-213-2345'});
    assert.equal(savedProfile.phone,'646-213-2345');
    assert.equal(savedProfile.source.contactUrl,'https://www.buysupply.com/contact');
    assert.deepEqual(await store.companyProfile(owner,newScope),{});
    await assert.rejects(store.legacyAccess(staff,null),/access/);
    await assert.rejects(store.selectProduct(staff,buy,{productId:'p1',sku:'FORBIDDEN'}),/access/);
    await assert.rejects(store.saveMember(owner,tenantId,{userId:staff.id,companyIds:['other-tenant-company']},[staff]),/belong/);
    await pool.query("insert into workspace_tenants(id,name) values('other','Other tenant'); insert into workspace_companies(tenant_id,id,company_number,name,mode) values('other','buysupply',999,'Unrelated company','reporting'); insert into workspace_memberships values('other','outsider','owner','[]');");
    const other={tenantId:'other',companyId:'buysupply'};
    await assert.rejects(store.authorize(owner,other),/access/);
    await assert.rejects(store.carrierAccess(outsider,'other'),/not available/);
    await assert.rejects(store.saveCarrierAccess(outsider,'other','ups',{companyIds:['buysupply']}),/not available/);
    await assert.rejects(store.catalog(outsider,other),/no shared catalog/);
    assert.equal((await store.vendorAccounts(outsider,other)).length,0);
    assert.equal((await store.costs(outsider,other,'p1')).length,0);
    assert.equal((await store.activity(outsider,other)).length,0);
    const reopened=createCompanyStore(()=>pool);
    assert.equal((await reopened.catalog(owner,buy,'',1,true)).rows[0].company_sku,'BUY1');
    assert.equal((await reopened.costs(owner,buy,'p1')).length,1);
    assert.ok((await reopened.activity(owner,buy)).some(e=>e.action==='product_cost_saved'));
    let selection=null,response;
    const handler=createCompanyHandler({store,parseBody:async req=>req.body,sendJson:(_res,status,data)=>{response={status,data};},getSelection:()=>selection,setSelection:(_req,scope)=>{selection=scope;},users:()=>[owner,staff]});
    const invoke=async (path,method,user,body)=>{await handler({method,body},{},new URL(path,'http://localhost'),user);return response;};
    assert.equal((await invoke('/api/organization/select','POST',outsider,buy)).status,403);
    assert.equal(selection,null);
    assert.equal((await invoke('/api/organization/select','POST',owner,buy)).status,200);
    assert.deepEqual(selection,buy);
    assert.equal((await invoke(`/api/organization/tenants/${tenantId}/companies/buysupply/catalog`,'GET',outsider)).status,403);
    assert.equal((await invoke(`/api/organization/tenants/${tenantId}/companies/buysupply/profile`,'GET',owner)).data.profile.legalName,'Buy Supply, Corp.');
    assert.equal((await invoke(`/api/organization/tenants/${tenantId}/companies/buysupply/carrier-preferences`,'GET',owner)).data.preference.selectionMode,'lowest_cost');
    assert.equal((await invoke(`/api/organization/tenants/${tenantId}/companies/buysupply/carrier-preferences`,'PATCH',staff,{selectionMode:'lowest_cost',rateTtlMinutes:30})).status,403);
    assert.equal((await invoke(`/api/organization/tenants/${tenantId}/companies/buysupply/profile`,'PATCH',staff,publicProfile)).status,403);
    assert.equal((await invoke(`/api/organization/tenants/${tenantId}/companies/buysupply/profile`,'PATCH',owner,{...publicProfile,website:'not-a-url'})).status,400);
    assert.equal((await invoke(`/api/organization/tenants/${tenantId}/companies/buysupply/costs`,'PUT',owner,{productId:'p1',vendorAccountId:'wrong',unitCost:'2',uom:'Each'})).status,400);
    assert.equal((await invoke('/api/organization/unknown','GET',owner)).status,404);
    const csv='so,order_date,sku,qty,ext_price,ext_cost,status\n0001,2026-09-01,ABC,2,20,12,SHIPPED\n0002,2026-09-02,DEF,1,10,,UNPROCESSED';
    const manual=await store.createManualChannel(owner,buy,{name:'External ERP'});
    const linqManual=await store.createManualChannel(owner,linq,{name:'External ERP'});
    const zoro=await store.createManualChannel(owner,buy,{name:'Zoro'});
    await assert.rejects(store.createManualChannel(owner,buy,{name:' zoro '}),error=>error.code==='23505');
    await assert.rejects(store.createManualChannel(staff,buy,{name:'Forbidden'}),/access/);
    assert.equal((await store.manualChannels(outsider,other)).length,0);
    assert.equal((await store.manualChannels(owner,linq)).length,1);
    const input={filename:'orders.csv',channelId:manual.id,content:Buffer.from(csv).toString('base64')};
    await assert.rejects(store.importer.upload(owner,buy,{...input,channelId:linqManual.id}),/belonging/);
    await assert.rejects(store.importer.upload(owner,buy,{...input,channelId:undefined,source:'Zoro'}),/Select a manual channel/);
    const zoroBatch=await store.importer.upload(owner,buy,{...input,channelId:zoro.id,source:'spoofed'});
    assert.equal(zoroBatch.source,'zoro');
    const zoroPreview=await store.importer.preview(owner,buy,{batchId:zoroBatch.id,mapping:zoroBatch.mapping});
    const template=await store.importer.saveTemplate(owner,buy,{name:'Zoro export',channelId:zoro.id,mapping:zoroBatch.mapping});
    assert.equal((await store.importer.templates(owner,buy)).rows.length,1);
    assert.equal((await store.importer.templates(owner,linq)).rows.length,0);
    await assert.rejects(store.importer.templates(outsider,buy),/access/);
    await assert.rejects(store.importer.saveTemplate(staff,buy,{name:'Denied',channelId:zoro.id,mapping:zoroBatch.mapping}),/access/);
    await assert.rejects(store.importer.saveTemplate(owner,buy,{name:'Invalid',channelId:zoro.id,mapping:{}}),/Map/);
    await assert.rejects(store.importer.saveTemplate(owner,buy,{name:'Foreign',channelId:linqManual.id,mapping:zoroBatch.mapping}),/belonging/);
    await assert.rejects(store.importer.upload(owner,linq,{...input,channelId:linqManual.id,templateId:template.id}),/Template not found/);
    await assert.rejects(store.importer.upload(owner,buy,{...input,templateId:template.id}),/different channel/);
    const reused=await store.importer.upload(owner,buy,{...input,channelId:zoro.id,templateId:template.id});
    assert.deepEqual(reused.mapping,template.mapping);
    assert.equal(reused.status,'uploaded');
    assert.equal(reused.templateName,'Zoro export');
    await assert.rejects(store.importer.apply(owner,buy,{batchId:reused.id,confirm:true}),/Preview/);
    const changedFile=await store.importer.upload(owner,buy,{...input,channelId:zoro.id,templateId:template.id,content:Buffer.from(csv.replace('ext_price','new_sales')).toString('base64')});
    await assert.rejects(store.importer.preview(owner,buy,{batchId:changedFile.id,mapping:changedFile.mapping}),/Invalid column/);
    await store.importer.saveTemplate(owner,buy,{...template,name:'Reassigned export',channelId:manual.id});
    assert.equal((await store.importer.detail(owner,buy,reused.id)).templateName,'Zoro export');
    assert.equal((await store.importer.detail(owner,buy,reused.id)).channelId,zoro.id);
    const projected=createCompanyStore(()=>pool,{readLegacyChannels:async()=>[{id:'shop',name:'Shopify',enabled:true,secret:'never expose'}]});
    assert.ok(!(await projected.importChannels(owner,buy)).some(c=>c.id==='api:shop'));
    const apiSource=(await projected.importChannels(owner,linq)).find(c=>c.id==='api:shop');
    assert.ok(apiSource);assert.equal(apiSource.secret,undefined);
    const apiTemplate=await projected.importer.saveTemplate(owner,linq,{name:'Shopify export',channelId:'api:shop',mapping:zoroBatch.mapping});
    const apiBatch=await projected.importer.upload(owner,linq,{...input,channelId:'api:shop',templateId:apiTemplate.id});
    assert.equal(apiBatch.channelName,'Shopify');
    const apiPreview=await projected.importer.preview(owner,linq,{batchId:apiBatch.id,mapping:apiBatch.mapping});
    const disabledProjection=createCompanyStore(()=>pool,{readLegacyChannels:async()=>[{id:'shop',name:'Shopify',enabled:false}]});
    await assert.rejects(disabledProjection.importer.apply(owner,linq,{batchId:apiBatch.id,confirm:true,previewToken:apiPreview.previewToken}),/disabled/);
    assert.ok(!(await disabledProjection.manualChannels(owner,linq)).some(c=>c.source_key==='api:shop'));

    await assert.rejects(projected.importer.upload(owner,buy,{...input,channelId:'api:shop'}),/belonging/);

    await store.updateManualChannel(owner,buy,{id:zoro.id,enabled:false});
    await assert.rejects(store.importer.upload(owner,buy,{...input,channelId:zoro.id}),/disabled/);
    await assert.rejects(store.importer.apply(owner,buy,{batchId:zoroBatch.id,confirm:true,previewToken:zoroPreview.previewToken}),/disabled/);
    await assert.rejects(store.updateManualChannel(owner,linq,{id:zoro.id,enabled:true}),/not found/);
    const upload=await store.importer.upload(owner,buy,input);
    await assert.rejects(store.importer.detail(outsider,other,upload.id),/not found/);
    await assert.rejects(store.importer.upload(staff,buy,input),/access/);
    await assert.rejects(store.importer.apply(owner,buy,{batchId:upload.id,confirm:true}),/Preview/);
    const preview=await store.importer.preview(owner,buy,{batchId:upload.id,mapping:upload.mapping});
    await assert.rejects(store.importer.apply(owner,buy,{batchId:upload.id,confirm:true,previewToken:'stale'}),/preview changed/);
    const applied=await Promise.all([1,2].map(()=>store.importer.apply(owner,buy,{batchId:upload.id,confirm:true,previewToken:preview.previewToken})));
    assert.equal(applied[0].summary.insertedLines,2);
    assert.equal((await store.importer.report(owner,buy,new URLSearchParams())).summary.orders,2);
    assert.equal((await store.importer.report(owner,linq,new URLSearchParams())).summary.orders,0);
    const duplicate=await store.importer.upload(owner,buy,input),dp=await store.importer.preview(owner,buy,{batchId:duplicate.id,mapping:duplicate.mapping});
    assert.equal(dp.summary.duplicateLines,2);
    assert.equal((await store.importer.apply(owner,buy,{batchId:dp.id,confirm:true,previewToken:dp.previewToken})).summary.insertedLines,0);
    const linqUpload=await store.importer.upload(owner,linq,{...input,channelId:linqManual.id}),lp=await store.importer.preview(owner,linq,{batchId:linqUpload.id,mapping:linqUpload.mapping});
    assert.equal(lp.summary.newLines,2);await store.importer.apply(owner,linq,{batchId:lp.id,confirm:true,previewToken:lp.previewToken});
    const report=await store.importer.report(owner,linq,new URLSearchParams());assert.equal(report.summary.missing_cost_lines,1);assert.equal(report.summary.sales_minor,'3000');
    assert.equal((await store.importer.orderLines(owner,linq,new URLSearchParams({source:'external erp',orderId:'0001'}))).rows[0].data.sku,'ABC');
    assert.equal((await store.importer.orderLines(outsider,other,new URLSearchParams({source:'external erp',orderId:'0001'}))).rows.length,0);
    const shipped=await store.importer.report(owner,linq,new URLSearchParams({status:'SHIPPED',from:'2026-09-01',to:'2026-09-01'}));assert.equal(shipped.summary.orders,1);assert.equal(shipped.summary.known_profit_minor,'800');
    await store.updateManualChannel(owner,buy,{id:zoro.id,enabled:true});
    await store.importer.apply(owner,buy,{batchId:zoroBatch.id,confirm:true,previewToken:zoroPreview.previewToken});
    assert.equal((await store.importer.report(owner,buy,new URLSearchParams())).summary.orders,4,'Same order references remain distinct between channels');
    await store.updateManualChannel(owner,buy,{id:zoro.id,enabled:false});
    await store.importer.rollback(owner,buy,{batchId:zoroBatch.id,confirm:true});
    assert.equal((await store.importer.report(owner,buy,new URLSearchParams())).summary.orders,2);
    await pool.query('update workspace_order_imports set channel_id=null where id=$1',[upload.id]);
    await createCompanyStore(()=>pool).init();
    assert.equal((await store.importer.detail(owner,buy,upload.id)).channelId,manual.id,'Existing import identity is retained during backfill');
    const changed=await store.importer.upload(owner,buy,{...input,content:Buffer.from(csv.replace(',20,12,',',21,12,')).toString('base64')});
    assert.equal((await store.importer.preview(owner,buy,{batchId:changed.id,mapping:changed.mapping})).summary.errors,1);
    await assert.rejects(store.importer.rollback(owner,linq,{batchId:upload.id,confirm:true}),/not found/);
    await store.importer.rollback(owner,buy,{batchId:duplicate.id,confirm:true});assert.equal((await store.importer.report(owner,buy,new URLSearchParams())).summary.orders,2);
    const {createCompanyOperationsHandler}=require('../lib/company-operations-http');
    const competitorProductHelpers=require('../lib/competitor-products');
    let activeScope=buy,operationalResponse;
    const operations=createCompanyOperationsHandler({store,selection:()=>activeScope,sendJson:(_r,status,data)=>{operationalResponse={status,data};},sendHtml:(_r,status,html)=>{operationalResponse={status,html};},parseBody:async req=>req.body,
      normalizeDraft:draftFunctions.normalizeOrderDraft,
      buildOrder:draftFunctions.buildOrderFromDraft,
      competitorProducts:{...competitorProductHelpers,inspectCompetitorUrl:async()=>({inspectionId:'inspection-1',sourceUrl:'https://example.com/product',sourceHost:'example.com',inspectedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),product:{title:'Test product',brand:'Brand',description:'',gtin:'',sku:'SKU1',mpn:'MPN',imageUrl:'',competitorPrice:null,currency:'USD',structuredDataFound:true,identifiersFound:2}})},
      purchaseUps:async()=>({content:Buffer.from('GIF89a'),trackingNumber:'1Z999AA10123456784',service:'UPS Ground',amount:8.25,currency:'USD'})});
    const op=async(path,method='GET',body={},user=owner)=>{await operations({method,body},{},new URL(path,'http://localhost'),user);return operationalResponse;};
    assert.equal((await op('/api/state')).data.connections.length,0);
    assert.equal((await op('/api/orders')).data.orders.length,0);
    const companyInventory=(await op('/api/inventory?q=SKU1')).data.inventory[0];
    assert.equal(companyInventory.price,12.75);
    assert.equal(companyInventory.cost,8.5);
    assert.equal(companyInventory.supplier,'Global');
    assert.equal(companyInventory.mapPrice,null);
    assert.equal(companyInventory.qty,12);
    assert.equal(companyInventory.available,10);
    assert.equal(companyInventory.inventoryConnected,true);
    assert.equal(companyInventory.inventorySharedAcrossCompanies,true);
    assert.equal(companyInventory.status,'active');
    const companyProduct=(await op('/api/inventory/BUY1')).data.item;
    assert.equal(companyProduct.companyCatalogView,true);
    assert.equal(companyProduct.sourceSku,'SKU1');
    assert.equal(companyProduct.price,12.75);
    assert.equal(companyProduct.cost,8.5);
    assert.equal(companyProduct.companySellPrice,13.97);
    assert.equal(companyProduct.companyLowestCost,7.25);
    assert.equal(companyProduct.companyInventoryConnected,true);
    assert.equal(companyProduct.companyCosts[0].supplierName,'Supplier');
    assert.equal(companyProduct.qty,12);
    assert.equal(companyProduct.available,10);
    const companyOperations=(await op('/api/inventory/BUY1/operations')).data;
    assert.equal(companyOperations.inventoryConnected,true);
    assert.equal(companyOperations.warehouses.length,1,'Supplier-feed inventory is not shared as physical stock');
    assert.equal((await op('/api/inventory/BUY1/channel-availability')).data.availability.length,0);
    assert.equal((await op('/api/inventory/BUY1/suppliers')).data.matches[0].cost,7.25);
    const competitorResearch=(await op('/api/inventory/BUY1/competitors')).data;
    assert.equal(competitorResearch.product.sku,'BUY1');
    assert.deepEqual(competitorResearch.scope,buy);
    assert.equal(competitorResearch.searchTargets.length,3);
    assert.equal(competitorResearch.searchTargets[0].identifierType,'Manufacturer part number');
    const savedCompetitor=(await op('/api/inventory/BUY1/competitors','POST',{confirmed:true,sourceUrl:'https://www.zoro.com/example/i/G1234/',title:'Test product at Zoro',mpn:'MPN',price:12.5,currency:'USD'})).data;
    assert.equal(savedCompetitor.offer.competitorKey,'zoro');
    assert.equal(savedCompetitor.offer.matchBasis,'Exact manufacturer part number');
    assert.equal((await op('/api/inventory/BUY1/competitors')).data.offers.length,1);
    activeScope=newScope;
    assert.equal((await op('/api/inventory/NEW1/competitors')).data.offers.length,0,'Competitor offers remain isolated by company');
    activeScope=buy;
    assert.equal((await op('/api/inventory/DOES-NOT-EXIST')).status,404);
    const draft=(await op('/api/order-drafts','POST',{buyer:'Buyer',items:[{sku:'ABC',qty:2,price:10}],id:'injected',tenantId:'other'})).data.draft;
    assert.notEqual(draft.id,'injected');
    assert.equal(draft.tenantId,buy.tenantId);
    assert.equal(draft.companyId,buy.companyId);
    const competitorLookup=(await op(`/api/order-drafts/${draft.id}/competitor-product/inspect`,'POST',{url:'https://example.com/product'})).data;
    assert.equal(competitorLookup.matches[0].sku,'BUY1');
    assert.equal(competitorLookup.matches[0].matchBasis,'Page SKU');
    assert.equal(competitorLookup.matches[0].reviewRequired,true);
    assert.equal((await op('/api/orders/references')).data.connections.length,0);
    assert.deepEqual((await op('/api/orders/references')).data.warehouses,[]);
    const prospectCustomer=(await op('/api/customers')).data.customers[0];
    assert.equal(prospectCustomer.segment,'prospect');
    assert.equal(prospectCustomer.totalOrders,0);
    assert.equal((await op(`/api/order-drafts/${draft.id}`,'PATCH',{status:'accepted'})).data.draft.status,'accepted');
    assert.equal((await op(`/api/order-drafts/${draft.id}`,'PATCH',{status:'converted'})).status,400);
    const converted=await Promise.all([op(`/api/order-drafts/${draft.id}/convert`,'POST'),op(`/api/order-drafts/${draft.id}/convert`,'POST')]);
    assert.equal(converted[0].data.order.id,converted[1].data.order.id);
    assert.equal((await op('/api/orders')).data.orders.length,1);
    assert.equal((await op('/api/orders')).data.orders[0].productCost,null);
    const packingSlip=await op(`/api/orders/${converted[0].data.order.id}/packing-slip`);
    assert.equal(packingSlip.status,200);
    assert.match(packingSlip.html,/BuySupply Packing Slip/);
    assert.match(packingSlip.html,/Buy Supply, Corp\./);
    assert.match(packingSlip.html,/388 South Avenue/);
    assert.match(packingSlip.html,new RegExp(converted[0].data.order.orderNumber));
    assert.match(packingSlip.html,/>ABC</);
    const warehouse=(await op('/api/warehouses','POST',{name:'BuySupply Warehouse',code:'BS',isDefaultReceiving:true,isDefaultReturns:true})).data.warehouse;
    assert.equal(warehouse.code,'BS');
    assert.equal((await op('/api/app/references?include=warehouses')).data.warehouses[0].id,warehouse.id);
    const bin=(await op(`/api/warehouses/${warehouse.id}/bins`,'POST',{code:'A-01',name:'Primary receiving',isDefault:true})).data.bin;
    assert.equal(bin.code,'A-01');
    assert.equal((await op(`/api/warehouses/${warehouse.id}/detail`)).data.summary.activeBins,1);
    const fulfillment=(await op('/api/fulfillment/console?view=ready')).data;
    assert.equal(fulfillment.scope,'company');
    assert.equal(fulfillment.work.length,1);
    assert.equal(fulfillment.work[0].warehouseId,warehouse.id);
    assert.equal(fulfillment.capabilities.labelPurchase,false);
    assert.equal(fulfillment.capabilities.orderLabelPurchase,true);
    const route=fulfillment.work[0];
    const packageResult=(await op(`/api/orders/${route.orderId}/fulfillment-package`,'PATCH',{routeId:route.id,warehouseId:warehouse.id,warehouseName:warehouse.name,packageWeight:5,packageLength:10,packageWidth:8,packageHeight:6})).data;
    assert.equal(packageResult.route.labelReadiness.weight,5);
    assert.equal((await op('/api/fulfillment/console?view=ready')).data.work[0].package.packageLength,10);
    assert.equal((await op(`/api/orders/${route.orderId}/workflow-routes/${encodeURIComponent(route.id)}/status`,'POST',{status:'picked'})).data.route.warehouseStage,'picked');
    const shopifyCredentials=(await op('/api/shopify/credentials','PUT',{storeDomain:'buysupply.myshopify.com',apiVersion:'2026-04',clientId:'shop-client',clientSecret:'shop-secret'})).data;
    assert.equal(shopifyCredentials.credentials.hasClientCredentials,true);
    assert.equal(shopifyCredentials.credentials.connected,false);
    const ebayCredentials=(await op('/api/ebay/credentials','PUT',{environment:'production',ruName:'BuySupply-RuName',clientId:'ebay-client',clientSecret:'ebay-secret'})).data;
    assert.equal(ebayCredentials.credentials.configured,true);
    assert.equal(ebayCredentials.credentials.hasSellerAuthorization,false);
    const encryptedCredentials=(await pool.query('select sealed_payload::text as value from workspace_channel_credentials where tenant_id=$1 and company_id=$2',[buy.tenantId,buy.companyId])).rows.map(row=>row.value).join(' ');
    assert.doesNotMatch(encryptedCredentials,/shop-secret|ebay-secret|shop-client|ebay-client/);
    assert.equal((await op('/api/shopify/credentials','PUT',{clientId:'forbidden'},staff)).status,403);
    const convertedCustomer=(await op('/api/customers')).data.customers[0];
    assert.equal(convertedCustomer.id,prospectCustomer.id);
    assert.equal(convertedCustomer.totalOrders,1);
    assert.equal(convertedCustomer.lifetimeValue,20);
    const customerUpdate=(await op(`/api/customers/${convertedCustomer.id}`,'PATCH',{notes:'Private BuySupply note',tags:['Wholesale']})).data.customer;
    assert.equal(customerUpdate.notes,'Private BuySupply note');
    assert.deepEqual(customerUpdate.tags,['Wholesale']);
    assert.equal((await op(`/api/customers/${convertedCustomer.id}`)).data.orders.length,1);
    const companyDocument=(await pool.query('select data from workspace_operational_state where tenant_id=$1 and company_id=$2',[buy.tenantId,buy.companyId])).rows[0].data;
    assert.equal(companyDocument._companyRecordsVersion,1);
    assert.equal(companyDocument.orders,undefined);
    assert.equal(companyDocument.orderDrafts,undefined);
    assert.equal(companyDocument.customers,undefined);
    const buyRecords=(await pool.query('select record_type,record_id,record_number from workspace_company_records where tenant_id=$1 and company_id=$2 order by record_type',[buy.tenantId,buy.companyId])).rows;
    assert.deepEqual(buyRecords.map(row=>row.record_type),['customers','orderDrafts','orders']);
    assert.ok(buyRecords.every(row=>row.record_id && row.record_number));
    const otherCompanyOrder={...converted[0].data.order,buyer:'Other company buyer'};
    await store.updateOperationalState(owner,newScope,'company_order_fixture',data=>{data.orders=[otherCompanyOrder];return {order:otherCompanyOrder};});
    assert.equal((await store.operationalState(owner,buy)).orders[0].buyer,'Buyer');
    assert.equal((await store.operationalState(owner,newScope)).orders[0].buyer,'Other company buyer');
    assert.equal((await pool.query('select count(*)::int as count from workspace_company_records where record_type=$1 and record_id=$2',['orders',otherCompanyOrder.id])).rows[0].count,2,'The same record identity remains isolated by company');
    assert.equal((await op(`/api/order-drafts/${draft.id}`,'PATCH',{buyer:'changed'})).status,400);
    const duplicateDraft=(await op(`/api/order-drafts/${draft.id}/duplicate`,'POST')).data.draft;
    assert.equal(duplicateDraft.convertedOrderId,undefined);
    assert.equal(duplicateDraft.status,'draft');
    assert.equal(duplicateDraft.parentDraftId,draft.id);
    assert.equal(duplicateDraft.revisionNumber,2);
    assert.notEqual(duplicateDraft.draftNumber,draft.draftNumber);
    assert.equal((await op('/api/shopify/orders/import','POST')).status,409);
    activeScope=newScope;
    assert.equal((await op('/api/shopify/credentials')).data.credentials.hasClientCredentials,false);
    assert.deepEqual((await op('/api/warehouses')).data.warehouses,[]);
    const otherCompanyCustomer=(await op('/api/customers','GET',{},owner)).data.customers[0];
    assert.equal(otherCompanyCustomer.name,'Other company buyer');
    assert.notEqual(otherCompanyCustomer.id,convertedCustomer.id);
    assert.equal(otherCompanyCustomer.notes,undefined);
    activeScope=other;
    assert.equal((await op(`/api/orders/${converted[0].data.order.id}`,'GET',{},outsider)).status,404);
    assert.equal((await op('/api/orders','GET',{},owner)).status,403);
    assert.equal((await op('/api/customers','GET',{},outsider)).data.customers.length,0);
    assert.deepEqual(await store.operationalState(owner,linq),{});
    activeScope=buy;
    assert.equal((await op(`/api/customers/${convertedCustomer.id}`)).data.customer.notes,'Private BuySupply note');
    await assert.rejects(store.updateOperationalState(owner,buy,'test_rollback',data=>{data.orders=[];throw new Error('rollback');}),/rollback/);
    assert.equal((await op('/api/orders')).data.orders.length,1);
    assert.equal((await pool.query('select count(*)::int as count from workspace_company_records where tenant_id=$1 and company_id=$2 and record_type=$3',[buy.tenantId,buy.companyId,'orders'])).rows[0].count,1);
    await store.importer.rollback(owner,buy,{batchId:upload.id,confirm:true});assert.equal((await store.importer.report(owner,buy,new URLSearchParams())).summary.orders,0);
    assert.equal((await store.importer.report(owner,linq,new URLSearchParams())).summary.orders,2);
    assert.equal((await store.importer.history(owner,buy)).rows.find(b=>b.id===upload.id).status,'rolled_back');
  } finally { await pool.end(); await admin.query(`drop schema ${schema} cascade`); await admin.end(); }
});
