-- Complete the Cloudflare D1 schema to cover the original KNOKH store domains.
-- Apply after 0001_cloudflare_core.sql. Existing records are preserved.
PRAGMA foreign_keys = ON;

ALTER TABLE users ADD COLUMN last_seen_at TEXT;
ALTER TABLE users ADD COLUMN deleted_at TEXT;
ALTER TABLE products ADD COLUMN import_job_id TEXT;
ALTER TABLE orders ADD COLUMN duty_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN total_base_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN cost_total_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN coupon_code TEXT;
ALTER TABLE orders ADD COLUMN cart_owner_key TEXT;
ALTER TABLE orders ADD COLUMN shipping_method_json TEXT;
ALTER TABLE orders ADD COLUMN fulfilment_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE orders ADD COLUMN placed_at TEXT;
ALTER TABLE orders ADD COLUMN cancelled_at TEXT;
ALTER TABLE orders ADD COLUMN cancel_reason TEXT;

CREATE TABLE IF NOT EXISTS auth_sessions (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expiry ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS inventory_movements (
 id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), variant_sku TEXT,
 delta INTEGER NOT NULL, reason TEXT NOT NULL, note TEXT, order_id TEXT REFERENCES orders(id),
 actor_id TEXT REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS inventory_movements_product ON inventory_movements(product_id,created_at);
CREATE INDEX IF NOT EXISTS inventory_movements_order ON inventory_movements(order_id);

CREATE TABLE IF NOT EXISTS price_history (
 id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), variant_sku TEXT,
 old_price_minor INTEGER, new_price_minor INTEGER, old_cost_minor INTEGER, new_cost_minor INTEGER,
 source TEXT NOT NULL, actor_id TEXT REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS price_history_product ON price_history(product_id,created_at);

CREATE TABLE IF NOT EXISTS wishlist_items (
 id TEXT PRIMARY KEY, wishlist_id TEXT NOT NULL REFERENCES wishlists(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id,product_id)
);
CREATE TABLE IF NOT EXISTS recently_viewed (
 id TEXT PRIMARY KEY, owner_key TEXT NOT NULL, product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 viewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS recently_viewed_owner ON recently_viewed(owner_key,viewed_at DESC);

CREATE TABLE IF NOT EXISTS order_items (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
 product_id TEXT NOT NULL REFERENCES products(id), name TEXT NOT NULL, sku TEXT NOT NULL,
 variant_sku TEXT, variant_name TEXT, image TEXT, unit_price_minor INTEGER NOT NULL,
 unit_cost_minor INTEGER NOT NULL DEFAULT 0, quantity INTEGER NOT NULL, line_total_minor INTEGER NOT NULL,
 supplier_id TEXT, supplier_sku TEXT, supplier_product_id TEXT,
 fulfilment_status TEXT NOT NULL DEFAULT 'pending', supplier_order_id TEXT
);
CREATE INDEX IF NOT EXISTS order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS order_items_product ON order_items(product_id);
CREATE INDEX IF NOT EXISTS order_items_supplier ON order_items(supplier_id);

CREATE TABLE IF NOT EXISTS payments (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), provider TEXT NOT NULL,
 provider_order_id TEXT, provider_payment_id TEXT, amount_minor INTEGER NOT NULL, currency TEXT NOT NULL,
 base_amount_minor INTEGER NOT NULL, status TEXT NOT NULL, method TEXT, fee_minor INTEGER, net_minor INTEGER,
 settlement_ref TEXT, dispute_ref TEXT, signature_verified INTEGER, gateway_response_summary TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS payments_order ON payments(order_id);
CREATE INDEX IF NOT EXISTS payments_provider_order ON payments(provider_order_id);
CREATE INDEX IF NOT EXISTS payments_provider_payment ON payments(provider_payment_id);

CREATE TABLE IF NOT EXISTS payment_events (
 id TEXT PRIMARY KEY, provider TEXT NOT NULL, event_id TEXT NOT NULL, event_type TEXT NOT NULL,
 order_id TEXT REFERENCES orders(id), payment_id TEXT REFERENCES payments(id), signature_valid INTEGER NOT NULL,
 payload_json TEXT NOT NULL, processed INTEGER NOT NULL DEFAULT 0, processing_error TEXT,
 received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, processed_at TEXT, UNIQUE(provider,event_id)
);
CREATE INDEX IF NOT EXISTS payment_events_order ON payment_events(order_id);

CREATE TABLE IF NOT EXISTS refunds (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), payment_id TEXT REFERENCES payments(id),
 amount_minor INTEGER NOT NULL, currency TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL,
 provider_refund_id TEXT, requested_by TEXT REFERENCES users(id), notes TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS refunds_order ON refunds(order_id);

CREATE TABLE IF NOT EXISTS shipments (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), carrier TEXT NOT NULL,
 tracking_number TEXT NOT NULL, tracking_url TEXT, status TEXT NOT NULL, events_json TEXT NOT NULL DEFAULT '[]',
 estimated_delivery TEXT, shipped_at TEXT, delivered_at TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS shipments_order ON shipments(order_id);

CREATE TABLE IF NOT EXISTS return_requests (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), user_id TEXT REFERENCES users(id),
 email TEXT NOT NULL, type TEXT NOT NULL, order_item_ids_json TEXT NOT NULL DEFAULT '[]',
 reason TEXT NOT NULL, description TEXT, status TEXT NOT NULL DEFAULT 'requested',
 refund_id TEXT REFERENCES refunds(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS return_requests_order ON return_requests(order_id);
CREATE INDEX IF NOT EXISTS return_requests_user ON return_requests(user_id,created_at);
CREATE INDEX IF NOT EXISTS return_requests_status ON return_requests(status,created_at);

CREATE TABLE IF NOT EXISTS suppliers (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, website TEXT, country TEXT NOT NULL,
 contact_email TEXT, contact_phone TEXT, currency TEXT NOT NULL, categories_json TEXT NOT NULL DEFAULT '[]',
 api_status TEXT NOT NULL DEFAULT 'not_configured', connector TEXT NOT NULL DEFAULT 'manual',
 supports_order_api INTEGER NOT NULL DEFAULT 0, supports_stock_sync INTEGER NOT NULL DEFAULT 0,
 supports_price_sync INTEGER NOT NULL DEFAULT 0, supports_product_api INTEGER NOT NULL DEFAULT 0,
 import_methods_json TEXT NOT NULL DEFAULT '[]', processing_time_days INTEGER, shipping_regions_json TEXT,
 return_policy TEXT, notes TEXT, last_sync_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS suppliers_name ON suppliers(name);

CREATE TABLE IF NOT EXISTS supplier_connections (
 id TEXT PRIMARY KEY, supplier_id TEXT NOT NULL REFERENCES suppliers(id), label TEXT NOT NULL,
 auth_type TEXT NOT NULL, env_vars_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'not_configured',
 last_checked_at TEXT, last_error TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS supplier_connections_supplier ON supplier_connections(supplier_id);
CREATE INDEX IF NOT EXISTS supplier_connections_status ON supplier_connections(status);

CREATE TABLE IF NOT EXISTS supplier_products (
 id TEXT PRIMARY KEY, supplier_id TEXT NOT NULL REFERENCES suppliers(id), supplier_product_id TEXT NOT NULL,
 supplier_sku TEXT NOT NULL, product_id TEXT REFERENCES products(id), title TEXT NOT NULL,
 cost_minor INTEGER NOT NULL, currency TEXT NOT NULL, stock INTEGER NOT NULL DEFAULT 0,
 availability TEXT NOT NULL DEFAULT 'unknown', shipping_estimate_minor INTEGER, delivery_estimate_days INTEGER,
 ships_to_json TEXT, source_url TEXT, last_synced_at TEXT NOT NULL, raw_summary TEXT,
 UNIQUE(supplier_id,supplier_product_id)
);
CREATE INDEX IF NOT EXISTS supplier_products_sku ON supplier_products(supplier_id,supplier_sku);
CREATE INDEX IF NOT EXISTS supplier_products_product ON supplier_products(product_id);

CREATE TABLE IF NOT EXISTS supplier_sync_jobs (
 id TEXT PRIMARY KEY, supplier_id TEXT NOT NULL REFERENCES suppliers(id), type TEXT NOT NULL, status TEXT NOT NULL,
 scheduled_for TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3,
 last_error TEXT, result_summary TEXT, started_at TEXT, finished_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS supplier_sync_jobs_status ON supplier_sync_jobs(status,scheduled_for);

CREATE TABLE IF NOT EXISTS supplier_orders (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), supplier_id TEXT NOT NULL REFERENCES suppliers(id),
 order_item_ids_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
 supplier_order_id TEXT, request_summary TEXT, response_summary TEXT, attempts INTEGER NOT NULL DEFAULT 0,
 last_error TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS supplier_orders_order ON supplier_orders(order_id);
CREATE INDEX IF NOT EXISTS supplier_orders_status ON supplier_orders(status,created_at);

CREATE TABLE IF NOT EXISTS import_jobs (
 id TEXT PRIMARY KEY, type TEXT NOT NULL, file_name TEXT, file_size_bytes INTEGER, row_count INTEGER NOT NULL DEFAULT 0,
 valid_rows INTEGER NOT NULL DEFAULT 0, invalid_rows INTEGER NOT NULL DEFAULT 0, created_rows INTEGER NOT NULL DEFAULT 0,
 updated_rows INTEGER NOT NULL DEFAULT 0, skipped_rows INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL,
 mode TEXT NOT NULL, publish INTEGER NOT NULL DEFAULT 0, supplier_id TEXT REFERENCES suppliers(id),
 default_currency TEXT NOT NULL DEFAULT 'INR', mapping_json TEXT, error_report_csv TEXT,
 created_by TEXT REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 started_at TEXT, finished_at TEXT, rollback_of TEXT REFERENCES import_jobs(id), notes TEXT
);
CREATE INDEX IF NOT EXISTS import_jobs_status ON import_jobs(status,created_at);
CREATE TABLE IF NOT EXISTS import_job_rows (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
 row_number INTEGER NOT NULL, raw_json TEXT NOT NULL, normalized_json TEXT, status TEXT NOT NULL,
 errors_json TEXT NOT NULL DEFAULT '[]', warnings_json TEXT NOT NULL DEFAULT '[]',
 product_id TEXT REFERENCES products(id), sku TEXT, supplier_sku TEXT, previous_snapshot TEXT
);
CREATE INDEX IF NOT EXISTS import_job_rows_job ON import_job_rows(job_id,row_number);
CREATE INDEX IF NOT EXISTS import_job_rows_status ON import_job_rows(job_id,status);

CREATE TABLE IF NOT EXISTS coupons (
 id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, description TEXT, type TEXT NOT NULL, value REAL NOT NULL,
 currency TEXT NOT NULL DEFAULT 'INR', min_order_minor INTEGER NOT NULL DEFAULT 0, max_discount_minor INTEGER,
 usage_limit INTEGER, used_count INTEGER NOT NULL DEFAULT 0, per_user_limit INTEGER, starts_at TEXT, ends_at TEXT,
 status TEXT NOT NULL DEFAULT 'active', applies_to_category_ids_json TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS coupon_redemptions (
 id TEXT PRIMARY KEY, coupon_id TEXT NOT NULL REFERENCES coupons(id), code TEXT NOT NULL,
 user_id TEXT REFERENCES users(id), email TEXT NOT NULL, order_id TEXT NOT NULL REFERENCES orders(id),
 discount_minor INTEGER NOT NULL, redeemed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS coupon_redemptions_order ON coupon_redemptions(order_id);

CREATE TABLE IF NOT EXISTS reviews (
 id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), user_id TEXT NOT NULL REFERENCES users(id),
 order_id TEXT REFERENCES orders(id), rating INTEGER NOT NULL, title TEXT, body TEXT,
 status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS reviews_product ON reviews(product_id,status);
CREATE INDEX IF NOT EXISTS reviews_status ON reviews(status,created_at);

CREATE TABLE IF NOT EXISTS notifications (
 id TEXT PRIMARY KEY, audience TEXT NOT NULL, user_id TEXT REFERENCES users(id), type TEXT NOT NULL,
 title TEXT NOT NULL, body TEXT NOT NULL, link TEXT, order_id TEXT REFERENCES orders(id),
 read_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id,created_at);
CREATE INDEX IF NOT EXISTS notifications_audience ON notifications(audience,created_at);

CREATE TABLE IF NOT EXISTS support_tickets (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, subject TEXT NOT NULL, message TEXT NOT NULL,
 topic TEXT NOT NULL, order_number TEXT, user_id TEXT REFERENCES users(id), status TEXT NOT NULL DEFAULT 'open',
 replies_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS support_tickets_status ON support_tickets(status,created_at);
CREATE INDEX IF NOT EXISTS support_tickets_email ON support_tickets(email,created_at);

CREATE TABLE IF NOT EXISTS audit_logs (
 id TEXT PRIMARY KEY, actor_id TEXT REFERENCES users(id), actor_email TEXT, action TEXT NOT NULL,
 entity TEXT NOT NULL, entity_id TEXT, summary TEXT, metadata_json TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS audit_logs_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS audit_logs_entity ON audit_logs(entity,entity_id);

CREATE TABLE IF NOT EXISTS site_settings (
 id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, value_json TEXT NOT NULL,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_by TEXT REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS analytics_events (
 id TEXT PRIMARY KEY, type TEXT NOT NULL, path TEXT, product_id TEXT REFERENCES products(id),
 order_id TEXT REFERENCES orders(id), visitor_key TEXT, meta TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS analytics_events_type ON analytics_events(type,created_at);
CREATE INDEX IF NOT EXISTS analytics_events_created ON analytics_events(created_at);
