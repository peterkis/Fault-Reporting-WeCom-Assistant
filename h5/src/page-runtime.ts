import type {QueryClient} from '@tanstack/react-query';
import {ApiError,advanceAuthGeneration,authLost,captureAuthGeneration,entryUnavailable,registerSessionRecheck} from './api/client';
import {cancelDetachedRefreshes,cancelEntryQueries,fetchEntry,legacyEntry,registerEntryConsumer,registerRequestRefresh,seedEntry} from './api/query';
import type {Bootstrap,H5EntryResponse,H5EntryInput} from './api/types';
import {initialRoute,loadPage,type PageRoute} from './routing';

export interface PageSnapshot {route:PageRoute;session:Bootstrap|null;membershipRevision:string;checking:boolean;ready:boolean;denied:boolean;legacy:boolean;error:unknown}
/** Each document owns this controller. Unverified entry data never reaches Query cache. */
export class PageRuntime {
 private snapshot:PageSnapshot={route:initialRoute(),session:null,membershipRevision:'',checking:true,ready:false,denied:false,legacy:false,error:null};
 private listeners=new Set<()=>void>();
 private controller:AbortController|null=null;
 private task:Promise<void>|null=null;
 private taskKey:string|null=null;
 private sequence=0;
 private timer:ReturnType<typeof setTimeout>|null=null;
 private cleanupRecheck:(()=>void)|null=null;
 private cleanupEntry:(()=>void)|null=null;
 private cleanupRequestRefresh:(()=>void)|null=null;
 constructor(private readonly client:QueryClient){}
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 getSnapshot=():PageSnapshot=>this.snapshot;
 private update(value:Partial<PageSnapshot>){this.snapshot={...this.snapshot,...value};for(const notify of this.listeners)notify();}
 private lost=()=>{this.sequence+=1;this.controller?.abort();advanceAuthGeneration();void this.client.cancelQueries();cancelDetachedRefreshes(this.client);this.client.clear();this.update({session:null,checking:false,ready:false,denied:true,error:null});};
 start():void{
  authLost.addEventListener('lost',this.lost);this.cleanupRecheck=registerSessionRecheck(this.refresh);this.cleanupEntry=registerEntryConsumer(this.client,this.consumeEntry);this.cleanupRequestRefresh=registerRequestRefresh(this.client,(scope,ref,afterCommit)=>this.snapshot.session?.recovery_scope===scope&&this.snapshot.route.input.view==='request'&&this.snapshot.route.input.request_ref===ref?this.navigate(this.snapshot.route,true,afterCommit):null);
  document.addEventListener('visibilitychange',this.scheduleRefresh);window.addEventListener('pageshow',this.scheduleRefresh);window.addEventListener('focus',this.scheduleRefresh);window.addEventListener('online',this.scheduleRefresh);
  void this.navigate(this.snapshot.route).catch(()=>undefined);
 }
 stop():void{this.sequence+=1;this.controller?.abort();if(this.timer!==null)clearTimeout(this.timer);this.timer=null;authLost.removeEventListener('lost',this.lost);this.cleanupRecheck?.();this.cleanupRecheck=null;this.cleanupEntry?.();this.cleanupEntry=null;this.cleanupRequestRefresh?.();this.cleanupRequestRefresh=null;document.removeEventListener('visibilitychange',this.scheduleRefresh);window.removeEventListener('pageshow',this.scheduleRefresh);window.removeEventListener('focus',this.scheduleRefresh);window.removeEventListener('online',this.scheduleRefresh);this.listeners.clear();}
 private async acceptEntry(entry:H5EntryResponse,input:H5EntryInput,current:()=>boolean):Promise<Bootstrap|null>{
  if(!current())return null;const previous=this.snapshot.session;let generation=captureAuthGeneration();
  if(previous&&(previous.recovery_scope!==entry.bootstrap.recovery_scope||this.snapshot.membershipRevision!==entry.membership_revision)){
   // Replace protected children immediately, while keeping a same-scope command provider alive.
   const cancelling=this.client.cancelQueries();advanceAuthGeneration();generation=captureAuthGeneration();
   this.update({session:entry.bootstrap,membershipRevision:entry.membership_revision,ready:false});
   authLost.dispatchEvent(new Event('scope-change'));await cancelling;if(!current())return null;this.client.clear();
  }
  await cancelEntryQueries(this.client,entry,input);
  return current()&&generation===captureAuthGeneration()?seedEntry(this.client,entry,input):null;
 }
 private consumeEntry=async(entry:H5EntryResponse,input:H5EntryInput):Promise<void>=>{
  const sequence=this.sequence,wasReady=this.snapshot.ready,generation=captureAuthGeneration(),hadTask=this.task!==null;
  const current=()=>sequence===this.sequence&&!this.snapshot.denied&&this.snapshot.session?.recovery_scope===entry.bootstrap.recovery_scope;
  const session=await this.acceptEntry(entry,input,current);if(!session||!current())throw new DOMException('Page load superseded','AbortError');this.update({session,membershipRevision:entry.membership_revision,ready:wasReady,error:null});
  if(hadTask&&generation!==captureAuthGeneration())void this.navigate(this.snapshot.route,true,true).catch(()=>undefined);
 };
 private async acceptLegacy(bootstrap:Bootstrap,current:()=>boolean):Promise<void>{
  if(!current())return;
  if(this.snapshot.session&&this.snapshot.session.recovery_scope!==bootstrap.recovery_scope){const cancelling=this.client.cancelQueries();advanceAuthGeneration();this.update({session:bootstrap,membershipRevision:'legacy',ready:false});authLost.dispatchEvent(new Event('scope-change'));await cancelling;if(current())this.client.clear();}
 }
 private scheduleRefresh=()=>{
  if(document.visibilityState!=='visible'||this.snapshot.denied)return;
  if(this.task)return;
  if(this.timer!==null)clearTimeout(this.timer);
  this.timer=setTimeout(()=>{this.timer=null;void this.refresh().catch(()=>undefined);},250);
 };
 refresh=():Promise<void>=>this.navigate(this.snapshot.route,true);
 navigate(route:PageRoute,force=false,afterCommit=false):Promise<void>{
  if(this.snapshot.denied)return Promise.reject(new ApiError(403,'MEMBER_SCOPE_CLEARED'));
  if(!afterCommit&&this.task&&this.taskKey===route.key)return this.task;
  if(!force&&this.snapshot.ready&&this.snapshot.route.key===route.key)return Promise.resolve();
  const sameRoute=this.snapshot.route.key===route.key;
  const sequence=++this.sequence;this.controller?.abort();cancelDetachedRefreshes(this.client);const controller=new AbortController();this.controller=controller;
  this.update({route,checking:true,ready:this.snapshot.ready&&sameRoute,error:null});
  const current=()=>sequence===this.sequence&&!controller.signal.aborted&&!this.snapshot.denied;
  // The network and route chunk start before either is awaited.
  const page=loadPage(route.input.view);
  const data=(async()=>{
   if(this.snapshot.legacy){const session=await legacyEntry(this.client,route.input,controller.signal,undefined,bootstrap=>this.acceptLegacy(bootstrap,current));return{session,revision:'legacy',legacy:true};}
   try{
    const entry=await fetchEntry(route.input,controller.signal);if(!current())return null;
    const session=await this.acceptEntry(entry,route.input,current);return session?{session,revision:entry.membership_revision,legacy:false}:null;
   }catch(error){if(!entryUnavailable(error))throw error;const session=await legacyEntry(this.client,route.input,controller.signal,undefined,bootstrap=>this.acceptLegacy(bootstrap,current));return{session,revision:'legacy',legacy:true};}
  })();
  const work=Promise.all([page,data]).then(([,value])=>{if(!current()||!value)throw new DOMException('Page load superseded','AbortError');this.update({session:value.session,membershipRevision:value.revision,legacy:value.legacy,checking:false,ready:true,error:null});}).catch(error=>{if(current())this.update({checking:false,error});throw error;}).finally(()=>{if(this.taskKey===route.key&&sequence===this.sequence){this.task=null;this.taskKey=null;}});
  this.taskKey=route.key;this.task=work;return work;
 }
}
