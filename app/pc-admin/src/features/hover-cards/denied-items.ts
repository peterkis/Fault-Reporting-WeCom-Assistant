import {useSyncExternalStore} from 'react';

const MAX_DEPT_CACHE_ENTRIES=512;
const DEPT_UNAVAILABLE_COOLDOWN_MS=5*60*1000;

interface DeniedItemRecord {
  status:403|404;
  number:string|null;
}

const deniedByItemKey=new Map<string,DeniedItemRecord>();
const deniedByNumberKey=new Map<string,403|404>();
const deptUnavailableUntil=new Map<string,number>();
let activeScopeKey:string|null=null;

let revision=0;
const listeners=new Set<()=>void>();

function notify(){
  revision+=1;
  for(const listener of listeners)listener();
}

function subscribe(listener:()=>void){
  listeners.add(listener);
  return()=>{listeners.delete(listener);};
}

function getSnapshot(){
  return revision;
}

/** Subscribes a mounted component (e.g. an open HoverCard) to denied-item fence changes. */
export function useDeniedItemsRevision():number{
  return useSyncExternalStore(subscribe,getSnapshot,getSnapshot);
}

function itemKey(principalId:string,kind:string,id:string):string{
  return `${principalId}\0${kind}\0${id.toLowerCase()}`;
}

function numberKey(principalId:string,number:string):string{
  return `${principalId}\0${number}`;
}

function deptKey(principalId:string,authorizationRevision:string|number|null|undefined,displayName:string):string{
  return `${principalId}\0${authorizationRevision??''}\0${displayName}`;
}

function setBounded<K,V>(map:Map<K,V>,key:K,value:V){
  if(!map.has(key)&&map.size>=MAX_DEPT_CACHE_ENTRIES){
    const oldest=map.keys().next().value;
    if(oldest!==undefined)map.delete(oldest);
  }
  map.delete(key);
  map.set(key,value);
}

/**
 * Fences an item returning 403/404 for this principal so retained board/search caches cannot leak it.
 * Denial entries are security fences and are never capacity-evicted during an active authority scope;
 * they clear only on a fresh authorized read or on session / principal / authorization_revision change.
 */
export function markHoverItemDenied(
  principalId:string,
  kind:string,
  id:string,
  status:403|404,
  number?:string|null,
):void{
  if(!principalId||!kind||!id)return;
  const key=itemKey(principalId,kind,id);
  const existing=deniedByItemKey.get(key);
  const normalizedNumber=number?.trim()||existing?.number||null;
  let changed=false;
  if(!existing||existing.status!==status||existing.number!==normalizedNumber){
    deniedByItemKey.set(key,{status,number:normalizedNumber});
    changed=true;
  }
  if(normalizedNumber){
    const nKey=numberKey(principalId,normalizedNumber);
    if(deniedByNumberKey.get(nKey)!==status){
      deniedByNumberKey.set(nKey,status);
      changed=true;
    }
  }
  if(changed)notify();
}

/** Clears the denied-item fence once a fresh authorized server read returns the item. */
export function clearHoverItemDenied(
  principalId:string,
  kind:string,
  id:string,
  number?:string|null,
):void{
  if(!principalId||!kind||!id||(!deniedByItemKey.size&&!deniedByNumberKey.size))return;
  const key=itemKey(principalId,kind,id);
  const existing=deniedByItemKey.get(key);
  const normalizedNumber=number?.trim()||existing?.number||null;
  let changed=false;
  if(deniedByItemKey.delete(key))changed=true;
  if(normalizedNumber&&deniedByNumberKey.delete(numberKey(principalId,normalizedNumber)))changed=true;
  if(changed)notify();
}

/** Batch-clears fences for items returned by a fresh authorized board/search server read. */
export function clearHoverItemsBatch(
  principalId:string,
  items:readonly {kind:string;id:string;number?:string|null}[],
):void{
  if(!principalId||(!deniedByItemKey.size&&!deniedByNumberKey.size))return;
  let changed=false;
  for(const item of items){
    const key=itemKey(principalId,item.kind,item.id);
    const existing=deniedByItemKey.get(key);
    const normalizedNumber=item.number?.trim()||existing?.number||null;
    if(deniedByItemKey.delete(key))changed=true;
    if(normalizedNumber&&deniedByNumberKey.delete(numberKey(principalId,normalizedNumber)))changed=true;
  }
  if(changed)notify();
}

/** Returns the fenced 403/404 status if an item (by kind:id or number) is currently denied for this principal. */
export function getHoverItemDeniedStatus(
  principalId:string,
  target:{kind?:string|undefined;id?:string|undefined;number?:string|undefined},
):403|404|null{
  if(!principalId)return null;
  if(target.kind&&target.id){
    const hit=deniedByItemKey.get(itemKey(principalId,target.kind,target.id));
    if(hit)return hit.status;
  }
  if(target.number){
    const numHit=deniedByNumberKey.get(numberKey(principalId,target.number.trim()));
    if(numHit)return numHit;
  }
  return null;
}

/** Throttles repeated department lookups for 5 minutes after an unavailable response. */
export function markDepartmentUnavailable(
  principalId:string,
  authorizationRevision:string|number|null|undefined,
  displayName:string,
):void{
  if(!principalId||!displayName)return;
  setBounded(
    deptUnavailableUntil,
    deptKey(principalId,authorizationRevision,displayName),
    Date.now()+DEPT_UNAVAILABLE_COOLDOWN_MS,
  );
}

/** Checks whether a colleague's department lookup is within the 5-minute unavailability cooldown. */
export function isDepartmentUnavailable(
  principalId:string,
  authorizationRevision:string|number|null|undefined,
  displayName:string,
):boolean{
  if(!principalId||!displayName)return false;
  const key=deptKey(principalId,authorizationRevision,displayName);
  const until=deptUnavailableUntil.get(key);
  if(until===undefined)return false;
  if(until<=Date.now()){
    deptUnavailableUntil.delete(key);
    return false;
  }
  return true;
}

/** Clears all per-session hover-card denial fences and department unavailability throttles. */
export function resetHoverCardSessionState():void{
  const hadDenied=deniedByItemKey.size>0||deniedByNumberKey.size>0;
  deniedByItemKey.clear();
  deniedByNumberKey.clear();
  deptUnavailableUntil.clear();
  activeScopeKey=null;
  if(hadDenied)notify();
}

/** Synchronizes the active principal + authorization_revision scope, clearing fences when authority changes. */
export function syncHoverCardAuthorityScope(
  principalId:string,
  authorizationRevision:string|number|null|undefined,
):void{
  if(!principalId)return;
  const nextScopeKey=`${principalId}\0${authorizationRevision??''}`;
  if(activeScopeKey!==null&&activeScopeKey!==nextScopeKey){
    resetHoverCardSessionState();
  }
  activeScopeKey=nextScopeKey;
}
