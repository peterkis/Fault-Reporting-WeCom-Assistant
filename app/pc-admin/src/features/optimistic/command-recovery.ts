import {useSyncExternalStore} from 'react';
import {ApiError,ConfirmedClaimRejection} from '../../api/client';
import type {P2016SelfHandlingCommand,SelfHandlingAction,WorkbenchCard} from '../../api/client';
import type {FollowItem,WorkbenchFollowCommand} from '../../contracts/workbench-follow-browser-contracts.mjs';
import type {ConversationHandlingIntent} from '../ticket-handling/use-conversation-handling-draft';
import {DRAFT_TTL_MS} from '../drafts/encrypted-drafts';

// Receipt checks need no form contents. Self handling has no receipt endpoint
// and requires the original action and body for an explicit idempotent replay.
export type RecoveryIntent=
  | {purpose:'return'|'close';id:string}
  | {purpose:'restore';id:string;requested?:FollowItem}
  | {purpose:'conversation';id:string;replay?:ConversationHandlingIntent}
  | {purpose:'self';id:string;action:SelfHandlingAction;command:P2016SelfHandlingCommand}
  | {purpose:'follow';id:string;requested:FollowItem;command?:WorkbenchFollowCommand};
type Purpose=RecoveryIntent['purpose'];
type RecoveryScope={principal:string;kind:string;itemId:string;intakeId?:string};
type CommandRecord={scope:RecoveryScope;intent:RecoveryIntent;unknown:boolean;expiry?:ReturnType<typeof setTimeout>};
const records=new Map<string,CommandRecord>();
const listeners=new Set<()=>void>();
const key=(scope:RecoveryScope,purpose:Purpose)=>JSON.stringify([scope.principal,scope.kind,scope.itemId.toLowerCase(),purpose]);
const notify=()=>{for(const listener of listeners)listener();};
function subscribe(listener:()=>void){listeners.add(listener);return ()=>{listeners.delete(listener);};}

export function useCommandRecovery(scope:RecoveryScope,purpose:Purpose){
  const id=key(scope,purpose);
  return useSyncExternalStore(subscribe,()=>records.get(id),()=>undefined);
}

function originalAlias(intent:RecoveryIntent){
  return intent.purpose==='restore'||intent.purpose==='follow'?intent.requested:undefined;
}

/** A Review URL and its current Ticket can both lead back to the original Undo. */
export function useItemUndoRecovery(principal:string,purpose:'restore'|'follow',item:Pick<WorkbenchCard,'kind'|'id'|'intake_id'>|undefined,requested?:FollowItem){
  return useSyncExternalStore(subscribe,()=>{
    if(!item||!records.size)return undefined;
    const direct=(ref:FollowItem)=>records.get(key({principal,kind:ref.kind,itemId:ref.id},purpose));
    const original=requested&&direct(requested);
    if(original)return original;
    const intakeId=item.intake_id.toLowerCase();
    let match=direct(item)??direct({kind:'intake',id:intakeId});
    for(const entry of records.values()){
      if(entry.scope.principal!==principal||entry.intent.purpose!==purpose)continue;
      const alias=originalAlias(entry.intent);
      if(requested&&alias?.kind===requested.kind&&alias.id.toLowerCase()===requested.id.toLowerCase())return entry;
      if(!match&&entry.scope.intakeId?.toLowerCase()===intakeId)match=entry;
    }
    return match;
  },()=>undefined);
}

function remove(id:string){clearTimeout(records.get(id)?.expiry);records.delete(id);}

export function forgetRecoveredCommand(scope:RecoveryScope,purpose:Purpose,commandId:string){
  const id=key(scope,purpose);
  if(records.get(id)?.intent.id!==commandId)return false;
  remove(id);
  notify();
  return true;
}

export function keepFollowReceipt(scope:RecoveryScope,commandId:string){
  const id=key(scope,'follow'),entry=records.get(id);
  if(entry?.intent.purpose!=='follow'||entry.intent.id!==commandId||!entry.intent.command)return;
  clearTimeout(entry.expiry);
  const {purpose,requested}=entry.intent;
  records.set(id,{scope:entry.scope,intent:{purpose,requested,id:commandId},unknown:true});
  notify();
}

export function clearItemCommandRecovery(principal:unknown,kind:unknown,itemId:unknown){
  if(typeof itemId!=='string')return;
  for(const [id,{scope,intent}] of records){
    if(principal!==scope.principal)continue;
    const alias=originalAlias(intent),viaAlias=alias&&alias.kind===kind&&alias.id.toLowerCase()===itemId.toLowerCase();
    if(viaAlias||kind===scope.kind&&scope.itemId.toLowerCase()===itemId.toLowerCase())remove(id);
  }
  notify();
}

export function clearCommandRecovery(){for(const id of records.keys())remove(id);notify();}

export function dispatchConversationClaim<T>(scope:RecoveryScope,intent:ConversationHandlingIntent,receiptEnabled:boolean,signal:AbortSignal,send:()=>Promise<T>){
  // The combined-claim GET requires draft recovery. Without it, only an explicit
  // replay of the original POST can resolve an unknown result after navigation.
  const id=intent.command.client_command_id;
  return dispatchRecoverable(scope,receiptEnabled?{purpose:'conversation',id}:{purpose:'conversation',id,replay:intent},signal,send);
}

/** Reserve before the POST, so aborting a keyed view exposes the same operation to its successor. */
export async function dispatchRecoverable<T>(scope:RecoveryScope,intent:RecoveryIntent,signal:AbortSignal,send:()=>Promise<T>):Promise<T>{
  signal.throwIfAborted();
  const id=key(scope,intent.purpose),previous=records.get(id);
  if(previous&&(!previous.unknown||previous.intent.id!==intent.id))throw new ApiError(409,'WORKBENCH_OPERATION_PENDING');
  clearTimeout(previous?.expiry);
  const entry:CommandRecord={scope,intent,unknown:false};
  records.set(id,entry);
  notify();
  const unknown=()=>{
    if(records.get(id)!==entry)return;
    const retained={...entry,unknown:true};
    if(intent.purpose==='follow')retained.expiry=setTimeout(()=>keepFollowReceipt(scope,intent.id),DRAFT_TTL_MS);
    records.set(id,retained);
    notify();
  };
  signal.addEventListener('abort',unknown,{once:true});
  try{
    const result=await send();
    if(records.get(id)===entry)forgetRecoveredCommand(scope,intent.purpose,intent.id);
    return result;
  }catch(error){
    // The command clients have already distinguished a known rejection from a lost or malformed response.
    if(records.get(id)===entry&&error instanceof ApiError&&(!previous||error instanceof ConfirmedClaimRejection&&error.commandId===intent.id))forgetRecoveredCommand(scope,intent.purpose,intent.id);
    else unknown();
    throw error;
  }finally{signal.removeEventListener('abort',unknown);}
}
