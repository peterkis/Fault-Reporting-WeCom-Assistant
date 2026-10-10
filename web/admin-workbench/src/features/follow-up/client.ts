import {ApiError,UnknownCommandOutcome,captureWorkbenchRead,postTicketCommand,readWorkbench} from '../../api/client';
import type {LocalDateTime,PhysicalEpochMs} from '../../../../../contracts/time_contracts';
import type {SharedFollowUpCommand,SharedFollowUpHistoryEntry,SharedFollowUpReceipt,SharedFollowUpResult,SharedFollowUpView} from '../../../../../contracts/workbench_follow_up_schedule_contracts';
export type {SharedFollowUpCommand,SharedFollowUpReceipt,SharedFollowUpResult,SharedFollowUpView};

function invalid():never{throw new ApiError(502,'INVALID_RESPONSE');}
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))return invalid();return value as Record<string,unknown>;}
function closed(value:unknown,keys:readonly string[]):Record<string,unknown>{const v=object(value);if(Object.keys(v).length!==keys.length||Object.keys(v).some(key=>!keys.includes(key)))return invalid();return v;}
function text(value:unknown):string{if(typeof value!=='string')return invalid();return value;}
function id(value:unknown):string{const v=text(value);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(v))return invalid();return v;}
function version(value:unknown):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1||value>2147483647)return invalid();return value;}
function revision(value:unknown,positive=false):string{const v=text(value);if(!/^(0|[1-9][0-9]{0,18})$/u.test(v)||BigInt(v)>9223372036854775807n||positive&&v==='0')return invalid();return v;}
function boolean(value:unknown):boolean{if(typeof value!=='boolean')return invalid();return value;}
function datetime(value:unknown):LocalDateTime{
 const v=text(value);if(!/^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/u.test(v))return invalid();
 const year=Number(v.slice(0,4)),month=Number(v.slice(5,7)),day=Number(v.slice(8,10));
 const days=[31,year%4===0&&(year%100!==0||year%400===0)?29:28,31,30,31,30,31,31,30,31,30,31];
 if(year<1||day>(days[month-1]??0))return invalid();return v as LocalDateTime;
}
/** The input is explicit Shanghai wall time; no browser-local timezone conversion. */
export function followUpInput(value:string):LocalDateTime{const due=datetime(value.trim()),epoch=Date.parse(due.replace(' ','T')+'+08:00');if(!Number.isSafeInteger(epoch)||epoch<0)return invalid();return due;}
function epoch(value:unknown,due:LocalDateTime):PhysicalEpochMs{
 const v=text(value),expected=Date.parse(due.replace(' ','T')+'+08:00');
 if(!/^(0|[1-9][0-9]{0,18})$/u.test(v)||!Number.isSafeInteger(expected)||expected<0||BigInt(v)!==BigInt(expected)||BigInt(v)%1000n!==0n)return invalid();return v as PhysicalEpochMs;
}
function history(value:unknown):SharedFollowUpHistoryEntry{
 const v=closed(value,['schedule_version','action','due_at','occurred_at','ticket_event_id','end_reason']);
 if(v.action!=='SET'&&v.action!=='CANCEL'&&v.action!=='ENDED')return invalid();
 const endReason=v.end_reason;if(endReason!==null&&endReason!=='CLOSED'&&endReason!=='CANCELLED')return invalid();
 if(v.action==='ENDED'?endReason===null:endReason!==null)return invalid();
 return {schedule_version:revision(v.schedule_version,true),action:v.action,due_at:v.due_at===null?null:datetime(v.due_at),occurred_at:datetime(v.occurred_at),ticket_event_id:id(v.ticket_event_id),end_reason:endReason};
}
function view(value:unknown,ticketId:string):SharedFollowUpView{
 const v=closed(value,['ticket_id','ticket_version','schedule_version','active','allowed_actions','history','history_has_more']),ticket=id(v.ticket_id),schedule=revision(v.schedule_version);
 if(ticket!==ticketId||!Array.isArray(v.allowed_actions)||v.allowed_actions.length>2||!Array.isArray(v.history)||v.history.length>20)return invalid();
 const actions:('SET'|'CANCEL')[]=v.allowed_actions.map(value=>{if(value!=='SET'&&value!=='CANCEL')return invalid();return value;});
 if(new Set(actions).size!==actions.length)return invalid();
 let active:SharedFollowUpView['active']=null;
 if(v.active!==null){const a=closed(v.active,['schedule_version','due_at','due_epoch_ms','is_due']),due=datetime(a.due_at),current=revision(a.schedule_version,true);if(current!==schedule)return invalid();active={schedule_version:current,due_at:due,due_epoch_ms:epoch(a.due_epoch_ms,due),is_due:boolean(a.is_due)};}
 return {ticket_id:ticket,ticket_version:version(v.ticket_version),schedule_version:schedule,active,allowed_actions:actions,history:v.history.map(history),history_has_more:boolean(v.history_has_more)};
}
function result(value:unknown,ticketId:string):SharedFollowUpResult{
 const v=closed(value,['ok','ticket_id','ticket_version','ticket_event_id','control_event_id','schedule_version','replayed']);
 if(v.ok!==true||id(v.ticket_id)!==ticketId||v.control_event_id!==null)return invalid();
 return {ok:true,ticket_id:ticketId,ticket_version:version(v.ticket_version),ticket_event_id:id(v.ticket_event_id),control_event_id:null,schedule_version:revision(v.schedule_version,true),replayed:boolean(v.replayed)};
}
function receipt(value:unknown,ticketId:string,commandId:string):SharedFollowUpReceipt{
 const v=object(value);if(id(v.ticket_id)!==ticketId||id(v.client_command_id)!==commandId)return invalid();const base={ticket_id:ticketId,client_command_id:commandId};
 if(v.state==='UNKNOWN'){closed(v,['ticket_id','client_command_id','state']);return {...base,state:'UNKNOWN'};}
 if(v.state==='COMMITTED'){closed(v,['ticket_id','client_command_id','state','result']);const r=result(v.result,ticketId);if(r.replayed!==true)return invalid();return {...base,state:'COMMITTED',result:{...r,replayed:true}};}
 if(v.state==='FAILED'){closed(v,['ticket_id','client_command_id','state','error']);const e=closed(v.error,['code','retryable']),code=text(e.code);if(e.retryable!==false||!/^[A-Z][A-Z0-9_]{0,100}$/u.test(code))return invalid();return {...base,state:'FAILED',error:{code,retryable:false}};}
 return invalid();
}
export function matchesFollowUpResult(command:SharedFollowUpCommand,r:SharedFollowUpResult){return r.ticket_version===command.expected_version+1&&r.schedule_version===(BigInt(command.expected_schedule_version)+1n).toString();}
const path=(ticketId:string)=>'/api/tickets/'+encodeURIComponent(ticketId)+'/follow-up-schedule';
export const followUpApi={
 view:(ticketId:string,signal:AbortSignal)=>readWorkbench(path(ticketId),signal,value=>view(value,ticketId)),
 async perform(ticketId:string,command:SharedFollowUpCommand,csrfToken:string|null,signal:AbortSignal):Promise<SharedFollowUpResult>{
  const currentRead=captureWorkbenchRead(signal);currentRead();
  const r=await postTicketCommand(ticketId,'follow-up-schedule',command,csrfToken,signal,value=>{const r=result(value,ticketId);if(!matchesFollowUpResult(command,r))throw new UnknownCommandOutcome();return r;});
  currentRead();return r;
 },
 acknowledgement:(ticketId:string,commandId:string,signal:AbortSignal)=>readWorkbench(path(ticketId)+'/commands/'+encodeURIComponent(commandId),signal,value=>receipt(value,ticketId,commandId)),
};
