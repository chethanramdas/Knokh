CREATE TABLE "admin_activity_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"entity_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_roles" (
	"user_id" text PRIMARY KEY,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_role_valid" CHECK ("role" IN ('admin','catalog_manager','support'))
);
--> statement-breakpoint
CREATE INDEX "audit_actor_time_idx" ON "admin_activity_logs" ("actor_id","created_at");--> statement-breakpoint
ALTER TABLE "product_inventory" DROP CONSTRAINT "inventory_valid", ADD CONSTRAINT "inventory_valid" CHECK ("on_hand" >= 0 AND "reserved" >= 0 AND "reserved" <= "on_hand");--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT "products_status_valid", ADD CONSTRAINT "products_status_valid" CHECK ("status" IN ('draft','published','archived'));--> statement-breakpoint
ALTER TABLE "product_variants" DROP CONSTRAINT "variant_price_nonnegative", ADD CONSTRAINT "variant_price_nonnegative" CHECK ("price_minor" >= 0);--> statement-breakpoint
ALTER TABLE "product_variants" DROP CONSTRAINT "variant_currency_valid", ADD CONSTRAINT "variant_currency_valid" CHECK ("currency" ~ '^[A-Z]{3}$');