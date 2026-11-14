import type {Pool} from 'pg';
export async function bootstrapAdmin(pool:Pool,email:string){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  // Serialize competing setup commands without a publicly accessible endpoint.
  await client.query("SELECT pg_advisory_xact_lock(hashtext('knokh.first-admin'))");
  const previous=await client.query("SELECT 1 FROM admin_activity_logs WHERE action='admin.bootstrap' LIMIT 1");
  const admins=await client.query("SELECT 1 FROM staff_roles WHERE role='admin' LIMIT 1");
  if(previous.rowCount||admins.rowCount)throw new Error('Administrator bootstrap is permanently closed');
  const user=await client.query('SELECT id FROM "user" WHERE lower(email)=$1 AND "emailVerified"=true FOR UPDATE',[email.trim().toLowerCase()]);
  if(user.rowCount!==1)throw new Error('Exactly one verified account must exist before bootstrap');
  await client.query("INSERT INTO staff_roles(user_id,role) VALUES ($1,'admin') ON CONFLICT(user_id) DO UPDATE SET role='admin'",[user.rows[0].id]);
  await client.query("INSERT INTO admin_activity_logs(actor_id,action,entity_id) VALUES ($1,'admin.bootstrap',$1)",[user.rows[0].id]);
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}
