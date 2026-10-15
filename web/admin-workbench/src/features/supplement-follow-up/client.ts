import type {SupplementFollowUpMaterial} from '../../../../../contracts/workbench_supplement_follow_up_material_contracts';
import type {LocalDateTime} from '../../../../../contracts/time_contracts';
import type {SupplementFollowUpCommand,SupplementFollowUpItem,SupplementFollowUpPage,SupplementFollowUpReceipt,SupplementFollowUpResult,SupplementFollowUpTarget} from '../../../../../contracts/workbench_supplement_follow_up_contracts';
export type {SupplementFollowUpCommand,SupplementFollowUpItem,SupplementFollowUpPage,SupplementFollowUpReceipt,SupplementFollowUpResult,SupplementFollowUpTarget};
export interface SupplementFollowUpSummary {readonly has_pending_supplements:boolean}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function invalid():never{throw new TypeError('INVALID_SUPPLEMENT_FOLLOW_UP_RESPONSE');}
function closed(value:unknown,keys:readonly string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))return invalid();const row=value as Record<string,unknown>;
 if(Object.keys(row).length!==keys.length||keys.some(key=>!Object.hasOwn(row,key)))return invalid();return row;
}
function uuid(value:unknown):string{if(typeof value!=='string'||!UUID.test(value))return invalid();return value;}
function datetime(value:unknown):LocalDateTime{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(value))return invalid();
 const year=Number(value.slice(0,4)),month=Number(value.slice(5,7)),day=Number(value.slice(8,10));
 const hour=Number(value.slice(11,13)),minute=Number(value.slice(14,16)),second=Number(value.slice(17,19));
 const maximum=[31,year%4===0&&(year%100!==0||year%400===0)?29:28,31,30,31,30,31,31,30,31,30,31][month-1];
 if(year<1||maximum===undefined||day<1||day>maximum||hour>23||minute>59||second>59)return invalid();
 // Exact second-precision format and Gregorian calendar checks establish the business-time brand.
 return value as LocalDateTime;
}
export function decodeSupplementTarget(value:unknown):SupplementFollowUpTarget{
 const row=closed(value,['source_ref','revision']),ref=row.source_ref,revision=row.revision;
 if(typeof ref!=='string'||ref.length>64||!/^(?:channel:[1-9][0-9]{0,18}|web:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u.test(ref)
  ||typeof revision!=='string'||!/^[1-9][0-9]{0,18}$/u.test(revision))return invalid();
 return {source_ref:ref,revision};
}
export function sameSupplementTarget(a:SupplementFollowUpTarget,b:SupplementFollowUpTarget){return a.source_ref===b.source_ref&&a.revision===b.revision;}
export function decodeSupplementCommand(value:unknown):SupplementFollowUpCommand{
 const row=closed(value,['client_command_id','action','source_ref','revision','disposition_note','mark_followed_up']);
 if(row.action!=='RECORD_DISPOSITION'||row.mark_followed_up!==true||typeof row.disposition_note!=='string'||!row.disposition_note.trim()||Array.from(row.disposition_note).length>2000)return invalid();
 return Object.freeze({client_command_id:uuid(row.client_command_id),action:'RECORD_DISPOSITION',...decodeSupplementTarget({source_ref:row.source_ref,revision:row.revision}),disposition_note:row.disposition_note,mark_followed_up:true});
}
export function decodeSupplementSummary(value:unknown):SupplementFollowUpSummary{
 const row=closed(value,['has_pending_supplements']);if(typeof row.has_pending_supplements!=='boolean')return invalid();return {has_pending_supplements:row.has_pending_supplements};
}
export function decodeSupplementItem(value:unknown):SupplementFollowUpItem{
  const item=closed(value,['source_ref','source_kind','revision','follow_up_state','resolution']),target=decodeSupplementTarget({source_ref:item.source_ref,revision:item.revision});
  if(item.source_kind!=='WEB'&&item.source_kind!=='BOT'||(item.source_kind==='WEB')!==target.source_ref.startsWith('web:'))return invalid();
  const base:SupplementFollowUpTarget&{source_kind:'WEB'|'BOT'}={...target,source_kind:item.source_kind};
  if(item.follow_up_state==='PENDING'&&item.resolution===null)return {...base,follow_up_state:'PENDING',resolution:null};
  if(item.follow_up_state!=='FOLLOWED_UP')return invalid();
  const resolution=closed(item.resolution,['resolution_id','basis','occurred_at']);
  if(resolution.basis!=='RECORDED_DISPOSITION'&&resolution.basis!=='VERIFIED_REPLY')return invalid();
  return {...base,follow_up_state:'FOLLOWED_UP',resolution:{resolution_id:uuid(resolution.resolution_id),basis:resolution.basis,occurred_at:datetime(resolution.occurred_at)}};
}
export function decodeSupplementPage(value:unknown,ticketId:string):SupplementFollowUpPage{
 const row=closed(value,['ticket_id','items','next_cursor','has_pending_supplements']);
 if(uuid(row.ticket_id).toLowerCase()!==ticketId.toLowerCase()||!Array.isArray(row.items)||row.items.length>100||typeof row.has_pending_supplements!=='boolean'
  ||row.next_cursor!==null&&(typeof row.next_cursor!=='string'||!row.next_cursor||row.next_cursor.length>4096))return invalid();
 const items=row.items.map(decodeSupplementItem);
 if(new Set(items.map(item=>JSON.stringify([item.source_ref,item.revision]))).size!==items.length||!row.has_pending_supplements&&items.some(item=>item.follow_up_state==='PENDING'))return invalid();
 return {ticket_id:ticketId,items,next_cursor:row.next_cursor,has_pending_supplements:row.has_pending_supplements};
}
export function decodeSupplementMaterial(value:unknown,ticketId:string,target:SupplementFollowUpTarget):SupplementFollowUpMaterial{
 const row=closed(value,['ticket_id','item']);if(uuid(row.ticket_id).toLowerCase()!==ticketId.toLowerCase())return invalid();
 const item=decodeSupplementItem(row.item);if(!sameSupplementTarget(item,target))return invalid();return {ticket_id:ticketId,item};
}
export function decodeSupplementResult(value:unknown,ticketId:string,commandId:string,target?:SupplementFollowUpTarget):SupplementFollowUpResult{
 const row=closed(value,['ok','client_command_id','ticket_id','source_ref','revision','follow_up_state','resolution_id','basis','replayed']);
 if(row.ok!==true||uuid(row.ticket_id).toLowerCase()!==ticketId.toLowerCase()||uuid(row.client_command_id).toLowerCase()!==commandId.toLowerCase()
  ||row.follow_up_state!=='FOLLOWED_UP'||row.basis!=='RECORDED_DISPOSITION'||typeof row.replayed!=='boolean')return invalid();
 const decoded=decodeSupplementTarget({source_ref:row.source_ref,revision:row.revision});if(target&&!sameSupplementTarget(decoded,target))return invalid();
 return {ok:true,client_command_id:commandId,ticket_id:ticketId,...decoded,follow_up_state:'FOLLOWED_UP',resolution_id:uuid(row.resolution_id),basis:'RECORDED_DISPOSITION',replayed:row.replayed};
}
export function decodeSupplementReceipt(value:unknown,ticketId:string,commandId:string):SupplementFollowUpReceipt{
 if(!value||typeof value!=='object'||Array.isArray(value))return invalid();const row=value as Record<string,unknown>;
 if(uuid(row.ticket_id).toLowerCase()!==ticketId.toLowerCase()||uuid(row.client_command_id).toLowerCase()!==commandId.toLowerCase())return invalid();
 const base={ticket_id:ticketId,client_command_id:commandId};
 if(row.state==='UNKNOWN'){closed(row,['ticket_id','client_command_id','state']);return {...base,state:'UNKNOWN'};}
 if(row.state==='FAILED'){
  closed(row,['ticket_id','client_command_id','state','error']);const error=closed(row.error,['code','retryable']);
  if(typeof error.code!=='string'||!/^[A-Z][A-Z0-9_]{0,63}$/u.test(error.code)||error.retryable!==false)return invalid();
  return {...base,state:'FAILED',error:{code:error.code,retryable:false}};
 }
 if(row.state==='COMMITTED'){
  closed(row,['ticket_id','client_command_id','state','result']);const result=decodeSupplementResult(row.result,ticketId,commandId);
  if(result.replayed!==true)return invalid();return {...base,state:'COMMITTED',result:{...result,replayed:true}};
 }
 return invalid();
}
