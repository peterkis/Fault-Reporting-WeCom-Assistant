import type {HTMLAttributes,ReactNode} from 'react';
import {SlidersHorizontal} from 'lucide-react';
import './toolbar.css';

export function Toolbar({children,className='',...props}:HTMLAttributes<HTMLDivElement>){
  return <div {...props} className={'toolbar ds-toolbar '+className}>{children}</div>;
}

/** Native disclosure keeps existing controls mounted, with no controller or query ownership. */
export function ToolbarFilters({children,label='筛选',disabled=false}:{children:ReactNode;label?:string;disabled?:boolean}){
  return <details className="ds-toolbar-filters"><summary aria-disabled={disabled} onClick={event=>{if(disabled)event.preventDefault();}}><SlidersHorizontal aria-hidden="true"/>{label}</summary><div className="ds-toolbar-filter-content">{children}</div></details>;
}
