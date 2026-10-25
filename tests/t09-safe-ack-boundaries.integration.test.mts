// EXTERNAL SOURCE_DRAFT_NOT_REGISTERED_NOT_RUN. Future tests/ placement only after PC first/consumer slice and parent grant.
// One original read-closure/security trace; existing host budget 240000ms, real HTTP/PG, no browser or fabricated receipt.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {request as httpRequest} from 'node:http';
import type {ClientRequest,Server} from 'node:http';
import type {Socket} from 'node:net';
import {withT09Fixture,object,rows,text,version} from './helpers/t09-fixture.mjs';
import type {T09Http} from './helpers/t09-fixture.mjs';
import {createP2016Runtime} from '../app/server/src/p2-016-runtime.mjs';
import {listenConversationWorkbenchServer} from '../app/server/src/p2-006-workbench-http.mjs';
import {createPilotAccessService} from '../app/server/src/p1-009-pilot-access-workbench.mjs';

async function get(http:T09Http,path:string){const response=await http.get(path);assert.equal(response.status,200,path);return response.value;}
async function snapshot(http:T09Http,path:string){return {ticket:await get(http,path),responsibility:await get(http,path+'/responsibility'),events:await get(http,path+'/events?limit=200'),deliveries:await get(http,path+'/deliveries')};}

test('closing only T09 writes and raw recovery retains original safe ACK while current READ, actor, purpose and UUID remain authoritative',async()=>{
 const originalFetch=globalThis.fetch;
 const clientDeadline=performance.now()+240000,maxResponseBodyBytes=65536,requestTimeoutMs=10000;
 const freshRequests=new Set<ClientRequest>(),freshSockets=new Set<Socket>();
 let freshRequestCount=0,createdSocketCount=0,closedSocketCount=0,peakActiveSockets=0;
 const clientFacts=()=>({transport:'node_http_agent_false',request_count:freshRequestCount,sockets_created:createdSocketCount,sockets_closed:closedSocketCount,active_requests:freshRequests.size,active_sockets:freshSockets.size,peak_active_sockets:peakActiveSockets,max_response_body_bytes:maxResponseBodyBytes,request_timeout_ms:requestTimeoutMs,case_budget_ms:240000});
 type Phase='FIXTURE_SETUP'|'ORIGINAL_AUTH'|'ORIGINAL_ASSIGN_START'|'ORIGINAL_RETURN'|'OTHER_PURPOSE'|'ORIGINAL_BASELINE'|'ORIGINAL_STOP'|'CLOSED_CREATE'|'CLOSED_LISTEN'|'CLOSED_AUTH'|'CLOSED_BASELINE'|'CLOSED_WRITE_OFF_ACK'|'CLOSED_SCOPE_READS'|'CURRENT_READ_REVOKE'|'CLOSED_STOP';
 let phase:Phase='FIXTURE_SETUP',expectedLoopbackPort:number|null=null,lastFetch:Record<string,unknown>|null=null,fetchFailure:Record<string,unknown>|null=null;
 const hosts:{label:'ORIGINAL'|'CLOSED';server:Server}[]=[],lifecycle:Record<string,unknown>[]=[];
 const hostFacts=()=>hosts.map(({label,server})=>{const address=server.address(),loopback=address!==null&&typeof address!=='string'&&['127.0.0.1','::1'].includes(address.address);return{label,listening:server.listening,loopback,address_port:loopback&&address&&typeof address!=='string'?address.port:null,expected_loopback_port:expectedLoopbackPort};});
 const mark=(next:Phase)=>{phase=next;lifecycle.push({phase,hosts:hostFacts()});};
 const safeCode=(value:unknown)=>typeof value==='string'&&/^[A-Za-z0-9_.-]{1,64}$/u.test(value)?value:typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=2147483647?value:null;
 const errorFacts=(error:unknown)=>{const facts:Record<string,unknown>[]=[];let current:unknown=error;for(let depth=0;depth<=2&&typeof current==='object'&&current!==null;depth++){facts.push({depth,name:safeCode(Reflect.get(current,'name')),code:safeCode(Reflect.get(current,'code'))});current=Reflect.get(current,'cause');}return facts;};
 const freshJson=async(url:URL,method:'GET'|'POST',headers:Record<string,string>,body?:string):Promise<{status:number;value:Record<string,unknown>}>=>{
  const timeout=Math.min(requestTimeoutMs,Math.floor(clientDeadline-performance.now()));
  lastFetch={phase,transport:'node_http_agent_false',request_created:false,method,loopback:['127.0.0.1','[::1]','::1'].includes(url.hostname),pathname:url.pathname,port:Number(url.port)||null};
  const client:{request?:ClientRequest;socket?:Socket;socketClosed?:Promise<void>;requestClosed?:Promise<void>}={};
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
   if(timeout<=0)throw Object.assign(new Error('T09 fresh HTTP remaining budget exhausted'),{code:'T09_HTTP_BUDGET_EXHAUSTED'});
   const response=new Promise<{status:number;value:Record<string,unknown>}>((resolve,reject)=>{
    const request=httpRequest(url,{method,headers,agent:false});client.request=request;freshRequestCount++;freshRequests.add(request);lastFetch={...lastFetch,request_created:true};
    let result:{status:number;value:Record<string,unknown>}|undefined,socketDidClose=false,responseEnded=false;
    const settle=()=>{if(result&&socketDidClose)resolve(result);};
    client.requestClosed=new Promise<void>(closed=>request.once('close',()=>{freshRequests.delete(request);closed();}));
    request.once('socket',current=>{client.socket=current;createdSocketCount++;freshSockets.add(current);peakActiveSockets=Math.max(peakActiveSockets,freshSockets.size);client.socketClosed=new Promise<void>(closed=>current.once('close',()=>{closedSocketCount++;freshSockets.delete(current);socketDidClose=true;if(!responseEnded)reject(Object.assign(new Error('T09 fresh HTTP socket closed before response end'),{code:'T09_HTTP_SOCKET_CLOSED'}));settle();closed();}));});
    request.once('error',reject);
    request.once('response',incoming=>{
     const chunks:Buffer[]=[];let bytes=0;
     incoming.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>maxResponseBodyBytes){const error=Object.assign(new Error('T09 fresh HTTP response body limit'),{code:'T09_HTTP_BODY_TOO_LARGE'});reject(error);request.destroy(error);return;}chunks.push(chunk);});
     incoming.once('error',reject);
     incoming.once('aborted',()=>reject(Object.assign(new Error('T09 fresh HTTP response aborted'),{code:'T09_HTTP_RESPONSE_ABORTED'})));
     incoming.once('close',()=>{if(!responseEnded)reject(Object.assign(new Error('T09 fresh HTTP response closed before end'),{code:'T09_HTTP_RESPONSE_CLOSED'}));});
     incoming.once('end',()=>{responseEnded=true;try{assert.equal(incoming.complete,true);assert.equal(typeof incoming.statusCode,'number');const status=incoming.statusCode;if(status===undefined)throw Object.assign(new Error('T09 fresh HTTP missing status'),{code:'T09_HTTP_STATUS_MISSING'});result={status,value:object(JSON.parse(Buffer.concat(chunks).toString('utf8')))};settle();}catch(error){reject(error);}});
    });
    request.end(body);
   });
   const deadline=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('T09 fresh HTTP bounded request timeout'),{code:'T09_HTTP_TIMEOUT'})),timeout);});
   return await Promise.race([response,deadline]);
  }catch(error){try{fetchFailure={phase,request:lastFetch,hosts:hostFacts(),lifecycle:[...lifecycle],client_at_failure:clientFacts(),error:errorFacts(error)};}finally{throw error;}}
  finally{if(timer)clearTimeout(timer);client.request?.destroy();client.socket?.destroy();if(client.requestClosed)await client.requestClosed;if(client.socketClosed)await client.socketClosed;}
 };
 // Delegate exact original input/options once. No retry, header/agent/signal change, body read or invented response.
 globalThis.fetch=async(input,options)=>{
  const encoded=typeof input==='string'?input:input instanceof URL?input.href:input.url;let url:URL|null=null;try{url=new URL(encoded);}catch{url=null;}
  const method=options?.method??(typeof input==='string'||input instanceof URL?'GET':input.method),loopback=url!==null&&['127.0.0.1','[::1]','::1'].includes(url.hostname);
  lastFetch={phase,method:['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].includes(method.toUpperCase())?method.toUpperCase():'OTHER',loopback,pathname:loopback&&url?url.pathname:null,port:loopback&&url?Number(url.port)||null:null};
  try{return await originalFetch.call(globalThis,input,options);}catch(error){try{fetchFailure={phase,request:lastFetch,hosts:hostFacts(),lifecycle:[...lifecycle],error:errorFacts(error)};}finally{throw error;}}
 };
 try{
 await withT09Fixture(async fixture=>{
  const fixtureOrigin=new URL(fixture.origin);expectedLoopbackPort=['127.0.0.1','[::1]','::1'].includes(fixtureOrigin.hostname)?Number(fixtureOrigin.port):null;hosts.push({label:'ORIGINAL',server:fixture.runtime.server});mark('ORIGINAL_AUTH');
  const admin=await fixture.http(0),handler=await fixture.http(2),ticket=await fixture.createTicket(),path='/api/tickets/'+ticket;
  mark('ORIGINAL_ASSIGN_START');
  assert.equal((await admin.post(path+'/assign',{client_command_id:randomUUID(),expected_version:1,reason_code:'WORKBENCH_ASSIGN',target_principal_id:fixture.handler,resolver_team_id:'PILOT_IT',communication_choice:'RETAIN_CURRENT',sessions:[]})).status,200);
  for(const action of ['accept','start']as const){const current=await get(handler,path);assert.equal((await handler.post(path+'/'+action,{client_command_id:randomUUID(),expected_version:version(current.version),reason_code:'T09_ACK_SCOPE_REAL_'+action.toUpperCase()})).status,200);}
  const body={client_command_id:randomUUID(),expected_version:version((await get(handler,path)).version),reason_code:'WORKBENCH_RETURN_TO_DISPATCH',reason:'合成内部停止原因，安全ACK不得包含。',unfinished_work:'合成内部未完成工作，安全ACK不得包含。',communication_choice:'RETAIN_CURRENT',communication_target_principal_id:null,sessions:[]};
  mark('ORIGINAL_RETURN');
  const committed=await handler.post(path+'/return-to-dispatch',body);assert.equal(committed.status,200,JSON.stringify(committed.value));
  // Actual different-purpose receipt by the same principal; no receipt SQL insert or guessed method.
  mark('OTHER_PURPOSE');
  const other='/api/tickets/'+await fixture.createTicket(),purposeUuid=randomUUID();
  const purpose=await handler.post(other+'/accept-for-later-with-conversations',{client_command_id:purposeUuid,expected_version:1,reason_code:'WORKBENCH_SELF_HANDLING',resolver_team_id:'PILOT_IT',communication_choice:'RETAIN_CURRENT',sessions:[]});assert.equal(purpose.status,200,JSON.stringify(purpose.value));
  mark('ORIGINAL_BASELINE');
  const originalState=await get(admin,path);
  // A real sequential runtime restart, not mutation of a captured flag or fake response. Externally supplied pool stays owned by the fixture.
  mark('ORIGINAL_STOP');
  await fixture.runtime.stop();assert.equal(fixture.runtime.server.listening,false);
  mark('CLOSED_CREATE');
  const port=Number(new URL(fixture.origin).port),closed=createP2016Runtime({pool:fixture.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:fixture.origin,listenPort:port,principalIds:[fixture.admin,fixture.dispatcher,fixture.handler,fixture.otherHandler],externalSendEnabled:false,closePoolOnStop:false,ticketReturnToDispatchEnabled:false,workbenchDraftRecoveryEnabled:false});assert.ok('server' in closed);
  hosts.push({label:'CLOSED',server:closed.server});mark('CLOSED_LISTEN');
  try{
   await listenConversationWorkbenchServer(closed.server,{port});
  mark('CLOSED_AUTH');
   const cookies=closed.authenticate.browserCookies?.();assert.ok(cookies);assert.equal(cookies.length,4);
   const http=async(index:number):Promise<T09Http>=>{const cookie=cookies[index];assert.ok(cookie);const header=cookie.name+'='+cookie.value;
    const read=(url:string)=>freshJson(new URL(fixture.origin+url),'GET',{cookie:header});
    const bootstrap=await read('/api/lifecycle/bootstrap');assert.equal(bootstrap.status,200);const csrf=text(bootstrap.value.csrf_token);
    return{get:read,post:(url,command)=>freshJson(new URL(fixture.origin+url),'POST',{cookie:header,origin:fixture.origin,'content-type':'application/json','x-csrf-token':csrf,'idempotency-key':text(command.client_command_id),'if-match':'"'+command.expected_version+'"'},JSON.stringify(command))};
   };
   const reader=await http(2),otherActor=await http(1),observer=await http(0),ack=path+'/return-to-dispatch/commands/'+body.client_command_id;
  mark('CLOSED_BASELINE');
   const baseline=await snapshot(observer,path);assert.equal(baseline.ticket.version,originalState.version);assert.equal(baseline.ticket.status,'QUEUED');assert.equal(baseline.ticket.assignee_id,null);
  mark('CLOSED_WRITE_OFF_ACK');
   assert.equal((await get(reader,'/api/lifecycle/bootstrap')).draft_recovery_enabled,false);
   assert.equal((await reader.post(path+'/return-to-dispatch',body)).status,503,'literal false stops POST, including an original terminal command');
   assert.deepEqual(await get(reader,ack),{state:'COMMITTED',ticket_id:ticket,ticket_version:body.expected_version+1,ticket_event_id:text(committed.value.ticket_event_id)});
  mark('CLOSED_SCOPE_READS');
   assert.equal((await otherActor.get(path)).status,200);assert.deepEqual(await get(otherActor,ack),{state:'UNKNOWN'},'a readable Ticket never grants another actor receipt access');
   assert.deepEqual(await get(reader,path+'/return-to-dispatch/commands/'+randomUUID()),{state:'UNKNOWN'});
   assert.deepEqual(await get(reader,other+'/return-to-dispatch/commands/'+purposeUuid),{state:'UNKNOWN'},'a real other-purpose receipt must not satisfy the return purpose');
   assert.deepEqual(await get(reader,other+'/return-to-dispatch/commands/'+body.client_command_id),{state:'UNKNOWN'},'an existing command UUID on another readable resource is not this resource receipt');
   assert.deepEqual(await snapshot(observer,path),baseline,'safe reads and disabled writes preserve Ticket/Event/Delivery/independent communication facts');
   // Only authoritative synthetic directory membership changes through the existing Port. No Ticket/session/receipt/event SQL writes.
  mark('CURRENT_READ_REVOKE');
   const identity=(await fixture.pool.query<{wecom_user_id:string;display_name:string}>('SELECT wecom_user_id,display_name FROM pilot_ticket.pilot_principal WHERE id=$1::uuid',[fixture.handler])).rows[0];assert.ok(identity);
   await createPilotAccessService({pool:fixture.pool}).upsertPrincipal({wecomUserId:identity.wecom_user_id,displayName:identity.display_name,roles:['HANDLER'],resolverTeamIds:[]});
   assert.equal((await reader.get('/api/lifecycle/bootstrap')).status,200,'identity must remain authenticated, isolating lost Ticket READ');
   assert.equal((await reader.get(path)).status,404,'returned Ticket has no actor ownership and its group is no longer authorized');
   const denied=await reader.get(ack);assert.equal(denied.status,404);assert.equal(Object.hasOwn(denied.value,'state'),false);assert.equal(JSON.stringify(denied.value).includes(text(committed.value.ticket_event_id)),false);
   assert.deepEqual(await snapshot(observer,path),baseline);assert.equal(rows(baseline.events.items).filter(row=>row.event_type==='ticket.returned_to_dispatch').length,1);
  }finally{mark('CLOSED_STOP');await closed.stop();assert.equal(closed.server.listening,false);assert.equal((await closed.observability.metrics()).sse_clients,0);assert.equal(await new Promise<number>((resolve,reject)=>closed.server.getConnections((error,count)=>error?reject(error):resolve(count))),0);assert.equal(freshRequests.size,0);assert.equal(freshSockets.size,0);assert.equal(createdSocketCount,closedSocketCount);console.log('T09_ACK_BOUNDARY_CLIENT_SOCKET_FACTS '+JSON.stringify(clientFacts()));}
 },{ticketReturnToDispatchEnabled:true,workbenchDraftRecoveryEnabled:false});
 }catch(error){try{console.log('T09_ACK_BOUNDARY_FAILURE_DIAGNOSTIC '+JSON.stringify({...(fetchFailure??{phase,request:lastFetch,hosts:hostFacts(),lifecycle,error:errorFacts(error)}),client_after_cleanup:clientFacts()}));}finally{throw error;}}finally{globalThis.fetch=originalFetch;}
});
