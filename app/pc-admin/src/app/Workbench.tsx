import {ClosureActionsProvider,RestoreClosedItem,useClosureHighlight} from '../features/ticket-waiting/ClosureActions';
import {clearHoverItemDenied,clearHoverItemsBatch} from '../features/hover-cards/denied-items';
import {HoverCardsBoardBridge} from '../features/hover-cards/hover-card-store';
import {HoverCardsProvider,PersonHoverCard} from '../features/hover-cards/PersonHoverCard';
import {SidebarBrand} from './SidebarBrand';
import { Dropdown,Label as HLabel,ListBox } from '@heroui/react';
import { useInfiniteQuery,useMutation,useQuery,useQueryClient } from '@tanstack/react-query';
import { PanelLeftClose as CollapseData,PanelLeftOpen as ExpandData } from 'lucide';
import { Bell,ChevronDown,ChevronsUpDown,ChevronUp,LayoutGrid,List,LogOut,MessageSquare,RefreshCw,Search,Settings,TriangleAlert } from 'lucide-react';
import { MorphIcon } from 'morphicons/react';
import type { MouseEvent,ReactNode } from 'react';
import { Fragment,memo,useCallback,useEffect,useMemo,useRef,useState } from 'react';
import { useLocation,useNavigate,useParams,useSearchParams } from 'react-router';
import type { WorkbenchSearchCriteria } from '../../../../contracts/workbench_search_contracts';
import { SEARCH_KEYS,hasSearchCriteria,searchCriteriaKey,searchParameters } from '../../../../shared/workbench-search-contracts.mjs';
import type { BoardColumn,BoardCompletionRange,Principal,WorkbenchCard } from '../api/client';
import { api,ApiError,errorMessage } from '../api/client';
import type { BoardSort,BoardSummaryFilter } from '../design/board-presentation';
import { matchesBoardSummary,sortBoardItems } from '../design/board-presentation';
import { Avatar } from '../design/components/Avatar/Avatar';
import { BoardColumn as BoardColumnView,boardEmptyMessage,BoardGroup } from '../design/components/BoardColumn/BoardColumn';
import { BoardSummary,BoardDatePresets } from '../design/components/BoardSummary/BoardSummary';
import { Button,Button as HButton } from '../design/components/Button/Button';
import { PageHeader } from '../design/components/PageHeader/PageHeader';
import {Collapse,CollapseChevron} from '../design/components/Collapse/Collapse';
import { SegmentedControl } from '../design/components/SegmentedControl/SegmentedControl';
import { SourceLabel } from '../design/components/SourceLabel/SourceLabel';
import {FilterChip} from '../design/components/FilterChip/FilterChip';
import {Shapes,UserRound} from 'lucide-react';
import { StatusBadge } from '../design/components/StatusBadge/StatusBadge';
import { TicketCard,TicketCardBody,TicketCategoryTile,DismissedTicketCardBody } from '../design/components/TicketCard/TicketCard';
import { TicketPresence } from '../design/components/TicketCard/TicketPresence';
import { presenceTone } from '../design/components/PresenceTags/PresenceTags';
import { useDebouncedPresence,usePresenceModeTransition } from '../design/components/PresenceTags/use-debounced-presence';
import { usePresence } from '../features/activity/presence-store';
import { OnlineColleagues } from '../features/activity/OnlineColleagues';
import { Toolbar } from '../design/components/Toolbar/Toolbar';
import { WorkTable,orderWorkTableItems } from '../design/components/WorkTable/WorkTable';
import { cardHeat,cardHeatStart } from '../design/heat';
import { cardTags,stagePresentation } from '../design/status-map';
import { columnHighlightTone,useBoardCardMotion,useClosureElementHighlight,useMotionScopeReady } from '../design/motion/board-motion';
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
import { WorkbenchCardLink as CardLink,WorkbenchLink as Link } from './WorkbenchLink';

import {BoardColumnSkeleton} from '../design/components/Skeleton/Skeleton';
import {PENDING_GROUPS,PROCESSED_GROUPS,boardGroupProps,itemsInGroup} from '../design/components/BoardColumn/column-groups';
import type {ProcessedColumnGroup} from '../design/components/BoardColumn/column-groups';
import {EmptyState} from '../design/components/EmptyState/EmptyState';
import {ErrorState,StaleRetry} from '../design/components/ErrorState/ErrorState';
import {InlineAlert} from '../design/components/InlineAlert/InlineAlert';
import {ConnectionBar} from '../design/components/ConnectionBar/ConnectionBar';
import {useDelayedLoading} from '../design/hooks/useDelayedLoading';

const names:Record<BoardColumn,string>={pending:stagePresentation.pending.label,active:stagePresentation.active.label,handled:stagePresentation.handled.label};
const columns:readonly BoardColumn[]=['pending','active','handled'];
function conditionLocationKey(params:URLSearchParams){const next=new URLSearchParams(params);next.delete('view');next.delete('detail');next.sort();return next.toString();}
function useColumn(principal:Principal,column:BoardColumn,range:BoardCompletionRange,scope?:'team'|'related',enabled=true,dates?:{from:string;to:string}){
  return useInfiniteQuery({queryKey:['board',principal.principal_id,column,range,...(scope?[scope,principal.authorization_revision,principal.expires_epoch_ms]:[]),...(dates?[dates.from,dates.to]:[])],initialPageParam:null as string|null,
    enabled,queryFn:async({pageParam,signal})=>{const page=await api.board(column,range,pageParam,signal,scope,dates);clearHoverItemsBatch(principal.principal_id,page.items);return page;},getNextPageParam:p=>p.next_cursor??undefined});
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
const FROM_BOARD_STATE={fromBoard:true};
function guardCardOwnerClick(event:MouseEvent<HTMLAnchorElement>,blocked:boolean){
  const cardOpen=event.currentTarget.closest('.board-action-card,tr')?.querySelector('.card-open');
  if(blocked||cardOpen?.getAttribute('aria-disabled')==='true'){
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  const selection=window.getSelection();
  if(event.detail>0&&selection&&!selection.isCollapsed&&event.currentTarget.contains(selection.anchorNode)&&event.currentTarget.contains(selection.focusNode)){
    event.preventDefault();
  }
}
type CardProps={item:WorkbenchCard;principal:Principal;search:string;selected:boolean;now:number;blocked?:boolean;located?:boolean};
const CardBase=memo(function CardBase({item,principal,search,selected,now,blocked=false,located=false,profileName,profileDepartment}:CardProps&{profileName?:string|null|undefined;profileDepartment?:string|null|undefined}){
  const highlighted=useClosureHighlight(item),cardRef=useRef<HTMLElement>(null);
  useClosureElementHighlight(cardRef,highlighted,columnHighlightTone(item.column));
  const name=item.reporter_name??profileName,department=item.reporter_department??profileDepartment;
  const fields=[item.location,department,name].filter(value=>Boolean(value?.trim())),source=(item.source_group?.display_name?item.source_label:item.source_label.split('·')[0])?.trim();
  const sourceLabel=source&&(item.source_group?.display_name||!/未提供|未登记|不可用/u.test(source))?source:null;
  const metadata=fields.length||sourceLabel?<p className="card-meta" title={[...fields,sourceLabel].filter(Boolean).join(' · ')}>{fields.length?<span className="ds-reporter-text">{fields.join(' · ')}</span>:null}{fields.length&&sourceLabel?<span aria-hidden="true">·</span>:null}{sourceLabel?<SourceLabel className="neutral-chip" source={item.source} label={sourceLabel}/>:null}</p>:null;
  const incomplete=item.column!=='handled'&&!item.location?.trim()&&!name?.trim()&&!department?.trim(),tags=[...cardTags(item),...(incomplete?[{key:'incomplete',label:'待补位置',tone:'neutral' as const}]:[])];
  const start=cardHeatStart(item);
  const heat=cardHeat(item,now);
  const ring=heat?.ring??(tags.some(tag=>tag.key==='urge')?'attention':tags.some(tag=>tag.key==='review')?'review':undefined);
  // Card 30B / D4: presence subscribes only to this card's key; debounce in the display layer so outline and tags stay in sync.
  const presenceEnabled=principal.activity_enabled===true&&item.closure?.kind!=='DISMISSED';
  const presence=usePresence({kind:item.kind,id:item.id},presenceEnabled);
  const debouncedPresence=useDebouncedPresence(presence);
  const presenceMode=presenceEnabled?presenceTone(debouncedPresence):undefined;
  const presenceTransition=usePresenceModeTransition(presenceMode);
  const relativeUpdated=relativeTime(item.updated_at,now);
  const activityNode=<time className="activity-time" dateTime={item.updated_at.replace(' ','T')+'+08:00'} title={'最新活动：'+item.updated_at+'（北京时间）'}>{relativeUpdated}</time>;
  const followUpNode=<SharedFollowUpSummary value={item.follow_up_schedule} compact/>;
  const inBodyOwnerNode=item.assignee_name
    ?<span className="ds-ticket-owner-placeholder" aria-hidden="true"><Avatar name={item.assignee_name} size={20} aria-hidden="true"/><span className={'owner-name'+(item.assignee_name===name?' sr-only':'')}>{item.assignee_name}</span></span>
    :<span className="owner" title="等待领取"><Avatar name={null} size={20} aria-hidden="true"/></span>;
  const siblingOwnerNode=item.assignee_name
    ?<PersonHoverCard name={item.assignee_name}><CardLink draggable={false} className="owner ds-ticket-owner-link" to={itemLink(item,search)} state={FROM_BOARD_STATE} title={item.assignee_name} aria-label={'处理人：'+item.assignee_name} aria-disabled={blocked||undefined} onClick={event=>{guardCardOwnerClick(event,blocked);}}><Avatar name={item.assignee_name} size={20} aria-hidden="true"/><span className={'owner-name'+(item.assignee_name===name?' sr-only':'')}>{item.assignee_name}</span></CardLink></PersonHoverCard>
    :null;
  return <TicketCard ref={cardRef} className={selected?'is-selected':''} data-kind={item.kind} data-item-id={item.id} data-closure-highlight={highlighted?'true':undefined} data-ring={item.closure?.kind==='DISMISSED'||presenceMode?undefined:ring} data-presence={presenceMode} data-presence-transition={presenceTransition} data-closure-kind={item.closure?.kind} data-reminder-located={located?'true':undefined}>
    {presenceEnabled?<TicketPresence people={presence} debounced={debouncedPresence} unclaimed={item.column==='pending'&&!item.assignee_name}/>:null}
    {item.closure?.kind==='DISMISSED'?<><div className="ds-dismissed-card-content"><DismissedTicketCardBody item={item} now={now} metadata={metadata} titleLink={<CardLink draggable={false} className="card-open ds-dismissed-open" role="link" to={itemLink(item,search)} state={FROM_BOARD_STATE}>{item.title}<span className="sr-only">查看详情</span></CardLink>}/></div><RestoreClosedItem item={item} principal={principal}/></>:<BoardActionCard item={item}><div className="ds-ticket-card-surface"><CardLink draggable={false} className="card-open" role="link" to={itemLink(item,search)} state={FROM_BOARD_STATE}>
      <TicketCardBody number={item.number} title={item.title} category={<TicketCategoryTile service={item.service}/>} heat={heat} heatStart={start??null} completedAt={item.column==='handled'?item.completed_at:null}
        metadata={metadata} tags={tags}
        followUp={followUpNode}
        hasOwnerName={Boolean(item.assignee_name)}
        owner={inBodyOwnerNode}
        activity={activityNode}/>
      <span className="sr-only">查看详情</span>
    </CardLink>{siblingOwnerNode?<div className="card-footer ds-ticket-card-footer"><span className="ds-ticket-owner" data-has-owner-name="true">{siblingOwnerNode}</span><span className="ds-ticket-owner-time-spacer" aria-hidden="true">{relativeUpdated}</span></div>:null}</div></BoardActionCard>}
  </TicketCard>;
});
const CardWithReporterProfile=memo(function CardWithReporterProfile(props:CardProps){
  const profile=useReporterProfile(props.item,props.principal);
  return <CardBase {...props} profileName={profile.data?.name} profileDepartment={profile.data?.department}/>;
});
const Card=memo(function Card(props:CardProps){
  const {item,principal}=props;
  const needsProfile=principal.web_reports_enabled===true&&item.source==='PORTAL'&&!item.reporter_name&&!item.reporter_department;
  return needsProfile?<CardWithReporterProfile {...props}/>:<CardBase {...props}/>;
});
const More=memo(function More({expanded,count,onClick,controls}:{expanded:boolean;count:number;onClick:()=>void;controls:string}){
  if(count<=3)return null;
  return <div className="ds-column-footer" title={'已加载 '+count+' 项'}>{count>3?<HButton className="column-more" data-action="expand-column" aria-expanded={expanded} aria-controls={controls} onClick={onClick} tone="ghost"><CollapseChevron expanded={expanded}/><span>{expanded?'收起':('显示剩余 '+(count-3)+' 项')}</span><span className="sr-only">（当前已加载范围）</span></HButton>:null}</div>;
});
const UserAccountMenu=memo(function UserAccountMenu({compact=false,displayName,department,collaboration,navigationBlocked,logoutEnabled,logoutPending,openSettings,onLogout}:{compact?:boolean;displayName:string;department:string|null|undefined;collaboration:string;navigationBlocked:boolean;logoutEnabled:boolean;logoutPending:boolean;openSettings:()=>void;onLogout:()=>void}){
  return <Dropdown><Dropdown.Trigger className={compact?'compact-account':'account account-menu-trigger'} data-action="open-user-menu" data-menu-location={compact?'compact':'sidebar'} aria-label="用户菜单" isDisabled={logoutPending}>
    {compact?<Settings size={18}/>:<TeamAvatar name={displayName}/>}<span className="sr-only">{compact?displayName+' · '+(department?department+' · ':'')+collaboration:''}</span>{compact?null:<><div className="account-copy"><strong>{displayName}</strong><small className="read-only-badge">{department?department+' · ':''}{collaboration}</small></div><ChevronsUpDown className="account-menu-chevron" size={15}/></>}
  </Dropdown.Trigger><Dropdown.Popover className="user-account-menu" placement={compact?'bottom end':'top start'}><Dropdown.Menu aria-label="用户操作">
    <Dropdown.Item id="settings" data-action="open-settings" textValue="设置" isDisabled={navigationBlocked} onAction={openSettings}><Settings size={16}/><HLabel>设置</HLabel></Dropdown.Item>
    {logoutEnabled?<Dropdown.Item id="logout" data-action="logout-workbench" textValue="退出工作台" isDisabled={logoutPending} onAction={onLogout}><LogOut size={16}/><HLabel>{logoutPending?'正在退出…':'退出工作台'}</HLabel></Dropdown.Item>:null}
  </Dropdown.Menu></Dropdown.Popover></Dropdown>;
});
const ShellSidebar=memo(function ShellSidebar({teamLabel,collapsed,settings,conversationPage,exceptionPage,navigationBlocked,conversationEnabled,incidentEnabled,exceptionsEnabled,unread,displayName,department,collaboration,logoutEnabled,logoutPending,openSettings,onLogout}:{teamLabel:string;collapsed:boolean;settings:boolean;conversationPage:boolean;exceptionPage:boolean;navigationBlocked:boolean;conversationEnabled:boolean;incidentEnabled:boolean;exceptionsEnabled:boolean;unread:number;displayName:string;department:string|null|undefined;collaboration:string;logoutEnabled:boolean;logoutPending:boolean;openSettings:()=>void;onLogout:()=>void}){
  const guardNavigation=useCallback((event:MouseEvent<HTMLAnchorElement>)=>{if(navigationBlocked)event.preventDefault();},[navigationBlocked]);
  return <aside className="sidebar" aria-label="主导航">
    <SidebarBrand team={teamLabel}/><EfficiencyEntry/>
    <p className="nav-label">工作空间</p><Link className={'nav-item '+(!settings&&!conversationPage&&!exceptionPage?'current':'')} to="/" aria-current={!settings&&!conversationPage&&!exceptionPage?'page':undefined} aria-disabled={navigationBlocked} onClick={guardNavigation} title="工作台"><LayoutGrid/><span>工作台</span></Link>
    <>{conversationEnabled?<Link className={"nav-item conversation-nav-item "+(conversationPage?"current":"")} to="/conversations" aria-label="会话" aria-current={conversationPage?"page":undefined} aria-disabled={navigationBlocked} onClick={guardNavigation} data-action="open-conversations"><MessageSquare/><span>会话</span>{unread>0?<Tag tone="brand" className="conversation-unread-badge" role="status" aria-label={unread+' 条未读'} data-conversation-unread={unread}>{unread>99?'99+':unread}</Tag>:null}</Link>:null}</>{incidentEnabled?<Link className="nav-item" to="/incidents/candidates" data-action="open-incident-candidates" aria-disabled={navigationBlocked} onClick={guardNavigation}><TriangleAlert/><span>公共故障</span></Link>:null}<>{exceptionsEnabled?<Link className={"nav-item "+(exceptionPage?"current":"")} to="/notification-exceptions" data-action="open-notification-exceptions" aria-disabled={navigationBlocked} onClick={guardNavigation}><Bell/><span>通知异常</span></Link>:null}</>
    <div className="sidebar-note"/><div className="sidebar-bottom"><OnlineColleagues collapsed={collapsed}/><UserAccountMenu displayName={displayName} department={department} collaboration={collaboration} navigationBlocked={navigationBlocked} logoutEnabled={logoutEnabled} logoutPending={logoutPending} openSettings={openSettings} onLogout={onLogout}/></div></aside>;
});
const ShellTopbar=memo(function ShellTopbar({teamLabel,collapsed,toggle,settings,conversationPage,exceptionPage,newReport,realtimeStatus,navigationBlocked,openSettings,displayName,department,collaboration,logoutEnabled,logoutPending,onLogout}:{teamLabel:string;collapsed:boolean;toggle:()=>void;settings:boolean;conversationPage:boolean;exceptionPage:boolean;newReport:boolean;realtimeStatus:RealtimeView['status'];navigationBlocked:boolean;openSettings:()=>void;displayName:string;department:string|null|undefined;collaboration:string;logoutEnabled:boolean;logoutPending:boolean;onLogout:()=>void}){
  return <header className="topbar"><HButton className="icon-button" aria-label={collapsed?'展开侧栏':'收起侧栏'} onClick={toggle} tone="ghost" isIconOnly title={collapsed?'展开侧栏':'收起侧栏'}><MorphIcon icon={collapsed?ExpandData:CollapseData} size={18} reducedMotion="user"/></HButton><span><span data-breadcrumb-team>{teamLabel}</span> <span className="slash">/</span> <strong>{settings?'设置':conversationPage?'会话':exceptionPage?'通知异常':newReport?'新报修':'工作台'}</strong></span><div className="topbar-actions"><EfficiencyEntry compact/><span className="connection-status" data-realtime-status={realtimeStatus} role="status" aria-label={"连接状态："+realtimeLabels[realtimeStatus]}>{realtimeStatus==='disabled'?<RefreshCw size={14} aria-hidden="true"/>:null}{realtimeLabels[realtimeStatus]}</span><div className="topbar-desktop-settings"><HButton className="topbar-settings" tone="ghost" isIconOnly aria-label="设置" isDisabled={navigationBlocked} onPress={openSettings}><Settings size={18}/></HButton></div><div className="compact-user-menu"><UserAccountMenu compact displayName={displayName} department={department} collaboration={collaboration} navigationBlocked={navigationBlocked} logoutEnabled={logoutEnabled} logoutPending={logoutPending} openSettings={openSettings} onLogout={onLogout}/></div></div></header>;
});
function Shell({principal,children,navigationBlocked=false,realtime}:{principal:Principal;children:ReactNode;navigationBlocked?:boolean;realtime:RealtimeView}){
  const desktopEpoch=useDesktopSession(principal,realtime,navigationBlocked);
  const summaryOptions=conversationSummaryQuery(principal),summary=useQuery(summaryOptions),unread=summaryOptions.enabled&&summary.isSuccess?summary.data?.my_unread_count??0:0;
  const collapsed=useUiStore(s=>s.sidebarCollapsed),toggle=useUiStore(s=>s.toggleSidebar),openSettings=useUiStore(s=>s.openSettings);
  const profile=useQuery({queryKey:['current-profile',principal.principal_id,principal.authorization_revision],queryFn:({signal})=>api.profile(signal),enabled:principal.current_profile_available===true,staleTime:300_000,gcTime:300_000,retry:false});
  const displayName=profile.data?.name??principal.display_name,department=profile.data?.department;
  const client=useQueryClient();
  const logout=useMutation({mutationKey:['session-logout',principal.principal_id],mutationFn:()=>api.logout(principal.csrf_token),
    onSuccess:()=>clearSessionAuthorization(client,principal.principal_id,undefined,'logout','已退出登录。'),
    onError:()=>clearSessionAuthorization(client,principal.principal_id,undefined,'logout-unknown','退出结果未确认，请重新登录。')});
  const logoutMutateRef=useRef(logout.mutate);logoutMutateRef.current=logout.mutate;
  const onLogout=useCallback(()=>{logoutMutateRef.current();},[]);
  useEffect(()=>{
    if(!principal.draft_recovery_enabled&&!principal.closure_draft_recovery_enabled&&!principal.manual_review_draft_recovery_enabled&&!principal.ticket_conversation_draft_recovery_enabled&&!principal.staff_completion_draft_recovery_enabled&&!principal.conversation_draft_recovery_enabled&&!principal.manual_report_draft_recovery_enabled&&!principal.ticket_unassign_draft_recovery_enabled&&!principal.ticket_takeover_draft_recovery_enabled&&!principal.ticket_return_to_dispatch_enabled&&!principal.supplement_follow_up_draft_recovery_enabled&&!principal.logout_enabled)return;
    try{return subscribeDrafts(value=>{
      if(value.principal!==principal.principal_id||value.principal!==client.getQueryData<Principal>(['session'])?.principal_id)return;
      if(value.reason==='logout'||value.reason==='logout-unknown')clearSessionView(client,undefined,value.reason==='logout'?'已退出登录，本机草稿已清除。':'退出结果未确认，请重新登录。');
      else if(value.reason==='revoked'){
        if(value.kind==='ticket'&&value.id&&['waiting-requester','waiting-vendor','waiting-resume','waiting-cancel'].includes(value.purpose??''))void client.invalidateQueries({queryKey:['ticket-command-context',value.principal,value.id]});
        else if(value.kind==='ticket'&&value.id&&value.purpose==='ticket-unassign')void clearTicketUnassignView(client,value.principal,value.id,new ApiError(404,'AUTHORIZATION_REJECTED'));
        else if(value.kind==='ticket'&&value.id&&value.purpose==='ticket-takeover')void clearTicketTakeoverView(client,value.principal,value.id,new ApiError(404,'AUTHORIZATION_REJECTED'));
        else if(value.kind==='ticket'&&value.id&&value.purpose==='ticket-return-to-dispatch')void clearTicketReturnView(client,value.principal,value.id,new ApiError(404,'AUTHORIZATION_REJECTED'));
        else if(value.kind==='ticket'&&value.id&&value.purpose==='supplement-disposition')void client.cancelQueries({queryKey:['ticket-supplement-follow-up',value.principal,value.id]},{revert:false});
        else if(value.kind==='review'&&value.id&&value.purpose==='review-resolve-start'){const queryKey=['review-start-context',value.principal,value.id];void client.cancelQueries({queryKey,exact:true},{revert:false});client.getQueryCache().find({queryKey,exact:true})?.setState({data:undefined,dataUpdatedAt:0,error:new ApiError(404,'AUTHORIZATION_REJECTED'),status:'error',fetchStatus:'idle'});}
        else if(value.kind==='ticket'&&value.id&&(value.purpose==='supplement-reply'||/^sr-[a-z]{55}$/u.test(value.purpose??'')))void client.invalidateQueries({queryKey:['supplement-reply-sessions',value.principal,value.id]});
        else if(value.kind&&value.id)void clearItemView(client,value.principal,value.kind,value.id,new ApiError(404,'AUTHORIZATION_REJECTED'));
        else clearSessionView(client,undefined,'登录已过期，请重新登录。');
      }
    });}catch{return;}
  },[client,principal.principal_id,principal.draft_recovery_enabled,principal.closure_draft_recovery_enabled,principal.manual_review_draft_recovery_enabled,principal.ticket_conversation_draft_recovery_enabled,principal.staff_completion_draft_recovery_enabled,principal.conversation_draft_recovery_enabled,principal.manual_report_draft_recovery_enabled,principal.ticket_unassign_draft_recovery_enabled,principal.ticket_takeover_draft_recovery_enabled,principal.ticket_return_to_dispatch_enabled,principal.supplement_follow_up_draft_recovery_enabled,principal.logout_enabled]);
  const collaboration=principal.internal_notes_enabled||principal.ticket_self_handling_enabled||principal.manual_review_enabled||principal.ticket_staff_completion_enabled?'人工协作':'只读';
  const teamLabel='信息服务团队';
  const currentPath=useLocation().pathname,exceptionPage=currentPath.startsWith('/notification-exceptions'),conversationPage=currentPath.startsWith('/conversations'),settings=currentPath.startsWith('/settings/'),newReport=currentPath.startsWith('/reports/new');
  return <HoverCardsProvider principal={principal}><WorkbenchEfficiency principal={principal} blocked={navigationBlocked}><div className={'app '+(collapsed?'sidebar-collapsed':'')} data-realtime-status={realtime.status}>
    <ShellSidebar teamLabel={teamLabel} collapsed={collapsed} settings={settings} conversationPage={conversationPage} exceptionPage={exceptionPage} navigationBlocked={navigationBlocked} conversationEnabled={principal.conversation_workspace_enabled===true} incidentEnabled={principal.incident_candidate_workspace_enabled===true} exceptionsEnabled={principal.notification_exceptions_enabled===true} unread={unread} displayName={displayName} department={department} collaboration={collaboration} logoutEnabled={principal.logout_enabled===true} logoutPending={logout.isPending} openSettings={openSettings} onLogout={onLogout}/>
    <main><ShellTopbar teamLabel={teamLabel} collapsed={collapsed} toggle={toggle} settings={settings} conversationPage={conversationPage} exceptionPage={exceptionPage} newReport={newReport} realtimeStatus={realtime.status} navigationBlocked={navigationBlocked} openSettings={openSettings} displayName={displayName} department={department} collaboration={collaboration} logoutEnabled={principal.logout_enabled===true} logoutPending={logout.isPending} onLogout={onLogout}/><ConnectionBar realtime={realtime}/><WorkbenchReminders principal={principal} realtime={realtime} navigationBlocked={navigationBlocked} desktopEpoch={desktopEpoch}/>{children}</main></div></WorkbenchEfficiency></HoverCardsProvider>;
}
interface ColumnQuery {
 isPending:boolean;isError:boolean;isFetching:boolean;error:unknown;isFetchingNextPage:boolean;hasNextPage:boolean;
 data:{pages:{items:WorkbenchCard[];range:{mode:BoardCompletionRange;from:string;until:string;timezone:'Asia/Shanghai'};group_counts?:{completed:number;dismissed:number}}[]}|undefined;
 refetch:()=>Promise<unknown>;fetchNextPage:()=>Promise<unknown>;
}
const BoardSection=memo(function BoardSection({principal,isPending,isError,hasData,isFetching,isFetchingNextPage,hasNextPage,firstPageRange,firstPageGroupCounts,refetch,fetchNextPage,column,label,search,selected,now,loaded,earlierAction,filtered,blocked,preserveOrder,sort,onSort,newCount,newDirection,onReveal,animateCount}:{principal:Principal;isPending:boolean;isError:boolean;hasData:boolean;isFetching:boolean;isFetchingNextPage:boolean;hasNextPage:boolean;firstPageRange:{mode:BoardCompletionRange;from:string;until:string;timezone:'Asia/Shanghai'}|undefined;firstPageGroupCounts:{completed:number;dismissed:number}|undefined;refetch:()=>Promise<unknown>;fetchNextPage:()=>Promise<unknown>;column:BoardColumn;label:string;search:string;selected:string|undefined;now:number;loaded:WorkbenchCard[];earlierAction:ReactNode;filtered:boolean;blocked:boolean;preserveOrder:boolean;sort:BoardSort;onSort:(value:BoardSort)=>void;newCount:number;newDirection:'up'|'down';onReveal:()=>void;animateCount:boolean}){
  const [expanded,setExpanded]=useState(false);
  const loading=useDelayedLoading(isPending&&!hasData);
  const retry=useCallback(()=>{void refetch();},[refetch]);
  const toggleExpanded=useCallback(()=>setExpanded(value=>!value),[]);
  const {shown,completedCount,dismissedCount,pendingGroups,processedItems}=useMemo(()=>{
    let intakeCount=0,ticketCount=0,completed=0,dismissed=0;
    const intakes:WorkbenchCard[]=[],tickets:WorkbenchCard[]=[];
    for(const item of loaded){
      if(item.kind!=='ticket'){intakeCount++;if(intakeCount<=2)intakes.push(item);}
      else{ticketCount++;if(ticketCount<=3)tickets.push(item);}
      if(item.closure?.kind==='COMPLETED')completed++;
      else if(item.closure?.kind==='DISMISSED')dismissed++;
    }
    // Keep the three-card contract while giving both nonempty groups a visible item.
    const visible=column==='pending'&&intakeCount&&ticketCount
      ?[...intakes,...tickets.slice(0,3-Math.min(intakeCount,2))]:loaded.slice(0,3);
    const pendingByGroup=column==='pending'?PENDING_GROUPS.map(definition=>itemsInGroup(definition,loaded)):null;
    const processedByGroup=column==='handled'?PROCESSED_GROUPS.map(definition=>itemsInGroup(definition,loaded)):null;
    return {shown:new Set(visible.map(item=>item.kind+':'+item.id)),completedCount:completed,dismissedCount:dismissed,pendingGroups:pendingByGroup,processedItems:processedByGroup};
  },[loaded,column]);
  const renderCard=useCallback((item:WorkbenchCard)=><Card key={item.kind+item.id} item={item} principal={principal} search={search} selected={item.id===selected} now={now} blocked={blocked}/>,[principal,search,selected,now,blocked]);
  const cards=(items:WorkbenchCard[])=><>{items.filter(item=>shown.has(item.kind+':'+item.id)).map(renderCard)}<Collapse expanded={expanded} className="ds-column-remainder">{items.filter(item=>!shown.has(item.kind+':'+item.id)).map(renderCard)}</Collapse></>;
  const counts=!filtered?firstPageGroupCounts:undefined;
  const groupCounts=counts??{completed:completedCount,dismissed:dismissedCount};
  const empty=!loaded.length?<><EmptyState size={column==='pending'&&!filtered?'page':'compact'} tone={column==='pending'&&!filtered?'success':'neutral'} title={column==='pending'&&!filtered?'待受理已清空':boardEmptyMessage(column,firstPageRange)} {...(column==='pending'&&!filtered?{description:'新报修进来会出现在这里'}:{})}/>{isError||filtered?null:earlierAction}</>:null;
  const processedGroups=column==='handled'&&processedItems?PROCESSED_GROUPS.map((definition,idx)=>{const group=<ProcessedGroup definition={definition} items={processedItems[idx]??EMPTY_WORKBENCH_CARDS} count={groupCounts[definition.key]} principalId={principal.principal_id} renderCard={renderCard} animateCount={animateCount}/>;return definition.key==='completed'?<BoardDropColumn key={definition.key} column={column}><div className="ds-completed-drop-zone">{group}{empty}</div></BoardDropColumn>:<Fragment key={definition.key}>{group}</Fragment>;}):null;
  const content=<BoardColumnView column={column} label={label} count={loading.visible||isPending?'…':isError&&!hasData?'—':column==='handled'?groupCounts.completed+groupCounts.dismissed:loaded.length} countTitle={column==='handled'&&counts?'当前日期范围内的事项总数':'当前筛选后已加载的事项'} sort={sort} onSort={onSort} blocked={blocked||preserveOrder} newCount={newCount} newDirection={newDirection} onReveal={onReveal} animateCount={animateCount} feedback={isError&&hasData?<StaleRetry onRetry={retry}/>:null}>
    <div className="ds-state-region" data-refreshing={hasData&&isFetching&&!isFetchingNextPage?'true':undefined} data-stale={hasData&&isError?'true':undefined}>
    {loading.visible?<BoardColumnSkeleton column={column} label={label} principalId={principal.principal_id} bodyOnly slow={loading.slow} onRetry={retry}/>:isPending?null:isError&&!hasData?<ErrorState title={label+'没有读出来'} onRetry={retry}/>:<div className="ds-state-content"><div className="column-cards" id={'cards-'+column}>{column==='handled'?processedGroups:column==='pending'&&loaded.length&&pendingGroups?PENDING_GROUPS.map((definition,idx)=>{const groupItems=pendingGroups[idx]??EMPTY_WORKBENCH_CARDS;return <BoardGroup key={definition.key} {...boardGroupProps(definition,principal.principal_id)} count={groupItems.length} animateCount={animateCount}>{cards(groupItems)}</BoardGroup>;}):cards(loaded)}{column!=='handled'?empty:null}</div>{column!=='handled'?<More expanded={expanded} count={loaded.length} controls={'cards-'+column} onClick={toggleExpanded}/>:null}</div>}
    </div>
    {!isError&&!isPending&&!loading.visible&&hasNextPage?<Button className="load-more" tone="ghost" isDisabled={isFetchingNextPage} onPress={()=>{void fetchNextPage();}}>加载下一页</Button>:null}
  </BoardColumnView>;
  return column==='handled'?content:<BoardDropColumn column={column}>{content}</BoardDropColumn>;
});
const EMPTY_WORKBENCH_CARDS:WorkbenchCard[]=[];
const ProcessedGroup=memo(function ProcessedGroup({definition,items,count,principalId,renderCard,animateCount}:{definition:ProcessedColumnGroup;items:WorkbenchCard[];count:number;principalId:string;renderCard:(item:WorkbenchCard)=>ReactNode;animateCount:boolean}){
  const kind=definition.key;
  const [expanded,setExpanded]=useState(false),id='cards-handled-'+kind;
  const toggle=useCallback(()=>setExpanded(value=>!value),[]);
  return <BoardGroup {...boardGroupProps(definition,principalId)} count={count} animateCount={animateCount}>
    <div id={id}>{items.slice(0,3).map(renderCard)}<Collapse expanded={expanded} className="ds-column-remainder">{items.slice(3).map(renderCard)}</Collapse></div>
    <More expanded={expanded} count={items.length} controls={id} onClick={toggle}/>
  </BoardGroup>;
});
const BoardPageHeader=memo(function BoardPageHeader({searchConditionsBusy,onRefresh,principal,navigationBlocked}:{searchConditionsBusy:boolean;onRefresh:()=>void;principal:Principal;navigationBlocked:boolean}){
  return <PageHeader className="ds-board-page-header" title="团队工作台" icon={<LayoutGrid/>} actions={<><Button tone="ghost" isIconOnly aria-label="刷新" title="刷新" isDisabled={searchConditionsBusy} onPress={onRefresh}><RefreshCw/><span className="sr-only">刷新</span></Button><ManualReportEntry principal={principal} blocked={navigationBlocked}/></>}/>;
});
const ViewTabs=memo(function ViewTabs({view,onView}:{view:'board'|'list';onView:(value:'board'|'list')=>void}){
  const toBoard=useCallback(()=>onView('board'),[onView]);
  const toList=useCallback(()=>onView('list'),[onView]);
  return <SegmentedControl className="view-tabs" aria-label="展示方式"><HButton aria-pressed={view==='board'} onClick={toBoard} tone="ghost"><LayoutGrid size={16}/>看板</HButton><HButton aria-pressed={view==='list'} onClick={toList} tone="ghost"><List size={16}/>列表</HButton></SegmentedControl>;
});
const CategoryFilter=memo(function CategoryFilter({categories,value,isDisabled,onClear,onChange}:{categories:readonly {category:string;category_name_zh:string}[];value:string;isDisabled:boolean;onClear:()=>void;onChange:(value:string)=>void}){
  return <FilterChip active={value!=='all'} label="类别" icon={<Shapes/>} isDisabled={isDisabled} onClear={onClear} aria-label="类别" value={value} onChange={onChange}><ListBox.Item id="all" textValue="全部">全部<ListBox.ItemIndicator/></ListBox.Item>{categories.map(category=><ListBox.Item key={category.category} id={category.category} textValue={category.category_name_zh}>{category.category_name_zh}<ListBox.ItemIndicator/></ListBox.Item>)}<ListBox.Item id="unclassified" textValue="未分类">未分类<ListBox.ItemIndicator/></ListBox.Item></FilterChip>;
});
const HandlerFilter=memo(function HandlerFilter({handlers,value,isDisabled,onClear,onChange}:{handlers:readonly string[];value:string;isDisabled:boolean;onClear:()=>void;onChange:(value:string)=>void}){
  return <FilterChip active={value!=='all'} label="处理人" icon={<UserRound/>} isDisabled={isDisabled} onClear={onClear} aria-label="处理人" value={value} onChange={onChange}><ListBox.Item id="all" textValue="全部">全部<ListBox.ItemIndicator/></ListBox.Item><ListBox.Item id="unassigned" textValue="未领取">未领取<ListBox.ItemIndicator/></ListBox.Item>{handlers.map(name=><ListBox.Item key={name} id={'name:'+name} textValue={name}>{name}<ListBox.ItemIndicator/></ListBox.Item>)}</FilterChip>;
});
const ClosureKindFilter=memo(function ClosureKindFilter({value,isDisabled,onClear,onChange}:{value:string;isDisabled:boolean;onClear:()=>void;onChange:(value:string)=>void}){
  return <FilterChip active={value!=='all'} label="结束方式" isDisabled={isDisabled} title="按当前日期和结束方式筛选已处理事项" onClear={onClear} aria-label="结束方式" value={value} onChange={onChange}><ListBox.Item id="all" textValue="全部">全部<ListBox.ItemIndicator/></ListBox.Item><ListBox.Item id="completed" textValue="已完成">已完成<ListBox.ItemIndicator/></ListBox.Item><ListBox.Item id="dismissed" textValue="已关闭">已关闭<ListBox.ItemIndicator/></ListBox.Item></FilterChip>;
});
const EMPTY_CATEGORIES:readonly {category:string;category_name_zh:string}[]=[];
function Workbench({principal,realtime}:{principal:Principal;realtime:RealtimeView}){
  const [detailNavigationBlocked,setNavigationBlocked]=useState(false),[claimNavigationBlocked,setClaimNavigationBlocked]=useState(false);
  const [closureBlocked,setClosureBlocked]=useState(false);
  const navigationBlocked=detailNavigationBlocked||claimNavigationBlocked||closureBlocked;
  const [sorts,setSorts]=useState<Record<BoardColumn,BoardSort>>({pending:'oldest',active:'oldest',handled:'newest'});
  const [summarySelection,setSummarySelection]=useState<{scope:string;filter:BoardSummaryFilter|null}>({scope:'',filter:null});
  const [boardFilters,setBoardFilters]=useState({scope:'',category:'all',handler:'all'});
  const [conditionsTransition,setConditionsTransition]=useState(false),pendingConditionsRef=useRef<URLSearchParams|null>(null);
  const order=useRef<{scope:string;keys:string[]}>({scope:'',keys:[]});
  const [params,setParams]=useSearchParams(),location=useLocation(),selected=useParams(),now=useClock(),navigate=useNavigate();
  const locationMode=Boolean(selected.id&&params.get('locate')==='1');
  const validLocation=Boolean(principal.workbench_reminders_enabled&&locationMode&&['ticket','review','intake'].includes(selected.kind??'')&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(selected.id??''));
  const view=params.get('view')==='list'?'list':'board',range:BoardCompletionRange=params.get('range')==='custom'?'custom':params.get('range')==='all'?'all':principal.workbench_search_enabled&&params.get('search')==='1'&&!params.has('range')?'all':'recent',fullPage=Boolean(!locationMode&&selected.id&&params.get('detail')==='page');
  const handledFrom=params.get('handled_from')??'',handledTo=params.get('handled_to')??'';
  const handledDates=useMemo(()=>range==='custom'?{from:handledFrom,to:handledTo}:undefined,[range,handledFrom,handledTo]);
  const rangeKey=range+':'+(handledDates?.from??'')+':'+(handledDates?.to??'');
  const client=useQueryClient();
  const located=useQuery({queryKey:['reminder-locate',principal.principal_id,selected.kind,selected.id,principal.authorization_revision,principal.expires_epoch_ms],enabled:validLocation,retry:false,gcTime:0,
    queryFn:async({signal})=>{const detail=await api.detail(selected.kind??'',selected.id??'',null,signal);clearHoverItemDenied(principal.principal_id,detail.item.kind,detail.item.id,detail.item.number);return detail;}});
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
  const parsed=useMemo(()=>criteriaFromUrl(params,params.has('range')?range:'all',scope??'team'),[params,range,scope]),searchKey=parsed.criteria?searchCriteriaKey(parsed.criteria):'invalid';
  const searched=useWorkbenchSearch(principal,parsed.criteria,searchMode);
  const currentConditions=conditionLocationKey(params),searchConditionsBusy=conditionsTransition||searchMode&&searched.isFetching;
  useEffect(()=>{
    // Router has committed the next location (including Back/Forward). The
    // query's own fetching state then keeps read controls locked until settle.
    pendingConditionsRef.current=null;setConditionsTransition(false);
  },[location]);
  const basePending=useColumn(principal,'pending',range,scope,!searchMode,handledDates),baseActive=useColumn(principal,'active',range,scope,!searchMode,handledDates),baseHandled=useColumn(principal,'handled',range,scope,!searchMode,handledDates);
  const searchedDataByColumn=useMemo<Record<BoardColumn,ColumnQuery['data']>>(()=>{
    if(parsed.error||!searched.data)return {pending:undefined,active:undefined,handled:undefined};
    return {
      pending:{pages:searched.data.pages.map(page=>({items:page.items.filter(item=>item.column==='pending'),range:page.range}))},
      active:{pages:searched.data.pages.map(page=>({items:page.items.filter(item=>item.column==='active'),range:page.range}))},
      handled:{pages:searched.data.pages.map(page=>({items:page.items.filter(item=>item.column==='handled'),range:page.range}))},
    };
  },[parsed.error,searched.data]);
  const searchedColumn=(column:BoardColumn):ColumnQuery=>({...searched,isFetchingNextPage:searched.isFetching,
    data:searchedDataByColumn[column],
    refetch:searched.restart,fetchNextPage:()=>searched.isFetching?Promise.resolve():searched.fetchNextPage()});
  const pending:ColumnQuery=searchMode?searchedColumn('pending'):basePending,active:ColumnQuery=searchMode?searchedColumn('active'):baseActive,handled:ColumnQuery=searchMode?searchedColumn('handled'):baseHandled;
  const queries=[pending,active,handled];
  const pendingData=pending.data,activeData=active.data,handledData=handled.data;
  const fresh=useMemo(()=>{
    const map=new Map<string,WorkbenchCard>();
    for(const data of [pendingData,activeData,handledData]){
      if(!data)continue;
      for(const page of data.pages)for(const item of page.items)map.set(item.kind+':'+item.id,item);
    }
    return [...map.values()];
  },[pendingData,activeData,handledData]);
  const summaryScope=JSON.stringify([rangeKey,scope,searchMode,searchKey,principal.authorization_revision]);
  const filterScope=principal.principal_id+':'+summaryScope;
  const categoryFilter=!searchMode&&catalog.isSuccess&&!catalog.isError&&boardFilters.scope===filterScope?boardFilters.category:'all';
  const handlerFilter=!searchMode&&boardFilters.scope===filterScope?boardFilters.handler:'all';
  const prevHandlers=useRef<string[]>([]);
  const handlers=useMemo(()=>{
    const next=[...new Set(fresh.flatMap(item=>item.assignee_name?[item.assignee_name]:[]))];
    const prev=prevHandlers.current;
    if(prev.length===next.length&&prev.every((name,index)=>name===next[index]))return prev;
    prevHandlers.current=next;
    return next;
  },[fresh]);
  const prevSearchLoaded=useRef<WorkbenchCard[]>(EMPTY_WORKBENCH_CARDS);
  const searchLoaded=useMemo(()=>{
    const byRef=new Map<string,WorkbenchCard>();
    for(const item of fresh)if(item.source_group)byRef.set(item.source_group.ref,item);
    if(byRef.size===0)return EMPTY_WORKBENCH_CARDS;
    const next=[...byRef.values()],prev=prevSearchLoaded.current;
    if(prev.length===next.length&&prev.every((item,index)=>item.source_group?.ref===next[index]?.source_group?.ref&&item.source_group?.display_name===next[index]?.source_group?.display_name))return prev;
    prevSearchLoaded.current=next;
    return next;
  },[fresh]);
  const setBoardFilter=(key:'category'|'handler',value:string)=>setBoardFilters(current=>({scope:filterScope,category:current.scope===filterScope?current.category:'all',handler:current.scope===filterScope?current.handler:'all',[key]:value}));
  const mineAvailable=useMemo(()=>principal.workbench_follow_enabled===true&&fresh.every(item=>item.attention!==undefined),[principal.workbench_follow_enabled,fresh]);
  const summaryFilter=summarySelection.scope===summaryScope&&(summarySelection.filter!=='mine'||mineAvailable)?summarySelection.filter:null;
  // One presentation sequence drives columns, filtered results and detail navigation.
  const ordered=useMemo(()=>view==='board'?columns.flatMap(column=>{
    const sorted=sortBoardItems(fresh.filter(item=>item.column===column),column,sorts[column]);
    return column==='pending'?[...sorted.filter(item=>item.kind!=='ticket'),...sorted.filter(item=>item.kind==='ticket')]:column==='handled'?[...sorted.filter(item=>item.closure?.kind==='COMPLETED'),...sorted.filter(item=>item.closure?.kind==='DISMISSED')]:sorted;
  }):orderWorkTableItems(fresh),[view,fresh,sorts]);
  let unique=ordered;
  const holdOrder=principal.realtime_sse_enabled&&Boolean(selected.id)&&!fullPage&&!locationMode;
  const orderingScope=useMemo(()=>JSON.stringify([principal.principal_id,principal.authorization_revision,rangeKey,view,scope,summaryFilter,categoryFilter,handlerFilter,sorts,searchMode?searchKey:null]),[principal.principal_id,principal.authorization_revision,rangeKey,view,scope,summaryFilter,categoryFilter,handlerFilter,sorts,searchMode,searchKey]);
  if(!holdOrder||order.current.scope!==orderingScope)order.current={scope:orderingScope,keys:ordered.map(item=>item.kind+':'+item.id)};
  if(holdOrder){
    const keys=ordered.map(item=>item.kind+':'+item.id),present=new Set(keys);
    const retained=order.current.keys.filter(key=>present.has(key)),known=new Set(retained);order.current.keys=[...retained,...keys.filter(key=>!known.has(key))];
    // Keep only presentation IDs. Every displayed object still comes from the current authorized GET.
    const rank=new Map(order.current.keys.map((key,index)=>[key,index]));
    const ranked=[...ordered].sort((a,b)=>(rank.get(a.kind+':'+a.id)??0)-(rank.get(b.kind+':'+b.id)??0));
    // Freeze within the visible hierarchy; new keys must not sit behind unrelated groups in navigation.
    unique=view==='list'?orderWorkTableItems(ranked):columns.flatMap(column=>{
      const stage=ranked.filter(item=>item.column===column);
      return view==='board'&&column==='pending'?[...stage.filter(item=>item.kind!=='ticket'),...stage.filter(item=>item.kind==='ticket')]:view==='board'&&column==='handled'?[...stage.filter(item=>item.closure?.kind==='COMPLETED'),...stage.filter(item=>item.closure?.kind==='DISMISSED')]:stage;
    });
  }
  const pageLengths=(pendingData?.pages.length??0)+','+(activeData?.pages.length??0)+','+(handledData?.pages.length??0);
  const motionScope=orderingScope+':'+pageLengths;
  const allReady=queries.every(query=>!query.isPending&&!query.isError);
  const anyFetching=searchMode?searched.isFetching:basePending.isFetching||baseActive.isFetching||baseHandled.isFetching;
  const arrivals=useBoardArrivals(unique,motionScope,allReady&&!anyFetching,!searchMode&&!fullPage&&!locationMode,view==='board'&&!holdOrder);
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
    const next=new URLSearchParams(params);next.set('range',value);for(const key of ['handled_from','handled_to','cursor','limit'])next.delete(key);
    if(value==='custom'&&dates){next.set('handled_from',dates.from);next.set('handled_to',dates.to);}commitConditions(next);
  };
  const refresh=()=>{if(searchConditionsBusy)return;if(['offline','reconnecting','polling'].includes(realtime.status)&&realtime.reconnect){realtime.reconnect();if(!searchMode)return;}if(searchMode){if(!searched.isFetching)void searched.restart();}else{void pending.refetch();void active.refetch();void handled.refetch();}};
  const applySearch=(criteria:WorkbenchSearchCriteria)=>{
    const next=new URLSearchParams(params);for(const key of SEARCH_KEYS)next.delete(key);for(const key of ['handled_from','handled_to','cursor','limit'])next.delete(key);
    for(const [key,value]of searchParameters(criteria))next.set(key,value);next.set('search','1');commitConditions(next);
  };
  const leaveSearch=()=>{const next=new URLSearchParams(params),keep=new Set(['range','scope',...(range==='custom'?['handled_from','handled_to']:[])]);for(const key of SEARCH_KEYS)if(!keep.has(key))next.delete(key);next.delete('search');next.delete('cursor');next.delete('limit');commitConditions(next);};
  const closureKind=searchMode?(parsed.criteria?.closure_kind??'all'):'all';
  const applyClosureKind=(value:string)=>{
    if(navigationBlocked)return;
    const next=new URLSearchParams(params);for(const key of ['cursor','limit'])next.delete(key);
    if(value==='completed'||value==='dismissed')next.set('closure_kind',value);else next.delete('closure_kind');
    next.set('range',range);next.set('search','1');commitConditions(next);
  };
  const label=(column:BoardColumn)=>names[column];
  const filterNow=summaryFilter?now:0;
  const visibleItems=useCallback((loaded:WorkbenchCard[])=>loaded.filter(item=>(!locatedItem||item.kind!==locatedItem.kind||item.id!==locatedItem.id)&&(!summaryFilter||matchesBoardSummary(item,summaryFilter,filterNow))&&(categoryFilter==='all'||(categoryFilter==='unclassified'?!item.service:item.service?.category===categoryFilter))&&(handlerFilter==='all'||(handlerFilter==='unassigned'?!item.assignee_name:handlerFilter==='name:'+item.assignee_name))),[locatedItem,summaryFilter,filterNow,categoryFilter,handlerFilter]);
  const returnParameters=new URLSearchParams(params);returnParameters.delete('locate');returnParameters.delete('detail');
  const returnBoard='/'+(returnParameters.size?'?'+returnParameters:'');
  const visibleUnique=useMemo(()=>visibleItems(unique),[visibleItems,unique]);
  const prevColumnLoaded=useRef<Record<BoardColumn,WorkbenchCard[]>>({pending:[],active:[],handled:[]});
  const columnLoaded=useMemo(()=>{
    const next:Record<BoardColumn,WorkbenchCard[]>={pending:[],active:[],handled:[]};
    for(const item of visibleUnique)next[item.column].push(item);
    for(const column of columns){
      const prev=prevColumnLoaded.current[column];
      if(prev.length===next[column].length&&prev.every((item,index)=>item===next[column][index]))next[column]=prev;
    }
    prevColumnLoaded.current=next;
    return next;
  },[visibleUnique]);
  const sortHandlers=useMemo<Record<BoardColumn,(value:BoardSort)=>void>>(()=>({
    pending:value=>setSorts(current=>current.pending===value?current:{...current,pending:value}),
    active:value=>setSorts(current=>current.active===value?current:{...current,active:value}),
    handled:value=>setSorts(current=>current.handled===value?current:{...current,handled:value}),
  }),[]);
  const motionItems=useMemo(()=>visibleUnique.map(item=>({kind:item.kind,id:item.id,intake_id:item.intake_id,column:item.column,closure_kind:item.closure?.kind??null})),[visibleUnique]);
  const motionSequence=useMemo(()=>view+':'+categoryFilter+':'+handlerFilter+':'+summaryFilter+':'+visibleUnique.map(item=>item.kind+':'+item.id+':'+item.column+':'+(item.closure?.kind??'')).join('|'),[view,categoryFilter,handlerFilter,summaryFilter,visibleUnique]);
  const motion=useBoardCardMotion({
    view,
    principalId:principal.principal_id,
    items:motionItems,
    sequence:motionSequence,
    refreshing:anyFetching,
    ready:allReady,
    scope:motionScope,
    arrivalKeys:arrivals.arrivalKeys,
  });
  const animateCounts=useMotionScopeReady(motionScope,queries.every(query=>!query.isPending),anyFetching);
  const summaryMotionScope=JSON.stringify([principal.principal_id,principal.authorization_revision,rangeKey,view,scope,searchMode?searchKey:null,pageLengths]);
  const animateSummaryCounts=useMotionScopeReady(summaryMotionScope,queries.every(query=>!query.isPending),anyFetching);
  const filtered=Boolean(searchMode||summaryFilter||categoryFilter!=='all'||handlerFilter!=='all');
  const filteredEmpty=filtered&&queries.every(query=>!query.isPending&&!query.isError&&!query.isFetching&&!query.hasNextPage)&&visibleUnique.length===0&&!parsed.error;
  const clearFilters=()=>{
    if(navigationBlocked||searchConditionsBusy)return;
    setSummarySelection({scope:summaryScope,filter:null});setBoardFilters({scope:filterScope,category:'all',handler:'all'});
    if(searchMode){const next=new URLSearchParams(params);for(const key of [...SEARCH_KEYS,'search','cursor','limit'])next.delete(key);next.set('range','all');next.set('scope','team');commitConditions(next);}
  };
  const refreshRef=useRef(refresh);refreshRef.current=refresh;
  const stableRefresh=useCallback(()=>{refreshRef.current();},[]);
  const applyClosedRangeRef=useRef(applyClosedRange);applyClosedRangeRef.current=applyClosedRange;
  const stableApplyClosedRange=useCallback((value:BoardCompletionRange,dates?:{from:string;to:string})=>{applyClosedRangeRef.current(value,dates);},[]);
  const applySearchRef=useRef(applySearch);applySearchRef.current=applySearch;
  const stableApplySearch=useCallback((criteria:WorkbenchSearchCriteria)=>{applySearchRef.current(criteria);},[]);
  const leaveSearchRef=useRef(leaveSearch);leaveSearchRef.current=leaveSearch;
  const stableLeaveSearch=useCallback(()=>{leaveSearchRef.current();},[]);
  const applyClosureKindRef=useRef(applyClosureKind);applyClosureKindRef.current=applyClosureKind;
  const stableApplyClosureKind=useCallback((value:string)=>{applyClosureKindRef.current(value);},[]);
  const clearClosureKind=useCallback(()=>{applyClosureKindRef.current('all');},[]);
  const setBoardFilterRef=useRef(setBoardFilter);setBoardFilterRef.current=setBoardFilter;
  const stableSetCategory=useCallback((value:string)=>{setBoardFilterRef.current('category',value);},[]);
  const stableClearCategory=useCallback(()=>{setBoardFilterRef.current('category','all');},[]);
  const stableSetHandler=useCallback((value:string)=>{setBoardFilterRef.current('handler',value);},[]);
  const stableClearHandler=useCallback(()=>{setBoardFilterRef.current('handler','all');},[]);
  const summaryScopeRef=useRef(summaryScope);summaryScopeRef.current=summaryScope;
  const stableSelectSummary=useCallback((filter:BoardSummaryFilter|null)=>{setSummarySelection({scope:summaryScopeRef.current,filter});},[]);
  const updateRef=useRef(update);updateRef.current=update;
  const followEnabledRef=useRef(principal.workbench_follow_enabled);followEnabledRef.current=principal.workbench_follow_enabled;
  const stableSetScope=useCallback((value:'team'|'related')=>{if(followEnabledRef.current)updateRef.current('scope',value);},[]);
  const stableSetView=useCallback((value:'board'|'list')=>{updateRef.current('view',value);},[]);
  const onBoardOpenImpl=({intent,selector}:{intent:Parameters<typeof itemLink>[0];selector:string})=>{if(!navigationBlocked)void navigate(itemLink(intent,location.search),{state:{fromBoard:true,boardActionIntent:intent,boardActionSelector:selector}});};
  const onBoardOpenRef=useRef(onBoardOpenImpl);onBoardOpenRef.current=onBoardOpenImpl;
  const stableOnBoardOpen=useCallback((entry:{intent:Parameters<typeof itemLink>[0];selector:string})=>{onBoardOpenRef.current(entry);},[]);
  const handledEarlierAction=useMemo(()=>!searchMode&&(range==='recent'||range==='custom')?<Button tone="ghost" data-action="view-earlier" isDisabled={navigationBlocked} onPress={()=>stableApplyClosedRange('all')}>查看更早</Button>:null,[searchMode,range,navigationBlocked,stableApplyClosedRange]);
  const categories=catalog.data?.categories??EMPTY_CATEGORIES;
  const searchHasCriteria=Boolean(searchMode&&parsed.criteria&&hasSearchCriteria(parsed.criteria));
  const filterSummary=[searchMode?(parsed.criteria?.q?'搜索「'+parsed.criteria.q+'」':'当前搜索条件'):null,summaryFilter?'已选工作概况':null,categoryFilter!=='all'?'类别「'+(catalog.data?.categories.find(item=>item.category===categoryFilter)?.category_name_zh??'未分类')+'」':null,handlerFilter!=='all'?'处理人「'+(handlerFilter==='unassigned'?'未领取':handlerFilter.replace('name:',''))+'」':null].filter(Boolean).join(' · ');
  return <Shell principal={principal} realtime={realtime} navigationBlocked={navigationBlocked}><ClosureActionsProvider principal={principal} otherBlocked={detailNavigationBlocked||claimNavigationBlocked} onBlockedChange={setClosureBlocked}><BoardActions principal={principal} blocked={navigationBlocked} onClaimBlocked={setClaimNavigationBlocked} selectionKey={location.pathname+location.search} onOpen={stableOnBoardOpen}>{!fullPage?<div className="workspace ds-page"><BoardPageHeader searchConditionsBusy={searchConditionsBusy} onRefresh={stableRefresh} principal={principal} navigationBlocked={navigationBlocked}/>
    <Toolbar className={'ds-board-toolbar'+(view==='list'?' ds-list-toolbar':'')}>
      <div className="ds-board-toolbar-top">
        <BoardSummary items={fresh} now={now} selected={summaryFilter} onSelect={stableSelectSummary} mineAvailable={mineAvailable} loading={queries.some(query=>query.isPending)} partial={queries.some(query=>query.isError)} blocked={navigationBlocked||searchConditionsBusy} scope={scope??'team'} relatedAvailable={principal.workbench_follow_enabled===true} onScope={stableSetScope} animateCount={animateSummaryCounts}/>
        <ViewTabs view={view} onView={stableSetView}/>
      </div>
      <div className="ds-board-toolbar-bottom">
        {principal.workbench_search_enabled?<div className="ds-board-search"><Search aria-hidden="true"/>{view==='board'?<kbd>/</kbd>:null}<SearchControls inlineLeave={view==='list'} principal={principal} criteria={parsed.criteria} active={searchMode} loaded={searchLoaded} blocked={navigationBlocked} busy={searchConditionsBusy} onApply={stableApplySearch} onLeave={stableLeaveSearch}/></div>:searchRequested?<p role="status">搜索入口当前关闭，已返回原分页看板。</p>:null}
        {principal.workbench_search_enabled?<span className="ds-board-toolbar-divider" aria-hidden="true"/>:null}
        <div className="ds-board-filter-layout"><div className="ds-board-filter-row" role="group" aria-label="筛选已加载事项" title="类别和处理人仅筛选已加载事项">
          {catalog.data||searchMode?<CategoryFilter categories={categories} value={categoryFilter} isDisabled={navigationBlocked||searchMode||catalog.isError} onClear={stableClearCategory} onChange={stableSetCategory}/>:null}
          <HandlerFilter handlers={handlers} value={handlerFilter} isDisabled={navigationBlocked||searchMode} onClear={stableClearHandler} onChange={stableSetHandler}/>
          {view==='list'&&principal.workbench_search_enabled?<ClosureKindFilter value={closureKind} isDisabled={navigationBlocked||searchConditionsBusy} onClear={clearClosureKind} onChange={stableApplyClosureKind}/>:null}
        </div>
          {categoryFilter!=='all'&&handlerFilter!=='all'?<Button tone="ghost" data-action="clear-board-filters" isDisabled={navigationBlocked||searchMode} onPress={()=>setBoardFilters({scope:filterScope,category:'all',handler:'all'})}>清除</Button>:null}
        </div>
        <BoardDatePresets range={range} dates={handledDates} now={now} blocked={navigationBlocked||searchConditionsBusy} onApply={stableApplyClosedRange}/>
      </div>
    </Toolbar>
    {searchMode&&searched.isError?<InlineAlert tone="danger" data-search-state="error">查询未完成，请重新读取。搜索输入仍保留。</InlineAlert>:null}
    {searchMode&&filteredEmpty?<EmptyState title={searchEmptyMessage(parsed.criteria)} {...(searchHasCriteria?{variant:'filtered',summary:filterSummary,onClear:clearFilters}:{})} data-search-state="empty"/>:null}
    {locationMode?<section ref={locatedSection} className="reminder-location" aria-label="已定位事项"><div className="column-heading"><h2>已定位事项</h2><Link to={returnBoard}>返回当前工作台</Link></div>
      {!validLocation?<Message text="当前提醒定位不可用，请重新选择有效事项。"/>:located.isPending?<Message text="正在加载…"/>:located.isError?<Message text={located.error instanceof ApiError&&[403,404].includes(located.error.status)?'该事项当前不可读取，旧定位资料已清除。':'本次定位未完成，原定位目标已保留。'} {...(located.error instanceof ApiError&&[401,403,404].includes(located.error.status)?{}:{retry:()=>{void located.refetch();}})}/>:locatedItem?<Card item={locatedItem} principal={principal} search={location.search} selected={true} now={now} blocked={navigationBlocked} located={true}/>:null}
    </section>:null}
    {searchMode&&searched.error instanceof ApiError&&searched.error.code==='SEARCH_REFRESH_REQUIRED'?<InlineAlert tone="warning" data-search-refresh-required>{errorMessage(searched.error)}</InlineAlert>:null}
    {searchMode&&parsed.error?<Message text={parsed.error}/>:filteredEmpty&&!searchMode?<EmptyState variant="filtered" title="没有符合条件的工单" summary={filterSummary} onClear={clearFilters}/>:view==='board'?<div className="board" data-search-state={searchMode&&searched.isError?'error':undefined}>{columns.map((column,index)=>{const query=queries[index];return query?<BoardSection key={column+':'+rangeKey+':'+scope+':'+(searchMode?searchKey:'board')} principal={principal} isPending={query.isPending} isError={query.isError} hasData={Boolean(query.data)} isFetching={query.isFetching} isFetchingNextPage={query.isFetchingNextPage} hasNextPage={query.hasNextPage} firstPageRange={query.data?.pages[0]?.range} firstPageGroupCounts={query.data?.pages[0]?.group_counts} refetch={query.refetch} fetchNextPage={query.fetchNextPage} loaded={columnLoaded[column]} column={column} label={label(column)} earlierAction={column==='handled'?handledEarlierAction:null} search={location.search} selected={selected.id} now={now} filtered={filtered} blocked={navigationBlocked} preserveOrder={Boolean(holdOrder)} newCount={motion.boardChips[column].count} newDirection={motion.boardChips[column].direction} onReveal={motion.boardChips[column].activate} animateCount={animateCounts} sort={sorts[column]} onSort={sortHandlers[column]}/>:null;})}</div>:<>
      <WorkTable principalId={principal.principal_id} selected={selected.id} now={now} closureKind={closureKind} animateCount={animateCounts} newChip={{count:motion.listChip.count,direction:motion.listChip.direction,onActivate:motion.listChip.activate}} searchError={searchMode&&searched.isError} refreshing={queries.some(query=>Boolean(query.data)&&query.isFetching&&!query.isFetchingNextPage)} stale={queries.some(query=>Boolean(query.data)&&query.isError)} headerFeedback={queries.some(query=>Boolean(query.data)&&query.isError)?<StaleRetry onRetry={refresh}/>:null}
        renderLink={(item,content)=><BoardActionCard item={item}><Link draggable={false} className="row-link card-open" to={itemLink(item,location.search)} state={{fromBoard:true}} title={item.title}>{content}</Link></BoardActionCard>}
        renderOwnerLink={(item,owner,content)=><CardLink draggable={false} className="ds-list-owner ds-list-owner-link" to={itemLink(item,location.search)} state={FROM_BOARD_STATE} title={owner} aria-disabled={navigationBlocked||undefined} onClick={event=>{guardCardOwnerClick(event,navigationBlocked);}}>{content}</CardLink>}
        renderFollowUp={item=><SharedFollowUpSummary value={item.follow_up_schedule} compact/>} relativeTime={relativeTime}
        groups={columns.flatMap((column,index)=>{const query=queries[index];if(!query||closureKind!=='all'&&column!=='handled')return [];const loaded=visibleItems(unique.filter(item=>item.column===column));return [{column,label:label(column),items:loaded,count:query.isPending?'…':query.isError&&!query.data?'—':loaded.length,loading:query.isPending&&!query.data,onRetry:()=>{void query.refetch();},
          feedback:query.isError&&!query.data?<ErrorState title={label(column)+'没有读出来'} onRetry={()=>{void query.refetch();}}/>:!loaded.length&&!query.isPending&&column==='pending'&&!filtered?<EmptyState size="block" title="待受理已清空" tone="success" description="新报修进来会出现在这里"/>:null,
          nextPage:query.hasNextPage?<Button className="load-more" tone="ghost" isDisabled={query.isFetchingNextPage} onPress={()=>{void query.fetchNextPage();}}>加载下一页</Button>:null}];})}/></>}

    <div className="range-bar sr-only" data-loaded-count><span>{queries.some(query=>query.isError)?'部分事项读取失败':'已加载 '+unique.length+' 项'}</span></div>
    </div>:null}
    {!fullPage?<HoverCardsBoardBridge items={fresh} range={range} handledDates={handledDates} searchMode={searchMode} now={now} onFilterByPerson={name=>stableSetHandler('name:'+name)}/>:null}
    <Detail key={principal.principal_id} open={Boolean(selected.id&&!locationMode)} itemKind={selected.kind??''} itemId={selected.id??''} principal={principal} items={visibleItems(view==='list'&&closureKind!=='all'?unique.filter(item=>item.column==='handled'):unique)} now={now} fullPage={fullPage} onNavigationBlocked={setNavigationBlocked}/>
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
