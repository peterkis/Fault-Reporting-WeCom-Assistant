import type {HTMLAttributes,ReactNode} from 'react';
import {Bell,Clock3} from 'lucide-react';
import {Tag} from '../Tag/Tag';
import {visibleCardTags} from '../../status-map';
import type {CardTag} from '../../status-map';
import './ticket-card.css';

export function TicketCard({className='',...props}:HTMLAttributes<HTMLElement>){
  return <article {...props} className={'ticket-card ds-ticket-card '+className}/>;
}
type BodyProps={number:string;title:string;metadata:ReactNode;tags:readonly CardTag[];owner:ReactNode;activity:ReactNode;followUp?:ReactNode;deadline?:{tone:'attention'|'danger';label:string}};
export function TicketCardBody({number,title,metadata,tags,owner,activity,followUp,deadline}:BodyProps){
  const {shown,hidden}=visibleCardTags(tags);
  return <div className="ds-ticket-body">
    <div className="card-top"><span title={number}>{number}</span>{deadline?<span className="ds-ticket-deadline" data-tone={deadline.tone}><Clock3 aria-hidden="true"/>{deadline.label}</span>:null}</div>
    <h3 title={title}>{title||'问题描述未提供'}</h3>
    <div className="ds-ticket-metadata">{metadata}</div>
    <footer className="card-footer"><div className="card-tags">{shown.map(tag=><Tag key={tag.key} tone={tag.tone} className={'status-chip '+(tag.className??'')} {...(tag.key==='supplement'?{'data-supplement-follow-up-pending':'true'}:{})} title={tag.title??tag.label}>{tag.icon==='bell'?<Bell aria-hidden="true"/>:tag.icon==='clock'?<Clock3 aria-hidden="true"/>:null}<span>{tag.label}</span></Tag>)}{hidden.length?<Tag className={hidden.map(tag=>tag.className??'').join(' ')} {...(hidden.some(tag=>tag.key==='supplement')?{'data-supplement-follow-up-pending':'true'}:{})} title={hidden.map(tag=>tag.title??tag.label).join('；')} aria-label={'另有 '+hidden.length+' 项：'+hidden.map(tag=>tag.label).join('、')}>+{hidden.length}</Tag>:null}{followUp}</div><span className="ds-ticket-owner">{owner}</span>{activity}</footer>
  </div>;
}
