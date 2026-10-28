import type {QueryClient} from '@tanstack/react-query';
import {ApiError,advanceWorkbenchAuthorizationEpoch} from '../api/client';
import {useUiStore} from './ui-store';
import {purgeDrafts} from '../features/drafts/encrypted-drafts';
import {closeDesktopSession,desktopHost} from '../desktop/host';
import {clearWorkbenchToasts} from './ToastFeedback';

let expiredDesktopCleanup:Promise<void>|undefined;

export async function clearItemView(client:QueryClient,principal:unknown,kind:unknown,id:unknown,error:ApiError){
  const matches=(key:readonly unknown[])=>key[1]===principal&&(((key[0]==='actor-avatar'||key[0]==='reporter-profile'||key[0]==='reporter-contact'||key[0]==='web-report'||key[0]==='reminder-locate'||key[0]==='detail'||key[0]==='attachments'||key[0]==='item-conversations'||key[0]==='personal-read-position'||key[0]==='personal-read-command')&&key[2]===kind&&key[3]===id)||(kind==='ticket'&&['ticket-assignment-history','ticket-round-notifications','ticket-command-context','ticket-related-conversations','ticket-unassign-targets','ticket-takeover-targets','ticket-takeover-completion-targets','ticket-takeover-completion-selection','ticket-return-to-dispatch-targets','ticket-follow-up-schedule','ticket-follow-up-ack','ticket-supplement-follow-up'].includes(String(key[0]))&&key[2]===id)||(key[0]==='manual-review'&&(key[2]===kind&&key[3]===id||kind==='review'&&key[4]===id))||(kind==='conversation'&&['conversation-view','conversation-eligible','conversation-chat','conversation-related'].includes(String(key[0]))&&key[2]===id));
  await client.cancelQueries({predicate:query=>matches(query.queryKey)},{revert:false});
  for(const query of client.getQueryCache().findAll({predicate:query=>matches(query.queryKey)})){
    if(query.queryKey[0]==='personal-read-command')client.removeQueries({queryKey:query.queryKey,exact:true});
    else query.setState({data:undefined,dataUpdatedAt:0,error,status:'error',fetchStatus:'idle'});
  }
  for(const mutation of client.getMutationCache().findAll({predicate:mutation=>{
    const key=mutation.options.mutationKey;
    if(!key)return false;
    return key[1]===principal&&((kind==='ticket'&&key[2]===id&&['ticket-internal-note','ticket-self-handling','ticket-completion','ticket-unassign','ticket-unassign-ack','ticket-takeover','ticket-takeover-ack','ticket-takeover-completion','ticket-takeover-completion-ack','ticket-return-to-dispatch','ticket-return-to-dispatch-ack'].includes(String(key[0])))||(key[0]==='attachment-download'&&key[2]===kind&&key[3]===id)||(key[0]==='manual-review-command'&&(key[2]===kind&&key[3]===id||kind==='review'&&key[4]===id)));
  }}))client.getMutationCache().remove(mutation);
  void client.invalidateQueries({queryKey:['board',principal],refetchType:'active'});
  if(kind==='conversation'){
    const aggregate=(key:readonly unknown[])=>key[1]===principal&&['conversations','item-conversations','conversation-inbox','conversation-related'].includes(String(key[0]));
    await client.cancelQueries({predicate:q=>aggregate(q.queryKey)},{revert:false});
    for(const query of client.getQueryCache().findAll({predicate:q=>aggregate(q.queryKey)}))query.setState({data:undefined,dataUpdatedAt:0,error:null,status:'pending',fetchStatus:'idle'});
    void client.invalidateQueries({predicate:q=>aggregate(q.queryKey)&&q.isActive(),refetchType:'active'});
  }
}
export async function clearSupplementView(client:QueryClient,principal:unknown,ticketId:unknown,error:ApiError){
  const matches=(key:readonly unknown[])=>(key[0]==='ticket-supplement-follow-up'||key[0]==='supplement-reply-sessions')&&key[1]===principal&&key[2]===ticketId;
  await client.cancelQueries({predicate:query=>matches(query.queryKey)},{revert:false});
  for(const query of client.getQueryCache().findAll({predicate:query=>matches(query.queryKey)}))query.setState({data:undefined,dataUpdatedAt:0,error,status:'error',fetchStatus:'idle'});
}
export async function clearSupplementAuthorization(client:QueryClient,principal:string,ticketId:string,error:ApiError){
  await clearSupplementView(client,principal,ticketId,error);
  await Promise.all(['supplement-disposition','supplement-reply'].map(purpose=>purgeDrafts({principal,kind:'ticket',id:ticketId,purpose,reason:'revoked'},{preserveOperations:true}).catch(()=>{})));
}
export function clearTicketView(client:QueryClient,principal:unknown,ticketId:unknown,error:ApiError){return clearItemView(client,principal,'ticket',ticketId,error);}
export async function clearTicketTakeoverView(client:QueryClient,principal:unknown,ticketId:unknown,error:ApiError){
  const matches=(key:readonly unknown[])=>key[0]==='ticket-takeover-targets'&&key[1]===principal&&key[2]===ticketId;
  await client.cancelQueries({predicate:query=>matches(query.queryKey)},{revert:false});
  for(const query of client.getQueryCache().findAll({predicate:query=>matches(query.queryKey)}))query.setState({data:undefined,dataUpdatedAt:0,error,status:'error',fetchStatus:'idle'});
  for(const mutation of client.getMutationCache().findAll({predicate:mutation=>{const key=mutation.options.mutationKey;return Boolean(key&&key[1]===principal&&key[2]===ticketId&&['ticket-takeover','ticket-takeover-ack'].includes(String(key[0])));}}))client.getMutationCache().remove(mutation);
}
export async function clearTicketUnassignView(client:QueryClient,principal:unknown,ticketId:unknown,error:ApiError){
  const queries=(key:readonly unknown[])=>key[0]==='ticket-unassign-targets'&&key[1]===principal&&key[2]===ticketId;
  await client.cancelQueries({predicate:query=>queries(query.queryKey)},{revert:false});
  for(const query of client.getQueryCache().findAll({predicate:query=>queries(query.queryKey)}))query.setState({data:undefined,dataUpdatedAt:0,error,status:'error',fetchStatus:'idle'});
  for(const mutation of client.getMutationCache().findAll({predicate:mutation=>{const key=mutation.options.mutationKey;return Boolean(key&&key[1]===principal&&key[2]===ticketId&&['ticket-unassign','ticket-unassign-ack'].includes(String(key[0])));}}))client.getMutationCache().remove(mutation);
}
export async function clearTicketReturnView(client:QueryClient,principal:unknown,ticketId:unknown,error:ApiError){
  const queries=(key:readonly unknown[])=>key[0]==='ticket-return-to-dispatch-targets'&&key[1]===principal&&key[2]===ticketId;
  await client.cancelQueries({predicate:query=>queries(query.queryKey)},{revert:false});
  for(const query of client.getQueryCache().findAll({predicate:query=>queries(query.queryKey)}))query.setState({data:undefined,dataUpdatedAt:0,error,status:'error',fetchStatus:'idle'});
  for(const mutation of client.getMutationCache().findAll({predicate:mutation=>{const key=mutation.options.mutationKey;return Boolean(key&&key[1]===principal&&key[2]===ticketId&&['ticket-return-to-dispatch','ticket-return-to-dispatch-ack'].includes(String(key[0])));}}))client.getMutationCache().remove(mutation);
}
export async function clearItemAuthorization(client:QueryClient,principal:unknown,kind:unknown,id:unknown,error:ApiError){
  const reviews=client.getQueryCache().findAll({predicate:query=>query.queryKey[0]==='manual-review'&&query.queryKey[1]===principal&&query.queryKey[2]===kind&&query.queryKey[3]===id}).map(query=>query.queryKey[4]);
  await clearItemView(client,principal,kind,id,error);
  if(typeof principal==='string'&&typeof id==='string'&&(kind==='ticket'||kind==='review'||kind==='intake'||kind==='conversation'))await purgeDrafts({principal,kind,id,reason:'revoked'}).catch(()=>{});
  if(typeof principal==='string')for(const reviewId of reviews)if(typeof reviewId==='string')await purgeDrafts({principal,kind:'review',id:reviewId,purpose:'manual-review',reason:'revoked'}).catch(()=>{});
}
export async function clearReviewAuthorization(client:QueryClient,principal:string,reviewId:string,item:{kind:'ticket'|'review'|'intake';id:string},error:ApiError){
  await clearItemView(client,principal,'review',reviewId,error);
  await clearItemView(client,principal,item.kind,item.id,error);
  await purgeDrafts({principal,kind:'review',id:reviewId,purpose:'manual-review',reason:'revoked'}).catch(()=>{});
}
export function clearTicketAuthorization(client:QueryClient,principal:unknown,ticketId:unknown,error:ApiError){return clearItemAuthorization(client,principal,'ticket',ticketId,error);}
export function clearSessionView(client:QueryClient,status:401|403|undefined,notice?:string){
  clearWorkbenchToasts();
  closeDesktopSession();
  advanceWorkbenchAuthorizationEpoch();
  if(status)useUiStore.getState().failSession(status);else useUiStore.getState().closeSession(notice??'会话已关闭，请重新核验。');
  void client.cancelQueries();client.clear();
}
export function clearSessionAuthorization(client:QueryClient,principal:unknown,status:401|403|undefined,reason:'revoked'|'logout'|'logout-unknown',notice?:string):Promise<void>{
  const expired=Boolean(desktopHost&&status===401&&reason==='revoked');
  if(expired&&expiredDesktopCleanup)return expiredDesktopCleanup;
  const cleanup=(async()=>{
    clearSessionView(client,status,notice?(reason==='logout'?'已退出。正在清理本地恢复副本…':'退出结果尚未确认，正在清理本地恢复副本…'):undefined);
    try{if(typeof principal==='string')await purgeDrafts({principal,reason});if(notice)useUiStore.getState().closeSession(notice);}
    catch{useUiStore.getState().closeSession((notice??'会话需要重新核验。')+' 本地恢复副本清理尚未确认，请保持会话关闭。');}
  })();
  if(expired){expiredDesktopCleanup=cleanup;void cleanup.finally(()=>{if(expiredDesktopCleanup===cleanup)expiredDesktopCleanup=undefined;});}
  return cleanup;
}
