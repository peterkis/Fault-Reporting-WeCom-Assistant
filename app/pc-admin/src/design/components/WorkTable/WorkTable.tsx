import {RestoreClosedItem,useClosureHighlight} from '../../../features/ticket-waiting/ClosureActions';
import {useState} from 'react';
import type {ReactNode} from 'react';
import {Bell,Bot,Check,ChevronDown,ChevronRight,ChevronUp,CircleX,Pause,User} from 'lucide-react';
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
import './work-table.css';

export interface WorkTableGroup {
  column:BoardColumn;label:string;items:WorkbenchCard[];count:number|string;
  feedback?:ReactNode;nextPage?:ReactNode;
}
interface Props {
  groups:WorkTableGroup[];principalId:string;selected:string|undefined;now:number;closureKind:string;
  renderLink:(item:WorkbenchCard,content:ReactNode)=>ReactNode;
  renderFollowUp:(item:WorkbenchCard)=>ReactNode;relativeTime:(value:string,now:number)=>string;
}
const headers=['类别 · 编号','问题','状态','时效','报修人 · 位置','负责人','最新活动'];
const present=(value:string|null|undefined)=>value?.trim()||null;
/** Keep the server order within the table's stage and subgroup sequence. */
export function orderWorkTableItems(items:readonly WorkbenchCard[]):WorkbenchCard[]{
  const pending=items.filter(item=>item.column==='pending'),closed=items.filter(item=>item.column==='closed');
  return [...pending.filter(item=>item.kind!=='ticket'),...pending.filter(item=>item.kind==='ticket'),...items.filter(item=>item.column==='active'),...closed.filter(item=>item.closure?.kind==='COMPLETED'),...closed.filter(item=>item.closure?.kind==='DISMISSED')];
}

function useFold(key:string,initial=true,preferInitial=false){
  const [expanded,setExpanded]=useState(()=>{if(preferInitial)return initial;try{const saved=sessionStorage.getItem(key);if(saved==='true'||saved==='false')return saved==='true';}catch{/* Use in-memory folding if storage is disabled. */}return initial;});
  return [expanded,()=>setExpanded(value=>{const next=!value;try{sessionStorage.setItem(key,String(next));}catch{/* The visual action remains available. */}return next;})] as const;
}
function ListStatus({item}:{item:WorkbenchCard}){
  if(item.closure?.kind==='DISMISSED')return <ClosureReason closure={item.closure}/>;
  if(item.status==='COMPLETED'&&item.closure?.kind==='COMPLETED')return <Tag className="status-chip" tone="success">已完成</Tag>;
  const substatus=cardTags(item).find(tag=>tag.key==='substatus');
  const waiting=item.status==='WAITING_VENDOR'||item.status==='WAITING_REQUESTER';
  const label=waiting?(item.status==='WAITING_VENDOR'?'等待厂商':'等待补充'):item.status==='WAITING_DESCRIPTION'?'资料不全':substatus?.label??(item.kind!=='ticket'?'待判断':item.column==='pending'?'待接单':item.column==='active'?'处理中':'已完成');
  return <Tag className="status-chip" tone={waiting||item.status==='WAITING_DESCRIPTION'?'neutral':substatus?.tone??(item.column==='active'?'info':item.column==='closed'?'success':'neutral')}>{waiting?<Pause aria-hidden="true"/>:null}{label}</Tag>;
}
function ListTime({item,now}:{item:WorkbenchCard;now:number}){
  const closure=item.closure;
  if(closure?.kind==='DISMISSED')return <span className="ds-list-time is-dismissed"><CircleX aria-hidden="true"/>{closure.closed_at?formatListTime(closure.closed_at,now)+' 关闭':'已关闭'}</span>;
  if(item.column==='closed')return item.completed_at?<span className="ds-list-time is-completed"><Check aria-hidden="true"/>{formatListTime(item.completed_at,now)} 完成</span>:<span className="ds-list-missing">—</span>;
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
function ListRows({items,expanded,id,...props}:Omit<Props,'groups'|'principalId'|'closureKind'>&{items:WorkbenchCard[];expanded:boolean;id:string}){
  const [all,setAll]=useState(false),visible=all?items:items.slice(0,3);
  return <><tr hidden={!expanded||items.length>0} id={id+'-empty'} className="ds-list-empty"><td colSpan={7}>暂无事项</td></tr>{visible.map(item=><WorkRow key={item.kind+':'+item.id} {...props} item={item} hidden={!expanded}/>)}{items.length>3?<tr hidden={!expanded} id={id+'-more'} className="ds-list-more"><td colSpan={7}><Button tone="ghost" data-action="expand-column" aria-expanded={all} aria-controls={items.map(item=>'list-item-'+item.kind+'-'+item.id).join(' ')} onPress={()=>setAll(value=>!value)}>{all?<><ChevronUp aria-hidden="true"/>收起</>:<><ChevronDown aria-hidden="true"/>{'显示剩余 '+(items.length-3)+' 项'}</>}</Button></td></tr>:null}</>;
}
function Subgroup({label,items,preferenceKey,defaultExpanded=true,forced=false,note,...props}:Omit<Props,'groups'|'principalId'|'closureKind'>&{label:string;items:WorkbenchCard[];preferenceKey:string;defaultExpanded?:boolean;forced?:boolean;note?:string}){
  const [expanded,toggle]=useFold(preferenceKey,forced||defaultExpanded,forced),id='list-subgroup-'+preferenceKey.split(':').at(-1);
  return <><tr className="ds-list-subgroup" data-board-group={label}><th colSpan={7} scope="rowgroup"><Button className="ds-board-group-trigger" tone="ghost" aria-expanded={expanded} aria-controls={items.length?items.slice(0,3).map(item=>'list-item-'+item.kind+'-'+item.id).join(' '):id+'-empty'} onPress={toggle}>{expanded?<ChevronDown aria-hidden="true"/>:<ChevronRight aria-hidden="true"/>}<span>{label}</span><span className="ds-board-group-count">{items.length}</span>{note?<span className="ds-board-group-note">{note}</span>:null}</Button></th></tr><ListRows {...props} items={items} expanded={expanded} id={id}/></>;
}
function Stage({group,principalId,closureKind,...props}:Omit<Props,'groups'>&{group:WorkTableGroup}){
  const {column,label,items,count,feedback,nextPage}=group,[expanded,toggle]=useFold('pc-admin:list-stage:'+principalId+':'+column,true,column==='closed'&&closureKind!=='all'),id='list-'+column;
  return <tbody className="list-group" aria-label={label} id={id}>
    <tr className="ds-list-stage" aria-label={label+'事项列表'}><th colSpan={7} scope="rowgroup"><div className="column-heading"><Button className="ds-list-stage-toggle" tone="ghost" isIconOnly aria-label={(expanded?'折叠':'展开')+label} aria-expanded={expanded} aria-controls={id} onPress={toggle}>{expanded?<ChevronDown aria-hidden="true"/>:<ChevronRight aria-hidden="true"/>}</Button><h2 className={'stage-pill '+column}><StatusBadge tone={stagePresentation[column].tone}>{label}</StatusBadge></h2><span className="ds-list-stage-count" title="当前筛选后已加载的事项">{count}</span></div></th></tr>
    {expanded?<>{column==='closed'&&closureKind!=='all'?<tr className="ds-list-note"><td colSpan={7}>按结束方式筛选时只显示已处理事项</td></tr>:null}{feedback?<tr className="ds-list-feedback"><td colSpan={7}>{feedback}</td></tr>:null}{feedback&&!items.length?null:column==='pending'&&items.length?<>{[false,true].map(ticket=><Subgroup key={String(ticket)} {...props} label={ticket?'待接单':'待判断'} preferenceKey={'pc-admin:list-pending:'+principalId+':'+(ticket?'ticket':'intake')} items={items.filter(item=>(item.kind==='ticket')===ticket)}/>)}</>:column==='closed'&&items.length?<>{(['completed','dismissed'] as const).filter(kind=>closureKind==='all'||closureKind===kind).map(kind=><Subgroup key={kind} {...props} label={kind==='completed'?'已完成':'已关闭'} items={items.filter(item=>item.closure?.kind===kind.toUpperCase())} preferenceKey={'pc-admin:processed-group:'+principalId+':'+kind} defaultExpanded={kind==='completed'} forced={closureKind===kind} {...(kind==='dismissed'?{note:'不计入完成数'}:{})}/>)}</>:<ListRows {...props} items={items} expanded id={id}/>} {nextPage?<tr className="ds-list-more"><td colSpan={7}>{nextPage}</td></tr>:null}</>:null}
  </tbody>;
}
/** Native row/column headers preserve table semantics for cross-column group rows. */
export function WorkTable({groups,...props}:Props){
  return <div className="table-wrap ds-work-table-wrap" tabIndex={0} role="region" aria-label="工作台列表，可横向滚动"><table className="work-table ds-work-table" aria-label="工作台事项列表"><colgroup>{headers.map((header,index)=><col key={header} className={'ds-work-col-'+index}/>)}</colgroup><thead><tr>{headers.map(header=><th key={header} scope="col">{header}</th>)}</tr></thead>{groups.map(group=><Stage key={group.column+':'+props.principalId+':'+props.closureKind} {...props} group={group}/>)}</table></div>;
}
