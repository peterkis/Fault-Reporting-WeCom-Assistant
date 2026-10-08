import type {QueryClient} from '@tanstack/react-query';
import {ApiError,advanceWorkbenchAuthorizationEpoch} from '../api/client';
import {useUiStore} from './ui-store';
import {purgeDrafts} from '../features/drafts/encrypted-drafts';

export async function clearItemView(client:QueryClient,principal:unknown,kind:unknown,id:unknown,error:ApiError){
  const matches=(key:readonly unknown[])=>key[1]===principal&&(((key[0]==='detail'||key[0]==='attachments')&&key[2]===kind&&key[3]===id)||(kind==='ticket'&&key[0]==='ticket-command-context'&&key[2]===id));
  await client.cancelQueries({predicate:query=>matches(query.queryKey)},{revert:false});
  for(const query of client.getQueryCache().findAll({predicate:query=>matches(query.queryKey)}))query.setState({data:undefined,dataUpdatedAt:0,error,status:'error',fetchStatus:'idle'});
  for(const mutation of client.getMutationCache().findAll({predicate:mutation=>{
    const key=mutation.options.mutationKey;
    if(!key)return false;
    return key[1]===principal&&((kind==='ticket'&&key[2]===id&&['ticket-internal-note','ticket-self-handling'].includes(String(key[0])))||(key[0]==='attachment-download'&&key[2]===kind&&key[3]===id));
  }}))client.getMutationCache().remove(mutation);
  void client.invalidateQueries({queryKey:['board',principal],refetchType:'active'});
}
export function clearTicketView(client:QueryClient,principal:unknown,ticketId:unknown,error:ApiError){return clearItemView(client,principal,'ticket',ticketId,error);}
export async function clearItemAuthorization(client:QueryClient,principal:unknown,kind:unknown,id:unknown,error:ApiError){
  await clearItemView(client,principal,kind,id,error);
  if(typeof principal==='string'&&typeof id==='string'&&(kind==='ticket'||kind==='review'||kind==='intake'))await purgeDrafts({principal,kind,id,reason:'revoked'}).catch(()=>{});
}
export function clearTicketAuthorization(client:QueryClient,principal:unknown,ticketId:unknown,error:ApiError){return clearItemAuthorization(client,principal,'ticket',ticketId,error);}
export function clearSessionView(client:QueryClient,status:401|403|undefined,notice?:string){
  advanceWorkbenchAuthorizationEpoch();
  if(status)useUiStore.getState().failSession(status);else useUiStore.getState().closeSession(notice??'会话已关闭，请重新核验。');
  void client.cancelQueries();client.clear();
}
export async function clearSessionAuthorization(client:QueryClient,principal:unknown,status:401|403|undefined,reason:'revoked'|'logout'|'logout-unknown',notice?:string){
  clearSessionView(client,status,notice?(reason==='logout'?'已退出。正在清理本地恢复副本…':'退出结果尚未确认，正在清理本地恢复副本…'):undefined);
  try{if(typeof principal==='string')await purgeDrafts({principal,reason});if(notice)useUiStore.getState().closeSession(notice);}
  catch{useUiStore.getState().closeSession((notice??'会话需要重新核验。')+' 本地恢复副本清理尚未确认，请保持会话关闭。');}
}
