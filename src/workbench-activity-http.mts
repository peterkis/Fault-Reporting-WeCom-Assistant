import {timingSafeEqual} from 'node:crypto';
import type {WorkbenchHttpOptions} from './p2-006-workbench-http.mjs';
import type {createWorkbenchActivity} from './workbench-activity.mjs';
import {activityTarget} from './workbench-activity.mjs';
import {failP2016} from './p2-016-domain-contracts.mjs';
type Context=Parameters<NonNullable<WorkbenchHttpOptions['authenticatedHandler']>>[0];
function same(left:unknown,right:unknown){
  if(typeof left!=='string'||typeof right!=='string'||!left.length||left.length>4096||right.length>4096)return false;
  const a=Buffer.from(left),b=Buffer.from(right);return a.length===b.length&&timingSafeEqual(a,b);
}
export function createWorkbenchActivityHttp(activity:ReturnType<typeof createWorkbenchActivity>|null){
  return async({request,response,url,authContext,json,readJson}:Context)=>{
    const command=url.pathname==='/api/workbench/activity',view=/^\/api\/workbench\/items\/(ticket|review|intake)\/([0-9a-f-]{36})\/activity$/iu.exec(url.pathname);
    if(!command&&!view)return false;
    if(!activity)failP2016('DISABLED',503);
    if(authContext.auth_method!=='COOKIE')failP2016('FORBIDDEN',403);
    if(url.searchParams.size)failP2016();
    if(command&&request.method==='POST'){
      if(request.headers.origin!==authContext.public_origin||request.headers['sec-fetch-site']==='cross-site'||!same(request.headers['x-csrf-token'],authContext.csrf_token))failP2016('FORBIDDEN',403);
      json(response,200,await activity.perform({authContext,body:await readJson(request)}));return true;
    }
    if(view&&request.method==='GET'){json(response,200,await activity.view(authContext,activityTarget({kind:view[1],id:view[2]})));return true;}
    failP2016('NOT_FOUND',404);
  };
}
