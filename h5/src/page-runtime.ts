import type {QueryClient} from '@tanstack/react-query';
import {ApiError,AuthFailureEvent,advanceAuthGeneration,authLost,captureAuthGeneration,entryUnavailable,registerSessionRecheck} from './api/client';
import {BUSINESS_STALE_TIME,cancelDetachedRefreshes,cancelEntryQueries,fetchEntry,hasEntryData,legacyEntry,registerEntryConsumer,registerRequestRefresh,seedEntry} from './api/query';
import type {Bootstrap,H5EntryResponse,H5EntryInput} from './api/types';
import {initialRoute,loadPage,type PageRoute} from './routing';
import {hasProtectedInput} from './lib/reload';

export interface PageSnapshot {route:PageRoute;session:Bootstrap|null;membershipRevision:string;checking:boolean;ready:boolean;denied:boolean;expired:boolean;recoveryBlocked:boolean;legacy:boolean;error:unknown}
interface EntryStamp {scope:string;revision:string;generation:number;at:number}
/** Each document owns this controller. Unverified entry data never reaches Query cache. */
export class PageRuntime {
 private snapshot:PageSnapshot={route:initialRoute(),session:null,membershipRevision:'',checking:true,ready:false,denied:false,expired:false,recoveryBlocked:false,legacy:false,error:null};
 private listeners=new Set<()=>void>();
 private controller:AbortController|null=null;
 private task:Promise<void>|null=null;
 private taskKey:string|null=null;
 private sequence=0;
 private stamps=new Map<string,EntryStamp>();
 private verificationPending=false;
 private timer:ReturnType<typeof setTimeout>|null=null;
 private cleanupRecheck:(()=>void)|null=null;
 private cleanupEntry:(()=>void)|null=null;
 private cleanupRequestRefresh:(()=>void)|null=null;
 constructor(private readonly client:QueryClient){}
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 getSnapshot=():PageSnapshot=>this.snapshot;
 private update(value:Partial<PageSnapshot>){this.snapshot={...this.snapshot,...value};for(const notify of this.listeners)notify();}
 private lost=(event:Event)=>{
  // Read before media/command listeners or protected subtree cleanup can remove these flags.
  const recoveryBlocked=this.snapshot.recoveryBlocked||hasProtectedInput(),expired=event instanceof AuthFailureEvent&&event.status===401;
  this.sequence+=1;this.controller?.abort();this.controller=null;this.task=null;this.taskKey=null;if(this.timer!==null)clearTimeout(this.timer);this.timer=null;this.stamps.clear();this.verificationPending=false;
  advanceAuthGeneration();void this.client.cancelQueries();cancelDetachedRefreshes(this.client);this.client.clear();this.update({session:null,checking:false,ready:false,denied:!expired,expired,recoveryBlocked,error:null});
 };
 /** Pure synchronous selection for React's pre-paint navigation projection. */
 canUseCached=(route:PageRoute):boolean=>{
  const session=this.snapshot.session,stamp=this.stamps.get(route.key);if(!session||!stamp||this.snapshot.denied||this.snapshot.expired||this.verificationPending)return false;
  const age=Date.now()-stamp.at;return age>=0&&age<BUSINESS_STALE_TIME&&stamp.scope===session.recovery_scope&&stamp.revision===this.snapshot.membershipRevision&&stamp.generation===captureAuthGeneration()&&hasEntryData(this.client,route.input,stamp.scope,stamp.revision);
 };
 start():void{
  authLost.addEventListener('lost',this.lost);this.cleanupRecheck=registerSessionRecheck(this.refresh);this.cleanupEntry=registerEntryConsumer(this.client,this.consumeEntry);this.cleanupRequestRefresh=registerRequestRefresh(this.client,(scope,ref,afterCommit)=>this.snapshot.session?.recovery_scope===scope&&this.snapshot.route.input.view==='request'&&this.snapshot.route.input.request_ref===ref?this.navigate(this.snapshot.route,true,afterCommit):null);
  document.addEventListener('visibilitychange',this.scheduleRefresh);window.addEventListener('pageshow',this.scheduleRefresh);window.addEventListener('focus',this.scheduleRefresh);window.addEventListener('online',this.scheduleRefresh);
  void this.navigate(this.snapshot.route).catch(()=>undefined);
 }
 stop():void{this.sequence+=1;this.controller?.abort();this.task=null;this.taskKey=null;this.stamps.clear();if(this.timer!==null)clearTimeout(this.timer);this.timer=null;authLost.removeEventListener('lost',this.lost);this.cleanupRecheck?.();this.cleanupRecheck=null;this.cleanupEntry?.();this.cleanupEntry=null;this.cleanupRequestRefresh?.();this.cleanupRequestRefresh=null;document.removeEventListener('visibilitychange',this.scheduleRefresh);window.removeEventListener('pageshow',this.scheduleRefresh);window.removeEventListener('focus',this.scheduleRefresh);window.removeEventListener('online',this.scheduleRefresh);this.listeners.clear();}
 private async acceptEntry(entry:H5EntryResponse,input:H5EntryInput,current:()=>boolean):Promise<Bootstrap|null>{
  if(!current())return null;const previous=this.snapshot.session;let generation=captureAuthGeneration();
  if(previous&&(previous.recovery_scope!==entry.bootstrap.recovery_scope||this.snapshot.membershipRevision!==entry.membership_revision)){
   // Replace protected children immediately, while keeping a same-scope command provider alive.
   this.stamps.clear();const cancelling=this.client.cancelQueries();advanceAuthGeneration();generation=captureAuthGeneration();
   this.update({session:entry.bootstrap,membershipRevision:entry.membership_revision,ready:false});
   authLost.dispatchEvent(new Event('scope-change'));await cancelling;if(!current())return null;this.client.clear();
  }
  await cancelEntryQueries(this.client,entry,input);
  return current()&&generation===captureAuthGeneration()?seedEntry(this.client,entry,input):null;
 }
 private consumeEntry=async(entry:H5EntryResponse,input:H5EntryInput):Promise<void>=>{
  const sequence=this.sequence,wasReady=this.snapshot.ready,generation=captureAuthGeneration(),hadTask=this.task!==null;
  const current=()=>sequence===this.sequence&&!this.snapshot.denied&&this.snapshot.session?.recovery_scope===entry.bootstrap.recovery_scope;
  const session=await this.acceptEntry(entry,input,current);if(!session||!current())throw new DOMException('Page load superseded','AbortError');this.update({session,membershipRevision:entry.membership_revision,ready:wasReady,expired:false,recoveryBlocked:false,error:null});
  if(hadTask&&generation!==captureAuthGeneration())void this.navigate(this.snapshot.route,true,true).catch(()=>undefined);
 };
 private async acceptLegacy(bootstrap:Bootstrap,current:()=>boolean):Promise<void>{
  if(!current())return;
  this.stamps.clear();
  if(this.snapshot.session&&this.snapshot.session.recovery_scope!==bootstrap.recovery_scope){const cancelling=this.client.cancelQueries();advanceAuthGeneration();this.update({session:bootstrap,membershipRevision:'legacy',ready:false});authLost.dispatchEvent(new Event('scope-change'));await cancelling;if(current())this.client.clear();}
 }
 private scheduleRefresh=()=>{
  if(document.visibilityState!=='visible'||this.snapshot.denied)return;
  this.verificationPending=true;if(!this.snapshot.checking)this.update({checking:true});
  if(this.task)return;
  if(this.timer!==null)clearTimeout(this.timer);
  this.timer=setTimeout(()=>{this.timer=null;void this.refresh().catch(()=>undefined);},250);
 };
 refresh=():Promise<void>=>this.navigate(this.snapshot.route,true);
 navigate(route:PageRoute,force=false,afterCommit=false):Promise<void>{
  if(this.snapshot.denied)return Promise.reject(new ApiError(403,'MEMBER_SCOPE_CLEARED'));
  if(force||afterCommit)this.verificationPending=true;
  if(!afterCommit&&this.task&&this.taskKey===route.key)return this.task;
  if(!force&&this.canUseCached(route)){
   this.sequence+=1;this.controller?.abort();this.controller=null;cancelDetachedRefreshes(this.client);this.task=null;this.taskKey=null;
   const stamp=this.stamps.get(route.key);if(stamp){this.stamps.delete(route.key);this.stamps.set(route.key,stamp);}
   this.update({route,checking:false,ready:true,expired:false,recoveryBlocked:false,error:null});return Promise.resolve();
  }
  if(this.timer!==null)clearTimeout(this.timer);this.timer=null;
  const sameRoute=this.snapshot.route.key===route.key;
  const sequence=++this.sequence;this.controller?.abort();cancelDetachedRefreshes(this.client);const controller=new AbortController();this.controller=controller;
  this.update({route,checking:true,ready:this.snapshot.ready&&sameRoute,error:null});
  const current=()=>sequence===this.sequence&&!controller.signal.aborted&&!this.snapshot.denied;
  // The network and route chunk start before either is awaited.
  const page=loadPage(route.input.view);
  const data=(async()=>{
   if(this.snapshot.legacy){const session=await legacyEntry(this.client,route.input,controller.signal,undefined,bootstrap=>this.acceptLegacy(bootstrap,current));return{session,revision:'legacy',legacy:true,at:Date.now(),generation:captureAuthGeneration()};}
   try{
    const entry=await fetchEntry(route.input,controller.signal);if(!current())return null;
    const session=await this.acceptEntry(entry,route.input,current);return session?{session,revision:entry.membership_revision,legacy:false,at:Date.now(),generation:captureAuthGeneration()}:null;
   }catch(error){if(!entryUnavailable(error))throw error;const session=await legacyEntry(this.client,route.input,controller.signal,undefined,bootstrap=>this.acceptLegacy(bootstrap,current));return{session,revision:'legacy',legacy:true,at:Date.now(),generation:captureAuthGeneration()};}
  })();
  const work=Promise.all([page,data]).then(([,value])=>{
   if(!current()||!value||value.generation!==captureAuthGeneration())throw new DOMException('Page load superseded','AbortError');this.verificationPending=false;
   if(!value.legacy){this.stamps.delete(route.key);this.stamps.set(route.key,{scope:value.session.recovery_scope,revision:value.revision,generation:value.generation,at:value.at});if(this.stamps.size>8){const oldest=this.stamps.keys().next().value;if(oldest!==undefined)this.stamps.delete(oldest);}}
   this.update({session:value.session,membershipRevision:value.revision,legacy:value.legacy,checking:false,ready:true,expired:false,recoveryBlocked:false,error:null});
  }).catch(error=>{if(current())this.update({checking:false,error});throw error;}).finally(()=>{if(this.taskKey===route.key&&sequence===this.sequence){this.task=null;this.taskKey=null;}});
  this.taskKey=route.key;this.task=work;return work;
 }
}
