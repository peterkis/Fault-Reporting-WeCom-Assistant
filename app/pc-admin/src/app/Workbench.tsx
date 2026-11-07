import {ClosureActionsProvider,RestoreClosedItem,useClosureHighlight} from '../features/ticket-waiting/ClosureActions';
import {SidebarBrand} from './SidebarBrand';
import { Dropdown,Label as HLabel,ListBox } from '@heroui/react';
import { useInfiniteQuery,useMutation,useQuery,useQueryClient } from '@tanstack/react-query';
import { PanelLeftClose as CollapseData,PanelLeftOpen as ExpandData } from 'lucide';
import { Bell,ChevronDown,ChevronsUpDown,ChevronUp,LayoutGrid,List,LogOut,MessageSquare,RefreshCw,Search,Settings,TriangleAlert } from 'lucide-react';
import { MorphIcon } from 'morphicons/react';
import type { MouseEvent,ReactNode } from 'react';
import { useEffect,useRef,useState } from 'react';
import { useLocation,useNavigate,useParams,useSearchParams } from 'react-router';
import type { WorkbenchSearchCriteria } from '../../../../contracts/workbench_search_contracts';
import { SEARCH_KEYS,searchCriteriaKey,searchParameters } from '../../../../shared/workbench-search-contracts.mjs';
import type { BoardColumn,BoardCompletionRange,Principal,WorkbenchCard } from '../api/client';
import { api,ApiError,errorMessage } from '../api/client';
import type { BoardSort,BoardSummaryFilter } from '../design/board-presentation';
import { matchesBoardSummary,sortBoardItems } from '../design/board-presentation';
import { Avatar } from '../design/components/Avatar/Avatar';
import { BoardColumn as BoardColumnView,boardEmptyMessage,BoardGroup } from '../design/components/BoardColumn/BoardColumn';
import { BoardSummary,BoardDatePresets } from '../design/components/BoardSummary/BoardSummary';
import { Button,Button as HButton } from '../design/components/Button/Button';
import { PageHeader } from '../design/components/PageHeader/PageHeader';
import { SegmentedControl } from '../design/components/SegmentedControl/SegmentedControl';
import { SourceLabel } from '../design/components/SourceLabel/SourceLabel';
import {FilterChip} from '../design/components/FilterChip/FilterChip';
import {Shapes,UserRound} from 'lucide-react';
import { StatusBadge } from '../design/components/StatusBadge/StatusBadge';
import { TicketCard,TicketCardBody,TicketCategoryTile,DismissedTicketCardBody } from '../design/components/TicketCard/TicketCard';
import { Toolbar } from '../design/components/Toolbar/Toolbar';
import { WorkTable,orderWorkTableItems } from '../design/components/WorkTable/WorkTable';
import { cardHeat,cardHeatStart } from '../design/heat';
import { cardTags,stagePresentation } from '../design/status-map';
import { useBoardCardMotion } from '../design/use-board-card-motion';
import { WorkbenchEfficiency,EfficiencyEntry } from '../features/efficiency/WorkbenchEfficiency';
import { useBoardArrivals } from '../features/efficiency/use-board-arrivals';
import { useDesktopSession } from '../desktop/host';
import { BoardActionCard,BoardActions,BoardDropColumn } from '../features/board-actions/BoardActions';
import { readServiceCatalog } from '../features/board-filters/client';
import { Conversations } from '../features/conversations/Conversations';
import { conversationSummaryQuery } from '../features/conversations/inbox-client';
import { observeVisibleMinute } from '../design/format-time';
import { Tag } from '../design/components/Tag/Tag';
import { subscribeDrafts } from '../features/drafts/encrypted-drafts';
import { CandidateDetailPage } from '../features/incident-candidates/CandidateDetail';
import { IncidentCandidates } from '../features/incident-candidates/IncidentCandidates';
import { IncidentResultPage } from '../features/incident-candidates/IncidentResult';
import { ManualReportEntry,ManualReportForm } from '../features/manual-report/ManualReportForm';
import { NotificationExceptions } from '../features/notification-exceptions/NotificationExceptions';
import { WorkbenchReminders } from '../features/reminders/WorkbenchReminders';
import { criteriaFromUrl,SearchControls,searchEmptyMessage,useWorkbenchSearch } from '../features/search/WorkbenchSearch';
import { SourceGroupDirectory } from '../features/source-groups/SourceGroupDirectory';
import type { RealtimeView } from '../realtime/useRealtime';
import { realtimeLabels } from '../realtime/useRealtime';
import { clearItemView,clearSessionAuthorization,clearSessionView,clearTicketReturnView,clearTicketTakeoverView,clearTicketUnassignView } from './authorization';
import { useUiStore } from './ui-store';
import { WorkbenchDetailDrawer as Detail } from './WorkbenchDetail';
import { itemLink,TeamAvatar,useReporterProfile } from './WorkbenchItemPresentation';
import { WorkbenchLink as Link } from './WorkbenchLink';

import { BoardColumnLoading } from './WorkbenchLoading';

const names:Record<BoardColumn,string>={pending:stagePresentation.pending.label,active:stagePresentation.active.label,closed:stagePresentation.closed.label};
const columns:readonly BoardColumn[]=['pending','active','closed'];
function conditionLocationKey(params:URLSearchParams){const next=new URLSearchParams(params);next.delete('view');next.delete('detail');next.sort();return next.toString();}
function useColumn(principal:Principal,column:BoardColumn,range:BoardCompletionRange,scope?:'team'|'related',enabled=true,dates?:{from:string;to:string}){
  return useInfiniteQuery({queryKey:['board',principal.principal_id,column,range,...(scope?[scope,principal.authorization_revision,principal.expires_epoch_ms]:[]),...(dates?[dates.from,dates.to]:[])],initialPageParam:null as string|null,
    enabled,queryFn:({pageParam,signal})=>api.board(column,range,pageParam,signal,scope,dates),getNextPageParam:p=>p.next_cursor??undefined});
}
function useClock(){
  const [now,setNow]=useState(Date.now);
  useEffect(()=>observeVisibleMinute(setNow),[]);
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
  return <div className="state-message" role="status"><TriangleAlert size={18}/><p>{text}</p>{retry?<Button tone="secondary" onPress={retry}>重新读取</Button>:null}</div>;
}
function SharedFollowUpSummary({value,compact=false}:{value:WorkbenchCard['follow_up_schedule'];compact?:boolean}){
  if(!value)return null;
  return <p className={'shared-follow-up-summary'+(value.is_due?' is-due':'')} title={'共享跟进 · '+(value.is_due?'已到期':'已安排')+' · '+value.due_at+'（北京时间）'}>
    <strong>{compact?'':'共享跟进 · '}{value.is_due?'已到期':'已安排'}</strong>
    <time dateTime={value.due_at.replace(' ','T')+'+08:00'}>{value.due_at}（北京时间）</time>
  </p>;
}
function Card({item,principal,search,selected,now,located=false}:{item:WorkbenchCard;principal:Principal;search:string;selected:boolean;now:number;located?:boolean}){
  const highlighted=useClosureHighlight(item);
  const profile=useReporterProfile(item,principal),name=item.reporter_name??profile.data?.name,department=item.reporter_department??profile.data?.department;
  const fields=[item.location,department,name].filter(value=>Boolean(value?.trim())),source=(item.source_group?.display_name?item.source_label:item.source_label.split('·')[0])?.trim();
  const sourceLabel=source&&(item.source_group?.display_name||!/未提供|未登记|不可用/u.test(source))?source:null;
  const metadata=fields.length||sourceLabel?<p className="card-meta" title={[...fields,sourceLabel].filter(Boolean).join(' · ')}>{fields.length?<span className="ds-reporter-text">{fields.join(' · ')}</span>:null}{fields.length&&sourceLabel?<span aria-hidden="true">·</span>:null}{sourceLabel?<SourceLabel className="neutral-chip" source={item.source} label={sourceLabel}/>:null}</p>:null;
  const incomplete=item.column!=='closed'&&!item.location?.trim()&&!name?.trim()&&!department?.trim(),tags=[...cardTags(item),...(incomplete?[{key:'incomplete',label:'待补位置',tone:'neutral' as const}]:[])];
  const start=cardHeatStart(item);
  const heat=cardHeat(item,now);
  const ring=heat?.ring??(tags.some(tag=>tag.key==='urge')?'attention':tags.some(tag=>tag.key==='review')?'review':undefined);
  return <TicketCard className={selected?'is-selected':''} data-kind={item.kind} data-item-id={item.id} data-closure-highlight={highlighted?'true':undefined} data-ring={item.closure?.kind==='DISMISSED'?undefined:ring} data-closure-kind={item.closure?.kind} data-reminder-located={located?'true':undefined}>
    {item.closure?.kind==='DISMISSED'?<><div className="ds-dismissed-card-content"><DismissedTicketCardBody item={item} now={now} metadata={metadata} titleLink={<Link draggable={false} className="card-open ds-dismissed-open" role="link" to={itemLink(item,search)} state={{fromBoard:true}}>{item.title}<span className="sr-only">查看详情</span></Link>}/></div><RestoreClosedItem item={item} principal={principal}/></>:<BoardActionCard item={item}><Link draggable={false} className="card-open" role="link" to={itemLink(item,search)} state={{fromBoard:true}}>
      <TicketCardBody number={item.number} title={item.title} category={<TicketCategoryTile service={item.service}/>} heat={heat} heatStart={start??null} completedAt={item.column==='closed'?item.completed_at:null}
        metadata={metadata} tags={tags}
        followUp={<SharedFollowUpSummary value={item.follow_up_schedule} compact/>}
        owner={<span className="owner" title={item.assignee_name??'等待领取'}><Avatar name={item.assignee_name} size={20} aria-hidden="true"/>{item.assignee_name?<span className={'owner-name'+(item.assignee_name===name?' sr-only':'')}>{item.assignee_name}</span>:null}</span>}
        activity={<time className="activity-time" dateTime={item.updated_at.replace(' ','T')+'+08:00'} title={'最新活动：'+item.updated_at+'（北京时间）'}>{relativeTime(item.updated_at,now)}</time>}/>
      <span className="sr-only">查看详情</span>
    </Link></BoardActionCard>}
  </TicketCard>;
}
function More({expanded,count,onClick,controls,error=false}:{expanded:boolean;count:number;onClick:()=>void;controls:string;error?:boolean}){
  return <div className="ds-column-footer" title={error?'读取未完成':'已加载 '+count+' 项'}>{error?<span>读取未完成</span>:null}{count>3?<HButton className="column-more" data-action="expand-column" aria-expanded={expanded} aria-controls={controls} onClick={onClick} tone="ghost">{expanded?<ChevronUp size={14}/>:<ChevronDown size={14}/>}<span>{expanded?'收起':('显示剩余 '+(count-3)+' 项')}</span><span className="sr-only">（当前已加载范围）</span></HButton>:null}</div>;
}
function Shell({principal,children,navigationBlocked=false,realtime}:{principal:Principal;children:ReactNode;navigationBlocked?:boolean;realtime:RealtimeView}){
  const desktopEpoch=useDesktopSession(principal,realtime,navigationBlocked);
  const summaryOptions=conversationSummaryQuery(principal),summary=useQuery(summaryOptions),unread=summaryOptions.enabled&&summary.isSuccess?summary.data?.my_unread_count??0:0;
  const collapsed=useUiStore(s=>s.sidebarCollapsed),toggle=useUiStore(s=>s.toggleSidebar),openSettings=useUiStore(s=>s.openSettings);
  const profile=useQuery({queryKey:['current-profile',principal.principal_id,principal.authorization_revision],queryFn:({signal})=>api.profile(signal),enabled:principal.current_profile_available===true,staleTime:300_000,gcTime:300_000,retry:false});
  const displayName=profile.data?.name??principal.display_name,department=profile.data?.department;
  const client=useQueryClient();
  const logout=useMutation({mutationKey:['session-logout',principal.principal_id],mutationFn:()=>api.logout(principal.csrf_token),
    onSuccess:()=>clearSessionAuthorization(client,principal.principal_id,undefined,'logout','已退出，当前浏览器的恢复副本已清理。'),
    onError:()=>clearSessionAuthorization(client,principal.principal_id,undefined,'logout-unknown','服务器退出結果尚未确认，本地恢复副本已清理；请重新核验会话并查看工单信息。')});
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
  const collaboration=principal.internal_notes_enabled||principal.ticket_self_handling_enabled||principal.manual_review_enabled||principal.ticket_staff_completion_enabled?'人工协作':'只读';
  const userMenu=(compact=false)=><Dropdown><Dropdown.Trigger className={compact?'compact-account':'account account-menu-trigger'} data-action="open-user-menu" data-menu-location={compact?'compact':'sidebar'} aria-label="用户菜单" isDisabled={logout.isPending}>
    {compact?<Settings size={18}/>:<TeamAvatar name={displayName}/>}<span className="sr-only">{compact?displayName+' · '+(department?department+' · ':'')+collaboration:''}</span>{compact?null:<><div className="account-copy"><strong>{displayName}</strong><small className="read-only-badge">{department?department+' · ':''}{collaboration}</small></div><ChevronsUpDown className="account-menu-chevron" size={15}/></>}
  </Dropdown.Trigger><Dropdown.Popover className="user-account-menu" placement={compact?'bottom end':'top start'}><Dropdown.Menu aria-label="用户操作">
    <Dropdown.Item id="settings" data-action="open-settings" textValue="设置" isDisabled={navigationBlocked} onAction={openSettings}><Settings size={16}/><HLabel>设置</HLabel></Dropdown.Item>
    {principal.logout_enabled?<Dropdown.Item id="logout" data-action="logout-workbench" textValue="退出工作台" isDisabled={logout.isPending} onAction={()=>logout.mutate()}><LogOut size={16}/><HLabel>{logout.isPending?'正在退出…':'退出工作台'}</HLabel></Dropdown.Item>:null}
  </Dropdown.Menu></Dropdown.Popover></Dropdown>;
  const teamLabel='信息服务团队';
  const currentPath=useLocation().pathname,exceptionPage=currentPath.startsWith('/notification-exceptions'),conversationPage=currentPath.startsWith('/conversations'),settings=currentPath.startsWith('/settings/'),newReport=currentPath.startsWith('/reports/new');
  const guardNavigation=(event:MouseEvent<HTMLAnchorElement>)=>{if(navigationBlocked)event.preventDefault();};
  return <WorkbenchEfficiency principal={principal} blocked={navigationBlocked}><div className={'app '+(collapsed?'sidebar-collapsed':'')} data-realtime-status={realtime.status}><aside className="sidebar" aria-label="主导航">
    <SidebarBrand team={teamLabel}/><EfficiencyEntry/>
    <p className="nav-label">工作空间</p><Link className={'nav-item '+(!settings&&!conversationPage&&!exceptionPage?'current':'')} to="/" aria-current={!settings&&!conversationPage&&!exceptionPage?'page':undefined} aria-disabled={navigationBlocked} onClick={guardNavigation} title="工作台"><LayoutGrid/><span>工作台</span></Link>
    <>{principal.conversation_workspace_enabled?<Link className={"nav-item conversation-nav-item "+(conversationPage?"current":"")} to="/conversations" aria-label="会话" aria-current={conversationPage?"page":undefined} aria-disabled={navigationBlocked} onClick={guardNavigation} data-action="open-conversations"><MessageSquare/><span>会话</span>{unread>0?<Tag tone="brand" className="conversation-unread-badge" role="status" aria-label={unread+' 条未读'} data-conversation-unread={unread}>{unread>99?'99+':unread}</Tag>:null}</Link>:null}</>{principal.incident_candidate_workspace_enabled?<Link className="nav-item" to="/incidents/candidates" data-action="open-incident-candidates" aria-disabled={navigationBlocked} onClick={guardNavigation}><TriangleAlert/><span>公共故障</span></Link>:null}<>{principal.notification_exceptions_enabled?<Link className={"nav-item "+(exceptionPage?"current":"")} to="/notification-exceptions" data-action="open-notification-exceptions" aria-disabled={navigationBlocked} onClick={guardNavigation}><Bell/><span>通知异常</span></Link>:null}</>
    <div className="sidebar-note"/><div className="sidebar-bottom">{userMenu()}</div></aside>
    <main><header className="topbar"><HButton className="icon-button" aria-label={collapsed?'展开侧栏':'收起侧栏'} onClick={toggle} tone="ghost" isIconOnly title={collapsed?'展开侧栏':'收起侧栏'}><MorphIcon icon={collapsed?ExpandData:CollapseData} size={18} reducedMotion="user"/></HButton><span><span data-breadcrumb-team>{teamLabel}</span> <span className="slash">/</span> <strong>{settings?'设置':conversationPage?'会话':exceptionPage?'通知异常':newReport?'新报修':'工作台'}</strong></span><div className="topbar-actions"><EfficiencyEntry compact/><span className="connection-status" data-realtime-status={realtime.status} role="status" aria-label={"连接状态："+realtimeLabels[realtime.status]}>{realtime.status==='disabled'?<RefreshCw size={14} aria-hidden="true"/>:null}{realtimeLabels[realtime.status]}</span><div className="topbar-desktop-settings"><HButton className="topbar-settings" tone="ghost" isIconOnly aria-label="设置" isDisabled={navigationBlocked} onPress={openSettings}><Settings size={18}/></HButton></div><div className="compact-user-menu">{userMenu(true)}</div></div></header><WorkbenchReminders principal={principal} realtime={realtime} navigationBlocked={navigationBlocked} desktopEpoch={desktopEpoch}/>{children}</main></div></WorkbenchEfficiency>;
}
interface ColumnQuery {
 isPending:boolean;isError:boolean;error:unknown;isFetchingNextPage:boolean;hasNextPage:boolean;
 data:{pages:{items:WorkbenchCard[];range:{mode:BoardCompletionRange;from:string;until:string;timezone:'Asia/Shanghai'};group_counts?:{completed:number;dismissed:number}}[]}|undefined;
 refetch:()=>Promise<unknown>;fetchNextPage:()=>Promise<unknown>;
}
function BoardSection({principal,query,column,label,search,selected,now,loaded,earlierAction,filtered,blocked,preserveOrder,sort,onSort,newCount,onReveal}:{principal:Principal;query:ColumnQuery;column:BoardColumn;label:string;search:string;selected:string|undefined;now:number;loaded:WorkbenchCard[];earlierAction:ReactNode;filtered:boolean;blocked:boolean;preserveOrder:boolean;sort:BoardSort;onSort:(value:BoardSort)=>void;newCount:number;onReveal:()=>void}){
  const [expanded,setExpanded]=useState(false);
  const intakes=loaded.filter(item=>item.kind!=='ticket'),tickets=loaded.filter(item=>item.kind==='ticket');
  const grouped=loaded;
  // Keep the three-card contract while giving both nonempty groups a visible item.
  const visible=expanded?grouped:column==='pending'&&intakes.length&&tickets.length
    ?[...intakes.slice(0,2),...tickets.slice(0,3-Math.min(intakes.length,2))]:grouped.slice(0,3);
  const renderCard=(item:WorkbenchCard)=><Card key={item.kind+item.id} item={item} principal={principal} search={search} selected={item.id===selected} now={now}/>;
  const completed=loaded.filter(item=>item.closure?.kind==='COMPLETED'),dismissed=loaded.filter(item=>item.closure?.kind==='DISMISSED');
  const counts=!filtered?query.data?.pages[0]?.group_counts:undefined;
  const groupCounts=counts??{completed:completed.length,dismissed:dismissed.length};
  const group=(kind:'completed'|'dismissed',groupItems:WorkbenchCard[])=><ProcessedGroup key={kind} kind={kind} items={groupItems} count={groupCounts[kind]} principalId={principal.principal_id} renderCard={renderCard} error={query.isError}/>;
  const empty=!loaded.length?<div className="empty"><p>{filtered?'已加载的事项中暂无匹配结果':boardEmptyMessage(column,query.data?.pages[0]?.range)}</p>{query.isError||filtered?null:earlierAction}</div>:null;
  const content=<BoardColumnView column={column} label={label} count={query.isError?'—':column==='closed'?groupCounts.completed+groupCounts.dismissed:loaded.length} countTitle={column==='closed'&&counts?'当前日期范围内的事项总数':'当前筛选后已加载的事项'} sort={sort} onSort={onSort} blocked={blocked||preserveOrder} newCount={newCount} onReveal={onReveal}>
    {query.isPending?<BoardColumnLoading/>:query.isError&&!query.data?<Message text={errorMessage(query.error)} retry={()=>{void query.refetch();}}/>:<>{query.isError?<p role="status" className="confirmed-facts">连接中断，显示最近已确认资料。</p>:null}<div className="column-cards" id={'cards-'+column}>{column==='closed'?<><BoardDropColumn column={column}><div className="ds-completed-drop-zone">{group('completed',completed)}</div></BoardDropColumn>{group('dismissed',dismissed)}</>:column==='pending'&&loaded.length?<><BoardGroup label="待判断" count={intakes.length}>{visible.filter(item=>item.kind!=='ticket').map(renderCard)}</BoardGroup><BoardGroup label="待接单" count={tickets.length}>{visible.filter(item=>item.kind==='ticket').map(renderCard)}</BoardGroup></>:visible.map(renderCard)}{empty}</div>{column!=='closed'?<More expanded={expanded} count={loaded.length} controls={'cards-'+column} onClick={()=>setExpanded(value=>!value)} error={query.isError}/>:null}</>}
    {!query.isError&&!query.isPending?(query.hasNextPage?<Button className="load-more" tone="ghost" isDisabled={query.isFetchingNextPage} onPress={()=>{void query.fetchNextPage();}}>加载下一页</Button>:null):null}
  </BoardColumnView>;
  return column==='closed'?content:<BoardDropColumn column={column}>{content}</BoardDropColumn>;
}
function ProcessedGroup({kind,items,count,principalId,renderCard,error}:{kind:'completed'|'dismissed';items:WorkbenchCard[];count:number;principalId:string;renderCard:(item:WorkbenchCard)=>ReactNode;error:boolean}){
  const [expanded,setExpanded]=useState(false),id='cards-closed-'+kind;
  return <BoardGroup label={kind==='completed'?'已完成':'已关闭'} count={count} defaultExpanded={kind==='completed'} preferenceKey={'pc-admin:processed-group:'+principalId+':'+kind} {...(kind==='dismissed'?{note:'不计入完成数'}:{})}>
    <div id={id}>{(expanded?items:items.slice(0,3)).map(renderCard)}</div>
    <More expanded={expanded} count={items.length} controls={id} onClick={()=>setExpanded(value=>!value)} error={error}/>
  </BoardGroup>;

}
function Workbench({principal,realtime}:{principal:Principal;realtime:RealtimeView}){
  const [detailNavigationBlocked,setNavigationBlocked]=useState(false),[claimNavigationBlocked,setClaimNavigationBlocked]=useState(false);
  const [closureBlocked,setClosureBlocked]=useState(false);
  const navigationBlocked=detailNavigationBlocked||claimNavigationBlocked||closureBlocked;
  const [sorts,setSorts]=useState<Record<BoardColumn,BoardSort>>({pending:'oldest',active:'oldest',closed:'newest'});
  const [summarySelection,setSummarySelection]=useState<{scope:string;filter:BoardSummaryFilter|null}>({scope:'',filter:null});
  const [boardFilters,setBoardFilters]=useState({scope:'',category:'all',handler:'all'});
  const [conditionsTransition,setConditionsTransition]=useState(false),pendingConditionsRef=useRef<URLSearchParams|null>(null);
  const order=useRef<{scope:string;keys:string[]}>({scope:'',keys:[]});
  const [params,setParams]=useSearchParams(),location=useLocation(),selected=useParams(),now=useClock(),navigate=useNavigate();
  const locationMode=Boolean(selected.id&&params.get('locate')==='1');
  const validLocation=Boolean(principal.workbench_reminders_enabled&&locationMode&&['ticket','review','intake'].includes(selected.kind??'')&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(selected.id??''));
  const view=params.get('view')==='list'?'list':'board',range:BoardCompletionRange=params.get('range')==='custom'?'custom':params.get('range')==='all'?'all':principal.workbench_search_enabled&&params.get('search')==='1'&&!params.has('range')?'all':'recent',fullPage=Boolean(!locationMode&&selected.id&&params.get('detail')==='page');
  const closedDates=range==='custom'?{from:params.get('closed_from')??'',to:params.get('closed_to')??''}:undefined;
  const rangeKey=range+':'+(closedDates?.from??'')+':'+(closedDates?.to??'');
  const client=useQueryClient();
  const located=useQuery({queryKey:['reminder-locate',principal.principal_id,selected.kind,selected.id,principal.authorization_revision,principal.expires_epoch_ms],enabled:validLocation,retry:false,gcTime:0,
    queryFn:({signal})=>api.detail(selected.kind??'',selected.id??'',null,signal)});
  useEffect(()=>{const error=located.error;if(!(error instanceof ApiError)||![401,403,404].includes(error.status))return;
    if(error.status===401)void clearSessionAuthorization(client,principal.principal_id,401,'revoked');
    else void clearItemView(client,principal.principal_id,selected.kind,selected.id,error);
  },[located.error,client,principal.principal_id,selected.kind,selected.id]);
  const locatedItem=validLocation&&located.isSuccess?located.data.item:null;
  const locatedSection=useRef<HTMLElement|null>(null),scrolledLocation=useRef('');
  useEffect(()=>{
    if(!locationMode){scrolledLocation.current='';return;}
    if(!locatedItem)return;const key=locatedItem.kind+':'+locatedItem.id;
    if(scrolledLocation.current!==key){scrolledLocation.current=key;locatedSection.current?.scrollIntoView({block:'nearest',behavior:'auto'});}
  },[locationMode,locatedItem?.kind,locatedItem?.id]);
  const scope: 'team'|'related'|undefined=principal.workbench_follow_enabled?(params.get('scope')==='related'?'related':'team'):undefined;
  const searchRequested=params.get('search')==='1',searchMode=principal.workbench_search_enabled===true&&searchRequested;
  const catalog=useQuery({queryKey:['workbench-service-catalog',principal.principal_id,principal.authorization_revision],queryFn:({signal})=>readServiceCatalog(signal),enabled:!fullPage&&!searchMode,retry:false,staleTime:300_000});
  useEffect(()=>{const error=catalog.error;if(error instanceof ApiError&&error.status===403)void clearSessionAuthorization(client,principal.principal_id,403,'revoked');},[catalog.error,client,principal.principal_id]);
  const parsed=criteriaFromUrl(params,params.has('range')?range:'all',scope??'team'),searchKey=parsed.criteria?searchCriteriaKey(parsed.criteria):'invalid';
  const searched=useWorkbenchSearch(principal,parsed.criteria,searchMode);
  const currentConditions=conditionLocationKey(params),searchConditionsBusy=conditionsTransition||searchMode&&searched.isFetching;
  useEffect(()=>{
    // Router has committed the next location (including Back/Forward). The
    // query's own fetching state then keeps read controls locked until settle.
    pendingConditionsRef.current=null;setConditionsTransition(false);
  },[location]);
  const basePending=useColumn(principal,'pending',range,scope,!searchMode,closedDates),baseActive=useColumn(principal,'active',range,scope,!searchMode,closedDates),baseClosed=useColumn(principal,'closed',range,scope,!searchMode,closedDates);
  const searchedColumn=(column:BoardColumn):ColumnQuery=>({...searched,isFetchingNextPage:searched.isFetching,
    data:searched.isError||parsed.error?undefined:searched.data?{pages:searched.data.pages.map(page=>({items:page.items.filter(item=>item.column===column),range:page.range}))}:undefined,
    refetch:searched.restart,fetchNextPage:()=>searched.isFetching?Promise.resolve():searched.fetchNextPage()});
  const pending:ColumnQuery=searchMode?searchedColumn('pending'):basePending,active:ColumnQuery=searchMode?searchedColumn('active'):baseActive,closed:ColumnQuery=searchMode?searchedColumn('closed'):baseClosed;
  const queries=[pending,active,closed],items=queries.flatMap(query=>query.data?.pages.flatMap(page=>page.items)??[]),fresh=[...new Map(items.map(item=>[item.kind+':'+item.id,item])).values()];
  const summaryScope=JSON.stringify([rangeKey,scope,searchMode,searchKey,principal.authorization_revision]);
  const filterScope=principal.principal_id+':'+summaryScope;
  const categoryFilter=!searchMode&&catalog.isSuccess&&!catalog.isError&&boardFilters.scope===filterScope?boardFilters.category:'all';
  const handlerFilter=!searchMode&&boardFilters.scope===filterScope?boardFilters.handler:'all';
  const handlers=[...new Set(fresh.flatMap(item=>item.assignee_name?[item.assignee_name]:[]))];
  const setBoardFilter=(key:'category'|'handler',value:string)=>setBoardFilters(current=>({scope:filterScope,category:current.scope===filterScope?current.category:'all',handler:current.scope===filterScope?current.handler:'all',[key]:value}));
  const mineAvailable=principal.workbench_follow_enabled===true&&fresh.every(item=>item.attention!==undefined);
  const summaryFilter=summarySelection.scope===summaryScope&&(summarySelection.filter!=='mine'||mineAvailable)?summarySelection.filter:null;
  // One presentation sequence drives columns, filtered results and detail navigation.
  const ordered=view==='board'?columns.flatMap(column=>{
    const sorted=sortBoardItems(fresh.filter(item=>item.column===column),column,sorts[column]);
    return column==='pending'?[...sorted.filter(item=>item.kind!=='ticket'),...sorted.filter(item=>item.kind==='ticket')]:column==='closed'?[...sorted.filter(item=>item.closure?.kind==='COMPLETED'),...sorted.filter(item=>item.closure?.kind==='DISMISSED')]:sorted;
  }):orderWorkTableItems(fresh);
  let unique=ordered;
  const holdOrder=principal.realtime_sse_enabled&&Boolean(selected.id)&&!fullPage&&!locationMode;
  const orderingScope=JSON.stringify([principal.principal_id,principal.authorization_revision,rangeKey,view,scope,summaryFilter,categoryFilter,handlerFilter,sorts,searchMode?searchKey:null]),keys=ordered.map(item=>item.kind+':'+item.id),present=new Set(keys);
  if(!holdOrder||order.current.scope!==orderingScope)order.current={scope:orderingScope,keys};
  if(holdOrder){
    const retained=order.current.keys.filter(key=>present.has(key)),known=new Set(retained);order.current.keys=[...retained,...keys.filter(key=>!known.has(key))];
    // Keep only presentation IDs. Every displayed object still comes from the current authorized GET.
    const rank=new Map(order.current.keys.map((key,index)=>[key,index]));
    const ranked=[...ordered].sort((a,b)=>(rank.get(a.kind+':'+a.id)??0)-(rank.get(b.kind+':'+b.id)??0));
    // Freeze within the visible hierarchy; new keys must not sit behind unrelated groups in navigation.
    unique=view==='list'?orderWorkTableItems(ranked):columns.flatMap(column=>{
      const stage=ranked.filter(item=>item.column===column);
      return view==='board'&&column==='pending'?[...stage.filter(item=>item.kind!=='ticket'),...stage.filter(item=>item.kind==='ticket')]:view==='board'&&column==='closed'?[...stage.filter(item=>item.closure?.kind==='COMPLETED'),...stage.filter(item=>item.closure?.kind==='DISMISSED')]:stage;
    });
  }
  const arrivals=useBoardArrivals(unique,orderingScope+':'+queries.map(query=>query.data?.pages.length??0).join(','),queries.every(query=>!query.isPending&&!query.isError)&&!(searchMode?searched.isFetching:basePending.isFetching||baseActive.isFetching||baseClosed.isFetching),principal.realtime_sse_enabled===true&&view==='board'&&!searchMode&&!fullPage&&!locationMode&&!holdOrder);
  unique=arrivals.items;
  // The detail freeze must inherit the sequence actually presented after arrivals.
  if(!holdOrder)order.current={scope:orderingScope,keys:unique.map(item=>item.kind+':'+item.id)};
  const commitConditions=(next:URLSearchParams)=>{
    if(navigationBlocked||pendingConditionsRef.current!==null||searched.isFetching)return;
    const key=conditionLocationKey(next);if(key===currentConditions)return;
    // Lock synchronously, before Router's URL transition can expose old handlers.
    pendingConditionsRef.current=new URLSearchParams(next);setConditionsTransition(true);setParams(next);
  };
  const update=(key:string,value:string)=>{const next=new URLSearchParams(key==='view'&&pendingConditionsRef.current?pendingConditionsRef.current:params);next.set(key,value);if(key==='scope')commitConditions(next);else setParams(next);};
  const applyClosedRange=(value:BoardCompletionRange,dates?:{from:string;to:string})=>{
    if(navigationBlocked)return;
    const next=new URLSearchParams(params);next.set('range',value);for(const key of ['closed_from','closed_to','cursor','limit'])next.delete(key);
    if(value==='custom'&&dates){next.set('closed_from',dates.from);next.set('closed_to',dates.to);}commitConditions(next);
  };
  const refresh=()=>{if(searchConditionsBusy)return;if(searchMode){if(!searched.isFetching)void searched.restart();}else{void pending.refetch();void active.refetch();void closed.refetch();}};
  const applySearch=(criteria:WorkbenchSearchCriteria)=>{
    const next=new URLSearchParams(params);for(const key of SEARCH_KEYS)next.delete(key);for(const key of ['closed_from','closed_to','cursor','limit'])next.delete(key);
    for(const [key,value]of searchParameters(criteria))next.set(key,value);next.set('search','1');commitConditions(next);
  };
  const leaveSearch=()=>{const next=new URLSearchParams(params),keep=new Set(['range','scope',...(range==='custom'?['closed_from','closed_to']:[])]);for(const key of SEARCH_KEYS)if(!keep.has(key))next.delete(key);next.delete('search');next.delete('cursor');next.delete('limit');commitConditions(next);};
  const closureKind=searchMode?(parsed.criteria?.closure_kind??'all'):'all';
  const applyClosureKind=(value:string)=>{
    if(navigationBlocked)return;
    const next=new URLSearchParams(params);for(const key of ['cursor','limit'])next.delete(key);
    if(value==='completed'||value==='dismissed')next.set('closure_kind',value);else next.delete('closure_kind');
    next.set('range',range);next.set('search','1');commitConditions(next);
  };
  const label=(column:BoardColumn)=>names[column];
  const visibleItems=(loaded:WorkbenchCard[])=>loaded.filter(item=>(!locatedItem||item.kind!==locatedItem.kind||item.id!==locatedItem.id)&&(!summaryFilter||matchesBoardSummary(item,summaryFilter,now))&&(categoryFilter==='all'||(categoryFilter==='unclassified'?!item.service:item.service?.category===categoryFilter))&&(handlerFilter==='all'||(handlerFilter==='unassigned'?!item.assignee_name:handlerFilter==='name:'+item.assignee_name)));
  const returnParameters=new URLSearchParams(params);returnParameters.delete('locate');returnParameters.delete('detail');
  const returnBoard='/'+(returnParameters.size?'?'+returnParameters:'');
  useBoardCardMotion(view+':'+categoryFilter+':'+handlerFilter+':'+summaryFilter+':'+unique.map(item=>item.kind+':'+item.id+':'+item.column).join('|'),searchMode?searched.isFetching:basePending.isFetching||baseActive.isFetching||baseClosed.isFetching,orderingScope,arrivals.arrivalKeys);
  return <Shell principal={principal} realtime={realtime} navigationBlocked={navigationBlocked}><ClosureActionsProvider principal={principal} otherBlocked={detailNavigationBlocked||claimNavigationBlocked} onBlockedChange={setClosureBlocked}><BoardActions principal={principal} blocked={navigationBlocked} onClaimBlocked={setClaimNavigationBlocked} selectionKey={location.pathname+location.search} onOpen={({intent,selector})=>{if(!navigationBlocked)void navigate(itemLink(intent,location.search),{state:{fromBoard:true,boardActionIntent:intent,boardActionSelector:selector}});}}>{!fullPage?<div className="workspace ds-page"><PageHeader className="ds-board-page-header" title="团队工作台" icon={<LayoutGrid/>} actions={<><Button tone="ghost" isIconOnly aria-label="刷新" title="刷新" isDisabled={searchConditionsBusy} onPress={refresh}><RefreshCw/><span className="sr-only">刷新</span></Button><ManualReportEntry principal={principal} blocked={navigationBlocked}/></>}/>
    <Toolbar className={'ds-board-toolbar'+(view==='list'?' ds-list-toolbar':'')}>
      <div className="ds-board-toolbar-top">
        <BoardSummary items={fresh} now={now} selected={summaryFilter} onSelect={filter=>setSummarySelection({scope:summaryScope,filter})} mineAvailable={mineAvailable} loading={queries.some(query=>query.isPending)} partial={queries.some(query=>query.isError)} blocked={navigationBlocked||searchConditionsBusy} scope={scope??'team'} relatedAvailable={principal.workbench_follow_enabled===true} onScope={value=>{if(principal.workbench_follow_enabled)update('scope',value);}}/>
        <SegmentedControl className="view-tabs" aria-label="展示方式"><HButton aria-pressed={view==='board'} onClick={()=>update('view','board')} tone="ghost"><LayoutGrid size={16}/>看板</HButton><HButton aria-pressed={view==='list'} onClick={()=>update('view','list')} tone="ghost"><List size={16}/>列表</HButton></SegmentedControl>
      </div>
      <div className="ds-board-toolbar-bottom">
        {principal.workbench_search_enabled?<div className="ds-board-search"><Search aria-hidden="true"/>{view==='board'?<kbd>/</kbd>:null}<SearchControls inlineLeave={view==='list'} principal={principal} criteria={parsed.criteria} active={searchMode} loaded={fresh} blocked={navigationBlocked} busy={searchConditionsBusy} onApply={applySearch} onLeave={leaveSearch}/></div>:searchRequested?<p role="status">搜索入口当前关闭，已返回原分页看板。</p>:null}
        {principal.workbench_search_enabled?<span className="ds-board-toolbar-divider" aria-hidden="true"/>:null}
        <div className="ds-board-filter-layout"><div className="ds-board-filter-row" role="group" aria-label="筛选已加载事项" title="类别和处理人仅筛选已加载事项">
          {catalog.data||searchMode?<FilterChip active={categoryFilter!=='all'} label="类别" icon={<Shapes/>} isDisabled={navigationBlocked||searchMode||catalog.isError} onClear={()=>setBoardFilter('category','all')} aria-label="类别" value={categoryFilter} onChange={value=>setBoardFilter('category',value)}><ListBox.Item id="all" textValue="全部">全部<ListBox.ItemIndicator/></ListBox.Item>{(catalog.data?.categories??[]).map(category=><ListBox.Item key={category.category} id={category.category} textValue={category.category_name_zh}>{category.category_name_zh}<ListBox.ItemIndicator/></ListBox.Item>)}<ListBox.Item id="unclassified" textValue="未分类">未分类<ListBox.ItemIndicator/></ListBox.Item></FilterChip>:null}
          <FilterChip active={handlerFilter!=='all'} label="处理人" icon={<UserRound/>} isDisabled={navigationBlocked||searchMode} onClear={()=>setBoardFilter('handler','all')} aria-label="处理人" value={handlerFilter} onChange={value=>setBoardFilter('handler',value)}><ListBox.Item id="all" textValue="全部">全部<ListBox.ItemIndicator/></ListBox.Item><ListBox.Item id="unassigned" textValue="未领取">未领取<ListBox.ItemIndicator/></ListBox.Item>{handlers.map(name=><ListBox.Item key={name} id={'name:'+name} textValue={name}>{name}<ListBox.ItemIndicator/></ListBox.Item>)}</FilterChip>
          {view==='list'&&principal.workbench_search_enabled?<FilterChip active={closureKind!=='all'} label="结束方式" isDisabled={navigationBlocked||searchConditionsBusy} title="按当前日期和结束方式筛选已处理事项" onClear={()=>applyClosureKind('all')} aria-label="结束方式" value={closureKind} onChange={applyClosureKind}><ListBox.Item id="all" textValue="全部">全部<ListBox.ItemIndicator/></ListBox.Item><ListBox.Item id="completed" textValue="已完成">已完成<ListBox.ItemIndicator/></ListBox.Item><ListBox.Item id="dismissed" textValue="已关闭">已关闭<ListBox.ItemIndicator/></ListBox.Item></FilterChip>:null}
        </div>
          {categoryFilter!=='all'&&handlerFilter!=='all'?<Button tone="ghost" data-action="clear-board-filters" isDisabled={navigationBlocked||searchMode} onPress={()=>setBoardFilters({scope:filterScope,category:'all',handler:'all'})}>清除</Button>:null}
        </div>
        <BoardDatePresets range={range} dates={closedDates} now={now} blocked={navigationBlocked||searchConditionsBusy} onApply={applyClosedRange}/>
      </div>
    </Toolbar>
    {searchMode&&searched.isError?<p role="alert" data-search-state="error">查询未完成，请重新读取。搜索输入仍保留。</p>:null}
    {searchMode&&!parsed.error&&!searched.isPending&&!searched.isError&&searched.data&&unique.length===0?<p role="status" data-search-state="empty">{searchEmptyMessage(parsed.criteria)}</p>:null}
    {locationMode?<section ref={locatedSection} className="reminder-location" aria-label="已定位事项"><div className="column-heading"><h2>已定位事项</h2><Link to={returnBoard}>返回当前工作台</Link></div>
      {!validLocation?<Message text="当前提醒定位不可用，请重新选择有效事项。"/>:located.isPending?<Message text="正在核验当前事项读取权限…"/>:located.isError?<Message text={located.error instanceof ApiError&&[403,404].includes(located.error.status)?'该事项当前不可读取，旧定位资料已清除。':'本次定位未完成，原定位目标已保留。'} {...(located.error instanceof ApiError&&[401,403,404].includes(located.error.status)?{}:{retry:()=>{void located.refetch();}})}/>:locatedItem?<Card item={locatedItem} principal={principal} search={location.search} selected={true} now={now} located={true}/>:null}
    </section>:null}
    {searchMode&&parsed.error?<Message text={parsed.error}/>:view==='board'?<div className="board">{columns.map((column,index)=>{const query=queries[index];return query?<BoardSection key={column+':'+rangeKey+':'+scope+':'+(searchMode?searchKey:'board')} principal={principal} query={query} loaded={visibleItems(unique.filter(item=>item.column===column))} column={column} label={label(column)} earlierAction={column==='closed'&&!searchMode&&(range==='recent'||range==='custom')?<Button tone="ghost" data-action="view-earlier" isDisabled={navigationBlocked} onPress={()=>applyClosedRange('all')}>查看更早</Button>:null} search={location.search} selected={selected.id} now={now} filtered={Boolean(summaryFilter||categoryFilter!=='all'||handlerFilter!=='all')} blocked={navigationBlocked} preserveOrder={Boolean(holdOrder)} newCount={column==='pending'?arrivals.count(visibleItems(fresh)):0} onReveal={arrivals.reveal} sort={sorts[column]} onSort={value=>setSorts(current=>({...current,[column]:value}))}/>:null;})}</div>:<>
      <WorkTable principalId={principal.principal_id} selected={selected.id} now={now} closureKind={closureKind}
        renderLink={(item,content)=><BoardActionCard item={item}><Link draggable={false} className="row-link card-open" to={itemLink(item,location.search)} state={{fromBoard:true}} title={item.title}>{content}</Link></BoardActionCard>}
        renderFollowUp={item=><SharedFollowUpSummary value={item.follow_up_schedule} compact/>} relativeTime={relativeTime}
        groups={columns.flatMap((column,index)=>{const query=queries[index];if(!query||closureKind!=='all'&&column!=='closed')return [];const loaded=visibleItems(unique.filter(item=>item.column===column));return [{column,label:label(column),items:loaded,count:query.isError?'—':loaded.length,
          feedback:query.isPending?<Message text={label(column)+'：正在读取…'}/>:query.isError&&!query.data?<Message text={label(column)+'：'+errorMessage(query.error)} retry={()=>{void query.refetch();}}/>:query.isError?<p role="status" className="confirmed-facts">{errorMessage(query.error)} 显示最近已确认资料。</p>:null,
          nextPage:query.hasNextPage?<Button className="load-more" tone="ghost" isDisabled={query.isFetchingNextPage} onPress={()=>{void query.fetchNextPage();}}>加载下一页</Button>:null}];})}/></>}

    <div className="range-bar sr-only" data-loaded-count><span>{queries.some(query=>query.isError)?'部分事项读取失败':'已加载 '+unique.length+' 项'}</span></div>
    </div>:null}
    {selected.id&&!locationMode?<Detail key={principal.principal_id} principal={principal} items={visibleItems(view==='list'&&closureKind!=='all'?unique.filter(item=>item.column==='closed'):unique)} now={now} fullPage={fullPage} onNavigationBlocked={setNavigationBlocked}/>:null}
  </BoardActions></ClosureActionsProvider></Shell>;
}
export function WorkbenchPage({principal,realtime,navigationBlocked,setNavigationBlocked}:{principal:Principal;realtime:RealtimeView;navigationBlocked:boolean;setNavigationBlocked:(value:boolean)=>void}){
  const location=useLocation();
  if(/^\/reports\/new\/?$/iu.test(location.pathname))return <Shell principal={principal} realtime={realtime} navigationBlocked={navigationBlocked}><ManualReportForm key={principal.principal_id+':'+principal.authorization_revision} principal={principal} onBlockedChange={setNavigationBlocked}/></Shell>;
  if(/^\/conversations(?:\/[^/]+)?\/?$/iu.test(location.pathname))return <Shell principal={principal} realtime={realtime} navigationBlocked={navigationBlocked}><Conversations key={principal.principal_id} principal={principal} onBlockedChange={setNavigationBlocked}/></Shell>;
  if(/^\/incidents\/candidates\/?$/iu.test(location.pathname))return <Shell principal={principal} realtime={realtime} navigationBlocked={navigationBlocked}><IncidentCandidates principal={principal}/></Shell>;
  if(/^\/notification-exceptions\/?$/iu.test(location.pathname))return <Shell principal={principal} realtime={realtime}><NotificationExceptions key={principal.principal_id} principal={principal}/></Shell>;
  if(/^\/incidents\/candidates\/[^/]+\/?$/iu.test(location.pathname))return <Shell principal={principal} realtime={realtime} navigationBlocked={navigationBlocked}><CandidateDetailPage principal={principal} onBlockedChange={setNavigationBlocked}/></Shell>;
  if(/^\/incidents\/[^/]+\/?$/iu.test(location.pathname))return <Shell principal={principal} realtime={realtime} navigationBlocked={navigationBlocked}><IncidentResultPage principal={principal} onBlockedChange={setNavigationBlocked}/></Shell>;
  return /^\/settings\/source-groups\/?$/iu.test(location.pathname)?<Shell principal={principal} realtime={realtime} navigationBlocked={navigationBlocked}><SourceGroupDirectory key={principal.principal_id} principal={principal} onBlockedChange={setNavigationBlocked}/></Shell>:<Workbench key={principal.principal_id} principal={principal} realtime={realtime}/>;
}
