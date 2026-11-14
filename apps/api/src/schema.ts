import {pgTable,uuid,text,integer,timestamp,uniqueIndex,index,check} from 'drizzle-orm/pg-core';
import {sql} from 'drizzle-orm';
export const categories=pgTable('categories',{
 id:uuid('id').defaultRandom().primaryKey(), name:text('name').notNull(),slug:text('slug').notNull().unique(),
});
export const products=pgTable('products',{
 id:uuid('id').defaultRandom().primaryKey(),name:text('name').notNull(),slug:text('slug').notNull(),
 description:text('description').notNull().default(''),status:text('status').notNull().default('draft'),
 categoryId:uuid('category_id').references(()=>categories.id,{onDelete:'set null'}),
 createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
 updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex('products_slug_unique').on(t.slug),index('products_category_status_idx').on(t.categoryId,t.status),check('products_status_valid',sql`${t.status} IN ('draft','published','archived')`)]);
export const variants=pgTable('product_variants',{
 id:uuid('id').defaultRandom().primaryKey(),productId:uuid('product_id').notNull().references(()=>products.id,{onDelete:'cascade'}),
 sku:text('sku').notNull().unique(),name:text('name').notNull(),priceMinor:integer('price_minor').notNull(),currency:text('currency').notNull(),
},t=>[index('variants_product_idx').on(t.productId),check('variant_price_nonnegative',sql`${t.priceMinor} >= 0`),check('variant_currency_valid',sql`${t.currency} ~ '^[A-Z]{3}$'`)]);
export const inventory=pgTable('product_inventory',{
 variantId:uuid('variant_id').primaryKey().references(()=>variants.id,{onDelete:'cascade'}),
 onHand:integer('on_hand').notNull().default(0),reserved:integer('reserved').notNull().default(0),
},t=>[check('inventory_valid',sql`${t.onHand} >= 0 AND ${t.reserved} >= 0 AND ${t.reserved} <= ${t.onHand}`)]);
