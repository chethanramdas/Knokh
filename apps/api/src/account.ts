import {Router} from 'express';
import {fromNodeHeaders} from 'better-auth/node';
import type {Pool} from 'pg';
import {z} from 'zod';
import type {createAuth} from './auth.js';
export function accountRouter(pool:Pool,auth:ReturnType<typeof createAuth>,origin:string){
 const router=Router();
 router.use('/account',async(req,res,next)=>{
  try{
   const session=await auth.api.getSession({headers:fromNodeHeaders(req.headers)});
   if(!session){res.status(401).json({error:{code:'UNAUTHENTICATED',message:'Sign in required'}});return}
   if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.get('Origin')!==origin){res.status(403).json({error:{code:'INVALID_ORIGIN',message:'Request origin rejected'}});return}
   res.locals.user=session.user;next();
  }catch(e){next(e)}
 });
 router.get('/account/profile',async(_req,res,next)=>{
  try{
   const role=await pool.query('SELECT role FROM staff_roles WHERE user_id=$1',[res.locals.user.id]);
   res.json({data:{id:res.locals.user.id,name:res.locals.user.name,email:res.locals.user.email,emailVerified:res.locals.user.emailVerified,role:role.rows[0]?.role??'customer'}});
  }catch(e){next(e)}
 });
 router.patch('/account/profile',async(req,res,next)=>{
  const parsed=z.object({name:z.string().trim().min(2).max(120)}).strict().safeParse(req.body);
  if(!parsed.success){res.status(400).json({error:{code:'INVALID_PROFILE',message:'Enter a name between 2 and 120 characters'}});return}
  try{
   await pool.query('UPDATE "user" SET name=$1,"updatedAt"=NOW() WHERE id=$2',[parsed.data.name,res.locals.user.id]);
   res.json({data:{name:parsed.data.name}});
  }catch(e){next(e)}
 });
 return router;
}
