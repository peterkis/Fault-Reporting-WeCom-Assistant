import type {CanonicalItem} from '../../../../../contracts/workbench_review_contracts';
import type {PersonalReadPage,PersonalReadAcknowledgement,PersonalReadCommand,PersonalReadReceipt} from '../../../../../contracts/workbench_personal_read_contracts';
import {ApiError,readWorkbench,captureWorkbenchRead,rejectAuthorization} from '../../api/client';
function object(value:unknown,keys:readonly string[]):Record<string,unknown>{
  if(value===null||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||Object.keys(value).some(key=>!keys.includes(key)))throw new ApiError(502,'INVALID_RESPONSE');return value as Record<string,unknown>;
}
function position(value:unknown,zero=true):string{if(typeof value!=='string'||!(zero?/^(?:0|[1-9][0-9]{0,18})$/u:/^[1-9][0-9]{0,18}$/u).test(value)||BigInt(value)>9223372036854775807n)throw new ApiError(502,'INVALID_RESPONSE');return value;}
function key(value:unknown):string{if(typeof value!=='string'||!/^[a-f0-9]{64}$/u.test(value))throw new ApiError(502,'INVALID_RESPONSE');return value;}
export function decodePersonalReadPage(value:unknown):PersonalReadPage{
  const v=object(value,['canonical_item','sources','next_cursor']),canonical=object(v.canonical_item,['kind','id']);
  if(!['ticket','review','intake'].includes(String(canonical.kind))||typeof canonical.id!=='string'||!/^[a-f0-9-]{36}$/u.test(canonical.id)||!Array.isArray(v.sources)||v.sources.length>100||(v.next_cursor!==null&&(typeof v.next_cursor!=='string'||v.next_cursor.length<1||v.next_cursor.length>2048)))throw new ApiError(502,'INVALID_RESPONSE');
  const sources=v.sources.map<PersonalReadPage['sources'][number]>(raw=>{const row=object(raw,['source_key','source_kind','last_read_position','latest_position','row_version','has_unread_material']);
    if((row.source_kind!=='WEB'&&row.source_kind!=='MANUAL'&&row.source_kind!=='BOT')||typeof row.has_unread_material!=='boolean')throw new ApiError(502,'INVALID_RESPONSE');
    const last=position(row.last_read_position),latest=position(row.latest_position,false),version=position(row.row_version);
    if(row.has_unread_material!==(BigInt(latest)>BigInt(last)))throw new ApiError(502,'INVALID_RESPONSE');
    return {source_key:key(row.source_key),source_kind:row.source_kind,last_read_position:last,latest_position:latest,row_version:version,has_unread_material:row.has_unread_material};});
  if(new Set(sources.map(row=>row.source_key)).size!==sources.length)throw new ApiError(502,'INVALID_RESPONSE');
  return {canonical_item:{kind:canonical.kind as CanonicalItem['kind'],id:canonical.id},sources,next_cursor:v.next_cursor};
}
function decodeAcknowledgement(value:unknown,command:PersonalReadCommand):PersonalReadAcknowledgement{
  const v=object(value,['ok','client_command_id','source_key','source_kind','last_read_position','row_version','replayed']);
  if(v.ok!==true||v.client_command_id!==command.client_command_id||(v.source_kind!=='WEB'&&v.source_kind!=='MANUAL'&&v.source_kind!=='BOT')||v.source_kind!==(command.source_ref.startsWith('channel:')?'BOT':command.source_ref.startsWith('manual:')?'MANUAL':'WEB')||typeof v.replayed!=='boolean')throw new ApiError(502,'INVALID_RESPONSE');
  return {ok:true,client_command_id:command.client_command_id,source_key:key(v.source_key),source_kind:v.source_kind,last_read_position:position(v.last_read_position,false),row_version:position(v.row_version,false),replayed:v.replayed};
}
const path=(item:CanonicalItem)=>'/api/workbench/items/'+item.kind+'/'+encodeURIComponent(item.id)+'/read-position';
function decodeReceipt(value:unknown,command:PersonalReadCommand):PersonalReadReceipt{
  if(value===null||typeof value!=='object'||Array.isArray(value))throw new ApiError(502,'INVALID_RESPONSE');
  const candidate=value as Record<string,unknown>,v=object(value,candidate.state==='COMMITTED'?['client_command_id','state','result']:['client_command_id','state']);
  if(v.client_command_id!==command.client_command_id)throw new ApiError(502,'INVALID_RESPONSE');
  if(v.state==='UNKNOWN')return {client_command_id:command.client_command_id,state:'UNKNOWN'};
  if(v.state!=='COMMITTED')throw new ApiError(502,'INVALID_RESPONSE');
  const result=decodeAcknowledgement(v.result,command);if(!result.replayed)throw new ApiError(502,'INVALID_RESPONSE');
  return {client_command_id:command.client_command_id,state:'COMMITTED',result};
}
export const personalReadApi={
  page:(item:CanonicalItem,signal:AbortSignal)=>readWorkbench(path(item),signal,decodePersonalReadPage),
  receipt:(item:CanonicalItem,command:PersonalReadCommand,signal:AbortSignal)=>readWorkbench(path(item)+'/commands/'+encodeURIComponent(command.client_command_id),signal,value=>decodeReceipt(value,command)),
  async advance(item:CanonicalItem,command:PersonalReadCommand,csrf:string|null,signal:AbortSignal){
    const current=captureWorkbenchRead(signal);
    try{
    const response=await fetch(path(item),{method:'POST',signal,credentials:'same-origin',redirect:'error',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':command.client_command_id,...(csrf?{'x-csrf-token':csrf}:{})},body:JSON.stringify(command)});
    current();if([401,403,404].includes(response.status))return await rejectAuthorization(response);if(!response.ok)throw new ApiError(response.status,'PERSONAL_READ_REJECTED');
    const value:unknown=await response.json();current();return decodeAcknowledgement(value,command);
    }catch(error){current();throw error;}
  },
};
