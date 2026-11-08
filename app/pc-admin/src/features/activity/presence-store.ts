import {useEffect,useSyncExternalStore} from 'react';
import type {Principal} from '../../api/client';
import type {WorkbenchActivityPerson,WorkbenchActivityTarget,WorkbenchOnlineView} from '../../../../../contracts/workbench_activity_contracts';
import {isWorkbenchVisible} from '../../desktop/host';
import {readActivityBatch,readOnlineView} from './client';

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
let readTimer:ReturnType<typeof setTimeout>|null=null,readAt=0,firstTriggerAt=0,expiryTimer:ReturnType<typeof setInterval>|null=null,request:AbortController|null=null;
let reads=0,onlineReads=0,presenceQueued=false;
// Card 31: online colleagues share this store's gate and debounce; only the sidebar row subscribes.
let online:WorkbenchOnlineView|null=null,onlineAt=0,onlineWanted=0,onlineFailing=false,onlineQueued=false,onlineRequest:AbortController|null=null;
const onlineListeners=new Set<()=>void>();
export const ONLINE_STALE_MS=30000;
function putOnline(next:WorkbenchOnlineView|null){if(next===online)return;online=next;for(const listener of onlineListeners)listener();}
export const PRESENCE_RENDER_DELAY_MS=500,PRESENCE_HINT_DELAY_MS=1000,PRESENCE_HINT_MAX_WAIT_MS=2000,PRESENCE_MIN_READ_GAP_MS=1500,PRESENCE_EXPIRY_CHECK_MS=5000,PRESENCE_REFRESH_MARGIN_MS=10000,PRESENCE_MAX_TARGETS=100;

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
  request?.abort();request=null;presenceQueued=false;onlineRequest?.abort();onlineRequest=null;onlineQueued=false;onlineFailing=false;putOnline(null);
  if(readTimer!==null){clearTimeout(readTimer);readTimer=null;}
  for(const key of [...people.keys()]){people.delete(key);emit(key);}
  syncExpiry();
}
// The 5-second check runs while someone is cached or while a failed online refresh is holding the last result.
function syncExpiry(){
  const needed=people.size>0||onlineFailing;
  if(needed&&expiryTimer===null)expiryTimer=setInterval(expire,PRESENCE_EXPIRY_CHECK_MS);
  else if(!needed&&expiryTimer!==null){clearInterval(expiryTimer);expiryTimer=null;}
}
/**
 * The 5-second check runs only while someone is cached. It hides expired people and, because a colleague's steady
 * heartbeats renew the server lease without a presence hint, re-reads before the nearest cached lease would lapse.
 */
function expire(){
  // Card 31 F3 (Codex review): a failing online refresh retries here and hides its last result 30 s after the last success.
  // The 5-second check hides at the last tick before 30 s, so the stale list never outlives the limit.
  // Codex review: hiding the stale list does not end recovery; retries continue until a read succeeds, the row unmounts or presence is cleared.
  if(onlineFailing){if(!onlineWanted){onlineFailing=false;syncExpiry();}else{if(online&&Date.now()-onlineAt>ONLINE_STALE_MS-PRESENCE_EXPIRY_CHECK_MS)putOnline(null);schedule(0);}}
  const now=BigInt(Date.now());for(const [key,value] of [...people])put(key,value.filter(person=>alive(person,now)));
  let nearest:bigint|null=null;for(const value of people.values())for(const person of value){const at=BigInt(person.expires_epoch_ms);if(nearest===null||at<nearest)nearest=at;}
  if(nearest!==null&&nearest-now<BigInt(PRESENCE_REFRESH_MARGIN_MS))schedule(PRESENCE_HINT_DELAY_MS);
}
/**
 * Trailing debounce with a maximum wait: a burst of triggers is merged, a quiet `delay` reads, and a continuing
 * burst still reads at least every PRESENCE_HINT_MAX_WAIT_MS so presence never goes stale behind constant hints.
 * Consecutive reads stay PRESENCE_MIN_READ_GAP_MS apart: the server already sends at most one hint per second.
 */
function schedule(delay:number){
  if(!enabled()){clear();return;}
  if(!rendered.size&&!onlineWanted)return;
  const at=Date.now();if(readTimer===null)firstTriggerAt=at;else clearTimeout(readTimer);
  const due=Math.max(Math.min(at+delay,firstTriggerAt+Math.max(delay,PRESENCE_HINT_MAX_WAIT_MS)),readAt?readAt+PRESENCE_MIN_READ_GAP_MS:0);
  readTimer=setTimeout(()=>{readTimer=null;readAt=Date.now();void read();},Math.max(0,due-at));
}
async function read(){
  const owner=principal;if(!owner||!enabled())return;
  const targets=[...rendered.values()].slice(0,PRESENCE_MAX_TARGETS).map(entry=>entry.target);
  // Card 31 F3: the online read leaves together with the batch read, not on its own debounce.
  await Promise.all([targets.length?readPresence(owner,targets):null,onlineWanted?readOnline(owner):null]);
}
async function readPresence(owner:Principal,targets:WorkbenchActivityTarget[]){
  // Codex review: never cancel an in-flight batch (retries or hints would starve a slow but healthy one); queue one follow-up.
  if(request){presenceQueued=true;return;}
  const controller=new AbortController();request=controller;reads++;
  try{
    const result=await readActivityBatch(owner,targets,controller.signal);
    if(controller.signal.aborted||identity(principal)!==identity(owner)||!enabled())return;
    const now=BigInt(Date.now()),seen=new Set<string>();
    for(const item of result.items){const key=keyOf(item);seen.add(key);if(rendered.has(key))put(key,item.people.filter(person=>alive(person,now)));}
    for(const target of targets){const key=keyOf(target);if(!seen.has(key))put(key,EMPTY);}
  }catch{/* Silent: the next trigger retries; presence never blocks the workbench. */}
  finally{
    if(request===controller){request=null;
      if(presenceQueued&&principal&&enabled()){presenceQueued=false;const next=[...rendered.values()].slice(0,PRESENCE_MAX_TARGETS).map(entry=>entry.target);if(next.length)void readPresence(principal,next);}}
  }
}
async function readOnline(owner:Principal){
  // Codex review: never cancel an in-flight online read (a slow but healthy endpoint must be able to answer); queue one follow-up instead.
  if(onlineRequest){onlineQueued=true;return;}
  const controller=new AbortController();onlineRequest=controller;onlineReads++;
  try{
    const result=await readOnlineView(controller.signal);
    if(controller.signal.aborted||identity(principal)!==identity(owner)||!enabled())return;
    onlineAt=Date.now();onlineFailing=false;putOnline(result);syncExpiry();
  }catch{
    if(controller.signal.aborted)return;
    onlineFailing=true;if(Date.now()-onlineAt>ONLINE_STALE_MS)putOnline(null);/* A failed read keeps the last result for up to 30 s, then hides it; retries continue. */
    syncExpiry();
  }
  finally{
    if(onlineRequest===controller){onlineRequest=null;if(onlineQueued&&enabled()&&onlineWanted&&principal){onlineQueued=false;void readOnline(principal);}}
  }
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
/** Card 31: only the sidebar row subscribes; board and list cards never re-render for online changes. */
export function useOnlineColleagues():WorkbenchOnlineView|null{
  useEffect(()=>{onlineWanted++;if(!online)schedule(0);return()=>{onlineWanted--;};},[]);
  return useSyncExternalStore(callback=>{onlineListeners.add(callback);return()=>{onlineListeners.delete(callback);};},()=>online,()=>null);
}
export const presenceDiagnostics={onlineReads:()=>onlineReads,lastReadAt:()=>readAt,reads:()=>reads,expiryRunning:()=>expiryTimer!==null,size:()=>people.size,rendered:()=>rendered.size};
