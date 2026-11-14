export type Session = { user: { id:string; email:string; name:string }; session:{expiresAt:string} };
const base = (import.meta.env.VITE_API_URL || '').replace(/\/$/,'');
async function call<T>(path:string,body?:unknown):Promise<T> {
 const response=await fetch(`${base}/api/auth/${path}`,{method:body===undefined?'GET':'POST',credentials:'include',headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 if(!response.ok)throw new Error(response.status===429?'Too many attempts. Please wait before trying again.':'The request could not be completed. Check your details, verify your email, or try again shortly.');
 return await response.json() as T;
}
export const selfHostedAuth={
 signIn:(email:string,password:string)=>call('sign-in/email',{email,password}),
 register:(name:string,email:string,password:string)=>call('sign-up/email',{name,email,password,callbackURL:window.location.origin+'/migration/auth'}),
 resetPassword:(email:string)=>call('request-password-reset',{email,redirectTo:window.location.origin+'/migration/reset-password'}),
 finishReset:(token:string,newPassword:string)=>call('reset-password',{token,newPassword}),
 requestCode:(email:string)=>call('email-otp/send-verification-otp',{email,type:'sign-in'}),
 verifyCode:(email:string,otp:string)=>call('sign-in/email-otp',{email,otp}),
 session:()=>call<Session|null>('get-session'),
 signOut:()=>call('sign-out',{}),
};
