import type {QueryClient} from '@tanstack/react-query';
import {ApiError} from '../api/client';
import {useUiStore} from './ui-store';
import {purgeDrafts} from '../features/drafts/encrypted-drafts';

export async function clearTicketView(client:QueryClient,principal:unknown,ticketId:unknown,error:ApiError){
  const matches=(key:readonly unknown[])=>key[1]===principal&&((key[0]==='detail'&&key[2]==='ticket'&&key[3]===ticketId)||(key[0]==='ticket-command-context'&&key[2]===ticketId));
  await client.cancelQueries({predicate:query=>matches(query.queryKey)},{revert:false});
  for(const query of client.getQueryCache().findAll({predicate:query=>matches(query.queryKey)}))query.setState({data:undefined,dataUpdatedAt:0,error,status:'error',fetchStatus:'idle'});
  for(const mutation of client.getMutationCache().findAll({predicate:mutation=>mutation.options.mutationKey?.[1]===principal&&mutation.options.mutationKey?.[2]===ticketId&&['ticket-internal-note','ticket-self-handling'].includes(String(mutation.options.mutationKey?.[0]))}))client.getMutationCache().remove(mutation);
  void client.invalidateQueries({queryKey:['board',principal],refetchType:'active'});
}
export async function clearTicketAuthorization(client:QueryClient,principal:unknown,ticketId:unknown,error:ApiError){
  await clearTicketView(client,principal,ticketId,error);
  if(typeof principal==='string'&&typeof ticketId==='string')await purgeDrafts({principal,kind:'ticket',id:ticketId,reason:'revoked'}).catch(()=>{});
}
export function clearSessionView(client:QueryClient,status:401|403|undefined,notice?:string){
  if(status)useUiStore.getState().failSession(status);else useUiStore.getState().closeSession(notice??'会话已关闭，请重新核验。');
  void client.cancelQueries();client.clear();
}
export async function clearSessionAuthorization(client:QueryClient,principal:unknown,status:401|403|undefined,reason:'revoked'|'logout'|'logout-unknown',notice?:string){
  clearSessionView(client,status,notice?(reason==='logout'?'已退出。正在清理本地恢复副本…':'退出结果尚未确认，正在清理本地恢复副本…'):undefined);
  try{if(typeof principal==='string')await purgeDrafts({principal,reason});if(notice)useUiStore.getState().closeSession(notice);}
  catch{useUiStore.getState().closeSession((notice??'会话需要重新核验。')+' 本地恢复副本清理尚未确认，请保持会话关闭。');}
}
