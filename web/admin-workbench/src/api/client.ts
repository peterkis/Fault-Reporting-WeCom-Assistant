import type { BoardColumn, CompletionRange, BoardPage, WorkbenchCard, WorkbenchDetail, WorkbenchRecord } from '../../../../contracts/web01_workbench_contracts';
export type { BoardColumn, CompletionRange, BoardPage, WorkbenchCard, WorkbenchDetail };
export class ApiError extends Error { constructor(public status:number,public code:string){super(code);} }
function object(value: unknown): Record<string,unknown> {if(!value||typeof value!=='object'||Array.isArray(value))throw new ApiError(502,'INVALID_RESPONSE');return value as Record<string,unknown>;}
function text(value:unknown): string {if(typeof value!=='string')throw new ApiError(502,'INVALID_RESPONSE');return value;}
function nullable(value:unknown): string|null {return value===null?null:text(value);}
function strings(value:unknown):string[] {if(!Array.isArray(value))throw new ApiError(502,'INVALID_RESPONSE');return value.map(text);}
function datetime(value:unknown):string {const v=text(value);if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(v))throw new ApiError(502,'INVALID_RESPONSE');return v;}
function id(value:unknown):string {const v=text(value);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(v))throw new ApiError(502,'INVALID_RESPONSE');return v;}
function decodeCard(value:unknown):WorkbenchCard {
  const v=object(value);if(!['ticket','review','intake'].includes(text(v.kind))||!['pending','active','closed'].includes(text(v.column)))throw new ApiError(502,'INVALID_RESPONSE');
  return {kind:v.kind as WorkbenchCard['kind'],id:id(v.id),intake_id:id(v.intake_id),column:v.column as BoardColumn,
    number:text(v.number),title:text(v.title),status:text(v.status),priority:nullable(v.priority),source:text(v.source),
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
export interface Principal {principal_id:string;display_name:string;roles:string[]}
function decodePrincipal(value:unknown):Principal {const v=object(value);return {principal_id:id(v.principal_id),display_name:text(v.display_name),roles:strings(v.roles)};}
async function get<T>(path:string,signal:AbortSignal,decode:(value:unknown)=>T):Promise<T> {
  const response=await fetch(path,{signal,credentials:'same-origin',redirect:'error',headers:{accept:'application/json'},cache:'no-store'});
  if(!response.headers.get('content-type')?.startsWith('application/json'))throw new ApiError(response.ok?502:response.status,'INVALID_RESPONSE');
  const value:unknown=await response.json();
  if(!response.ok){const v=object(value),e=object(v.error);throw new ApiError(response.status,text(e.code));}
  return decode(value);
}
export const api={
  bootstrap:(signal:AbortSignal)=>get('/api/lifecycle/bootstrap',signal,decodePrincipal),
  board:(column:BoardColumn,range:CompletionRange,cursor:string|null,signal:AbortSignal)=>get('/api/workbench/board?'+new URLSearchParams({column,range,limit:'50',...(cursor?{cursor}:{})}),signal,decodePage),
  detail:(kind:string,id:string,cursor:string|null,signal:AbortSignal)=>get('/api/workbench/items/'+encodeURIComponent(kind)+'/'+encodeURIComponent(id)+'?'+new URLSearchParams({limit:'50',...(cursor?{cursor}:{})}),signal,value=>{
    const detail=decodeDetail(value);if(detail.item.kind!==kind||detail.item.id!==id)throw new ApiError(502,'INVALID_RESPONSE');return detail;
  }),
};
export const statusLabels:Record<string,string>={NEW:'待接单',QUEUED:'待接单',ACCEPTED:'已领取',REOPENED:'重新报障',PENDING:'待复核',RECEIVED:'已受理待建单',WAITING_DESCRIPTION:'待补充报修信息',WAITING_TRIAGE:'待判断',FAILED:'受理处理失败',IN_PROGRESS:'处理中',WAITING_REQUESTER:'等待补充',WAITING_VENDOR:'等待厂商',RESOLVED:'已解决待确认',CLOSED:'已关闭',CANCELLED:'已取消',DUPLICATE_LINKED:'已关联重复单'};
export const sourceLabels:Record<string,string>={WECOM_GROUP:'群聊报修',WECOM_DIRECT:'Bot 私聊',YIXIAOXIU_WEB:'医小修',WEB_REQUEST:'医小修'};
export function errorMessage(error:unknown):string {
  if(error instanceof ApiError){if(error.status===401)return '会话已失效，请重新进入已授权工作台。';if(error.status===403)return '当前身份没有查看权限。';if(error.status===404)return '事项不存在，或不在当前授权范围内。';return '服务请求失败（'+error.status+'），请重试。';}
  return '连接失败，暂时无法读取服务端数据。';
}
