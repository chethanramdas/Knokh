interface D1Result<T>{results:T[];success:boolean}interface D1Statement{bind(...values:unknown[]):D1Statement;all<T=Record<string,unknown>>():Promise<D1Result<T>>;first<T=Record<string,unknown>>():Promise<T|null>}interface D1Database{prepare(query:string):D1Statement}interface Env{DB?:D1Database}
type ProductRow={id:string;sku:string;slug:string;name:string;summary:string|null;description:string|null;images_json:string;price_minor:number;compare_at_minor:number|null;currency:string;stock:number;status:string;featured:number;rating_avg:number|null;rating_count:number;units_sold:number;category_id:string|null;subcategory_id:string|null;brand_id:string|null;updated_at:string};
function arr(v:string|null):unknown[]{if(!v)return[];try{const x=JSON.parse(v);return Array.isArray(x)?x:[]}catch{return[]}}
const json=(x:unknown,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{"content-type":"application/json; charset=utf-8","cache-control":"public, max-age=30, stale-while-revalidate=60"}});
export const onRequestGet=async({request,env}:{request:Request;env:Env})=>{
 if(!env.DB)return json({error:"Catalog database is not configured"},503);
 const u=new URL(request.url),page=Math.max(1,Math.min(10000,Number(u.searchParams.get("page")||1))),perPage=Math.max(1,Math.min(48,Number(u.searchParams.get("perPage")||24)));
 const where=["p.status='published'"],values:unknown[]=[];const q=(u.searchParams.get("q")||"").trim().slice(0,120);
 if(q){where.push("(p.name LIKE ? OR p.search_text LIKE ? OR p.sku LIKE ?)");values.push("%"+q+"%","%"+q+"%","%"+q+"%");}
 const categorySlug=u.searchParams.get("categorySlug"),subcategorySlug=u.searchParams.get("subcategorySlug"),brandSlug=u.searchParams.get("brandSlug"),collectionSlug=u.searchParams.get("collectionSlug");
 if(categorySlug){where.push("(p.category_id=(SELECT id FROM categories WHERE slug=? AND status='active') OR p.subcategory_id IN (SELECT id FROM categories WHERE parent_id=(SELECT id FROM categories WHERE slug=? AND status='active') AND status='active'))");values.push(categorySlug,categorySlug);}
 if(subcategorySlug){where.push("p.subcategory_id=(SELECT id FROM categories WHERE slug=? AND status='active')");values.push(subcategorySlug);}
 if(brandSlug){where.push("p.brand_id=(SELECT id FROM brands WHERE slug=? AND status='active')");values.push(brandSlug);}
 if(collectionSlug){where.push("EXISTS(SELECT 1 FROM collections c,json_each(c.product_ids_json) j WHERE c.slug=? AND c.status='active' AND j.value=p.id)");values.push(collectionSlug);}
 const categoryId=u.searchParams.get("categoryId"),brandId=u.searchParams.get("brandId");
 if(categoryId){where.push("(p.category_id=? OR p.subcategory_id=?)");values.push(categoryId,categoryId);}
 if(brandId){where.push("p.brand_id=?");values.push(brandId);}
 const min=u.searchParams.get("minMinor"),max=u.searchParams.get("maxMinor");
 if(min!==null&&Number.isFinite(Number(min))){where.push("p.price_minor>=?");values.push(Number(min));}
 if(max!==null&&Number.isFinite(Number(max))){where.push("p.price_minor<=?");values.push(Number(max));}
 if(u.searchParams.get("inStockOnly")==="true")where.push("p.stock>0");
 if(u.searchParams.get("onSaleOnly")==="true")where.push("p.compare_at_minor>p.price_minor");
 if(u.searchParams.get("featured")==="true")where.push("p.featured=1");
 const sort=u.searchParams.get("sort"),order=sort==="price_asc"?"p.price_minor ASC":sort==="price_desc"?"p.price_minor DESC":sort==="popular"?"p.units_sold DESC":sort==="rating"?"p.rating_avg DESC":"p.updated_at DESC";
 const clause=where.join(" AND ");
 try{
 const count=await env.DB.prepare("SELECT COUNT(*) AS total FROM products p WHERE "+clause).bind(...values).first<{total:number}>();
 const total=Number(count?.total||0),offset=(page-1)*perPage;
 const result=await env.DB.prepare("SELECT p.id,p.sku,p.slug,p.name,p.summary,p.description,p.images_json,p.price_minor,p.compare_at_minor,p.currency,p.stock,p.status,p.featured,p.rating_avg,p.rating_count,p.units_sold,p.category_id,p.subcategory_id,p.brand_id,p.updated_at FROM products p WHERE "+clause+" ORDER BY "+order+" LIMIT ? OFFSET ?").bind(...values,perPage,offset).all<ProductRow>();
 const items=result.results.map(p=>{const images=arr(p.images_json);const first=images[0] as {url?:string;alt?:string}|string|undefined;return{_id:p.id,id:p.id,sku:p.sku,slug:p.slug,name:p.name,summary:p.summary??undefined,description:p.description??undefined,images,image:typeof first==="string"?first:first?.url,priceMinor:p.price_minor,compareAtMinor:p.compare_at_minor??undefined,discountPercent:p.compare_at_minor&&p.compare_at_minor>p.price_minor?Math.round((1-p.price_minor/p.compare_at_minor)*100):null,currency:p.currency,stock:p.stock,inStock:p.stock>0,status:p.status,badge:p.featured?"Featured":undefined,featured:Boolean(p.featured),categoryId:p.category_id??undefined,subcategoryId:p.subcategory_id??undefined,brandId:p.brand_id??undefined,ratingAvg:p.rating_avg??undefined,ratingCount:p.rating_count,unitsSold:p.units_sold,isDemo:false,deliveryEstimateDays:7,shipsTo:[],hasVariants:false,variantCount:0,updatedAt:p.updated_at};});
 return json({items,products:items,total,page,perPage,totalPages:Math.max(1,Math.ceil(total/perPage)),hasMore:offset+items.length<total,scannedLimitReached:false});
 }catch{return json({error:"Unable to load products"},500)}
};
