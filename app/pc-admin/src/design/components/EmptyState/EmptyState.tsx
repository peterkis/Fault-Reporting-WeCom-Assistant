import type {HTMLAttributes,ReactNode} from 'react';
import {Check,Inbox,SearchX} from 'lucide-react';
import {Button} from '../Button/Button';
import './empty-state.css';

type Common=Omit<HTMLAttributes<HTMLElement>,'title'> & {title:ReactNode;description?:ReactNode;icon?:ReactNode;action?:ReactNode;tone?:'neutral'|'success';size?:'compact'|'block'|'page'};
type Props=Common&({variant:'filtered';onClear:()=>void;summary:ReactNode}|{variant?:'default';onClear?:never;summary?:never});
export function EmptyState({title,description,icon,action,tone='neutral',size='page',variant='default',onClear,summary,className='',...props}:Props){
  return <section role="status" {...props} data-tone={tone} data-size={size} data-empty-variant={variant} className={'ds-empty-state '+className}>{size!=='compact'?<span className="ds-empty-icon" aria-hidden="true">{icon??(tone==='success'?<Check/>:variant==='filtered'?<SearchX/>:<Inbox/>)}</span>:null}<h2>{title}</h2>{size==='page'&&(summary??description)?<p>{summary??description}</p>:null}{variant==='filtered'?<div className="ds-empty-action"><Button size="sm" onPress={()=>onClear?.()}>清除筛选</Button></div>:action?<div className="ds-empty-action">{action}</div>:null}</section>;
}
