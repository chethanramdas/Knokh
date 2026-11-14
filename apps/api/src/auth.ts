import { betterAuth } from 'better-auth';
import { emailOTP } from 'better-auth/plugins';
import type { Pool } from 'pg';
import type { Config } from './config.js';
import { sendEmail } from './email.js';
export function createAuth(pool: Pool, config: Config) {
  return betterAuth({
    database: pool, secret: config.AUTH_SECRET, baseURL: config.BETTER_AUTH_URL,
    trustedOrigins: [config.FRONTEND_URL],
    emailAndPassword: {enabled:true, requireEmailVerification:true,
      sendResetPassword: async ({user,url}) => sendEmail(user.email,'Reset your KNOKH password',url)},
    emailVerification: {sendOnSignUp:true, sendVerificationEmail: async ({user,url}) => sendEmail(user.email,'Verify your KNOKH email',url)},
    plugins: [emailOTP({sendVerificationOTP: async ({email,otp}) => sendEmail(email,'Your KNOKH verification code',`Your code is ${otp}.`)})],
    session: {expiresIn: 60 * 60 * 24 * 7, updateAge:60 * 60 * 24},
    advanced: {useSecureCookies: config.NODE_ENV === 'production'},
    rateLimit: {enabled:true, window:60, max:30},
  });
}
