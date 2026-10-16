import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {IncomingMessage} from 'node:http';
import {createServer} from 'node:net';
import type {P2016EnabledRuntime} from '../src/p2-016-runtime.mjs';
import {createP2016Runtime} from '../src/p2-016-runtime.mjs';
import {listenConversationWorkbenchServer} from '../src/p2-006-workbench-http.mjs';
import {createRealtimeEventStore} from '../src/p2-003-realtime-event-log.mjs';
import {createPilotWorkbenchAuthorizationAdapter} from '../src/p2-006-workbench-authorization.mjs';
import {withT37Fixture,object,rows,text,type T37Fixture,type T37Http} from './helpers/t37-follow-up-fixture.mjs';

function version(value:unknown):number{assert.ok(typeof value==='number'&&Number.isSafeInteger(value)&&value>0);return value;}
async function current(http:T37Http,path:string){const response=await http.get(path);assert.equal(response.status,200,JSON.stringify(response.value));return response.value;}
function duePort(runtime:P2016EnabledRuntime){
 const run:unknown=Reflect.get(runtime,'runFollowUpDueBatch');
 assert.equal(typeof run,'function','T37_REAL_DUE_BATCH_PORT_REQUIRED');
 if(typeof run!=='function')throw Error('T37_REAL_DUE_BATCH_PORT_REQUIRED');
 return async(limit:unknown=20)=>object(await run({limit}));
}
async function http(runtime:P2016EnabledRuntime,origin:string):Promise<T37Http>{
 const entry=runtime.authenticate.browserCookies?.()[0];assert.ok(entry);const cookie=entry.name+'='+entry.value;
 const get=async(path:string)=>{const response=await fetch(origin+path,{headers:{cookie}});return {status:response.status,value:object(await response.json())};};
 const bootstrap=await get('/api/lifecycle/bootstrap');assert.equal(bootstrap.status,200);const csrf=text(bootstrap.value.csrf_token);
 const post=async(path:string,body:Readonly<Record<string,unknown>>)=>{const response=await fetch(origin+path,{method:'POST',headers:{cookie,origin,'content-type':'application/json','x-csrf-token':csrf,'idempotency-key':text(body.client_command_id),'if-match':'"'+version(body.expected_version)+'"'},body:JSON.stringify(body)});return {status:response.status,value:object(await response.json())};};return {get,post};
}
async function signals(fixture:T37Fixture){
 const authorization=createPilotWorkbenchAuthorizationAdapter({pool:fixture.pool}),principal=await authorization.resolvePrincipal({principal_id:fixture.dispatcher});assert.ok(principal);
 const scope=await authorization.resolveRealtimeAuthorization(principal,{limit:256,availabilityFallback:true});assert.ok(scope);
 const page=await createRealtimeEventStore({pool:fixture.pool,enabled:true}).listAuthorizedEvents({authorization:scope,afterEventId:'0',limit:200});
 return page.events.filter(event=>event.event_type==='ticket.updated'&&event.payload.reason==='FOLLOW_UP_DUE');
}
async function set(http:T37Http,path:string,due:string){
 const ticket=await current(http,path),schedule=await current(http,path+'/follow-up-schedule');
 const response=await http.post(path+'/follow-up-schedule',{client_command_id:randomUUID(),expected_version:version(ticket.version),expected_schedule_version:text(schedule.schedule_version),reason_code:'WORKBENCH_FOLLOW_UP_SCHEDULE',action:'SET',due_at:due});assert.equal(response.status,200,JSON.stringify(response.value));
}
async function facts(http:T37Http,path:string){return {ticket:await current(http,path),schedule:await current(http,path+'/follow-up-schedule'),events:await current(http,path+'/events?limit=200'),responsibility:await current(http,path+'/responsibility'),deliveries:await current(http,path+'/deliveries')};}

test('real due batches persist one safe signal per schedule revision and process at most twenty in stable order across native runtime restart',{timeout:240000},async t=>{
 let stage='FIXTURE_SETUP',replacementBootstraps=0;
 const observeBootstrap=(request:IncomingMessage)=>{if(request.url==='/api/lifecycle/bootstrap')replacementBootstraps++;};
 await withT37Fixture(async fixture=>{
  stage='ORIGINAL_HTTP';
  let runtime=fixture.runtime,dispatch=await http(runtime,fixture.origin);
  try{
   const ticketId=await fixture.createTicket(),path='/api/tickets/'+ticketId;await set(dispatch,path,'2020-01-02 09:30:00');
   const before=await facts(dispatch,path);assert.equal(object(before.schedule.active).is_due,true);assert.equal((await signals(fixture)).length,0);
   let run=duePort(runtime);
   assert.deepEqual(await run(),{scanned:1,emitted:1,skipped:0});
   const emitted=await signals(fixture);assert.equal(emitted.length,1);const first=emitted[0];assert.ok(first);
   assert.equal(first.aggregate_type,'TICKET');assert.equal(first.aggregate_id,ticketId);assert.equal(first.aggregate_version,String(before.ticket.version));
   assert.deepEqual({...first.payload},{ticket_id:ticketId,follow_up_schedule_version:'1',reason:'FOLLOW_UP_DUE'});
   assert.ok(first.occurred_at>'2020-01-02 09:30:00','publication time is actual current time, not the expired due time');
   assert.deepEqual(await facts(dispatch,path),before,'a reminder is not a Ticket action, version change, assignment or Delivery');
   assert.deepEqual(await run(),{scanned:0,emitted:0,skipped:0});assert.equal((await signals(fixture)).length,1);
   // Keep the restart on the same DB without reusing the stopped host's client connections.
   stage='REPLACEMENT_ORIGIN';assert.equal(runtime.server.listening,true);
   const probe=createServer();await new Promise<void>((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);});
   const address=probe.address();await new Promise<void>((resolve,reject)=>probe.close(error=>error?reject(error):resolve()));
   assert.equal(probe.listening,false);assert.ok(address&&typeof address!=='string');
   const port=address.port,origin='http://127.0.0.1:'+port;assert.notEqual(origin,fixture.origin);
   stage='ORIGINAL_STOP';await runtime.stop();assert.equal(runtime.server.listening,false);
   stage='REPLACEMENT_CREATE';runtime=createP2016Runtime({pool:fixture.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:origin,listenPort:port,principalIds:[fixture.dispatcher,fixture.handler,fixture.otherHandler],gatewayEnabled:false,senderEnabled:false,externalSendEnabled:false,workbenchFollowUpSchedulesEnabled:true});
   runtime.server.on('request',observeBootstrap);
   stage='REPLACEMENT_LISTEN';await listenConversationWorkbenchServer(runtime.server,{port});
   stage='REPLACEMENT_BOOTSTRAP';dispatch=await http(runtime,origin);run=duePort(runtime);
   stage='REPLACEMENT_FACTS_AND_DUE_BATCHES';
   assert.deepEqual(await run(),{scanned:0,emitted:0,skipped:0});assert.equal((await signals(fixture)).length,1);assert.equal(object((await current(dispatch,path+'/follow-up-schedule')).active).is_due,true);
   await set(dispatch,path,'2020-01-02 09:30:00');const revised=await facts(dispatch,path);assert.equal(revised.schedule.schedule_version,'2');
   assert.deepEqual(await run(),{scanned:1,emitted:1,skipped:0});assert.deepEqual(await run(),{scanned:0,emitted:0,skipped:0});
   assert.deepEqual((await signals(fixture)).map(event=>event.payload.follow_up_schedule_version),['1','2']);assert.deepEqual(await facts(dispatch,path),revised);
   const ids:string[]=[];
   for(let i=0;i<21;i++){const id=await fixture.createTicket();ids.push(id);await set(dispatch,'/api/tickets/'+id,'2020-01-02 09:30:00');}
   const ordered=[...ids].sort();assert.deepEqual(await run(),{scanned:20,emitted:20,skipped:0});
   assert.deepEqual((await signals(fixture)).slice(2).map(event=>event.aggregate_id),ordered.slice(0,20));
   assert.deepEqual(await run(),{scanned:1,emitted:1,skipped:0});assert.deepEqual((await signals(fixture)).slice(2).map(event=>event.aggregate_id),ordered);
   for(const invalid of [0,21,1.5,'20',Number.MAX_SAFE_INTEGER])await assert.rejects(()=>run(invalid));
   assert.deepEqual(await run(),{scanned:0,emitted:0,skipped:0});assert.equal((await signals(fixture)).length,23);
  }finally{runtime.server.off('request',observeBootstrap);await runtime.stop();assert.equal(runtime.server.listening,false);assert.equal((await runtime.observability.metrics()).sse_clients,0);}
 },{workbenchFollowUpSchedulesEnabled:true}).catch((error:unknown)=>{
  const details=(value:unknown)=>{
   if(!(value instanceof Error))return null;
   const code:unknown=Reflect.get(value,'code');
   return {name:value.name,code:typeof code==='string'?code:null,stack:value.stack?.replace(/\b(?:https?|postgres(?:ql)?):\/\/[^\s)]+/giu,'<URL_REDACTED>')};
  };
  t.diagnostic('T37_DUE_RESTART_FAILURE '+JSON.stringify({stage,replacement_bootstrap_requests:replacementBootstraps,error:details(error),cause:details(error instanceof Error?error.cause:undefined)}));
  throw error;
 });
});
