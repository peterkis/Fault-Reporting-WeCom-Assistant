import {useEffect,useSyncExternalStore} from 'react';
import type {Principal} from '../../api/client';
import type {WorkbenchActivityPerson,WorkbenchActivityTarget} from '../../../../../contracts/workbench_activity_contracts';
import {isWorkbenchVisible} from '../../desktop/host';
import {readActivityBatch} from './client';

/**
 * Card 30B presence store (ADR-0057). One Map keyed by `kind:id`; each card subscribes only to its own key,
 * so a presence change re-renders only the affected card. Reads are batched for the rendered cards and run
 * only while the workbench is visible, online, live and activity-enabled. Timers: the coalescing read timer
 * and one 5-second expiry check that runs only while the store holds someone.
 */
type People=readonly WorkbenchActivityPerson[];
const EMPTY:People=Object.freeze([]);
const people=new Map<string,People>();
const listeners=new Map<string,Set<()=>void>>();
const rendered=new Map<string,{target:WorkbenchActivityTarget;count:number}>();
let principal:Principal|null=null,live=false,environmentBound=false;
let readTimer:ReturnType<typeof setTimeout>|null=null,expiryTimer:ReturnType<typeof setInterval>|null=null,request:AbortController|null=null;
let reads=0;
export const PRESENCE_RENDER_DELAY_MS=500,PRESENCE_HINT_DELAY_MS=1000,PRESENCE_EXPIRY_CHECK_MS=5000,PRESENCE_MAX_TARGETS=100;

const keyOf=(target:WorkbenchActivityTarget)=>target.kind+':'+target.id;
const alive=(person:WorkbenchActivityPerson,now:bigint)=>BigInt(person.expires_epoch_ms)>now;
function same(a:People|undefined,b:People){
  if(!a)return b.length===0;if(a.length!==b.length)return false;
  return a.every((person,index)=>{const other=b[index];return other!==undefined&&person.display_name===other.display_name&&person.mode===other.mode&&person.field===other.field&&person.expires_epoch_ms===other.expires_epoch_ms;});
}
function emit(key:string){for(const listener of listeners.get(key)??[])listener();}
function put(key:string,next:People){
  if(same(people.get(key),next))return;
  if(next.length)people.set(key,next);else people.delete(key);
  emit(key);syncExpiry();
}
function enabled(){return Boolean(principal?.activity_enabled&&live&&typeof document!=='undefined'&&!document.hidden&&navigator.onLine&&isWorkbenchVisible());}
function clear(){
  request?.abort();request=null;
  if(readTimer!==null){clearTimeout(readTimer);readTimer=null;}
  for(const key of [...people.keys()]){people.delete(key);emit(key);}
  syncExpiry();
}
function syncExpiry(){
  if(people.size&&expiryTimer===null)expiryTimer=setInterval(expire,PRESENCE_EXPIRY_CHECK_MS);
  else if(!people.size&&expiryTimer!==null){clearInterval(expiryTimer);expiryTimer=null;}
}
function expire(){const now=BigInt(Date.now());for(const [key,value] of [...people])put(key,value.filter(person=>alive(person,now)));}
/** Coalesces: an already pending read absorbs later triggers, so hints never postpone a read indefinitely. */
function schedule(delay:number){
  if(!enabled()){clear();return;}
  if(!rendered.size||readTimer!==null)return;
  readTimer=setTimeout(()=>{readTimer=null;void read();},delay);
}
async function read(){
  const owner=principal;if(!owner||!enabled())return;
  const targets=[...rendered.values()].slice(0,PRESENCE_MAX_TARGETS).map(entry=>entry.target);if(!targets.length)return;
  request?.abort();const controller=new AbortController();request=controller;reads++;
  try{
    const result=await readActivityBatch(owner,targets,controller.signal);
    // The session object is replaced on every refresh; only a different account or revision discards the result.
    if(controller.signal.aborted||identity(principal)!==identity(owner)||!enabled())return;
    const now=BigInt(Date.now()),seen=new Set<string>();
    for(const item of result.items){const key=keyOf(item);seen.add(key);if(rendered.has(key))put(key,item.people.filter(person=>alive(person,now)));}
    for(const target of targets){const key=keyOf(target);if(!seen.has(key))put(key,EMPTY);}
  }catch{/* Silent: the next trigger retries; presence never blocks the workbench. */}
  finally{if(request===controller)request=null;}
}
function environment(){if(enabled())schedule(0);else clear();}
function bindEnvironment(){
  if(environmentBound||typeof window==='undefined')return;environmentBound=true;
  document.addEventListener('visibilitychange',environment);window.addEventListener('online',environment);window.addEventListener('offline',environment);
}
const identity=(value:Principal|null)=>value?value.principal_id+'\u0000'+value.authorization_revision+'\u0000'+String(value.activity_enabled):'';

/** Driven by the existing realtime status report: identity change, offline or a lost stream clears presence. */
export function presenceTransport(next:Principal|null,isLive:boolean){
  const changed=identity(next)!==identity(principal),wasEnabled=enabled();
  principal=next;live=isLive;bindEnvironment();
  if(changed||!enabled()){clear();}
  if(enabled()&&(changed||!wasEnabled))schedule(0);
}
/** A `workbench.activity.changed` hint: read again within one second, absorbing a burst of hints. */
export function presenceHint(){schedule(PRESENCE_HINT_DELAY_MS);}

function register(target:WorkbenchActivityTarget){
  const key=keyOf(target),entry=rendered.get(key);
  if(entry)entry.count++;else{rendered.set(key,{target,count:1});schedule(PRESENCE_RENDER_DELAY_MS);}
  return()=>{const current=rendered.get(key);if(!current)return;if(--current.count>0)return;rendered.delete(key);put(key,EMPTY);};
}
function subscribe(key:string,listener:()=>void){
  let set=listeners.get(key);if(!set){set=new Set();listeners.set(key,set);}set.add(listener);
  return()=>{set.delete(listener);if(!set.size)listeners.delete(key);};
}
/** A rendered card registers its target and subscribes to its own key only; a hidden or closed card passes `active=false`. */
export function usePresence(target:WorkbenchActivityTarget,active:boolean):People{
  const key=keyOf(target);
  useEffect(()=>active?register({kind:target.kind,id:target.id}):undefined,[active,target.kind,target.id]);
  return useSyncExternalStore(callback=>subscribe(key,callback),()=>active?people.get(key)??EMPTY:EMPTY,()=>EMPTY);
}
/** Test and evidence hooks; no production caller depends on them. */
export const presenceDiagnostics={reads:()=>reads,expiryRunning:()=>expiryTimer!==null,size:()=>people.size,rendered:()=>rendered.size};
