import {useCallback,useEffect,useState} from "react";
type Ref=string;
type QueryArgs=Record<string,unknown>|"skip"|undefined;
function urlFor(ref:Ref,args:Record<string,unknown>={}){const url=new URL("/api/convex/"+ref.replace(/\./g,"/"),window.location.origin);for(const [k,v] of Object.entries(args)){if(v!==undefined&&v!==null)url.searchParams.set(k,typeof v==="string"?v:JSON.stringify(v));}return url.toString();}
export function useQuery<T=any>(ref:Ref,args:QueryArgs={}):T|undefined{
 const skipped=args==="skip";const key=skipped?"skip":urlFor(ref,args as Record<string,unknown>);
 const [state,setState]=useState<{key:string;value:T|undefined}>({key,value:undefined});
 useEffect(()=>{if(skipped){setState({key:"skip",value:undefined});return;}let active=true;const controller=new AbortController();fetch(key,{credentials:"include",signal:controller.signal}).then(async r=>{const data=await r.json();if(!r.ok)throw new Error(data?.error||"Request failed");if(active)setState({key,value:data as T});}).catch(()=>{if(active)setState({key,value:undefined});});return()=>{active=false;controller.abort();};},[key,skipped]);
 return state.key===key?state.value:undefined;
}
export function useMutation<T=any>(ref:Ref){return useCallback(async(args:Record<string,unknown>={})=>{const response=await fetch("/api/convex/"+ref.replace(/\./g,"/"),{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify(args)});const data=await response.json();if(!response.ok)throw new Error(data?.error||"Request failed");return data as T;},[ref]);}
export const useAction=useMutation;
