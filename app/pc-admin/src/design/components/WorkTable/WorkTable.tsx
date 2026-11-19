import {RestoreClosedItem,useClosureHighlight} from '../../../features/ticket-waiting/ClosureActions';
import {useCallback,useLayoutEffect,useState} from 'react';
import type {ReactNode} from 'react';
import {Bell,Bot,Check,CircleX,Pause,User} from 'lucide-react';
import type {BoardColumn,WorkbenchCard} from '../../../api/client';
import {cardHeat,cardHeatStart} from '../../heat';
import {formatListTime,formatWaitingTime} from '../../format-time';
import {cardTags,stagePresentation} from '../../status-map';
import {Avatar} from '../Avatar/Avatar';
import {Button} from '../Button/Button';
import {SourceLabel} from '../SourceLabel/SourceLabel';
import {StatusBadge} from '../StatusBadge/StatusBadge';
import {Tag} from '../Tag/Tag';
import {ClosureReason,TicketCategoryTile,TicketHeat} from '../TicketCard/TicketCard';
import {PresenceTags} from '../PresenceTags/PresenceTags';
import {usePresence} from '../../../features/activity/presence-store';
import {Skeleton,LoadingStatus} from '../Skeleton/Skeleton';
import {EmptyState} from '../EmptyState/EmptyState';
import {useDelayedLoading} from '../../hooks/useDelayedLoading';
import {PENDING_GROUPS,PROCESSED_GROUPS,groupPreferenceKey,itemsInGroup,loadingSlots,readGroupExpanded} from '../BoardColumn/column-groups';
import './work-table.css';
import {CollapseChevron} from '../Collapse/Collapse';

export interface WorkTableGroup {
  column:BoardColumn;label:string;items:WorkbenchCard[];count:number|string;
  feedback?:ReactNode;nextPage?:ReactNode;loading?:boolean;onRetry?:()=>void;
}
interface Props {
  searchError?:boolean;refreshing?:boolean;stale?:boolean;headerFeedback?:ReactNode;groups:WorkTableGroup[];principalId:string;selected:string|undefined;now:number;closureKind:string;
  renderLink:(item:WorkbenchCard,content:ReactNode)=>ReactNode;
  renderFollowUp:(item:WorkbenchCard)=>ReactNode;relativeTime:(value:string,now:number)=>string;
}
export const workTableHeaders=['类别 · 编号','问题','状态','时效','报修人 · 位置','负责人','最新活动'];
const WORK_TABLE_SKELETON_ROWS=5;
const present=(value:string|null|undefined)=>value?.trim()||null;
/** Keep the server order within the table's stage and subgroup sequence. */
export function orderWorkTableItems(items:readonly WorkbenchCard[]):WorkbenchCard[]{
  const pending=items.filter(item=>item.column==='pending'),handled=items.filter(item=>item.column==='handled');
  return [...pending.filter(item=>item.kind!=='ticket'),...pending.filter(item=>item.kind==='ticket'),...items.filter(item=>item.column==='active'),...handled.filter(item=>item.closure?.kind==='COMPLETED'),...handled.filter(item=>item.closure?.kind==='DISMISSED')];
}

function useFold(key:string,initial=true,preferInitial=false){
  const [expanded,setExpanded]=useState(()=>preferInitial?initial:readGroupExpanded(initial,key));
  return [expanded,()=>setExpanded(value=>{const next=!value;try{sessionStorage.setItem(key,String(next));}catch{/* The visual action remains available. */}return next;})] as const;
}
function ListStatus({item}:{item:WorkbenchCard}){
  if(item.closure?.kind==='DISMISSED')return <ClosureReason closure={item.closure}/>;
  if(item.status==='COMPLETED'&&item.closure?.kind==='COMPLETED')return <Tag className="status-chip" tone="success">已完成</Tag>;
  const substatus=cardTags(item).find(tag=>tag.key==='substatus');
  const waiting=item.status==='WAITING_VENDOR'||item.status==='WAITING_REQUESTER';
  const label=waiting?(item.status==='WAITING_VENDOR'?'等待厂商':'等待补充'):item.status==='WAITING_DESCRIPTION'?'资料不全':substatus?.label??(item.kind!=='ticket'?'待判断':item.column==='pending'?'待接单':item.column==='active'?'处理中':'已完成');
  return <Tag className="status-chip" tone={waiting||item.status==='WAITING_DESCRIPTION'?'neutral':substatus?.tone??(item.column==='active'?'info':item.column==='handled'?'success':'neutral')}>{waiting?<Pause aria-hidden="true"/>:null}{label}</Tag>;
}
function ListTime({item,now}:{item:WorkbenchCard;now:number}){
  const closure=item.closure;
  if(closure?.kind==='DISMISSED')return <span className="ds-list-time is-dismissed"><CircleX aria-hidden="true"/>{closure.ended_at?formatListTime(closure.ended_at,now)+' 关闭':'已关闭'}</span>;
  if(item.column==='handled')return item.completed_at?<span className="ds-list-time is-completed"><Check aria-hidden="true"/>{formatListTime(item.completed_at,now)} 完成</span>:<span className="ds-list-missing">—</span>;
  const heat=cardHeat(item,now),start=cardHeatStart(item),duration=formatWaitingTime(start,now);
  return heat?<TicketHeat heat={heat} heatStart={start}/>:duration?<span className="ds-list-time">{duration.label}</span>:<span className="ds-list-missing">—</span>;
}
function WorkRow({item,hidden,selected,now,renderLink,renderFollowUp,relativeTime}:Pick<Props,'selected'|'now'|'renderLink'|'renderFollowUp'|'relativeTime'>&{item:WorkbenchCard;hidden:boolean}){
  const highlighted=useClosureHighlight(item);
  const name=present(item.reporter_name),location=present(item.location),owner=present(item.assignee_name),dismissed=item.closure?.kind==='DISMISSED';
  const ownerName=owner?.replace(/\s*[（(][^（）()]*[）)]\s*$/u,'').trim()||owner;
  const sourceTitle='来源：'+(present(item.source_label)??'—')+' · 报修人：'+(name??'—')+' · 位置：'+(location??'—');
  const tags=cardTags(item).filter(tag=>['urge','review','supplement'].includes(tag.key));
  // Card 30B B3: only a shown, not-dismissed row reads presence; collapsed rows are not requested.
  const presence=usePresence({kind:item.kind,id:item.id},!hidden&&!dismissed);
  return <tr hidden={hidden} id={'list-item-'+item.kind+'-'+item.id} className={'ds-work-row'+(item.id===selected?' is-selected':'')} data-column={item.column} data-kind={item.kind} data-item-id={item.id} data-closure-kind={item.closure?.kind} data-closure-highlight={highlighted?'true':undefined}>
    <th scope="row"><span className="ds-list-identity"><TicketCategoryTile service={item.service}/><span className="ds-list-number" title={item.number}>{item.number}</span></span></th>
    <td className="ds-list-problem"><div className="ds-list-issue-content">{renderLink(item,<><span className="ds-list-title" title={item.title}>{present(item.title)??'—'}</span><span className="sr-only">查看详情</span></>)}<span className="ds-list-tags">{tags.map(tag=><Tag key={tag.key} tone={tag.tone} className={tag.className} title={tag.title??tag.label} {...(tag.key==='supplement'?{'data-supplement-follow-up-pending':'true'}:{})}>{tag.icon==='bell'?<Bell aria-hidden="true"/>:null}{tag.key==='urge'?'催 '+item.web_report_urge?.count+' 次':tag.label}</Tag>)}{renderFollowUp(item)}</span><PresenceTags people={presence} className="ds-list-presence"/></div></td>
    <td className="ds-list-status"><ListStatus item={item}/></td>
    <td><ListTime item={item} now={now}/></td>
    <td><span className="ds-list-reporter" title={sourceTitle}>{name||location?<>{item.source==='WECOM_DIRECT'?<User className="ds-list-source-icon" aria-hidden="true"/>:<SourceLabel source={item.source} label={item.source_label}/>}<span className="ds-list-person-location">{name}{name&&location?<span className="ds-list-separator"> · </span>:null}{location}</span></>:<span className="ds-list-missing">—</span>}</span></td>
    <td className="ds-list-owner-cell">{dismissed&&item.closure?.source==='SYSTEM'?<span className="ds-list-owner is-system"><Bot aria-hidden="true"/>系统判定</span>:owner?<span className="ds-list-owner" title={owner}><Avatar name={owner} size={20} aria-hidden="true"/><span className="ds-list-owner-name">{ownerName}</span></span>:<span className="ds-list-owner is-unassigned"><span className="ds-list-unassigned" aria-hidden="true"/>未领取</span>}{dismissed?<RestoreClosedItem item={item}/>:null}<kbd className="ds-list-claim-key" aria-hidden="true">E</kbd></td>
    <td><time className="activity-time" dateTime={item.updated_at.replace(' ','T')+'+08:00'} title={item.updated_at+'（北京时间）'}>{relativeTime(item.updated_at,now)}</time></td>
  </tr>;
}
/** Owner-confirmed E3 exception: native table rows change visibility instantly; only arrows animate. */
function ListRows({items,expanded,id,...props}:Omit<Props,'groups'|'principalId'|'closureKind'>&{items:WorkbenchCard[];expanded:boolean;id:string}){
  const [all,setAll]=useState(false),visible=all?items:items.slice(0,3);
  return <><tr hidden={!expanded||items.length>0} id={id+'-empty'} className="ds-list-empty"><td colSpan={7}><EmptyState size="compact" title="这里暂时没有工单"/></td></tr>{visible.map(item=><WorkRow key={item.kind+':'+item.id} {...props} item={item} hidden={!expanded}/>)}{items.length>3?<tr hidden={!expanded} id={id+'-more'} className="ds-list-more"><td colSpan={7}><Button tone="ghost" data-action="expand-column" aria-expanded={all} aria-controls={items.map(item=>'list-item-'+item.kind+'-'+item.id).join(' ')} onPress={()=>setAll(value=>!value)}><CollapseChevron expanded={all}/>{all?'收起':('显示剩余 '+(items.length-3)+' 项')}</Button></td></tr>:null}</>;
}
type SubgroupLoading={rows:number;slow:boolean;onRetry?:()=>void};
function Subgroup({label,items,preferenceKey,defaultExpanded=true,forced=false,note,loading,...props}:Omit<Props,'groups'|'principalId'|'closureKind'>&{label:string;items:WorkbenchCard[];preferenceKey:string;defaultExpanded?:boolean;forced?:boolean;note?:string;loading?:SubgroupLoading}){
  const [expanded,toggle]=useFold(preferenceKey,forced||defaultExpanded,forced),id='list-subgroup-'+preferenceKey.split(':').at(-1);
  const controls=loading?id+'-loading':items.length?items.slice(0,3).map(item=>'list-item-'+item.kind+'-'+item.id).join(' '):id+'-empty';
  return <><tr className="ds-list-subgroup" data-board-group={label}><th colSpan={7} scope="rowgroup"><Button className="ds-board-group-trigger" tone="ghost" aria-expanded={expanded} aria-controls={controls} isDisabled={Boolean(loading)} onPress={toggle}><CollapseChevron expanded={expanded} from="right"/><span>{label}</span><span className="ds-board-group-count">{loading?'…':items.length}</span>{note?<span className="ds-board-group-note">{note}</span>:null}</Button></th></tr>{loading?expanded?<WorkTableSkeletonRows rows={loading.rows} slow={loading.slow} {...(loading.onRetry?{onRetry:loading.onRetry}:{})} statusId={id+'-loading'}/>:null:<ListRows {...props} items={items} expanded={expanded} id={id}/>}</>;
}
function Stage({group,principalId,closureKind,skeletonRows,onLoadingChange,...props}:Omit<Props,'groups'>&{group:WorkTableGroup;skeletonRows:number;onLoadingChange:(column:BoardColumn,visible:boolean)=>void}){
  const loading=useDelayedLoading(group.loading===true);
  const {column,label,items,count,feedback,nextPage}=group,[expanded,toggle]=useFold('pc-admin:list-stage:'+principalId+':'+column,true,column==='handled'&&closureKind!=='all'),id='list-'+column;
  useLayoutEffect(()=>{onLoadingChange(group.column,loading.visible&&expanded);return()=>onLoadingChange(group.column,false);},[group.column,loading.visible,expanded,onLoadingChange]);
  const definitions=column==='handled'?PROCESSED_GROUPS.filter(definition=>closureKind==='all'||definition.key===closureKind):column==='pending'?PENDING_GROUPS:[];
  const forced=(key:string)=>column==='handled'&&closureKind===key;
  const loadingGroups=definitions.filter(definition=>forced(definition.key)||readGroupExpanded(definition.defaultExpanded,groupPreferenceKey(definition,principalId,'list')));
  const subgroups=(pending:boolean)=>definitions.map(definition=><Subgroup key={definition.key} {...props} label={definition.label} preferenceKey={groupPreferenceKey(definition,principalId,'list')} items={pending?[]:itemsInGroup(definition,items)} defaultExpanded={definition.defaultExpanded} forced={forced(definition.key)} {...(definition.note?{note:definition.note}:{})} {...(pending?{loading:{rows:loadingSlots(skeletonRows,loadingGroups.indexOf(definition),loadingGroups.length),slow:loading.slow,...(group.onRetry?{onRetry:group.onRetry}:{})}}:{})}/>);

  return <tbody className="list-group" aria-label={label} id={id}>
    <tr className="ds-list-stage" aria-label={label+'事项列表'}><th colSpan={7} scope="rowgroup"><div className="column-heading"><Button className="ds-list-stage-toggle" tone="ghost" isIconOnly aria-label={(expanded?'折叠':'展开')+label} aria-expanded={expanded} aria-controls={id} onPress={toggle}><CollapseChevron expanded={expanded} from="right"/></Button><h2 className={'stage-pill '+column}><StatusBadge tone={stagePresentation[column].tone}>{label}</StatusBadge></h2><span className="ds-list-stage-count" title="当前筛选后已加载的事项">{count}</span></div></th></tr>
    {expanded&&loading.visible?<>{column==='handled'&&closureKind!=='all'?<tr className="ds-list-note"><td colSpan={7}>按结束方式筛选时只显示已处理事项</td></tr>:null}{definitions.length?subgroups(true):<WorkTableSkeletonRows rows={skeletonRows} slow={loading.slow} onRetry={group.onRetry}/>}</>:expanded&&!group.loading?<>{column==='handled'&&closureKind!=='all'?<tr className="ds-list-note"><td colSpan={7}>按结束方式筛选时只显示已处理事项</td></tr>:null}{feedback?<tr className="ds-list-feedback"><td colSpan={7}>{feedback}</td></tr>:null}{feedback&&!items.length?null:definitions.length&&items.length?subgroups(false):<ListRows {...props} items={items} expanded id={id}/>} {nextPage?<tr className="ds-list-more"><td colSpan={7}>{nextPage}</td></tr>:null}</>:null}
  </tbody>;
}
/** Native row/column headers preserve table semantics for cross-column group rows. */
export function WorkTableHead({feedback}:{feedback?:ReactNode}){
  return <><colgroup>{workTableHeaders.map((header,index)=><col key={header} className={'ds-work-col-'+index}/>)}</colgroup><thead><tr>{workTableHeaders.map((header,index)=><th key={header} scope="col" aria-label={header}><span className="ds-work-header-label">{header}</span>{index===workTableHeaders.length-1?feedback:null}</th>)}</tr></thead></>;
}
export function WorkTableSkeletonRows({rows=WORK_TABLE_SKELETON_ROWS,slow=false,onRetry,statusId}:{rows?:number;slow?:boolean;onRetry?:(()=>void)|undefined;statusId?:string}){
  return <>{Array.from({length:rows},(_,row)=><tr className="ds-work-row ds-work-skeleton-row" key={row} aria-hidden="true">{workTableHeaders.map((header,index)=><td key={header}>{index===0?<span className="ds-list-identity"><Skeleton w="var(--space-6)" h="var(--space-6)"/><Skeleton w="60%"/></span>:<Skeleton w={index===1?'85%':'65%'}/>}</td>)}</tr>)}<tr className="ds-work-skeleton-status" id={statusId}><td colSpan={workTableHeaders.length}><LoadingStatus label="正在读取工单列表…" slow={slow} {...(onRetry?{onRetry}:{})}>{null}</LoadingStatus></td></tr></>;
}
export function WorkTableSkeleton({slow=false,onRetry}:{slow?:boolean;onRetry?:()=>void}){
  return <div className="table-wrap ds-work-table-wrap" role="region" aria-label="工作台列表，可横向滚动" tabIndex={0}><table className="work-table ds-work-table" aria-label="工作台事项列表"><WorkTableHead/><tbody><WorkTableSkeletonRows slow={slow} onRetry={onRetry}/></tbody></table></div>;
}
export function WorkTable({groups,searchError=false,refreshing=false,stale=false,headerFeedback,...props}:Props){
  const [visible,setVisible]=useState<Partial<Record<BoardColumn,boolean>>>({});
  const onLoadingChange=useCallback((column:BoardColumn,value:boolean)=>setVisible(current=>current[column]===value?current:{...current,[column]:value}),[]);
  const shown=groups.filter(group=>visible[group.column]===true),candidates=shown.length?shown:groups.filter(group=>group.loading);
  const rowsFor=(column:BoardColumn)=>{const index=candidates.findIndex(group=>group.column===column);return index<0?0:Math.floor(WORK_TABLE_SKELETON_ROWS/candidates.length)+(index<WORK_TABLE_SKELETON_ROWS%candidates.length?1:0);};
  return <div className="ds-state-region ds-table-state" data-search-state={searchError?'error':undefined} data-refreshing={refreshing?'true':undefined} data-stale={stale?'true':undefined}><div className="table-wrap ds-work-table-wrap" tabIndex={0} role="region" aria-label="工作台列表，可横向滚动"><table className="work-table ds-work-table" aria-label="工作台事项列表"><WorkTableHead feedback={headerFeedback}/>{groups.map(group=><Stage key={group.column+':'+props.principalId+':'+props.closureKind} {...props} group={group} skeletonRows={rowsFor(group.column)} onLoadingChange={onLoadingChange}/>)}</table></div></div>;
}
