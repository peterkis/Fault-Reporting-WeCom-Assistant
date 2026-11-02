import {Bell,Check,ChevronLeft,ChevronRight,RefreshCw,X} from 'lucide-react';
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
import {Link as HLink,ListBox} from "@heroui/react";
import {FilterSelect as WorkbenchSelect} from "../../design/components/FilterSelect/FilterSelect";
import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';

import {api,ApiError,errorMessage,readWorkbench} from '../../api/client';
import type {Principal} from '../../api/client';
import {clearSessionAuthorization} from '../../app/authorization';
import {decodeNotificationExceptionPage,decodeNotificationExceptionItem} from '../../contracts/workbench-notification-exception-browser-contracts.mjs';
import type {NotificationExceptionItem,NotificationExceptionQuery} from '../../../../../contracts/workbench_notification_exception_contracts';
const statuses={DEAD_LETTER:'发送失败',RECONCILIATION_REQUIRED:'结果未知，待核对',CANCELLED:'已取消，结果仍未知'};
const routes={GROUP:'群聊',BOT_DIRECT:'个人单聊',YIXIAOXIU_APP:'医小修应用'};
const domains={TICKET:'工单',SESSION:'会话',INCIDENT:'公共故障'};
const sources={TICKET_NOTIFICATION:'工单通知',SESSION_MESSAGE:'会话消息',INCIDENT_LIFECYCLE:'故障进展通知',INCIDENT_PUBLIC_PROGRESS:'公开进展通知'};
function decode<T>(run:()=>T):T{try{return run();}catch{throw new ApiError(502,'INVALID_RESPONSE');}}
export function NotificationExceptions({principal}:{principal:Principal}){
 const detailRef=useRef<HTMLElement>(null),openerRef=useRef<Pick<HTMLElement,'focus'>|null>(null);
 const client=useQueryClient(),[domain,setDomain]=useState<NonNullable<NotificationExceptionQuery['domain']>>('ALL'),[route,setRoute]=useState<NonNullable<NotificationExceptionQuery['route']>>('ALL'),[state,setState]=useState<NonNullable<NotificationExceptionQuery['state']>>('ALL'),[cursor,setCursor]=useState<string|null>(null),[selected,setSelected]=useState<NotificationExceptionItem|null>(null),[blocked,setBlocked]=useState(false),[message,setMessage]=useState('');
 const enabled=principal.notification_exceptions_enabled===true&&!blocked,authority=principal.authorization_revision??[...principal.roles].sort().join('|'),prefix=['notification-exceptions',principal.principal_id],key=[...prefix,authority,domain,route,state,cursor];
 const page=useQuery({queryKey:key,enabled,queryFn:({signal})=>readWorkbench('/api/notification-exceptions?'+new URLSearchParams({domain,route,state,limit:'10',...(cursor?{cursor}:{})}),signal,value=>decode(()=>decodeNotificationExceptionPage(value,{domain,route,state}))),gcTime:0,retry:false});
 const detail=useQuery({queryKey:[...prefix,'item',authority,selected?.domain,selected?.parent_id,selected?.delivery_id],enabled:enabled&&selected!==null,queryFn:({signal})=>{if(!selected)throw new ApiError(400,'SELECTION_REQUIRED');return readWorkbench('/api/notification-exceptions/'+selected.domain.toLowerCase()+'/'+selected.parent_id+'/'+selected.delivery_id,signal,value=>decode(()=>decodeNotificationExceptionItem(value,selected)));},gcTime:0,retry:false});
 const clear=async(error:ApiError)=>{setBlocked(true);setSelected(null);setCursor(null);setMessage(error.status===401?'会话已失效，请重新进入。':'当前对象或通知用途已不可读取，旧异常副本已停止展示。');await client.cancelQueries({queryKey:prefix},{revert:false});client.removeQueries({queryKey:prefix});if(error.status===401)await clearSessionAuthorization(client,principal.principal_id,401,'revoked');};
 useEffect(()=>{const error=detail.error??page.error;if(error instanceof ApiError&&[401,403,404].includes(error.status))void clear(error);},[detail.error,page.error]);
 useEffect(()=>{setSelected(null);setCursor(null);setBlocked(false);setMessage('');return()=>{void client.cancelQueries({queryKey:prefix});client.removeQueries({queryKey:prefix});};},[principal.principal_id,authority,principal.notification_exceptions_enabled]);
 const change=()=>{setCursor(null);setSelected(null);setMessage('');};
 const reload=async()=>{setSelected(null);setCursor(null);setBlocked(true);try{const fresh=await client.fetchQuery({queryKey:['session'],queryFn:({signal})=>api.bootstrap(signal),staleTime:0});if(fresh.principal_id!==principal.principal_id){await clearSessionAuthorization(client,principal.principal_id,undefined,'revoked','身份已变化，请重新进入。');return;}if(!fresh.notification_exceptions_enabled){setMessage('通知异常查询当前未启用。');return;}await client.cancelQueries({queryKey:prefix},{revert:false});client.removeQueries({queryKey:prefix});setMessage('');setBlocked(false);}catch(error){if(error instanceof ApiError&&[401,403].includes(error.status))await clearSessionAuthorization(client,principal.principal_id,error.status as 401|403,'revoked');else setMessage('本次读取未完成：'+errorMessage(error));}};
 const denied=[page.error,detail.error].some(error=>error instanceof ApiError&&[401,403,404].includes(error.status)),visible=enabled&&!denied;
 const items=visible&&!page.isError?page.data?.items??[]:[],item=visible&&!detail.isError?detail.data:null;
 const failed=items.filter(row=>row.side_effect_state==='NOT_ATTEMPTED').length,unconfirmed=items.length-failed,selectedIndex=items.findIndex(row=>row.delivery_id===selected?.delivery_id),filtered=domain!=='ALL'||route!=='ALL'||state!=='ALL'||cursor!==null;
 useEffect(()=>{if(selected){detailRef.current?.focus({preventScroll:true});detailRef.current?.scrollIntoView({block:'nearest'});}},[selected?.delivery_id]);
 return <section className="workspace ds-page notification-exceptions" data-notification-exceptions aria-label="通知异常"><PageHeader title="通知异常" icon={<Bell/>} description="发送失败或结果待核对的通知。查看不会触发重发。" actions={<HButton type="button" data-action="reload-exceptions" tone="ghost" isIconOnly aria-label="刷新" isDisabled={page.isFetching} onClick={()=>{void reload();}}><RefreshCw/></HButton>}/>
  <Toolbar className="note-controls"><WorkbenchSelect label={<>业务域</>} aria-label="异常业务域" value={domain} onChange={e=>{change();setDomain(e as NonNullable<NotificationExceptionQuery['domain']>);}}><ListBox.Item id="ALL" textValue={"当前可见各域"}>当前可见各域<ListBox.ItemIndicator/></ListBox.Item><ListBox.Item id="TICKET" textValue={"工单"}>工单<ListBox.ItemIndicator/></ListBox.Item><ListBox.Item id="SESSION" textValue={"会话"}>会话<ListBox.ItemIndicator/></ListBox.Item><ListBox.Item id="INCIDENT" textValue={"公共故障"}>公共故障<ListBox.ItemIndicator/></ListBox.Item></WorkbenchSelect><WorkbenchSelect label={<>渠道</>} aria-label="异常投递路由" value={route} onChange={e=>{change();setRoute(e as NonNullable<NotificationExceptionQuery['route']>);}}><ListBox.Item id="ALL" textValue={"全部渠道"}>全部渠道<ListBox.ItemIndicator/></ListBox.Item><ListBox.Item id="GROUP" textValue={"群聊"}>群聊<ListBox.ItemIndicator/></ListBox.Item><ListBox.Item id="BOT_DIRECT" textValue={"个人单聊"}>个人单聊<ListBox.ItemIndicator/></ListBox.Item><ListBox.Item id="YIXIAOXIU_APP" textValue={"医小修应用"}>医小修应用<ListBox.ItemIndicator/></ListBox.Item></WorkbenchSelect><WorkbenchSelect label={<>结果</>} aria-label="异常投递结果" value={state} onChange={e=>{change();setState(e as NonNullable<NotificationExceptionQuery['state']>);}}><ListBox.Item id="ALL" textValue={"失败及待核对"}>失败及待核对<ListBox.ItemIndicator/></ListBox.Item><ListBox.Item id="FAILED" textValue={"确定失败"}>确定失败<ListBox.ItemIndicator/></ListBox.Item><ListBox.Item id="UNKNOWN" textValue={"结果待核对"}>结果待核对<ListBox.ItemIndicator/></ListBox.Item></WorkbenchSelect></Toolbar>
  {!principal.notification_exceptions_enabled?<p role="status">通知异常查询当前未启用。</p>:message||denied?<p role="status">{message||'当前对象或通知用途已不可读取，旧异常副本已停止展示。'}</p>:page.isPending?<p role="status">正在读取当前可见异常…</p>:page.isError?<InlineAlert tone="warning" role="status">{errorMessage(page.error)}；未读取不代表没有异常。</InlineAlert>:!items.length?<EmptyState
    className="notification-empty" data-exception-empty tone="success" icon={<Check/>}
    title={filtered?'当前筛选没有通知异常':'通知都已送达'}
    description="当前可见范围内没有发送失败或待核对的通知。出现异常时会显示在这里。"
    action={<HButton type="button" data-action="refresh-empty-exceptions" tone="primary" isDisabled={page.isFetching} onClick={()=>{void reload();}}><RefreshCw/>刷新</HButton>}
  />:<>
    <InlineAlert className="notification-overview" data-exception-overview tone={failed?'danger':'warning'} action={<HButton type="button" data-action="review-exceptions" tone="primary" onClick={event=>{openerRef.current=event.currentTarget;setSelected(items[0]??null);}}>逐条核对<ChevronRight/></HButton>}>
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
      <HTable.Cell><Tag tone={notificationTones[row.status]??'neutral'}>{statuses[row.status]}</Tag></HTable.Cell>
      <HTable.Cell><Link to={row.parent_link.slice('/workbench/app'.length)}>查看{domains[row.domain]}</Link><small className="notification-summary" title={row.safe_summary}>{row.safe_summary}</small></HTable.Cell>
      <HTable.Cell>{sources[row.source_kind]}</HTable.Cell>
      <HTable.Cell>{row.destination_type==='GROUP'?'群聊':'个人'}</HTable.Cell>
      <HTable.Cell>{routes[row.route_kind]}</HTable.Cell>
      <HTable.Cell className="ds-table-number notification-time"><time dateTime={(row.last_attempt?.started_at??row.created_at)+'+08:00'} title={'北京时间 '+(row.last_attempt?.started_at??row.created_at).replace('T',' ')}>{(row.last_attempt?.started_at??row.created_at).slice(5,16).replace('T',' ')}</time><small>{row.attempt_count} 次尝试</small></HTable.Cell>
      <HTable.Cell><HButton type="button" data-action="open-exception" onClick={event=>{openerRef.current=event.currentTarget;setSelected(row);}} tone="secondary">核对</HButton></HTable.Cell>
    </HTable.Row>)}</HTable.Body></HTable.Content></HTable.ScrollContainer></HTable></div>
  </>}
  {items.length>0?<div className="ds-table-footer"><span>本页 {items.length} 条 · 时间为北京时间</span><div className="note-controls"><HButton type="button" data-action="next-exceptions" isDisabled={!enabled||page.isFetching||page.isError||!page.data?.has_more} onClick={()=>{setSelected(null);setCursor(page.data?.next_cursor??null);}} tone="ghost">下一页异常<ChevronRight/></HButton></div></div>:null}
  {selected&&visible?<section ref={detailRef} tabIndex={-1} className="attachment-section ds-table-detail notification-detail" data-exception-detail data-delivery-id={item?.delivery_id} aria-label="本路异常详情">
    <div className="notification-detail-heading"><h2>通知核对</h2><div className="note-controls"><span>{selectedIndex+1} / {items.length}</span><HButton type="button" tone="ghost" isIconOnly aria-label="上一条通知" isDisabled={selectedIndex<=0} onClick={()=>setSelected(items[selectedIndex-1]??null)}><ChevronLeft/></HButton><HButton type="button" tone="ghost" isIconOnly aria-label="下一条通知" isDisabled={selectedIndex<0||selectedIndex>=items.length-1} onClick={()=>setSelected(items[selectedIndex+1]??null)}><ChevronRight/></HButton><HButton type="button" tone="ghost" isIconOnly aria-label="关闭通知核对" onClick={()=>{setSelected(null);openerRef.current?.focus();}}><X/></HButton></div></div>
    {detail.isPending?<p>正在确认这条通知的最新情况…</p>:detail.isError?<p role="status">{errorMessage(detail.error)}</p>:item?<>
      <p><Tag tone={notificationTones[item.status]??'neutral'}>{statuses[item.status]}</Tag> {domains[item.domain]} · {routes[item.route_kind]}</p>
      <p className="ds-preserve-lines">{item.safe_summary}</p>
      <p>尝试 {item.attempt_count} 次 · {item.side_effect_state==='UNKNOWN'?'尚不能确认是否送达':item.side_effect_state==='NOT_ATTEMPTED'?'已确认发送失败':'已有发送结果，请结合来源核对'}</p>
      {item.last_attempt?<p>最近一次尝试：{item.last_attempt.started_at.replace('T',' ')}（北京时间）</p>:<p>暂时没有尝试记录。</p>}
      <Link to={item.parent_link.slice('/workbench/app'.length)}>打开当前来源</Link>
      {item.allowed_actions.length?<p>可前往来源{item.allowed_actions.map(a=>a==='RETRY'?'重试':'核对').join('、')}。<HLink href={item.domain==='TICKET'?'/workbench/lifecycle#queue=failed_delivery&selected='+item.parent_id:'/workbench'}>前往核验处置</HLink></p>:<p>当前仅可查看这条通知。</p>}
    </>:null}
  </section>:null}
 </section>;
}
