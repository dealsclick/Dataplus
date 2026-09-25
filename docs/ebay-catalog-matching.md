# eBay Catalog Matching

The eBay launch dialog enables **Match eBay catalog** by default. Launch jobs search eBay's Commerce Catalog before creating the Inventory API item.

Automatic matching is deliberately strict:

- Use an exact UPC, EAN, ISBN or GTIN when available.
- Otherwise require both an exact manufacturer part number and exact brand.
- Accept only one distinct matching ePID.
- Never select a title-only, keyword-only or ambiguous result automatically.

When a safe match exists, the ePID is sent with the inventory item and the offer requests eBay catalog product details. When matching is disabled, no ePID is sent and the listing is created from DataPlus content. A missing, ambiguous or failed lookup also falls back to DataPlus content so the catalog service cannot stop an otherwise valid launch.

Each listing record and launch CSV retain the match status, method and ePID. Identical searches are cached for the duration of a launch job to avoid duplicate API calls.
