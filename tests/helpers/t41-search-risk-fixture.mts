import assert from 'node:assert/strict';
import {request as requestHttp} from 'node:http';
import {withWeb01Fixture} from './web01-workbench-fixture.mjs';
import {createP2016Runtime} from '../../src/p2-016-runtime.mjs';
import type {P2016EnabledRuntime} from '../../src/p2-016-runtime.mjs';
import type {PostgresPool} from '../../src/platform/postgres-pool.mjs';
import type {launchSystemBrowser} from './p2-006-browser-harness.mjs';
type BrowserCookie=NonNullable<Parameters<typeof launchSystemBrowser>[0]['cookies']>[number];
interface Base {pool:PostgresPool;origin:string;runtime:P2016EnabledRuntime;tickets:{ticket:{id:string};intake:{intakeId:string}}[];principals:{id:string}[];outsider:{id:string}}
export interface T41RiskFixture {pool:PostgresPool;origin:string;browserCookie:BrowserCookie;staffId:string;
 tickets:Base['tickets'];get(path:string,reader?:'staff'|'admin'|'outsider'):Promise<Response>}
function ownedGet(url:string,cookie:string):Promise<Response>{
 return new Promise((resolve,reject)=>{
  const request=requestHttp(url,{headers:{cookie},agent:false},response=>{
   const chunks:Buffer[]=[];response.on('data',(chunk:Buffer)=>chunks.push(chunk));response.once('error',reject);
   response.once('end',()=>resolve(new Response(Buffer.concat(chunks).toString('utf8'),{status:response.statusCode??500})));
  });request.setTimeout(10000,()=>request.destroy(new Error('T41_HTTP_FIXTURE_TIMEOUT')));request.once('error',reject);request.end();
 });
}
export function withT41RiskFixture(run:(fixture:T41RiskFixture)=>Promise<void>,{enabled=true,groups=false}:{enabled?:boolean;groups?:boolean}={}){
 return withWeb01Fixture(async(base:Base)=>{
  await base.runtime.stop();const admin=base.principals[0],staff=base.principals[1];assert.ok(admin&&staff);
  const runtime=createP2016Runtime({pool:base.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:base.origin,
   listenPort:Number(new URL(base.origin).port),principalIds:[admin.id,staff.id,base.outsider.id],externalSendEnabled:false,
   workbenchSearchEnabled:enabled,sourceGroupDirectoryEnabled:groups});
  try{
   const started=await runtime.start(),cookies=started.cookies;assert.ok(cookies);
   const a=cookies[0],s=cookies[1],outsider=cookies[2];assert.ok(a&&s&&outsider);const select={admin:a,staff:s,outsider};
   await run({pool:base.pool,origin:base.origin,browserCookie:s,staffId:staff.id,tickets:base.tickets,
    get:(path,reader='staff')=>{const cookie=select[reader];return ownedGet(base.origin+path,cookie.name+'='+cookie.value);}});
  }finally{await runtime.stop();assert.equal(runtime.server.listening,false);
   assert.equal(await new Promise<number>((resolve,reject)=>runtime.server.getConnections((error,count)=>error?reject(error):resolve(count))),0);}
 },{manualProjection:true,chronologicalTicketEvents:true,sourceGroupDirectoryEnabled:groups});
}
export function object(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
export function rows(value:unknown):Record<string,unknown>[]{assert.ok(Array.isArray(value));return value.map(object);}
