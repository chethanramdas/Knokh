interface Env { DB: D1Database }
type Ctx = { request: Request; env: Env };
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const keyOk=(v:string|null)=>!!v&&/^[a-f0-9-]{16,80}$/i.test(v);
export const onRequestGet=async({request,env}:Ctx)=>{
 const u=new URL(request.url), owner=u.searchParams.get("guestKey");
 if(!keyOk(owner)) return json({error:"A valid guest cart key is required."},400);
 let cart=await env.DB.prepare("SELECT id,currency,coupon_code FROM carts WHERE owner_key=? AND status='active'").bind(owner).first<any>();
 if(!cart){const id=crypto.randomUUID();await env.DB.prepare("INSERT INTO carts(id,owner_key,currency) VALUES(?,?,'INR')").bind(id,owner).run();cart={id,currency:"INR",coupon_code:null};}
 const {results=[]}=await env.DB.prepare(`SELECT ci.id,ci.product_id,ci.variant_sku,ci.quantity,p.name,p.slug,p.sku,p.price_minor,p.compare_at_minor,p.currency,p.stock,p.images_json,p.status FROM cart_items ci JOIN products p ON p.id=ci.product_id WHERE ci.cart_id=? ORDER BY ci.added_at`).bind(cart.id).all<any>();
 return json({id:cart.id,currency:cart.currency,items:results.map(x=>({...x,images:JSON.parse(x.images_json||"[]")}))});
};
export const onRequestPost=async({request,env}:Ctx)=>{
 let body:any;try{body=await request.json()}catch{return json({error:"Invalid JSON body."},400)}
 const {guestKey,productId,variantSku,quantity,action}=body??{};
 if(!keyOk(guestKey))return json({error:"A valid guest cart key is required."},400);
 if(action==="clear"){
 const c=await env.DB.prepare("SELECT id FROM carts WHERE owner_key=? AND status='active'").bind(guestKey).first<any>();
 if(c)await env.DB.prepare("DELETE FROM cart_items WHERE cart_id=?").bind(c.id).run();
 return json({ok:true});
 }
 if(typeof productId!=="string"||!Number.isInteger(quantity)||quantity<1||quantity>99)return json({error:"Product and quantity (1–99) are required."},400);
 const product=await env.DB.prepare("SELECT id,stock,status FROM products WHERE id=?").bind(productId).first<any>();
 if(!product||product.status!=="published")return json({error:"Product is unavailable."},404);
 if(quantity>product.stock)return json({error:"Requested quantity exceeds available stock."},409);
 let c=await env.DB.prepare("SELECT id FROM carts WHERE owner_key=? AND status='active'").bind(guestKey).first<any>();
 if(!c){const id=crypto.randomUUID();await env.DB.prepare("INSERT INTO carts(id,owner_key,currency) VALUES(?,?,'INR')").bind(id,guestKey).run();c={id};}
 if(action==="remove"){
 await env.DB.prepare("DELETE FROM cart_items WHERE cart_id=? AND product_id=? AND COALESCE(variant_sku,'')=COALESCE(?,'')").bind(c.id,productId,variantSku??null).run();
 }else{
 await env.DB.prepare(`INSERT INTO cart_items(id,cart_id,product_id,variant_sku,quantity) VALUES(?,?,?,?,?) ON CONFLICT(cart_id,product_id,variant_sku) DO UPDATE SET quantity=excluded.quantity`).bind(crypto.randomUUID(),c.id,productId,variantSku??null,quantity).run();
 }
 return json({ok:true});
};