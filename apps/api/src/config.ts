import { z } from 'zod';
const schema = z.object({
  NODE_ENV: z.enum(['development','test','production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z.string().url().refine(v => /^postgres(ql)?:/.test(v), 'Use a PostgreSQL URL'),
  AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  FRONTEND_URL: z.string().url(),
});
export type Config = z.infer<typeof schema>;
export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) throw new Error('Invalid configuration: ' + result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  if (result.data.NODE_ENV === 'production' && [result.data.BETTER_AUTH_URL,result.data.FRONTEND_URL].some(u => !u.startsWith('https://'))) throw new Error('Production auth and frontend URLs must use HTTPS');
  return result.data;
}
