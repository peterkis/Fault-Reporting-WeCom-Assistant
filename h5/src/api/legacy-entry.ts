import type {QueryClient} from '@tanstack/react-query';
import {api,ApiError,authLost} from './client';
import type {Bootstrap,H5EntryInput,H5SupplementPage,ReportsFilter} from './types';
import type {queryKeys,firstPage} from './query';
interface LegacyEntryInput {client:QueryClient;input:H5EntryInput;signal:AbortSignal;keys:typeof queryKeys;page:typeof firstPage;filter:ReportsFilter;expectedScope?:string;onBootstrap?:(bootstrap:Bootstrap)=>Promise<void>}
/** This compatibility implementation is downloaded only after explicit ENTRY_DISABLED. */
export async function readLegacyEntry({client,input,signal,keys,page,filter,expectedScope,onBootstrap}:LegacyEntryInput):Promise<Bootstrap>{
 const bootstrap=await api.bootstrap(signal);if(signal.aborted)throw signal.reason;
 if(expectedScope&&bootstrap.recovery_scope!==expectedScope){authLost.dispatchEvent(new Event('lost'));throw new ApiError(403,'MEMBER_SCOPE_CHANGED');}
 await onBootstrap?.(bootstrap);if(signal.aborted)throw signal.reason;
 const scope=bootstrap.recovery_scope;
 await client.cancelQueries({queryKey:['department',scope]});client.removeQueries({queryKey:['department',scope]});
 switch(input.view){
  case'home':{const value=await api.reports({q:'',status:'',source:''},null,signal,3);await client.cancelQueries({queryKey:keys.home(scope),exact:true});if(signal.aborted)throw signal.reason;client.setQueryData(keys.home(scope),value.items.slice(0,3));break;}
  case'reports':{const value=await api.reports(filter,null,signal);await client.cancelQueries({queryKey:keys.reports(scope,filter),exact:true});if(signal.aborted)throw signal.reason;client.setQueryData(keys.reports(scope,filter),page(value));break;}
  case'department':if(bootstrap.h5.can_view_department){const value=await api.department(null,signal);await Promise.all([client.cancelQueries({queryKey:keys.department(scope,'legacy'),exact:true}),client.cancelQueries({queryKey:keys.departmentSummary(scope,'legacy'),exact:true})]);if(signal.aborted)throw signal.reason;client.setQueryData(keys.department(scope,'legacy'),page(value));client.setQueryData(keys.departmentSummary(scope,'legacy'),{total:value.total,active_count:value.active_count,membership_revision:'legacy'});}break;
  case'request':{
   const[detail,timeline]=await Promise.all([api.detail(input.request_ref,signal),api.timeline(input.request_ref,null,signal).then(data=>({status:'READY' as const,data})).catch((error:unknown)=>{if(signal.aborted||error instanceof ApiError&&[401,403].includes(error.status))throw error;return{status:'UNAVAILABLE' as const,error};})]);if(signal.aborted)throw signal.reason;
   await Promise.all([keys.detail(scope,input.request_ref),keys.timeline(scope,input.request_ref),keys.supplements(scope,input.request_ref)].map(queryKey=>client.cancelQueries({queryKey,exact:true})));if(signal.aborted)throw signal.reason;
   client.setQueryData(keys.detail(scope,input.request_ref),detail);
   if(timeline.status==='READY')client.setQueryData(keys.timeline(scope,input.request_ref),page(timeline.data));else client.removeQueries({queryKey:keys.timeline(scope,input.request_ref),exact:true});
   client.setQueryData(keys.timelineSection(scope,input.request_ref),timeline.status);client.setQueryData(keys.supplements(scope,input.request_ref),page<H5SupplementPage>({items:detail.supplements,next_cursor:null}));break;
  }
  case'report':break;
 }
 if(signal.aborted)throw signal.reason;client.setQueryData<Bootstrap>(keys.bootstrap,bootstrap);return client.getQueryData<Bootstrap>(keys.bootstrap)??bootstrap;
}
