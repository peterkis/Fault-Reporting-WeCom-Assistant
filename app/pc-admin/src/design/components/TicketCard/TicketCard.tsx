import type {HTMLAttributes,ReactNode} from 'react';
import {Fragment,useId} from 'react';
import {Bell,Bot,Check,CircleX,Clock3,Undo2} from 'lucide-react';
import {categoryOf} from '../../category-map';
import type {WorkbenchCard} from '../../../api/client';
import type {Heat} from '../../heat';
import {Tag} from '../Tag/Tag';
import {visibleCardTags} from '../../status-map';
import type {CardTag} from '../../status-map';
import {formatListTime} from '../../format-time';
import {Avatar} from '../Avatar/Avatar';
import {BeijingTime} from '../Timeline/BeijingTime';
import {ClosureOriginalLink} from '../../../features/ticket-waiting/ClosureLinks';
import {closureReasonText,externalTicketNumber} from './closure-presentation';
import './ticket-card.css';

export function TicketCard({className='',...props}:HTMLAttributes<HTMLElement>){
  return <article {...props} className={'ticket-card ds-ticket-card '+className}/>;
}
export function TicketCategoryTile({service}:{service:WorkbenchCard['service']}){
  const category=categoryOf(service?.category,service?.code),Icon=category.icon;
  return <span className="ds-ticket-category" data-category={service?.category??'unclassified'} title={category.label==='未分类'?'未分类':service?service.category_name_zh+' · '+service.name_zh:category.label} style={{background:category.bg,color:category.fg,border:category.border??undefined}}><Icon aria-hidden="true"/><span className="sr-only">{service?service.category_name_zh+' · '+service.name_zh:'未分类'}</span></span>;
}
export function TicketHeat({heat,heatStart}:{heat:Heat;heatStart?:string|null|undefined}){
  return <Tag className="ds-ticket-heat" data-heat-tone={heat.tone} title={heatStart?'自 '+heatStart.slice(5,16)+' 起计时':undefined} tone={heat.tone}><Clock3 aria-hidden="true"/>{heat.label}</Tag>;
}

type BodyProps={number:string;title:string;metadata:ReactNode;tags:readonly CardTag[];owner:ReactNode;activity:ReactNode;followUp?:ReactNode;deadline?:{tone:'attention'|'danger';label:string};category?:ReactNode;heat?:Heat|null;heatStart?:string|null;completedAt?:string|null};
export function TicketCardBody({number,title,metadata,tags,owner,activity,followUp,deadline,category,heat,heatStart,completedAt}:BodyProps){
  const {shown,hidden}=visibleCardTags(tags);
  return <div className={'ds-ticket-body'+(category?' has-category':'')}>
    <div className="card-top"><span title={number}>{number}</span>{completedAt?<time className="ds-ticket-completed" dateTime={completedAt.replace(' ','T')+'+08:00'} title={completedAt+'（北京时间）'}><Check aria-hidden="true"/>{completedAt.slice(11,16)} 完成</time>:heat?<TicketHeat heat={heat} heatStart={heatStart}/>:deadline?<span className="ds-ticket-deadline" data-tone={deadline.tone}><Clock3 aria-hidden="true"/>{deadline.label}</span>:null}{category}</div>
    <h3 title={title}>{title||'待补充的问题描述'}</h3>
    <div className="ds-ticket-metadata">{metadata}</div>
    <footer className="card-footer"><div className="card-tags">{shown.map(tag=><Tag key={tag.key} tone={tag.tone} className={'status-chip '+(tag.className??'')} {...(tag.key==='supplement'?{'data-supplement-follow-up-pending':'true'}:{})} title={tag.title??tag.label}>{tag.icon==='bell'?<Bell aria-hidden="true"/>:tag.icon==='clock'?<Clock3 aria-hidden="true"/>:null}<span>{tag.label}</span></Tag>)}{hidden.length?<Tag className={hidden.map(tag=>tag.className??'').join(' ')} {...(hidden.some(tag=>tag.key==='supplement')?{'data-supplement-follow-up-pending':'true'}:{})} title={hidden.map(tag=>tag.title??tag.label).join('；')} aria-label={'另有 '+hidden.length+' 项：'+hidden.map(tag=>tag.label).join('、')}>+{hidden.length}</Tag>:null}{followUp}</div><span className="ds-ticket-owner">{owner}</span>{activity}</footer>
  </div>;
}

export function ClosureReason({closure}:{closure:WorkbenchCard['closure']}){
  if(!closure)return null;
  const original=externalTicketNumber(closure.duplicate_of?.display_no);
  const label=closure.reason_code==='DUPLICATE'&&original?'重复':closureReasonText(closure);
  return <Tag className="ds-ticket-closure-reason" data-closure-reason title={label+(original?' · '+original:'')}>
    <span className="ds-closure-reason-label">{label}</span>{original?<><span aria-hidden="true" className="ds-closure-reason-separator"> · </span><ClosureOriginalLink number={original}/></>:null}
  </Tag>;
}

export function DismissedTicketCardBody({item,now,followUp,titleLink}:{item:WorkbenchCard;now:number;metadata:ReactNode;followUp?:ReactNode;titleLink?:ReactNode}){
  const closure=item.closure;
  if(closure?.kind!=='DISMISSED')return null;
  const name=closure.ended_by_display_name;
  return <div className="ds-ticket-body ds-ticket-dismissed-body has-category">
    <div className="card-top"><span title={item.number}>{item.number}</span><span className="activity-time ds-ticket-dismissed-at" title={closure.ended_at?closure.ended_at+'（北京时间）':'关闭时间未记录'}><CircleX aria-hidden="true"/>{closure.ended_at?<time dateTime={closure.ended_at.replace(' ','T')+'+08:00'}>{formatListTime(closure.ended_at,now)} 关闭</time>:<span>时间未记录 关闭</span>}</span><TicketCategoryTile service={item.service}/></div>
    <h3 title={item.title}>{titleLink??(item.title||'待补充的问题描述')}</h3>
    <footer className="card-footer"><div className="card-tags"><ClosureReason closure={closure}/>{followUp}</div><span className="ds-ticket-owner ds-ticket-closer" data-closure-source={closure.source??'unknown'}>
      {closure.source==='SYSTEM'?<><Avatar size={20} systemIcon={<Bot aria-hidden="true"/>} aria-hidden="true"/><span className="ds-ticket-close-method">系统判定</span></>:closure.source==='MANUAL'?<>{name?<><Avatar name={name} size={20} aria-hidden="true"/><span className="owner-name" title={name}>{name}</span><span aria-hidden="true"> · </span></>:null}<span className="ds-ticket-close-method">人工关闭</span></>:name?<span className="owner-name" title={name}>{name}</span>:null}
    </span></footer>
  </div>;
}

export interface ClosureRecordEntry {source:'MANUAL'|'SYSTEM'|null;reason_code:string|null;reason_label:string|null;secondary_reason:{code:string;label:string}|null;note:string|null;duplicate_of:{display_no:string}|null;ended_at:string|null;ended_by_display_name:string|null;notification_state?:'SENT'|'UNKNOWN'|'NOT_SENT';restored_at?:string|null;restored_by_display_name?:string|null}
/** Reason tag + 「原单 IT-…」 link, shared by the closure record and (Card 32 B6) the closing line of the activity timeline. */
export function ClosureFacts({closure}:{closure:Pick<ClosureRecordEntry,'reason_code'|'reason_label'|'secondary_reason'|'duplicate_of'>}){
  const original=externalTicketNumber(closure.duplicate_of?.display_no);
  return <><Tag className="ds-closure-entry-reason">{closureReasonText(closure)}</Tag>
    {original?<span className="ds-closure-entry-original"><span>原单</span><ClosureOriginalLink number={original}/></span>:null}</>;
}
/** Card 29 D3: one compact closure entry; empty values are omitted instead of shown as placeholders. */
export function ClosureRecord({entry,now}:{entry:ClosureRecordEntry;now?:number}){
  const name=entry.ended_by_display_name;
  return <div className="ds-closure-entry" data-closure-record="true">
    <div className="ds-closure-entry-head">{entry.source==='SYSTEM'?<Avatar size={20} systemIcon={<Bot aria-hidden="true"/>} aria-hidden="true"/>:name?<Avatar name={name} size={20} aria-hidden="true"/>:null}
      {name?<strong className="ds-closure-entry-name">{name}</strong>:null}<span className="ds-closure-entry-method">{entry.source==='SYSTEM'?'系统判定':'人工关闭'}{entry.ended_at?<> · <BeijingTime value={entry.ended_at} {...(now===undefined?{}:{now})}/></>:null}</span></div>
    <div className="ds-closure-entry-facts"><ClosureFacts closure={entry}/>
      {entry.notification_state==='SENT'?<span className="ds-closure-entry-notified">已通知报修人</span>:null}</div>
    {entry.note?<p className="ds-closure-entry-note">说明：{entry.note}</p>:null}
    {entry.restored_at?<p className="ds-closure-restored-event" data-closure-restored-event><Undo2 aria-hidden="true"/>{entry.restored_by_display_name?<strong>{entry.restored_by_display_name}</strong>:null}<span>恢复 · <BeijingTime value={entry.restored_at} {...(now===undefined?{}:{now})}/></span></p>:null}
  </div>;
}

/** Native radios; a nested group (Card 29 K1) renders directly beneath its parent option. */
export function ClosureReasonOptions({options,value,isDisabled,onChange,label='关闭原因',nested}:{options:readonly {value:string;label:string;hint?:string}[];value:string;isDisabled:boolean;onChange:(value:string)=>void;label?:string;nested?:{after:string;content:ReactNode}|undefined}){
  const name=useId();
  return <fieldset className="ds-closure-reason-options" disabled={isDisabled} aria-label={label}><legend className="sr-only">{label}</legend>{options.map(option=><Fragment key={option.value}><label className="ds-closure-reason-option">
    <input className="sr-only" type="radio" name={name} value={option.value} checked={value===option.value} onChange={event=>onChange(event.currentTarget.value)}/><span className="ds-closure-reason-indicator" aria-hidden="true"/><span className="ds-closure-reason-text">{option.label}</span>{option.hint?<span className="ds-closure-reason-hint"> · {option.hint}</span>:null}
  </label>{nested?.after===option.value?nested.content:null}</Fragment>)}</fieldset>;
}
