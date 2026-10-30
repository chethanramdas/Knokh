import {currentUser,json} from "../../lib/auth";
interface Env{DB:D1Database}
export const onRequestGet=async({request,env}:{request:Request;env:Env})=>json({user:await currentUser(request,env)});