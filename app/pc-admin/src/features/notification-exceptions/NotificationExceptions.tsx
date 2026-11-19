import {ReadTableSkeleton} from '../read-states/ReadTableSkeleton';
import {BlockSkeleton} from '../../design/components/Skeleton/Skeleton';
import {ErrorState} from '../../design/components/ErrorState/ErrorState';
import {useDelayedLoading} from '../../design/hooks/useDelayedLoading';
import {copiedReadDiagnostics} from '../../app/read-state-diagnostics';
import {formatListTime} from '../../design/format-time';
import {Bell,Clock,TriangleAlert,ChevronLeft,ChevronRight,ClipboardList,MessageCircle,RefreshCw,X} from 'lucide-react';
import './notification-exceptions.css';
import {EmptyState} from '../../design/components/EmptyState/EmptyState';
import {InlineAlert} from '../../design/components/InlineAlert/InlineAlert';
import {PageHeader} from '../../design/components/PageHeader/PageHeader';
import {Toolbar} from '../../design/components/Toolbar/Toolbar';
import {WorkbenchLink as Link} from '../../app/WorkbenchLink';
import {DataTable as HTable} from '../../design/components/DataTable/DataTable';
import {Tag} from '../../design/components/Tag/Tag';
import {notificationTones} from '../../design/status-map';
import {Button as HButton} from '../../design/components/Button/Button';
import {ListBox} from "@heroui/react";
import {FilterChip} from '../../design/components/FilterChip/FilterChip';
import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';

import {api,ApiError,errorMessage,readWorkbench} from '../../api/client';
import type {Principal} from '../../api/client';
import {clearSessionAuthorization} from '../../app/authorization';
import {decodeNotificationExceptionPage,decodeNotificationExceptionItem} from '../../contracts/workbench-notification-exception-browser-contracts.mjs';
import type {NotificationExceptionItem,NotificationExceptionQuery} from '../../../../../contracts/workbench_notification_exception_contracts';
const statuses={DEAD_LETTER:'发送失败',RECONCILIATION_REQUIRED:'结果待核对',CANCELLED:'已取消 · 待核对'};
const routes={GROUP:'群聊',BOT_DIRECT:'个人单聊',YIXIAOXIU_APP:'医小修应用'};
const domains={TICKET:'工单',SESSION:'会话',INCIDENT:'公共故障'};
const sources={TICKET_NOTIFICATION:'工单通知',SESSION_MESSAGE:'会话消息',INCIDENT_LIFECYCLE:'故障进展通知',INCIDENT_PUBLIC_PROGRESS:'公开进展通知'};
function decode<T>(run:()=>T):T{try{return run();}catch{throw new ApiError(502,'INVALID_RESPONSE');}}
export function NotificationExceptions({principal}:{principal:Principal}){
 const [reloadDiagnostics,setReloadDiagnostics]=useState(()=>copiedReadDiagnostics(null));
 const detailRef=useRef<HTMLElement>(null),openerRef=useRef<Pick<HTMLElement,'focus'>|null>(null);
 const client=useQueryClient(),[domain,setDomain]=useState<NonNullable<NotificationExceptionQuery['domain']>>('ALL'),[route,setRoute]=useState<NonNullable<NotificationExceptionQuery['route']>>('ALL'),[state,setState]=useState<NonNullable<NotificationExceptionQuery['state']>>('ALL'),[cursor,setCursor]=useState<string|null>(null),[selected,setSelected]=useState<NotificationExceptionItem|null>(null),[blocked,setBlocked]=useState(false),[message,setMessage]=useState('');
 const enabled=principal.notification_exceptions_enabled===true&&!blocked,authority=principal.authorization_revision??[...principal.roles].sort().join('|'),prefix=['notification-exceptions',principal.principal_id],key=[...prefix,authority,domain,route,state,cursor];
 const page=useQuery({queryKey:key,enabled,queryFn:({signal})=>readWorkbench('/api/notification-exceptions?'+new URLSearchParams({domain,route,state,limit:'10',...(cursor?{cursor}:{})}),signal,value=>decode(()=>decodeNotificationExceptionPage(value,{domain,route,state}))),gcTime:0,retry:false});
 const detail=useQuery({queryKey:[...prefix,'item',authority,selected?.domain,selected?.parent_id,selected?.delivery_id],enabled:enabled&&selected!==null,queryFn:({signal})=>{if(!selected)throw new ApiError(400,'SELECTION_REQUIRED');return readWorkbench('/api/notification-exceptions/'+selected.domain.toLowerCase()+'/'+selected.parent_id+'/'+selected.delivery_id,signal,value=>decode(()=>decodeNotificationExceptionItem(value,selected)));},gcTime:0,retry:false});
 const clear=async(error:ApiError)=>{setBlocked(true);setSelected(null);setCursor(null);setMessage(error.status===401?'会话已失效，请重新进入。':'你已无法查看这条通知，原有内容已隐藏。');await client.cancelQueries({queryKey:prefix},{revert:false});client.removeQueries({queryKey:prefix});if(error.status===401)await clearSessionAuthorization(client,principal.principal_id,401,'revoked');};
 useEffect(()=>{const error=detail.error??page.error;if(error instanceof ApiError&&[401,403,404].includes(error.status))void clear(error);},[detail.error,page.error]);
 useEffect(()=>{setSelected(null);setCursor(null);setBlocked(false);setMessage('');return()=>{void client.cancelQueries({queryKey:prefix});client.removeQueries({queryKey:prefix});};},[principal.principal_id,authority,principal.notification_exceptions_enabled]);
 const loading=useDelayedLoading(enabled&&page.isPending);
 const detailLoading=useDelayedLoading(enabled&&selected!==null&&detail.isPending);
 const change=()=>{setCursor(null);setSelected(null);setMessage('');};
 const reload=async()=>{setSelected(null);setCursor(null);setBlocked(true);try{const fresh=await client.fetchQuery({queryKey:['session'],queryFn:({signal})=>api.bootstrap(signal),staleTime:0});if(fresh.principal_id!==principal.principal_id){await clearSessionAuthorization(client,principal.principal_id,undefined,'revoked','身份已变化，请重新进入。');return;}if(!fresh.notification_exceptions_enabled){setMessage('通知异常查询当前未启用。');return;}await client.cancelQueries({queryKey:prefix},{revert:false});client.removeQueries({queryKey:prefix});setMessage('');setBlocked(false);}catch(error){if(error instanceof ApiError&&[401,403].includes(error.status))await clearSessionAuthorization(client,principal.principal_id,error.status as 401|403,'revoked');else {setReloadDiagnostics(copiedReadDiagnostics(error,Date.now()));setMessage('本次加载未完成：'+errorMessage(error));}}};
 const clearFilters=()=>{change();setDomain('ALL');setRoute('ALL');setState('ALL');};
 const denied=[page.error,detail.error].some(error=>error instanceof ApiError&&[401,403,404].includes(error.status)),visible=enabled&&!denied;
 const items=visible&&!page.isError?page.data?.items??[]:[],item=visible&&!detail.isError?detail.data:null;
 const failed=items.filter(row=>row.side_effect_state==='NOT_ATTEMPTED').length,unconfirmed=items.length-failed,selectedIndex=items.findIndex(row=>row.delivery_id===selected?.delivery_id),filtered=domain!=='ALL'||route!=='ALL'||state!=='ALL';
 useEffect(()=>{if(selected){detailRef.current?.focus({preventScroll:true});detailRef.current?.scrollIntoView({block:'nearest'});}},[selected?.delivery_id]);
 return <section className="workspace ds-page notification-exceptions" data-notification-exceptions aria-label="通知异常"><PageHeader title="通知异常" icon={<Bell/>} description="发送失败或结果待核对的通知。查看不会触发重发。" actions={<HButton type="button" data-action="reload-exceptions" tone="ghost" isIconOnly aria-label="刷新" isDisabled={page.isFetching} onClick={()=>{void reload();}}><RefreshCw/></HButton>}/>
  <Toolbar className="note-controls"><FilterChip label="业务域" active={domain!=='ALL'} onClear={()=>{change();setDomain('ALL');}} aria-label="异常业务域" value={domain} onChange={e=>{change();setDomain(e as NonNullable<NotificationExceptionQuery['domain']>);}}><ListBox.Item id="ALL" textValue={"全部"}>全部<ListBox.ItemIndicator/></ListBox.Item><ListBox.Item id="TICKET" textValue={"工单"}>工单<ListBox.ItemIndicator/></ListBox.Item><ListBox.Item id="SESSION" textValue={"会话"}>会话<ListBox.ItemIndicator/></ListBox.Item><ListBox.Item id="INCIDENT" textValue={"公共故障"}>公共故障<ListBox.ItemIndicator/></ListBox.Item></FilterChip><FilterChip label="渠道" active={route!=='ALL'} onClear={()=>{change();setRoute('ALL');}} aria-label="异常投递路由" value={route} onChange={e=>{change();setRoute(e as NonNullable<NotificationExceptionQuery['route']>);}}><ListBox.Item id="ALL" textValue={"全部渠道"}>全部渠道<ListBox.ItemIndicator/></ListBox.Item><ListBox.Item id="GROUP" textValue={"群聊"}>群聊<ListBox.ItemIndicator/></ListBox.Item><ListBox.Item id="BOT_DIRECT" textValue={"个人单聊"}>个人单聊<ListBox.ItemIndicator/></ListBox.Item><ListBox.Item id="YIXIAOXIU_APP" textValue={"医小修应用"}>医小修应用<ListBox.ItemIndicator/></ListBox.Item></FilterChip><FilterChip label="结果" active onClear={()=>{change();setState('ALL');}} aria-label="异常投递结果" value={state} onChange={e=>{change();setState(e as NonNullable<NotificationExceptionQuery['state']>);}}><ListBox.Item id="ALL" textValue={"失败及待核对"}>失败及待核对<ListBox.ItemIndicator/></ListBox.Item><ListBox.Item id="FAILED" textValue={"确定失败"}>确定失败<ListBox.ItemIndicator/></ListBox.Item><ListBox.Item id="UNKNOWN" textValue={"结果待核对"}>结果待核对<ListBox.ItemIndicator/></ListBox.Item></FilterChip></Toolbar>
  {!principal.notification_exceptions_enabled||message==='通知异常查询当前未启用。'?<EmptyState size="page" title="通知异常页面尚未开放" description="返回工作台继续处理。" action={<Link to="/">返回工作台</Link>}/>:message||denied?message.startsWith('本次加载未完成：')?<ErrorState size="page" title="通知异常没有读出来" description="点击重试加载通知异常。" onRetry={()=>{void reload();}} diagnostics={reloadDiagnostics}/>:<EmptyState size="page" title="无法查看这条通知" description={message||'返回工作台查看其他内容。'} action={<Link to="/">返回工作台</Link>}/>:loading.visible?<ReadTableSkeleton className="work-table notification-table" rowHeaderIndex={1} label="正在加载通知异常…" columns={[{title:'结果',className:'ds-table-state'},{title:'关联来源',className:'notification-source-column'},{title:'通知类型',className:'notification-type-column'},{title:'接收人',className:'notification-recipient-column'},{title:'渠道',className:'notification-channel-column'},{title:'时间',className:'ds-table-count notification-time-column'},{title:'操作',className:'ds-table-action'}]} slow={loading.slow} onRetry={()=>{void reload();}}/>:page.isPending?null:page.isError?<ErrorState size="page" title="通知异常没有读出来" description="点击重试加载通知异常。" onRetry={()=>{if(!page.isFetching)void reload();}} diagnostics={copiedReadDiagnostics(page.error,page.errorUpdatedAt)}/>:!items.length?<EmptyState
    size="page" className="notification-empty" data-exception-empty tone="neutral"
    title="当前没有通知异常"
    {...(filtered?{variant:'filtered',summary:[domain==='ALL'?'全部业务':domains[domain],route==='ALL'?'全部渠道':routes[route],state==='ALL'?'失败及待核对':state==='FAILED'?'确定失败':'结果待核对'].join(' · '),onClear:clearFilters}:{description:cursor?'返回第一页查看其他记录。':'出现异常时，回到这里逐条核对。'})}
    action={<HButton type="button" data-action="refresh-empty-exceptions" tone="secondary" isDisabled={page.isFetching} onClick={()=>{void reload();}}><RefreshCw/>刷新</HButton>}
  />:<>
    <InlineAlert className="notification-overview" data-exception-overview tone={failed?'danger':'warning'} action={<HButton type="button" data-action="review-exceptions" tone="ghost" onClick={event=>{openerRef.current=event.currentTarget;setSelected(items[0]??null);}}>逐条核对<ChevronRight/></HButton>}>
      {failed?<><strong>本页 {failed} 条通知发送失败</strong>，对应报修人可能还不知道处理进展。{unconfirmed?<>另有 {unconfirmed} 条结果待核对。</>:null}</>:<><strong>本页 {unconfirmed} 条通知结果待核对</strong>，请先确认送达情况。</>}
    </InlineAlert>
    <div className="table-wrap"><HTable><HTable.ScrollContainer><HTable.Content aria-label="通知异常列表" className="work-table notification-table"><HTable.Header><>
      <HTable.Column className="ds-table-state">结果</HTable.Column>
      <HTable.Column isRowHeader className="notification-source-column">关联来源</HTable.Column>
      <HTable.Column className="notification-type-column">通知类型</HTable.Column>
      <HTable.Column className="notification-recipient-column">接收人</HTable.Column>
      <HTable.Column className="notification-channel-column">渠道</HTable.Column>
      <HTable.Column className="ds-table-count notification-time-column">时间</HTable.Column>
      <HTable.Column className="ds-table-action">操作</HTable.Column>
    </></HTable.Header><HTable.Body>{items.map(row=><HTable.Row key={row.delivery_id} data-exception-row data-delivery-id={row.delivery_id} data-delivery-status={row.status} data-current={selected?.delivery_id===row.delivery_id?'true':undefined} id={row.delivery_id}>
      <HTable.Cell><Tag className="notification-result" tone={notificationTones[row.status]??'neutral'}>{row.status==='DEAD_LETTER'?<TriangleAlert aria-hidden="true"/>:<Clock aria-hidden="true"/>}{statuses[row.status]}</Tag></HTable.Cell>
      <HTable.Cell className="notification-source-cell"><Link className="notification-source-link" data-source-domain={row.domain} to={row.parent_link.slice('/workbench/app'.length)}>{row.domain==='TICKET'?<ClipboardList aria-hidden="true"/>:row.domain==='SESSION'?<MessageCircle aria-hidden="true"/>:null}{row.domain==='TICKET'?row.ticket_no:row.domain==='SESSION'?'会话 · '+(row.reporter_name??'报修人').replace(/（资料未提供）$/u,''):'查看'+domains[row.domain]}</Link>{row.domain!=='SESSION'?<small className="notification-summary" title={row.domain==='TICKET'?row.ticket_title??undefined:row.safe_summary}>{row.domain==='TICKET'?row.ticket_title:row.safe_summary}</small>:null}</HTable.Cell>
      <HTable.Cell className="notification-type-cell"><span className="notification-type" title={sources[row.source_kind]}>{sources[row.source_kind]}</span></HTable.Cell>
      <HTable.Cell>{row.destination_type==='GROUP'?'群聊':'个人'}</HTable.Cell>
      <HTable.Cell>{routes[row.route_kind]}</HTable.Cell>
      <HTable.Cell className="ds-table-number notification-time"><time dateTime={(row.last_attempt?.started_at??row.created_at).replace(' ','T')+'+08:00'} title={(row.last_attempt?.started_at??row.created_at).replace('T',' ').slice(0,16)+'（北京时间）'}>{formatListTime((row.last_attempt?.started_at??row.created_at).replace('T',' '),Date.now())}</time><small>{row.attempt_count} 次尝试</small></HTable.Cell>
      <HTable.Cell className="notification-action-cell"><HButton type="button" data-action="open-exception" onClick={event=>{openerRef.current=event.currentTarget;setSelected(row);}} tone="secondary">核对</HButton></HTable.Cell>
    </HTable.Row>)}</HTable.Body></HTable.Content></HTable.ScrollContainer></HTable></div>
  </>}
  {items.length>0?<div className="ds-table-footer"><span>本页 {items.length} 条 · 时间为北京时间</span><div className="note-controls">{page.data?.has_more?<HButton type="button" data-action="next-exceptions" isDisabled={!enabled||page.isFetching||page.isError||!page.data?.has_more} onClick={()=>{setSelected(null);setCursor(page.data?.next_cursor??null);}} tone="ghost">下一页<ChevronRight/></HButton>:null}</div></div>:null}
  {selected&&visible?<section ref={detailRef} tabIndex={-1} className="attachment-section ds-table-detail notification-detail" data-exception-detail data-delivery-id={item?.delivery_id} aria-label="本路异常详情">
    <div className="notification-detail-heading"><h2>通知核对</h2><div className="note-controls"><span>{selectedIndex+1} / {items.length}</span><HButton type="button" tone="ghost" isIconOnly aria-label="上一条通知" isDisabled={selectedIndex<=0} onClick={()=>setSelected(items[selectedIndex-1]??null)}><ChevronLeft/></HButton><HButton type="button" tone="ghost" isIconOnly aria-label="下一条通知" isDisabled={selectedIndex<0||selectedIndex>=items.length-1} onClick={()=>setSelected(items[selectedIndex+1]??null)}><ChevronRight/></HButton><HButton type="button" tone="ghost" isIconOnly aria-label="关闭通知核对" onClick={()=>{setSelected(null);openerRef.current?.focus();}}><X/></HButton></div></div>
    {detailLoading.visible?<BlockSkeleton label="正在加载通知详情…" slow={detailLoading.slow} onRetry={()=>{void detail.refetch();}}/>:detail.isPending?null:detail.isError?<ErrorState title="通知详情没有读出来" onRetry={()=>{void detail.refetch();}}/>:item?<>
      <p><Tag className="notification-result" tone={notificationTones[item.status]??'neutral'}>{item.status==='DEAD_LETTER'?<TriangleAlert aria-hidden="true"/>:<Clock aria-hidden="true"/>}{statuses[item.status]}</Tag> {domains[item.domain]} · {routes[item.route_kind]}</p>
      <p className="ds-preserve-lines">{item.safe_summary}</p>
      <p>尝试 {item.attempt_count} 次 · {item.side_effect_state==='UNKNOWN'?'尚不能确认是否送达':item.side_effect_state==='NOT_ATTEMPTED'?'已确认发送失败':'已有发送结果，请结合来源核对'}</p>
      {item.last_attempt?<p>最近一次尝试：{item.last_attempt.started_at.replace('T',' ')}（北京时间）</p>:<p>暂时没有尝试记录。</p>}
      <Link to={item.parent_link.slice('/workbench/app'.length)}>打开当前来源</Link>
      <p>当前仅可查看这条通知。</p>
    </>:null}
  </section>:null}
 </section>;
}
