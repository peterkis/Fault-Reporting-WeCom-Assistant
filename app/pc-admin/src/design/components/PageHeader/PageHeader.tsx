import type {HTMLAttributes,ReactNode} from 'react';
import './page-header.css';

type Props=Omit<HTMLAttributes<HTMLElement>,'title'> & {title:ReactNode;icon?:ReactNode;description?:ReactNode;actions?:ReactNode};
export function PageHeader({title,icon,description,actions,className='',...props}:Props){
  return <header {...props} className={'page-title ds-page-header '+className}><div className="ds-page-heading"><div className="ds-page-heading-line">{icon?<span className="page-icon">{icon}</span>:null}<h1>{title}</h1></div>{description?<p>{description}</p>:null}</div>{actions?<div className="ds-page-actions tools">{actions}</div>:null}</header>;
}
