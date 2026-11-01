import type {HTMLAttributes,ReactNode} from 'react';
import {Inbox} from 'lucide-react';
import './empty-state.css';

type Props=Omit<HTMLAttributes<HTMLElement>,'title'> & {title:ReactNode;description?:ReactNode;icon?:ReactNode;action?:ReactNode};
export function EmptyState({title,description,icon=<Inbox/>,action,className='',...props}:Props){
  return <section {...props} className={'ds-empty-state '+className}><span className="ds-empty-icon" aria-hidden="true">{icon}</span><h2>{title}</h2>{description?<p>{description}</p>:null}{action?<div className="ds-empty-action">{action}</div>:null}</section>;
}
