import {infiniteQueryOptions,queryOptions,type InfiniteData,type QueryClient} from '@tanstack/react-query';
import {api,ApiError,assertAuthGeneration,authLost,captureAuthGeneration,entryUnavailable} from './client';
import type {Bootstrap,ReportsFilter,ReportItem,ReportPage,RequestDetail,YxxTimeline,H5EntryInput,H5EntryResponse,H5SupplementPage,H5DepartmentPage,H5DepartmentSummary} from './types';

export const EMPTY_FILTER:ReportsFilter=Object.freeze({q:'',status:'',source:''});
export const BUSINESS_STALE_TIME=30_000;
export function reportStatus(value:string):ReportsFilter['status']{return value==='OPEN'||value==='ACTIVE'||value==='COMPLETED'?value:'';}
export function reportSource(value:string):ReportsFilter['source']{return value==='WEB'||value==='BOT'?value:'';}
export const queryKeys={
 bootstrap:['bootstrap'] as const,
 membership:(scope:string)=>['membership-revision',scope] as const,
 home:(scope:string)=>['reports',scope,'home',3] as const,
 reports:(scope:string,filter:ReportsFilter)=>['reports',scope,'list',filter,20] as const,
 detail:(scope:string,ref:string)=>['detail',scope,ref] as const,
 timeline:(scope:string,ref:string)=>['timeline',scope,ref,20] as const,
 supplements:(scope:string,ref:string)=>['supplements',scope,ref,20] as const,
 timelineSection:(scope:string,ref:string)=>['timeline-section',scope,ref] as const,
 department:(scope:string,revision:string)=>['department',scope,revision,'list',20] as const,
 departmentSummary:(scope:string,revision:string)=>['department',scope,revision,'summary'] as const
};
export function homeOptions(scope:string){return queryOptions({queryKey:queryKeys.home(scope),queryFn:async({signal}):Promise<ReportItem[]>=>{const page=await api.reports(EMPTY_FILTER,null,signal,3);return page.items.slice(0,3);},staleTime:BUSINESS_STALE_TIME});}
export function reportsOptions(scope:string,filter:ReportsFilter=EMPTY_FILTER){return infiniteQueryOptions({queryKey:queryKeys.reports(scope,filter),initialPageParam:null as string|null,queryFn:({pageParam,signal})=>api.reports(filter,pageParam,signal),getNextPageParam:page=>page.next_cursor??undefined,staleTime:BUSINESS_STALE_TIME});}
export function detailOptions(scope:string,ref:string){return queryOptions({queryKey:queryKeys.detail(scope,ref),queryFn:({signal,client})=>api.detail(ref,signal,client.getQueryData<RequestDetail>(queryKeys.detail(scope,ref))),staleTime:BUSINESS_STALE_TIME});}
export function timelineOptions(scope:string,ref:string){return infiniteQueryOptions({queryKey:queryKeys.timeline(scope,ref),initialPageParam:null as string|null,queryFn:({pageParam,signal})=>api.timeline(ref,pageParam,signal),getNextPageParam:page=>page.next_cursor??undefined,enabled:query=>query.state.data!==undefined,staleTime:BUSINESS_STALE_TIME});}
export function supplementsOptions(scope:string,ref:string){return infiniteQueryOptions({queryKey:queryKeys.supplements(scope,ref),initialPageParam:null as string|null,queryFn:({pageParam,signal})=>api.supplements(ref,pageParam,signal),getNextPageParam:page=>page.next_cursor??undefined,enabled:false,staleTime:BUSINESS_STALE_TIME});}
export function departmentOptions(scope:string,revision='legacy'){return infiniteQueryOptions({queryKey:queryKeys.department(scope,revision),initialPageParam:null as string|null,queryFn:({pageParam,signal})=>api.department(pageParam,signal),getNextPageParam:page=>page.next_cursor??undefined,staleTime:BUSINESS_STALE_TIME});}
export function departmentSummaryOptions(scope:string,revision='legacy'){return queryOptions({queryKey:queryKeys.departmentSummary(scope,revision),queryFn:async({signal}):Promise<H5DepartmentSummary>=>{
 try{const summary=await api.departmentSummary(signal);if(revision!=='legacy'&&summary.membership_revision!==revision){void api.recheckSession().catch(()=>undefined);throw new ApiError(409,'MEMBERSHIP_CHANGED');}return summary;}catch(error){if(!entryUnavailable(error))throw error;const page=await api.department(null,signal);return{total:page.total,active_count:page.active_count,membership_revision:revision};}
},staleTime:BUSINESS_STALE_TIME});}
export function firstPage<T>(page:T):InfiniteData<T,string|null>{return{pages:[page],pageParams:[null]};}
export function filterInput(filter:ReportsFilter):Extract<H5EntryInput,{view:'reports'}>{
 const status=filter.status==='OPEN'||filter.status==='ACTIVE'||filter.status==='COMPLETED'?filter.status:null;
 const source=filter.source==='WEB'||filter.source==='BOT'?filter.source:null;
 return{view:'reports',search:filter.q||null,status,source};
}
export function inputFilter(input:H5EntryInput):ReportsFilter{return input.view==='reports'?{q:input.search??'',status:input.status??'',source:input.source??''}:EMPTY_FILTER;}
/** Entry stamps never stand in for evicted, invalidated or incomplete page data. */
export function hasEntryData(client:QueryClient,input:H5EntryInput,scope:string,revision:string):boolean{
 const data=<T>(key:readonly unknown[]):T|undefined=>{const state=client.getQueryState<T>(key);return state?.status==='success'&&!state.isInvalidated?state.data:undefined;};
 const page=(key:readonly unknown[])=>{const value=data<InfiniteData<{items:unknown[]},string|null>>(key);return !!value&&Array.isArray(value.pages)&&value.pages.length>0&&Array.isArray(value.pageParams)&&value.pageParams.length===value.pages.length&&value.pageParams[0]===null&&value.pages.every(part=>part&&Array.isArray(part.items));};
 const summary=()=>data<H5DepartmentSummary>(queryKeys.departmentSummary(scope,revision))?.membership_revision===revision;
 const bootstrap=data<Bootstrap>(queryKeys.bootstrap);if(bootstrap?.recovery_scope!==scope||data<string>(queryKeys.membership(scope))!==revision)return false;
 switch(input.view){
  case'home':return Array.isArray(data(queryKeys.home(scope)))&&(!bootstrap.h5.can_view_department||summary());
  case'report':return true;
  case'reports':return page(queryKeys.reports(scope,inputFilter(input)));
  case'department':return page(queryKeys.department(scope,revision))&&summary();
  case'request':{const ref=input.request_ref,section=data<string>(queryKeys.timelineSection(scope,ref));return data<RequestDetail>(queryKeys.detail(scope,ref))?.request_ref===ref&&page(queryKeys.supplements(scope,ref))&&(section==='UNAVAILABLE'||section==='READY'&&page(queryKeys.timeline(scope,ref)));}
 }
}
/** Called only after the entry scope and selected view have been checked. */
export function seedEntry(client:QueryClient,entry:H5EntryResponse,input:H5EntryInput):Bootstrap{
 const scope=entry.bootstrap.recovery_scope;
 client.setQueryData<Bootstrap>(queryKeys.bootstrap,entry.bootstrap);
 client.setQueryData(queryKeys.membership(scope),entry.membership_revision);
 switch(entry.view){
  case'home':{
   client.setQueryData(homeOptions(scope).queryKey,entry.data.recent_reports);
   const key=queryKeys.departmentSummary(scope,entry.membership_revision);
   if(entry.data.department_summary)client.setQueryData<H5DepartmentSummary>(key,entry.data.department_summary);else client.removeQueries({queryKey:key,exact:true});break;
  }
  case'reports':client.setQueryData(reportsOptions(scope,inputFilter(input)).queryKey,firstPage<ReportPage>(entry.data.reports));break;
  case'department':
   client.setQueryData(departmentOptions(scope,entry.membership_revision).queryKey,firstPage<H5DepartmentPage>(entry.data.department));
   client.setQueryData(departmentSummaryOptions(scope,entry.membership_revision).queryKey,{total:entry.data.department.total,active_count:entry.data.department.active_count,membership_revision:entry.membership_revision});break;
  case'request':{
   const ref=entry.data.detail.request_ref;
   client.setQueryData(detailOptions(scope,ref).queryKey,entry.data.detail);
   client.setQueryData(queryKeys.timelineSection(scope,ref),entry.data.timeline.status);
   if(entry.data.timeline.status==='READY')client.setQueryData(timelineOptions(scope,ref).queryKey,firstPage<YxxTimeline>(entry.data.timeline.data));
   else client.removeQueries({queryKey:queryKeys.timeline(scope,ref),exact:true});
   client.setQueryData(supplementsOptions(scope,ref).queryKey,firstPage<H5SupplementPage>({items:entry.data.detail.supplements,next_cursor:entry.data.detail.supplements_cursor}));break;
  }
  case'report':break;
 }
 return client.getQueryData<Bootstrap>(queryKeys.bootstrap)??entry.bootstrap;
}
/** Old page/detail requests must finish cancellation before a new first page is installed. */
export async function cancelEntryQueries(client:QueryClient,entry:H5EntryResponse,input:H5EntryInput):Promise<void>{
 const scope=entry.bootstrap.recovery_scope;
 const keys:(readonly unknown[])[]=[];
 switch(entry.view){
  case'home':keys.push(queryKeys.home(scope),queryKeys.departmentSummary(scope,entry.membership_revision));break;
  case'reports':keys.push(queryKeys.reports(scope,inputFilter(input)));break;
  case'department':keys.push(queryKeys.department(scope,entry.membership_revision),queryKeys.departmentSummary(scope,entry.membership_revision));break;
  case'request':{const ref=entry.data.detail.request_ref;keys.push(queryKeys.detail(scope,ref),queryKeys.timeline(scope,ref),queryKeys.supplements(scope,ref),queryKeys.timelineSection(scope,ref));break;}
  case'report':break;
 }
 await Promise.all(keys.map(queryKey=>client.cancelQueries({queryKey,exact:true})));
}
function assertEntry(entry:H5EntryResponse,input:H5EntryInput){if(entry.view!==input.view||input.view==='request'&&(entry.view!=='request'||entry.data.detail.request_ref!==input.request_ref))throw new ApiError(502,'ENTRY_ROUTE_MISMATCH');}
export async function fetchEntry(input:H5EntryInput,signal:AbortSignal):Promise<H5EntryResponse>{const entry=await api.entry(input,signal);assertEntry(entry,input);return entry;}
/** Legacy fallback keeps old hosts usable without interpreting a request 404 as an absent entry route. */
export async function legacyEntry(client:QueryClient,input:H5EntryInput,signal:AbortSignal,expectedScope?:string,onBootstrap?:(bootstrap:Bootstrap)=>Promise<void>):Promise<Bootstrap>{
 const generation=captureAuthGeneration();assertAuthGeneration(generation,signal);
 const{readLegacyEntry}=await import('./legacy-entry');assertAuthGeneration(generation,signal);
 return readLegacyEntry({client,input,signal,keys:queryKeys,page:firstPage,filter:inputFilter(input),...(expectedScope===undefined?{}:{expectedScope}),...(onBootstrap===undefined?{}:{onBootstrap})});
}
interface RequestRefreshFlight {controller:AbortController;promise:Promise<void>}
const requestRefreshes=new WeakMap<QueryClient,Map<string,RequestRefreshFlight>>();
export function cancelDetachedRefreshes(client:QueryClient):void{for(const flight of requestRefreshes.get(client)?.values()??[])flight.controller.abort();}
type EntryConsumer=(entry:H5EntryResponse,input:H5EntryInput)=>Promise<void>;
const entryConsumers=new WeakMap<QueryClient,EntryConsumer>();
export function registerEntryConsumer(client:QueryClient,consumer:EntryConsumer):()=>void{entryConsumers.set(client,consumer);return()=>{if(entryConsumers.get(client)===consumer)entryConsumers.delete(client);};}
type RequestRefresher=(scope:string,ref:string,afterCommit:boolean)=>Promise<void>|null;
const requestRefreshers=new WeakMap<QueryClient,RequestRefresher>();
export function registerRequestRefresh(client:QueryClient,refresh:RequestRefresher):()=>void{requestRefreshers.set(client,refresh);return()=>{if(requestRefreshers.get(client)===refresh)requestRefreshers.delete(client);};}
export function refreshRequest(client:QueryClient,scope:string,ref:string,options:{afterCommit?:boolean}={}):Promise<void>{
 const afterCommit=options.afterCommit===true;
 let running=requestRefreshes.get(client);if(!running){running=new Map();requestRefreshes.set(client,running);}const prefix=scope+':'+ref+':',id=prefix+(afterCommit?'committed':'read'),existing=running.get(id);if(existing&&!afterCommit)return existing.promise;
 if(afterCommit)for(const[key,flight]of running)if(key.startsWith(prefix))flight.controller.abort();
 const delegated=requestRefreshers.get(client)?.(scope,ref,afterCommit);if(delegated)return delegated.then(()=>client.invalidateQueries({queryKey:['reports',scope],refetchType:'none'}));
 const controller=new AbortController();const lost=()=>controller.abort();authLost.addEventListener('lost',lost,{once:true});authLost.addEventListener('scope-change',lost,{once:true});
 const work=(async()=>{
  await client.cancelQueries({predicate:query=>query.queryKey[1]===scope&&query.queryKey[2]===ref});
  try{const input={view:'request',request_ref:ref} as const;const entry=await fetchEntry(input,controller.signal);if(controller.signal.aborted)throw controller.signal.reason;if(entry.bootstrap.recovery_scope!==scope){authLost.dispatchEvent(new Event('lost'));throw new ApiError(403,'MEMBER_SCOPE_CHANGED');}const current=client.getQueryData<Bootstrap>(queryKeys.bootstrap);if(current&&current.recovery_scope!==scope)throw new DOMException('Aborted','AbortError');const consumer=entryConsumers.get(client);if(consumer)await consumer(entry,input);else{await cancelEntryQueries(client,entry,input);if(controller.signal.aborted)throw controller.signal.reason;seedEntry(client,entry,input);}}
  catch(error){if(!entryUnavailable(error))throw error;await legacyEntry(client,{view:'request',request_ref:ref},controller.signal,scope);}
  await client.invalidateQueries({queryKey:['reports',scope],refetchType:'none'});
 })().finally(()=>{if(running.get(id)?.controller===controller)running.delete(id);authLost.removeEventListener('lost',lost);authLost.removeEventListener('scope-change',lost);});running.set(id,{controller,promise:work});return work;
}
/** Filter changes and explicit refresh replace history with the first page. */
export async function refreshReports(client:QueryClient,scope:string,filter:ReportsFilter):Promise<void>{
 const options=reportsOptions(scope,filter);await client.cancelQueries({queryKey:options.queryKey,exact:true});
 client.setQueryData<InfiniteData<ReportPage,string|null>>(options.queryKey,value=>value?{pages:value.pages.slice(0,1),pageParams:value.pageParams.slice(0,1)}:undefined);
 await client.invalidateQueries({queryKey:options.queryKey,exact:true});
}
