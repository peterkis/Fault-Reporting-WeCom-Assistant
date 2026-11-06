import type {HTMLAttributes,ReactNode} from 'react';
import {useId} from 'react';
import {Bell,Bot,Check,CircleX,Clock3} from 'lucide-react';
import {categoryOf} from '../../category-map';
import type {WorkbenchCard} from '../../../api/client';
import type {Heat} from '../../heat';
import {Tag} from '../Tag/Tag';
import {visibleCardTags} from '../../status-map';
import type {CardTag} from '../../status-map';
import {formatListTime} from '../../format-time';
import {Avatar} from '../Avatar/Avatar';
import {PropertyList} from '../PropertyList/PropertyList';
import {Section} from '../Section/Section';
import {BeijingTime} from '../Timeline/BeijingTime';
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
  const label=closure.reason_label??'已关闭';
  return <Tag className="ds-ticket-closure-reason" data-closure-reason title={label+(closure.duplicate_of?' · '+closure.duplicate_of.display_no:'')}>
    {label}{closure.duplicate_of?<><span aria-hidden="true"> · </span><span className="ds-closure-number">{closure.duplicate_of.display_no}</span></>:null}
  </Tag>;
}

export function DismissedTicketCardBody({item,now,followUp}:{item:WorkbenchCard;now:number;metadata:ReactNode;followUp?:ReactNode}){
  const closure=item.closure;
  if(closure?.kind!=='DISMISSED')return null;
  const name=closure.closed_by_display_name;
  return <div className="ds-ticket-body ds-ticket-dismissed-body has-category">
    <div className="card-top"><span title={item.number}>{item.number}</span><span className="activity-time ds-ticket-closed" title={closure.closed_at?closure.closed_at+'（北京时间）':'关闭时间未记录'}><CircleX aria-hidden="true"/>{closure.closed_at?<time dateTime={closure.closed_at.replace(' ','T')+'+08:00'}>{formatListTime(closure.closed_at,now)} 关闭</time>:<span>时间未记录 关闭</span>}</span><TicketCategoryTile service={item.service}/></div>
    <h3 title={item.title}>{item.title||'待补充的问题描述'}</h3>
    <footer className="card-footer"><div className="card-tags"><ClosureReason closure={closure}/>{followUp}</div><span className="ds-ticket-owner ds-ticket-closer" data-closure-source={closure.source??'unknown'}>
      {closure.source==='SYSTEM'?<><Avatar size={20} systemIcon={<Bot aria-hidden="true"/>} aria-hidden="true"/><span className="ds-ticket-close-method">系统判定</span></>:closure.source==='MANUAL'?<>{name?<><Avatar name={name} size={20} aria-hidden="true"/><span className="owner-name" title={name}>{name}</span><span aria-hidden="true"> · </span></>:null}<span className="ds-ticket-close-method">人工关闭</span></>:name?<span className="owner-name" title={name}>{name}</span>:null}
    </span></footer>
  </div>;
}

export function ClosureRecord({closure}:{closure:WorkbenchCard['closure']}){
  if(closure?.kind!=='DISMISSED')return null;
  return <Section title="关闭记录" data-closure-record="true"><PropertyList aria-label="关闭记录" className="ds-closure-properties">
    <div className="property-field"><dt>操作人</dt><dd>{closure.closed_by_display_name??(closure.source==='SYSTEM'?'系统':'未记录')}</dd></div>
    <div className="property-field"><dt>时间</dt><dd>{closure.closed_at?<BeijingTime value={closure.closed_at}/>:<span>未记录</span>}</dd></div>
    <div className="property-field"><dt>方式</dt><dd>{closure.source==='MANUAL'?'人工关闭':closure.source==='SYSTEM'?'系统判定':'未记录'}</dd></div>
    <div className="property-field"><dt>原因</dt><dd>{closure.reason_label??'未记录'}</dd></div>
    <div className="property-field"><dt>原单</dt><dd>{closure.duplicate_of?<span className="ds-closure-number">{closure.duplicate_of.display_no}</span>:<span>未关联</span>}</dd></div>
    <div className="property-field ds-closure-note"><dt>说明</dt><dd>{closure.reason_note??'未记录'}</dd></div>
  </PropertyList></Section>;
}

export function ClosureReasonOptions({options,value,isDisabled,onChange}:{options:readonly {value:string;label:string}[];value:string;isDisabled:boolean;onChange:(value:string)=>void}){
  const name=useId();
  return <fieldset className="ds-closure-reason-options" disabled={isDisabled} aria-label="关闭原因"><legend className="sr-only">关闭原因</legend>{options.map(option=><label className="ds-closure-reason-option" key={option.value}>
    <input className="sr-only" type="radio" name={name} value={option.value} checked={value===option.value} onChange={event=>onChange(event.currentTarget.value)}/><span className="ds-closure-reason-indicator" aria-hidden="true"/><span>{option.label}</span>
  </label>)}</fieldset>;
}
