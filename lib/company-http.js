const { LEGACY_TENANT, LEGACY_COMPANY } = require('./company-workspaces');

function createCompanyHandler({ store, parseBody, sendJson, getSelection, setSelection, users, canManageMembers = () => true }) {
  return async function companyHandler(req, res, url, user) {
    const parts = url.pathname.split('/').filter(Boolean);
    const method = req.method;
    const ok = data => sendJson(res, 200, data);
    try {
      if (url.pathname === '/api/organization' && method === 'GET') return ok({ ...await store.directory(user), selection: getSelection(req) });
      if (url.pathname === '/api/organization/initialize' && method === 'POST') return ok(await store.bootstrap(user, users()));
      if (url.pathname === '/api/organization/select' && method === 'POST') {
        const body = await parseBody(req);
        const scope = { tenantId: String(body.tenantId || ''), companyId: String(body.companyId || '') };
        await store.authorize(user, scope); setSelection(req, scope);
        return ok({ selection: scope, operationsAvailable: scope.tenantId === LEGACY_TENANT && scope.companyId === LEGACY_COMPANY });
      }
      if (parts[2] !== 'tenants' || !parts[3]) return sendJson(res,404,{error:'Company route not found.'});
      const tenantId=decodeURIComponent(parts[3]);
      if (parts.length === 5 && parts[4] === 'companies' && method === 'POST') return ok(await store.createCompany(user,tenantId,await parseBody(req)));
      if (parts.length === 5 && parts[4] === 'members') {
        if (!canManageMembers(user, method)) return sendJson(res,403,{error:'User permission management access is required.'});
        if (method === 'GET') {
          const memberships=await store.members(user,tenantId);
          // User directory is currently owned by the migrated organization only.
          const candidates=tenantId===LEGACY_TENANT ? users().filter(row=>row.status==='active').map(row=>({id:row.id,name:row.name || row.username})) : [];
          return ok({ memberships, users:candidates });
        }
        if (method === 'PUT') return ok(await store.saveMember(user,tenantId,await parseBody(req),tenantId===LEGACY_TENANT?users():[]));
      }
      if (parts[4] !== 'companies' || !parts[5] || parts.length !== 7) return sendJson(res,404,{error:'Company route not found.'});
      const scope={tenantId,companyId:decodeURIComponent(parts[5])};
      const resource=parts[6];
      if(resource==='order-import-channels' && method==='GET') return ok({rows:await store.importChannels(user,scope)});
      if(resource==='order-import-templates' && method==='GET') return ok(await store.importer.templates(user,scope));
      if(resource==='order-import-templates' && ['POST','PATCH'].includes(method)) return ok(await store.importer.saveTemplate(user,scope,await parseBody(req)));
      if(resource==='manual-channels' && method==='GET') return ok({rows:await store.manualChannels(user,scope)});
      if(resource==='manual-channels' && method==='POST') return ok(await store.createManualChannel(user,scope,await parseBody(req)));
      if(resource==='manual-channels' && method==='PATCH') return ok(await store.updateManualChannel(user,scope,await parseBody(req)));
      if(resource==='order-imports' && method==='GET') return ok(await store.importer.history(user,scope));
      if(resource==='order-imports' && method==='POST') return ok(await store.importer.upload(user,scope,await parseBody(req)));
      if(resource==='order-import-detail' && method==='GET') return ok(await store.importer.detail(user,scope,url.searchParams.get('batchId')));
      if(resource==='order-import-preview' && method==='POST') return ok(await store.importer.preview(user,scope,await parseBody(req)));
      if(resource==='order-import-apply' && method==='POST') return ok(await store.importer.apply(user,scope,await parseBody(req)));
      if(resource==='order-import-rollback' && method==='POST') return ok(await store.importer.rollback(user,scope,await parseBody(req)));
      if(resource==='imported-orders' && method==='GET') return ok(await store.importer.report(user,scope,url.searchParams));
      if(resource==='imported-order-lines' && method==='GET') return ok(await store.importer.orderLines(user,scope,url.searchParams));
      if(resource==='catalog' && method==='GET') return ok(await store.catalog(user,scope,url.searchParams.get('q') || '',url.searchParams.get('page') || 1,url.searchParams.get('selected')==='1'));
      if(resource==='catalog' && method==='PUT') return ok(await store.selectProduct(user,scope,await parseBody(req)));
      if(resource==='vendor-accounts' && method==='GET') return ok({rows:await store.vendorAccounts(user,scope)});
      if(resource==='vendor-accounts' && method==='POST') return ok(await store.createVendorAccount(user,scope,await parseBody(req)));
      if(resource==='costs' && method==='GET') return ok({rows:await store.costs(user,scope,url.searchParams.get('productId') || '')});
      if(resource==='costs' && method==='PUT') return ok(await store.saveCost(user,scope,await parseBody(req)));
      if(resource==='activity' && method==='GET') return ok({rows:await store.activity(user,scope)});
      return sendJson(res,404,{error:'Company route not found.'});
    } catch(error) {
      const code=error.code==='23505'?409:error.code==='23503'?400:(error.statusCode || 500);
      const message=error.code==='23505'?'This name, SKU, or vendor account already exists in this company.':error.code==='23503'?'Select a product and vendor account belonging to this company.':code===500?'Unable to complete the company request.':error.message;
      // Do not create an unscoped legacy job containing another company's error data.
      return sendJson(res,code,{error:message});
    }
  };
}
module.exports={ createCompanyHandler };
