import {SearchControls,criteriaFromUrl,useWorkbenchSearch,searchEmptyMessage} from '../features/search/WorkbenchSearch';
import {SEARCH_KEYS,searchCriteriaKey,searchParameters} from '../../../../src/workbench-search-contracts.mjs';
import type {WorkbenchSearchCriteria} from '../../../../contracts/workbench_search_contracts';
import {BoardActions,BoardActionCard,BoardDropColumn,BoardActionNotice} from '../features/board-actions/BoardActions';
import {readBoardIntent} from '../features/board-actions/intent';
import {WorkbenchReminders} from '../features/reminders/WorkbenchReminders';
import {ItemFollow} from '../features/item-follow/ItemFollow';
import {NotificationExceptions} from '../features/notification-exceptions/NotificationExceptions';
import {TicketWaitingActions} from '../features/ticket-waiting/TicketWaitingActions';
import {useEffect,useRef,useState} from 'react';
import type {KeyboardEvent,MouseEvent,ReactNode} from 'react';
import {Link,Route,Routes,useLocation,useNavigate,useParams,useSearchParams} from 'react-router';
import {useInfiniteQuery,useQuery,useMutation,useQueryClient} from '@tanstack/react-query';
import {Button} from '@heroui/react/button';
import {LayoutGrid,List,MessageSquare,TriangleAlert,Bell,BookOpen,Settings,ChevronDown,ChevronUp,ArrowUpRight,RefreshCw,ArrowLeft,X,LifeBuoy,Search} from 'lucide-react';
import {MorphIcon} from 'morphicons/react';
import {PanelLeftClose as CollapseData,PanelLeftOpen as ExpandData} from 'lucide';
import {createColumnHelper,tableFeatures,useTable} from '@tanstack/react-table';
import {api,ApiError,errorMessage,statusLabels} from '../api/client';
import type {BoardColumn,CompletionRange,WorkbenchCard,Principal} from '../api/client';
import {useUiStore} from './ui-store';
import {TicketNotes} from '../features/ticket-notes/TicketNotes';
import {clearSessionAuthorization,clearSessionView,clearItemView,clearTicketUnassignView,clearTicketTakeoverView,clearTicketReturnView} from './authorization';
import {subscribeDrafts} from '../features/drafts/encrypted-drafts';
import {TicketSelfHandling} from '../features/ticket-handling/TicketSelfHandling';
import {TicketConversationHandling} from '../features/ticket-handling/TicketConversationHandling';
import {TicketCompletion} from '../features/ticket-completion/TicketCompletion';
import {TicketTakeoverCompletion} from '../features/ticket-takeover-completion/TicketTakeoverCompletion';
import {TicketAssignmentHistory} from '../features/assignment-history/TicketAssignmentHistory';
import {TicketRoundNotifications} from '../features/ticket-round-notifications/TicketRoundNotifications';
import {TicketReopen} from '../features/ticket-reopen/TicketReopen';
import {SharedFollowUp} from '../features/follow-up/SharedFollowUp';
import {TicketAssignment} from '../features/ticket-assignment/TicketAssignment';
import {TicketTakeover} from '../features/ticket-takeover/TicketTakeover';
import {TicketUnassign} from '../features/ticket-unassign/TicketUnassign';
import {TicketReturnToDispatch} from '../features/ticket-return-to-dispatch/TicketReturnToDispatch';
import {AttachmentSection} from '../features/attachments/AttachmentSection';
import {GroupNameEditor} from '../features/source-groups/GroupNameEditor';
import {SourceGroupDirectory} from '../features/source-groups/SourceGroupDirectory';
import {Conversations,ItemConversations} from '../features/conversations/Conversations';
import {IncidentCandidates} from '../features/incident-candidates/IncidentCandidates';
import {CandidateDetailPage} from '../features/incident-candidates/CandidateDetail';
import {IncidentResultPage} from '../features/incident-candidates/IncidentResult';
import {ReviewWorkspace} from '../features/manual-review/ReviewWorkspace';
import {PersonalReadMaterial} from '../features/personal-read/PersonalReadMaterial';
import {SupplementFollowUp,SupplementFollowUpSummary} from '../features/supplement-follow-up/SupplementFollowUp';
import {ManualReportEntry,ManualReportForm} from '../features/manual-report/ManualReportForm';
import {useManualReportAuthority} from '../features/manual-report/use-manual-report-draft';
import {ActivityPeople} from '../features/activity/ActivityPeople';
import {useWorkbenchRealtime,realtimeLabels} from '../realtime/useRealtime';
import type {RealtimeView} from '../realtime/useRealtime';

const names:Record<BoardColumn,string>={pending:'待受理',active:'处理中',closed:'已关闭'};
const columns:readonly BoardColumn[]=['pending','active','closed'];
const statusColors:Record<string,string>={NEW:'yellow',QUEUED:'yellow',ACCEPTED:'yellow',PENDING:'yellow',RECEIVED:'yellow',WAITING_TRIAGE:'yellow',REOPENED:'orange',WAITING_DESCRIPTION:'orange',WAITING_REQUESTER:'orange',IN_PROGRESS:'blue',WAITING_VENDOR:'blue',CLOSED:'green',RESOLVED:'green',FAILED:'red'};
function useColumn(principal:Principal,column:BoardColumn,range:CompletionRange,scope?:'team'|'related',enabled=true){
  return useInfiniteQuery({queryKey:['board',principal.principal_id,column,range,...(scope?[scope,principal.authorization_revision,principal.expires_epoch_ms]:[])],initialPageParam:null as string|null,
    enabled,queryFn:({pageParam,signal})=>api.board(column,range,pageParam,signal,scope),getNextPageParam:p=>p.next_cursor??undefined});
}
function useClock(){
  const [now,setNow]=useState(Date.now);
  useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),60_000);return()=>window.clearInterval(timer);},[]);
  return now;
}
function relativeTime(value:string,now:number){
  // API timestamps are Asia/Shanghai local time; never parse in the browser's local timezone.
  const elapsed=now-Date.parse(value.replace(' ','T')+'+08:00');
  if(!Number.isFinite(elapsed)||elapsed<0)return value.slice(5,16);
  const minutes=Math.floor(elapsed/60_000);
  if(minutes===0)return '刚刚';
  if(minutes<60)return minutes+' 分钟前';
  const hours=Math.floor(minutes/60),rest=minutes%60;
  if(hours<24)return hours+' 小时'+(rest?' '+rest+' 分':'')+'前';
  return Math.floor(hours/24)+' 天前';
}
function Message({text,retry}:{text:string;retry?:()=>void}){
  return <div className="state-message" role="status"><TriangleAlert size={18}/><p>{text}</p>{retry?<Button variant="secondary" onPress={retry}>重新读取</Button>:null}</div>;
}
function itemLink(item:Pick<WorkbenchCard,'kind'|'id'>,search:string){
  const parameters=new URLSearchParams(search);if(parameters.has('locate')){parameters.delete('locate');search=parameters.size?'?'+parameters:'';}
  return '/items/'+item.kind+'/'+item.id+search;
}
function Status({item}:{item:WorkbenchCard}){
  return <><span className={'status-chip '+(statusColors[item.status]??'gray')}>{statusLabels[item.status]??item.status}</span>{item.kind==='ticket'&&item.review_reason?<span className="status-chip yellow">待复核</span>:null}</>;
}
function TeamAvatar({name}:{name:string}){
  let color=0;for(const character of name)color=(color*31+(character.codePointAt(0)??0))>>>0;
  return <span aria-hidden="true" className={'avatar av'+(color%4+1)}>{Array.from(name).at(-1)}</span>;
}
function Owner({name,compact=false}:{name:string|null;compact?:boolean}){
  return <span className="owner">{name?<TeamAvatar name={name}/>:<span aria-hidden="true" className="avatar unassigned"/>}<span className="owner-name">{name??(compact?'未领取':'等待领取')}</span></span>;
}
function trapDialogFocus(event:KeyboardEvent<HTMLDialogElement>){
  if(event.key!=='Tab')return;
  const controls=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')).filter(element=>element.getClientRects().length>0);
  const first=controls[0],last=controls.at(-1);
  if(!first||!last)return;
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
}
function SharedFollowUpSummary({value}:{value:WorkbenchCard['follow_up_schedule']}){
  if(!value)return null;
  return <p className={'shared-follow-up-summary'+(value.is_due?' is-due':'')}>
    <strong>共享跟进 · {value.is_due?'已到期':'已安排'}</strong>
    <time dateTime={value.due_at.replace(' ','T')+'+08:00'}>{value.due_at}（北京时间）</time>
  </p>;
}
function Card({item,search,selected,now,located=false}:{item:WorkbenchCard;search:string;selected:boolean;now:number;located?:boolean}){
  return <article className={'ticket-card '+(selected?'is-selected':'')} data-kind={item.kind} data-item-id={item.id} data-reminder-located={located?'true':undefined}>
    <BoardActionCard item={item}><Link draggable={false} className="card-open" to={itemLink(item,search)} state={{fromBoard:true}}>
      <div className="card-top"><span>{item.number}</span></div>
      <h3>{item.title}</h3>
      <p className="card-meta" title={(item.location??'位置未提供')+' · '+(item.reporter_name??'报修人资料未提供')}>{item.location??'位置未提供'} · {item.reporter_name??'报修人资料未提供'}</p>
      <div className="card-tags"><Status item={item}/><span className="neutral-chip" title={item.source_label}>{item.source_label}</span></div>
      <SharedFollowUpSummary value={item.follow_up_schedule}/><SupplementFollowUpSummary pending={item.supplement_follow_up?.has_pending_supplements}/>
      <footer className="card-footer"><Owner name={item.assignee_name}/><time className="activity-time" dateTime={item.updated_at.replace(' ','T')+'+08:00'} title={'最新活动：'+item.updated_at+'（北京时间）'}>更新 {relativeTime(item.updated_at,now)}</time></footer>
      <span className="sr-only">查看详情</span>
    </Link></BoardActionCard>
  </article>;
}
function More({expanded,count,onClick,controls}:{expanded:boolean;count:number;onClick:()=>void;controls:string}){
  return count>3?<button className="column-more" data-action="expand-column" aria-expanded={expanded} aria-controls={controls} onClick={onClick}>{expanded?<ChevronUp size={14}/>:<ChevronDown size={14}/>}<span>{expanded?'收起':('还有 '+(count-3)+' 项')}</span><span className="sr-only">（当前已加载范围）</span></button>:null;
}
const tableFeaturesForWork=tableFeatures({});
const tableHelper=createColumnHelper<typeof tableFeaturesForWork,WorkbenchCard>();
function WorkList({items,search,selected,now,column,label}:{items:WorkbenchCard[];search:string;selected:string|undefined;now:number;column:BoardColumn;label:string}){
  const [expanded,setExpanded]=useState(false),visible=expanded?items:items.slice(0,3);
  const tableColumns=tableHelper.columns([
    tableHelper.accessor('number',{header:'编号'}),
    tableHelper.accessor('title',{header:'问题',cell:({row})=><><Link className="row-link" to={itemLink(row.original,search)} state={{fromBoard:true}} title={row.original.title}>{row.original.title}<span className="sr-only">查看详情</span></Link><SharedFollowUpSummary value={row.original.follow_up_schedule}/><SupplementFollowUpSummary pending={row.original.supplement_follow_up?.has_pending_supplements}/></>}),
    tableHelper.accessor('status',{header:'状态',cell:({row})=><Status item={row.original}/>}),
    tableHelper.accessor('source_label',{header:'来源',cell:({row})=><span className="neutral-chip">{row.original.source_label}</span>}),
    tableHelper.accessor('location',{header:'位置',cell:({getValue})=>getValue()??'未提供'}),
    tableHelper.accessor('reporter_name',{header:'报修人',cell:({getValue})=>getValue()??'未提供'}),
    tableHelper.accessor('assignee_name',{header:'负责人',cell:({getValue})=><Owner name={getValue()} compact/>}),
    tableHelper.accessor('updated_at',{header:'最新活动',cell:({getValue})=><time className="activity-time" title={getValue()+'（北京时间）'}>{relativeTime(getValue(),now)}</time>}),
  ]);
  const table=useTable({features:tableFeaturesForWork,columns:tableColumns,data:visible,getRowId:row=>row.kind+':'+row.id});
  // Server order and cursors stay authoritative; folding does not claim full-range totals or filtering.
  return <section className="list-group" aria-label={label}><div className="column-heading"><h2 className={'stage-pill '+column}>{label}</h2><span>{items.length} 已加载</span></div>
    <div className="table-wrap" id={'list-'+column}><table className="work-table"><thead>{table.getHeaderGroups().map(group=><tr key={group.id}>{group.headers.map(header=><th scope="col" key={header.id}><table.FlexRender header={header}/></th>)}</tr>)}</thead>
      <tbody>{table.getRowModel().rows.map(row=><tr className={row.original.id===selected?'is-selected':''} key={row.id}>{row.getAllCells().map(cell=><td title={typeof cell.getValue()==='string'?String(cell.getValue()):undefined} key={cell.id}><table.FlexRender cell={cell}/></td>)}</tr>)}</tbody></table></div>
    <More expanded={expanded} count={items.length} controls={'list-'+column} onClick={()=>setExpanded(value=>!value)}/>
  </section>;
}
function Shell({principal,children,navigationBlocked=false,realtime}:{principal:Principal;children:ReactNode;navigationBlocked?:boolean;realtime:RealtimeView}){
  const collapsed=useUiStore(s=>s.sidebarCollapsed),toggle=useUiStore(s=>s.toggleSidebar);
  const client=useQueryClient();
  const logout=useMutation({mutationKey:['session-logout',principal.principal_id],mutationFn:()=>api.logout(principal.csrf_token),
    onSuccess:()=>clearSessionAuthorization(client,principal.principal_id,undefined,'logout','已退出，当前浏览器的恢复副本已清理。'),
    onError:()=>clearSessionAuthorization(client,principal.principal_id,undefined,'logout-unknown','服务器退出結果尚未确认，本地恢复副本已清理；请重新核验会话并查看当前工单事实。')});
  useEffect(()=>{
    if(!principal.draft_recovery_enabled&&!principal.manual_review_draft_recovery_enabled&&!principal.ticket_conversation_draft_recovery_enabled&&!principal.staff_completion_draft_recovery_enabled&&!principal.conversation_draft_recovery_enabled&&!principal.manual_report_draft_recovery_enabled&&!principal.ticket_unassign_draft_recovery_enabled&&!principal.ticket_takeover_draft_recovery_enabled&&!principal.ticket_return_to_dispatch_enabled&&!principal.supplement_follow_up_draft_recovery_enabled&&!principal.logout_enabled)return;
    try{return subscribeDrafts(value=>{
      if(value.principal!==principal.principal_id||value.principal!==client.getQueryData<Principal>(['session'])?.principal_id)return;
      if(value.reason==='logout'||value.reason==='logout-unknown')clearSessionView(client,undefined,value.reason==='logout'?'已退出，当前浏览器的恢复副本已清理。':'退出结果尚未确认，请重新核验会话。');
      else if(value.reason==='revoked'){
        if(value.kind==='ticket'&&value.id&&['waiting-requester','waiting-vendor','waiting-resume','waiting-cancel'].includes(value.purpose??''))void client.invalidateQueries({queryKey:['ticket-command-context',value.principal,value.id]});
        else if(value.kind==='ticket'&&value.id&&value.purpose==='ticket-unassign')void clearTicketUnassignView(client,value.principal,value.id,new ApiError(404,'AUTHORIZATION_REJECTED'));
        else if(value.kind==='ticket'&&value.id&&value.purpose==='ticket-takeover')void clearTicketTakeoverView(client,value.principal,value.id,new ApiError(404,'AUTHORIZATION_REJECTED'));
        else if(value.kind==='ticket'&&value.id&&value.purpose==='ticket-return-to-dispatch')void clearTicketReturnView(client,value.principal,value.id,new ApiError(404,'AUTHORIZATION_REJECTED'));
        else if(value.kind==='ticket'&&value.id&&value.purpose==='supplement-disposition')void client.cancelQueries({queryKey:['ticket-supplement-follow-up',value.principal,value.id]},{revert:false});
        else if(value.kind==='review'&&value.id&&value.purpose==='review-resolve-start'){const queryKey=['review-start-context',value.principal,value.id];void client.cancelQueries({queryKey,exact:true},{revert:false});client.getQueryCache().find({queryKey,exact:true})?.setState({data:undefined,dataUpdatedAt:0,error:new ApiError(404,'AUTHORIZATION_REJECTED'),status:'error',fetchStatus:'idle'});}
        else if(value.kind==='ticket'&&value.id&&(value.purpose==='supplement-reply'||/^sr-[a-z]{55}$/u.test(value.purpose??'')))void client.invalidateQueries({queryKey:['supplement-reply-sessions',value.principal,value.id]});
        else if(value.kind&&value.id)void clearItemView(client,value.principal,value.kind,value.id,new ApiError(404,'AUTHORIZATION_REJECTED'));
        else clearSessionView(client,undefined,'会话需要重新核验，恢复副本已清理。');
      }
    });}catch{return;}
  },[client,principal.principal_id,principal.draft_recovery_enabled,principal.manual_review_draft_recovery_enabled,principal.ticket_conversation_draft_recovery_enabled,principal.staff_completion_draft_recovery_enabled,principal.conversation_draft_recovery_enabled,principal.manual_report_draft_recovery_enabled,principal.ticket_unassign_draft_recovery_enabled,principal.ticket_takeover_draft_recovery_enabled,principal.ticket_return_to_dispatch_enabled,principal.supplement_follow_up_draft_recovery_enabled,principal.logout_enabled]);
  const currentPath=useLocation().pathname,exceptionPage=currentPath.startsWith('/notification-exceptions'),conversationPage=currentPath.startsWith('/conversations'),settings=currentPath.startsWith('/settings/'),canNameGroups=principal.source_group_directory_enabled&&principal.roles.includes('ADMIN');
  const [online,setOnline]=useState(navigator.onLine);
  const guardNavigation=(event:MouseEvent<HTMLAnchorElement>)=>{if(navigationBlocked)event.preventDefault();};
  const transport=principal.realtime_sse_enabled?realtime.status:online?'disabled':'offline';
  useEffect(()=>{const changed=()=>setOnline(navigator.onLine);window.addEventListener('online',changed);window.addEventListener('offline',changed);return()=>{window.removeEventListener('online',changed);window.removeEventListener('offline',changed);};},[]);
  return <div className={'app '+(collapsed?'sidebar-collapsed':'')}><aside className="sidebar" aria-label="主导航"><div className="brand"><span className="brandmark"><LifeBuoy size={18}/></span><strong>医小修</strong><ChevronDown size={14}/></div>
    {principal.workbench_search_enabled?<Link className="sidebar-search" to="/?search=1" aria-disabled={navigationBlocked} onClick={guardNavigation}><Search size={16}/><span>搜索工作区</span></Link>:<button className="sidebar-search" disabled title="全局搜索尚未开放"><Search size={16}/><span>搜索工作区</span><small>预留</small></button>}
    <p className="nav-label">工作空间</p><Link className={'nav-item '+(!settings&&!conversationPage&&!exceptionPage?'current':'')} to="/" aria-current={!settings&&!conversationPage&&!exceptionPage?'page':undefined} aria-disabled={navigationBlocked} onClick={guardNavigation} title="工作台"><LayoutGrid/><span>工作台</span></Link>
    <>{principal.conversation_workspace_enabled?<Link className={"nav-item "+(conversationPage?"current":"")} to="/conversations" aria-current={conversationPage?"page":undefined} aria-disabled={navigationBlocked} onClick={guardNavigation} data-action="open-conversations"><MessageSquare/><span>会话</span></Link>:<div className="nav-item muted" title="会话 · 尚未开放"><MessageSquare/><span>会话</span><small>后续</small></div>}</>{principal.incident_candidate_workspace_enabled?<Link className="nav-item" to="/incidents/candidates" data-action="open-incident-candidates" aria-disabled={navigationBlocked} onClick={guardNavigation}><TriangleAlert/><span>公共故障</span></Link>:<div className="nav-item muted" title="公共故障候选尚未启用"><TriangleAlert/><span>公共故障</span><small>未启用</small></div>}<div className="nav-item muted" title="团队知识库 · 规划中"><BookOpen/><span>团队知识库</span><small>规划中</small></div><>{principal.notification_exceptions_enabled?<Link className={"nav-item "+(exceptionPage?"current":"")} to="/notification-exceptions" data-action="open-notification-exceptions" aria-disabled={navigationBlocked} onClick={guardNavigation}><Bell/><span>通知异常</span></Link>:<div className="nav-item muted" title="通知异常尚未启用"><Bell/><span>通知异常</span><small>未启用</small></div>}</>
    <div className="sidebar-note">共同协作，清楚交接。</div><div className="sidebar-bottom">{canNameGroups?<Link className={'nav-item '+(settings?'current':'')} aria-current={settings?'page':undefined} aria-disabled={navigationBlocked} onClick={guardNavigation} to="/settings/source-groups" data-action="open-source-groups"><Settings/><span>设置</span></Link>:<div className="nav-item muted" title="设置"><Settings/><span>设置</span></div>}<div className="account"><TeamAvatar name={principal.display_name}/><div><strong>{principal.display_name}</strong><small>已授权内部身份</small></div></div></div></aside>
    <main><header className="topbar"><button className="icon-button" aria-label={collapsed?'展开侧栏':'收起侧栏'} onClick={toggle}><MorphIcon icon={collapsed?ExpandData:CollapseData} size={18} reducedMotion="user"/></button><span>信息服务团队 <span className="slash">/</span> <strong>{settings?'设置':conversationPage?'服务会话':exceptionPage?'通知异常':'工作台'}</strong></span><span data-realtime-status={transport} className={'connection '+(transport==='offline'?'offline':'')} title={realtime.lastReadAt?'最近成功读取：'+new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(realtime.lastReadAt):'等待授权事实读取'}>{principal.realtime_sse_enabled?realtimeLabels[transport]:online?'按需读取':'网络已断开'}</span>{canNameGroups?<Link to="/settings/source-groups" className="compact-settings" aria-disabled={navigationBlocked} onClick={guardNavigation}>来源群</Link>:null}<a href="/workbench" aria-disabled={navigationBlocked} onClick={guardNavigation}>旧管理端<ArrowUpRight size={14}/></a>{principal.logout_enabled?<button type="button" data-action="logout-workbench" disabled={logout.isPending} onClick={()=>logout.mutate()}>{logout.isPending?'正在退出…':'退出工作台'}</button>:null}</header><WorkbenchReminders principal={principal} realtime={realtime} navigationBlocked={navigationBlocked}/>{children}</main></div>;
}
function Detail({principal,items,now,fullPage,onNavigationBlocked}:{principal:Principal;items:WorkbenchCard[];now:number;fullPage:boolean;onNavigationBlocked:(blocked:boolean)=>void}){
  const [internalNoteBlocked,setInternalNoteBlocked]=useState(false),[groupBlocked,setGroupBlocked]=useState(false),[handlingBlocked,setHandlingBlocked]=useState(false),[reviewBlocked,setReviewBlocked]=useState(false),[completionBlocked,setCompletionBlocked]=useState(false),[assignmentBlocked,setAssignmentBlocked]=useState(false),[takeoverBlocked,setTakeoverBlocked]=useState(false),[takeoverCompletionBlocked,setTakeoverCompletionBlocked]=useState(false),[unassignBlocked,setUnassignBlocked]=useState(false),[returnBlocked,setReturnBlocked]=useState(false),[waitingBlocked,setWaitingBlocked]=useState(false);
  const [reopenBlocked,setReopenBlocked]=useState(false),[followUpBlocked,setFollowUpBlocked]=useState(false),[itemFollowBlocked,setItemFollowBlocked]=useState(false),[supplementBlocked,setSupplementBlocked]=useState(false);
  const commandsBlocked=internalNoteBlocked||groupBlocked||handlingBlocked||reviewBlocked||completionBlocked||assignmentBlocked||takeoverBlocked||takeoverCompletionBlocked||unassignBlocked||returnBlocked||waitingBlocked||reopenBlocked||followUpBlocked||itemFollowBlocked||supplementBlocked;
  useEffect(()=>{onNavigationBlocked(commandsBlocked);return()=>onNavigationBlocked(false);},[commandsBlocked,onNavigationBlocked]);
  const {kind='',id=''}=useParams(),navigate=useNavigate(),location=useLocation(),dialog=useRef<HTMLDialogElement>(null),previousFocus=useRef<HTMLElement|null>(null),pageHeading=useRef<HTMLHeadingElement>(null);
  const routeState:unknown=location.state;
  const route=routeState&&typeof routeState==='object'?routeState as Record<string,unknown>:null;
  const parsedBoardIntent=readBoardIntent(route?.boardActionIntent);
  // This is the existing presentation intent, not current authority to submit.
  // Closing T42 cannot discard an already-open original command's protection.
  const boardIntent=parsedBoardIntent?.kind===kind&&parsedBoardIntent.id===id?parsedBoardIntent:null;
  const selectors=['.ticket-self-handling','.ticket-conversation-handling','.ticket-takeover','.ticket-completion','.ticket-takeover-completion','.ticket-reopen','[data-review-workspace]'];
  const boardSelector=typeof route?.boardActionSelector==='string'&&selectors.includes(route.boardActionSelector)?route.boardActionSelector:'';
  const boardMode=Boolean(boardIntent&&boardSelector),[cancelledBoardIntent,setCancelledBoardIntent]=useState<string|null>(null),boardIntentKey=boardIntent?JSON.stringify(boardIntent):'';
  const result=useInfiniteQuery({queryKey:['detail',principal.principal_id,kind,id],initialPageParam:null as string|null,
    queryFn:({pageParam,signal})=>api.detail(kind,id,pageParam,signal),getNextPageParam:p=>p.next_cursor??undefined});
  const close=()=>{if(commandsBlocked)return;const search=new URLSearchParams(location.search);search.delete('detail');if(!fullPage&&location.state&&typeof location.state==='object'&&'fromBoard' in location.state&&location.state.fromBoard===true)void navigate(-1);else void navigate('/'+(search.size?'?'+search:'') ,{replace:true});};
  useEffect(()=>{
    if(fullPage)return;
    previousFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    dialog.current?.showModal();
    return()=>{dialog.current?.close();if(previousFocus.current?.isConnected)previousFocus.current.focus();};
  },[fullPage]);
  const activityRoot=useRef<HTMLDivElement>(null);
  const detail=result.data?.pages[0],records=result.data?.pages.flatMap(p=>p.records)??[];
  // Re-reading an open item must not take focus from an editor or move its target.
  const detailPresent=Boolean(detail);
  useEffect(()=>{if(fullPage&&detailPresent)pageHeading.current?.focus();},[fullPage,detailPresent,kind,id]);
  const index=items.findIndex(item=>item.kind===kind&&item.id===id),previous=index>0?items[index-1]:undefined,next=index>=0?items[index+1]:undefined;
  const move=(item:WorkbenchCard|undefined)=>{if(item&&!commandsBlocked)void navigate(itemLink(item,location.search),{replace:true,state:location.state});};
  const pageParams=new URLSearchParams(location.search);pageParams.set('detail','page');
  const content=<>
    <div className="detail-navigation"><button className="icon-button" aria-label="关闭详情" title="返回工作台" disabled={commandsBlocked} onClick={close}>{fullPage?<ArrowLeft size={18}/>:<X size={18}/>}</button>
      {!fullPage?<><Link className="icon-button" aria-label="展开完整页面" title="展开完整页面" onClick={event=>{if(commandsBlocked)event.preventDefault();}} to={location.pathname+'?'+pageParams} state={location.state} replace><ArrowUpRight size={18}/></Link><button className="icon-button" aria-label="上一项" title="上一项（已加载范围）" disabled={!previous||commandsBlocked} onClick={()=>move(previous)}><ChevronUp size={18}/></button><button className="icon-button" aria-label="下一项" title="下一项（已加载范围）" disabled={!next||commandsBlocked} onClick={()=>move(next)}><ChevronDown size={18}/></button></>:null}
      <span>事项详情</span>{!fullPage?<Link className="full-page-link" onClick={event=>{if(commandsBlocked)event.preventDefault();}} to={location.pathname+'?'+pageParams} state={location.state} replace>展开完整页面<ArrowUpRight size={14}/></Link>:null}</div>
    {result.isPending?<Message text="正在读取事项详情…"/>:result.isError&&!detail?<Message text={errorMessage(result.error)} retry={()=>{void result.refetch();}}/>:detail?<div className="detail-body" ref={activityRoot}>
      {result.isError?<p role="status" className="confirmed-facts">读取中断，以下为最近已确认资料；连接恢复后重新核验。</p>:null}
      <header className="detail-heading"><div className="context-line">{detail.item.number}<span>· {detail.item.kind==='ticket'?'工单':detail.item.kind==='review'?'未建单复核事项':'未建单受理事项'}</span></div><h2 id="detail-title" ref={pageHeading} tabIndex={fullPage?-1:undefined}>{detail.item.title}</h2></header>
      <ActivityPeople principal={principal} target={{kind:detail.item.kind,id:detail.item.id}} root={activityRoot} readReady={result.isSuccess&&!result.isError}/>
      {boardIntent&&boardSelector&&cancelledBoardIntent!==boardIntentKey?<BoardActionNotice intent={boardIntent} selector={boardSelector} currentColumn={result.isSuccess&&!result.isError?detail.item.column:undefined} onCancel={()=>setCancelledBoardIntent(boardIntentKey)}/>:null}
      <section className="properties" aria-label="事项信息"><dl>
        <dt>状态</dt><dd><Status item={detail.item}/></dd>
        <dt>处理责任</dt><dd><Owner name={detail.responsibility.ticket_assignee_name}/></dd>
        <dt>报修人</dt><dd>{detail.item.reporter_name??'未提供'}</dd>
        <dt>位置</dt><dd>{detail.item.location??'未提供'}</dd>
        <dt>来源</dt><dd><span className="neutral-chip">{detail.item.source_label}</span></dd>
        <dt>沟通责任</dt><dd>{detail.responsibility.conversation_assignees.join('、')||'暂无明确沟通人'}</dd>
        <dt>创建时间</dt><dd>{detail.item.created_at}</dd>
        <dt>最新活动</dt><dd>{detail.item.updated_at}</dd>
        <dt>实际完结</dt><dd>{detail.item.completed_at??'尚无完结事件'}</dd>
      </dl><p>以上时间均为北京时间；最新活动不代表当前环节耗时。</p></section>
      <ItemFollow key={principal.principal_id+':item-follow:'+kind+':'+id} requested={detail.requested_item??{kind:detail.item.kind,id:detail.item.id}} item={detail.item} principal={principal} readReady={result.isSuccess&&!result.isFetching&&!result.isError} onBlockedChange={setItemFollowBlocked}/>
      {principal.source_group_directory_enabled&&principal.roles.includes('ADMIN')&&detail.item.source_group?<GroupNameEditor key={principal.principal_id+':'+detail.item.source_group.ref} group={detail.item.source_group} principal={principal} onBlockedChange={setGroupBlocked}/>:null}
      {detail.item.kind==='ticket'&&principal.ticket_conversation_self_handling_enabled?<TicketConversationHandling boardMode={boardMode} key={principal.principal_id+':conversation-handling:'+detail.item.id} ticketId={detail.item.id} principal={principal} onBlockedChange={setHandlingBlocked}/>:detail.item.kind==='ticket'&&principal.ticket_self_handling_enabled?<TicketSelfHandling boardMode={boardMode} key={principal.principal_id+':handling:'+detail.item.id} ticketId={detail.item.id} principal={principal} onBlockedChange={setHandlingBlocked}/>:null}
      {detail.item.kind==='ticket'&&principal.ticket_takeover_completion_enabled?<TicketTakeoverCompletion boardMode={boardMode} key={principal.principal_id+':takeover-completion:'+detail.item.id} ticketId={detail.item.id} principal={principal} onBlockedChange={setTakeoverCompletionBlocked}/>:null}
      {detail.item.kind==='ticket'&&principal.ticket_staff_completion_enabled?<TicketCompletion boardMode={boardMode} key={principal.principal_id+':completion:'+detail.item.id} ticketId={detail.item.id} principal={principal} onBlockedChange={setCompletionBlocked}/>:null}
      {detail.item.kind==='ticket'?<SharedFollowUp key={principal.principal_id+':follow-up:'+detail.item.id} ticketId={detail.item.id} principal={principal} onBlockedChange={setFollowUpBlocked}/>:null}
      {detail.item.kind==='ticket'&&principal.assignment_history_enabled?<TicketAssignmentHistory key={principal.principal_id+':history:'+detail.item.id} ticketId={detail.item.id} principal={principal}/>:null}
      {detail.item.kind==='ticket'&&principal.ticket_round_notifications_enabled?<TicketRoundNotifications key={principal.principal_id+':round-notifications:'+detail.item.id} ticketId={detail.item.id} principalId={principal.principal_id}/>:null}
      {detail.item.kind==='ticket'?<TicketReopen boardMode={boardMode} key={principal.principal_id+':reopen:'+detail.item.id} ticketId={detail.item.id} principal={principal} onBlockedChange={setReopenBlocked}/>:null}
      {detail.item.kind==='ticket'&&principal.ticket_takeover_enabled?<TicketTakeover boardMode={boardMode} key={principal.principal_id+':takeover:'+detail.item.id} ticketId={detail.item.id} principal={principal} onBlockedChange={setTakeoverBlocked}/>:null}
      {detail.item.kind==='ticket'&&principal.ticket_assignment_enabled?<TicketAssignment key={principal.principal_id+':assignment:'+detail.item.id} ticketId={detail.item.id} principal={principal} onBlockedChange={setAssignmentBlocked}/>:null}
      {detail.item.kind==='ticket'?<TicketReturnToDispatch key={principal.principal_id+':return-to-dispatch:'+detail.item.id} ticketId={detail.item.id} principal={principal} onBlockedChange={setReturnBlocked}/>:null}
      {detail.item.kind==='ticket'&&principal.ticket_unassign_enabled?<TicketUnassign key={principal.principal_id+':unassign:'+detail.item.id} ticketId={detail.item.id} principal={principal} onBlockedChange={setUnassignBlocked}/>:null}
      {detail.item.kind==='ticket'?<TicketWaitingActions key={principal.principal_id+':waiting:'+detail.item.id} ticketId={detail.item.id} principal={principal} onBlockedChange={setWaitingBlocked}/>:null}
      {detail.item.kind==='ticket'&&principal.internal_notes_enabled?<TicketNotes key={principal.principal_id+':internal-note:'+detail.item.id} ticketId={detail.item.id} principal={principal} onBlockedChange={setInternalNoteBlocked}/>:null}
      {detail.item.kind==='ticket'&&principal.supplement_follow_up_enabled?<SupplementFollowUp key={principal.principal_id+':supplement:'+detail.item.id} ticketId={detail.item.id} principal={principal} readReady={result.isSuccess&&!result.isFetching&&!result.isError} onBlockedChange={setSupplementBlocked}/>:null}
      <ItemConversations principal={principal} kind={detail.item.kind} id={detail.item.id}/>
      {principal.manual_review_enabled?<ReviewWorkspace key={'manual-review:'+principal.principal_id+':'+kind+':'+id} principal={principal} item={detail.item} requested={{kind:kind as WorkbenchCard['kind'],id}} refs={detail.review_refs??[]} onBlockedChange={setReviewBlocked}/>:null}
      <AttachmentSection key={principal.principal_id+':'+detail.item.kind+':'+detail.item.id} principal={principal.principal_id} kind={detail.item.kind} id={detail.item.id}/>
      <p className="read-only-note">其他已开放的处理操作可使用 <a href="/workbench">旧管理端</a>。</p>
      <section className="detail-main"><h3>报修内容</h3><p className="description">{detail.description??'暂无可读取的原始报修内容。'}</p><h3 className="activity-title">动态 <span>{records.length} 条已加载</span></h3>
        <ol className="activity-list">{records.map(record=><li key={record.id}>{record.audience!=='REPORT'&&record.actor&&record.actor!=='SYSTEM'?<TeamAvatar name={record.actor}/>:<span className="avatar" aria-hidden="true">{record.audience==='REPORT'?'报':'系'}</span>}<div><header><strong>{record.actor??(record.audience==='REPORT'?'报修材料':'系统记录')}</strong><time title={record.at+'（北京时间）'}>{relativeTime(record.at,now)}</time><span className="record-type">{record.audience==='INTERNAL'?'内部记录':record.audience==='EXTERNAL'?'对外摘要':'原始报修'}</span></header>{record.read_material?<PersonalReadMaterial principal={principal} item={{kind:detail.item.kind,id:detail.item.id}} sourceRef={record.read_material.source_ref} revision={record.read_material.revision} text={record.text}/>:<p>{record.text??(record.new_status?(statusLabels[record.old_status??'']??record.old_status??'新建')+' → '+(statusLabels[record.new_status]??record.new_status):record.type)}</p>}</div></li>)}</ol>
        {!records.length?<p className="empty">暂无可读取的活动记录。</p>:null}{result.hasNextPage?<Button variant="secondary" isDisabled={result.isFetchingNextPage} onPress={()=>{void result.fetchNextPage();}}>加载更早记录</Button>:<p className="column-end">当前范围的记录已加载完毕</p>}</section>
    </div>:null}
  </>;
  if(fullPage)return <article className="detail-page" aria-labelledby="detail-title">{content}</article>;
  return <dialog className="detail-dialog" ref={dialog} aria-labelledby={detail?'detail-title':undefined} aria-label={detail?undefined:'事项详情'} onKeyDown={trapDialogFocus} onCancel={event=>{event.preventDefault();close();}} onClick={event=>{if(event.target===event.currentTarget){const bounds=event.currentTarget.getBoundingClientRect();if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)close();}}}>{content}</dialog>;
}
interface ColumnQuery {
 isPending:boolean;isError:boolean;error:unknown;isFetchingNextPage:boolean;hasNextPage:boolean;
 data:{pages:{items:WorkbenchCard[];range:{mode:CompletionRange;from:string;until:string;timezone:'Asia/Shanghai'}}[]}|undefined;
 refetch:()=>Promise<unknown>;fetchNextPage:()=>Promise<unknown>;
}
function BoardSection({query,column,label,search,selected,now,loaded}:{query:ColumnQuery;column:BoardColumn;label:string;search:string;selected:string|undefined;now:number;loaded:WorkbenchCard[]}){
  const [expanded,setExpanded]=useState(false),visible=expanded?loaded:loaded.slice(0,3);
  return <BoardDropColumn column={column}><section className={'board-column '+column} aria-label={label}><div className="column-heading"><h2 className={'stage-pill '+column}>{label}</h2><span>{query.isError?'—':loaded.length} 已加载</span></div>
    {query.isPending?<Message text="正在读取…"/>:query.isError&&!query.data?<Message text={errorMessage(query.error)} retry={()=>{void query.refetch();}}/>:<>{query.isError?<p role="status" className="confirmed-facts">连接中断，显示最近已确认资料。</p>:null}<div className="column-cards" id={'cards-'+column}>{visible.map(item=><Card key={item.kind+item.id} item={item} search={search} selected={item.id===selected} now={now}/>)}{!loaded.length?<p className="empty">当前授权范围内暂无事项</p>:null}</div><More expanded={expanded} count={loaded.length} controls={'cards-'+column} onClick={()=>setExpanded(value=>!value)}/></>}
    {!query.isError&&!query.isPending?(query.hasNextPage?<Button className="load-more" variant="tertiary" isDisabled={query.isFetchingNextPage} onPress={()=>{void query.fetchNextPage();}}>加载下一页</Button>:null):null}
  </section></BoardDropColumn>;
}
function Workbench({principal,realtime}:{principal:Principal;realtime:RealtimeView}){
  const [navigationBlocked,setNavigationBlocked]=useState(false);
  const order=useRef<{scope:string;keys:string[]}>({scope:'',keys:[]});
  const [params,setParams]=useSearchParams(),location=useLocation(),selected=useParams(),now=useClock(),navigate=useNavigate();
  const locationMode=Boolean(selected.id&&params.get('locate')==='1');
  const validLocation=Boolean(principal.workbench_reminders_enabled&&locationMode&&['ticket','review','intake'].includes(selected.kind??'')&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(selected.id??''));
  const view=params.get('view')==='list'?'list':'board',range:CompletionRange=params.get('range')==='cancelled'?'cancelled':params.get('range')==='all'?'all':principal.workbench_search_enabled&&params.get('search')==='1'&&!params.has('range')?'all':'recent',fullPage=Boolean(!locationMode&&selected.id&&params.get('detail')==='page');
  const client=useQueryClient();
  const located=useQuery({queryKey:['reminder-locate',principal.principal_id,selected.kind,selected.id,principal.authorization_revision,principal.expires_epoch_ms],enabled:validLocation,retry:false,gcTime:0,
    queryFn:({signal})=>api.detail(selected.kind??'',selected.id??'',null,signal)});
  useEffect(()=>{const error=located.error;if(!(error instanceof ApiError)||![401,403,404].includes(error.status))return;
    if(error.status===401)void clearSessionAuthorization(client,principal.principal_id,401,'revoked');
    else void clearItemView(client,principal.principal_id,selected.kind,selected.id,error);
  },[located.error,client,principal.principal_id,selected.kind,selected.id]);
  const locatedItem=validLocation&&located.isSuccess&&!located.isFetching?located.data.item:null;
  const locatedSection=useRef<HTMLElement|null>(null),scrolledLocation=useRef('');
  useEffect(()=>{
    if(!locationMode){scrolledLocation.current='';return;}
    if(!locatedItem)return;const key=locatedItem.kind+':'+locatedItem.id;
    if(scrolledLocation.current!==key){scrolledLocation.current=key;locatedSection.current?.scrollIntoView({block:'nearest',behavior:'auto'});}
  },[locationMode,locatedItem?.kind,locatedItem?.id]);
  const scope: 'team'|'related'|undefined=principal.workbench_follow_enabled?(params.get('scope')==='related'?'related':'team'):undefined;
  const searchRequested=params.get('search')==='1',searchMode=principal.workbench_search_enabled===true&&searchRequested;
  const parsed=criteriaFromUrl(params,params.has('range')?range:'all',scope??'team'),searchKey=parsed.criteria?searchCriteriaKey(parsed.criteria):'invalid';
  const searched=useWorkbenchSearch(principal,parsed.criteria,searchMode);
  const basePending=useColumn(principal,'pending',range,scope,!searchMode),baseActive=useColumn(principal,'active',range,scope,!searchMode),baseClosed=useColumn(principal,'closed',range,scope,!searchMode);
  const searchedColumn=(column:BoardColumn):ColumnQuery=>({...searched,isFetchingNextPage:searched.isFetching,
    data:searched.isError||parsed.error?undefined:searched.data?{pages:searched.data.pages.map(page=>({items:page.items.filter(item=>item.column===column),range:page.range}))}:undefined,
    refetch:searched.restart,fetchNextPage:()=>searched.isFetching?Promise.resolve():searched.fetchNextPage()});
  const pending:ColumnQuery=searchMode?searchedColumn('pending'):basePending,active:ColumnQuery=searchMode?searchedColumn('active'):baseActive,closed:ColumnQuery=searchMode?searchedColumn('closed'):baseClosed;
  const queries=[pending,active,closed],items=queries.flatMap(query=>query.data?.pages.flatMap(page=>page.items)??[]),fresh=[...new Map(items.map(item=>[item.kind+':'+item.id,item])).values()];
  let unique=fresh;
  const holdOrder=principal.realtime_sse_enabled&&Boolean(selected.id)&&!fullPage&&!locationMode;
  if(holdOrder){
    const orderingScope=JSON.stringify([principal.principal_id,principal.authorization_revision,range,view,scope,selected.kind,selected.id,searchMode?searchKey:null]),keys=fresh.map(item=>item.kind+':'+item.id),present=new Set(keys);
    if(order.current.scope!==orderingScope)order.current={scope:orderingScope,keys};
    else {const retained=order.current.keys.filter(key=>present.has(key)),known=new Set(retained);order.current.keys=[...retained,...keys.filter(key=>!known.has(key))];}
    // Keep only presentation IDs. Every displayed object still comes from the current authorized GET.
    const rank=new Map(order.current.keys.map((key,index)=>[key,index]));
    unique=[...fresh].sort((a,b)=>(rank.get(a.kind+':'+a.id)??0)-(rank.get(b.kind+':'+b.id)??0));
  }else order.current={scope:'',keys:[]};
  const update=(key:string,value:string)=>{const next=new URLSearchParams(params);next.set(key,value);setParams(next);};
  const refresh=()=>{if(searchMode){if(!searched.isFetching)void searched.restart();}else{void pending.refetch();void active.refetch();void closed.refetch();}};
  const applySearch=(criteria:WorkbenchSearchCriteria)=>{
    const next=new URLSearchParams(params);for(const key of SEARCH_KEYS)next.delete(key);next.delete('cursor');next.delete('limit');
    for(const [key,value]of searchParameters(criteria))next.set(key,value);next.set('search','1');setParams(next);
  };
  const leaveSearch=()=>{const next=new URLSearchParams(params);for(const key of SEARCH_KEYS)if(key!=='range'&&key!=='scope')next.delete(key);next.delete('search');next.delete('cursor');next.delete('limit');setParams(next);};
  const completionWindow=closed.data?.pages[0]?.range;
  const until=completionWindow?new Date(Date.parse(completionWindow.until.replace(' ','T')+'Z')-86_400_000).toISOString().slice(5,10):'';
  const label=(column:BoardColumn)=>column==='closed'&&range==='cancelled'?'已取消':names[column];
  const visibleItems=(loaded:WorkbenchCard[])=>locatedItem?loaded.filter(item=>item.kind!==locatedItem.kind||item.id!==locatedItem.id):loaded;
  const returnParameters=new URLSearchParams(params);returnParameters.delete('locate');returnParameters.delete('detail');
  const returnBoard='/'+(returnParameters.size?'?'+returnParameters:'');
  return <Shell principal={principal} realtime={realtime} navigationBlocked={navigationBlocked}><BoardActions principal={principal} blocked={navigationBlocked} selectionKey={location.pathname+location.search} onOpen={({intent,selector})=>{if(!navigationBlocked)void navigate(itemLink(intent,location.search),{state:{fromBoard:true,boardActionIntent:intent,boardActionSelector:selector}});}}>{!fullPage?<div className="workspace"><div className="page-title"><span className="page-icon"><LayoutGrid size={30} strokeWidth={1.6}/></span><div><h1>团队工作台</h1><p>让每一件报修，都有回应。</p></div><span className="read-only-badge">{principal.internal_notes_enabled||principal.ticket_self_handling_enabled||principal.manual_review_enabled||principal.ticket_staff_completion_enabled?'人工协作':'只读'}</span></div>
    {principal.workbench_search_enabled?<SearchControls principal={principal} criteria={parsed.criteria} active={searchMode} loaded={fresh} blocked={navigationBlocked} onApply={applySearch} onLeave={leaveSearch}/>:searchRequested?<p role="status">搜索入口当前关闭，已返回原分页看板。</p>:null}
    {searchMode&&searched.isError?<p role="alert" data-search-state="error">查询未完成，请重新读取。搜索输入仍保留。</p>:null}
    {searchMode&&!parsed.error&&!searched.isPending&&!searched.isError&&searched.data&&unique.length===0?<p role="status" data-search-state="empty">{searchEmptyMessage(parsed.criteria)}</p>:null}
    <div className="toolbar"><div className="scope-tabs">{principal.workbench_follow_enabled?<><button type="button" className={scope==='team'?'selected':''} aria-pressed={scope==='team'} disabled={navigationBlocked} onClick={()=>update('scope','team')}>团队工作</button><button type="button" data-action="related-scope" className={scope==='related'?'selected':''} aria-pressed={scope==='related'} disabled={navigationBlocked} onClick={()=>update('scope','related')}>与我有关</button></>:<><span className="selected">团队工作</span><button disabled title="处理、沟通与关注的完整范围尚未开放">与我有关<small>后续</small></button></>}</div>
      <div className="tools"><ManualReportEntry principal={principal} blocked={navigationBlocked}/><Button variant="tertiary" onPress={refresh}><RefreshCw size={16}/>刷新</Button><div className="view-tabs" role="group" aria-label="展示方式"><button aria-pressed={view==='board'} onClick={()=>update('view','board')}><LayoutGrid size={16}/>看板</button><button aria-pressed={view==='list'} onClick={()=>update('view','list')}><List size={16}/>列表</button></div></div></div>
    <div className="range-bar"><span>{queries.some(query=>query.isError)?'部分事项读取失败':'已加载 '+unique.length+' 项'}</span><span>未完成事项不限日期</span><label>已关闭范围 <select value={range} onChange={event=>update('range',event.target.value)}><option value="recent">今天和昨天</option><option value="all">{searchMode?'全部完结记录（含取消）':'全部完结记录'}</option><option value="cancelled">已取消（全部时间）</option></select></label>
      {completionWindow?<span className="range-caption">{range==='recent'?'已关闭：'+completionWindow.from.slice(5,10)+' – '+until+'（北京时间） · 已解决待确认保留':range==='cancelled'?'第三列仅查看已取消事项':searchMode?'搜索不限完结日期，包含已取消事项':'完结记录不限日期；取消事项另行查看'}</span>:null}</div>
    {locationMode?<section ref={locatedSection} className="reminder-location" aria-label="已定位事项"><div className="column-heading"><h2>已定位事项</h2><Link to={returnBoard}>返回当前工作台</Link></div>
      {!validLocation?<Message text="当前提醒定位不可用，请重新选择有效事项。"/>:located.isFetching||located.isPending?<Message text="正在核验当前事项读取权限…"/>:located.isError?<Message text={located.error instanceof ApiError&&[403,404].includes(located.error.status)?'该事项当前不可读取，旧定位资料已清除。':'本次定位未完成，原定位目标已保留。'} {...(located.error instanceof ApiError&&[401,403,404].includes(located.error.status)?{}:{retry:()=>{void located.refetch();}})}/>:locatedItem?<Card item={locatedItem} search={location.search} selected={true} now={now} located={true}/>:null}
    </section>:null}
    {searchMode&&parsed.error?<Message text={parsed.error}/>:view==='board'?<div className="board">{columns.map((column,index)=>{const query=queries[index];return query?<BoardSection key={column+':'+range+':'+scope+':'+(searchMode?searchKey:'board')} query={query} loaded={visibleItems(holdOrder?unique.filter(item=>item.column===column):query.data?.pages.flatMap(page=>page.items)??[])} column={column} label={label(column)} search={location.search} selected={selected.id} now={now}/>:null;})}</div>:<>
      {columns.map((column,index)=>{const query=queries[index];return query?<div key={column+':'+range+':'+scope+':'+(searchMode?searchKey:'board')}>{query.isPending?<Message text={label(column)+'：正在读取…'}/>:query.isError&&!query.data?<Message text={label(column)+'：'+errorMessage(query.error)} retry={()=>{void query.refetch();}}/>:<>{query.isError?<p role="status" className="confirmed-facts">{errorMessage(query.error)} 显示最近已确认资料。</p>:null}<WorkList column={column} label={label(column)} items={visibleItems(holdOrder?unique.filter(item=>item.column===column):query.data?.pages.flatMap(page=>page.items)??[])} search={location.search} selected={selected.id} now={now}/>{!query.data?.pages.some(page=>page.items.length)?<p className="empty">当前授权范围内暂无事项</p>:null}{query.hasNextPage?<Button className="load-more" variant="tertiary" isDisabled={query.isFetchingNextPage} onPress={()=>{void query.fetchNextPage();}}>加载下一页</Button>:null}</>}</div>:null;})}</>}
    <p className="workspace-footnote">展示当前身份获权的服务记录。打开详情不会接管工单。</p></div>:null}
    {selected.id&&!locationMode?<Detail principal={principal} items={unique} now={now} fullPage={fullPage} onNavigationBlocked={setNavigationBlocked}/>:null}
  </BoardActions></Shell>;
}
function Session(){const failure=useUiStore(s=>s.sessionError),closedNotice=useUiStore(s=>s.sessionClosedNotice),reset=useUiStore(s=>s.reset),location=useLocation();
  const [navigationBlocked,setNavigationBlocked]=useState(false);
  const bootstrap=useQuery({queryKey:['session'],queryFn:({signal})=>api.bootstrap(signal),enabled:failure===null&&closedNotice===null});
  const realtime=useWorkbenchRealtime(failure===null&&closedNotice===null?bootstrap.data:undefined);
  useManualReportAuthority(failure===null&&closedNotice===null?bootstrap.data:undefined);
  if(closedNotice)return <div className="entry-state"><h1>医小修工作台</h1><Message text={closedNotice} retry={reset}/><a href="/workbench">返回现有工作台入口</a></div>;
  if(failure)return <div className="entry-state"><h1>医小修工作台</h1><Message text={failure===401?'会话已失效，请重新进入已授权工作台。':'当前身份没有查看权限。'} retry={reset}/><a href="/workbench">返回现有工作台入口</a></div>;
  if(bootstrap.isPending)return <div className="entry-state"><Message text="正在核验内部会话…"/></div>;
  if(bootstrap.isError&&!bootstrap.data)return <div className="entry-state"><h1>医小修工作台</h1><Message text={errorMessage(bootstrap.error)} retry={()=>{void bootstrap.refetch();}}/><a href="/workbench">返回现有工作台入口</a></div>;
  if(/^\/reports\/new\/?$/iu.test(location.pathname))return <Shell principal={bootstrap.data} realtime={realtime} navigationBlocked={navigationBlocked}><ManualReportForm key={bootstrap.data.principal_id+':'+bootstrap.data.authorization_revision} principal={bootstrap.data} onBlockedChange={setNavigationBlocked}/></Shell>;
  if(/^\/conversations(?:\/[^/]+)?\/?$/iu.test(location.pathname))return <Shell principal={bootstrap.data} realtime={realtime} navigationBlocked={navigationBlocked}><Conversations key={bootstrap.data.principal_id} principal={bootstrap.data} onBlockedChange={setNavigationBlocked}/></Shell>;
  if(/^\/incidents\/candidates\/?$/iu.test(location.pathname))return <Shell principal={bootstrap.data} realtime={realtime} navigationBlocked={navigationBlocked}><IncidentCandidates principal={bootstrap.data}/></Shell>;
  if(/^\/notification-exceptions\/?$/iu.test(location.pathname))return <Shell principal={bootstrap.data} realtime={realtime}><NotificationExceptions key={bootstrap.data.principal_id} principal={bootstrap.data}/></Shell>;
  if(/^\/incidents\/candidates\/[^/]+\/?$/iu.test(location.pathname))return <Shell principal={bootstrap.data} realtime={realtime} navigationBlocked={navigationBlocked}><CandidateDetailPage principal={bootstrap.data} onBlockedChange={setNavigationBlocked}/></Shell>;
  if(/^\/incidents\/[^/]+\/?$/iu.test(location.pathname))return <Shell principal={bootstrap.data} realtime={realtime} navigationBlocked={navigationBlocked}><IncidentResultPage principal={bootstrap.data} onBlockedChange={setNavigationBlocked}/></Shell>;
  return /^\/settings\/source-groups\/?$/iu.test(location.pathname)?<Shell principal={bootstrap.data} realtime={realtime} navigationBlocked={navigationBlocked}><SourceGroupDirectory key={bootstrap.data.principal_id} principal={bootstrap.data} onBlockedChange={setNavigationBlocked}/></Shell>:<Workbench key={bootstrap.data.principal_id} principal={bootstrap.data} realtime={realtime}/>;
}
export function App(){return <Routes><Route path="/" element={<Session/>}/><Route path="items/:kind/:id" element={<Session/>}/><Route path="settings/source-groups" element={<Session/>}/><Route path="reports/new" element={<Session/>}/><Route path="notification-exceptions" element={<Session/>}/><Route path="conversations" element={<Session/>}/><Route path="conversations/:sessionId" element={<Session/>}/><Route path="incidents/candidates" element={<Session/>}/><Route path="incidents/candidates/:id" element={<Session/>}/><Route path="incidents/:id" element={<Session/>}/><Route path="*" element={<div className="entry-state"><Message text="页面不存在。"/><Link to="/">返回工作台</Link></div>}/></Routes>;}
