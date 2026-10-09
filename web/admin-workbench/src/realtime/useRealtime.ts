import {useEffect,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {api,ApiError,advanceWorkbenchAuthorizationEpoch,setWorkbenchTransportWritable} from '../api/client';
import type {Principal} from '../api/client';
import type {WorkbenchRealtimeStatus} from '../../../../contracts/workbench_realtime_contracts';
import {createWorkbenchRealtimeClient} from '../../../../src/workbench-realtime-client.mjs';
import {clearSessionAuthorization} from '../app/authorization';
import {purgeDrafts} from '../features/drafts/encrypted-drafts';
const families=new Set(['board','detail','ticket-command-context','ticket-related-conversations','manual-review','source-groups','attachments','manual-report-capabilities']);
export const isWorkbenchRealtimeQuery=(key:readonly unknown[],principal:string)=>key[1]===principal&&typeof key[0]==='string'&&families.has(key[0]);
const identity=(principal:Principal)=>JSON.stringify([principal.principal_id,principal.csrf_token,principal.authorization_revision]);
class IdentityChanged extends Error{}
export interface RealtimeView {status:WorkbenchRealtimeStatus;lastReadAt:number|null}
export function useWorkbenchRealtime(principal:Principal|undefined):RealtimeView{
  const client=useQueryClient(),[view,setView]=useState<RealtimeView>({status:'disabled',lastReadAt:null});
  const key=principal?identity(principal):'',enabled=principal?.realtime_sse_enabled??false,interval=principal?.polling_interval_ms??5000;
  useEffect(()=>{
    if(!principal)return;
    if(!enabled){setWorkbenchTransportWritable(true);setView({status:'disabled',lastReadAt:null});return;}
    let mounted=true;
    const owned=createWorkbenchRealtimeClient({capability:principal,now:Date.now,schedule:(callback,delay)=>window.setTimeout(callback,delay),cancel:handle=>window.clearTimeout(handle as number),
      connect:endpoint=>{
        const source=new EventSource(endpoint);
        return {state:()=>source.readyState,close:()=>source.close(),listen:(name,listener)=>{const fn=(event:Event)=>listener(event instanceof MessageEvent?{data:event.data,lastEventId:event.lastEventId}:{});source.addEventListener(name,fn);return()=>source.removeEventListener(name,fn);}};
      },
      report:state=>{if(mounted){if(['offline','auth-blocked'].includes(state.status))setWorkbenchTransportWritable(false);setView(state);}},authorizationDenied:error=>error instanceof IdentityChanged||error instanceof ApiError&&[401,403].includes(error.status),
      refresh:async signal=>{
        try{
          const fresh=await api.bootstrap(signal);signal.throwIfAborted();
          if(identity(fresh)!==key){
            advanceWorkbenchAuthorizationEpoch();
            await client.cancelQueries({predicate:query=>isWorkbenchRealtimeQuery(query.queryKey,principal.principal_id)},{revert:false});
            for(const query of client.getQueryCache().findAll({predicate:query=>isWorkbenchRealtimeQuery(query.queryKey,principal.principal_id)})){
              if(!query.isActive())client.removeQueries({queryKey:query.queryKey,exact:true});
              else query.setState({data:undefined,dataUpdatedAt:0,error:null,status:'pending',fetchStatus:'idle'});
            }
            client.setQueryData(['session'],fresh);
            if(fresh.principal_id!==principal.principal_id)await purgeDrafts({principal:principal.principal_id,reason:'revoked'});
            signal.throwIfAborted();throw new IdentityChanged();
          }
          client.setQueryData(['session'],fresh);
          const abort=()=>{void client.cancelQueries({predicate:query=>isWorkbenchRealtimeQuery(query.queryKey,principal.principal_id)&&query.isActive()},{revert:false});};
          signal.addEventListener('abort',abort,{once:true});
          try{await client.invalidateQueries({predicate:query=>isWorkbenchRealtimeQuery(query.queryKey,principal.principal_id)&&query.isActive(),refetchType:'active'},{cancelRefetch:false,throwOnError:false});}
          finally{signal.removeEventListener('abort',abort);}
          signal.throwIfAborted();
          const failed=client.getQueryCache().findAll({predicate:query=>isWorkbenchRealtimeQuery(query.queryKey,principal.principal_id)&&query.isActive()}).find(query=>query.state.status==='error'&&!(query.state.error instanceof ApiError&&[403,404].includes(query.state.error.status)));
          if(failed)throw failed.state.error;
          setWorkbenchTransportWritable(true);return {available:fresh.realtime_sse_available};
        }catch(error){if(!signal.aborted&&error instanceof ApiError&&[401,403].includes(error.status))await clearSessionAuthorization(client,principal.principal_id,error.status as 401|403,'revoked');throw error;}
      },
    });
    const environment=()=>owned.setEnvironment(navigator.onLine,document.visibilityState!=='hidden');
    environment();window.addEventListener('online',environment);window.addEventListener('offline',environment);document.addEventListener('visibilitychange',environment);
    const unsubscribe=client.getQueryCache().subscribe(event=>{
      if(event.type==='updated'&&event.action.type==='success'&&isWorkbenchRealtimeQuery(event.query.queryKey,principal.principal_id)&&event.query.isActive()&&mounted)setView(current=>({...current,lastReadAt:event.query.state.dataUpdatedAt}));
    });
    return()=>{mounted=false;owned.dispose();unsubscribe();window.removeEventListener('online',environment);window.removeEventListener('offline',environment);document.removeEventListener('visibilitychange',environment);};
  },[client,key,enabled,interval]);
  return view;
}
export const realtimeLabels:Record<WorkbenchRealtimeStatus,string>={disabled:'按需读取',connecting:'正在连接实时更新',live:'实时更新已连接',reconnecting:'实时连接中断，正在重连',polling:'实时暂不可用，定时重读',offline:'连接失败，显示最近已确认资料','auth-blocked':'会话需要重新核验'};
