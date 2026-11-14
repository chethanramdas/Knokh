import { Pool } from 'pg';
import { readConfig } from './config.js';
import { createAuth } from './auth.js';
import { createApp } from './app.js';
const config = readConfig();
const pool = new Pool({connectionString:config.DATABASE_URL,max:10,connectionTimeoutMillis:5000});
const app = createApp(config,createAuth(pool,config),async () => {await pool.query('SELECT 1')});
const server = app.listen(config.PORT,()=>console.log(`KNOKH API listening on ${config.PORT}`));
for (const signal of ['SIGTERM','SIGINT']) process.on(signal,()=>{
  server.close(()=>{void pool.end().then(()=>process.exit(0))});
  setTimeout(()=>process.exit(1),10000).unref();
});
