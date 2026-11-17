// These bounded browser-local recovery copies never own Ticket facts or authority.
export interface DraftScope {principal:string;kind:'ticket'|'review'|'intake'|'conversation'|'incident-candidate'|'incident'|'web-feedback';id:string;purpose:string}
export interface DraftRecord {schema:1;scope:string;principal:string;kind:DraftScope['kind'];id:string;purpose:string;firstSavedAt:number;expiresAt:number;revision:string;iv:Uint8Array<ArrayBuffer>;ciphertext:ArrayBuffer;key:CryptoKey}
export interface OperationRecord extends DraftScope {scope:string;commandId:string;createdAt:number;prepared?:true}
export interface DraftHandle {scope:DraftScope;record:DraftRecord|null;operation:OperationRecord|null;epoch:string}
export class DraftError extends Error {}
export interface DraftInvalidation {principal:string;kind?:DraftScope['kind'];id?:string;purpose?:string;reason:'discard'|'expired'|'settled'|'released'|'revoked'|'logout'|'logout-unknown'}
const listeners=new Set<(value:DraftInvalidation)=>void>();let channel:BroadcastChannel|null=null;
function invalidation(value:unknown):DraftInvalidation|null{
  if(!value||typeof value!=='object'||Array.isArray(value))return null;const v=value as Record<string,unknown>;
  const reason=v.reason,kind=v.kind;
  if(typeof v.principal!=='string'||!(kind==='web-feedback'?/^[a-f0-9]{64}$/u.test(v.principal):UUID.test(v.principal))||(reason!=='discard'&&reason!=='expired'&&reason!=='settled'&&reason!=='released'&&reason!=='revoked'&&reason!=='logout'&&reason!=='logout-unknown')||Object.keys(v).some(key=>!['principal','kind','id','purpose','reason'].includes(key)))return null;
  if(kind!==undefined&&kind!=='ticket'&&kind!=='review'&&kind!=='intake'&&kind!=='conversation'&&kind!=='incident-candidate'&&kind!=='incident'&&kind!=='web-feedback'||v.id!==undefined&&(typeof v.id!=='string'||!(kind==='web-feedback'?/^[A-Za-z0-9_-]{32}$/u.test(v.id):UUID.test(v.id)))||v.purpose!==undefined&&(typeof v.purpose!=='string'||! /^[a-z][a-z-]{0,63}$/u.test(v.purpose)))return null;
  return {principal:v.principal,reason,...(kind!==undefined?{kind}:{}),...(typeof v.id==='string'?{id:v.id}:{}),...(typeof v.purpose==='string'?{purpose:v.purpose}:{})};
}
function publishToOtherTabs(value:DraftInvalidation){if(!channel&&!globalThis.BroadcastChannel)return;const target=channel??new BroadcastChannel('wecom-workbench-drafts-v1');target.postMessage(value);if(!channel)target.close();}
function publish(value:DraftInvalidation){for(const listener of listeners)listener(value);publishToOtherTabs(value);}
// A settled notification may make an already-open page adopt and overwrite a
// surviving peer draft. Only use it when no draft remains.
function publishReleased(scope:DraftScope,hasDraft:boolean){for(const listener of listeners)listener({...scope,reason:'released'});if(!hasDraft)publishToOtherTabs({...scope,reason:'settled'});}
export function matchesDraft(value:DraftInvalidation,scope:DraftScope){return value.principal===scope.principal&&(value.kind===undefined||value.kind===scope.kind)&&(value.id===undefined||value.id===scope.id)&&(value.purpose===undefined||value.purpose===scope.purpose);}
export function subscribeDrafts(listener:(value:DraftInvalidation)=>void):()=>void{
  if(!globalThis.BroadcastChannel)throw new DraftError('DRAFT_STORAGE_UNAVAILABLE');
  if(!channel){channel=new BroadcastChannel('wecom-workbench-drafts-v1');channel.onmessage=event=>{const value=invalidation(event.data);if(value)for(const receive of listeners)receive(value);};}
  listeners.add(listener);return()=>{listeners.delete(listener);if(!listeners.size){channel?.close();channel=null;}};
}
export const DRAFT_TTL_MS=86_400_000,DRAFT_MAX_BYTES=16_384,DRAFT_MAX_COUNT=20;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,encoder=new TextEncoder();
export function draftScopeKey(scope:DraftScope):string {
  if(!(scope.kind==='web-feedback'?/^[a-f0-9]{64}$/u.test(scope.principal)&&/^[A-Za-z0-9_-]{32}$/u.test(scope.id):UUID.test(scope.principal)&&UUID.test(scope.id))||!['ticket','review','intake','conversation','incident-candidate','incident','web-feedback'].includes(scope.kind)||! /^[a-z][a-z-]{0,63}$/u.test(scope.purpose))throw new DraftError('DRAFT_SCOPE_INVALID');
  return JSON.stringify([scope.principal,scope.kind,scope.id,scope.purpose]);
}
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new DraftError('DRAFT_CORRUPT');return value as Record<string,unknown>;}
function scopeOf(v:Record<string,unknown>):DraftScope{
  if(typeof v.principal!=='string'||typeof v.id!=='string'||typeof v.purpose!=='string'||(v.kind!=='ticket'&&v.kind!=='review'&&v.kind!=='intake'&&v.kind!=='conversation'&&v.kind!=='incident-candidate'&&v.kind!=='incident'&&v.kind!=='web-feedback'))throw new DraftError('DRAFT_CORRUPT');
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
  if(Object.keys(v).length!==(v.prepared===true?8:7)||Object.hasOwn(v,'prepared')&&v.prepared!==true||typeof v.scope!=='string'||typeof v.commandId!=='string'||!UUID.test(v.commandId)||typeof v.createdAt!=='number'||!Number.isSafeInteger(v.createdAt)||v.createdAt<0||encoder.encode(JSON.stringify(v)).byteLength>512)throw new DraftError('DRAFT_CORRUPT');
  return {scope:v.scope,...scope,commandId:v.commandId,createdAt:v.createdAt,...(v.prepared===true?{prepared:true as const}:{})};
}
interface PreparedPayload {baseRevision:string;revision:string;iv:Uint8Array<ArrayBuffer>;ciphertext:ArrayBuffer}
function preparedRecord(value:unknown,current:DraftRecord):DraftRecord|null{
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const v=value as Record<string,unknown>;
  if(Object.keys(v).length!==4||v.baseRevision!==current.revision||typeof v.revision!=='string'||!UUID.test(v.revision)
    ||!(v.iv instanceof Uint8Array)||v.iv.byteLength!==12||!(v.iv.buffer instanceof ArrayBuffer)
    ||!(v.ciphertext instanceof ArrayBuffer)||v.ciphertext.byteLength<16||v.ciphertext.byteLength>DRAFT_MAX_BYTES+16)return null;
  return {...current,revision:v.revision,iv:new Uint8Array(v.iv),ciphertext:v.ciphertext};
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
const EXPIRED_MARKER='expired:',PREPARED_MARKER='prepared:';
const MAX_EXPIRY_NOTICES=20;
// These notices contain no draft text. Retain at most one additional draft lifetime.
const expiryNoticeDeadline=(expiredAt:number)=>expiredAt+DRAFT_TTL_MS;
function preparedKey(scope:string,commandId:string){return PREPARED_MARKER+JSON.stringify([scope,commandId]);}
interface State {drafts:DraftRecord[];operations:OperationRecord[];epoch:string;expired:Set<string>;draftStore:IDBObjectStore;operationStore:IDBObjectStore;control:IDBObjectStore}
async function state<T>(run:(value:State)=>T):Promise<T>{
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(['drafts','operations','control'],'readwrite'),draftStore=tx.objectStore('drafts'),operationStore=tx.objectStore('operations'),control=tx.objectStore('control');
    const rows=draftStore.getAll(undefined,21),keys=draftStore.getAllKeys(undefined,21),operations=operationStore.getAll(undefined,21),operationKeys=operationStore.getAllKeys(undefined,21),epoch=control.get('epoch');
    const preparedKeys=control.getAllKeys(IDBKeyRange.bound(PREPARED_MARKER,PREPARED_MARKER+'\uffff'));
    const expiryCursor=control.openCursor(IDBKeyRange.bound(EXPIRED_MARKER,EXPIRED_MARKER+'\uffff'));
    const expiryNotices:{key:string;expires:number}[]=[];
    const rememberExpiry=(key:string,expires:number,write:boolean)=>{
      if(!Number.isSafeInteger(expires)||Date.now()>=expiryNoticeDeadline(expires)){control.delete(key);return;}
      const existing=expiryNotices.findIndex(item=>item.key===key);
      if(existing>=0)expiryNotices.splice(existing,1);
      expiryNotices.push({key,expires});
      if(write)control.put(expires,key);
      if(expiryNotices.length>MAX_EXPIRY_NOTICES){
        expiryNotices.sort((a,b)=>b.expires-a.expires||a.key.localeCompare(b.key));
        const removed=expiryNotices.pop();
        if(removed)control.delete(removed.key);
      }
    };
    let finished=false,result:T,failed:unknown;
    tx.oncomplete=()=>{db.close();if(failed!==undefined)reject(failed);else if(finished)resolve(result);else reject(new DraftError('DRAFT_STORAGE_UNAVAILABLE'));};
    tx.onabort=()=>{db.close();reject(failed??new DraftError('DRAFT_STORAGE_UNAVAILABLE'));};tx.onerror=()=>{};
    let remaining=7;
    const read=()=>{if(--remaining)return;try{
      const rowValues:readonly unknown[]=rows.result,operationValues:readonly unknown[]=operations.result,rawEpoch:unknown=epoch.result;
      if(typeof rawEpoch!=='string'||!UUID.test(rawEpoch)||rowValues.length>20||operationValues.length>20)throw new DraftError('DRAFT_STORAGE_UNAVAILABLE');
      const value:State={drafts:[],operations:[],epoch:rawEpoch,expired:new Set(),draftStore,operationStore,control};let cleaned=false;
      for(const item of expiryNotices)value.expired.add(item.key.slice(EXPIRED_MARKER.length));
      for(const [index,row] of rowValues.entries()){try{const record=decode(row);if(Date.now()>=record.expiresAt){draftStore.delete(record.scope);rememberExpiry(EXPIRED_MARKER+record.scope,record.expiresAt,true);value.expired.add(record.scope);cleaned=true;}else value.drafts.push(record);}catch{const key=keys.result[index];if(key!==undefined){draftStore.delete(key);cleaned=true;}}}
      const markers=new Set((preparedKeys.result as readonly IDBValidKey[]).filter((key):key is string=>typeof key==='string'));
      const activeMarkers=new Set<string>();
      for(const row of operationValues){try{
        const operation=decodeOperation(row),marker=preparedKey(operation.scope,operation.commandId);
        if(operation.prepared){
          // A previous build could expose the command to an old tab already. Treat it as claimed.
          const {prepared:_prepared,...compatible}=operation;
          operationStore.put(compatible);
          markers.delete(marker);control.delete(marker);
          value.operations.push(compatible);
          continue;
        }
        if(markers.has(marker)){
          activeMarkers.add(marker);
          // The key lives only with the draft. Do not retain a prepared ciphertext after its draft expires.
          if(!value.drafts.some(draft=>draft.scope===operation.scope))control.put(true,marker);
          value.operations.push({...operation,prepared:true});
        }
        else value.operations.push(operation);
      }catch{failed=new DraftError('DRAFT_OPERATION_CORRUPT');}}
      for(const marker of markers)if(!activeMarkers.has(marker))control.delete(marker);
      if(cleaned){value.epoch=crypto.randomUUID();control.put(value.epoch,'epoch');}
      // Commit expired sensitive cleanup, retain untrusted opaque rows, then refuse new work.
      if(failed!==undefined)return;
      result=run(value);finished=true;
    }catch(error){failed=error;tx.abort();}};
    for(const request of [rows,keys,operations,operationKeys,epoch,preparedKeys])request.onsuccess=read;
    expiryCursor.onsuccess=()=>{
      const cursor=expiryCursor.result;
      if(!cursor){read();return;}
      if(typeof cursor.key==='string')rememberExpiry(cursor.key,Number(cursor.value),false);
      cursor.continue();
    };
  });
}
function aad(record:Pick<DraftRecord,'schema'|'scope'|'firstSavedAt'|'expiresAt'|'revision'>){return encoder.encode(JSON.stringify([record.schema,record.scope,record.firstSavedAt,record.expiresAt,record.revision]));}
// A read-authorized caller can discover an old operation without enabling new
// recovery writes or creating a database when recovery is switched off.
export async function hasExistingDraft(scope:DraftScope):Promise<boolean>{
  const key=draftScopeKey(scope);
  if(!globalThis.isSecureContext||!globalThis.indexedDB)return false;
  if(!(await indexedDB.databases()).some(value=>value.name==='wecom-workbench-drafts-v1'))return false;
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('wecom-workbench-drafts-v1');
    request.onupgradeneeded=()=>{request.transaction?.abort();};
    request.onerror=()=>reject(new DraftError('DRAFT_STORAGE_UNAVAILABLE'));
    request.onblocked=()=>reject(new DraftError('DRAFT_STORAGE_UNAVAILABLE'));
    request.onsuccess=()=>{
      const db=request.result;if(!db.objectStoreNames.contains('drafts')||!db.objectStoreNames.contains('operations')){db.close();reject(new DraftError('DRAFT_STORAGE_UNAVAILABLE'));return;}
      const transaction=db.transaction(['drafts','operations'],'readonly'),draft=transaction.objectStore('drafts').getKey(key),operation=transaction.objectStore('operations').getKey(key);
      transaction.oncomplete=()=>{db.close();resolve(draft.result!==undefined||operation.result!==undefined);};
      transaction.onabort=()=>{db.close();reject(new DraftError('DRAFT_STORAGE_UNAVAILABLE'));};transaction.onerror=()=>{};
    };
  });
}
export async function openDraft(scope:DraftScope,{restore=true}:{restore?:boolean}={}):Promise<{handle:DraftHandle;text:string|null;expired:boolean}>{
  const key=draftScopeKey(scope),snapshot=await state(value=>{const expired=value.expired.has(key);if(expired)value.control.delete(EXPIRED_MARKER+key);return {record:value.drafts.find(row=>row.scope===key)??null,operation:value.operations.find(row=>row.scope===key)??null,epoch:value.epoch,expired};});
  const handle:DraftHandle={scope,record:snapshot.record,operation:snapshot.operation,epoch:snapshot.epoch};
  if(!snapshot.record||!restore)return {handle,text:null,expired:snapshot.expired};
  const record=snapshot.record;let plaintext:ArrayBuffer;
  try{plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:record.iv,additionalData:aad(record),tagLength:128},record.key,record.ciphertext);}
  catch{await removeSensitiveDraft(handle);return {handle,text:null,expired:false};}
  const valid=await state(value=>value.epoch===handle.epoch&&value.drafts.some(row=>row.scope===key&&row.revision===record.revision));
  if(!valid)throw new DraftError('DRAFT_CHANGED');
  return {handle,text:new TextDecoder('utf-8',{fatal:true}).decode(plaintext),expired:false};
}
export async function saveDraft(handle:DraftHandle,text:string,{commandId,settledCommandId,prepared=false,preparedText,releasePrepared=false,claimPrepared=false}:{commandId?:string;settledCommandId?:string;prepared?:boolean;preparedText?:string;releasePrepared?:boolean;claimPrepared?:boolean}={}):Promise<DraftRecord>{
  const bytes=encoder.encode(text);if(bytes.byteLength>DRAFT_MAX_BYTES)throw new DraftError('DRAFT_TOO_LARGE');
  const previous=handle.record?.revision,firstSavedAt=handle.record?.firstSavedAt??Date.now(),expiresAt=firstSavedAt+DRAFT_TTL_MS,epoch=handle.epoch;
  if(Date.now()>=expiresAt)throw new DraftError('DRAFT_EXPIRED');
  if(commandId!==undefined&&!UUID.test(commandId))throw new DraftError('DRAFT_SCOPE_INVALID');
  const key=handle.record?.key??await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  const metadata={schema:1 as const,scope:draftScopeKey(handle.scope),...handle.scope,firstSavedAt,expiresAt,revision:crypto.randomUUID()},iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(metadata),tagLength:128},key,bytes),record:DraftRecord={...metadata,iv,ciphertext,key};
  let payload:PreparedPayload|undefined;
  if(preparedText!==undefined){
    if(!prepared||!commandId)throw new DraftError('DRAFT_SCOPE_INVALID');
    const preparedBytes=encoder.encode(preparedText);if(preparedBytes.byteLength>DRAFT_MAX_BYTES)throw new DraftError('DRAFT_TOO_LARGE');
    const next={...metadata,revision:crypto.randomUUID()},nextIv=crypto.getRandomValues(new Uint8Array(12));
    payload={baseRevision:record.revision,revision:next.revision,iv:nextIv,ciphertext:await crypto.subtle.encrypt({name:'AES-GCM',iv:nextIv,additionalData:aad(next),tagLength:128},key,preparedBytes)};
  }
  const committed=await state(value=>{
    const current=value.drafts.find(row=>row.scope===record.scope),operation=value.operations.find(row=>row.scope===record.scope);
    if(current?.revision!==previous||Date.now()>=expiresAt)return {error:'DRAFT_CHANGED'};
    if(releasePrepared){
      // This only rewrites the exact surviving row. A revoked or newer draft is never recreated.
      if(!current||commandId||!settledCommandId||operation?.commandId!==settledCommandId||!operation.prepared)return {error:'DRAFT_CHANGED'};
    }else if(value.epoch!==epoch)return {error:'DRAFT_CHANGED'};
    if(operation&&operation.commandId!==commandId&&operation.commandId!==settledCommandId)return {error:'DRAFT_OPERATION_UNRESOLVED'};
    if(claimPrepared&&(!commandId||operation?.commandId!==commandId||!operation.prepared))return {error:'DRAFT_CHANGED'};
    if(!current&&value.drafts.length>=DRAFT_MAX_COUNT)return {error:'DRAFT_FULL'};
    if(commandId&&!operation&&value.operations.length>=DRAFT_MAX_COUNT)return {error:'DRAFT_OPERATION_FULL'};
    if(settledCommandId&&operation?.commandId===settledCommandId){value.operationStore.delete(record.scope);value.control.delete(preparedKey(record.scope,settledCommandId));}
    value.control.delete(EXPIRED_MARKER+record.scope);
    let nextOperation:OperationRecord|null=commandId?(operation?.commandId===commandId?operation:{scope:record.scope,...handle.scope,commandId,createdAt:Date.now(),...(prepared?{prepared:true as const}:{})}):null;
    if(nextOperation){
      if(prepared&&!operation)value.control.put(payload??true,preparedKey(record.scope,nextOperation.commandId));
      if(claimPrepared){
        value.control.delete(preparedKey(record.scope,nextOperation.commandId));
        const {prepared:_prepared,...claimed}=nextOperation;nextOperation=claimed;
      }
      // The public operation row remains readable by the seven-field decoder in already-open tabs.
      const {prepared:_prepared,...compatible}=nextOperation;value.operationStore.put(compatible);
    }
    value.draftStore.put(record);
    return {operation:nextOperation,started:Boolean(!operation&&commandId),settled:Boolean(settledCommandId&&operation?.commandId===settledCommandId)};
  });
  if('error' in committed)throw new DraftError(committed.error);
  handle.record=record;handle.operation=committed.operation;
  // Older pages cannot leave UNKNOWN without clearing their unsaved input. They
  // ignore the start hint and remain fenced by storage until settlement.
  if(committed.started)publishToOtherTabs({...handle.scope,reason:'released'});
  if(committed.settled)publishToOtherTabs({...handle.scope,reason:'released'});
  return record;
}
// The caller must freshly authorize its own scope. This only refreshes a still-existing
// unchanged row's in-memory fence; cleared/expired rows and newer tab writes stay fenced.
export async function rebaseDraft(handle:DraftHandle):Promise<void>{
  const key=draftScopeKey(handle.scope),record=handle.record,operation=handle.operation;
  if(!record||record.scope!==key||record.expiresAt<=Date.now())throw new DraftError('DRAFT_CHANGED');
  const epoch=await state(value=>{
    const current=value.drafts.find(row=>row.scope===key),pending=value.operations.find(row=>row.scope===key)??null;
    if(!current||current.scope!==record.scope||current.revision!==record.revision||current.firstSavedAt!==record.firstSavedAt||current.expiresAt!==record.expiresAt||current.expiresAt<=Date.now()
      ||(operation===null?pending!==null:!pending||pending.scope!==operation.scope||pending.commandId!==operation.commandId||pending.createdAt!==operation.createdAt||pending.prepared!==operation.prepared))throw new DraftError('DRAFT_CHANGED');
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
export async function removeSensitiveDraft(handle:DraftHandle,reason:DraftInvalidation['reason']='expired',options:{requireMatchingRevision?:boolean;requireMatchingOperation?:boolean}={}):Promise<void>{
  const key=draftScopeKey(handle.scope),revision=handle.record?.revision;
  const next=await state(value=>{const current=value.drafts.find(row=>row.scope===key);
    // A revision-scoped caller must not broadcast old authority loss over a newer tab's row.
    // Existing expiry/discard callers retain their original default policy.
    if(options.requireMatchingRevision&&(!current||current.revision!==revision))throw new DraftError('DRAFT_CHANGED');
    const operation=value.operations.find(row=>row.scope===key)??null;
    if(options.requireMatchingOperation&&(operation?.commandId??null)!==(handle.operation?.commandId??null))throw new DraftError('DRAFT_CHANGED');
    if(current&&current.revision===revision){value.draftStore.delete(key);if(operation?.prepared)value.control.put(true,preparedKey(key,operation.commandId));value.epoch=crypto.randomUUID();value.control.put(value.epoch,'epoch');}return {epoch:value.epoch,operation};});
  handle.record=null;handle.epoch=next.epoch;handle.operation=next.operation;
  publish({...handle.scope,reason});
}
// A delayed purpose-specific failure must not broadcast loss of access to the whole item.
export async function removeOwnedSensitiveDraft(handle:DraftHandle|null|undefined):Promise<void>{
  if(handle?.record)await removeSensitiveDraft({...handle},'discard',{requireMatchingRevision:true,requireMatchingOperation:true});
}
export async function settleDraft(handle:DraftHandle,commandId:string,revision?:string):Promise<void>{
  const key=draftScopeKey(handle.scope);
  const next=await state(value=>{
    const current=value.drafts.find(row=>row.scope===key),operation=value.operations.find(row=>row.scope===key);
    const removed=operation?.commandId===commandId&&(!current||current.revision===revision);
    if(removed){value.operationStore.delete(key);value.control.delete(preparedKey(key,commandId));if(current)value.draftStore.delete(key);value.epoch=crypto.randomUUID();value.control.put(value.epoch,'epoch');}
    return {epoch:value.epoch,record:removed?null:current??null,operation:removed?null:operation??null,removed};
  });
  handle.record=next.record;handle.operation=next.operation;handle.epoch=next.epoch;
  if(next.removed)publish({...handle.scope,reason:'settled'});
}
// Before a restored reply can be sent, it gives up the original page's right to cancel its preparation.
export async function claimDraftReplay(scope:DraftScope,commandId:string,handle?:DraftHandle):Promise<boolean>{
  const key=draftScopeKey(scope);
  const result=await state(value=>{
    const operation=value.operations.find(row=>row.scope===key)??null,current=value.drafts.find(row=>row.scope===key)??null;
    const next:{ok:boolean;record:DraftRecord|null;operation:OperationRecord|null;epoch:string}={ok:operation?.commandId===commandId,record:current,operation,epoch:value.epoch};
    if(!next.ok||!operation?.prepared)return next;
    const marker=preparedKey(key,commandId),request=value.control.get(marker);
    request.onsuccess=()=>{
      const staged=current?preparedRecord(request.result,current):null;
      if(request.result!==true&&!staged){next.ok=false;return;}
      if(staged){value.draftStore.put(staged);next.record=staged;}
      const {prepared:_prepared,...claimed}=operation;next.operation=claimed;
      value.control.delete(marker);
    };
    return next;
  });
  if(result.ok&&handle&&draftScopeKey(handle.scope)===key){handle.record=result.record;handle.operation=result.operation;handle.epoch=result.epoch;}
  return result.ok;
}

// Only the original preparation calls this, before it dispatches. A replay can claim the same number in another tab.
export async function releaseUnsentOperation(handle:DraftHandle,commandId:string,text:string):Promise<void>{
  const {scope}=handle,key=draftScopeKey(scope);
  if(handle.record&&handle.operation?.commandId===commandId&&handle.operation.prepared){
    try{
      await saveDraft(handle,text,{settledCommandId:commandId,releasePrepared:true});
      publishReleased(scope,true);
      return;
    }catch(error){
      if(!(error instanceof DraftError)||!['DRAFT_CHANGED','DRAFT_EXPIRED'].includes(error.message))throw error;
    }
  }
  // The draft may have been cleared during preparation. Do not recreate it or change other scopes' save generation.
  const removed=await state(value=>{
    const operation=value.operations.find(row=>row.scope===key);
    if(value.drafts.some(row=>row.scope===key)||operation?.commandId!==commandId||!operation.prepared)return false;
    value.operationStore.delete(key);
    value.control.delete(preparedKey(key,commandId));
    return true;
  });
  if(removed)publishReleased(scope,false);
}
export async function purgeDrafts(filter:DraftInvalidation,{preserveOperations=false}:{preserveOperations?:boolean}={}):Promise<void>{
  if(!invalidation(filter))throw new DraftError('DRAFT_SCOPE_INVALID');
  // A disabled application must not create a draft database just to clear it.
  if(!globalThis.indexedDB?.databases)throw new DraftError('DRAFT_STORAGE_UNAVAILABLE');
  if(!(await indexedDB.databases()).some(db=>db.name==='wecom-workbench-drafts-v1'))return;
  const db=await database();
  await new Promise<void>((resolve,reject)=>{
    let tx:IDBTransaction;try{tx=db.transaction(['drafts','operations','control'],'readwrite');}catch(error){db.close();reject(error);return;}
    let failure:unknown;tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(failure??new DraftError('DRAFT_STORAGE_UNAVAILABLE'));};tx.onerror=()=>{};
    for(const name of preserveOperations?['drafts']:['drafts','operations']){
      const store=tx.objectStore(name),rows=store.getAll(undefined,21),keys=store.getAllKeys(undefined,21);let remaining=2;
      const loaded=()=>{if(--remaining)return;try{if(rows.result.length>20)throw new DraftError('DRAFT_STORAGE_UNAVAILABLE');for(const [index,row] of (rows.result as unknown[]).entries()){
        // Explicit authorized purge can clear malformed metadata without treating it as a failed command.
        const key=keys.result[index];if(key===undefined)continue;let scope:DraftScope|null=null;
        try{scope=scopeOf(object(row));}catch{if(typeof key==='string'){try{const fields:unknown=JSON.parse(key);if(Array.isArray(fields)&&fields.length===4&&typeof fields[0]==='string'&&(fields[1]==='ticket'||fields[1]==='review'||fields[1]==='intake'||fields[1]==='conversation'||fields[1]==='incident'||fields[1]==='web-feedback')&&typeof fields[2]==='string'&&typeof fields[3]==='string'){const candidate:DraftScope={principal:fields[0],kind:fields[1],id:fields[2],purpose:fields[3]};if(draftScopeKey(candidate)===key)scope=candidate;}}catch{/* unknown owner is not guessed */}}}
        if(scope&&matchesDraft(filter,scope))store.delete(key);
      }}catch(error){failure=error;tx.abort();}};rows.onsuccess=loaded;keys.onsuccess=loaded;
    }
    const control=tx.objectStore('control'),controlKeys=control.getAllKeys();
    // Expiry markers name their scope; a purge removes the ones it covers, so no scope key outlives its drafts.
    controlKeys.onsuccess=()=>{for(const key of controlKeys.result as readonly unknown[]){if(typeof key!=='string'||!key.startsWith(EXPIRED_MARKER)&&!key.startsWith(PREPARED_MARKER))continue;
      try{const suffix=key.startsWith(EXPIRED_MARKER)?key.slice(EXPIRED_MARKER.length):JSON.parse(key.slice(PREPARED_MARKER.length))[0];const fields:unknown=JSON.parse(suffix);if(Array.isArray(fields)&&fields.length===4&&fields.every(field=>typeof field==='string')&&matchesDraft(filter,{principal:fields[0],kind:fields[1],id:fields[2],purpose:fields[3]} as DraftScope))control.delete(key);}catch{control.delete(key);}}};
    control.put(crypto.randomUUID(),'epoch');
  });
  publish(filter);
}
