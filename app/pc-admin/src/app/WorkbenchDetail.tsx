import {CloseItemButton,RestoreClosedItem} from '../features/ticket-waiting/ClosureActions';
import {ClosureHistory} from '../features/ticket-waiting/ClosureHistory';
import type {StepReadState} from '../design/components/Drawer/NextStep';
import { useInfiniteQuery,useQuery } from '@tanstack/react-query';
import { ArrowLeft,ArrowUpRight,Building2,Check,ChevronDown,ChevronUp,CircleX,Clock3,Copy,Headset,MapPin,Pause,Phone,Radio,Ticket,TriangleAlert,UserRound,X } from 'lucide-react';
import { useCallback,useEffect,useLayoutEffect,useRef,useState } from 'react';
import { useLocation,useNavigate,useParams } from 'react-router';
import type { Principal,WorkbenchCard,WorkbenchDetail } from '../api/client';
import { api,statusLabels } from '../api/client';
import { Button,Button as HButton } from '../design/components/Button/Button';
import { Drawer,DrawerMoreActions } from '../design/components/Drawer/Drawer';
import { DrawerTabs } from '../design/components/Drawer/DrawerTabs';
import { DrawerStageGlyph } from '../design/components/Drawer/DrawerStageGlyph';
import { NextStep,StepEntry } from '../design/components/Drawer/NextStep';
import { nextSummary } from '../design/components/Drawer/next-summary';
import { InlineAlert } from '../design/components/InlineAlert/InlineAlert';
import { BeijingTime } from '../design/components/Timeline/BeijingTime';
import { PropertyList } from '../design/components/PropertyList/PropertyList';
import { Tag } from '../design/components/Tag/Tag';
import { TicketCategoryTile } from '../design/components/TicketCard/TicketCard';
import { closureReasonText,externalTicketNumber } from '../design/components/TicketCard/closure-presentation';
import { cardHeat } from '../design/heat';
import { stagePresentation } from '../design/status-map';
import { ActivityPeople } from '../features/activity/ActivityPeople';
import { TicketAssignmentHistory } from '../features/assignment-history/TicketAssignmentHistory';
import { ReportMaterialsSection } from '../features/attachments/ReportMaterialsSection';
import { BoardActionNotice } from '../features/board-actions/BoardActions';
import { readBoardIntent } from '../features/board-actions/intent';
import { ItemConversations } from '../features/conversations/Conversations';
import { SharedFollowUp } from '../features/follow-up/SharedFollowUp';
import {followUpApi} from '../features/follow-up/client';
import { ItemFollow } from '../features/item-follow/ItemFollow';
import { ReviewWorkspace } from '../features/manual-review/ReviewWorkspace';
import { GroupNameEditor } from '../features/source-groups/GroupNameEditor';
import { SupplementFollowUp } from '../features/supplement-follow-up/SupplementFollowUp';
import { TicketAssignment } from '../features/ticket-assignment/TicketAssignment';
import { TicketCompletion } from '../features/ticket-completion/TicketCompletion';
import { TicketConversationHandling } from '../features/ticket-handling/TicketConversationHandling';
import { TicketSelfHandling } from '../features/ticket-handling/TicketSelfHandling';
import { TicketNotes } from '../features/ticket-notes/TicketNotes';
import { TicketReopen } from '../features/ticket-reopen/TicketReopen';
import { TicketReturnToDispatch } from '../features/ticket-return-to-dispatch/TicketReturnToDispatch';
import { TicketRoundNotifications } from '../features/ticket-round-notifications/TicketRoundNotifications';
import { TicketTakeoverCompletion } from '../features/ticket-takeover-completion/TicketTakeoverCompletion';
import { TicketTakeover } from '../features/ticket-takeover/TicketTakeover';
import { TicketUnassign } from '../features/ticket-unassign/TicketUnassign';
import { TicketWaitingActions } from '../features/ticket-waiting/TicketWaitingActions';
import { DetailDialogProvider } from './DetailDialog';
import { ActivityTimeline } from './DetailPresentation';
import { WorkbenchLink as Link } from './WorkbenchLink';


import { itemLink,Owner,Status,useReporterProfile } from './WorkbenchItemPresentation';
function Message({text,retry}:{text:string;retry?:()=>void}){
  return retry?<InlineAlert className="state-message" tone="danger" action={<Button tone="ghost" onPress={retry}>重试</Button>}>加载失败，请检查网络后重试</InlineAlert>:<div className="state-message" role="status"><TriangleAlert size={18}/><p>{text}</p></div>;
}
function DetailProperties({detail,principal}:{detail:WorkbenchDetail;principal:Principal}){
  const item=detail.item,profile=useReporterProfile(item,principal),requested=detail.requested_item;
  const contact=useQuery({queryKey:['reporter-contact',principal.principal_id,requested?.kind??item.kind,requested?.id??item.id,principal.authorization_revision],queryFn:({signal})=>api.reporterContact(item.id,signal),enabled:item.kind==='ticket',retry:false,gcTime:0});
  const contactPending=item.kind==='ticket'&&contact.isPending,contactError=item.kind==='ticket'&&contact.isError;
  const phone=contactError?null:contact.data?.phone,mobile=phone?.replace(/[\s+-]/gu,'').replace(/^86(?=1[3-9]\d{9}$)/u,''),formatted=mobile&&/^1[3-9]\d{9}$/u.test(mobile)?mobile.slice(0,3)+'-'+mobile.slice(3,7)+'-'+mobile.slice(7):phone;
  const name=item.reporter_name??profile.data?.name,department=item.reporter_department??profile.data?.department;
  const profileTitle=[name,department].filter(Boolean).join(' · ')+(item.reporter_profile?.source==='LATER_LOOKUP'?'（资料取得于 '+item.reporter_profile.captured_at+'）':profile.data?.current?'（当前企业微信资料）':'');
  const missing=[!name?'报修人姓名':null,!department?'报修部门':null,!item.location?'位置':null,!formatted&&!contactPending&&!contactError?'联系电话':null].filter(Boolean);
  return <PropertyList aria-label="事项信息" header={<span className="sr-only"><Status item={item}/></span>}>
    <div className="property-field" hidden={!name}><dt><UserRound size={17}/>报修人</dt><dd title={profileTitle}><Owner name={name??null}/></dd></div>
    <div className="property-field" hidden={!department}><dt><Building2 size={17}/>报修部门</dt><dd title={profileTitle}>{department}{profile.data?.current?<small>（当前资料）</small>:null}</dd></div>
    <div className="property-field"><dt><Headset size={17}/>处理人</dt><dd><Owner name={detail.responsibility.ticket_assignee_name}/></dd></div>
    <div className="property-field"><dt><Radio size={17}/>来源</dt><dd><span className="detail-source-tag">{item.source_label}</span></dd></div>
    {item.location?<div className="property-field"><dt><MapPin size={17}/>位置</dt><dd>{item.location}</dd></div>:null}
    <div className="property-field reporter-contact" hidden={!formatted&&!contactPending&&!contactError}><dt><Phone size={17}/>联系电话</dt><dd><span className="reporter-phone" data-empty={!formatted&&!contactPending&&!contactError}>{formatted??(contactPending?'正在读取…':contactError?'暂不可用':'未提供')}</span></dd></div>
    <div className="property-field"><dt><Clock3 size={17}/>报修时间</dt><dd>{detail.reported_at?<BeijingTime value={detail.reported_at}/>:<span>未记录</span>}</dd></div>
    {missing.length?<div className="property-field property-wide ds-detail-missing"><dt className="sr-only">缺失资料</dt><dd><TriangleAlert size={15}/><span>未提供：{missing.join('、')}</span></dd></div>:null}
  </PropertyList>;
}
type DetailProps={principal:Principal;items:WorkbenchCard[];now:number;fullPage:boolean;onNavigationBlocked:(blocked:boolean)=>void};

export function WorkbenchDetailDrawer(props:DetailProps){
  const {kind='',id=''}=useParams(),navigate=useNavigate(),location=useLocation();
  const [dismissBlocked,setDismissBlocked]=useState(false),blocked=useRef(false);
  const onNavigationBlocked=props.onNavigationBlocked;
  const reportBlocked=useCallback((value:boolean)=>{blocked.current=value;setDismissBlocked(value);onNavigationBlocked(value);},[onNavigationBlocked]);
  const close=()=>{if(blocked.current)return;const search=new URLSearchParams(location.search);search.delete('detail');if(!props.fullPage&&location.state&&typeof location.state==='object'&&'fromBoard' in location.state&&location.state.fromBoard===true)void navigate(-1);else void navigate('/'+(search.size?'?'+search:'') ,{replace:true});};
  // Keep the overlay's focus/restore scope while each requested item owns fresh controllers.
  const content=<WorkbenchDetailContent key={props.principal.principal_id+':'+kind+':'+id} {...props} onNavigationBlocked={reportBlocked} onClose={close}/>;
  return props.fullPage?<article className="detail-page ds-detail" aria-labelledby="detail-title">{content}</article>:<Drawer dismissBlocked={dismissBlocked} onClose={close}>{content}</Drawer>;
}

function WorkbenchDetailContent({principal,items,now,fullPage,onNavigationBlocked,onClose}:DetailProps&{onClose:()=>void}){
  const [tab,setTab]=useState('activity'),[copied,setCopied]=useState(false),[attachmentCount,setAttachmentCount]=useState<number|null>(null),[conversationCount,setConversationCount]=useState<number|null>(null),[reviewReadState,setReviewReadState]=useState<StepReadState>('pending');
  const [internalNoteBlocked,setInternalNoteBlocked]=useState(false),[groupBlocked,setGroupBlocked]=useState(false),[handlingBlocked,setHandlingBlocked]=useState(false),[reviewBlocked,setReviewBlocked]=useState(false),[completionBlocked,setCompletionBlocked]=useState(false),[assignmentBlocked,setAssignmentBlocked]=useState(false),[takeoverBlocked,setTakeoverBlocked]=useState(false),[takeoverCompletionBlocked,setTakeoverCompletionBlocked]=useState(false),[unassignBlocked,setUnassignBlocked]=useState(false),[returnBlocked,setReturnBlocked]=useState(false),[waitingBlocked,setWaitingBlocked]=useState(false);
  const [reopenBlocked,setReopenBlocked]=useState(false),[followUpBlocked,setFollowUpBlocked]=useState(false),[itemFollowBlocked,setItemFollowBlocked]=useState(false),[supplementBlocked,setSupplementBlocked]=useState(false);
  const [urgencyTarget,setUrgencyTarget]=useState<HTMLDivElement|null>(null);
  const [noteActionsTarget,setNoteActionsTarget]=useState<HTMLDivElement|null>(null);
  const [webReportBlocked,setWebReportBlocked]=useState(false),[completionOpen,setCompletionOpen]=useState(false),[mediaOpen,setMediaOpen]=useState(false);
  const blockers={note:internalNoteBlocked,group:groupBlocked,handling:handlingBlocked,review:reviewBlocked,completion:completionBlocked,assignment:assignmentBlocked,takeover:takeoverBlocked,takeoverCompletion:takeoverCompletionBlocked,unassign:unassignBlocked,returnToDispatch:returnBlocked,waiting:waitingBlocked,reopen:reopenBlocked,followUp:followUpBlocked,follow:itemFollowBlocked,supplement:supplementBlocked,webReport:webReportBlocked};
  const blockedByOther=(purpose:keyof typeof blockers)=>Object.entries(blockers).some(([name,value])=>name!==purpose&&value);
  const otherCommandsBlocked=blockedByOther('webReport'),commandsBlocked=Object.values(blockers).some(Boolean);
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
  const close=()=>{if(!commandsBlocked)onClose();};
  const activityRoot=useRef<HTMLDivElement>(null);
  const detail=result.data?.pages[0],records=result.data?.pages.flatMap(p=>p.records)??[];
  // Observe the original permission queries; these do not infer action eligibility.
  const commandRead=useQuery({queryKey:['ticket-command-context',principal.principal_id,detail?.item.id??id],queryFn:({signal})=>api.ticketCommandContext(detail?.item.id??id,signal),enabled:detail?.item.kind==='ticket'});
  const scheduleRead=useQuery({queryKey:['ticket-follow-up-schedule',principal.principal_id,detail?.item.id??id],queryFn:({signal})=>followUpApi.view(detail?.item.id??id,signal),enabled:false});
  const states:StepReadState[]=[];
  if(detail?.item.kind==='ticket')states.push(commandRead.isPending?'pending':commandRead.isError?'unknown':'ready');
  if(detail?.item.kind==='ticket'&&principal.follow_up_schedules_enabled)states.push(scheduleRead.isPending?'pending':scheduleRead.isError?'unknown':'ready');
  if(principal.manual_review_enabled&&(kind==='review'||Boolean(detail?.review_refs?.length)))states.push(reviewReadState);
  const stepReadState:StepReadState=states.includes('pending')?'pending':states.includes('unknown')?'unknown':'ready';
  // Re-reading an open item must not take focus from an editor or move its target.
  const detailPresent=Boolean(detail);
  useLayoutEffect(()=>{if(!fullPage&&detailPresent)pageHeading.current?.focus({preventScroll:true});},[fullPage,detailPresent,kind,id]);
  useEffect(()=>{if(fullPage&&detailPresent)pageHeading.current?.focus();},[fullPage,detailPresent,kind,id]);
  const index=items.findIndex(item=>item.kind===kind&&item.id===id),previous=index>0?items[index-1]:undefined,next=index>=0?items[index+1]:undefined;
  const move=(item:WorkbenchCard|undefined)=>{if(item&&!commandsBlocked)void navigate(itemLink(item,location.search),{replace:true,state:location.state});};
  const pageParams=new URLSearchParams(location.search);pageParams.set('detail','page');
  const heat=detail?cardHeat(detail.item,now):null;
  // Card 29 D1/D2: a dismissed item is gray 「已关闭」, not the completed stage, and its next step is the neutral restore card.
  const dismissed=detail?.item.closure?.kind==='DISMISSED'?detail.item.closure:null,dismissedOriginal=externalTicketNumber(dismissed?.duplicate_of?.display_no);
  const content=<DetailDialogProvider>
    <div className="detail-navigation">
      <div className="detail-breadcrumb"><Ticket size={17}/><span>{detail?.item.kind==='ticket'?'工单':'事项'}</span><span className="breadcrumb-slash">/</span><span>{detail?.item.number??'读取中'}</span><HButton tone="ghost" isIconOnly aria-label={copied?'已复制编号':'复制编号'} isDisabled={!detail} onPress={()=>{if(detail)void navigator.clipboard.writeText(detail.item.number).then(()=>setCopied(true)).catch(()=>setCopied(false));}}>{copied?<Check size={16}/>:<Copy size={16}/>}</HButton></div>
      <div className="detail-toolbar-actions">
        {!fullPage?<><HButton className="icon-button detail-previous" aria-label="上一项" title="上一项（已加载范围）" isDisabled={!previous||commandsBlocked} onClick={()=>move(previous)} tone="ghost"><ChevronUp size={17}/></HButton><span className="ds-detail-position" aria-label="已加载范围中的位置">{index>=0?index+1:'—'} / {items.length}</span><HButton className="icon-button detail-next" aria-label="下一项" title="下一项（已加载范围）" isDisabled={!next||commandsBlocked} onClick={()=>move(next)} tone="ghost"><ChevronDown size={17}/></HButton><span className="ds-detail-toolbar-divider" aria-hidden="true"/><Link className="icon-button" aria-label="展开完整页面" title="展开完整页面" onClick={event=>{if(commandsBlocked)event.preventDefault();}} to={location.pathname+'?'+pageParams} state={location.state} replace><ArrowUpRight size={18}/></Link></>:null}
        {detail?<ItemFollow key={principal.principal_id+':item-follow:'+kind+':'+id} requested={detail.requested_item??{kind:detail.item.kind,id:detail.item.id}} item={detail.item} principal={principal} readReady={result.isSuccess&&!result.isError} onBlockedChange={setItemFollowBlocked}/>:null}
        <DrawerMoreActions><div className="ticket-notes detail-note-composer ds-note-actions" ref={setNoteActionsTarget}/>{detail?<CloseItemButton item={detail.item} principal={principal}/>:null}{principal.source_group_directory_enabled&&principal.roles.includes('ADMIN')&&detail?.item.source_group?<GroupNameEditor tone="secondary" key={principal.principal_id+':'+detail.item.source_group.ref} group={detail.item.source_group} principal={principal} onBlockedChange={setGroupBlocked}/>:null}</DrawerMoreActions>
        <HButton className="icon-button" aria-label="关闭详情" title="返回工作台" isDisabled={commandsBlocked} onClick={close} tone="ghost">{fullPage?<ArrowLeft size={18}/>:<X size={18}/>}</HButton>
      </div>
    </div>
    {result.isPending?<Message text="正在读取事项详情…"/>:result.isError&&!detail?<Message text="加载失败，请检查网络后重试" retry={()=>{void result.refetch();}}/>:detail?<div className="ds-detail-view" ref={activityRoot}><div className="detail-body">
      {result.isError?<><Message text="加载失败，请检查网络后重试" retry={()=>{void result.refetch();}}/><p role="status" className="confirmed-facts">以下为最近已确认资料；连接恢复后重新核验。</p></>:null}
      <header className="detail-heading ds-detail-hero"><TicketCategoryTile service={detail.item.service}/><div><h2 id="detail-title" ref={pageHeading} tabIndex={-1}>{detail.item.title}</h2><div className="ds-detail-state">{dismissed?<span className="ds-status-badge ds-stage-pill ds-dismissed-pill" data-tone="neutral" data-closure-state="dismissed"><CircleX aria-hidden="true"/><span className="ds-status-text">已关闭</span></span>:<DrawerStageGlyph stage={detail.item.column}/>}<span className="ds-drawer-status" data-waiting={detail.item.status==='WAITING_VENDOR'||detail.item.status==='WAITING_REQUESTER'} hidden={Boolean(dismissed)||statusLabels[detail.item.status]===stagePresentation[detail.item.column].label}>{detail.item.status==='WAITING_VENDOR'||detail.item.status==='WAITING_REQUESTER'?<Pause className="ds-drawer-pause-glyph" aria-hidden="true"/>:null}<Status item={detail.item}/></span>{heat?<Tag className="ds-ticket-heat" tone={heat.tone}><Clock3 size={14}/>{heat.label}</Tag>:null}<div className="ds-drawer-urgency" ref={setUrgencyTarget}/><span>报修于 {detail.reported_at?<BeijingTime value={detail.reported_at} now={now}/>: '时间未记录'} · {detail.item.source_label}</span></div></div></header>
      <ActivityPeople principal={principal} target={{kind:detail.item.kind,id:detail.item.id}} root={activityRoot} readReady={result.isSuccess&&!result.isError}/>
      {boardIntent&&boardSelector&&cancelledBoardIntent!==boardIntentKey?<BoardActionNotice intent={boardIntent} selector={boardSelector} currentColumn={result.isSuccess&&!result.isError?detail.item.column:undefined} onCancel={()=>setCancelledBoardIntent(boardIntentKey)}/>:null}
      <NextStep key={principal.principal_id+':steps:'+kind+':'+id} status={detail.item.status} stage={detail.item.column} dismissed={Boolean(dismissed)} summary={dismissed?<><span className="ds-next-step-kicker">已关闭 · 不计入完成数</span><span className="ds-next-step-message" data-closure-summary>{closureReasonText(dismissed)+(dismissedOriginal?' · '+dismissedOriginal:'')}</span></>:<><span className="ds-next-step-message">{nextSummary(detail.item,heat?.label,detail.item.attention?.related_reasons.includes('HANDLING')===true,commandRead.data?.allowed_actions)}</span>{detail.item.follow_up_schedule?<span className="ds-next-step-follow-up"><span className="ds-next-step-separator"> · </span>下次跟进 <BeijingTime value={detail.item.follow_up_schedule.due_at} now={now}/></span>:null}</>} readState={stepReadState}>
      {dismissed?<StepEntry action="restore" label="恢复">{()=> <RestoreClosedItem item={detail.item} principal={principal} inline/>}</StepEntry>:null}
        {detail.item.kind==='ticket'?<>          {principal.ticket_assignment_enabled?<TicketAssignment key={principal.principal_id+':assignment:'+detail.item.id} ticketId={detail.item.id} principal={principal} itemLabel={detail.item.number+' · '+detail.item.title} otherBlocked={blockedByOther('assignment')} onBlockedChange={setAssignmentBlocked}/>:null}
          {principal.ticket_conversation_self_handling_enabled?<TicketConversationHandling boardMode={boardMode} key={principal.principal_id+':conversation-handling:'+detail.item.id} ticketId={detail.item.id} principal={principal} otherBlocked={blockedByOther('handling')} onBlockedChange={setHandlingBlocked}/>:principal.ticket_self_handling_enabled?<TicketSelfHandling boardMode={boardMode} key={principal.principal_id+':handling:'+detail.item.id} ticketId={detail.item.id} principal={principal} otherBlocked={blockedByOther('handling')} onBlockedChange={setHandlingBlocked}/>:null}
          {detail.item.kind==='ticket'&&principal.ticket_staff_completion_enabled&&!boardMode?<TicketCompletion presentation="dialog" onOpenChange={setCompletionOpen} key={principal.principal_id+':completion:'+detail.item.id} ticketId={detail.item.id} principal={principal} onBlockedChange={setCompletionBlocked}/>:null}
</>:null}
        <div className="detail-workflows">{detail.item.kind==='ticket'&&principal.ticket_takeover_completion_enabled?<TicketTakeoverCompletion boardMode={boardMode} key={principal.principal_id+':takeover-completion:'+detail.item.id} ticketId={detail.item.id} principal={principal} onBlockedChange={setTakeoverCompletionBlocked}/>:null}{detail.item.kind==='ticket'?<TicketWaitingActions key={principal.principal_id+':waiting:'+detail.item.id} ticketId={detail.item.id} principal={principal} otherBlocked={blockedByOther('waiting')} onBlockedChange={setWaitingBlocked}/>:null}{detail.item.kind==='ticket'&&principal.supplement_follow_up_enabled?<SupplementFollowUp key={principal.principal_id+':supplement:'+detail.item.id} ticketId={detail.item.id} principal={principal} readReady={result.isSuccess&&!result.isError} onBlockedChange={setSupplementBlocked}/>:null}{detail.item.kind==='ticket'&&principal.ticket_staff_completion_enabled&&boardMode?<TicketCompletion boardMode={boardMode} key={principal.principal_id+':completion:'+detail.item.id} ticketId={detail.item.id} principal={principal} onBlockedChange={setCompletionBlocked}/>:null}{detail.item.kind==='ticket'?<SharedFollowUp key={principal.principal_id+':follow-up:'+detail.item.id} ticketId={detail.item.id} principal={principal} onBlockedChange={setFollowUpBlocked}/>:null}{detail.item.kind==='ticket'&&principal.assignment_history_enabled?<TicketAssignmentHistory key={principal.principal_id+':history:'+detail.item.id} ticketId={detail.item.id} principal={principal}/>:null}{detail.item.kind==='ticket'?<TicketReopen boardMode={boardMode} key={principal.principal_id+':reopen:'+detail.item.id} ticketId={detail.item.id} principal={principal} onBlockedChange={setReopenBlocked}/>:null}{detail.item.kind==='ticket'&&principal.ticket_takeover_enabled?<TicketTakeover boardMode={boardMode} key={principal.principal_id+':takeover:'+detail.item.id} ticketId={detail.item.id} principal={principal} onBlockedChange={setTakeoverBlocked}/>:null}{detail.item.kind==='ticket'?<TicketReturnToDispatch key={principal.principal_id+':return-to-dispatch:'+detail.item.id} ticketId={detail.item.id} principal={principal} onBlockedChange={setReturnBlocked}/>:null}{detail.item.kind==='ticket'&&principal.ticket_unassign_enabled?<TicketUnassign key={principal.principal_id+':unassign:'+detail.item.id} ticketId={detail.item.id} principal={principal} onBlockedChange={setUnassignBlocked}/>:null}{principal.manual_review_enabled?<ReviewWorkspace onReadStateChange={setReviewReadState} expanded={boardMode&&boardSelector==='[data-review-workspace]'} key={'manual-review:'+principal.principal_id+':'+kind+':'+id} principal={principal} item={detail.item} requested={{kind:kind as WorkbenchCard['kind'],id}} refs={detail.review_refs??[]} onBlockedChange={setReviewBlocked}/>:null}</div>
      </NextStep>
      <DetailProperties detail={detail} principal={principal}/>
      <ClosureHistory item={detail.item} principal={principal} revision={detail.item.updated_at+':'+(records.find(record=>['CANCELLED','DUPLICATE_LINKED','IGNORED'].includes(record.old_status??'')||['CANCELLED','DUPLICATE_LINKED','IGNORED'].includes(record.new_status??''))?.id??'')}/>
      <DrawerTabs value={tab} onChange={setTab} attachments={attachmentCount} conversations={conversationCount}/>
      <div role="tabpanel" id="detail-tab-activity" aria-labelledby="detail-tab-trigger-activity" hidden={tab!=='activity'}>


      <ActivityTimeline description={detail.description} key={principal.principal_id+':activity:'+detail.item.kind+':'+detail.item.id} records={records} principal={principal} item={detail.item} active={tab==='activity'&&!completionOpen&&!mediaOpen} now={now}>
        {!records.length?<p className="empty">暂无可读取的活动记录。</p>:null}{result.hasNextPage?<Button tone="secondary" isDisabled={result.isFetchingNextPage} onPress={()=>{void result.fetchNextPage();}}>加载更早记录</Button>:null}
      </ActivityTimeline>
      {detail.item.kind==='ticket'&&principal.ticket_round_notifications_enabled?<TicketRoundNotifications key={principal.principal_id+':round-notifications:'+detail.item.id} ticketId={detail.item.id} principalId={principal.principal_id} readReady={result.isSuccess&&!result.isError} requested={detail.requested_item??{kind:detail.item.kind,id:detail.item.id}}/>:null}
      </div>
      <div role="tabpanel" id="detail-tab-attachments" aria-labelledby="detail-tab-trigger-attachments" hidden={tab!=='attachments'}>      <ReportMaterialsSection key={principal.principal_id+':materials:'+detail.item.kind+':'+detail.item.id} principal={principal} kind={detail.item.kind} id={detail.item.id} requested={detail.requested_item??{kind:detail.item.kind,id:detail.item.id}} readReady={result.isSuccess&&!result.isError} reporterName={detail.item.reporter_name} otherBlocked={otherCommandsBlocked} onBlockedChange={setWebReportBlocked} onCountChange={setAttachmentCount} onMediaOpenChange={setMediaOpen} urgencyTarget={urgencyTarget}/></div>
      <div className="workflow-support" role="tabpanel" id="detail-tab-conversations" aria-labelledby="detail-tab-trigger-conversations" hidden={tab!=='conversations'}><ItemConversations principal={principal} kind={detail.item.kind} id={detail.item.id} onCountChange={setConversationCount}/></div>
      </div><div className="ds-detail-footer">{detail.item.kind==='ticket'&&principal.internal_notes_enabled?<TicketNotes actionsTarget={noteActionsTarget} key={principal.principal_id+':internal-note:'+detail.item.id} ticketId={detail.item.id} principal={principal} onBlockedChange={setInternalNoteBlocked}/>:null}</div>
    </div>:null}
  </DetailDialogProvider>;
  return content;
}
