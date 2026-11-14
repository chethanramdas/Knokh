import {Pool} from 'pg';
import {readConfig} from './config.js';
import {bootstrapAdmin} from './admin-bootstrap.js';
const email=process.argv[2]?.trim().toLowerCase();
if(!email||!email.includes('@'))throw new Error('Usage: npm run admin:grant -- verified-owner@example.com');
const pool=new Pool({connectionString:readConfig().DATABASE_URL});
try{await bootstrapAdmin(pool,email);console.log('Administrator bootstrap completed and closed.')}finally{await pool.end()}
