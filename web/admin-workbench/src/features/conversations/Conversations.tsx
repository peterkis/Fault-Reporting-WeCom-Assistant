import {useEffect,useRef,useState} from 'react';
import {Link,useParams,useSearchParams} from 'react-router';
import {useInfiniteQuery,useQuery,useQueryClient} from '@tanstack/react-query';
import {ApiError,errorMessage} from '../../api/client';
import type {Principal} from '../../api/client';
import {clearItemAuthorization} from '../../app/authorization';
import {ConversationComposer} from './ConversationComposer';
import {conversations} from './client';
import type {ConversationControlCommand,ConversationWorkspaceEntry,ConversationWorkspaceItem,ConversationMessageResult} from './client';
const states=[['open','进行中'],['mine','我负责沟通'],['unassigned','待接管'],['waiting_human','待人工'],['waiting_user','待补充'],['failed_delivery','投递异常'],['ended','已结束']] as const;
export function ItemConversations({principal,kind,id}:{principal:Principal;kind:string;id:string}){
  const query=useQuery({queryKey:['item-conversations',principal.principal_id,kind,id],queryFn:({signal})=>conversations.links(kind,id,signal),enabled:principal.conversation_workspace_enabled});
  if(!principal.conversation_workspace_enabled)return null;
  return <section className="item-conversations" aria-label="关联服务会话"><h3>关联服务会话</h3>{query.isPending?<p>正在核对关联会话…</p>:query.isError?<p role="alert">{errorMessage(query.error)}</p>:query.data.items.length?<ul>{query.data.items.map(v=><li key={v.session.session_id}><Link to={'/conversations/'+v.session.session_id}>{v.participant_label} · {v.topic} · {v.session.status==='ENDED'?'已结束':'进行中'}</Link></li>)}</ul>:<p>当前事项没有可读取的服务会话。可继续通过事项的处理操作协作。</p>}</section>;
}
function Control({entry,principal,onBlockedChange}:{entry:ConversationWorkspaceEntry;principal:Principal;onBlockedChange:(value:boolean)=>void}){
  const client=useQueryClient(),request=useRef<AbortController|null>(null),generation=useRef(0);
  const [target,setTarget]=useState(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[pending,setPending]=useState<{action:string;command:ConversationControlCommand}|null>(null);
  const id=entry.session.session_id,canTransfer=entry.capabilities.some(v=>['TRANSFER','FORCE_TRANSFER'].includes(v));
  const eligible=useQuery({queryKey:['conversation-eligible',principal.principal_id,id],queryFn:({signal})=>conversations.eligible(id,signal),enabled:canTransfer});
  useEffect(()=>{onBlockedChange(busy||Boolean(pending));return()=>onBlockedChange(false);},[busy,pending,onBlockedChange]);
  useEffect(()=>()=>{generation.current++;request.current?.abort();},[]);
  useEffect(()=>{if(!busy&&!pending)return;const warn=(e:BeforeUnloadEvent)=>e.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[busy,pending]);
  async function act(action:string,force=false,saved?:{action:string;command:ConversationControlCommand}){
    if(request.current)return;const controller=new AbortController(),token=generation.current;request.current=controller;setBusy(true);
    const attempt=saved??{action,command:Object.freeze({client_command_id:crypto.randomUUID(),expected_row_version:entry.session.row_version,...(action==='transfer'?{target_principal_id:target,force}:{}),...(force?{reason_code:reason}:{}),...(entry.handoff&&['takeover','handoff/cancel'].includes(action)?{handoff_id:entry.handoff.handoff_id}:{})})};
    try{await conversations.control(id,attempt.action,attempt.command,principal.csrf_token,controller.signal);if(generation.current!==token||controller.signal.aborted)return;setPending(null);setNotice('沟通操作已确认；处理责任与工单状态另行管理。');}
    catch(error){if(generation.current!==token||controller.signal.aborted)return;if(error instanceof ApiError){setPending(null);setNotice(errorMessage(error));if([403,404].includes(error.status))void clearItemAuthorization(client,principal.principal_id,'conversation',id,error);}else{setPending(attempt);setNotice('操作结果未知：保留原命令，请核对当前沟通事实后用原命令核对。');}}
    finally{if(request.current===controller){request.current=null;setBusy(false);void client.invalidateQueries({queryKey:['conversation-view',principal.principal_id,id]});}}
  }
  const disabled=busy||Boolean(pending);
  return <section className="conversation-controls" aria-label="沟通责任"><h3>沟通责任</h3><p>{entry.assignment.assigned_display_name??'暂未分配沟通人'}{entry.assignment.assigned_to_me?'（我负责沟通）':''} · {entry.session.control_mode==='HUMAN'?'人工沟通':entry.session.control_mode}</p>
    <div className="note-controls">
      {entry.capabilities.includes('TAKEOVER')?<button disabled={disabled} onClick={()=>void act('takeover')} data-action="takeover-conversation">接管沟通</button>:null}
      {entry.capabilities.includes('RELEASE')?<button disabled={disabled} onClick={()=>void act('release')}>释放沟通责任</button>:null}
      {entry.capabilities.includes('REQUEST_HANDOFF')?<button disabled={disabled} onClick={()=>void act('handoff/request')}>请求人工接管</button>:null}
      {entry.capabilities.includes('CANCEL_HANDOFF')?<button disabled={disabled} onClick={()=>void act('handoff/cancel')}>取消人工接管请求</button>:null}
    </div>{canTransfer?<div className="transfer-controls"><label>转派给<select aria-label="沟通转派对象" disabled={disabled||eligible.isError} value={target} onChange={e=>setTarget(e.target.value)}><option value="">选择当前获权工作人员</option>{eligible.data?.items.filter(p=>p.principal_id!==principal.principal_id).map(p=><option value={p.principal_id} key={p.principal_id}>{p.display_name}</option>)}</select></label>
      {entry.capabilities.includes('TRANSFER')?<button disabled={disabled||!target} onClick={()=>void act('transfer')}>转派沟通</button>:null}
      {entry.capabilities.includes('FORCE_TRANSFER')?<><label>强制转派原因码<input aria-label="强制转派原因码" maxLength={64} value={reason} onChange={e=>setReason(e.target.value)}/></label><button disabled={disabled||!target||! /^[A-Z][A-Z0-9_]{0,63}$/u.test(reason)} onClick={()=>void act('transfer',true)}>强制转派沟通</button></>:null}{eligible.isError?<p role="alert">{errorMessage(eligible.error)}</p>:null}</div>:null}
    {pending?<button disabled={busy} onClick={()=>void act(pending.action,false,pending)}>用保留的原命令核对</button>:null}<p role="status">{notice}</p>
  </section>;
}
function SelectedConversation({principal,id,onBlockedChange}:{principal:Principal;id:string;onBlockedChange:(blocked:boolean)=>void}){
  const [pages,setPages]=useState(1),[replyBlocked,setReplyBlocked]=useState(false),[noteBlocked,setNoteBlocked]=useState(false),[controlBlocked,setControlBlocked]=useState(false),[receipts,setReceipts]=useState<ConversationMessageResult[]>([]);
  const result=useQuery({queryKey:['conversation-view',principal.principal_id,id,pages],queryFn:async({signal})=>{
    const [entry,first,delivery]=await Promise.all([conversations.detail(id,signal),conversations.items(id,signal),conversations.deliveries(id,signal)]);const items:ConversationWorkspaceItem[]=[...first.items];let cursor=first.before_sequence,hasMore=first.has_more;
    for(let page=1;page<pages&&hasMore&&cursor;page++){const older=await conversations.items(id,signal,{before_sequence:cursor});items.push(...older.items);cursor=older.before_sequence;hasMore=older.has_more;}
    return {entry,items:[...new Map(items.map(v=>[v.item_id,v])).values()].sort((a,b)=>BigInt(a.sequence_no)<BigInt(b.sequence_no)?-1:1).slice(-400),delivery,hasMore};
  },refetchInterval:'realtime_sse_enabled' in principal&&principal.realtime_sse_enabled===true?false:5000,placeholderData:previous=>previous});
  const blocked=replyBlocked||noteBlocked||controlBlocked;
  useEffect(()=>{onBlockedChange(blocked);return()=>onBlockedChange(false);},[blocked,onBlockedChange]);
  if(!result.data)return <section className="conversation-content"><p role={result.isError?'alert':'status'}>{result.isError?errorMessage(result.error):'正在核验服务会话…'}</p><button onClick={()=>void result.refetch()}>重新读取</button></section>;
  const {entry,items,delivery,hasMore}=result.data;
  const committed=(r:ConversationMessageResult)=>{setReceipts(value=>[r,...value.filter(v=>v.message_id!==r.message_id)].slice(0,100));void result.refetch();};
  return <article className="conversation-content" data-conversation-ready><header><p>{entry.participant_label} · {entry.channel_label}</p><h2>{entry.topic}</h2><p>{entry.session.status==='ENDED'?'服务会话已结束':'服务会话进行中'} · 最近活动 {entry.session.last_activity_at}（北京时间）</p>{entry.canonical_item?<Link to={'/items/'+entry.canonical_item.kind+'/'+entry.canonical_item.id+'?detail=page'} onClick={e=>{if(blocked)e.preventDefault();}}>查看关联事项 {entry.canonical_item.number}</Link>:<p>关联事项不在当前授权范围内。</p>}</header>
    {result.isError?<p role="alert">读取暂时失败，输入已保留：{errorMessage(result.error)}</p>:null}
    <Control principal={principal} entry={entry} onBlockedChange={setControlBlocked}/>
    <section className="conversation-timeline" aria-label="本服务主题材料" data-conversation-timeline><h3>本服务主题材料 <small>{items.length} 条已加载</small></h3>{hasMore?<button disabled={pages>=4||result.isFetching} onClick={()=>setPages(v=>Math.min(4,v+1))}>加载更早材料</button>:null}{pages>=4&&hasMore?<p>已达到本次400条读取上限，请按主题继续核对。</p>:null}<ol>{items.map(item=><li key={item.item_id} data-conversation-item={item.item_id}><header><strong>{item.visibility==='INTERNAL'?'内部协作':item.sender_kind==='USER'?'报修人':'工作人员'}</strong><time>{item.occurred_at}</time><span>{item.visibility==='INTERNAL'?'内部备注':'服务材料'}</span></header><p>{item.text??'本条材料没有可展示的文本。'}</p></li>)}</ol></section>
    <section aria-label="回复投递" data-conversation-deliveries><h3>回复投递</h3>{[...new Map([...delivery.items.map(d=>d.message_id),...receipts.map(r=>r.message_id)].map(v=>[v,v])).values()].map(messageId=>{const values=delivery.items.filter(d=>d.message_id===messageId);return <div key={messageId} data-delivery-message={messageId}><strong>本条回复</strong>{values.length?values.map(d=><p key={d.delivery_id} data-delivery-id={d.delivery_id}>{d.side_effect_state==='UNKNOWN'||d.status==='UNKNOWN'?'发送结果未知，需核对':d.status==='SENT'?'已发送':d.status==='DEAD_LETTER'?'发送失败':d.status==='SENDING'?'正在发送':'待发送'}{d.last_error_code?' · '+d.last_error_code:''}</p>):<p>已受理，投递记录待读取。</p>}</div>;})}{!delivery.items.length&&!receipts.length?<p>暂无本服务主题的回复投递记录。</p>:null}</section>
    <div className="conversation-editors"><ConversationComposer entry={entry} principal={principal} purpose="messages" onBlockedChange={setReplyBlocked} onCommitted={committed}/><ConversationComposer entry={entry} principal={principal} purpose="internal-notes" onBlockedChange={setNoteBlocked} onCommitted={()=>void result.refetch()}/></div>
  </article>;
}
export function Conversations({principal,onBlockedChange}:{principal:Principal;onBlockedChange:(blocked:boolean)=>void}){
  const {sessionId}=useParams(),[params,setParams]=useSearchParams(),[blocked,setBlocked]=useState(false),state=states.some(([key])=>key===params.get('state'))?params.get('state')??'open':'open';
  const list=useInfiniteQuery({queryKey:['conversations',principal.principal_id,state],initialPageParam:null as string|null,queryFn:({pageParam,signal})=>conversations.list(state,pageParam,signal),getNextPageParam:p=>p.next_cursor??undefined,enabled:principal.conversation_workspace_enabled});
  useEffect(()=>{onBlockedChange(blocked);return()=>onBlockedChange(false);},[blocked,onBlockedChange]);
  if(!principal.conversation_workspace_enabled)return <p className="state-message">会话工作区尚未开放。</p>;
  const items=list.data?.pages.flatMap(page=>page.items).slice(0,200)??[];
  return <section className="workspace conversation-workspace"><div className="page-title"><div><h1>服务会话</h1><p>按报修人和服务主题核对材料，明确沟通责任。</p></div></div><div className="toolbar"><label>会话范围<select aria-label="会话范围" disabled={blocked} value={state} onChange={e=>setParams({state:e.target.value})}>{states.map(([key,label])=><option value={key} key={key}>{label}</option>)}</select></label><button onClick={()=>void list.refetch()}>刷新列表</button></div>
    <div className="conversation-layout"><aside className="conversation-list" aria-label="获权服务会话">{list.isError?<p role="alert">{errorMessage(list.error)}</p>:null}{items.map(item=><article key={item.session.session_id} data-conversation-id={item.session.session_id} className={sessionId===item.session.session_id?'is-selected':''}><Link to={'/conversations/'+item.session.session_id+'?state='+state} onClick={e=>{if(blocked)e.preventDefault();}} aria-current={sessionId===item.session.session_id?'page':undefined}><strong>{item.participant_label}</strong><p>{item.topic}</p><small>{item.channel_label} · {item.assignment.assigned_display_name??'待分配沟通人'}</small></Link></article>)}{!list.isPending&&!list.isError&&!items.length?<p>当前范围暂无获权服务会话。</p>:null}{list.hasNextPage?<button disabled={list.isFetchingNextPage||items.length>=200} onClick={()=>void list.fetchNextPage()}>加载下一页</button>:null}</aside>
      {sessionId?<SelectedConversation key={principal.principal_id+':'+sessionId} principal={principal} id={sessionId} onBlockedChange={setBlocked}/>:<p className="empty">选择一个服务主题查看材料与沟通操作。</p>}
    </div></section>;
}

