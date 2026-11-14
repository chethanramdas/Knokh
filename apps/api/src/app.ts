import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { toNodeHandler } from 'better-auth/node';
import type { createAuth } from './auth.js';
import type { Config } from './config.js';
export function createApp(config: Config, auth: ReturnType<typeof createAuth>, checkDatabase: () => Promise<void>) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({origin:config.FRONTEND_URL,credentials:true}));
  app.get('/health/live', (_req,res) => {res.json({data:{status:'ok'}})});
  app.get('/health/ready', async (_req,res) => {
    try { await checkDatabase(); res.json({data:{status:'ready'}}); }
    catch {res.status(503).json({error:{code:'DATABASE_UNAVAILABLE',message:'Database is unavailable'}})}
  });
  app.use('/api',rateLimit({windowMs:60000,limit:120,standardHeaders:'draft-8',legacyHeaders:false}));
  app.all('/api/auth/*splat',toNodeHandler(auth));
  app.use(express.json({limit:'1mb'}));
  app.use((_req,res) => {res.status(404).json({error:{code:'NOT_FOUND',message:'Endpoint not found'}})});
  const errors: ErrorRequestHandler = (err,_req,res,_next) => {
    const status = err?.type === 'entity.too.large' ? 413 : err instanceof SyntaxError ? 400 : 500;
    res.status(status).json({error:{code: status===500?'INTERNAL_ERROR':'INVALID_REQUEST',message:status===500?'Request could not be completed':'Invalid request body'}});
  };
  app.use(errors);
  return app;
}
