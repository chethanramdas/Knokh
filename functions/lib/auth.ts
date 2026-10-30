export interface AuthEnv { DB: D1Database }
export const json=(data:unknown,status=200,headers:Record<string,string>={})=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store",...headers}});
const enc=new TextEncoder();
const hex=(b:ArrayBuffer)=>Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,"0")).join("");
const b64url=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const randomToken=()=>{const b=new Uint8Array(32);crypto.getRandomValues(b);return b64url(b)};
const digest=async(s:string)=>hex(await crypto.subtle.digest("SHA-256",enc.encode(s)));
async function passwordHash(password:string){
 const salt=new Uint8Array(16);crypto.getRandomValues(salt);
 const key=await crypto.subtle.importKey("raw",enc.encode(password),"PBKDF2",false,["deriveBits"]);
 const bits=await crypto.subtle.deriveBits({name:"PBKDF2",salt,iterations:210000,hash:"SHA-256"},key,256);
 return "pbkdf2$210000$"+b64url(salt)+"$"+b64url(new Uint8Array(bits));
}
async function verifyPassword(password:string,stored:string){
 const [scheme,iterations,saltText,hashText]=stored.split("$");
 if(scheme!=="pbkdf2"||!/^\d+$/.test(iterations)||!saltText||!hashText)return false;
 const decode=(s:string)=>Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/")+"===".slice((s.length+3)%4)),c=>c.charCodeAt(0));
 const salt=decode(saltText),expected=decode(hashText);
 const key=await crypto.subtle.importKey("raw",enc.encode(password),"PBKDF2",false,["deriveBits"]);
 const actual=new Uint8Array(await crypto.subtle.deriveBits({name:"PBKDF2",salt,iterations:Number(iterations),hash:"SHA-256"},key,256));
 return actual.length===expected.length&&actual.every((v,i)=>v===expected[i]);
}
function cookie(request:Request,name:string){return (request.headers.get("cookie")||"").split(";").map(x=>x.trim()).find(x=>x.startsWith(name+"="))?.slice(name.length+1)||null}
export async function currentUser(request:Request,env:AuthEnv){
 const raw=cookie(request,"knokh_session");if(!raw)return null;
 const session=await env.DB.prepare("SELECT u.id,u.email,u.name,u.phone,u.role FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>CURRENT_TIMESTAMP AND u.deleted_at IS NULL").bind(await digest(raw)).first<any>();
 return session||null;
}
export async function register(request:Request,env:AuthEnv){
 let b:any;try{b=await request.json()}catch{return json({error:"Invalid request."},400)}
 const name=typeof b?.name==="string"?b.name.trim().slice(0,100):"",email=typeof b?.email==="string"?b.email.trim().toLowerCase():"",password=typeof b?.password==="string"?b.password:"";
 if(name.length<2||!/^\S+@\S+\.\S+$/.test(email)||password.length<10||password.length>128)return json({error:"Enter your name, a valid email and a password of at least 10 characters."},400);
 const exists=await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first();
 if(exists)return json({error:"An account with this email already exists."},409);
 const id=crypto.randomUUID(),hash=await passwordHash(password),token=randomToken(),expires=new Date(Date.now()+30*86400000).toISOString();
 await env.DB.batch([
 env.DB.prepare("INSERT INTO users(id,email,name,password_hash,role) VALUES(?,?,?,?,'customer')").bind(id,email,name,hash),
 env.DB.prepare("INSERT INTO profiles(user_id,full_name,marketing_consent) VALUES(?,?,0)").bind(id,name),
 env.DB.prepare("INSERT INTO auth_sessions(id,user_id,token_hash,expires_at) VALUES(?,?,?,?)").bind(crypto.randomUUID(),id,await digest(token),expires)
 ]);
 return json({ok:true,user:{id,email,name,role:"customer"}},201,{"set-cookie":`knokh_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`});
}
export async function login(request:Request,env:AuthEnv){
 let b:any;try{b=await request.json()}catch{return json({error:"Invalid request."},400)}
 const email=typeof b?.email==="string"?b.email.trim().toLowerCase():"",password=typeof b?.password==="string"?b.password:"";
 if(!email||!password)return json({error:"Email and password are required."},400);
 const user=await env.DB.prepare("SELECT id,email,name,role,password_hash FROM users WHERE email=? AND deleted_at IS NULL").bind(email).first<any>();
 if(!user?.password_hash||!(await verifyPassword(password,user.password_hash)))return json({error:"Email or password is incorrect."},401);
 const token=randomToken(),expires=new Date(Date.now()+30*86400000).toISOString();
 await env.DB.prepare("INSERT INTO auth_sessions(id,user_id,token_hash,expires_at) VALUES(?,?,?,?)").bind(crypto.randomUUID(),user.id,await digest(token),expires).run();
 return json({ok:true,user:{id:user.id,email:user.email,name:user.name,role:user.role}},200,{"set-cookie":`knokh_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`});
}
export async function logout(request:Request,env:AuthEnv){
 const raw=cookie(request,"knokh_session");if(raw)await env.DB.prepare("DELETE FROM auth_sessions WHERE token_hash=?").bind(await digest(raw)).run();
 return json({ok:true},200,{"set-cookie":"knokh_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0"});
}
