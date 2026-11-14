import {Pool} from 'pg';
import {getMigrations} from 'better-auth/db/migration';
import {readConfig} from './config.js';
import {createAuth} from './auth.js';
const config=readConfig();
const pool=new Pool({connectionString:config.DATABASE_URL});
try {
 const auth=createAuth(pool,config);
 const migration=await getMigrations(auth.options);
 await migration.runMigrations();
 console.log('Authentication schema migrated.');
} finally {await pool.end()}
