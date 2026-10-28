import {WorkbenchLink as Link} from './WorkbenchLink';
import {Avatar,Chip,Drawer} from '@heroui/react';
import {Table as HTable} from "@heroui/react";
import {ProcessedDatePicker} from './ProcessedDatePicker';
import {WorkbenchButton as HButton} from './WorkbenchButton';
import {Form as HForm,Input as HInput,Label as HLabel,Link as HLink,ListBox} from "@heroui/react";
import {WorkbenchSelect} from "./WorkbenchSelect";
import {WorkbenchDisclosure} from "./WorkbenchDisclosure";
import {SearchControls,criteriaFromUrl,useWorkbenchSearch,searchEmptyMessage} from '../features/search/WorkbenchSearch';
import {SEARCH_KEYS,searchCriteriaKey,searchParameters} from '../../../../shared/workbench-search-contracts.mjs';
import type {WorkbenchSearchCriteria} from '../../../../contracts/workbench_search_contracts';
import {BoardActions,BoardActionCard,BoardDropColumn,BoardActionNotice} from '../features/board-actions/BoardActions';
import {readBoardIntent} from '../features/board-actions/intent';
import {WorkbenchReminders} from '../features/reminders/WorkbenchReminders';
import {useDesktopSession} from '../desktop/host';
import {WebReportUrgency} from '../features/web-report/WebReportUrgency';
import {ItemFollow} from '../features/item-follow/ItemFollow';
import {NotificationExceptions} from '../features/notification-exceptions/NotificationExceptions';
import {TicketWaitingActions,TicketCancellation} from '../features/ticket-waiting/TicketWaitingActions';
import {useEffect,useRef,useState} from 'react';
import type {MouseEvent,ReactNode} from 'react';
import {useLocation,useNavigate,useParams,useSearchParams} from 'react-router';
import {useInfiniteQuery,useQuery,useMutation,useQueryClient} from '@tanstack/react-query';
import {Button} from '@heroui/react/button';
import {LayoutGrid,List,MessageSquare,TriangleAlert,Bell,Settings,ChevronDown,ChevronUp,ArrowUpRight,RefreshCw,ArrowLeft,X,Search,Activity,Headset,UserRound,Building2,MapPin,Radio,Ticket,Clock3,Phone} from 'lucide-react';
import {MorphIcon} from 'morphicons/react';
import {PanelLeftClose as CollapseData,PanelLeftOpen as ExpandData} from 'lucide';
import {createColumnHelper,tableFeatures,useTable} from '@tanstack/react-table';
import {api,ApiError,errorMessage,statusLabels} from '../api/client';
import type {BoardColumn,BoardCompletionRange,WorkbenchCard,WorkbenchDetail,Principal} from '../api/client';
import {useUiStore} from './ui-store';
import {ActivityTimeline} from './DetailPresentation';
import {DetailDialogProvider} from './DetailDialog';
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
import {ReportMaterialsSection} from '../features/attachments/ReportMaterialsSection';
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
import {ActivityPeople} from '../features/activity/ActivityPeople';
import type {RealtimeView} from '../realtime/useRealtime';

import {BoardColumnLoading} from './WorkbenchLoading';

const names:Record<BoardColumn,string>={pending:'待受理',active:'处理中',closed:'已处理'};
const columns:readonly BoardColumn[]=['pending','active','closed'];
const statusColors:Record<string,string>={NEW:'yellow',QUEUED:'yellow',ACCEPTED:'yellow',PENDING:'yellow',RECEIVED:'yellow',WAITING_TRIAGE:'yellow',REOPENED:'orange',WAITING_DESCRIPTION:'orange',WAITING_REQUESTER:'orange',IN_PROGRESS:'blue',WAITING_VENDOR:'blue',CLOSED:'green',RESOLVED:'green',FAILED:'red'};
function useColumn(principal:Principal,column:BoardColumn,range:BoardCompletionRange,scope?:'team'|'related',enabled=true,dates?:{from:string;to:string}){
  return useInfiniteQuery({queryKey:['board',principal.principal_id,column,range,...(scope?[scope,principal.authorization_revision,principal.expires_epoch_ms]:[]),...(dates?[dates.from,dates.to]:[])],initialPageParam:null as string|null,
    enabled,queryFn:({pageParam,signal})=>api.board(column,range,pageParam,signal,scope,dates),getNextPageParam:p=>p.next_cursor??undefined});
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
  return <><Chip className={'status-chip '+(statusColors[item.status]??'gray')}>{statusLabels[item.status]??'状态待确认'}</Chip>{item.kind==='ticket'&&item.review_reason?<Chip className="status-chip yellow">待复核</Chip>:null}</>;
}
function TeamAvatar({name}:{name:string}){
  let color=0;for(const character of name)color=(color*31+(character.codePointAt(0)??0))>>>0;
  return <Avatar aria-hidden="true" className={'avatar av'+(color%4+1)}><Avatar.Fallback>{Array.from(name).at(-1)}</Avatar.Fallback></Avatar>;
}
function Owner({name,compact=false}:{name:string|null;compact?:boolean}){
  return <span className="owner">{name?<TeamAvatar name={name}/>:<Avatar aria-hidden="true" className="avatar unassigned"><Avatar.Fallback>—</Avatar.Fallback></Avatar>}<span className="owner-name">{name??(compact?'未领取':'等待领取')}</span></span>;
}
function SharedFollowUpSummary({value}:{value:WorkbenchCard['follow_up_schedule']}){
  if(!value)return null;
  return <p className={'shared-follow-up-summary'+(value.is_due?' is-due':'')}>
    <strong>共享跟进 · {value.is_due?'已到期':'已安排'}</strong>
    <time dateTime={value.due_at.replace(' ','T')+'+08:00'}>{value.due_at}（北京时间）</time>
  </p>;
}
function ReporterDisplay({item,principal,detail=false,requested}:{item:WorkbenchCard;principal:Principal;detail?:boolean;requested?:WorkbenchDetail['requested_item']}){
  const profile=useQuery({queryKey:['reporter-profile',principal.principal_id,item.kind,item.id,principal.authorization_revision],queryFn:({signal})=>api.reporterProfile(item.kind,item.id,signal),
    enabled:principal.web_reports_enabled===true&&item.source==='PORTAL'&&!item.reporter_name&&!item.reporter_department,staleTime:300_000,gcTime:300_000,retry:false});
  const name=item.reporter_name??profile.data?.name??(item.reporter_profile?'报修人姓名暂不可用':'报修人姓名未提供'),department=item.reporter_department??profile.data?.department??(item.reporter_profile?'部门暂不可用':'部门未提供');
  const title=name+' · '+department+(item.reporter_profile?.source==='LATER_LOOKUP'?'（资料取得于 '+item.reporter_profile.captured_at+'）':profile.data?.current?'（当前企业微信资料）':'');
  return detail?<><div className="property-field"><dt><UserRound size={17}/>报修人</dt><dd title={title}>{item.reporter_name||profile.data?.name?<Owner name={name}/>:<span>{name}</span>}</dd></div><div className="property-field"><dt><Building2 size={17}/>报修部门</dt><dd title={title}>{department}{profile.data?.current?<small>（当前资料）</small>:null}</dd></div></>:<p className="card-meta" title={title}>{name} · {department}</p>;
}
function ReporterContact({item,principal,requested}:{item:WorkbenchCard;principal:Principal;requested:WorkbenchDetail['requested_item']}){
  const contact=useQuery({queryKey:['reporter-contact',principal.principal_id,requested?.kind??item.kind,requested?.id??item.id,principal.authorization_revision],queryFn:({signal})=>api.reporterContact(item.id,signal),enabled:item.kind==='ticket',retry:false,gcTime:0});
  const phone=contact.isError?null:contact.data?.phone,mobile=phone?.replace(/[\s+-]/gu,'').replace(/^86(?=1[3-9]\d{9}$)/u,''),formatted=mobile&&/^1[3-9]\d{9}$/u.test(mobile)?mobile.slice(0,3)+'-'+mobile.slice(3,7)+'-'+mobile.slice(7):phone;
  return <div className="property-field reporter-contact"><dt><Phone size={17}/>联系电话</dt><dd><span className="reporter-phone">{formatted??(item.kind==='ticket'&&contact.isPending?'正在读取…':contact.isError?'暂不可用':'未提供')}</span></dd></div>;
}
function Card({item,principal,search,selected,now,located=false}:{item:WorkbenchCard;principal:Principal;search:string;selected:boolean;now:number;located?:boolean}){
  return <article className={'ticket-card '+(selected?'is-selected':'')} data-kind={item.kind} data-item-id={item.id} data-reminder-located={located?'true':undefined}>
    <BoardActionCard item={item}><Link draggable={false} className="card-open" to={itemLink(item,search)} state={{fromBoard:true}}>
      <div className="card-top"><span>{item.number}</span></div>
      <h3>{item.title}</h3>
      <ReporterDisplay item={item} principal={principal}/>
      <div className="card-tags"><Status item={item}/><span className="neutral-chip" title={item.source_label}>{item.source_label}</span><WebReportUrgency value={item.web_report_urge}/></div>
      <SharedFollowUpSummary value={item.follow_up_schedule}/><SupplementFollowUpSummary pending={item.supplement_follow_up?.has_pending_supplements}/>
      <footer className="card-footer">{item.column!=='pending'||item.assignee_name?<Owner name={item.assignee_name}/>:null}<time className="activity-time" dateTime={item.updated_at.replace(' ','T')+'+08:00'} title={'最新活动：'+item.updated_at+'（北京时间）'}>更新 {relativeTime(item.updated_at,now)}</time></footer>
      <span className="sr-only">查看详情</span>
    </Link></BoardActionCard>
  </article>;
}
function More({expanded,count,onClick,controls}:{expanded:boolean;count:number;onClick:()=>void;controls:string}){
  return count>3?<HButton className="column-more" data-action="expand-column" aria-expanded={expanded} aria-controls={controls} onClick={onClick} variant="secondary">{expanded?<ChevronUp size={14}/>:<ChevronDown size={14}/>}<span>{expanded?'收起':('还有 '+(count-3)+' 项')}</span><span className="sr-only">（当前已加载范围）</span></HButton>:null;
}
const tableFeaturesForWork=tableFeatures({});
const tableHelper=createColumnHelper<typeof tableFeaturesForWork,WorkbenchCard>();
function WorkList({items,search,selected,now,column,label}:{items:WorkbenchCard[];search:string;selected:string|undefined;now:number;column:BoardColumn;label:string}){
  const [expanded,setExpanded]=useState(false),visible=expanded?items:items.slice(0,3);
  const tableColumns=tableHelper.columns([
    tableHelper.accessor('number',{header:'编号'}),
    tableHelper.accessor('title',{header:'问题',cell:({row})=><><Link className="row-link" to={itemLink(row.original,search)} state={{fromBoard:true}} title={row.original.title}>{row.original.title}<span className="sr-only">查看详情</span></Link><SharedFollowUpSummary value={row.original.follow_up_schedule}/><SupplementFollowUpSummary pending={row.original.supplement_follow_up?.has_pending_supplements}/></>}),
    tableHelper.accessor('status',{header:'状态',cell:({row})=><><Status item={row.original}/><WebReportUrgency value={row.original.web_report_urge}/></>}),
    tableHelper.accessor('source_label',{header:'来源',cell:({row})=><span className="neutral-chip">{row.original.source_label}</span>}),
    tableHelper.accessor('location',{header:'位置',cell:({getValue})=>getValue()??'未提供'}),
    tableHelper.accessor('reporter_name',{header:'报修人',cell:({getValue})=>getValue()??'未提供'}),
    tableHelper.accessor('assignee_name',{header:'负责人',cell:({getValue})=><Owner name={getValue()} compact/>}),
    tableHelper.accessor('updated_at',{header:'最新活动',cell:({getValue})=><time className="activity-time" title={getValue()+'（北京时间）'}>{relativeTime(getValue(),now)}</time>}),
  ]);
  const table=useTable({features:tableFeaturesForWork,columns:tableColumns,data:visible,getRowId:row=>row.kind+':'+row.id});
  // Server order and cursors stay authoritative; folding does not claim full-range totals or filtering.
  return <section className="list-group" aria-label={label}><div className="column-heading"><h2 className={'stage-pill '+column}>{label}</h2><span>{items.length} 已加载</span></div>
    <div className="table-wrap" id={'list-'+column}><HTable variant="secondary"><HTable.ScrollContainer><HTable.Content aria-label={label+'事项列表'} className="work-table"><HTable.Header>{table.getFlatHeaders().map(header=><HTable.Column key={header.id} id={header.id} isRowHeader={header.index===0}><table.FlexRender header={header}/></HTable.Column>)}</HTable.Header><HTable.Body>{table.getRowModel().rows.map(row=><HTable.Row className={row.original.id===selected?'is-selected':''} key={row.id} id={row.id}>{row.getAllCells().map(cell=><HTable.Cell key={cell.id}><span title={typeof cell.getValue()==='string'?String(cell.getValue()):undefined}><table.FlexRender cell={cell}/></span></HTable.Cell>)}</HTable.Row>)}</HTable.Body></HTable.Content></HTable.ScrollContainer></HTable></div>
    <More expanded={expanded} count={items.length} controls={'list-'+column} onClick={()=>setExpanded(value=>!value)}/>
  </section>;
}
function Shell({principal,children,navigationBlocked=false,realtime}:{principal:Principal;children:ReactNode;navigationBlocked?:boolean;realtime:RealtimeView}){
  const desktopEpoch=useDesktopSession(principal,realtime,navigationBlocked);
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
  const currentPath=useLocation().pathname,exceptionPage=currentPath.startsWith('/notification-exceptions'),conversationPage=currentPath.startsWith('/conversations'),settings=currentPath.startsWith('/settings/');
  const guardNavigation=(event:MouseEvent<HTMLAnchorElement>)=>{if(navigationBlocked)event.preventDefault();};
  return <div className={'app '+(collapsed?'sidebar-collapsed':'')} data-realtime-status={realtime.status}><aside className="sidebar" aria-label="主导航">
    {principal.workbench_search_enabled?<Link className="sidebar-search" to="/?search=1" aria-disabled={navigationBlocked} onClick={guardNavigation}><Search size={16}/><span>搜索工作区</span></Link>:null}
    <p className="nav-label">工作空间</p><Link className={'nav-item '+(!settings&&!conversationPage&&!exceptionPage?'current':'')} to="/" aria-current={!settings&&!conversationPage&&!exceptionPage?'page':undefined} aria-disabled={navigationBlocked} onClick={guardNavigation} title="工作台"><LayoutGrid/><span>工作台</span></Link>
    <>{principal.conversation_workspace_enabled?<Link className={"nav-item "+(conversationPage?"current":"")} to="/conversations" aria-current={conversationPage?"page":undefined} aria-disabled={navigationBlocked} onClick={guardNavigation} data-action="open-conversations"><MessageSquare/><span>会话</span></Link>:null}</>{principal.incident_candidate_workspace_enabled?<Link className="nav-item" to="/incidents/candidates" data-action="open-incident-candidates" aria-disabled={navigationBlocked} onClick={guardNavigation}><TriangleAlert/><span>公共故障</span></Link>:null}<>{principal.notification_exceptions_enabled?<Link className={"nav-item "+(exceptionPage?"current":"")} to="/notification-exceptions" data-action="open-notification-exceptions" aria-disabled={navigationBlocked} onClick={guardNavigation}><Bell/><span>通知异常</span></Link>:null}</>
    <div className="sidebar-note">共同协作，清楚交接。</div><div className="sidebar-bottom"><HButton type="button" className="nav-item" data-action="open-settings" aria-haspopup="dialog" isDisabled={navigationBlocked} onClick={openSettings} variant="secondary"><Settings/><span>设置</span></HButton><div className="account"><TeamAvatar name={displayName}/><div><strong>{displayName}</strong><small>{department??(profile.isPending&&principal.current_profile_available?'正在读取部门…':'部门资料未提供')}</small></div></div></div></aside>
    <main><header className="topbar"><HButton className="icon-button" aria-label={collapsed?'展开侧栏':'收起侧栏'} onClick={toggle} variant="secondary"><MorphIcon icon={collapsed?ExpandData:CollapseData} size={18} reducedMotion="user"/></HButton><span>信息服务团队 <span className="slash">/</span> <strong>{settings?'设置':conversationPage?'服务会话':exceptionPage?'通知异常':'工作台'}</strong></span><div className="topbar-actions"><HButton type="button" className="compact-settings icon-button" data-action="open-settings" aria-label="设置" isDisabled={navigationBlocked} onClick={openSettings} variant="secondary"><Settings size={16}/></HButton>{principal.logout_enabled?<HButton type="button" data-action="logout-workbench" isDisabled={logout.isPending} onClick={()=>logout.mutate()} variant="secondary">{logout.isPending?'正在退出…':'退出工作台'}</HButton>:null}</div></header><WorkbenchReminders principal={principal} realtime={realtime} navigationBlocked={navigationBlocked} desktopEpoch={desktopEpoch}/>{children}</main></div>;
}
function TicketNextStep({status}:{status:string}){
  const steps:Record<string,[string,string]>={
    NEW:['接单后开始处理','点击“接单”，领取工单并开始排查。'],
    QUEUED:['接单后开始处理','点击“接单”，领取工单并开始排查。'],
    ACCEPTED:['工单已接单','准备就绪后，点击“接单”开始排查。'],
    REOPENED:['仍未解决，请重新接单','保留原工单号。请重新接单，再继续处理。'],
    IN_PROGRESS:['继续处理报修','信息不足时，点击“等待补充”。故障排除后，填写处理结果并完工。'],
    WAITING_REQUESTER:['等待报修人补充','网页补充收到后会自动恢复处理。电话或会话补充请先核对，再点击“恢复处理”。'],
    WAITING_VENDOR:['等待厂商处理','请跟进厂商进度。可以继续排查时，点击“恢复处理”。'],
    RESOLVED:['等待报修人确认','请回访报修人，确认故障是否解决。'],
    CLOSED:['已完工，请回访','请确认故障是否解决。同一故障仍未解决时，点击“重开此工单”。'],
    CANCELLED:['工单已取消','请查看取消原因。如需处理新的故障，请新建报修。'],
  };
  const step=steps[status];
  return step?<section className="workflow-next" aria-label="当前处理步骤"><h3>{step[0]}</h3><p>{step[1]}</p></section>:null;
}
function Detail({principal,items,now,fullPage,onNavigationBlocked}:{principal:Principal;items:WorkbenchCard[];now:number;fullPage:boolean;onNavigationBlocked:(blocked:boolean)=>void}){
  const [internalNoteBlocked,setInternalNoteBlocked]=useState(false),[groupBlocked,setGroupBlocked]=useState(false),[handlingBlocked,setHandlingBlocked]=useState(false),[reviewBlocked,setReviewBlocked]=useState(false),[completionBlocked,setCompletionBlocked]=useState(false),[assignmentBlocked,setAssignmentBlocked]=useState(false),[takeoverBlocked,setTakeoverBlocked]=useState(false),[takeoverCompletionBlocked,setTakeoverCompletionBlocked]=useState(false),[unassignBlocked,setUnassignBlocked]=useState(false),[returnBlocked,setReturnBlocked]=useState(false),[waitingBlocked,setWaitingBlocked]=useState(false);
  const [reopenBlocked,setReopenBlocked]=useState(false),[followUpBlocked,setFollowUpBlocked]=useState(false),[itemFollowBlocked,setItemFollowBlocked]=useState(false),[supplementBlocked,setSupplementBlocked]=useState(false);
  const [cancelBlocked,setCancelBlocked]=useState(false);
  const [webReportBlocked,setWebReportBlocked]=useState(false),[completionOpen,setCompletionOpen]=useState(false),[mediaOpen,setMediaOpen]=useState(false);
  const blockers={note:internalNoteBlocked,group:groupBlocked,handling:handlingBlocked,review:reviewBlocked,completion:completionBlocked,assignment:assignmentBlocked,cancel:cancelBlocked,takeover:takeoverBlocked,takeoverCompletion:takeoverCompletionBlocked,unassign:unassignBlocked,returnToDispatch:returnBlocked,waiting:waitingBlocked,reopen:reopenBlocked,followUp:followUpBlocked,follow:itemFollowBlocked,supplement:supplementBlocked,webReport:webReportBlocked};
  const blockedByOther=(purpose:keyof typeof blockers)=>Object.entries(blockers).some(([name,value])=>name!==purpose&&value);
  const otherCommandsBlocked=blockedByOther('webReport'),commandsBlocked=Object.values(blockers).some(Boolean);
  const workflowBlocked=groupBlocked||reviewBlocked||takeoverBlocked||takeoverCompletionBlocked||unassignBlocked||returnBlocked||waitingBlocked||reopenBlocked||followUpBlocked||supplementBlocked;
  useEffect(()=>{onNavigationBlocked(commandsBlocked);return()=>onNavigationBlocked(false);},[commandsBlocked,onNavigationBlocked]);
  const {kind='',id=''}=useParams(),navigate=useNavigate(),location=useLocation(),pageHeading=useRef<HTMLHeadingElement>(null);
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
  const activityRoot=useRef<HTMLDivElement>(null);
  const detail=result.data?.pages[0],records=result.data?.pages.flatMap(p=>p.records)??[];
  // Re-reading an open item must not take focus from an editor or move its target.
  const detailPresent=Boolean(detail);
  const secondaryBoardMode=boardMode&&!['.ticket-self-handling','.ticket-conversation-handling'].includes(boardSelector);
  useEffect(()=>{if(fullPage&&detailPresent)pageHeading.current?.focus();},[fullPage,detailPresent,kind,id]);
  const index=items.findIndex(item=>item.kind===kind&&item.id===id),previous=index>0?items[index-1]:undefined,next=index>=0?items[index+1]:undefined;
  const move=(item:WorkbenchCard|undefined)=>{if(item&&!commandsBlocked)void navigate(itemLink(item,location.search),{replace:true,state:location.state});};
  const pageParams=new URLSearchParams(location.search);pageParams.set('detail','page');
  const content=<DetailDialogProvider>
    <div className="detail-navigation">
      <div className="detail-breadcrumb"><Ticket size={17}/><span>{detail?.item.kind==='ticket'?'工单':'事项'}</span><span className="breadcrumb-slash">/</span><span>{detail?.item.number??'读取中'}</span></div>
      <div className="detail-toolbar-actions">
        {detail?.item.kind==='ticket'&&principal.ticket_staff_completion_enabled&&!boardMode?<TicketCompletion presentation="dialog" onOpenChange={setCompletionOpen} key={principal.principal_id+':completion:'+detail.item.id} ticketId={detail.item.id} principal={principal} onBlockedChange={setCompletionBlocked}/>:null}
        {detail?<ItemFollow key={principal.principal_id+':item-follow:'+kind+':'+id} requested={detail.requested_item??{kind:detail.item.kind,id:detail.item.id}} item={detail.item} principal={principal} readReady={result.isSuccess&&!result.isError} onBlockedChange={setItemFollowBlocked}/>:null}
        {!fullPage?<><HButton className="icon-button detail-previous" aria-label="上一项" title="上一项（已加载范围）" isDisabled={!previous||commandsBlocked} onClick={()=>move(previous)} variant="secondary"><ChevronUp size={17}/></HButton><HButton className="icon-button detail-next" aria-label="下一项" title="下一项（已加载范围）" isDisabled={!next||commandsBlocked} onClick={()=>move(next)} variant="secondary"><ChevronDown size={17}/></HButton><Link className="icon-button" aria-label="展开完整页面" title="展开完整页面" onClick={event=>{if(commandsBlocked)event.preventDefault();}} to={location.pathname+'?'+pageParams} state={location.state} replace><ArrowUpRight size={18}/></Link></>:null}
        <HButton className="icon-button" aria-label="关闭详情" title="返回工作台" isDisabled={commandsBlocked} onClick={close} variant="secondary">{fullPage?<ArrowLeft size={18}/>:<X size={18}/>}</HButton>
      </div>
    </div>
    {result.isPending?<Message text="正在读取事项详情…"/>:result.isError&&!detail?<Message text={errorMessage(result.error)} retry={()=>{void result.refetch();}}/>:detail?<div className="detail-body" ref={activityRoot}>
      {result.isError?<p role="status" className="confirmed-facts">读取中断，以下为最近已确认资料；连接恢复后重新核验。</p>:null}
      <header className="detail-heading"><h2 id="detail-title" ref={pageHeading} tabIndex={-1}>{detail.item.title}</h2></header>
      <ActivityPeople principal={principal} target={{kind:detail.item.kind,id:detail.item.id}} root={activityRoot} readReady={result.isSuccess&&!result.isError}/>
      {boardIntent&&boardSelector&&cancelledBoardIntent!==boardIntentKey?<BoardActionNotice intent={boardIntent} selector={boardSelector} currentColumn={result.isSuccess&&!result.isError?detail.item.column:undefined} onCancel={()=>setCancelledBoardIntent(boardIntentKey)}/>:null}
      <section className="properties detail-properties" aria-label="事项信息"><dl>
        <div className="property-field"><dt><Activity size={17}/>状态</dt><dd><Status item={detail.item}/></dd></div>
        <div className="property-field"><dt><Headset size={17}/>处理人</dt><dd><Owner name={detail.responsibility.ticket_assignee_name}/></dd></div>
        <ReporterDisplay item={detail.item} principal={principal} detail requested={detail.requested_item}/>
        <div className="property-field"><dt><MapPin size={17}/>位置</dt><dd>{detail.item.location??'未提供'}</dd></div>
        <ReporterContact item={detail.item} principal={principal} requested={detail.requested_item}/>
        <div className="property-field"><dt><Radio size={17}/>来源</dt><dd><span className="detail-source-tag">{detail.item.source_label}</span></dd></div>
        <div className="property-field"><dt><Clock3 size={17}/>报修时间</dt><dd>{detail.reported_at?<time dateTime={detail.reported_at.replace(' ','T')+'+08:00'} title="首次收到或登记报修的时间（北京时间）">{detail.reported_at}</time>:<span>未记录</span>}</dd></div>
      </dl></section>
      {detail.item.kind==='ticket'?<section className="detail-common-actions" aria-label="工单常用操作">
        {principal.ticket_assignment_enabled?<TicketAssignment key={principal.principal_id+':assignment:'+detail.item.id} ticketId={detail.item.id} principal={principal} itemLabel={detail.item.number+' · '+detail.item.title} otherBlocked={blockedByOther('assignment')} onBlockedChange={setAssignmentBlocked}/>:null}
        <TicketCancellation key={principal.principal_id+':cancel:'+detail.item.id} ticketId={detail.item.id} principal={principal} itemLabel={detail.item.number+' · '+detail.item.title} otherBlocked={blockedByOther('cancel')} onBlockedChange={setCancelBlocked}/>
        {principal.ticket_conversation_self_handling_enabled?<TicketConversationHandling boardMode={boardMode} key={principal.principal_id+':conversation-handling:'+detail.item.id} ticketId={detail.item.id} principal={principal} otherBlocked={blockedByOther('handling')} onBlockedChange={setHandlingBlocked}/>:principal.ticket_self_handling_enabled?<TicketSelfHandling boardMode={boardMode} key={principal.principal_id+':handling:'+detail.item.id} ticketId={detail.item.id} principal={principal} otherBlocked={blockedByOther('handling')} onBlockedChange={setHandlingBlocked}/>:null}
      </section>:null}
      {detail.description?<section className="detail-description"><h3>报修描述</h3><p className="detail-report-description">{detail.description}</p></section>:null}
      <ReportMaterialsSection key={principal.principal_id+':materials:'+detail.item.kind+':'+detail.item.id} principal={principal} kind={detail.item.kind} id={detail.item.id} requested={detail.requested_item??{kind:detail.item.kind,id:detail.item.id}} readReady={result.isSuccess&&!result.isError} reporterName={detail.item.reporter_name} otherBlocked={otherCommandsBlocked} onBlockedChange={setWebReportBlocked} onMediaOpenChange={setMediaOpen}/>
      {detail.item.kind==='ticket'&&principal.ticket_round_notifications_enabled?<TicketRoundNotifications key={principal.principal_id+':round-notifications:'+detail.item.id} ticketId={detail.item.id} principalId={principal.principal_id} readReady={result.isSuccess&&!result.isError} requested={detail.requested_item??{kind:detail.item.kind,id:detail.item.id}}/>:null}
      <WorkbenchDisclosure title={<>处理与协作</>} key={'workflow:'+detail.item.kind+':'+detail.item.id} className="detail-workflows" forceOpen={secondaryBoardMode||workflowBlocked}>{principal.source_group_directory_enabled&&principal.roles.includes('ADMIN')&&detail.item.source_group?<GroupNameEditor key={principal.principal_id+':'+detail.item.source_group.ref} group={detail.item.source_group} principal={principal} onBlockedChange={setGroupBlocked}/>:null}{detail.item.kind==='ticket'?<TicketNextStep status={detail.item.status}/>:null}{detail.item.kind==='ticket'&&principal.ticket_takeover_completion_enabled?<TicketTakeoverCompletion boardMode={boardMode} key={principal.principal_id+':takeover-completion:'+detail.item.id} ticketId={detail.item.id} principal={principal} onBlockedChange={setTakeoverCompletionBlocked}/>:null}{detail.item.kind==='ticket'?<TicketWaitingActions key={principal.principal_id+':waiting:'+detail.item.id} ticketId={detail.item.id} principal={principal} otherBlocked={blockedByOther('waiting')} onBlockedChange={setWaitingBlocked}/>:null}{detail.item.kind==='ticket'&&principal.supplement_follow_up_enabled?<SupplementFollowUp key={principal.principal_id+':supplement:'+detail.item.id} ticketId={detail.item.id} principal={principal} readReady={result.isSuccess&&!result.isError} onBlockedChange={setSupplementBlocked}/>:null}{detail.item.kind==='ticket'&&principal.ticket_staff_completion_enabled&&boardMode?<TicketCompletion boardMode={boardMode} key={principal.principal_id+':completion:'+detail.item.id} ticketId={detail.item.id} principal={principal} onBlockedChange={setCompletionBlocked}/>:null}{detail.item.kind==='ticket'?<SharedFollowUp key={principal.principal_id+':follow-up:'+detail.item.id} ticketId={detail.item.id} principal={principal} onBlockedChange={setFollowUpBlocked}/>:null}{detail.item.kind==='ticket'&&principal.assignment_history_enabled?<TicketAssignmentHistory key={principal.principal_id+':history:'+detail.item.id} ticketId={detail.item.id} principal={principal}/>:null}{detail.item.kind==='ticket'?<TicketReopen boardMode={boardMode} key={principal.principal_id+':reopen:'+detail.item.id} ticketId={detail.item.id} principal={principal} onBlockedChange={setReopenBlocked}/>:null}{detail.item.kind==='ticket'&&principal.ticket_takeover_enabled?<TicketTakeover boardMode={boardMode} key={principal.principal_id+':takeover:'+detail.item.id} ticketId={detail.item.id} principal={principal} onBlockedChange={setTakeoverBlocked}/>:null}{detail.item.kind==='ticket'?<TicketReturnToDispatch key={principal.principal_id+':return-to-dispatch:'+detail.item.id} ticketId={detail.item.id} principal={principal} onBlockedChange={setReturnBlocked}/>:null}{detail.item.kind==='ticket'&&principal.ticket_unassign_enabled?<TicketUnassign key={principal.principal_id+':unassign:'+detail.item.id} ticketId={detail.item.id} principal={principal} onBlockedChange={setUnassignBlocked}/>:null}<WorkbenchDisclosure title={<>关联会话</>} className="workflow-support"><ItemConversations principal={principal} kind={detail.item.kind} id={detail.item.id}/></WorkbenchDisclosure>{principal.manual_review_enabled?<ReviewWorkspace key={'manual-review:'+principal.principal_id+':'+kind+':'+id} principal={principal} item={detail.item} requested={{kind:kind as WorkbenchCard['kind'],id}} refs={detail.review_refs??[]} onBlockedChange={setReviewBlocked}/>:null}</WorkbenchDisclosure>
      <ActivityTimeline key={principal.principal_id+':activity:'+detail.item.kind+':'+detail.item.id} records={records} principal={principal} item={detail.item} active={!completionOpen&&!mediaOpen} now={now}>
        {!records.length?<p className="empty">暂无可读取的活动记录。</p>:null}{result.hasNextPage?<Button variant="secondary" isDisabled={result.isFetchingNextPage} onPress={()=>{void result.fetchNextPage();}}>加载更早记录</Button>:<p className="column-end">当前范围的记录已加载完毕</p>}
      </ActivityTimeline>
      {detail.item.kind==='ticket'&&principal.internal_notes_enabled?<TicketNotes key={principal.principal_id+':internal-note:'+detail.item.id} ticketId={detail.item.id} principal={principal} onBlockedChange={setInternalNoteBlocked}/>:null}
    </div>:null}
  </DetailDialogProvider>;
  if(fullPage)return <article className="detail-page" aria-labelledby="detail-title">{content}</article>;
  return <Drawer.Backdrop className="workbench-drawer-backdrop" isOpen isDismissable={!commandsBlocked} isKeyboardDismissDisabled={commandsBlocked} onOpenChange={open=>{if(!open)close();}}><Drawer.Content placement="right" className="workbench-drawer-content"><Drawer.Dialog data-workbench-overlay className="detail-dialog" aria-label="事项详情">{content}</Drawer.Dialog></Drawer.Content></Drawer.Backdrop>;
}
interface ColumnQuery {
 isPending:boolean;isError:boolean;error:unknown;isFetchingNextPage:boolean;hasNextPage:boolean;
 data:{pages:{items:WorkbenchCard[];range:{mode:BoardCompletionRange;from:string;until:string;timezone:'Asia/Shanghai'}}[]}|undefined;
 refetch:()=>Promise<unknown>;fetchNextPage:()=>Promise<unknown>;
}
function BoardSection({principal,query,column,label,search,selected,now,loaded}:{principal:Principal;query:ColumnQuery;column:BoardColumn;label:string;search:string;selected:string|undefined;now:number;loaded:WorkbenchCard[]}){
  const [expanded,setExpanded]=useState(false),visible=expanded?loaded:loaded.slice(0,3);
  return <BoardDropColumn column={column}><section className={'board-column '+column} aria-label={label}><div className="column-heading"><h2 className={'stage-pill '+column}>{label}</h2><span>{query.isError?'—':loaded.length} 已加载</span></div>
    {query.isPending?<BoardColumnLoading/>:query.isError&&!query.data?<Message text={errorMessage(query.error)} retry={()=>{void query.refetch();}}/>:<>{query.isError?<p role="status" className="confirmed-facts">连接中断，显示最近已确认资料。</p>:null}<div className="column-cards" id={'cards-'+column}>{visible.map(item=><Card key={item.kind+item.id} item={item} principal={principal} search={search} selected={item.id===selected} now={now}/>)}{!loaded.length?<p className="empty">当前授权范围内暂无事项</p>:null}</div><More expanded={expanded} count={loaded.length} controls={'cards-'+column} onClick={()=>setExpanded(value=>!value)}/></>}
    {!query.isError&&!query.isPending?(query.hasNextPage?<Button className="load-more" variant="tertiary" isDisabled={query.isFetchingNextPage} onPress={()=>{void query.fetchNextPage();}}>加载下一页</Button>:null):null}
  </section></BoardDropColumn>;
}
function Workbench({principal,realtime}:{principal:Principal;realtime:RealtimeView}){
  const [navigationBlocked,setNavigationBlocked]=useState(false);
  const order=useRef<{scope:string;keys:string[]}>({scope:'',keys:[]});
  const [params,setParams]=useSearchParams(),location=useLocation(),selected=useParams(),now=useClock(),navigate=useNavigate();
  const locationMode=Boolean(selected.id&&params.get('locate')==='1');
  const validLocation=Boolean(principal.workbench_reminders_enabled&&locationMode&&['ticket','review','intake'].includes(selected.kind??'')&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(selected.id??''));
  const view=params.get('view')==='list'?'list':'board',range:BoardCompletionRange=params.get('range')==='custom'?'custom':params.get('range')==='cancelled'?'cancelled':params.get('range')==='all'?'all':principal.workbench_search_enabled&&params.get('search')==='1'&&!params.has('range')?'all':'recent',fullPage=Boolean(!locationMode&&selected.id&&params.get('detail')==='page');
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
  const parsed=criteriaFromUrl(params,params.has('range')&&range!=='custom'?range:'all',scope??'team'),searchKey=parsed.criteria?searchCriteriaKey(parsed.criteria):'invalid';
  const searched=useWorkbenchSearch(principal,parsed.criteria,searchMode);
  const basePending=useColumn(principal,'pending',range,scope,!searchMode,closedDates),baseActive=useColumn(principal,'active',range,scope,!searchMode,closedDates),baseClosed=useColumn(principal,'closed',range,scope,!searchMode,closedDates);
  const searchedColumn=(column:BoardColumn):ColumnQuery=>({...searched,isFetchingNextPage:searched.isFetching,
    data:searched.isError||parsed.error?undefined:searched.data?{pages:searched.data.pages.map(page=>({items:page.items.filter(item=>item.column===column),range:page.range}))}:undefined,
    refetch:searched.restart,fetchNextPage:()=>searched.isFetching?Promise.resolve():searched.fetchNextPage()});
  const pending:ColumnQuery=searchMode?searchedColumn('pending'):basePending,active:ColumnQuery=searchMode?searchedColumn('active'):baseActive,closed:ColumnQuery=searchMode?searchedColumn('closed'):baseClosed;
  const queries=[pending,active,closed],items=queries.flatMap(query=>query.data?.pages.flatMap(page=>page.items)??[]),fresh=[...new Map(items.map(item=>[item.kind+':'+item.id,item])).values()];
  let unique=fresh;
  const holdOrder=principal.realtime_sse_enabled&&Boolean(selected.id)&&!fullPage&&!locationMode;
  if(holdOrder){
    const orderingScope=JSON.stringify([principal.principal_id,principal.authorization_revision,rangeKey,view,scope,selected.kind,selected.id,searchMode?searchKey:null]),keys=fresh.map(item=>item.kind+':'+item.id),present=new Set(keys);
    if(order.current.scope!==orderingScope)order.current={scope:orderingScope,keys};
    else {const retained=order.current.keys.filter(key=>present.has(key)),known=new Set(retained);order.current.keys=[...retained,...keys.filter(key=>!known.has(key))];}
    // Keep only presentation IDs. Every displayed object still comes from the current authorized GET.
    const rank=new Map(order.current.keys.map((key,index)=>[key,index]));
    unique=[...fresh].sort((a,b)=>(rank.get(a.kind+':'+a.id)??0)-(rank.get(b.kind+':'+b.id)??0));
  }else order.current={scope:'',keys:[]};
  const update=(key:string,value:string)=>{const next=new URLSearchParams(params);next.set(key,value);setParams(next);};
  const applyClosedRange=(value:BoardCompletionRange,dates?:{from:string;to:string})=>{
    if(navigationBlocked)return;
    const next=new URLSearchParams(params);next.set('range',value);for(const key of ['closed_from','closed_to','cursor','limit'])next.delete(key);
    if(value==='custom'&&dates){next.set('closed_from',dates.from);next.set('closed_to',dates.to);}setParams(next);
  };
  const refresh=()=>{if(searchMode){if(!searched.isFetching)void searched.restart();}else{void pending.refetch();void active.refetch();void closed.refetch();}};
  const applySearch=(criteria:WorkbenchSearchCriteria)=>{
    const next=new URLSearchParams(params);for(const key of SEARCH_KEYS)next.delete(key);for(const key of ['closed_from','closed_to','cursor','limit'])next.delete(key);
    for(const [key,value]of searchParameters(criteria))next.set(key,value);next.set('search','1');setParams(next);
  };
  const leaveSearch=()=>{const next=new URLSearchParams(params);for(const key of SEARCH_KEYS)if(key!=='range'&&key!=='scope')next.delete(key);next.delete('search');next.delete('cursor');next.delete('limit');setParams(next);};
  const label=(column:BoardColumn)=>names[column];
  const visibleItems=(loaded:WorkbenchCard[])=>locatedItem?loaded.filter(item=>item.kind!==locatedItem.kind||item.id!==locatedItem.id):loaded;
  const returnParameters=new URLSearchParams(params);returnParameters.delete('locate');returnParameters.delete('detail');
  const returnBoard='/'+(returnParameters.size?'?'+returnParameters:'');
  return <Shell principal={principal} realtime={realtime} navigationBlocked={navigationBlocked}><BoardActions principal={principal} blocked={navigationBlocked} selectionKey={location.pathname+location.search} onOpen={({intent,selector})=>{if(!navigationBlocked)void navigate(itemLink(intent,location.search),{state:{fromBoard:true,boardActionIntent:intent,boardActionSelector:selector}});}}>{!fullPage?<div className="workspace"><div className="page-title"><span className="page-icon"><LayoutGrid size={30} strokeWidth={1.6}/></span><div><h1>团队工作台</h1><p>让每一件报修，都有回应。</p></div><span className="read-only-badge">{principal.internal_notes_enabled||principal.ticket_self_handling_enabled||principal.manual_review_enabled||principal.ticket_staff_completion_enabled?'人工协作':'只读'}</span></div>
    {principal.workbench_search_enabled?<SearchControls principal={principal} criteria={parsed.criteria} active={searchMode} loaded={fresh} blocked={navigationBlocked} onApply={applySearch} onLeave={leaveSearch}/>:searchRequested?<p role="status">搜索入口当前关闭，已返回原分页看板。</p>:null}
    {searchMode&&searched.isError?<p role="alert" data-search-state="error">查询未完成，请重新读取。搜索输入仍保留。</p>:null}
    {searchMode&&!parsed.error&&!searched.isPending&&!searched.isError&&searched.data&&unique.length===0?<p role="status" data-search-state="empty">{searchEmptyMessage(parsed.criteria)}</p>:null}
    <div className="toolbar"><div className="scope-tabs">{principal.workbench_follow_enabled?<><HButton type="button" className={scope==='team'?'selected':''} aria-pressed={scope==='team'} isDisabled={navigationBlocked} onClick={()=>update('scope','team')} variant="secondary">团队工作</HButton><HButton type="button" data-action="related-scope" className={scope==='related'?'selected':''} aria-pressed={scope==='related'} isDisabled={navigationBlocked} onClick={()=>update('scope','related')} variant="secondary">与我有关</HButton></>:<span className="selected">团队工作</span>}</div>
      <div className="tools"><ManualReportEntry principal={principal} blocked={navigationBlocked}/><Button variant="tertiary" onPress={refresh}><RefreshCw size={16}/>刷新</Button><div className="view-tabs" role="group" aria-label="展示方式"><HButton aria-pressed={view==='board'} onClick={()=>update('view','board')} variant="secondary"><LayoutGrid size={16}/>看板</HButton><HButton aria-pressed={view==='list'} onClick={()=>update('view','list')} variant="secondary"><List size={16}/>列表</HButton></div></div></div>
    <div className="range-bar"><span>{queries.some(query=>query.isError)?'部分事项读取失败':'已加载 '+unique.length+' 项'}</span><span>未完成事项不限日期</span>{!searchMode?<ProcessedDatePicker key={rangeKey} range={range} dates={closedDates} now={now} blocked={navigationBlocked} onApply={applyClosedRange}/>:range==='cancelled'?<span>仅显示已取消事项 <HButton variant="ghost" isDisabled={navigationBlocked} onPress={()=>applyClosedRange('all')}>清除</HButton></span>:null}</div>
    {locationMode?<section ref={locatedSection} className="reminder-location" aria-label="已定位事项"><div className="column-heading"><h2>已定位事项</h2><Link to={returnBoard}>返回当前工作台</Link></div>
      {!validLocation?<Message text="当前提醒定位不可用，请重新选择有效事项。"/>:located.isPending?<Message text="正在核验当前事项读取权限…"/>:located.isError?<Message text={located.error instanceof ApiError&&[403,404].includes(located.error.status)?'该事项当前不可读取，旧定位资料已清除。':'本次定位未完成，原定位目标已保留。'} {...(located.error instanceof ApiError&&[401,403,404].includes(located.error.status)?{}:{retry:()=>{void located.refetch();}})}/>:locatedItem?<Card item={locatedItem} principal={principal} search={location.search} selected={true} now={now} located={true}/>:null}
    </section>:null}
    {searchMode&&parsed.error?<Message text={parsed.error}/>:view==='board'?<div className="board">{columns.map((column,index)=>{const query=queries[index];return query?<BoardSection key={column+':'+rangeKey+':'+scope+':'+(searchMode?searchKey:'board')} principal={principal} query={query} loaded={visibleItems(holdOrder?unique.filter(item=>item.column===column):query.data?.pages.flatMap(page=>page.items)??[])} column={column} label={label(column)} search={location.search} selected={selected.id} now={now}/>:null;})}</div>:<>
      {columns.map((column,index)=>{const query=queries[index];return query?<div key={column+':'+rangeKey+':'+scope+':'+(searchMode?searchKey:'board')}>{query.isPending?<Message text={label(column)+'：正在读取…'}/>:query.isError&&!query.data?<Message text={label(column)+'：'+errorMessage(query.error)} retry={()=>{void query.refetch();}}/>:<>{query.isError?<p role="status" className="confirmed-facts">{errorMessage(query.error)} 显示最近已确认资料。</p>:null}<WorkList column={column} label={label(column)} items={visibleItems(holdOrder?unique.filter(item=>item.column===column):query.data?.pages.flatMap(page=>page.items)??[])} search={location.search} selected={selected.id} now={now}/>{!query.data?.pages.some(page=>page.items.length)?<p className="empty">当前授权范围内暂无事项</p>:null}{query.hasNextPage?<Button className="load-more" variant="tertiary" isDisabled={query.isFetchingNextPage} onPress={()=>{void query.fetchNextPage();}}>加载下一页</Button>:null}</>}</div>:null;})}</>}
    </div>:null}
    {selected.id&&!locationMode?<Detail principal={principal} items={unique} now={now} fullPage={fullPage} onNavigationBlocked={setNavigationBlocked}/>:null}
  </BoardActions></Shell>;
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
