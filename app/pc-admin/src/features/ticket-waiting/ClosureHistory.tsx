import {useEffect} from 'react';
import {useInfiniteQuery,useQueryClient} from '@tanstack/react-query';
import type {Principal,WorkbenchCard} from '../../api/client';
import {ApiError} from '../../api/client';
import {closureApi,clearClosureRead} from '../closure/client';
import {ClosureRecord} from '../../design/components/TicketCard/TicketCard';
import {Button} from '../../design/components/Button/Button';
import {Section} from '../../design/components/Section/Section';
import {RestoreClosedItem} from './ClosureActions';
import {clearItemAuthorization,clearSessionAuthorization} from '../../app/authorization';

export function ClosureHistory({item,principal,revision}:{item:WorkbenchCard;principal:Principal;revision:string}){
 const kind=item.kind==='ticket'?'ticket':'intake',id=kind==='ticket'?item.id:item.intake_id,client=useQueryClient();
 const result=useInfiniteQuery({queryKey:['closure-history',principal.principal_id,kind,id,principal.authorization_revision,'pages',revision],initialPageParam:null as number|null,queryFn:({signal,pageParam})=>closureApi.history(kind,id,pageParam,signal),getNextPageParam:page=>page.next_before_version??undefined,retry:false,gcTime:0});
 useEffect(()=>{const error=result.error;if(!(error instanceof ApiError))return;if(error.status===401)void clearSessionAuthorization(client,principal.principal_id,401,'revoked');else if([403,404].includes(error.status))void clearClosureRead(client,principal.principal_id,kind,id,error).then(()=>clearItemAuthorization(client,principal.principal_id,item.kind,item.id,error));},[result.error,client,principal.principal_id,item.kind,item.id]);
 if(result.error&&(!result.data||result.error instanceof ApiError&&[401,403,404].includes(result.error.status)))return <Section title="关闭记录"><p role="alert">关闭记录暂不可读。</p><Button tone="ghost" onPress={()=>{void result.refetch();}}>重试</Button></Section>;
 const entries=result.data?.pages.flatMap(page=>page.items)??[];
 if(!entries.length)return result.isPending&&item.closure?.kind==='DISMISSED'?<p role="status">正在读取关闭记录…</p>:null;
 // Card 29 D2: a closed item restores only from its next-step card. An unfinished restore of an item that is no longer closed is still checked here.
 return <Section title="关闭记录" className="ds-closure-history-section"><div className="ds-closure-history" data-closure-history>{item.closure?.kind!=='DISMISSED'?<RestoreClosedItem item={item} principal={principal} inline/>:null}{entries.map(entry=><div className="ds-closure-history-entry" key={entry.id} data-closure-id={entry.id}>
  <ClosureRecord entry={{source:entry.source,reason_code:entry.reason_code,reason_label:entry.reason_label,note:entry.note,secondary_reason:entry.secondary_reason,ended_by_display_name:entry.ended_by_display_name,ended_at:entry.ended_at,duplicate_of:entry.duplicate_of,notification_state:entry.notification_state,restored_at:entry.restored_at,restored_by_display_name:entry.restored_by_display_name,restore_source:entry.restore_source}}/>
 </div>)}{result.error?<p role="alert">更早记录暂不可读。<Button tone="secondary" isDisabled={result.isFetchingNextPage} onPress={()=>{void result.fetchNextPage();}}>重试加载</Button></p>:result.hasNextPage?<Button tone="secondary" isDisabled={result.isFetchingNextPage} onPress={()=>{void result.fetchNextPage();}}>加载更早关闭记录</Button>:null}</div></Section>;
}
