// Local-only UI fixture. All API requests are intercepted; no marketplace writes.
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
const root = fileURLToPath(new URL('../web', import.meta.url));
const product = { id: 'purchase-unit-preview', sku: 'TEST-PURCHASE-UNIT', title: 'Purchase unit preview', supplier: 'True Value', uom: 'EA', uomQty: 4, cost: 5, qty: 37, price: 6.5, ebayListing: {} };
const readiness = { status: 'ready', ready: true, live: false, missing: [], price: 6.5, quantity: 37,
  purchaseUnits: { mode: 'group', stockAllocation: 'export', variants: [
    { sku: product.sku, label: 'Each', price: 6.5, quantity: 37 },
    { sku: `${product.sku}-4PC`, label: '4-pack', price: 26, quantity: 37 }
  ] } };
const server = await createServer({ root, server: { host: '127.0.0.1', port: 5199, strictPort: true, fs: { allow: [root, realpathSync(`${root}/node_modules`)] } }, plugins: [{
  name: 'local-ebay-purchase-unit-fixture', enforce: 'pre',
  transform(code, id) {
    if (id.replaceAll('\\', '/').endsWith('/src/App.tsx')) return `${code}\nexport { EbayListingWorkspace };`;
  },
  configureServer(vite) {
    vite.middlewares.use(async (req, res, next) => {
      if (req.url?.startsWith('/api/')) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ readiness }));
        return;
      }
      if (req.url?.startsWith('/__ebay-preview')) {
        const html = await vite.transformIndexHtml(req.url, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
          import React from 'react';
          import { createRoot } from 'react-dom/client';
          import { EbayListingWorkspace } from '/src/App.tsx';
          import '/src/index.css';
          if (location.search.includes('dark')) document.documentElement.classList.add('dark');
          createRoot(document.getElementById('root')).render(React.createElement(EbayListingWorkspace, { open: true, onOpenChange() {}, product: ${JSON.stringify(product)}, channel: { name: 'eBay', settings: {} }, onUpdated() {} }));
          </script></body></html>`);
        res.setHeader('Content-Type', 'text/html'); res.end(html); return;
      }
      next();
    });
  }
}] });
await server.listen();
console.log('Local-only eBay purchase-unit fixture: http://127.0.0.1:5199/__ebay-preview');
