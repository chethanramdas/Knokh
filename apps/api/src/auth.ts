import { betterAuth } from 'better-auth';
import { emailOTP } from 'better-auth/plugins';
import type { Pool } from 'pg';
import type { Config } from './config.js';
import { sendEmail } from './email.js';
export function createAuth(pool: Pool, config: Config, deliver: typeof sendEmail = sendEmail) {
  return betterAuth({
    database: pool, secret: config.AUTH_SECRET, baseURL: config.BETTER_AUTH_URL,
    trustedOrigins: [config.FRONTEND_URL],
    emailAndPassword: {enabled:true,minPasswordLength:12,maxPasswordLength:128, requireEmailVerification:true,
      sendResetPassword: async ({user,url}) => deliver(user.email,'Reset your KNOKH password',url)},
    emailVerification: {sendOnSignUp:true, sendVerificationEmail: async ({user,url}) => deliver(user.email,'Verify your KNOKH email',url)},
    plugins: [emailOTP({otpLength:6,expiresIn:900,allowedAttempts:5,storeOTP:'hashed',resendStrategy:'rotate',rateLimit:{window:60,max:3},sendVerificationOTP: async ({email,otp}) => deliver(email,'Your KNOKH verification code',`Your code is ${otp}.`)})],
    session: {expiresIn: 60 * 60 * 24 * 7, updateAge:60 * 60 * 24},
    advanced: {ipAddress:{ipAddressHeaders:['x-knokh-client-ip']},useSecureCookies: config.NODE_ENV === 'production'},
    rateLimit: {enabled:true, window:60, max:30},
  });
}
