import {Router} from 'express';
import type {Pool} from 'pg';
import {z} from 'zod';
export const catalogQuery=z.object({
 page:z.coerce.number().int().min(1).max(100000).default(1),
 pageSize:z.coerce.number().int().min(1).max(100).default(24),
 search:z.string().trim().max(150).optional(),
 category:z.string().uuid().optional(),
 minPrice:z.coerce.number().int().nonnegative().optional(),
 maxPrice:z.coerce.number().int().nonnegative().optional(),
 currency:z.string().regex(/^[A-Z]{3}$/).default('INR'),
 inStock:z.enum(['true','false']).optional(),
 sort:z.enum(['newest','price_asc','price_desc']).default('newest'),
}).refine(v=>v.minPrice===undefined||v.maxPrice===undefined||v.minPrice<=v.maxPrice,{message:'Minimum price exceeds maximum price'});
export function catalogRouter(pool:Pool){
 const router=Router();
 router.get('/categories',async(_req,res,next)=>{
  try {const result=await pool.query('SELECT id,name,slug FROM categories ORDER BY name,id');res.json({data:result.rows})}catch(e){next(e)}
 });
 router.get('/products',async(req,res,next)=>{
  const parsed=catalogQuery.safeParse(req.query);
  if(!parsed.success){res.status(400).json({error:{code:'INVALID_QUERY',message:'Invalid product filters'}});return}
  const q=parsed.data;
  const values:unknown[]=[q.currency];
  const conditions=["p.status='published'","v.currency=$1"];
  const bind=(value:unknown)=>{values.push(value);return `$${values.length}`};
  if(q.search)conditions.push(`p.name ILIKE ${bind('%'+q.search.replace(/[\\%_]/g,'\\$&')+'%')}`);
  if(q.category)conditions.push(`p.category_id=${bind(q.category)}`);
  if(q.minPrice!==undefined)conditions.push(`v.price_minor>=${bind(q.minPrice)}`);
  if(q.maxPrice!==undefined)conditions.push(`v.price_minor<=${bind(q.maxPrice)}`);
  if(q.inStock==='true')conditions.push('COALESCE(i.on_hand-i.reserved,0)>0');
  const order=q.sort==='price_asc'?'price_minor ASC,id':q.sort==='price_desc'?'price_minor DESC,id':'created_at DESC,id';
  const limit=bind(q.pageSize);const offset=bind((q.page-1)*q.pageSize);
  try{
   const result=await pool.query(`SELECT p.id,p.name,p.slug,p.description,p.category_id,p.created_at,
    MIN(v.price_minor)::int AS price_minor,v.currency,
    SUM(GREATEST(COALESCE(i.on_hand-i.reserved,0),0))::int AS available_stock,
    COUNT(*) OVER()::int AS total_count
    FROM products p JOIN product_variants v ON v.product_id=p.id
    LEFT JOIN product_inventory i ON i.variant_id=v.id
    WHERE ${conditions.join(' AND ')} GROUP BY p.id,v.currency
    ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`,values);
   res.json({data:result.rows.map(({total_count,...product})=>product),pagination:{page:q.page,pageSize:q.pageSize,total:result.rows[0]?.total_count??0}});
  }catch(e){next(e)}
 });
 router.get('/products/:slug',async(req,res,next)=>{
  if(!/^[a-z0-9-]{1,200}$/.test(String(req.params.slug))){res.status(400).json({error:{code:'INVALID_SLUG',message:'Invalid product slug'}});return}
  try{
   const product=await pool.query("SELECT id,name,slug,description,category_id FROM products WHERE slug=$1 AND status='published'",[req.params.slug]);
   if(!product.rows[0]){res.status(404).json({error:{code:'NOT_FOUND',message:'Product not found'}});return}
   const variants=await pool.query('SELECT v.id,v.sku,v.name,v.price_minor,v.currency,GREATEST(COALESCE(i.on_hand-i.reserved,0),0)::int AS available_stock FROM product_variants v LEFT JOIN product_inventory i ON i.variant_id=v.id WHERE v.product_id=$1 ORDER BY v.id',[product.rows[0].id]);
   res.json({data:{...product.rows[0],variants:variants.rows}});
  }catch(e){next(e)}
 });
 return router;
}
