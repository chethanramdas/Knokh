import {logout} from "../../lib/auth";
interface Env{DB:D1Database}
export const onRequestPost=({request,env}:{request:Request;env:Env})=>logout(request,env);