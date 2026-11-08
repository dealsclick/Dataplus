# DataPlus Capture Chrome extension

Manifest V3 side-panel extension for importing BuySupply Data Warehouse RFQs and adding products from supplier or competitor websites to DataPlus quote drafts.

## Load the development build

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Choose **Load unpacked**.
4. Select this `browser-extension/dataplus-capture` directory.
5. Pin **DataPlus Capture** and open it from a normal website tab.

Sign in to DataPlus in the same Chrome profile before choosing **Connect**. DataPlus exchanges the website session for a separate 30-day extension session. The extension token stays in extension storage, is never exposed to inspected pages, and can be revoked from DataPlus session management.

## Supported workflows

- `dw.buysupply.com/baskets/view/*`: preview the customer, optional phone, shipping address, initial RFQ lines, processed DataPlus SKU matches, and import the RFQ as an idempotent company quote draft.
- Product pages: read JSON-LD and Open Graph product facts, search the DataPlus catalog, and add the selected match to the currently open quote.
- Unmatched products: create a provisional DataPlus draft SKU from facts read in the browser, preserve the competitor URL and observed price, and add it to the quote.
- Difficult websites: save per-host CSS selectors under **Settings > Site extraction template**. Templates contain selectors only; they never contain executable JavaScript.

The active company is explicit in the side panel. Switching it changes only the extension session's company scope.
