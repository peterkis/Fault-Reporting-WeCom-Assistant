import {ApiError,UnknownCommandOutcome} from '../../api/client';
import type {ConversationWorkspaceEntry,ConversationWorkspacePage,ConversationItemPage,ConversationWorkspaceItem,ConversationWorkspaceDelivery,ConversationMessageResult,ConversationTextCommand,ConversationCommandReceipt,ConversationPurpose} from '../../../../../contracts/workbench_conversation_workspace_contracts';
export type {ConversationWorkspaceEntry,ConversationWorkspaceItem,ConversationPurpose,ConversationTextCommand,ConversationMessageResult};
export const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function bad():never{throw new ApiError(502,'INVALID_RESPONSE');}
function object(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))bad();return v as Record<string,unknown>;}
function text(v:unknown):string{if(typeof v!=='string')bad();return v;}
function nullable(v:unknown){return v===null?null:text(v);}
function uuid(v:unknown){const s=text(v);if(!UUID.test(s))bad();return s;}
function integer(v:unknown){if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)bad();return v;}
function bool(v:unknown){if(typeof v!=='boolean')bad();return v;}
function array<T>(v:unknown,decode:(v:unknown)=>T,max=100):T[]{if(!Array.isArray(v)||v.length>max)bad();return v.map(decode);}
function sequence(v:unknown){const s=text(v);if(!/^[1-9][0-9]{0,18}$/u.test(s)||BigInt(s)>9223372036854775807n)bad();return s;}
function time(v:unknown){const s=text(v);if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(s))bad();return s;}
export function decodeConversation(v:unknown):ConversationWorkspaceEntry{
  const o=object(v),s=object(o.session),a=object(o.assignment),h=o.handoff===null?null:object(o.handoff),i=o.canonical_item===null?null:object(o.canonical_item);
  if(i&&!['ticket','review','intake'].includes(text(i.kind)))bad();
  return {session:{session_id:uuid(s.session_id),status:text(s.status),control_mode:text(s.control_mode),generation_version:integer(s.generation_version),row_version:integer(s.row_version),last_activity_at:time(s.last_activity_at)},participant_label:text(o.participant_label),topic:text(o.topic),channel_label:text(o.channel_label),
    assignment:{status:text(a.status),assigned_to_me:bool(a.assigned_to_me),assigned_display_name:nullable(a.assigned_display_name)},handoff:h?{handoff_id:uuid(h.handoff_id),status:text(h.status),row_version:integer(h.row_version)}:null,capabilities:array(o.capabilities,text,32),
    canonical_item:i?{kind:i.kind as 'ticket'|'review'|'intake',id:uuid(i.id),number:text(i.number),title:text(i.title)}:null};
}
function message(v:unknown):ConversationMessageResult{const o=object(v);if(!['COMMITTED','REPLAYED'].includes(text(o.command_status)))bad();return {message_id:uuid(o.message_id),outbox_id:o.outbox_id===null?null:uuid(o.outbox_id),delivery_ids:array(o.delivery_ids,uuid),command_status:o.command_status as ConversationMessageResult['command_status'],replayed:bool(o.replayed),created_at:time(o.created_at)};}
async function read<T>(path:string,signal:AbortSignal,decode:(v:unknown)=>T):Promise<T>{
  const r=await fetch(path,{signal,credentials:'same-origin',redirect:'error',cache:'no-store',headers:{accept:'application/json'}});
  if([401,403,404].includes(r.status))throw new ApiError(r.status,'AUTHORIZATION_REJECTED');
  if(!r.headers.get('content-type')?.startsWith('application/json'))bad();const v:unknown=await r.json();if(!r.ok)throw new ApiError(r.status,text(object(object(v).error).code));return decode(v);
}
const base=(id:string)=>'/api/workbench/conversations/'+encodeURIComponent(id);
export interface ConversationControlCommand {client_command_id:string;expected_row_version:number;target_principal_id?:string;force?:boolean;reason_code?:string;handoff_id?:string}
async function write<T>(id:string,action:string,command:ConversationTextCommand|ConversationControlCommand,csrf:string|null,signal:AbortSignal,decode:(v:unknown)=>T):Promise<T>{
  try{const r=await fetch(base(id)+'/'+action,{method:'POST',signal,credentials:'same-origin',redirect:'error',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':command.client_command_id,'if-match':'"'+command.expected_row_version+'"',...(csrf?{'x-csrf-token':csrf}:{})},body:JSON.stringify(command)});
    if([401,403,404].includes(r.status))throw new ApiError(r.status,'AUTHORIZATION_REJECTED');
    if(!r.headers.get('content-type')?.startsWith('application/json'))throw new UnknownCommandOutcome();const v:unknown=await r.json();
    if(!r.ok){if(r.status<500)throw new ApiError(r.status,text(object(object(v).error).code));throw new UnknownCommandOutcome();}return decode(v);
  }catch(e){if(e instanceof ApiError&&e.code!=='INVALID_RESPONSE')throw e;throw new UnknownCommandOutcome();}
}
export const conversations={
  list:(state:string,cursor:string|null,signal:AbortSignal):Promise<ConversationWorkspacePage>=>read('/api/workbench/conversations?'+new URLSearchParams({state,limit:'50',...(cursor?{cursor}:{})}),signal,v=>{const o=object(v);return {items:array(o.items,decodeConversation),next_cursor:nullable(o.next_cursor)};}),
  detail:(id:string,signal:AbortSignal)=>read(base(id),signal,v=>{const entry=decodeConversation(v);if(entry.session.session_id!==id)bad();return entry;}),
  links:(kind:string,id:string,signal:AbortSignal)=>read('/api/workbench/items/'+encodeURIComponent(kind)+'/'+encodeURIComponent(id)+'/conversations',signal,v=>({items:array(object(v).items,decodeConversation)})),
  items:(id:string,signal:AbortSignal,boundary?:{before_sequence:string}|{after_sequence:string}):Promise<ConversationItemPage>=>read(base(id)+'/items?'+new URLSearchParams({limit:'100',...boundary}),signal,v=>{const o=object(v);if(uuid(o.session_id)!==id)bad();return {session_id:id,items:array(o.items,v=>{const i=object(v);return {item_id:uuid(i.item_id),sequence_no:sequence(i.sequence_no),item_type:text(i.item_type),sender_kind:text(i.sender_kind),visibility:text(i.visibility),text:nullable(i.text),occurred_at:time(i.occurred_at)};},200),before_sequence:o.before_sequence===null?null:sequence(o.before_sequence),after_sequence:o.after_sequence===null?null:sequence(o.after_sequence),has_more:bool(o.has_more)};}),
  deliveries:(id:string,signal:AbortSignal)=>read(base(id)+'/deliveries',signal,v=>({items:array(object(v).items,v=>{const d=object(v);return {message_id:uuid(d.message_id),delivery_id:uuid(d.delivery_id),purpose:text(d.purpose),status:text(d.status),side_effect_state:text(d.side_effect_state),channel:text(d.channel),attempt_count:integer(d.attempt_count),last_error_code:nullable(d.last_error_code),sent_at:d.sent_at===null?null:time(d.sent_at),created_at:time(d.created_at)} satisfies ConversationWorkspaceDelivery;})})),
  eligible:(id:string,signal:AbortSignal)=>read(base(id)+'/eligible-principals',signal,v=>({items:array(object(v).items,v=>{const p=object(v);return {principal_id:uuid(p.principal_id),display_name:text(p.display_name)};})})),
  send:(id:string,purpose:ConversationPurpose,command:ConversationTextCommand,csrf:string|null,signal:AbortSignal)=>write(id,purpose,command,csrf,signal,message),
  control:(id:string,action:string,command:ConversationControlCommand,csrf:string|null,signal:AbortSignal)=>write(id,action,command,csrf,signal,v=>{const o=object(v);if(o.ok!==true)bad();return o;}),
  receipt:(id:string,purpose:ConversationPurpose,nonce:string,signal:AbortSignal):Promise<ConversationCommandReceipt>=>read(base(id)+'/'+purpose+'/commands/'+encodeURIComponent(nonce),signal,v=>{const o=object(v);if(uuid(o.session_id)!==id||uuid(o.client_command_id)!==nonce)bad();if(o.state==='UNKNOWN'&&Object.keys(o).length===3)return {session_id:id,client_command_id:nonce,state:'UNKNOWN'};if(o.state==='COMMITTED'&&Object.keys(o).length===4)return {session_id:id,client_command_id:nonce,state:'COMMITTED',result:message(o.result)};return bad();}),
};
