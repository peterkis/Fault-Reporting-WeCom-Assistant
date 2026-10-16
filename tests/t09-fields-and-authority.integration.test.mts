// EXTERNAL SOURCE_DRAFT_NOT_REGISTERED_NOT_RUN. Each future entry keeps the existing 240000ms budget.
// Actual HTTP field/state/permission boundaries; no private normalize() tests or SQL manufactured Ticket history.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withT09Fixture,rows,version,object} from './helpers/t09-fixture.mjs';
import type {T09Http,T09Fixture} from './helpers/t09-fixture.mjs';
async function get(http:T09Http,path:string){const response=await http.get(path);assert.equal(response.status,200,path);return response.value;}
async function facts(http:T09Http,path:string){return{ticket:await get(http,path),responsibility:await get(http,path+'/responsibility'),events:await get(http,path+'/events?limit=200'),deliveries:await get(http,path+'/deliveries')};}
const command=(v:number)=>({client_command_id:randomUUID(),expected_version:v,reason_code:'WORKBENCH_RETURN_TO_DISPATCH',reason:'合成停止原因。',unfinished_work:'合成未完成工作。',communication_choice:'RETAIN_CURRENT',communication_target_principal_id:null,sessions:[]});
async function prepare(f:T09Fixture){const admin=await f.http(0),handler=await f.http(2),path='/api/tickets/'+await f.createTicket();const assigned=await admin.post(path+'/assign',{client_command_id:randomUUID(),expected_version:1,reason_code:'WORKBENCH_ASSIGN',target_principal_id:f.handler,resolver_team_id:'PILOT_IT',communication_choice:'RETAIN_CURRENT',sessions:[]});assert.equal(assigned.status,200);return{admin,handler,path,assigned};}
async function act(http:T09Http,path:string,action:string){assert.equal((await http.post(path+'/'+action,{client_command_id:randomUUID(),expected_version:version((await get(http,path)).version),reason_code:'T09_AUTHORITY_'+action.replaceAll('-','_').toUpperCase()})).status,200);}

test('return uses a real started responsibility, both bounded internal inputs and independent dispatcher authority rather than mere READ',async()=>{
 await withT09Fixture(async f=>{
  const {admin,handler,path}=await prepare(f),dispatcher=await f.http(1),readOnly=await f.http(3);
  const refuse=async(http:T09Http,body:Record<string,unknown>,status:number)=>{const before=await facts(admin,path);const response=await http.post(path+'/return-to-dispatch',body);assert.equal(response.status,status,JSON.stringify(response.value));assert.deepEqual(await facts(admin,path),before);};
  const unstarted=await get(handler,path);assert.equal(unstarted.status,'QUEUED');await refuse(admin,command(version(unstarted.version)),409);
  await act(handler,path,'accept');const accepted=await get(handler,path);assert.equal(accepted.status,'ACCEPTED');await refuse(admin,command(version(accepted.version)),409);
  await act(handler,path,'start');const current=await get(handler,path);assert.equal(current.status,'IN_PROGRESS');assert.equal(current.assignee_id,f.handler);
  // Spec examples, not recomputation of normalizer logic. Each request uses a fresh UUID; refusal must preserve all public facts.
  for(const patch of [{reason:''},{reason:'   '},{unfinished_work:''},{unfinished_work:'\n\t'},{reason:7},{unfinished_work:null},{reason:'x'.repeat(501)},{unfinished_work:'x'.repeat(1401)},{reason:'😀'.repeat(251)},{unfinished_work:'😀'.repeat(701)},{unexpected:true}])await refuse(handler,{...command(version(current.version)),...patch},400);
  assert.equal((await readOnly.get(path)).status,200);await refuse(readOnly,command(version(current.version)),403);
  const before=await facts(admin,path),body={...command(version(current.version)),reason:'r'.repeat(500),unfinished_work:'u'.repeat(1400)};
  const stopped=await dispatcher.post(path+'/return-to-dispatch',body);assert.equal(stopped.status,200,JSON.stringify(stopped.value));assert.equal(stopped.value.replayed,false);
  const after=await facts(admin,path);assert.equal(after.ticket.status,'QUEUED');assert.equal(after.ticket.assignee_id,null);assert.equal(after.ticket.resolver_team_id,before.ticket.resolver_team_id);assert.equal(after.ticket.intake_id,before.ticket.intake_id);assert.deepEqual(after.ticket.handling_cycle,before.ticket.handling_cycle);assert.deepEqual(after.responsibility.conversations,before.responsibility.conversations);assert.deepEqual(after.deliveries,before.deliveries);
  const history=rows(after.events.items),last=history.at(-1);assert.ok(last);assert.deepEqual(history.slice(0,-1),rows(before.events.items));assert.equal(last.event_type,'ticket.returned_to_dispatch');assert.equal(last.has_internal_note,true);assert.equal(last.has_external_note,false);assert.equal(Object.hasOwn(stopped.value,'reason'),false);assert.equal(Object.hasOwn(stopped.value,'unfinished_work'),false);
 },{ticketReturnToDispatchEnabled:true});
});

test('a real WAITING_REQUESTER current handler and authorized administrator use the separate return action without ending the round',async()=>{
 await withT09Fixture(async f=>{
  // WAITING_VENDOR current-handler path is already proved by the original first; do not repeat it as a new coverage claim.
  for(const actorIndex of [2,0]){const {admin,handler,path}=await prepare(f);await act(handler,path,'accept');await act(handler,path,'start');await act(handler,path,'request-information');
   const before=await facts(admin,path);assert.equal(before.ticket.status,'WAITING_REQUESTER');assert.equal(before.ticket.assignee_id,f.handler);const cycle=object(before.ticket.handling_cycle),actor=await f.http(actorIndex);
   const response=await actor.post(path+'/return-to-dispatch',command(version(before.ticket.version)));assert.equal(response.status,200,JSON.stringify(response.value));
   const after=await facts(admin,path);assert.equal(after.ticket.status,'QUEUED');assert.equal(after.ticket.assignee_id,null);assert.deepEqual(after.ticket.handling_cycle,cycle);assert.equal(after.ticket.resolver_team_id,before.ticket.resolver_team_id);assert.deepEqual(after.deliveries,before.deliveries);assert.deepEqual(after.responsibility.conversations,before.responsibility.conversations);
  }
 },{ticketReturnToDispatchEnabled:true});
});
