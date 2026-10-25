import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Link,useNavigate,useParams,useSearchParams} from 'react-router';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {MessageSquare,Search,ArrowLeft,ChevronRight,Paperclip} from 'lucide-react';
import {api,ApiError,errorMessage,statusLabels} from '../../api/client';
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
export function deliveryLabel(d:ConversationWorkspaceDelivery){
  if(d.side_effect_state==='UNKNOWN'||['UNKNOWN','RECONCILIATION_REQUIRED'].includes(d.status))return '结果待核实';
  if(d.status==='SENT')return '渠道已确认发送';if(d.status==='CANCELLED')return '已取消';
  if(d.status==='DEAD_LETTER')return '发送失败';if(d.status==='SENDING')return '发送中';return '排队中';
}
function AssociatedItem({entry,principal,blocked}:{entry:ConversationChatEntry;principal:Principal;blocked:boolean}){
  const item=entry.canonical_item;
  const detail=useQuery({queryKey:['detail',principal.principal_id,item?.kind,item?.id,'summary'],queryFn:({signal})=>{if(!item)throw Error('NO_CANONICAL_ITEM');return api.detail(item.kind,item.id,null,signal);},enabled:Boolean(item)});
  return <section className="inbox-associated" aria-label="关联事项"><h3>关联事项</h3>{item?<><span className="inbox-meta">{item.number}</span><h4>{item.title}</h4>
    {detail.data?<dl><dt>当前状态</dt><dd>{statusLabels[detail.data.item.status]??detail.data.item.status}</dd><dt>处理人</dt><dd>{detail.data.item.assignee_name??'待安排'}</dd><dt>沟通人</dt><dd>{entry.assignment.assigned_display_name??'待接待'}</dd></dl>:<p>{detail.isError?'事项摘要暂不可用':'正在读取事项摘要…'}</p>}
    <Link to={'/items/'+item.kind+'/'+item.id+'?detail=page'} onClick={e=>{if(blocked)e.preventDefault();}}>打开事项详情 <ChevronRight size={14}/></Link></>:<p>暂无可展示的关联事项</p>}
    <div className="inbox-origin"><h3>本主题来源</h3><p>{entry.original_source.label}</p><p>当前：{entry.current_contact_channel==='group'?'群内原始沟通':'Bot 私聊'}</p><p>{entry.reply_channel_label}</p></div>
    <p className="inbox-meta">沟通接待与工单处理分别管理。</p>
  </section>;
}
function TopicPicker({entry,principal,blocked}:{entry:ConversationChatEntry;principal:Principal;blocked:boolean}){
  const navigate=useNavigate(),[params]=useSearchParams(),[cursor,setCursor]=useState<string|null>(null);
  const related=useQuery({queryKey:['conversation-related',principal.principal_id,entry.session.session_id,cursor],queryFn:({signal})=>conversationInbox.related(entry.session.session_id,cursor,signal),gcTime:0});
  const client=useQueryClient();
  useEffect(()=>{if(related.error instanceof ApiError){if(cursor&&related.error.code==='WORKBENCH_CURSOR_INVALID')setCursor(null);if([403,404].includes(related.error.status))void clearItemAuthorization(client,principal.principal_id,'conversation',entry.session.session_id,related.error);}},[client,cursor,entry.session.session_id,principal.principal_id,related.error]);
  const groups=new Map<string,ConversationChatEntry[]>();
  for(const value of related.data?.items??[]){const rows=groups.get(value.topic_ref)??[];rows.push(value);groups.set(value.topic_ref,rows);}
  if(![...groups.values()].some(rows=>rows.some(row=>row.session.session_id===entry.session.session_id)))groups.set(entry.topic_ref,[entry,...(groups.get(entry.topic_ref)??[])]);
  const direct=(related.data?.items??[]).find(row=>row.topic_ref===entry.topic_ref&&row.session.session_id!==entry.session.session_id&&row.current_contact_channel==='direct'&&row.session.status!=='ENDED');
  const change=(id:string)=>{if(!blocked)navigate('/conversations/'+id+'?'+params.toString());};
  return <div className="inbox-topic-picker"><label>服务主题与沟通窗口<select aria-label="服务主题与沟通窗口" value={entry.session.session_id} disabled={blocked||related.isPending} onChange={e=>change(e.target.value)}>
    {[...groups].map(([ref,rows])=><optgroup key={ref} label={rows[0]?.topic??'服务主题'}>{rows.map(row=><option key={row.session.session_id} value={row.session.session_id}>{row.topic} · {row.current_contact_channel==='group'?'群内原始消息':'Bot 私聊'}{row.session.status==='ENDED'?' · 历史':''}</option>)}</optgroup>)}
  </select></label><div className="inbox-topic-pages">{cursor?<button disabled={blocked} onClick={()=>setCursor(null)}>返回最新主题</button>:null}{related.data?.next_cursor?<button disabled={blocked||related.isFetching} onClick={()=>setCursor(related.data?.next_cursor??null)}>更多主题与窗口</button>:null}</div>
    {direct?<button className="inbox-new-direct" disabled={blocked} onClick={()=>change(direct.session.session_id)}>本主题有私聊补充，查看并继续接待</button>:null}
    {related.isError?<p role="alert">{errorMessage(related.error)}</p>:null}
  </div>;
}
function ChatConversation({principal,id,onBlockedChange,onContactChange}:{principal:Principal;id:string;onBlockedChange:(value:boolean)=>void;onContactChange:(value:string|null)=>void}){
  const client=useQueryClient(),[pages,setPages]=useState(1),[tab,setTab]=useState<'messages'|'internal-notes'>('messages');
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
  if(!result.data||result.error instanceof ApiError&&[403,404].includes(result.error.status))return <section className="inbox-empty" role={result.isError?'alert':'status'}><MessageSquare size={28}/><p>{result.isError?errorMessage(result.error):'正在读取当前获权沟通…'}</p><button onClick={()=>void result.refetch()}>重新读取</button></section>;
  const {entry,items,deliveries,hasMore}=result.data;
  const committed=(r:ConversationMessageResult)=>{setReceipts(rows=>[r,...rows.filter(row=>row.message_id!==r.message_id)].slice(0,100));void result.refetch();void client.invalidateQueries({queryKey:['conversation-inbox',principal.principal_id]});};
  const visibleIds=new Set(items.map(item=>item.communication_message_id));
  const renderItem=(item:ConversationChatItem)=>{
    const values=item.communication_message_id?deliveries.filter(delivery=>delivery.message_id===item.communication_message_id):[];
    return <><header><strong>{item.sender_label}</strong>{item.visibility!=='EXTERNAL'?<span className="inbox-internal-label">仅内部可见</span>:null}<time dateTime={item.occurred_at.replace(' ','T')+'+08:00'}>{item.occurred_at.slice(5,16)}</time></header>
      <div className="inbox-bubble"><p data-session-read-sequence={item.text?.trim()?item.sequence_no:undefined}>{item.text??'本条消息暂无可展示的文本。'}</p>{item.media_availability!=='NOT_MEDIA'?<p className="inbox-media"><Paperclip size={14}/> 媒体暂不可用；已保存附件请从关联事项受控下载。</p>:null}</div>
      <footer>{item.source_label}{item.sender_category==='HUMAN'||item.sender_category==='AUTOMATED_RULE'?<span data-message-delivery={item.communication_message_id??undefined}>{values.length?values.map(d=><span key={d.delivery_id} data-delivery-id={d.delivery_id}>{deliveryLabel(d)}{d.last_error_code?' · '+d.last_error_code:''}</span>):'投递状态尚未读取'}</span>:null}</footer></>;
  };
  return <><article className="inbox-chat" data-conversation-ready><header className="inbox-chat-header"><div><h2>{entry.participant_label}</h2><p>{entry.department_label??'部门资料未提供'} · {entry.assignment.assigned_display_name??'待接待'}</p></div><span className="inbox-reply-target">{entry.reply_channel_label}</span>
      <h3>{entry.topic}</h3><p className="inbox-source-line">原始来源：{entry.original_source.label} · 当前：{entry.current_contact_channel==='group'?'群内原始消息':'Bot 私聊'}</p>
      <TopicPicker entry={entry} principal={principal} blocked={blocked}/><details className="inbox-business-compact"><summary>查看关联事项与来源</summary><AssociatedItem entry={entry} principal={principal} blocked={blocked}/></details><details className="inbox-control-panel" open={entry.assignment.status!=='ASSIGNED'}><summary>接待操作 · {entry.assignment.assigned_display_name??'待接待'}</summary><ConversationControl entry={entry} principal={principal} onBlockedChange={setControlBlocked} chat takeoverLabel={entry.original_source.kind==='group'&&entry.current_contact_channel==='direct'?'继续接待':'我来接待'}/></details>
      {result.isError?<p role="alert">当前重读失败，输入已保留：{errorMessage(result.error)}</p>:null}
    </header>
    <div className="inbox-timeline" ref={scroller} onScroll={rememberScroll} data-conversation-timeline aria-label="当前主题消息">
      {hasMore?<button className="inbox-history" disabled={pages>=8||result.isFetching} onClick={()=>{rememberScroll();setPages(value=>Math.min(8,value+1));}}>加载更早消息</button>:null}{pages>=8&&hasMore?<p>已达本次400条读取上限。</p>:null}
      <ConversationReadTimeline principal={principal} id={id} items={items} renderItem={renderItem} itemClassName={item=>'inbox-message inbox-message-'+item.sender_category.toLowerCase()}/>
      {!items.length?<p className="inbox-empty-copy">当前主题暂无可展示消息。可以先核对来源与接待责任。</p>:null}
      {receipts.filter(r=>!visibleIds.has(r.message_id)).map(r=><p className="inbox-committed" key={r.message_id} data-pending-message={r.message_id}>已提交，等待发送与时间线同步。</p>)}
    </div>
    {newMessages?<button className="inbox-new-messages" onClick={()=>{if(scroller.current)scroller.current.scrollTop=scroller.current.scrollHeight;atBottom.current=true;setNewMessages(false);}}>查看最新消息</button>:null}
    <div className="inbox-composer"><div role="tablist" aria-label="消息用途"><button role="tab" id="conversation-reply-tab" aria-controls="conversation-reply-panel" aria-selected={tab==='messages'} onClick={()=>setTab('messages')}>回复用户</button><button role="tab" id="conversation-note-tab" aria-controls="conversation-note-panel" aria-selected={tab==='internal-notes'} onClick={()=>setTab('internal-notes')}>内部备注</button></div>
      {entry.session.status==='ENDED'?<p className="inbox-ended">历史主题只读；新沟通请明确续接后继续接待。</p>:null}
      <div role="tabpanel" id="conversation-reply-panel" aria-labelledby="conversation-reply-tab" hidden={tab!=='messages'}><ConversationComposer entry={entry} principal={principal} purpose="messages" onBlockedChange={setReplyBlocked} onCommitted={committed}/></div>
      <div role="tabpanel" id="conversation-note-panel" aria-labelledby="conversation-note-tab" hidden={tab!=='internal-notes'}><ConversationComposer entry={entry} principal={principal} purpose="internal-notes" onBlockedChange={setNoteBlocked} onCommitted={()=>void result.refetch()}/></div>
      {result.data.deliveryLimited?<p>部分历史投递状态超出本次读取上限，请从通知异常继续核对。</p>:null}
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
  return <section className="workspace conversation-inbox-workspace"><div className="page-title"><div><h1>会话</h1><p>按人查看，按问题接待。</p></div></div><div className={'inbox-layout'+(sessionId?' inbox-has-selection':'')}>
    <aside className="inbox-contacts" aria-label="联系人收件箱"><form className="inbox-search" onSubmit={e=>{e.preventDefault();change('q',search.trim());}}><label htmlFor="conversation-inbox-search"><Search size={16}/>搜索联系人、主题或工单号</label><div><input id="conversation-inbox-search" value={search} maxLength={128} disabled={blocked} onChange={e=>setSearch(e.target.value)}/><button disabled={blocked} type="submit">搜索</button></div></form>
      <div className="inbox-filters"><label>队列<select aria-label="收件箱队列" value={state} disabled={blocked} onChange={e=>change('state',e.target.value)}>{states.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label>原始来源<select aria-label="收件箱来源" value={source} disabled={blocked} onChange={e=>change('source',e.target.value)}>{Object.entries(sourceNames).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label></div>
      {group?<button disabled={blocked} className="inbox-filter-clear" onClick={()=>change('source_group_ref','')}>清除具体来源群筛选</button>:null}
      {list.isPending?<p role="status" className="inbox-list-state">正在读取获权联系人…</p>:null}{list.isError?<div className="inbox-list-state" role="alert"><p>{errorMessage(list.error)}</p><button onClick={()=>{setPage({scope,cursor:null});void list.refetch();}}>重新读取联系人</button></div>:null}
      <div className="inbox-contact-rows">{list.data?.items.map(contact=><article key={contact.contact_ref} data-contact-ref={contact.contact_ref} className={contact.contact_ref===selectedContact?'is-selected':''}>
        <Link to={'/conversations/'+contact.anchor_session_id+'?'+params.toString()} onClick={e=>{if(blocked)e.preventDefault();}} aria-current={contact.contact_ref===selectedContact?'page':undefined}><div className="inbox-contact-title"><strong>{contact.participant_label}</strong><time>{contact.latest_activity_at.slice(5,16)}</time></div>
          <p className="inbox-contact-preview">{contact.last_item_preview?.visibility!=='EXTERNAL'&&contact.last_item_preview?'[内部] ':''}{contact.last_item_preview?.text??'暂无可展示的文字消息'}</p>
          <div className="inbox-contact-bottom"><span>{contact.matching_topic_count}个匹配主题 · {contact.assignment_summary.label}</span>{contact.unread_count?<span className="inbox-unread" aria-label={contact.unread_count+'条本人未读'}>{contact.unread_count>99?'99+':contact.unread_count}</span>:null}</div>
          {contact.has_delivery_exception?<span className="inbox-delivery-exception">有投递待处理</span>:null}</Link>
          <div className="inbox-source-badges">{contact.source_badges.map((badge,index)=>badge.ref?<button key={badge.ref} disabled={blocked} onClick={()=>change('source_group_ref',badge.ref??'')}>{badge.label}</button>:<span key={index}>{badge.label}</span>)}{contact.additional_source_count?<span>另{contact.additional_source_count}个来源</span>:null}</div>
        </article>)}</div>
      {list.data&&!list.data.items.length?<p className="inbox-list-state">当前筛选没有获权联系人，可调整队列或搜索条件。</p>:null}
      <div className="inbox-pagination"><button disabled={!cursor||blocked} onClick={()=>setPage({scope,cursor:null})}>返回最新</button><button disabled={!list.data?.next_cursor||list.isFetching||blocked} onClick={()=>setPage({scope,cursor:list.data?.next_cursor??null})}>下一页</button></div>
    </aside>
    {sessionId?<><Link className="inbox-back" to={'/conversations?'+params.toString()} onClick={e=>{if(blocked)e.preventDefault();}}><ArrowLeft size={15}/>联系人</Link><ChatConversation key={principal.principal_id+':'+sessionId} principal={principal} id={sessionId} onBlockedChange={setBlocked} onContactChange={setSelectedContact}/></>:<section className="inbox-empty"><MessageSquare size={32}/><h2>选择一位报修人</h2><p>查看具体问题和沟通窗口，再领取接待责任。</p></section>}
  </div></section>;
}
