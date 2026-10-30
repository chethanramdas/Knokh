import {useCallback,useEffect,useState} from "react";
type User={_id:string;id:string;name?:string;email?:string;role?:string;defaultCurrency?:string}|null;
export function useAuth(){
 const [user,setUser]=useState<User>(null);const [isLoading,setLoading]=useState(true);
 const refresh=useCallback(async()=>{try{const r=await fetch("/api/auth/me",{credentials:"include"});const d=await r.json();setUser(d.user??null);}catch{setUser(null)}finally{setLoading(false)}},[]);
 useEffect(()=>{void refresh();},[refresh]);
 const signOut=useCallback(async()=>{await fetch("/api/auth/logout",{method:"POST",credentials:"include"});setUser(null);},[]);
 const signIn=useCallback(async(provider:string,form:FormData)=>{const email=String(form.get("email")||"");if(provider==="anonymous"){const r=await fetch("/api/auth/guest",{method:"POST",credentials:"include"});if(!r.ok)throw new Error("Guest session could not be created.");await refresh();return;}const password=String(form.get("password")||"");const mode=String(form.get("flow")||"signIn");const r=await fetch(mode==="signUp"?"/api/auth/register":"/api/auth/login",{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({email,password,name:String(form.get("name")||"")})});const d=await r.json();if(!r.ok)throw new Error(d.error||"Sign-in failed.");await refresh();return d;},[refresh]);
 return {isLoading,isAuthenticated:!!user,user,signIn,signOut,refresh};
}
