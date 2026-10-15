import {ApiError,UnknownCommandOutcome,captureWorkbenchRead,workbenchTransportWritable} from '../../api/client';
import type {ReviewResolveAndStartCommand,ReviewResolveAndStartResult} from '../../../../../contracts/workbench_review_start_contracts';
import type {ReviewStartContext} from '../../../../../contracts/workbench_review_start_context_contracts';
import type {ReviewStartReceipt} from '../../../../../contracts/workbench_review_start_receipt_contracts';
export type {ReviewResolveAndStartCommand,ReviewResolveAndStartResult};
export type {ReviewStartContext};
export type {ReviewStartReceipt};
function invalid():never{throw new ApiError(502,'INVALID_RESPONSE');}
function object(value:unknown,keys:readonly string[]):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))invalid();const v=value as Record<string,unknown>;if(Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))invalid();return v;}
function text(value:unknown,max=200):string{if(typeof value!=='string'||value.length>max)invalid();return value;}
function id(value:unknown):string{const v=text(value,36);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(v))invalid();return v;}
function code(value:unknown):string{const v=text(value,128);if(!/^[A-Z][A-Z0-9_]{0,127}$/u.test(v))invalid();return v;}
function integer(value:unknown,min=1):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>2147483647)invalid();return value;}
function flag(value:unknown):boolean{if(typeof value!=='boolean')invalid();return value;}
function array(value:unknown,max:number):unknown[]{if(!Array.isArray(value)||value.length>max)invalid();return value;}
function capturedVersion(value:unknown):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1)invalid();return value;}
export function decodeReviewStartTicket(value:unknown):ReviewResolveAndStartCommand['expected_ticket']{
  if(value===null)return null;const ticket=object(value,['ticket_id','expected_version']);return Object.freeze({ticket_id:id(ticket.ticket_id),expected_version:capturedVersion(ticket.expected_version)});
}
export function decodeReviewStartSessions(value:unknown):ReviewResolveAndStartCommand['sessions']{
  const sessions=array(value,8).map(value=>{const s=object(value,['session_id','expected_row_version']);return Object.freeze({session_id:id(s.session_id),expected_row_version:capturedVersion(s.expected_row_version)});});
  if(new Set(sessions.map(s=>s.session_id.toLowerCase())).size!==sessions.length)invalid();return Object.freeze(sessions);
}
export function decodeReviewStartCommand(value:unknown):ReviewResolveAndStartCommand{
  const v=object(value,['client_command_id','expected_row_version','expected_material_basis','resolution_code','resolution_reason_code','expected_ticket','resolver_team_id','communication_choice','sessions']);
  if(typeof v.expected_row_version!=='string'||!/^[1-9][0-9]{0,18}$/u.test(v.expected_row_version)||BigInt(v.expected_row_version)>9223372036854775807n
    ||typeof v.expected_material_basis!=='string'||!/^[a-f0-9]{64}$/u.test(v.expected_material_basis)||v.resolution_code!=='CONFIRM_TICKET_ELIGIBLE'
    ||v.communication_choice!=='TAKE_SELECTED'&&v.communication_choice!=='RETAIN_CURRENT')invalid();
  const ticket=decodeReviewStartTicket(v.expected_ticket),sessions=decodeReviewStartSessions(v.sessions);
  if(v.communication_choice==='TAKE_SELECTED'?sessions.length===0:sessions.length!==0)invalid();
  const reason=code(v.resolution_reason_code),team=code(v.resolver_team_id);if(reason.length>64||team.length>64)invalid();
  return Object.freeze({client_command_id:id(v.client_command_id),expected_row_version:v.expected_row_version,expected_material_basis:v.expected_material_basis,resolution_code:'CONFIRM_TICKET_ELIGIBLE',
    resolution_reason_code:reason,expected_ticket:ticket,resolver_team_id:team,communication_choice:v.communication_choice,sessions});
}
function decodeContext(value:unknown,reviewId:string):ReviewStartContext{
  const v=object(value,['review_id','expected_ticket','resolver_team_id','resolver_teams','allowed']);if(id(v.review_id)!==reviewId)invalid();
  const t=v.expected_ticket===null?null:object(v.expected_ticket,['ticket_id','expected_version']);
  const teams=array(v.resolver_teams,100).map(value=>{const t=object(value,['team_id','display_name']);return {team_id:code(t.team_id),display_name:text(t.display_name)};});
  if(new Set(teams.map(t=>t.team_id)).size!==teams.length)invalid();
  return {review_id:reviewId,expected_ticket:t?{ticket_id:id(t.ticket_id),expected_version:integer(t.expected_version)}:null,
    resolver_team_id:v.resolver_team_id===null?null:code(v.resolver_team_id),resolver_teams:teams,allowed:flag(v.allowed)};
}
function decodeResult(value:unknown,reviewId:string,command:ReviewResolveAndStartCommand):ReviewResolveAndStartResult{
  const v=object(value,['ok','review_id','status','resolution_decision_id','action_count','ticket_id','ticket_version','ticket_event_id','handling_cycle','communication_choice','conversations','canonical_item','replayed']);
  if(v.ok!==true||id(v.review_id)!==reviewId||v.status!=='RESOLVED'||v.communication_choice!==command.communication_choice)invalid();
  const ticketId=id(v.ticket_id),cycle=object(v.handling_cycle,['id','cycle_no','first_responsibility_event_id']),canonical=object(v.canonical_item,['kind','id']);
  if(command.expected_ticket&&ticketId!==command.expected_ticket.ticket_id||canonical.kind!=='ticket'||id(canonical.id)!==ticketId)invalid();
  const conversations=array(v.conversations,8).map(value=>{const c=object(value,['session_id','session_row_version','control_event_id','changed']);return {session_id:id(c.session_id),session_row_version:integer(c.session_row_version),control_event_id:c.control_event_id===null?null:id(c.control_event_id),changed:flag(c.changed)};});
  if(new Set(conversations.map(s=>s.session_id)).size!==conversations.length||conversations.length!==command.sessions.length||conversations.some(s=>!command.sessions.some(c=>c.session_id===s.session_id)))invalid();
  return {ok:true,review_id:reviewId,status:'RESOLVED',resolution_decision_id:id(v.resolution_decision_id),action_count:integer(v.action_count,0),ticket_id:ticketId,ticket_version:integer(v.ticket_version),ticket_event_id:id(v.ticket_event_id),
    handling_cycle:{id:id(cycle.id),cycle_no:integer(cycle.cycle_no),first_responsibility_event_id:id(cycle.first_responsibility_event_id)},communication_choice:command.communication_choice,conversations,canonical_item:{kind:'ticket',id:ticketId},replayed:flag(v.replayed)};
}
async function body(response:Response,current:()=>void):Promise<unknown>{
  if([401,403,404].includes(response.status))throw new ApiError(response.status,'AUTHORIZATION_REJECTED');
  if(!response.headers.get('content-type')?.startsWith('application/json'))throw new UnknownCommandOutcome();
  const value:unknown=await response.json();current();
  if(!response.ok){const v=value&&typeof value==='object'?value as Record<string,unknown>:invalid(),e=object(v.error,['code','retryable']);
    if(response.status<500||v.ok===false&&v.replayed!==undefined&&e.retryable===false||e.code==='P2_016_DISABLED')throw new ApiError(response.status,code(e.code));throw new UnknownCommandOutcome();}
  return value;
}
export const reviewStartApi={
  async receipt(reviewId:string,commandId:string,signal:AbortSignal):Promise<ReviewStartReceipt>{
    const current=captureWorkbenchRead(signal),response=await fetch('/api/manual-reviews/'+encodeURIComponent(reviewId)+'/resolve-and-start/commands/'+encodeURIComponent(commandId),{signal,credentials:'same-origin',redirect:'error',cache:'no-store',headers:{accept:'application/json'}});current();
    const value=await body(response,current);if(!value||typeof value!=='object'||Array.isArray(value))invalid();const state=(value as Record<string,unknown>).state;
    const v=object(value,state==='UNKNOWN'?['client_command_id','review_id','state']:state==='FAILED'?['client_command_id','review_id','state','error']:['client_command_id','review_id','state','ticket_id','ticket_version','ticket_event_id']);
    if(id(v.review_id)!==reviewId||id(v.client_command_id)!==commandId)invalid();const base={client_command_id:commandId,review_id:reviewId};
    if(state==='UNKNOWN')return {...base,state};
    if(state==='FAILED'){const error=object(v.error,['code','retryable']);if(error.retryable!==false)invalid();return {...base,state,error:{code:code(error.code),retryable:false}};}
    if(state==='COMMITTED')return {...base,state,ticket_id:id(v.ticket_id),ticket_version:integer(v.ticket_version),ticket_event_id:id(v.ticket_event_id)};
    invalid();
  },
  async context(reviewId:string,signal:AbortSignal):Promise<ReviewStartContext>{
    const current=captureWorkbenchRead(signal),response=await fetch('/api/manual-reviews/'+encodeURIComponent(reviewId)+'/resolve-and-start-context',{signal,credentials:'same-origin',redirect:'error',cache:'no-store',headers:{accept:'application/json'}});current();
    return decodeContext(await body(response,current),reviewId);
  },
  async perform(reviewId:string,command:ReviewResolveAndStartCommand,csrfToken:string|null,signal:AbortSignal):Promise<ReviewResolveAndStartResult>{
    if(!workbenchTransportWritable())throw new ApiError(503,'TRANSPORT_RECOVERY_REQUIRED');
    const current=captureWorkbenchRead(signal);
    try{const response=await fetch('/api/manual-reviews/'+encodeURIComponent(reviewId)+'/resolve-and-start',{method:'POST',signal,credentials:'same-origin',redirect:'error',cache:'no-store',
      headers:{accept:'application/json','content-type':'application/json','idempotency-key':command.client_command_id,'if-match':'"'+command.expected_row_version+'"',...(csrfToken?{'x-csrf-token':csrfToken}:{})},body:JSON.stringify(command)});current();
      return decodeResult(await body(response,current),reviewId,command);
    }catch(error){if(error instanceof ApiError&&error.code!=='INVALID_RESPONSE')throw error;throw new UnknownCommandOutcome();}
  },
};
