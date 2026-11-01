import type {HTMLAttributes,ReactNode} from 'react';
import {Bell,MessageSquare} from 'lucide-react';
import {Avatar} from '../Avatar/Avatar';
import './timeline.css';

export function Timeline({className='',...props}:HTMLAttributes<HTMLDivElement>){return <div {...props} className={'ds-timeline '+className}/>;}
export function TimelineEvent({className='',children,...props}:HTMLAttributes<HTMLDivElement>){return <div {...props} className={'ds-timeline-event '+className}><Avatar size={20} systemIcon={<MessageSquare size={14}/>}/><div>{children}</div></div>;}
export function TimelineGroup({label,date,children,className='',...props}:HTMLAttributes<HTMLElement>&{label:string;date?:string}){
  return <section {...props} className={'ds-timeline-group '+className}><h4>{label}{date&&label!==date?<span>{date}</span>:null}</h4><ol>{children}</ol></section>;
}
export function TimelineItem({avatar,time,children,className='',...props}:HTMLAttributes<HTMLLIElement>&{avatar:ReactNode;time?:ReactNode}){
  return <li {...props} className={'ds-timeline-item '+className}><span className="ds-timeline-rail record-actor-rail" aria-hidden="true">{avatar}</span>{children}{time}</li>;
}
export function NotificationSummary({title,children,...props}:HTMLAttributes<HTMLLIElement>){
  return <li {...props} className="notification-node ds-notification-summary"><Bell className="ds-notification-icon" aria-hidden="true"/><strong>{title}</strong>{children}</li>;
}
