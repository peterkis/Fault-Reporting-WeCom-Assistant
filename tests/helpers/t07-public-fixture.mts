import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPilotAccessService} from '../../src/p1-009-pilot-access-workbench.mjs';
import type {PostgresPool} from '../../src/platform/postgres-pool.mjs';
export interface T07Fixture {pool:PostgresPool;databaseUrl:string;origin:string;cookies:string[];tickets:{ticket:{id:string};intake:{intakeId:string}}[];principals:{id:string}[];runtime:{coordinator:{runOnce:()=>Promise<unknown>}}}
export function object(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
export function rows(value:unknown):Record<string,unknown>[]{assert.ok(Array.isArray(value));return value.map(object);}
export function text(value:unknown):string{assert.equal(typeof value,'string');return value as string;}
export function version(value:unknown):number{assert.equal(typeof value,'number');assert.ok(Number.isSafeInteger(value)&&Number(value)>0);return value as number;}
export async function http(f:T07Fixture,index:number){
 const cookie=f.cookies[index];assert.ok(cookie);
 const get=async(path:string)=>{const r=await fetch(f.origin+path,{headers:{cookie}});return {status:r.status,value:object(await r.json())};};
 const bootstrap=await get('/api/lifecycle/bootstrap');assert.equal(bootstrap.status,200);const csrf=text(bootstrap.value.csrf_token);
 const post=async(path:string,body:Readonly<Record<string,unknown>>)=>{const expected=body.expected_version??body.expected_row_version;const r=await fetch(f.origin+path,{method:'POST',headers:{cookie,origin:f.origin,'content-type':'application/json','x-csrf-token':csrf,'idempotency-key':text(body.client_command_id),...(expected!==undefined?{'if-match':'"'+version(expected)+'"'}:{})},body:JSON.stringify(body)});return {status:r.status,value:object(await r.json())};};
 return {get,post};
}
export async function acceptedSetup(f:T07Fixture){
 const first=f.tickets[0],owner=f.principals[0],actor=f.principals[1];assert.ok(first&&owner&&actor);
 await f.pool.query("INSERT INTO pilot_ticket.resolver_team(team_id,display_name) VALUES('T07_NETWORK','合成网络处理组')");
 const updated=await createPilotAccessService({pool:f.pool}).upsertPrincipal({wecomUserId:'web01-synthetic-1',displayName:'陈悦',roles:['HANDLER'],resolverTeamIds:['PILOT_IT','T07_NETWORK']});assert.equal(updated.id,actor.id);
 await f.runtime.coordinator.runOnce();const a=await http(f,0),b=await http(f,2),path='/api/tickets/'+first.ticket.id;
 const related=await a.get(path+'/related-conversations');assert.equal(related.status,200);const session=rows(related.value.items)[0];assert.ok(session);
 const initial=await a.get(path);assert.equal(initial.status,200);
 const accepted=await a.post(path+'/accept-for-later-with-conversations',{client_command_id:randomUUID(),expected_version:version(initial.value.version),reason_code:'WORKBENCH_SELF_HANDLING',resolver_team_id:'PILOT_IT',communication_choice:'TAKE_SELECTED',sessions:[{session_id:text(session.session_id),expected_row_version:Number(text(session.session_row_version))}]});assert.equal(accepted.status,200,JSON.stringify(accepted.value));
 const before=await b.get(path);assert.equal(before.status,200);assert.equal(before.value.status,'ACCEPTED');assert.equal(before.value.assignee_id,owner.id);assert.equal(object(before.value.handling_cycle).cycle_no,1);
 const events=await a.get(path+'/events'),notices=await a.get(path+'/deliveries'),communication=await a.get(path+'/responsibility');assert.equal(events.status,200);assert.equal(notices.status,200);assert.equal(communication.status,200);assert.equal(rows(notices.value.items).filter(row=>row.notification_type==='TICKET_ACCEPTED').length,1);
 return {a,b,path,first,owner,actor,before:before.value,events:events.value,notices:notices.value,communication:communication.value};
}
export const acceptedOptions={ticketTakeoverEnabled:true,ticketSelfHandlingEnabled:true,ticketConversationSelfHandlingEnabled:true,ticketSelfHandlingWebSource:false,chronologicalTicketEvents:true};
