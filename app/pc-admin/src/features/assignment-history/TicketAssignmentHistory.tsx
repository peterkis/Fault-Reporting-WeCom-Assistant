import {useEffect} from 'react';
import {useInfiniteQuery,useQueryClient} from '@tanstack/react-query';
import {api,ApiError,errorMessage} from '../../api/client';
import type {Principal} from '../../api/client';
import type {P2016AssignmentHistoryName} from '../../../../../contracts/p2_016_assignment_history_contracts';
import {clearSessionAuthorization,clearTicketAuthorization} from '../../app/authorization';
const label=(name:P2016AssignmentHistoryName)=>name.state==='KNOWN'?name.name:name.state==='NONE'?'无人':'记录不足';
export function TicketAssignmentHistory({ticketId,principal}:{ticketId:string;principal:Principal}){
 const client=useQueryClient(),key=['ticket-assignment-history',principal.principal_id,ticketId,principal.authorization_revision??[...principal.roles].sort().join('|'),principal.expires_epoch_ms] as const;
 const query=useInfiniteQuery({queryKey:key,initialPageParam:null as string|null,queryFn:({signal,pageParam})=>api.assignmentHistory(ticketId,pageParam,signal),getNextPageParam:page=>page.next_cursor??undefined,maxPages:10,gcTime:0});
 useEffect(()=>{if(query.error instanceof ApiError&&[401,403,404].includes(query.error.status)){
  if(query.error.status===401)void clearSessionAuthorization(client,principal.principal_id,401,'revoked');else void clearTicketAuthorization(client,principal.principal_id,ticketId,query.error);
 }},[client,principal.principal_id,ticketId,query.error]);
 const items=query.isError?[]:query.data?.pages.flatMap(page=>page.items)??[],unknown=query.data?.pages[0]?.initial_basis==='UNKNOWN';
 const reload=async()=>{try{const fresh=await client.fetchQuery({queryKey:['session'],queryFn:({signal})=>api.bootstrap(signal),staleTime:0});if(fresh.principal_id!==principal.principal_id||!fresh.assignment_history_enabled)return;await client.resetQueries({queryKey:key,exact:true});}catch(error){if(error instanceof ApiError&&[401,403].includes(error.status))void clearSessionAuthorization(client,principal.principal_id,error.status as 401|403,'revoked');}};
 return <section className="attachment-section ticket-assignment-history" role="region" aria-label="接单与交接链">
  <h3>接单与交接链</h3>
  <p>已加载 {items.length} 条责任记录，仅为当前已读取范围；最多保留 200 条。沟通交接仅显示当前可读取的实际变化。</p>
  {query.isPending?<p role="status">正在读取接单与交接记录…</p>:query.isError?<p role="status">{errorMessage(query.error)} 请重新读取当前获权记录。</p>:<>
   {unknown?<p>初始责任记录不足，无法确认完整起点。</p>:null}
   {!items.length?<p>当前没有可读取的责任记录。</p>:<ul>{items.map(row=><li data-assignment-history-row key={row.ticket_event_id}><span>
    <strong>{row.kind==='FIRST_RESPONSIBILITY'?'首次接单':'责任变化'}</strong>
    <small>{label(row.previous.person)}（{row.previous.team.state==='NONE'?'无组':label(row.previous.team)}） → {label(row.next.person)}（{row.next.team.state==='NONE'?'无组':label(row.next.team)}）</small>
    <small>操作者 {label(row.actor)} · {row.occurred_at}（北京时间） · {row.handling_cycle.state==='KNOWN'?'处理轮次 '+row.handling_cycle.cycle_no:'轮次记录不足'}</small>
    {row.communication.length?<ul aria-label="实际沟通交接">{row.communication.map(control=><li key={control.control_event_id}><span><small>沟通交接：{label(control.previous)} → {label(control.next)}</small><small>操作者 {label(control.actor)} · {control.occurred_at}（北京时间）</small></span></li>)}</ul>:<small>当前获权范围没有可返回的沟通交接记录。</small>}
   </span></li>)}</ul>}
  </>}
  {query.hasNextPage&&!query.isError?<button type="button" disabled={query.isFetching} onClick={()=>{void query.fetchNextPage();}}>加载后续记录</button>:null}
  <button type="button" disabled={query.isFetching} onClick={()=>{void reload();}}>重新读取接单链</button>
 </section>;
}