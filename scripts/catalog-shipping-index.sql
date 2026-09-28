-- Apply catalog-shipping-function.sql first; run this outside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS products_shipping_class_default_idx ON products ((dataplus_shipping_class(raw, 108, 165, 150, true)));
