import type {NotificationExceptionItem,NotificationExceptionPage,NotificationExceptionQuery,NotificationExceptionAttempt} from '../contracts/workbench_notification_exception_contracts.js';
function invalid():never{throw new TypeError('NOTIFICATION_EXCEPTION_INVALID_RESPONSE');}
function object(value:unknown,keys:readonly string[]):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k)))invalid();return value as Record<string,unknown>;}
function text(value:unknown,maximum=2048):string{if(typeof value!=='string'||!value||[...value].length>maximum)invalid();return value;}
function uuid(value:unknown){const v=text(value,36);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(v))invalid();return v;}
function choice<T extends string>(value:unknown,values:readonly T[]):T{if(typeof value!=='string'||!values.includes(value as T))invalid();return value as T;}
function integer(value:unknown,min=0){if(!Number.isSafeInteger(value)||(value as number)<min||(value as number)>2147483647)invalid();return value as number;}
function time(value:unknown):string{
 const v=text(value,26);if(!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?$/u.test(v))invalid();
 const y=Number(v.slice(0,4)),m=Number(v.slice(5,7)),d=Number(v.slice(8,10)),maximum=[31,y%4===0&&(y%100!==0||y%400===0)?29:28,31,30,31,30,31,31,30,31,30,31][m-1];
 if(y<1||maximum===undefined||d<1||d>maximum||Number(v.slice(11,13))>23||Number(v.slice(14,16))>59||Number(v.slice(17,19))>59)invalid();return v;
}
const effect=(v:unknown)=>choice(v,['NOT_ATTEMPTED','ACKNOWLEDGED','UNKNOWN'] as const);
function attempt(value:unknown):NotificationExceptionAttempt|null{
 if(value===null)return null;const v=object(value,['attempt_no','outcome','side_effect_state','started_at','finished_at']),outcome=text(v.outcome,64);
 if(!/^[A-Z][A-Z0-9_]{0,63}$/u.test(outcome))invalid();return {attempt_no:integer(v.attempt_no,1),outcome,side_effect_state:effect(v.side_effect_state),started_at:time(v.started_at),finished_at:v.finished_at===null?null:time(v.finished_at)};
}
export function decodeNotificationExceptionItem(value:unknown,expected?:Pick<NotificationExceptionItem,'domain'|'parent_id'|'delivery_id'>):NotificationExceptionItem{
 const v=object(value,['domain','parent_id','delivery_id','source_kind','route_kind','destination_type','status','side_effect_state','attempt_count','last_attempt','safe_summary','error_code','created_at','updated_at','sent_at','allowed_actions','parent_link']);
 const domain=choice(v.domain,['TICKET','SESSION','INCIDENT'] as const),parent=uuid(v.parent_id),delivery=uuid(v.delivery_id),source=choice(v.source_kind,['TICKET_NOTIFICATION','SESSION_MESSAGE','INCIDENT_LIFECYCLE','INCIDENT_PUBLIC_PROGRESS'] as const),route=choice(v.route_kind,['GROUP','BOT_DIRECT','YIXIAOXIU_APP'] as const),destination=choice(v.destination_type,['GROUP','PERSON'] as const),status=choice(v.status,['DEAD_LETTER','RECONCILIATION_REQUIRED','CANCELLED'] as const),state=effect(v.side_effect_state);
 if(expected&&(domain!==expected.domain||parent!==expected.parent_id||delivery!==expected.delivery_id))invalid();
 if(domain==='TICKET'&&source!=='TICKET_NOTIFICATION'||domain==='SESSION'&&source!=='SESSION_MESSAGE'||domain==='INCIDENT'&&!['INCIDENT_LIFECYCLE','INCIDENT_PUBLIC_PROGRESS'].includes(source)||route==='GROUP'&&destination!=='GROUP'||route!=='GROUP'&&destination!=='PERSON'||source==='INCIDENT_PUBLIC_PROGRESS'&&route!=='BOT_DIRECT')invalid();
 if(status!=='DEAD_LETTER'&&state!=='UNKNOWN'||!Array.isArray(v.allowed_actions)||v.allowed_actions.length>2)invalid();
 const actions=v.allowed_actions.map(a=>choice(a,['RETRY','RECONCILE'] as const));if(new Set(actions).size!==actions.length||domain==='INCIDENT'&&actions.length||actions.includes('RETRY')&&(status!=='DEAD_LETTER'||state!=='NOT_ATTEMPTED')||actions.includes('RECONCILE')&&(status!=='RECONCILIATION_REQUIRED'||state!=='UNKNOWN'))invalid();
 const link=domain==='TICKET'?'/workbench/app/items/ticket/'+parent:domain==='SESSION'?'/workbench/app/conversations/'+parent:'/workbench/app/incidents/'+parent;if(v.parent_link!==link)invalid();
 const error=v.error_code===null?null:choice(v.error_code,['FAILURE_RECORDED','RESULT_UNCONFIRMED'] as const);if(error!==null&&error!==(state==='UNKNOWN'?'RESULT_UNCONFIRMED':'FAILURE_RECORDED'))invalid();
 return {domain,parent_id:parent,delivery_id:delivery,source_kind:source,route_kind:route,destination_type:destination,status,side_effect_state:state,attempt_count:integer(v.attempt_count),last_attempt:attempt(v.last_attempt),safe_summary:text(v.safe_summary,1000),error_code:error,created_at:time(v.created_at),updated_at:time(v.updated_at),sent_at:v.sent_at===null?null:time(v.sent_at),allowed_actions:actions,parent_link:link};
}
export function decodeNotificationExceptionPage(value:unknown,filters:Pick<NotificationExceptionQuery,'domain'|'route'|'state'>={}):NotificationExceptionPage{
 const v=object(value,['items','has_more','next_cursor']);if(!Array.isArray(v.items)||v.items.length>50||typeof v.has_more!=='boolean')invalid();
 const items=v.items.map(row=>decodeNotificationExceptionItem(row));
 if(new Set(items.map(row=>row.delivery_id)).size!==items.length||items.some((row,index)=>{const prior=items[index-1];return Boolean(prior&&(row.created_at>prior.created_at||row.created_at===prior.created_at&&row.delivery_id>=prior.delivery_id));}))invalid();
 if(items.some(row=>filters.domain&&filters.domain!=='ALL'&&row.domain!==filters.domain||filters.route&&filters.route!=='ALL'&&row.route_kind!==filters.route||filters.state==='UNKNOWN'&&row.side_effect_state!=='UNKNOWN'||filters.state==='FAILED'&&row.side_effect_state!=='NOT_ATTEMPTED'))invalid();
 const next=v.next_cursor===null?null:text(v.next_cursor);if(v.has_more!==Boolean(next)||v.has_more&&!items.length)invalid();return {items,has_more:v.has_more,next_cursor:next};
}
