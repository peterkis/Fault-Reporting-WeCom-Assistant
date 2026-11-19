import {StepEntry,useNextStep} from '../design/components/Drawer/NextStep';
import {Button as HButton} from '../design/components/Button/Button';
import {useQueryClient} from '@tanstack/react-query';
import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {Check,Lock} from 'lucide-react';
import {MessageBubble} from '../design/components/MessageBubble/MessageBubble';
import {ActorAvatar} from './ActorAvatar';
import {Section} from '../design/components/Section/Section';
import {Timeline,TimelineGroup,TimelineItem} from '../design/components/Timeline/Timeline';
import {BeijingTime} from '../design/components/Timeline/BeijingTime';
import {recordKind} from '../design/components/Timeline/record-kind';
import {StatusBadge} from '../design/components/StatusBadge/StatusBadge';
import {statusTones} from '../design/status-map';
import type {Principal,WorkbenchDetail} from '../api/client';
import {statusLabels} from '../api/client';
import {ClosureFacts} from '../design/components/TicketCard/TicketCard';
import {PersonalReadMaterial} from '../features/personal-read/PersonalReadMaterial';
import {groupActivityRecords} from './activity-time.mjs';
import {activityActorName} from './activity-actors.mjs';
import {DetailDialog,useDetailModalOpen} from './DetailDialog';
import {AssignmentCommunication,assignmentAction} from '../features/assignment-history/TicketAssignmentHistory';
import type {P2016AssignmentHistoryItem} from '../../../../contracts/p2_016_assignment_history_contracts';
import {animateTimelineEntry,highlightTimelineEntry,scrollAndHighlightEntries} from '../design/motion/timeline-entry';
import {NewItemsChip} from '../design/components/NewItemsChip/NewItemsChip';

type Assignments=ReadonlyMap<string,P2016AssignmentHistoryItem>;

function collectMutationEventIds(value:unknown,into:Set<string>){
  if(!value||typeof value!=='object')return;
  const record=value as Record<string,unknown>;
  for(const key of ['ticket_event_id','first_responsibility_event_id','staff_completion_event_id','event_id']){
    if(typeof record[key]==='string'&&record[key])into.add(record[key]);
  }
  if(record.handling_cycle)collectMutationEventIds(record.handling_cycle,into);
  if(record.completion)collectMutationEventIds(record.completion,into);
  if(record.result)collectMutationEventIds(record.result,into);
}

function isOwnTimelineRecord(record:WorkbenchDetail['records'][number],principal:Principal,ownEventIds:ReadonlySet<string>):boolean{
  if(record.actor_ref!==undefined)return record.actor_ref!==null&&record.actor_ref===principal.principal_id;
  const eventId=record.id.startsWith('event:')?record.id.slice(6):record.id.startsWith('external:')?record.id.slice(9):null;
  return eventId!==null&&ownEventIds.has(eventId);
}

function escapeAttrValue(value:string):string{
  return typeof CSS!=='undefined'&&typeof CSS.escape==='function'?CSS.escape(value):value.replace(/["\\]/gu,'\\$&');
}

export function DetailActionDialog({children,blocked,attention,available=true,readError=false,onOpenChange}:{children:ReactNode;blocked:boolean;attention:boolean;available?:boolean;readError?:boolean;onOpenChange?:((open:boolean)=>void)|undefined}){
  const [open,setOpen]=useState(false);
  const step=useNextStep();
  useEffect(()=>{if(attention)setOpen(true);},[attention]);
  const close=()=>{if(!blocked)setOpen(false);};
  if(step&&readError&&!open&&!attention)return children;
  return <>{!step||available||attention?<StepEntry action="complete" label={attention?'核对完工操作':'登记完工'} fallbackTone={'primary'}>{(tone,text)=><HButton type="button" className="detail-complete-button" onClick={()=>setOpen(true)} tone={tone}>{text}</HButton>}</StepEntry>:null}
    <DetailDialog open={open} onClose={close} closeBlocked={blocked} title="登记完工" closeLabel="关闭完工窗口" onOpenChange={onOpenChange}>{children}</DetailDialog></>;
}

export function ActivityTimeline({records,firstPageRecordIds,principal,item,active,now,children,description,assignments}:{records:WorkbenchDetail['records'];firstPageRecordIds?:ReadonlySet<string>|undefined;principal:Principal;item:WorkbenchDetail['item'];active:boolean;now:number;children:ReactNode;description?:string|null;assignments?:Assignments|undefined}){
  const modalOpen=useDetailModalOpen(),client=useQueryClient();
  const sectionRef=useRef<HTMLElement|null>(null),knownIdsRef=useRef<Set<string>|null>(null),ownEventsRef=useRef<Set<string>>(new Set());
  const pendingRevealRef=useRef<string[]>([]),cancelsRef=useRef<Set<()=>void>>(new Set());
  const [pendingRevealCount,setPendingRevealCount]=useState(0);
  const trackCancel=useCallback((cancel:()=>void)=>{cancelsRef.current.add(cancel);return()=>{cancelsRef.current.delete(cancel);};},[]);
  useLayoutEffect(()=>{
    const ids=new Set<string>();ownEventsRef.current=ids;
    const scan=(mutation:{options:{mutationKey?:readonly unknown[]};state:{status:string;data:unknown}})=>{
      if(mutation.state.status==='success'&&mutation.options.mutationKey?.[1]===principal.principal_id)collectMutationEventIds(mutation.state.data,ids);
    };
    const cache=client.getMutationCache();
    for(const mutation of cache.getAll())scan(mutation);
    return cache.subscribe(event=>{if(event.type==='updated')scan(event.mutation);});
  },[client,principal.principal_id]);
  useEffect(()=>()=>{for(const cancel of cancelsRef.current)cancel();cancelsRef.current.clear();},[]);
  const report=description?records.find(record=>record.audience==='REPORT'&&record.text===description):undefined;
  const timelineRecords=records.filter(record=>record!==report);
  const recordSignature=timelineRecords.map(record=>record.id).join('\u0000');
  const findRecordNode=useCallback((recordId:string)=>sectionRef.current?.querySelector<HTMLElement>('[data-record-id="'+escapeAttrValue(recordId)+'"]')??null,[]);
  useLayoutEffect(()=>{
    if(knownIdsRef.current===null){knownIdsRef.current=new Set(timelineRecords.map(record=>record.id));return;}
    const known=knownIdsRef.current,added=timelineRecords.filter(record=>!known.has(record.id));
    for(const record of timelineRecords)known.add(record.id);
    if(!added.length)return;
    // Only newly arrived top-page entries qualify; fetchNextPage appends older pages outside firstPageRecordIds.
    const arrived=firstPageRecordIds?added.filter(record=>firstPageRecordIds.has(record.id)):added;
    const arrivedOther=arrived.filter(record=>!isOwnTimelineRecord(record,principal,ownEventsRef.current));
    if(!arrivedOther.length)return;
    const section=sectionRef.current;
    if(!section||section.getClientRects().length===0)return;
    const scroller=section.closest<HTMLElement>('.detail-body');
    const aboveTop=Boolean(scroller&&section.getBoundingClientRect().top<scroller.getBoundingClientRect().top-1);
    if(aboveTop){
      const merged=new Set(pendingRevealRef.current);
      for(const record of arrivedOther)merged.add(record.id);
      pendingRevealRef.current=[...merged];
      setPendingRevealCount(pendingRevealRef.current.length);
      return;
    }
    for(const record of arrivedOther){
      const node=findRecordNode(record.id);
      if(!node)continue;
      const handle=animateTimelineEntry(node),untrack=trackCancel(handle.cancel);
      void handle.finished.then(untrack);
    }
  },[recordSignature]);
  const highlightPending=useCallback((ids:readonly string[])=>{
    for(const id of ids){
      const node=findRecordNode(id);
      if(!node)continue;
      const handle=highlightTimelineEntry(node),untrack=trackCancel(handle.cancel);
      void handle.finished.then(untrack);
    }
  },[findRecordNode,trackCancel]);
  useEffect(()=>{
    if(pendingRevealCount<=0)return;
    const section=sectionRef.current,scroller=section?.closest<HTMLElement>('.detail-body');
    if(!section||!scroller)return;
    const onScroll=()=>{
      if(pendingRevealRef.current.length===0)return;
      if(section.getBoundingClientRect().top>=scroller.getBoundingClientRect().top-1){
        const ids=pendingRevealRef.current;pendingRevealRef.current=[];setPendingRevealCount(0);
        highlightPending(ids);
      }
    };
    scroller.addEventListener('scroll',onScroll,{passive:true});
    return()=>scroller.removeEventListener('scroll',onScroll);
  },[pendingRevealCount,highlightPending]);
  const revealNewRecords=useCallback(()=>{
    const ids=pendingRevealRef.current;pendingRevealRef.current=[];setPendingRevealCount(0);
    if(!ids.length)return;
    const section=sectionRef.current,scroller=section?.closest<HTMLElement>('.detail-body');
    if(!section||!scroller){highlightPending(ids);return;}
    const targetTop=Math.max(0,scroller.scrollTop+(section.getBoundingClientRect().top-scroller.getBoundingClientRect().top));
    const cancel=scrollAndHighlightEntries(scroller,targetTop,()=>ids.map(findRecordNode).filter((node):node is HTMLElement=>node!==null));
    trackCancel(cancel);
  },[findRecordNode,highlightPending,trackCancel]);
  // Card 32 B6: closing statuses all read 「已关闭」; the latest closing record of a closed item carries its reason (and original ticket) as secondary text.
  const closing=item.closure?.kind==='DISMISSED'?records.filter(record=>recordKind(record)==='status'&&closingStatuses.has(record.new_status??'')).reduce<WorkbenchDetail['records'][number]|null>((latest,record)=>!latest||record.at>latest.at?record:latest,null):null;
  return <Section ref={sectionRef} className="detail-main" titleClassName="activity-title" title="处理记录">
    <div className="ds-timeline-chip-anchor" data-timeline-chip-anchor=""><NewItemsChip count={pendingRevealCount} direction="up" noun="记录" onActivate={revealNewRecords}/></div>
    <Timeline className="activity-list">
    {description?<div className="detail-description"><h3>报修描述</h3>{report?<ol><ActivityRecord record={report} principal={principal} item={item} active={active&&!modalOpen} now={now}/></ol>:<MessageBubble className="detail-report-description">{description}</MessageBubble>}</div>:null}
    {groupActivityRecords(timelineRecords,now).map(group=><TimelineGroup className="activity-group" key={group.label} label={group.label} date={group.date} aria-label={group.label+'的处理记录'}>
      {group.records.map(record=><ActivityRecord key={record.id} record={record} principal={principal} item={item} active={active&&!modalOpen} now={now} closure={record.id===closing?.id} assignment={record.id.startsWith('event:')?assignments?.get(record.id.slice(6)):undefined}/>)}
    </TimelineGroup>)}</Timeline>{children}
  </Section>;
}
const closingStatuses=new Set(['DISMISSED']);
function ActivityRecord({record,principal,item,active,now,closure=false,assignment}:{record:WorkbenchDetail['records'][number];principal:Principal;item:WorkbenchDetail['item'];active:boolean;now:number;closure?:boolean;assignment?:P2016AssignmentHistoryItem|undefined}){
  // Card 34B: a take-over or hand-over event is an event row even when it carries a reason, never a note bubble.
  const [expanded,setExpanded]=useState(false),name=activityActorName(record),kind=assignment&&recordKind(record)==='note'?'event':recordKind(record);
  // Card 34B: a take-over or hand-over event reads as its action (「接单」「转交给 周宁」「撤销派工」), followed by the recorded reason.
  const text=assignment?assignmentAction(assignment,record.type)+(record.text?' · '+record.text:''):record.text??(kind==='status'?'更新状态':'已记录处理操作。');
  const bubble=kind==='note'||kind==='report',time=<BeijingTime value={record.at} now={now}/>;
  const audience=kind==='note'&&record.audience==='INTERNAL'?<span className="record-audience" aria-label="内部，仅信息科可见"><Lock size={12}/>内部</span>:kind==='note'&&record.audience==='EXTERNAL'?<span className="record-audience public">报修人可见</span>:null;
  return <TimelineItem className={'detail-record'+(expanded?' is-expanded':'')} data-record-id={record.id} data-record-kind={kind} data-audience={record.audience} data-assignment-history-row={assignment?assignment.kind:undefined} avatar={<ActorAvatar principal={principal} item={item} actor={record.actor_ref} name={name}/>} time={bubble?undefined:time}>
    <HButton tone="ghost" className="record-content" aria-expanded={expanded} title={expanded?'收起记录':'展开完整记录'} onPress={()=>setExpanded(value=>!value)}>
      {bubble?<span className="record-heading"><span className="record-name">{name}</span>{kind==='report'?<><span className="record-report-separator" aria-hidden="true">·</span>{time}<span className="record-action sr-only">提交报修</span></>:<><span className="record-action">{record.audience==='INTERNAL'?'添加内部备注':'对外说明'}</span>{audience}{time}</>}</span>:<span className="record-name">{name}</span>}
      {record.read_material?<PersonalReadMaterial inline active={active} principal={principal} item={{kind:item.kind,id:item.id}} sourceRef={record.read_material.source_ref} revision={record.read_material.revision} text={text}/>:<span className="record-text">{text}</span>}
      {kind==='status'?<span className="record-status-change"><StatusBadge showStageGlyph={false} data-status={record.old_status??''} tone={statusTones[record.old_status??'']??'neutral'}>{statusLabels[record.old_status??'']??'新建'}</StatusBadge>{' → '}<StatusBadge showStageGlyph={false} data-status={record.new_status??''} tone={statusTones[record.new_status??'']??'neutral'}>{statusLabels[record.new_status??'']??'状态未记录'}</StatusBadge></span>:null}
    </HButton>
    {assignment?<AssignmentCommunication item={assignment}/>:null}
    {closure&&item.closure?<div className="record-closure-facts" data-record-closure-reason><ClosureFacts closure={item.closure}/></div>:null}
  </TimelineItem>;
}
