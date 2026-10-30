import {login} from "../../lib/auth";
interface Env{DB:D1Database}
export const onRequestPost=({request,env}:{request:Request;env:Env})=>login(request,env);