// These bounded browser-local recovery copies never own Ticket facts or authority.
export interface DraftScope {principal:string;kind:'ticket'|'review'|'intake'|'conversation'|'incident-candidate';id:string;purpose:string}
export interface DraftRecord {schema:1;scope:string;principal:string;kind:DraftScope['kind'];id:string;purpose:string;firstSavedAt:number;expiresAt:number;revision:string;iv:Uint8Array<ArrayBuffer>;ciphertext:ArrayBuffer;key:CryptoKey}
export interface OperationRecord extends DraftScope {scope:string;commandId:string;createdAt:number}
export interface DraftHandle {scope:DraftScope;record:DraftRecord|null;operation:OperationRecord|null;epoch:string}
export class DraftError extends Error {}
export interface DraftInvalidation {principal:string;kind?:DraftScope['kind'];id?:string;purpose?:string;reason:'discard'|'expired'|'settled'|'revoked'|'logout'|'logout-unknown'}
const listeners=new Set<(value:DraftInvalidation)=>void>();let channel:BroadcastChannel|null=null;
function invalidation(value:unknown):DraftInvalidation|null{
  if(!value||typeof value!=='object'||Array.isArray(value))return null;const v=value as Record<string,unknown>;
  const reason=v.reason,kind=v.kind;
  if(typeof v.principal!=='string'||!UUID.test(v.principal)||(reason!=='discard'&&reason!=='expired'&&reason!=='settled'&&reason!=='revoked'&&reason!=='logout'&&reason!=='logout-unknown')||Object.keys(v).some(key=>!['principal','kind','id','purpose','reason'].includes(key)))return null;
  if(kind!==undefined&&kind!=='ticket'&&kind!=='review'&&kind!=='intake'&&kind!=='conversation'&&kind!=='incident-candidate'||v.id!==undefined&&(typeof v.id!=='string'||!UUID.test(v.id))||v.purpose!==undefined&&(typeof v.purpose!=='string'||! /^[a-z][a-z-]{0,63}$/u.test(v.purpose)))return null;
  return {principal:v.principal,reason,...(kind!==undefined?{kind}:{}),...(typeof v.id==='string'?{id:v.id}:{}),...(typeof v.purpose==='string'?{purpose:v.purpose}:{})};
}
function publish(value:DraftInvalidation){for(const listener of listeners)listener(value);if(!channel&&!globalThis.BroadcastChannel)return;const target=channel??new BroadcastChannel('wecom-workbench-drafts-v1');target.postMessage(value);if(!channel)target.close();}
export function matchesDraft(value:DraftInvalidation,scope:DraftScope){return value.principal===scope.principal&&(value.kind===undefined||value.kind===scope.kind)&&(value.id===undefined||value.id===scope.id)&&(value.purpose===undefined||value.purpose===scope.purpose);}
export function subscribeDrafts(listener:(value:DraftInvalidation)=>void):()=>void{
  if(!globalThis.BroadcastChannel)throw new DraftError('DRAFT_STORAGE_UNAVAILABLE');
  if(!channel){channel=new BroadcastChannel('wecom-workbench-drafts-v1');channel.onmessage=event=>{const value=invalidation(event.data);if(value)for(const receive of listeners)receive(value);};}
  listeners.add(listener);return()=>{listeners.delete(listener);if(!listeners.size){channel?.close();channel=null;}};
}
export const DRAFT_TTL_MS=86_400_000,DRAFT_MAX_BYTES=16_384,DRAFT_MAX_COUNT=20;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,encoder=new TextEncoder();
export function draftScopeKey(scope:DraftScope):string {
  if(!UUID.test(scope.principal)||!UUID.test(scope.id)||!['ticket','review','intake','conversation','incident-candidate'].includes(scope.kind)||! /^[a-z][a-z-]{0,63}$/u.test(scope.purpose))throw new DraftError('DRAFT_SCOPE_INVALID');
  return JSON.stringify([scope.principal,scope.kind,scope.id,scope.purpose]);
}
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new DraftError('DRAFT_CORRUPT');return value as Record<string,unknown>;}
function scopeOf(v:Record<string,unknown>):DraftScope{
  if(typeof v.principal!=='string'||typeof v.id!=='string'||typeof v.purpose!=='string'||(v.kind!=='ticket'&&v.kind!=='review'&&v.kind!=='intake'&&v.kind!=='conversation'&&v.kind!=='incident-candidate'))throw new DraftError('DRAFT_CORRUPT');
  const scope:DraftScope={principal:v.principal,kind:v.kind,id:v.id,purpose:v.purpose};if(v.scope!==draftScopeKey(scope))throw new DraftError('DRAFT_CORRUPT');return scope;
}
function decode(value:unknown):DraftRecord {
  const v=object(value),scope=scopeOf(v);
  if(Object.keys(v).length!==12||v.schema!==1||typeof v.scope!=='string'||typeof v.firstSavedAt!=='number'||!Number.isSafeInteger(v.firstSavedAt)||v.firstSavedAt<0
    ||typeof v.expiresAt!=='number'||!Number.isSafeInteger(v.expiresAt)||v.expiresAt-v.firstSavedAt!==DRAFT_TTL_MS||typeof v.revision!=='string'||!UUID.test(v.revision)
    ||!(v.iv instanceof Uint8Array)||v.iv.byteLength!==12||!(v.iv.buffer instanceof ArrayBuffer)||!(v.ciphertext instanceof ArrayBuffer)||v.ciphertext.byteLength>DRAFT_MAX_BYTES+16||v.ciphertext.byteLength<16
    ||!(v.key instanceof CryptoKey)||v.key.extractable||v.key.type!=='secret'||v.key.algorithm.name!=='AES-GCM'||!('length' in v.key.algorithm)||v.key.algorithm.length!==256
    ||v.key.usages.length!==2||!v.key.usages.includes('encrypt')||!v.key.usages.includes('decrypt'))throw new DraftError('DRAFT_CORRUPT');
  return {schema:1,scope:v.scope,...scope,firstSavedAt:v.firstSavedAt,expiresAt:v.expiresAt,revision:v.revision,iv:new Uint8Array(v.iv),ciphertext:v.ciphertext,key:v.key};
}
function decodeOperation(value:unknown):OperationRecord{
  const v=object(value),scope=scopeOf(v);
  if(Object.keys(v).length!==7||typeof v.scope!=='string'||typeof v.commandId!=='string'||!UUID.test(v.commandId)||typeof v.createdAt!=='number'||!Number.isSafeInteger(v.createdAt)||v.createdAt<0||encoder.encode(JSON.stringify(v)).byteLength>512)throw new DraftError('DRAFT_CORRUPT');
  return {scope:v.scope,...scope,commandId:v.commandId,createdAt:v.createdAt};
}
async function database():Promise<IDBDatabase>{
  if(!globalThis.isSecureContext||!globalThis.crypto?.subtle||!globalThis.indexedDB)throw new DraftError('DRAFT_STORAGE_UNAVAILABLE');
  return new Promise((resolve,reject)=>{
    let rejected=false;const request=indexedDB.open('wecom-workbench-drafts-v1',2);
    request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('drafts'))db.createObjectStore('drafts',{keyPath:'scope'});if(!db.objectStoreNames.contains('operations'))db.createObjectStore('operations',{keyPath:'scope'});if(!db.objectStoreNames.contains('control'))db.createObjectStore('control').put(crypto.randomUUID(),'epoch');};
    request.onerror=()=>reject(new DraftError('DRAFT_STORAGE_UNAVAILABLE'));
    request.onblocked=()=>{rejected=true;reject(new DraftError('DRAFT_STORAGE_UNAVAILABLE'));};
    request.onsuccess=()=>{if(rejected)request.result.close();else resolve(request.result);};
  });
}
interface State {drafts:DraftRecord[];operations:OperationRecord[];epoch:string;expired:Set<string>;draftStore:IDBObjectStore;operationStore:IDBObjectStore;control:IDBObjectStore}
async function state<T>(run:(value:State)=>T):Promise<T>{
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(['drafts','operations','control'],'readwrite'),draftStore=tx.objectStore('drafts'),operationStore=tx.objectStore('operations'),control=tx.objectStore('control');
    const rows=draftStore.getAll(undefined,21),keys=draftStore.getAllKeys(undefined,21),operations=operationStore.getAll(undefined,21),operationKeys=operationStore.getAllKeys(undefined,21),epoch=control.get('epoch');
    let finished=false,result:T,failed:unknown;
    tx.oncomplete=()=>{db.close();if(failed!==undefined)reject(failed);else if(finished)resolve(result);else reject(new DraftError('DRAFT_STORAGE_UNAVAILABLE'));};
    tx.onabort=()=>{db.close();reject(failed??new DraftError('DRAFT_STORAGE_UNAVAILABLE'));};tx.onerror=()=>{};
    let remaining=5;
    const read=()=>{if(--remaining)return;try{
      const rowValues:readonly unknown[]=rows.result,operationValues:readonly unknown[]=operations.result,rawEpoch:unknown=epoch.result;
      if(typeof rawEpoch!=='string'||!UUID.test(rawEpoch)||rowValues.length>20||operationValues.length>20)throw new DraftError('DRAFT_STORAGE_UNAVAILABLE');
      const value:State={drafts:[],operations:[],epoch:rawEpoch,expired:new Set(),draftStore,operationStore,control};let cleaned=false;
      for(const [index,row] of rowValues.entries()){try{const record=decode(row);if(Date.now()>=record.expiresAt){draftStore.delete(record.scope);value.expired.add(record.scope);cleaned=true;}else value.drafts.push(record);}catch{const key=keys.result[index];if(key!==undefined){draftStore.delete(key);cleaned=true;}}}
      for(const row of operationValues){try{value.operations.push(decodeOperation(row));}catch{failed=new DraftError('DRAFT_OPERATION_CORRUPT');}}
      if(cleaned){value.epoch=crypto.randomUUID();control.put(value.epoch,'epoch');}
      // Commit expired sensitive cleanup, retain untrusted opaque rows, then refuse new work.
      if(failed!==undefined)return;
      result=run(value);finished=true;
    }catch(error){failed=error;tx.abort();}};
    for(const request of [rows,keys,operations,operationKeys,epoch])request.onsuccess=read;
  });
}
function aad(record:Pick<DraftRecord,'schema'|'scope'|'firstSavedAt'|'expiresAt'|'revision'>){return encoder.encode(JSON.stringify([record.schema,record.scope,record.firstSavedAt,record.expiresAt,record.revision]));}
export async function openDraft(scope:DraftScope,{restore=true}:{restore?:boolean}={}):Promise<{handle:DraftHandle;text:string|null;expired:boolean}>{
  const key=draftScopeKey(scope),snapshot=await state(value=>({record:value.drafts.find(row=>row.scope===key)??null,operation:value.operations.find(row=>row.scope===key)??null,epoch:value.epoch,expired:value.expired.has(key)}));
  const handle:DraftHandle={scope,record:snapshot.record,operation:snapshot.operation,epoch:snapshot.epoch};
  if(!snapshot.record||!restore)return {handle,text:null,expired:snapshot.expired};
  const record=snapshot.record;let plaintext:ArrayBuffer;
  try{plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:record.iv,additionalData:aad(record),tagLength:128},record.key,record.ciphertext);}
  catch{await removeSensitiveDraft(handle);return {handle,text:null,expired:false};}
  const valid=await state(value=>value.epoch===handle.epoch&&value.drafts.some(row=>row.scope===key&&row.revision===record.revision));
  if(!valid)throw new DraftError('DRAFT_CHANGED');
  return {handle,text:new TextDecoder('utf-8',{fatal:true}).decode(plaintext),expired:false};
}
export async function saveDraft(handle:DraftHandle,text:string,{commandId,settledCommandId}:{commandId?:string;settledCommandId?:string}={}):Promise<DraftRecord>{
  const bytes=encoder.encode(text);if(bytes.byteLength>DRAFT_MAX_BYTES)throw new DraftError('DRAFT_TOO_LARGE');
  const previous=handle.record?.revision,firstSavedAt=handle.record?.firstSavedAt??Date.now(),expiresAt=firstSavedAt+DRAFT_TTL_MS,epoch=handle.epoch;
  if(Date.now()>=expiresAt)throw new DraftError('DRAFT_EXPIRED');
  if(commandId!==undefined&&!UUID.test(commandId))throw new DraftError('DRAFT_SCOPE_INVALID');
  const key=handle.record?.key??await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  const metadata={schema:1 as const,scope:draftScopeKey(handle.scope),...handle.scope,firstSavedAt,expiresAt,revision:crypto.randomUUID()},iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(metadata),tagLength:128},key,bytes),record:DraftRecord={...metadata,iv,ciphertext,key};
  const committed=await state(value=>{
    const current=value.drafts.find(row=>row.scope===record.scope),operation=value.operations.find(row=>row.scope===record.scope);
    if(value.epoch!==epoch||current?.revision!==previous||Date.now()>=expiresAt)return {error:'DRAFT_CHANGED'};
    if(operation&&operation.commandId!==commandId&&operation.commandId!==settledCommandId)return {error:'DRAFT_OPERATION_UNRESOLVED'};
    if(!current&&value.drafts.length>=DRAFT_MAX_COUNT)return {error:'DRAFT_FULL'};
    if(commandId&&!operation&&value.operations.length>=DRAFT_MAX_COUNT)return {error:'DRAFT_OPERATION_FULL'};
    if(settledCommandId&&operation?.commandId===settledCommandId)value.operationStore.delete(record.scope);
    const nextOperation:OperationRecord|null=commandId?{scope:record.scope,...handle.scope,commandId,createdAt:operation?.createdAt??Date.now()}:null;
    if(nextOperation)value.operationStore.put(nextOperation);
    value.draftStore.put(record);return {operation:nextOperation};
  });
  if('error' in committed)throw new DraftError(committed.error);
  handle.record=record;handle.operation=committed.operation;return record;
}
// The caller must freshly authorize its own scope. This only refreshes a still-existing
// unchanged row's in-memory fence; cleared/expired rows and newer tab writes stay fenced.
export async function rebaseDraft(handle:DraftHandle):Promise<void>{
  const key=draftScopeKey(handle.scope),record=handle.record,operation=handle.operation;
  if(!record||record.scope!==key||record.expiresAt<=Date.now())throw new DraftError('DRAFT_CHANGED');
  const epoch=await state(value=>{
    const current=value.drafts.find(row=>row.scope===key),pending=value.operations.find(row=>row.scope===key)??null;
    if(!current||current.scope!==record.scope||current.revision!==record.revision||current.firstSavedAt!==record.firstSavedAt||current.expiresAt!==record.expiresAt||current.expiresAt<=Date.now()
      ||(operation===null?pending!==null:!pending||pending.scope!==operation.scope||pending.commandId!==operation.commandId||pending.createdAt!==operation.createdAt))throw new DraftError('DRAFT_CHANGED');
    return value.epoch;
  });
  if(handle.record!==record||handle.operation!==operation)throw new DraftError('DRAFT_CHANGED');
  handle.epoch=epoch;
}
// Only a caller that observed a blank form before an unrelated settlement and
// freshly authorized that scope may use this. No private copy is recreated here.
export async function refreshEmptyDraft(handle:DraftHandle):Promise<void>{
  const key=draftScopeKey(handle.scope),previousEpoch=handle.epoch;
  if(handle.record!==null||handle.operation!==null)throw new DraftError('DRAFT_CHANGED');
  const epoch=await state(value=>{
    if(value.drafts.some(row=>row.scope===key)||value.operations.some(row=>row.scope===key))throw new DraftError('DRAFT_CHANGED');
    return value.epoch;
  });
  if(handle.record!==null||handle.operation!==null||handle.epoch!==previousEpoch)throw new DraftError('DRAFT_CHANGED');
  handle.epoch=epoch;
}
export async function removeSensitiveDraft(handle:DraftHandle,reason:DraftInvalidation['reason']='expired'):Promise<void>{
  const key=draftScopeKey(handle.scope),revision=handle.record?.revision;
  const next=await state(value=>{const current=value.drafts.find(row=>row.scope===key);if(current&&current.revision===revision){value.draftStore.delete(key);value.epoch=crypto.randomUUID();value.control.put(value.epoch,'epoch');}return {epoch:value.epoch,operation:value.operations.find(row=>row.scope===key)??null};});
  handle.record=null;handle.epoch=next.epoch;handle.operation=next.operation;
  publish({...handle.scope,reason});
}
export async function settleDraft(handle:DraftHandle,commandId:string,revision?:string):Promise<void>{
  const key=draftScopeKey(handle.scope);
  const next=await state(value=>{
    const current=value.drafts.find(row=>row.scope===key),operation=value.operations.find(row=>row.scope===key);
    const removed=operation?.commandId===commandId&&(!current||current.revision===revision);
    if(removed){value.operationStore.delete(key);if(current)value.draftStore.delete(key);value.epoch=crypto.randomUUID();value.control.put(value.epoch,'epoch');}
    return {epoch:value.epoch,record:removed?null:current??null,operation:removed?null:operation??null,removed};
  });
  handle.record=next.record;handle.operation=next.operation;handle.epoch=next.epoch;
  if(next.removed)publish({...handle.scope,reason:'settled'});
}
export async function purgeDrafts(filter:DraftInvalidation):Promise<void>{
  if(!invalidation(filter))throw new DraftError('DRAFT_SCOPE_INVALID');
  // A disabled application must not create a draft database just to clear it.
  if(!globalThis.indexedDB?.databases)throw new DraftError('DRAFT_STORAGE_UNAVAILABLE');
  if(!(await indexedDB.databases()).some(db=>db.name==='wecom-workbench-drafts-v1'))return;
  const db=await database();
  await new Promise<void>((resolve,reject)=>{
    let tx:IDBTransaction;try{tx=db.transaction(['drafts','operations','control'],'readwrite');}catch(error){db.close();reject(error);return;}
    let failure:unknown;tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(failure??new DraftError('DRAFT_STORAGE_UNAVAILABLE'));};tx.onerror=()=>{};
    for(const name of ['drafts','operations']){
      const store=tx.objectStore(name),rows=store.getAll(undefined,21),keys=store.getAllKeys(undefined,21);let remaining=2;
      const loaded=()=>{if(--remaining)return;try{if(rows.result.length>20)throw new DraftError('DRAFT_STORAGE_UNAVAILABLE');for(const [index,row] of (rows.result as unknown[]).entries()){
        // Explicit authorized purge can clear malformed metadata without treating it as a failed command.
        const key=keys.result[index];if(key===undefined)continue;let scope:DraftScope|null=null;
        try{scope=scopeOf(object(row));}catch{if(typeof key==='string'){try{const fields:unknown=JSON.parse(key);if(Array.isArray(fields)&&fields.length===4&&typeof fields[0]==='string'&&(fields[1]==='ticket'||fields[1]==='review'||fields[1]==='intake'||fields[1]==='conversation')&&typeof fields[2]==='string'&&typeof fields[3]==='string'){const candidate:DraftScope={principal:fields[0],kind:fields[1],id:fields[2],purpose:fields[3]};if(draftScopeKey(candidate)===key)scope=candidate;}}catch{/* unknown owner is not guessed */}}}
        if(scope&&matchesDraft(filter,scope))store.delete(key);
      }}catch(error){failure=error;tx.abort();}};rows.onsuccess=loaded;keys.onsuccess=loaded;
    }
    tx.objectStore('control').put(crypto.randomUUID(),'epoch');
  });
  publish(filter);
}
