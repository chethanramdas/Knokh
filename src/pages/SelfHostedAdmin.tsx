import {useEffect,useState} from 'react';
import {Link} from 'react-router';
import {Loader2} from 'lucide-react';
export default function SelfHostedAdmin(){
 const [status,setStatus]=useState<'loading'|'allowed'|'signin'|'denied'|'error'>('loading');
 useEffect(()=>{const abort=new AbortController();fetch(`${(import.meta.env.VITE_API_URL||'').replace(/\/$/,'')}/api/admin/access`,{credentials:'include',signal:abort.signal}).then(r=>setStatus(r.ok?'allowed':r.status===401?'signin':r.status===403?'denied':'error')).catch(()=>{if(!abort.signal.aborted)setStatus('error')});return()=>abort.abort()},[]);
 return <main className="mx-auto max-w-3xl px-4 py-16"><h1 className="text-2xl font-bold tracking-tight">Administrator access</h1>{status==='loading'?<Loader2 aria-label="Checking access" className="mt-6 animate-spin"/>:status==='allowed'?<p className="mt-6">Your staff access is verified by the server. The existing dashboard modules are still being migrated.</p>:status==='signin'?<p className="mt-6">Sign in to continue. <Link className="underline" to="/migration/auth">Sign in</Link></p>:<p role="alert" className="mt-6">{status==='denied'?'This account does not have administrator or catalog staff access.':'The account service is unavailable. Please try again later.'}</p>}</main>;
}
