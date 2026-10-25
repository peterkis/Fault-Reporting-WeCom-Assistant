import assert from 'node:assert/strict';
import type {PostgresPool} from '../../app/server/src/platform/postgres-pool.mjs';
import {withWeb01Fixture} from './web01-workbench-fixture.mjs';
import {createP2016Runtime} from '../../app/server/src/p2-016-runtime.mjs';
import {createPilotAccessService} from '../../app/server/src/p1-009-pilot-access-workbench.mjs';
import {migrateWorkbenchPersonalRead} from '../../app/server/scripts/workbench-personal-read-migrate.mjs';
interface Base {origin:string;databaseUrl:string;pool:PostgresPool;runtime:{stop():Promise<unknown>};principals:{id:string}[];outsider:{id:string};tickets:{ticket:{id:string};intake:{intakeId:string}}[]}
export interface T35Fixture extends Base {firstCookie:string;secondCookie:string;outsiderCookie:string;browserCookie:{name:string;value:string;url:string|undefined;httpOnly:true;secure:boolean;sameSite:'Strict';expires:number};get:(path:string,reader?:0|1)=>Promise<Response>;post:(path:string,body:Record<string,unknown>,reader?:0|1)=>Promise<Response>}
export function withT35Fixture(run:(fixture:T35Fixture)=>Promise<void>,{enabled=true,migrate=true}:{enabled?:boolean;migrate?:boolean}={}){
  return withWeb01Fixture(async(f:Base)=>{
    await f.runtime.stop();
    if(migrate)await migrateWorkbenchPersonalRead({databaseUrl:f.databaseUrl,mode:'apply'});
    const second=await createPilotAccessService({pool:f.pool}).upsertPrincipal({wecomUserId:'web01-synthetic-1',displayName:'T35第二合成阅读者',roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});
    const runtime=createP2016Runtime({pool:f.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:f.origin,listenPort:Number(new URL(f.origin).port),principalIds:[f.principals[0]?.id??'',f.outsider.id,second.id],externalSendEnabled:false,workbenchManualReportsEnabled:true,workbenchManualReviewEnabled:true,workbenchConversationsEnabled:true,workbenchPersonalReadEnabled:enabled});
    try{
      const cookies=(await runtime.start()).cookies;assert.ok(cookies);const a=cookies[0],outsider=cookies[1],b=cookies[2];assert.ok(a);assert.ok(b);assert.ok(outsider);
      const firstCookie=a.name+'='+a.value,secondCookie=b.name+'='+b.value,outsiderCookie=outsider.name+'='+outsider.value;
      const get=(path:string,reader:0|1=0)=>fetch(f.origin+path,{headers:{cookie:reader===0?firstCookie:secondCookie}});
      const csrfA=(await (await get('/api/lifecycle/bootstrap')).json() as {csrf_token:string}).csrf_token,csrfB=(await (await get('/api/lifecycle/bootstrap',1)).json() as {csrf_token:string}).csrf_token;
      const post=(path:string,body:Record<string,unknown>,reader:0|1=0)=>fetch(f.origin+path,{method:'POST',headers:{cookie:reader===0?firstCookie:secondCookie,origin:f.origin,'content-type':'application/json','idempotency-key':String(body.client_command_id),'x-csrf-token':reader===0?csrfA:csrfB},body:JSON.stringify(body)});
      await run({...f,runtime,firstCookie,secondCookie,outsiderCookie,browserCookie:a,get,post});
    }finally{await runtime.stop();assert.equal(runtime.server.listening,false);}
  },{workbenchManualReportsEnabled:true,workbenchManualReviewEnabled:true});
}
