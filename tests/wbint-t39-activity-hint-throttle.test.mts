import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {randomUUID} from 'node:crypto';
import type {IncomingMessage} from 'node:http';
import {createRealtimeSseHandler,REALTIME_SSE_DEFAULTS} from '../app/server/src/p2-003-realtime-sse.mjs';
import {createWorkbenchActivity} from '../app/server/src/workbench-activity.mjs';
import type {WorkbenchActivityCommand,WorkbenchActivityTarget} from '../contracts/workbench_activity_contracts.js';

// ADR-0057 A3/A5: board-scope hints reach every connection, at most once per second per connection.
const HINT='event: workbench.activity.changed\ndata: {"schema_version":1}\n\n';
interface Client {status:number;body:string;hints():number;close():void}
async function connect(origin:string,principal:string):Promise<Client>{
  const abort=new AbortController(),response=await fetch(origin+'/api/realtime/events?scope=workbench',{headers:{'x-principal':principal},signal:abort.signal});
  const client:Client={status:response.status,body:'',hints(){return this.body.split(HINT).length-1;},close(){abort.abort();}};
  if(response.status!==200){await response.arrayBuffer();return client;}
  assert.ok(response.body);const reader=response.body.getReader(),decoder=new TextDecoder();
  void (async()=>{try{for(;;){const next=await reader.read();if(next.done)return;client.body+=decoder.decode(next.value).replaceAll('\r\n','\n');}}catch{/* aborted by the test */}})();
  return client;
}
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setTimeout(resolve,10));};

test('one lease change wakes every SSE connection once; bursts within a second coalesce and the trailing change is delivered later',async t=>{
  let now=1_000_000,authorizeCalls=0;
  const identities=new Map<string,{principal_id:string;csrf_token:string;session_id:string}>();
  const authContext=(id:string)=>{let value=identities.get(id);if(!value){value={principal_id:id,csrf_token:randomUUID(),session_id:randomUUID()};identities.set(id,value);}return value;};
  let handler:ReturnType<typeof createRealtimeSseHandler>|null=null;
  const activity=createWorkbenchActivity({enabled:true,now:()=>now,wakeup:()=>handler?.wakeup(),authorize:async auth=>{
    authorizeCalls++;assert.ok(auth&&typeof auth==='object'&&'principal_id' in auth&&typeof auth.principal_id==='string');
    return {principal_id:auth.principal_id,display_name:'合成同事',binding:auth.principal_id};
  }});
  handler=createRealtimeSseHandler({
    enabled:true,
    eventStore:{async getRealtimeReplayWindow(){return {retention_floor_event_id:'0',high_watermark_event_id:'0'};},async listAuthorizedRealtimeEvents({afterEventId}:{afterEventId:string}){return {events:[],next_after_event_id:afterEventId,retention_floor_event_id:'0'};}},
    authenticate:async(request:IncomingMessage)=>authContext(String(request.headers['x-principal'])),
    authorize:async()=>({allowed_session_ids:[]}),
    // Existing heartbeat/recovery timers are kept but pushed out of the test window; wakeups drive delivery.
    heartbeatMs:300_000,recoveryPollMs:300_000,
    nowFn:()=>now,
  });
  handler.setWorkbenchActivity?.(async auth=>activity.signature(auth));
  const sse=handler,server=createServer((request,response)=>{void sse(request,response);});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+(server.address() as AddressInfo).port;
  t.after(async()=>{activity.close();await sse.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  // The card asks for 64 connections; the shared hub is hard-capped at REALTIME_SSE_DEFAULTS.maxClients (32).
  const requested=64,responses:Client[]=[];
  for(let i=0;i<requested;i++)responses.push(await connect(origin,randomUUID()));
  await settle();
  const streaming=responses.filter(response=>response.status===200);
  assert.equal(streaming.length,REALTIME_SSE_DEFAULTS.maxClients,'the existing 2C4G cap admits 32 SSE clients; the remainder receive the capacity fallback');
  t.diagnostic(`A5 SSE: requested=${requested} streaming=${streaming.length} rejected=${responses.filter(r=>r.status===503).length}`);
  assert.ok(streaming.every(response=>response.hints()===0),'connecting primes the signature without a hint');
  const actor=authContext(randomUUID()),target:WorkbenchActivityTarget={kind:'ticket',id:randomUUID()},browser=randomUUID();
  const renew=(extra:Partial<WorkbenchActivityCommand>={}):WorkbenchActivityCommand=>({schema_version:1,browser_id:browser,action:'RENEW',target,visible:true,active:true,mode:'VIEWING',field:null,...extra} as WorkbenchActivityCommand);
  authorizeCalls=0;
  await activity.perform({authContext:actor,body:renew()});await settle();
  assert.ok(streaming.every(response=>response.hints()===1),'a colleague lease on an object no watcher opened still hints every board connection exactly once');
  t.diagnostic(`A5 SSE one change: hints_per_connection=${streaming.map(r=>r.hints()).join(',').replace(/(1,)+1/u,'1×'+streaming.length)} authorize_calls=${authorizeCalls}`);
  // Twenty changes inside the same second: zero additional hints.
  for(let i=0;i<20;i++){await activity.perform({authContext:actor,body:renew(i%2?{mode:'VIEWING',field:null}:{mode:'EDITING',field:'internal-note'})});await settle();}
  assert.ok(streaming.every(response=>response.hints()===1),'changes within one second of the last hint are coalesced per connection');
  now+=999;await activity.perform({authContext:actor,body:renew({active:false})});await settle();
  assert.ok(streaming.every(response=>response.hints()===1),'still inside the one-second window');
  now+=1;await activity.perform({authContext:actor,body:renew({active:false})});await settle();
  assert.ok(streaming.every(response=>response.hints()===2),'the pending change is delivered by the next existing wakeup after the window');
  // A heartbeat that changes nothing does not hint again.
  now+=5000;await activity.perform({authContext:actor,body:renew({active:false})});await settle();
  assert.ok(streaming.every(response=>response.hints()===2));
  for(const client of responses)client.close();
});
