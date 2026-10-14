import type {FollowItem,WorkbenchFollowAttention,WorkbenchFollowCommand,WorkbenchFollowResult,WorkbenchFollowReceipt} from '../contracts/workbench_item_follow_contracts.js';
export type {FollowItem,WorkbenchFollowAttention,WorkbenchFollowCommand,WorkbenchFollowResult,WorkbenchFollowReceipt};
function invalid():never{throw new TypeError('FOLLOW_CONTRACT_INVALID');}
function closed(value:unknown,keys:readonly string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))return invalid();
 const v=value as Record<string,unknown>;
 if(Object.keys(v).length!==keys.length||Object.keys(v).some(key=>!keys.includes(key)))return invalid();return v;
}
function uuid(value:unknown):string{if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value))return invalid();return value;}
function token(value:unknown):string{if(typeof value!=='string'||!/^[a-f0-9]{64}$/u.test(value))return invalid();return value;}
function sameItem(a:FollowItem,b:FollowItem){return a.kind===b.kind&&a.id.toLowerCase()===b.id.toLowerCase();}
export function decodeFollowItem(value:unknown):FollowItem{
 const v=closed(value,['kind','id']);if(v.kind!=='ticket'&&v.kind!=='review'&&v.kind!=='intake')return invalid();return {kind:v.kind,id:uuid(v.id)};
}
export function decodeFollowCommand(value:unknown):WorkbenchFollowCommand{
 const v=closed(value,['client_command_id','canonical_item','expected_follow_version','following']);if(typeof v.following!=='boolean')return invalid();
 return Object.freeze({client_command_id:uuid(v.client_command_id),canonical_item:Object.freeze(decodeFollowItem(v.canonical_item)),expected_follow_version:token(v.expected_follow_version),following:v.following});
}
export function decodeFollowAttention(value:unknown):WorkbenchFollowAttention{
 const v=closed(value,['following','follow_version','related_reasons']),order=['HANDLING','COMMUNICATION','FOLLOW'] as const;
 if(typeof v.following!=='boolean'||!Array.isArray(v.related_reasons)||v.related_reasons.length>3)return invalid();
 const reasons:WorkbenchFollowAttention['related_reasons'][number][]=[];
 for(const reason of v.related_reasons){if(reason!=='HANDLING'&&reason!=='COMMUNICATION'&&reason!=='FOLLOW')return invalid();const previous=reasons.at(-1);if(reasons.includes(reason)||previous!==undefined&&order.indexOf(reason)<=order.indexOf(previous))return invalid();reasons.push(reason);}
 if(v.following!==reasons.includes('FOLLOW'))return invalid();return {following:v.following,follow_version:token(v.follow_version),related_reasons:reasons};
}
export function decodeFollowResult(value:unknown):WorkbenchFollowResult{
 const v=closed(value,['ok','client_command_id','requested_item','canonical_item','following','follow_version','replayed']);
 if(v.ok!==true||typeof v.following!=='boolean'||typeof v.replayed!=='boolean')return invalid();
 return {ok:true,client_command_id:uuid(v.client_command_id),requested_item:decodeFollowItem(v.requested_item),canonical_item:decodeFollowItem(v.canonical_item),following:v.following,follow_version:token(v.follow_version),replayed:v.replayed};
}
export function matchesFollowResult(command:WorkbenchFollowCommand,result:WorkbenchFollowResult,requested:FollowItem):boolean{
 return result.client_command_id.toLowerCase()===command.client_command_id.toLowerCase()&&sameItem(result.requested_item,requested)&&sameItem(result.canonical_item,command.canonical_item)&&result.following===command.following;
}
export function decodeFollowReceipt(value:unknown,requested:FollowItem,commandId:string):WorkbenchFollowReceipt{
 if(!value||typeof value!=='object'||Array.isArray(value))return invalid();const v=value as Record<string,unknown>;
 const item=decodeFollowItem(v.requested_item),id=uuid(v.client_command_id);if(!sameItem(item,requested)||id.toLowerCase()!==commandId.toLowerCase())return invalid();
 const base={client_command_id:id,requested_item:item};
 if(v.state==='UNKNOWN'){closed(v,['client_command_id','requested_item','state']);return {...base,state:'UNKNOWN'};}
 if(v.state==='FAILED'){
  closed(v,['client_command_id','requested_item','state','error']);const e=closed(v.error,['code','retryable']);
  if(typeof e.code!=='string'||!/^[A-Z][A-Z0-9_]{0,127}$/u.test(e.code)||e.retryable!==false)return invalid();return {...base,state:'FAILED',error:{code:e.code,retryable:false}};
 }
 if(v.state==='COMMITTED'){
  closed(v,['client_command_id','requested_item','state','result']);const result=decodeFollowResult(v.result);
  if(!result.replayed||result.client_command_id.toLowerCase()!==id.toLowerCase()||!sameItem(result.requested_item,item))return invalid();return {...base,state:'COMMITTED',result};
 }
 return invalid();
}
