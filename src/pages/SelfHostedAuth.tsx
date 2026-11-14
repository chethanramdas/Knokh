import {useEffect,useState,type FormEvent} from 'react';
import {Link} from 'react-router';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {selfHostedAuth,type Session} from '@/services/self-hosted-auth';
import {Loader2} from 'lucide-react';

/** Staging entry: never sends a PostgreSQL identity to the legacy backend. */
export default function SelfHostedAuth(){
 const [email,setEmail]=useState('');const [otp,setOtp]=useState('');
 const [sent,setSent]=useState(false);const [busy,setBusy]=useState(false);
 const [session,setSession]=useState<Session|null>(null);const [error,setError]=useState('');
 useEffect(()=>{let active=true;selfHostedAuth.session().then(s=>{if(active)setSession(s)}).catch(()=>{if(active)setError('The self-hosted API is unavailable. Check its address and database configuration.')});return()=>{active=false}},[]);
 async function submit(e:FormEvent){e.preventDefault();setBusy(true);setError('');try{
  if(sent){await selfHostedAuth.verifyCode(email,otp);setSession(await selfHostedAuth.session());setOtp('')}
  else{await selfHostedAuth.requestCode(email);setSent(true)}
 }catch(e){setError(e instanceof Error?e.message:'Sign-in failed')}finally{setBusy(false)}}
 return <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
  <Link to="/" aria-label="KNOKH home"><img src="/knokh-logo.png" alt="KNOKH" width={1774} height={887} className="mx-auto h-auto w-48 object-contain"/></Link>
  <section className="mt-6 rounded-xl border p-6">
   <h1 className="text-2xl font-bold tracking-tight">{session?'Signed in':'Sign in to KNOKH'}</h1>
   <p className="mt-2 text-sm text-muted-foreground">Self-hosted authentication staging. Storefront and order migration are still in progress.</p>
   {session?<div className="mt-6 space-y-4"><p>{session.user.email}</p><Button disabled={busy} onClick={async()=>{setBusy(true);try{await selfHostedAuth.signOut();setSession(null);setSent(false)}catch{setError('Could not sign out. Try again.')}finally{setBusy(false)}}}>Sign out</Button></div>:<form onSubmit={submit} className="mt-6 space-y-4">
    <label className="block text-sm">Email<Input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required disabled={busy||sent}/></label>
    {sent?<label className="block text-sm">Verification code<Input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} value={otp} onChange={e=>setOtp(e.target.value.replace(/\D/g,''))} required disabled={busy}/><span className="text-xs text-muted-foreground">The code expires in 15 minutes.</span></label>:null}
    <Button type="submit" disabled={busy} className="w-full">{busy?<Loader2 className="mr-2 size-4 animate-spin"/>:null}{sent?'Verify code':'Email me a code'}</Button>
    {sent?<Button type="button" variant="ghost" disabled={busy} onClick={()=>{setSent(false);setOtp('')}}>Change email or request a new code</Button>:null}
   </form>}
   {error?<p role="alert" className="mt-4 text-sm text-destructive">{error}</p>:null}
  </section>
 </main>;
}
