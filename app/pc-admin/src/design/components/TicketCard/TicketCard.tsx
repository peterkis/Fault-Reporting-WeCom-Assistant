import type {HTMLAttributes,ReactNode} from 'react';
import {Bell,Check,Clock3} from 'lucide-react';
import {categoryOf} from '../../category-map';
import type {WorkbenchCard} from '../../../api/client';
import type {Heat} from '../../heat';
import {Tag} from '../Tag/Tag';
import {visibleCardTags} from '../../status-map';
import type {CardTag} from '../../status-map';
import './ticket-card.css';

export function TicketCard({className='',...props}:HTMLAttributes<HTMLElement>){
  return <article {...props} className={'ticket-card ds-ticket-card '+className}/>;
}
export function TicketCategoryTile({service}:{service:WorkbenchCard['service']}){
  const category=categoryOf(service?.category,service?.code),Icon=category.icon;
  return <span className="ds-ticket-category" data-category={service?.category??'unclassified'} title={service?service.category_name_zh+' · '+service.name_zh:'未分类'} style={{background:category.bg,color:category.fg,border:category.border??undefined}}><Icon aria-hidden="true"/><span className="sr-only">{service?service.category_name_zh+' · '+service.name_zh:'未分类'}</span></span>;
}
type BodyProps={number:string;title:string;metadata:ReactNode;tags:readonly CardTag[];owner:ReactNode;activity:ReactNode;followUp?:ReactNode;deadline?:{tone:'attention'|'danger';label:string};category?:ReactNode;heat?:Heat|null;completedAt?:string|null};
export function TicketCardBody({number,title,metadata,tags,owner,activity,followUp,deadline,category,heat,completedAt}:BodyProps){
  const {shown,hidden}=visibleCardTags(tags);
  return <div className={'ds-ticket-body'+(category?' has-category':'')}>
    <div className="card-top"><span title={number}>{number}</span>{completedAt?<time className="ds-ticket-completed" dateTime={completedAt.replace(' ','T')+'+08:00'} title={completedAt+'（北京时间）'}><Check aria-hidden="true"/>{completedAt.slice(11,16)} 完成</time>:heat?<Tag className="ds-ticket-heat" data-heat-tone={heat.tone} tone={heat.tone}><Clock3 aria-hidden="true"/>{heat.label}</Tag>:deadline?<span className="ds-ticket-deadline" data-tone={deadline.tone}><Clock3 aria-hidden="true"/>{deadline.label}</span>:null}{category}</div>
    <h3 title={title}>{title||'待补充的问题描述'}</h3>
    <div className="ds-ticket-metadata">{metadata}</div>
    <footer className="card-footer"><div className="card-tags">{shown.map(tag=><Tag key={tag.key} tone={tag.tone} className={'status-chip '+(tag.className??'')} {...(tag.key==='supplement'?{'data-supplement-follow-up-pending':'true'}:{})} title={tag.title??tag.label}>{tag.icon==='bell'?<Bell aria-hidden="true"/>:tag.icon==='clock'?<Clock3 aria-hidden="true"/>:null}<span>{tag.label}</span></Tag>)}{hidden.length?<Tag className={hidden.map(tag=>tag.className??'').join(' ')} {...(hidden.some(tag=>tag.key==='supplement')?{'data-supplement-follow-up-pending':'true'}:{})} title={hidden.map(tag=>tag.title??tag.label).join('；')} aria-label={'另有 '+hidden.length+' 项：'+hidden.map(tag=>tag.label).join('、')}>+{hidden.length}</Tag>:null}{followUp}</div><span className="ds-ticket-owner">{owner}</span>{activity}</footer>
  </div>;
}
