import type { BoardColumn, CompletionRange, BoardPage, WorkbenchCard, WorkbenchDetail, WorkbenchRecord,SourceGroupDisplay,SourceGroupNameCommand,SourceGroupNameResult } from '../../../../contracts/web01_workbench_contracts';
import type {P2016InternalNoteCommand,P2016InternalNoteResult,P2016InternalNoteReceipt} from '../../../../contracts/p2_016_contracts';
export type {P2016InternalNoteCommand};
export interface TicketCommandContext {id:string;version:number;allowed_actions:string[]}
export class UnknownCommandOutcome extends Error {constructor(){super('COMMAND_OUTCOME_UNKNOWN');}}
export type { BoardColumn, CompletionRange, BoardPage, WorkbenchCard, WorkbenchDetail };
export class ApiError extends Error { constructor(public status:number,public code:string){super(code);} }
function object(value: unknown): Record<string,unknown> {if(!value||typeof value!=='object'||Array.isArray(value))throw new ApiError(502,'INVALID_RESPONSE');return value as Record<string,unknown>;}
function text(value:unknown): string {if(typeof value!=='string')throw new ApiError(502,'INVALID_RESPONSE');return value;}
function nullable(value:unknown): string|null {return value===null?null:text(value);}
function strings(value:unknown):string[] {if(!Array.isArray(value))throw new ApiError(502,'INVALID_RESPONSE');return value.map(text);}
function datetime(value:unknown):string {const v=text(value);if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(v))throw new ApiError(502,'INVALID_RESPONSE');return v;}
function id(value:unknown):string {const v=text(value);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(v))throw new ApiError(502,'INVALID_RESPONSE');return v;}
function decodeGroup(value:unknown):SourceGroupDisplay {
  const v=object(value),ref=text(v.ref),version=text(v.row_version),name=nullable(v.display_name);
  if(!/^[a-f0-9]{64}$/u.test(ref)||!/^(0|[1-9][0-9]{0,18})$/u.test(version)||BigInt(version)>9223372036854775807n
    ||!['ADMIN_CONFIRMED','UNREGISTERED'].includes(text(v.name_source))
    ||(v.name_source==='UNREGISTERED'?(name!==null||version!=='0'):(name===null||version==='0')))throw new ApiError(502,'INVALID_RESPONSE');
  return {ref,display_name:name,row_version:version,name_source:v.name_source as SourceGroupDisplay['name_source']};
}
function decodeCard(value:unknown):WorkbenchCard {
  const v=object(value);if(!['ticket','review','intake'].includes(text(v.kind))||!['pending','active','closed'].includes(text(v.column)))throw new ApiError(502,'INVALID_RESPONSE');
  return {kind:v.kind as WorkbenchCard['kind'],id:id(v.id),intake_id:id(v.intake_id),column:v.column as BoardColumn,
    number:text(v.number),title:text(v.title),status:text(v.status),priority:nullable(v.priority),source:text(v.source),
    source_label:text(v.source_label),source_group:v.source_group===null?null:decodeGroup(v.source_group),
    location:nullable(v.location),reporter_name:nullable(v.reporter_name),assignee_name:nullable(v.assignee_name),review_reason:nullable(v.review_reason),
    created_at:datetime(v.created_at),updated_at:datetime(v.updated_at),completed_at:v.completed_at===null?null:datetime(v.completed_at)};
}
function decodePage(value:unknown):BoardPage {
  const v=object(value),r=object(v.range);
  if(!Array.isArray(v.items)||v.items.length>100||!['pending','active','closed'].includes(text(v.column))||!['recent','all','cancelled'].includes(text(r.mode))||r.timezone!=='Asia/Shanghai')throw new ApiError(502,'INVALID_RESPONSE');
  const column=v.column as BoardColumn,items=v.items.map(decodeCard);if(items.some(item=>item.column!==column))throw new ApiError(502,'INVALID_RESPONSE');
  return {items,column,next_cursor:nullable(v.next_cursor),range:{mode:r.mode as CompletionRange,from:datetime(r.from),until:datetime(r.until),timezone:'Asia/Shanghai'}};
}
function decodeRecord(value:unknown):WorkbenchRecord {
  const v=object(value);if(!['REPORT','INTERNAL','EXTERNAL'].includes(text(v.audience)))throw new ApiError(502,'INVALID_RESPONSE');
  return {id:text(v.id),at:datetime(v.at),type:text(v.type),text:nullable(v.text),audience:v.audience as WorkbenchRecord['audience'],actor:nullable(v.actor),old_status:nullable(v.old_status),new_status:nullable(v.new_status)};
}
function decodeDetail(value:unknown):WorkbenchDetail {
  const v=object(value),r=object(v.responsibility);if(!Array.isArray(v.records)||v.records.length>100)throw new ApiError(502,'INVALID_RESPONSE');
  return {item:decodeCard(v.item),description:nullable(v.description),records:v.records.map(decodeRecord),next_cursor:nullable(v.next_cursor),
    responsibility:{ticket_assignee_name:nullable(r.ticket_assignee_name),conversation_assignees:strings(r.conversation_assignees)}};
}
export interface Principal {principal_id:string;display_name:string;roles:string[];csrf_token:string|null;source_group_directory_enabled:boolean;internal_notes_enabled:boolean;draft_recovery_enabled:boolean;logout_enabled:boolean}
function decodePrincipal(value:unknown):Principal {const v=object(value);if(typeof v.source_group_directory_enabled!=='boolean'||typeof v.internal_notes_enabled!=='boolean'||typeof v.draft_recovery_enabled!=='boolean'||typeof v.logout_enabled!=='boolean')throw new ApiError(502,'INVALID_RESPONSE');return {principal_id:id(v.principal_id),display_name:text(v.display_name),roles:strings(v.roles),csrf_token:nullable(v.csrf_token),source_group_directory_enabled:v.source_group_directory_enabled,internal_notes_enabled:v.internal_notes_enabled,draft_recovery_enabled:v.draft_recovery_enabled,logout_enabled:v.logout_enabled};}
function version(value:unknown):number {if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1||value>2147483647)throw new ApiError(502,'INVALID_RESPONSE');return value;}
function decodeTicketContext(value:unknown,ticketId:string):TicketCommandContext {
  const v=object(value),actions=strings(v.allowed_actions),ticket=id(v.id);
  if(ticket!==ticketId||actions.length>32||new Set(actions).size!==actions.length||actions.some(action=>! /^[a-z][a-z-]{0,63}$/u.test(action)))throw new ApiError(502,'INVALID_RESPONSE');
  return {id:ticket,version:version(v.version),allowed_actions:actions};
}
async function rejectAuthorization(response:Response):Promise<never>{
  let code='AUTHORIZATION_REJECTED';
  try {const value:unknown=await response.json(),candidate=text(object(object(value).error).code);if(/^[A-Z][A-Z0-9_]{0,100}$/u.test(candidate))code=candidate;}
  catch { /* The HTTP rejection remains authoritative when its error detail is unreadable. */ }
  throw new ApiError(response.status,code);
}
async function get<T>(path:string,signal:AbortSignal,decode:(value:unknown)=>T):Promise<T> {
  const response=await fetch(path,{signal,credentials:'same-origin',redirect:'error',headers:{accept:'application/json'},cache:'no-store'});
  // A credible HTTP authorization rejection fences cached authority even if its error body cannot be decoded.
  if([401,403,404].includes(response.status))return rejectAuthorization(response);
  if(!response.headers.get('content-type')?.startsWith('application/json'))throw new ApiError(response.ok?502:response.status,'INVALID_RESPONSE');
  const value:unknown=await response.json();
  if(!response.ok){const v=object(value),e=object(v.error);throw new ApiError(response.status,text(e.code));}
  return decode(value);
}
export const api={
  async logout(csrfToken:string|null){
    if(!csrfToken)throw new ApiError(403,'CSRF_UNAVAILABLE');
    const response=await fetch('/workbench/logout',{method:'POST',credentials:'same-origin',redirect:'error',cache:'no-store',headers:{accept:'application/json','x-csrf-token':csrfToken}});
    if([401,403,404].includes(response.status))return rejectAuthorization(response);
    if(response.status!==200||!response.headers.get('content-type')?.startsWith('application/json'))throw new UnknownCommandOutcome();
    const value=object(await response.json());if(Object.keys(value).length!==1||value.logged_out!==true)throw new UnknownCommandOutcome();
  },
  bootstrap:(signal:AbortSignal)=>get('/api/lifecycle/bootstrap',signal,decodePrincipal),
  ticketCommandContext:(ticketId:string,signal:AbortSignal)=>get('/api/tickets/'+encodeURIComponent(ticketId),signal,value=>decodeTicketContext(value,ticketId)),
  internalNoteReceipt:(ticketId:string,commandId:string,signal:AbortSignal):Promise<P2016InternalNoteReceipt>=>get('/api/tickets/'+encodeURIComponent(ticketId)+'/internal-notes/commands/'+encodeURIComponent(commandId),signal,value=>{
    const v=object(value);if(id(v.ticket_id)!==ticketId||id(v.client_command_id)!==commandId)throw new ApiError(502,'INVALID_RESPONSE');
    const base={ticket_id:ticketId,client_command_id:commandId};
    if(v.state==='UNKNOWN'&&Object.keys(v).length===3)return {...base,state:'UNKNOWN'};
    if(v.state==='FAILED'&&Object.keys(v).length===4){const e=object(v.error),code=text(e.code);if(Object.keys(e).length!==2||e.retryable!==false||! /^[A-Z][A-Z0-9_]{0,63}$/u.test(code))throw new ApiError(502,'INVALID_RESPONSE');return {...base,state:'FAILED',error:{code,retryable:false}};}
    if(v.state==='COMMITTED'&&Object.keys(v).length===4){const r=object(v.result);if(Object.keys(r).length!==6||r.ok!==true||id(r.ticket_id)!==ticketId||r.control_event_id!==null||r.replayed!==true)throw new ApiError(502,'INVALID_RESPONSE');return {...base,state:'COMMITTED',result:{ok:true,ticket_id:ticketId,ticket_version:version(r.ticket_version),ticket_event_id:id(r.ticket_event_id),control_event_id:null,replayed:true}};}
    throw new ApiError(502,'INVALID_RESPONSE');
  }),
  async addInternalNote(ticketId:string,command:P2016InternalNoteCommand,csrfToken:string|null,signal:AbortSignal):Promise<P2016InternalNoteResult> {
    try{
      const response=await fetch('/api/tickets/'+encodeURIComponent(ticketId)+'/internal-notes',{
        method:'POST',signal,credentials:'same-origin',redirect:'error',cache:'no-store',
        headers:{accept:'application/json','content-type':'application/json','idempotency-key':command.client_command_id,'if-match':'"'+command.expected_version+'"',...(csrfToken?{'x-csrf-token':csrfToken}:{})},body:JSON.stringify(command)});
      if([401,403,404].includes(response.status))return await rejectAuthorization(response);
      if(!response.headers.get('content-type')?.startsWith('application/json'))throw new UnknownCommandOutcome();
      const v=object(await response.json());
      if(!response.ok){
        const code=text(object(v.error).code);
        if(!/^[A-Z][A-Z0-9_]{0,100}$/u.test(code))throw new UnknownCommandOutcome();
        // A durable FAILED receipt is a known refusal. An unstructured server failure may follow a commit.
        if(response.status<500||(v.ok===false&&typeof v.replayed==='boolean'&&object(v.error).retryable===false)||code==='P2_016_DISABLED')throw new ApiError(response.status,code);
        throw new UnknownCommandOutcome();
      }
      if(v.ok!==true||id(v.ticket_id)!==ticketId||typeof v.replayed!=='boolean'||v.control_event_id!==null)throw new UnknownCommandOutcome();
      return {ok:true,ticket_id:ticketId,ticket_version:version(v.ticket_version),ticket_event_id:id(v.ticket_event_id),control_event_id:null,replayed:v.replayed};
    }catch(error){if(error instanceof ApiError&&([401,403,404].includes(error.status)||error.code!=='INVALID_RESPONSE'))throw error;throw new UnknownCommandOutcome();}
  },
  board:(column:BoardColumn,range:CompletionRange,cursor:string|null,signal:AbortSignal)=>get('/api/workbench/board?'+new URLSearchParams({column,range,limit:'50',...(cursor?{cursor}:{})}),signal,decodePage),
  detail:(kind:string,id:string,cursor:string|null,signal:AbortSignal)=>get('/api/workbench/items/'+encodeURIComponent(kind)+'/'+encodeURIComponent(id)+'?'+new URLSearchParams({limit:'50',...(cursor?{cursor}:{})}),signal,value=>{
    const detail=decodeDetail(value);if(detail.item.kind!==kind||detail.item.id!==id)throw new ApiError(502,'INVALID_RESPONSE');return detail;
  }),
  async saveGroupName(ref:string,command:SourceGroupNameCommand,csrfToken:string|null):Promise<SourceGroupNameResult> {
    const response=await fetch('/api/workbench/source-groups/'+encodeURIComponent(ref)+'/name',{
      method:'POST',credentials:'same-origin',redirect:'error',cache:'no-store',
      headers:{accept:'application/json','content-type':'application/json','idempotency-key':command.client_command_id,'if-match':'"'+command.expected_row_version+'"',...(csrfToken?{'x-csrf-token':csrfToken}:{})},body:JSON.stringify(command)});
    if(!response.headers.get('content-type')?.startsWith('application/json'))throw new ApiError(response.ok?502:response.status,'INVALID_RESPONSE');
    const v=object(await response.json());if(!response.ok)throw new ApiError(response.status,text(object(v.error).code));
    if(v.ok!==true||typeof v.replayed!=='boolean')throw new ApiError(502,'INVALID_RESPONSE');
    const group=decodeGroup(v.group);if(group.ref!==ref)throw new ApiError(502,'INVALID_RESPONSE');
    return {ok:true,group,replayed:v.replayed};
  },
};
export const statusLabels:Record<string,string>={NEW:'待接单',QUEUED:'待接单',ACCEPTED:'已领取',REOPENED:'重新报障',PENDING:'待复核',RECEIVED:'已受理待建单',WAITING_DESCRIPTION:'待补充报修信息',WAITING_TRIAGE:'待判断',FAILED:'受理处理失败',IN_PROGRESS:'处理中',WAITING_REQUESTER:'等待补充',WAITING_VENDOR:'等待厂商',RESOLVED:'已解决待确认',CLOSED:'已关闭',CANCELLED:'已取消',DUPLICATE_LINKED:'已关联重复单'};
export const sourceLabels:Record<string,string>={WECOM_GROUP:'群聊报修',WECOM_DIRECT:'Bot 私聊',YIXIAOXIU_WEB:'医小修',WEB_REQUEST:'医小修'};
export function errorMessage(error:unknown):string {
  if(error instanceof ApiError){if(error.status===401)return '会话已失效，请重新进入已授权工作台。';if(error.status===403)return '当前身份没有操作权限。';if(error.status===404)return '事项不存在，或不在当前授权范围内。';if(error.status===409)return '资料已被其他人修改，请重新读取后再保存。';return '服务请求失败（'+error.status+'），请重试。';}
  return '连接失败，暂时无法读取服务端数据。';
}
