interface Env { DB: D1Database }
type Ctx={request:Request;env:Env};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const keyOk=(v:string)=>/^[a-f0-9-]{16,80}$/i.test(v);
const emailOk=(v:string)=>/^\S+@\S+\.\S+$/.test(v);
export const onRequestPost=async({request,env}:Ctx)=>{
 let b:any;try{b=await request.json()}catch{return json({error:"Invalid JSON body."},400)}
 const {guestKey,contact,shippingAddress,paymentMethod,notes}=b??{};
 if(typeof guestKey!=="string"||!keyOk(guestKey)||!contact||!shippingAddress||!["cod","bank_transfer"].includes(paymentMethod))return json({error:"Valid contact, shipping address and COD/manual bank transfer payment are required."},400);
 const required=["fullName","phone","line1","city","state","postalCode","countryCode","country"];
 if(required.some(k=>typeof shippingAddress[k]!=="string"||!shippingAddress[k].trim()))return json({error:"Complete shipping address is required."},400);
 if(typeof contact.email!=="string"||!emailOk(contact.email)||typeof contact.name!=="string"||!contact.name.trim()||typeof contact.phone!=="string"||!contact.phone.trim())return json({error:"Valid customer contact details are required."},400);
 const safeNotes=typeof notes==="string"?notes.trim().slice(0,1000):null;
 const cart=await env.DB.prepare("SELECT id FROM carts WHERE owner_key=? AND status='active'").bind(guestKey).first<any>();
 if(!cart)return json({error:"Your cart is empty."},400);
 const {results=[]}=await env.DB.prepare("SELECT ci.product_id,ci.quantity,p.sku,p.name,p.price_minor,p.currency,p.stock,p.status,p.images_json FROM cart_items ci JOIN products p ON p.id=ci.product_id WHERE ci.cart_id=?").bind(cart.id).all<any>();
 if(!results.length)return json({error:"Your cart is empty."},400);
 for(const item of results){if(item.status!=="published"||item.quantity>item.stock)return json({error:"One or more products are unavailable or have insufficient stock. Refresh your cart."},409);}
 const currency=results[0].currency;
 if(results.some(x=>x.currency!==currency))return json({error:"Cart contains products with mixed currencies."},409);
 const subtotal=results.reduce((n,x)=>n+x.price_minor*x.quantity,0);
 if(!Number.isSafeInteger(subtotal)||subtotal<0)return json({error:"Order total is invalid."},400);
 const id=crypto.randomUUID(),orderNumber="KN"+crypto.randomUUID().replace(/-/g,"").slice(0,12).toUpperCase();
 const total=subtotal;
 const items=results.map(x=>({productId:x.product_id,name:x.name,sku:x.sku,quantity:x.quantity,unitPriceMinor:x.price_minor,lineTotalMinor:x.price_minor*x.quantity,image:(JSON.parse(x.images_json||"[]")[0]?.url)||null}));
 // Reserve inventory first. D1 batch is transactional; if a conditional decrement
 // affects no row, compensate every successful decrement before returning 409.
 const stockStatements=results.map(x=>env.DB.prepare("UPDATE products SET stock=stock-?,units_sold=units_sold+?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='published' AND stock>=?").bind(x.quantity,x.quantity,x.product_id,x.quantity));
 let stockResults:any[];
 try{stockResults=await env.DB.batch(stockStatements);}catch{return json({error:"Could not reserve inventory. Please try again."},503);}
 const changed=stockResults.map((r:any)=>Number(r.meta?.changes||0));
 if(changed.some(n=>n!==1)){
   const undo=results.filter((_,i)=>changed[i]===1).map(x=>env.DB.prepare("UPDATE products SET stock=stock+?,units_sold=MAX(0,units_sold-?),updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(x.quantity,x.quantity,x.product_id));
   if(undo.length)await env.DB.batch(undo);
   return json({error:"Stock changed while placing your order. Please refresh and try again."},409);
 }
 try{
   await env.DB.batch([
     env.DB.prepare(`INSERT INTO orders(id,order_number,guest_email,customer_name,currency,base_currency,exchange_rate,subtotal_minor,discount_minor,shipping_minor,tax_minor,total_minor,status,payment_status,payment_provider,shipping_address_json,items_json,notes) VALUES(?,?,?,?,?, ?,1,?,0,0,0,?,'pending',?,?,?, ?,?)`).bind(id,orderNumber,contact.email,contact.name.trim(),currency,currency,subtotal,total,paymentMethod==="cod"?"cod_pending":"pending",paymentMethod,JSON.stringify(shippingAddress),JSON.stringify(items),safeNotes),
     env.DB.prepare("UPDATE carts SET status='converted',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='active'").bind(cart.id),
     env.DB.prepare("DELETE FROM cart_items WHERE cart_id=?").bind(cart.id)
   ]);
 }catch{
   const undo=results.map(x=>env.DB.prepare("UPDATE products SET stock=stock+?,units_sold=MAX(0,units_sold-?),updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(x.quantity,x.quantity,x.product_id));
   await env.DB.batch(undo);
   return json({error:"Order could not be saved. Inventory reservation was released; please try again."},503);
 }
 return json({ok:true,orderId:id,orderNumber,requiresPayment:false,paymentMethod,status:"pending"});
};
export const onRequestGet=async({request,env}:Ctx)=>{
 const u=new URL(request.url),orderNumber=u.searchParams.get("orderNumber"),email=u.searchParams.get("email");
 if(!orderNumber||!email)return json({error:"Order number and email are required."},400);
 const order=await env.DB.prepare("SELECT id,order_number,customer_name,currency,total_minor,status,payment_status,shipping_address_json,items_json,created_at FROM orders WHERE order_number=? AND lower(guest_email)=lower(?)").bind(orderNumber,email).first<any>();
 if(!order)return json({error:"Order not found."},404);
 return json({...order,shippingAddress:JSON.parse(order.shipping_address_json),items:JSON.parse(order.items_json)});
};
