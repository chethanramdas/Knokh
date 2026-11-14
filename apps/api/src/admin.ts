import {Router} from 'express';
import {fromNodeHeaders} from 'better-auth/node';
import type {Pool} from 'pg';
import {z} from 'zod';
import type {createAuth} from './auth.js';
const productInput=z.object({name:z.string().trim().min(1).max(200),slug:z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(200),description:z.string().max(20000).default(''),status:z.enum(['draft','published','archived']).default('draft'),sku:z.string().trim().min(1).max(100),priceMinor:z.number().int().min(0).max(2147483647),currency:z.string().regex(/^[A-Z]{3}$/),stock:z.number().int().min(0).max(2147483647)}).strict();
export function adminRouter(pool:Pool,auth:ReturnType<typeof createAuth>,origin:string){
 const router=Router();
 router.use('/admin',async(req,res,next)=>{
  try{
   const session=await auth.api.getSession({headers:fromNodeHeaders(req.headers)});
   if(!session){res.status(401).json({error:{code:'UNAUTHENTICATED',message:'Sign in required'}});return}
   const role=await pool.query('SELECT role FROM staff_roles WHERE user_id=$1',[session.user.id]);
   if(!['admin','catalog_manager'].includes(role.rows[0]?.role)){res.status(403).json({error:{code:'FORBIDDEN',message:'Catalog staff access required'}});return}
   if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.get('Origin')!==origin){res.status(403).json({error:{code:'INVALID_ORIGIN',message:'Request origin rejected'}});return}
   res.locals.actorId=session.user.id;next();
  }catch(e){next(e)}
 });
 router.post('/admin/products',async(req,res,next)=>{
  const input=productInput.safeParse(req.body);
  if(!input.success){res.status(400).json({error:{code:'INVALID_PRODUCT',message:'Product fields are invalid'}});return}
  const p=input.data;const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const product=await client.query('INSERT INTO products(name,slug,description,status) VALUES ($1,$2,$3,$4) RETURNING id',[p.name,p.slug,p.description,p.status]);
   const id=product.rows[0].id;
   const variant=await client.query('INSERT INTO product_variants(product_id,sku,name,price_minor,currency) VALUES ($1,$2,$3,$4,$5) RETURNING id',[id,p.sku,'Default',p.priceMinor,p.currency]);
   await client.query('INSERT INTO product_inventory(variant_id,on_hand) VALUES ($1,$2)',[variant.rows[0].id,p.stock]);
   await client.query('INSERT INTO admin_activity_logs(actor_id,action,entity_id) VALUES ($1,$2,$3)',[res.locals.actorId,'product.create',id]);
   await client.query('COMMIT');res.status(201).json({data:{id}});
  }catch(e){await client.query('ROLLBACK');if((e as {code?:string}).code==='23505'){res.status(409).json({error:{code:'DUPLICATE_PRODUCT',message:'Slug or SKU already exists'}})}else next(e)}finally{client.release()}
 });
 router.patch('/admin/products/:id',async(req,res,next)=>{
  const id=z.string().uuid().safeParse(req.params.id);
  const input=productInput.pick({name:true,description:true,status:true}).partial().strict().refine(v=>Object.keys(v).length>0).safeParse(req.body);
  if(!id.success||!input.success){res.status(400).json({error:{code:'INVALID_PRODUCT',message:'Invalid product update'}});return}
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const result=await client.query('UPDATE products SET name=COALESCE($2,name),description=COALESCE($3,description),status=COALESCE($4,status),updated_at=NOW() WHERE id=$1 RETURNING id',[id.data,input.data.name,input.data.description,input.data.status]);
   if(!result.rows[0]){await client.query('ROLLBACK');res.status(404).json({error:{code:'NOT_FOUND',message:'Product not found'}});return}
   await client.query('INSERT INTO admin_activity_logs(actor_id,action,entity_id) VALUES ($1,$2,$3)',[res.locals.actorId,'product.update',id.data]);
   await client.query('COMMIT');res.json({data:result.rows[0]});
  }catch(e){await client.query('ROLLBACK');next(e)}finally{client.release()}
 });
 return router;
}
