import {useEffect,useState,type FormEvent} from 'react';
import {Link,useLocation,useSearchParams} from 'react-router';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {selfHostedAuth,type Session} from '@/services/self-hosted-auth';
import {Loader2} from 'lucide-react';

type Mode='login'|'register'|'reset'|'finish';
export default function PasswordAuth(){
 const location=useLocation();const [params]=useSearchParams();
 const [mode,setMode]=useState<Mode>(location.pathname.endsWith('/reset-password')?'finish':'login');
 const [email,setEmail]=useState('');const [password,setPassword]=useState('');const [name,setName]=useState('');
 const [session,setSession]=useState<Session|null>(null);const [busy,setBusy]=useState(false);const [checking,setChecking]=useState(true);
 const [error,setError]=useState('');const [notice,setNotice]=useState('');
 useEffect(()=>{let active=true;selfHostedAuth.session().then(s=>{if(active)setSession(s)}).catch(()=>{if(active)setError('The account service is unavailable. Please try again later.')}).finally(()=>{if(active)setChecking(false)});return()=>{active=false}},[]);
 function choose(next:Mode){setMode(next);setPassword('');setError('');setNotice('')}
 async function submit(event:FormEvent){event.preventDefault();setBusy(true);setError('');setNotice('');try{
  if(mode==='login'){await selfHostedAuth.signIn(email,password);setSession(await selfHostedAuth.session())}
  if(mode==='register'){await selfHostedAuth.register(name,email,password);setNotice('Check your email to verify your account, then sign in.');setMode('login')}
  if(mode==='reset'){await selfHostedAuth.resetPassword(email);setNotice('If this address has an account, a password reset link will be sent.')}
  if(mode==='finish'){const token=params.get('token');if(!token)throw new Error('The reset link is missing or invalid. Request a new link.');await selfHostedAuth.finishReset(token,password);setMode('login');setNotice('Password changed. Sign in with your new password.')}
  setPassword('');
 }catch(e){setError(e instanceof Error?e.message:'Unable to complete the request.')}finally{setBusy(false)}}
 return <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-12">
  <Link to="/" aria-label="KNOKH home"><img src="/knokh-logo.png" alt="KNOKH" width={1774} height={887} className="mx-auto h-auto w-48 object-contain"/></Link>
  <section className="mt-6 rounded-xl border p-6">
   <h1 className="text-2xl font-bold tracking-tight">{session?'Your account':mode==='register'?'Create an account':mode==='reset'?'Reset password':mode==='finish'?'Choose a new password':'Sign in'}</h1>
   {checking?<Loader2 aria-label="Checking session" className="mt-4 size-5 animate-spin"/>:session?<div className="mt-4 space-y-4"><p>{session.user.email}</p><Link className="block underline" to="/migration/admin">Administrator access</Link><Button disabled={busy} onClick={async()=>{setBusy(true);try{await selfHostedAuth.signOut();setSession(null)}catch{setError('Could not sign out. Try again.')}finally{setBusy(false)}}}>Sign out</Button></div>:<form onSubmit={submit} className="mt-6 space-y-4">
    {mode==='register'?<label className="block text-sm">Name<Input value={name} onChange={e=>setName(e.target.value)} autoComplete="name" required maxLength={120} disabled={busy}/></label>:null}
    {mode!=='finish'?<label className="block text-sm">Email<Input type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" required disabled={busy}/></label>:null}
    {mode!=='reset'?<label className="block text-sm">Password<Input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete={mode==='login'?'current-password':'new-password'} minLength={mode==='login'?1:12} maxLength={128} required disabled={busy}/></label>:null}
    <Button type="submit" disabled={busy} className="w-full">{busy?<Loader2 className="mr-2 size-4 animate-spin"/>:null}{mode==='register'?'Create account':mode==='reset'?'Send reset link':mode==='finish'?'Save password':'Sign in'}</Button>
    <div className="flex flex-wrap gap-2">{mode!=='login'?<Button type="button" variant="ghost" disabled={busy} onClick={()=>choose('login')}>Back to sign in</Button>:<><Button type="button" variant="ghost" disabled={busy} onClick={()=>choose('register')}>Create account</Button><Button type="button" variant="ghost" disabled={busy} onClick={()=>choose('reset')}>Forgot password?</Button></>}</div>
   </form>}
   {notice?<p role="status" className="mt-4 text-sm">{notice}</p>:null}{error?<p role="alert" className="mt-4 text-sm text-destructive">{error}</p>:null}
  </section>
 </main>;
}
