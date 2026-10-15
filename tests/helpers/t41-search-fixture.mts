import assert from 'node:assert/strict';
import {request as requestHttp} from 'node:http';
import {withWeb01Fixture} from './web01-workbench-fixture.mjs';
import {createP2016Runtime} from '../../src/p2-016-runtime.mjs';
import type {P2016EnabledRuntime,P2016RuntimeOptions} from '../../src/p2-016-runtime.mjs';
import type {PostgresPool} from '../../src/platform/postgres-pool.mjs';

interface BaseFixture {
 pool:PostgresPool;origin:string;runtime:P2016EnabledRuntime;
 tickets:{ticket:{id:string;title:string;ticket_no:string};intake:{intakeId:string}}[];
 principals:{id:string}[];outsider:{id:string};
}
export interface T41SearchFixture {
 pool:PostgresPool;tickets:BaseFixture['tickets'];principalId:string;
 get(path:string,reader?:'staff'|'admin'|'outsider'):Promise<Response>;
}
/** A real HTTP connection owned by this fixture, not a retained socket of the stopped App. */
function get(url:string,cookie:string):Promise<Response>{
 return new Promise((resolve,reject)=>{
  const request=requestHttp(url,{method:'GET',headers:{cookie},agent:false},response=>{
   const chunks:Buffer[]=[];response.on('data',(chunk:Buffer)=>chunks.push(chunk));response.once('error',reject);
   response.once('end',()=>resolve(new Response(Buffer.concat(chunks).toString('utf8'),{status:response.statusCode??500})));
  });
  request.once('error',reject);request.end();
 });
}
export function withT41SearchFixture(run:(fixture:T41SearchFixture)=>Promise<void>){
 return withWeb01Fixture(async(base:BaseFixture)=>{
  await base.runtime.stop();
  const admin=base.principals[0],staff=base.principals[1];assert.ok(admin&&staff);
  // This proposed option is deliberately not consumed by the original host yet.
  // Keeping it here lets the same original HTTP first run after actual RED and host wiring.
  const options:P2016RuntimeOptions&{workbenchSearchEnabled:true}={
   pool:base.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:base.origin,
   listenPort:Number(new URL(base.origin).port),principalIds:[admin.id,staff.id,base.outsider.id],
   workbenchSearchEnabled:true,externalSendEnabled:false
  };
  const runtime=createP2016Runtime(options);assert.ok(!('disabled' in runtime));
  try{
   const started=await runtime.start(),cookies=started.cookies;assert.ok(cookies);
   const a=cookies[0],s=cookies[1],outsider=cookies[2];assert.ok(a&&s&&outsider);
   const selected={admin:a,staff:s,outsider};
   await run({pool:base.pool,tickets:base.tickets,principalId:staff.id,get:(path,reader='staff')=>{
    const cookie=selected[reader];return get(base.origin+path,cookie.name+'='+cookie.value);
   }});
  }finally{
   await runtime.stop();assert.equal(runtime.server.listening,false);
   const connections=await new Promise<number>((resolve,reject)=>runtime.server.getConnections((error,count)=>error?reject(error):resolve(count)));
   assert.equal(connections,0);
  }
 },{manualProjection:true,chronologicalTicketEvents:true});
}
