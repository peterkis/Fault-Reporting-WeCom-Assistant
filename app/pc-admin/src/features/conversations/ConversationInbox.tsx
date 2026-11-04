import './conversations.css';
import {SegmentedControl} from '../../design/components/SegmentedControl/SegmentedControl';
import {Split} from '../../design/components/Split/Split';
import {AssociatedItem} from './ConversationAssociatedItem';
import {Avatar} from '../../design/components/Avatar/Avatar';
import {Tag} from '../../design/components/Tag/Tag';
import {StatusBadge} from '../../design/components/StatusBadge/StatusBadge';
import {DrawerMoreActions} from '../../design/components/Drawer/Drawer';
import {ConversationListItem} from '../../design/components/ConversationListItem/ConversationListItem';
import {MessageBubble} from '../../design/components/MessageBubble/MessageBubble';
import {TimelineEvent} from '../../design/components/Timeline/Timeline';
import {PageHeader} from '../../design/components/PageHeader/PageHeader';
import {Toolbar} from '../../design/components/Toolbar/Toolbar';
import {WorkbenchLink as Link} from '../../app/WorkbenchLink';
import {Button as HButton} from '../../design/components/Button/Button';
import {Form as HForm,Header,ListBox} from "@heroui/react";
import {WorkbenchSelect} from "../../app/WorkbenchSelect";
import {FilterChip} from '../../design/components/FilterChip/FilterChip';
import {SearchField} from '../../design/components/SearchField/SearchField';
import {EmptyState} from '../../design/components/EmptyState/EmptyState';
import {WorkbenchDisclosure} from "../../app/WorkbenchDisclosure";
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {useNavigate,useParams,useSearchParams} from 'react-router';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {MessageSquare,ArrowLeft,Paperclip,LockKeyhole} from 'lucide-react';
import {ApiError,errorMessage} from '../../api/client';
import type {Principal} from '../../api/client';
import {clearItemAuthorization} from '../../app/authorization';
import {ConversationControl} from './ConversationControl';
import {ConversationComposer} from './ConversationComposer';
import {ConversationReadTimeline} from './ConversationReadTimeline';
import {conversationInbox} from './inbox-client';
import type {ConversationChatEntry,ConversationChatItem} from './inbox-client';
import type {ConversationWorkspaceDelivery,ConversationMessageResult} from '../../../../../contracts/workbench_conversation_workspace_contracts';

const states=[['open','进行中'],['unassigned','待接待'],['mine','我接待的'],['failed_delivery','投递异常'],['waiting_user','等待用户'],['waiting_human','请求人工'],['ended','历史主题']] as const;
const sourceNames={all:'全部来源',group:'企微群来源',direct:'Bot 私聊来源'};
function messageChannel(source:string){
  if(['群内原始消息','群内规则回复'].includes(source))return '企微群';
  if(['Bot 私聊','Bot 私聊回复','Bot 私聊规则回复'].includes(source))return 'Bot 私聊';
  return null;
}
export function deliveryLabel(d:ConversationWorkspaceDelivery){
  if(d.side_effect_state==='UNKNOWN'||['UNKNOWN','RECONCILIATION_REQUIRED'].includes(d.status))return '结果待核实';
  if(d.status==='SENT')return '渠道已确认发送';if(d.status==='CANCELLED')return '已取消';
  if(d.status==='DEAD_LETTER')return '发送失败';if(d.status==='SENDING')return '发送中';return '排队中';
}
function TopicPicker({entry,principal,blocked,navigationTarget}:{entry:ConversationChatEntry;principal:Principal;blocked:boolean;navigationTarget:HTMLElement|null}){
  const navigate=useNavigate(),[params]=useSearchParams(),[cursor,setCursor]=useState<string|null>(null);
  const related=useQuery({queryKey:['conversation-related',principal.principal_id,entry.session.session_id,cursor],queryFn:({signal})=>conversationInbox.related(entry.session.session_id,cursor,signal),gcTime:0});
  const client=useQueryClient();
  useEffect(()=>{if(related.error instanceof ApiError){if(cursor&&related.error.code==='WORKBENCH_CURSOR_INVALID')setCursor(null);if([403,404].includes(related.error.status))void clearItemAuthorization(client,principal.principal_id,'conversation',entry.session.session_id,related.error);}},[client,cursor,entry.session.session_id,principal.principal_id,related.error]);
  const groups=new Map<string,ConversationChatEntry[]>();
  for(const value of related.data?.items??[]){const rows=groups.get(value.topic_ref)??[];rows.push(value);groups.set(value.topic_ref,rows);}
  if(![...groups.values()].some(rows=>rows.some(row=>row.session.session_id===entry.session.session_id)))groups.set(entry.topic_ref,[entry,...(groups.get(entry.topic_ref)??[])]);
  const direct=(related.data?.items??[]).find(row=>row.topic_ref===entry.topic_ref&&row.session.session_id!==entry.session.session_id&&row.current_contact_channel==='direct'&&row.session.status!=='ENDED');
  const change=(id:string)=>{if(!blocked)navigate('/conversations/'+id+'?'+params.toString());};
  return <div className="inbox-topic-picker"><WorkbenchSelect label={<>服务主题与沟通窗口</>} aria-label="服务主题与沟通窗口" value={entry.session.session_id} isDisabled={blocked||related.isPending} onChange={e=>change(e)}>{[...groups].map(([ref,rows])=><ListBox.Section key={ref} id={ref}><Header>{rows[0]?.topic??'服务主题'}</Header>{rows.map(row=><ListBox.Item key={row.session.session_id} id={row.session.session_id} textValue={String(row.topic)+"·"+String(row.current_contact_channel==='group'?'群内原始消息':'Bot 私聊')+String(row.session.status==='ENDED'?' · 历史':'')}>{row.topic}· {row.current_contact_channel==='group'?'群内原始消息':'Bot 私聊'}{row.session.status==='ENDED'?' · 历史':''}<ListBox.ItemIndicator/></ListBox.Item>)}</ListBox.Section>)}</WorkbenchSelect>{navigationTarget&&(cursor||related.data?.next_cursor||direct||related.isError)?createPortal(<div className="inbox-topic-navigation"><div className="inbox-topic-pages">{cursor?<HButton isDisabled={blocked} onClick={()=>setCursor(null)} tone="secondary">返回最新主题</HButton>:null}{related.data?.next_cursor?<HButton isDisabled={blocked||related.isFetching} onClick={()=>setCursor(related.data?.next_cursor??null)} tone="secondary">更多主题与窗口</HButton>:null}</div>
    {direct?<HButton className="inbox-new-direct" isDisabled={blocked} onClick={()=>change(direct.session.session_id)} tone="secondary">本主题有私聊补充，查看并继续接待</HButton>:null}
    {related.isError?<p role="alert">{errorMessage(related.error)}</p>:null}</div>,navigationTarget):null}
  </div>;
}
function ChatConversation({principal,id,onBlockedChange,onContactChange}:{principal:Principal;id:string;onBlockedChange:(value:boolean)=>void;onContactChange:(value:string|null)=>void}){
  const client=useQueryClient(),[pages,setPages]=useState(1),[tab,setTab]=useState<'messages'|'internal-notes'>('messages'),[receptionTarget,setReceptionTarget]=useState<HTMLDivElement|null>(null),[navigationTarget,setNavigationTarget]=useState<HTMLDivElement|null>(null);
  const [replyBlocked,setReplyBlocked]=useState(false),[noteBlocked,setNoteBlocked]=useState(false),[controlBlocked,setControlBlocked]=useState(false),[receipts,setReceipts]=useState<ConversationMessageResult[]>([]),[newMessages,setNewMessages]=useState(false);
  const scroller=useRef<HTMLDivElement|null>(null),atBottom=useRef(true),anchor=useRef<{id:string;offset:number}|null>(null),initial=useRef(true);
  const latestSequence=useRef<string|null>(null);
  const blocked=replyBlocked||noteBlocked||controlBlocked;
  useEffect(()=>{onBlockedChange(blocked);return()=>onBlockedChange(false);},[blocked,onBlockedChange]);
  const result=useQuery({queryKey:['conversation-chat',principal.principal_id,id,pages],queryFn:async({signal})=>{
    const [entry,first]=await Promise.all([conversationInbox.detail(id,signal),conversationInbox.items(id,signal)]);
    const all=[...first.items];let before=first.before_sequence,hasMore=first.has_more;
    for(let page=1;page<pages&&hasMore&&before;page++){const next=await conversationInbox.items(id,signal,before);all.push(...next.items);before=next.before_sequence;hasMore=next.has_more;}
    const items=[...new Map(all.map(item=>[item.item_id,item])).values()].sort((a,b)=>BigInt(a.sequence_no)<BigInt(b.sequence_no)?-1:1).slice(-400);
    const ids=[...new Set(items.flatMap(item=>item.communication_message_id?[item.communication_message_id]:[]))],deliveries:ConversationWorkspaceDelivery[]=[];let deliveryLimited=false;
    for(let offset=0;offset<ids.length;offset+=50){let cursor:string|null=null;for(let page=0;page<4;page++){const delivery=await conversationInbox.deliveries(id,ids.slice(offset,offset+50),cursor,signal);deliveries.push(...delivery.items);cursor=delivery.next_cursor;if(!cursor)break;if(page===3)deliveryLimited=true;}}
    return {entry,items,hasMore,deliveries,deliveryLimited};
  },gcTime:0,placeholderData:previous=>previous});
  useEffect(()=>{onContactChange(result.data?.entry.contact_ref??null);return()=>onContactChange(null);},[onContactChange,result.data?.entry.contact_ref]);
  useEffect(()=>{if(result.error instanceof ApiError&&[403,404].includes(result.error.status))void clearItemAuthorization(client,principal.principal_id,'conversation',id,result.error);},[client,id,principal.principal_id,result.error]);
  const signature=result.data?.items.map(item=>item.item_id+':'+item.text).join('|')??'';
  useLayoutEffect(()=>{
    const node=scroller.current;if(!node||!signature)return;
    if(initial.current||atBottom.current){node.scrollTop=node.scrollHeight;initial.current=false;setNewMessages(false);}
    else if(anchor.current){const saved=anchor.current,item=node.querySelector<HTMLElement>('[data-conversation-item="'+saved.id+'"]');if(item)node.scrollTop+=item.getBoundingClientRect().top-node.getBoundingClientRect().top-saved.offset;
      const next=result.data?.items.at(-1)?.sequence_no;if(next&&latestSequence.current&&BigInt(next)>BigInt(latestSequence.current))setNewMessages(true);}
    latestSequence.current=result.data?.items.at(-1)?.sequence_no??null;
  },[signature]);
  function rememberScroll(){const node=scroller.current;if(!node)return;atBottom.current=node.scrollHeight-node.scrollTop-node.clientHeight<48;if(atBottom.current){anchor.current=null;setNewMessages(false);return;}const top=node.getBoundingClientRect().top,first=[...node.querySelectorAll<HTMLElement>('[data-conversation-item]')].find(item=>item.getBoundingClientRect().bottom>top);if(first)anchor.current={id:first.dataset.conversationItem??'',offset:first.getBoundingClientRect().top-top};}
  if(!result.data||result.error instanceof ApiError&&[403,404].includes(result.error.status))return <section className="inbox-empty" role={result.isError?'alert':'status'}><MessageSquare size={28}/><p>{result.isError?errorMessage(result.error):'正在加载会话…'}</p><HButton onClick={()=>void result.refetch()} tone="secondary">刷新</HButton></section>;
  const {entry,items,deliveries,hasMore}=result.data;
  const firstDayIndex=new Map<string,number>(),channelChanges=new Map<number,string>();let previousChannel:string|null=null;
  items.forEach((item,index)=>{const day=item.occurred_at.slice(0,10);if(!firstDayIndex.has(day))firstDayIndex.set(day,index);const channel=messageChannel(item.source_label);if(channel){if(previousChannel&&channel!==previousChannel)channelChanges.set(index,channel);previousChannel=channel;}});
  const dateFormat=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}),now=Date.now(),today=dateFormat.format(now),yesterday=dateFormat.format(now-86_400_000);
  const waiting=entry.assignment.status!=='ASSIGNED'&&entry.session.status!=='ENDED';
  const committed=(r:ConversationMessageResult)=>{setReceipts(rows=>[r,...rows.filter(row=>row.message_id!==r.message_id)].slice(0,100));void result.refetch();void client.invalidateQueries({queryKey:['conversation-inbox',principal.principal_id]});};
  const visibleIds=new Set(items.map(item=>item.communication_message_id));
  const renderItem=(item:ConversationChatItem)=>{
    const values=item.communication_message_id?deliveries.filter(delivery=>delivery.message_id===item.communication_message_id):[];
    const internal=item.sender_category!=='SYSTEM'&&item.visibility!=='EXTERNAL',time=<time dateTime={item.occurred_at.replace(' ','T')+'+08:00'}>{item.occurred_at.slice(11,16)}</time>;
    const content=<>{item.sender_category!=='SYSTEM'?<header><strong>{item.sender_label}</strong><span aria-hidden="true">·</span>{time}</header>:null}
      <MessageBubble side={item.sender_category==='SYSTEM'?'system':item.sender_category==='HUMAN'||item.sender_category==='AUTOMATED_RULE'?'outgoing':'incoming'} internal={internal}>{internal?<LockKeyhole className="inbox-internal-lock inbox-internal-label" aria-hidden="true"/>:null}<p data-session-read-sequence={item.text?.trim()?item.sequence_no:undefined}>{item.text??'本条消息暂无可展示的文本。'}{item.sender_category==='SYSTEM'?<> · {time}</>:null}</p>{item.media_availability!=='NOT_MEDIA'?<p className="inbox-media"><Paperclip size={14}/> 媒体暂不可用；已保存附件请从关联事项受控下载。</p>:null}</MessageBubble>
      <footer>{item.sender_category==='HUMAN'||item.sender_category==='AUTOMATED_RULE'?<span data-message-delivery={item.communication_message_id??undefined}>{values.length?values.map(d=><span key={d.delivery_id} data-delivery-id={d.delivery_id}>{deliveryLabel(d)}{d.last_error_code?' · '+d.last_error_code:''}</span>):'正在确认发送状态'}</span>:null}</footer></>;
    return item.sender_category==='SYSTEM'?<TimelineEvent>{content}</TimelineEvent>:content;
  };
  return <><article className="inbox-chat" data-conversation-ready><header className="inbox-chat-header"><div className="inbox-chat-person"><Avatar name={entry.participant_label.replace(/（[^）]*）/gu,'')} personId={entry.contact_ref} size={32}/><div><h2>{entry.participant_label.replace(/（资料未提供）$/u,'')}</h2><p>{[entry.department_label,entry.channel_label].filter(Boolean).join(' · ')}</p></div><Tag tone={waiting?'warning':'neutral'}>{entry.session.status==='ENDED'?'已结束':entry.assignment.assigned_display_name??'待接待'}</Tag></div>
      <TopicPicker entry={entry} principal={principal} blocked={blocked} navigationTarget={navigationTarget}/><div className="inbox-more-actions"><DrawerMoreActions label="更多会话操作"><div className="inbox-topic-navigation-host" ref={setNavigationTarget}/><WorkbenchDisclosure title={<>查看关联事项与来源</>} className="inbox-business-compact"><AssociatedItem entry={entry} principal={principal} blocked={blocked}/></WorkbenchDisclosure><div className="inbox-control-panel"><ConversationControl entry={entry} principal={principal} onBlockedChange={setControlBlocked} chat receptionTarget={waiting?receptionTarget:null}/></div></DrawerMoreActions></div>
    </header>{result.isError?<p className="inbox-read-error" role="alert">当前重读失败，输入已保留：{errorMessage(result.error)}</p>:null}
    <div className="inbox-timeline" ref={scroller} onScroll={rememberScroll} data-conversation-timeline aria-label="当前主题消息">
      {hasMore?<HButton className="inbox-history" isDisabled={pages>=8||result.isFetching} onClick={()=>{rememberScroll();setPages(value=>Math.min(8,value+1));}} tone="secondary">加载更早消息</HButton>:null}{pages>=8&&hasMore?<p>已显示最近 400 条消息。</p>:null}
      <ConversationReadTimeline principal={principal} id={id} items={items} renderItem={renderItem} renderBeforeItem={(item,index)=>{const day=item.occurred_at.slice(0,10),newDay=firstDayIndex.get(day)===index,channel=channelChanges.get(index);return <>{newDay?<li className="inbox-message-divider inbox-date-divider"><time dateTime={day}>{day===today?'今天':day===yesterday?'昨天':day.slice(5)}</time></li>:null}{channel?<li className="inbox-message-divider inbox-channel-divider"><span>切换到 {channel}</span></li>:null}</>;}} itemClassName={item=>'inbox-message inbox-message-'+item.sender_category.toLowerCase()}/>
      {!items.length?<p className="inbox-empty-copy">当前主题暂无可展示消息。可以先核对来源与接待责任。</p>:null}
      {receipts.filter(r=>!visibleIds.has(r.message_id)).map(r=><p className="inbox-committed" key={r.message_id} data-pending-message={r.message_id}>已提交，等待发送与时间线同步。</p>)}
    </div>
    {newMessages?<HButton className="inbox-new-messages" onClick={()=>{if(scroller.current)scroller.current.scrollTop=scroller.current.scrollHeight;atBottom.current=true;setNewMessages(false);}} tone="secondary">查看最新消息</HButton>:null}
    <div className="inbox-reception" hidden={!waiting}><p><strong>{entry.participant_label}</strong> 尚无人接待 · 接待后即可回复</p><div className="inbox-reception-actions" ref={setReceptionTarget}/></div>
    <div className="inbox-composer" data-purpose={tab}>{/* Keep selected state on the native root: the shared Button filters aria-selected. */}<SegmentedControl role="tablist" aria-label="消息用途"><HButton role="tab" ref={element=>{element?.setAttribute('aria-selected',String(tab==='messages'));}} id="conversation-reply-tab" aria-controls="conversation-reply-panel" aria-selected={tab==='messages'} onClick={()=>setTab('messages')} tone="secondary">回复报修人</HButton><HButton role="tab" ref={element=>{element?.setAttribute('aria-selected',String(tab==='internal-notes'));}} id="conversation-note-tab" aria-controls="conversation-note-panel" aria-selected={tab==='internal-notes'} onClick={()=>setTab('internal-notes')} tone="secondary">内部备注</HButton></SegmentedControl>
      {entry.session.status==='ENDED'?<p className="inbox-ended">历史主题只读；新沟通请明确续接后继续接待。</p>:null}
      <div role="tabpanel" id="conversation-reply-panel" aria-labelledby="conversation-reply-tab" hidden={tab!=='messages'}><ConversationComposer compact entry={entry} principal={principal} purpose="messages" onBlockedChange={setReplyBlocked} onCommitted={committed}/></div>
      <div role="tabpanel" id="conversation-note-panel" aria-labelledby="conversation-note-tab" hidden={tab!=='internal-notes'}><ConversationComposer compact entry={entry} principal={principal} purpose="internal-notes" onBlockedChange={setNoteBlocked} onCommitted={()=>void result.refetch()}/></div>
      {result.data.deliveryLimited?<p>部分历史消息的发送状态暂未显示，请前往通知异常核对。</p>:null}
    </div></article><aside className="inbox-business"><AssociatedItem entry={entry} principal={principal} blocked={blocked}/></aside></>;
}
export function ConversationInbox({principal,onBlockedChange}:{principal:Principal;onBlockedChange:(blocked:boolean)=>void}){
  const {sessionId}=useParams(),[params,setParams]=useSearchParams(),[blocked,setBlocked]=useState(false),[search,setSearch]=useState(params.get('q')??'');
  const [selectedContact,setSelectedContact]=useState<string|null>(null);
  const state=states.some(([key])=>key===params.get('state'))?params.get('state')??'open':'open',source=(params.get('source')??'all')in sourceNames?params.get('source')??'all':'all',q=params.get('q')??'',group=params.get('source_group_ref')??undefined;
  const scope=JSON.stringify([state,source,q,group]),[page,setPage]=useState<{scope:string;cursor:string|null}>({scope,cursor:null}),cursor=page.scope===scope?page.cursor:null;
  const list=useQuery({queryKey:['conversation-inbox',principal.principal_id,state,source,q,group??null,cursor],queryFn:({signal})=>conversationInbox.list({state,source,q,...(group?{source_group_ref:group}:{})},cursor,signal),gcTime:0});
  useEffect(()=>{onBlockedChange(blocked);return()=>onBlockedChange(false);},[blocked,onBlockedChange]);
  useEffect(()=>{if(cursor&&list.error instanceof ApiError&&list.error.code==='WORKBENCH_CURSOR_INVALID')setPage({scope,cursor:null});},[cursor,list.error,scope]);
  const change=(name:string,value:string)=>{const next=new URLSearchParams(params);if(value)next.set(name,value);else next.delete(name);if(name==='source')next.delete('source_group_ref');setParams(next);};
  const clearSource=()=>{const next=new URLSearchParams(params);next.delete('source');setParams(next);};
  return <section className="workspace ds-page conversation-inbox-workspace" aria-label="会话"><PageHeader title="会话" icon={<MessageSquare/>}/><Toolbar><HForm className="inbox-search" onSubmit={e=>{e.preventDefault();change('q',search.trim());}}><SearchField id="conversation-inbox-search" aria-label="搜索联系人、主题或工单号" placeholder="搜索联系人、主题或工单号" value={search} maxLength={128} disabled={blocked} onChange={e=>setSearch(e.target.value)} onClear={()=>setSearch('')}/></HForm>
      <div className="inbox-filters"><FilterChip label="队列" aria-label="收件箱队列" active={state!=='open'} title={state==='open'?'当前：进行中':undefined} onClear={()=>change('state','open')} value={state} isDisabled={blocked} onChange={e=>change('state',e)}>{states.map(([key,label])=><ListBox.Item key={key} id={key} textValue={String(label)}>{label}<ListBox.ItemIndicator/></ListBox.Item>)}</FilterChip><FilterChip label="来源" aria-label="收件箱来源" active={source!=='all'} onClear={clearSource} value={source} isDisabled={blocked} onChange={e=>change('source',e)}>{Object.entries(sourceNames).map(([key,label])=><ListBox.Item key={key} id={key} textValue={String(label)}>{label}<ListBox.ItemIndicator/></ListBox.Item>)}</FilterChip></div>
      {group||list.data?.items.some(contact=>contact.source_badges.some(badge=>badge.kind==='group'&&badge.ref))?<FilterChip className="inbox-source-filter" label="来源群" aria-label="具体来源群" active={Boolean(group)} onClear={()=>change('source_group_ref','')} value={group??'all'} isDisabled={blocked} onChange={value=>change('source_group_ref',value==='all'?'':value)}><ListBox.Item id="all" textValue="全部来源群">全部来源群<ListBox.ItemIndicator/></ListBox.Item>{[...new Map((list.data?.items??[]).flatMap(contact=>contact.source_badges.filter(badge=>badge.kind==='group'&&badge.ref)).map(badge=>[badge.ref,badge])).values()].map(badge=><ListBox.Item key={badge.ref} id={badge.ref??''} textValue={badge.label}>{badge.label}<ListBox.ItemIndicator/></ListBox.Item>)}</FilterChip>:null}
      {group?<HButton isDisabled={blocked} className="inbox-filter-clear sr-only" onClick={()=>change('source_group_ref','')} tone="ghost">清除具体来源群筛选</HButton>:null}
      </Toolbar><Split className={'inbox-layout'+(sessionId?' inbox-has-selection':'')}><aside className="inbox-contacts" aria-label="联系人收件箱">
      {list.isPending?<p role="status" className="inbox-list-state">正在加载联系人…</p>:null}{list.isError?<div className="inbox-list-state" role="alert"><p>{errorMessage(list.error)}</p><HButton onClick={()=>{setPage({scope,cursor:null});void list.refetch();}} tone="secondary">刷新联系人</HButton></div>:null}
      <div className="inbox-contact-rows">{list.data?.items.map(contact=><ConversationListItem name={contact.participant_label} personId={contact.contact_ref} key={contact.contact_ref} data-contact-ref={contact.contact_ref} className={contact.contact_ref===selectedContact?'is-selected':''}>
        <Link to={'/conversations/'+contact.anchor_session_id+'?'+params.toString()} onClick={e=>{if(blocked)e.preventDefault();}} aria-current={contact.contact_ref===selectedContact?'page':undefined}><div className="inbox-contact-title"><span className="inbox-contact-identity"><strong>{contact.participant_label.replace(/（资料未提供）$/u,'')}</strong>{contact.department_label?<span className="inbox-contact-department" title={contact.department_label}>{contact.department_label}</span>:null}</span><time title="最近活动（北京时间）">{contact.latest_activity_at.slice(5,16)}</time></div>
          <p className="inbox-contact-preview">{contact.last_item_preview?.visibility!=='EXTERNAL'&&contact.last_item_preview?'[内部] ':''}{contact.last_item_preview?.text??'暂无可展示的文字消息'}</p>
          <div className="inbox-contact-bottom"><StatusBadge tone={state!=='ended'&&contact.assignment_summary.kind==='UNASSIGNED'?'warning':'neutral'} title={contact.assignment_summary.label}>{state==='ended'?contact.assignment_summary.label:contact.assignment_summary.kind==='UNASSIGNED'?'待接待':contact.assignment_summary.kind==='MINE'?'我接待':'接待中'}</StatusBadge><span className="inbox-source-badges" title="群数来自本次可见来源；截断时显示下界">{contact.matching_topic_count} 个主题 · {contact.additional_source_count?'至少 ':''}{contact.source_badges.filter(badge=>badge.kind==='group').length} 个群</span>{contact.has_delivery_exception?<span className="inbox-delivery-exception" title="有投递待处理" aria-label="有投递待处理">!</span>:null}{contact.unread_count?<span className="inbox-unread" aria-label={contact.unread_count+'条本人未读'}>{contact.unread_count>99?'99+':contact.unread_count}</span>:null}</div></Link>
        </ConversationListItem>)}</div>
      {list.data&&!list.data.items.length?<EmptyState className="inbox-list-state" title="当前筛选没有可见的联系人" description="可调整队列或搜索条件。" icon={<MessageSquare/>}/>:null}
      {list.data?.items.length&&(cursor||list.data.next_cursor)?<div className="inbox-pagination">{cursor?<HButton isDisabled={blocked} onClick={()=>setPage({scope,cursor:null})} tone="ghost">返回最新</HButton>:null}{list.data.next_cursor?<HButton isDisabled={list.isFetching||blocked} onClick={()=>setPage({scope,cursor:list.data?.next_cursor??null})} tone="ghost">下一页</HButton>:null}</div>:null}
    </aside>
    {sessionId?<><Link className="inbox-back" to={'/conversations?'+params.toString()} onClick={e=>{if(blocked)e.preventDefault();}}><ArrowLeft size={15}/>联系人</Link><ChatConversation key={principal.principal_id+':'+sessionId} principal={principal} id={sessionId} onBlockedChange={setBlocked} onContactChange={setSelectedContact}/></>:list.data?.items.length?<EmptyState className="inbox-empty" icon={<MessageSquare/>} title="选择一位报修人" description={state==='ended'?'查看已结束的服务主题和历史沟通记录。':'查看具体问题和沟通窗口，领取后可回复。'}/>:null}
  </Split></section>;
}
