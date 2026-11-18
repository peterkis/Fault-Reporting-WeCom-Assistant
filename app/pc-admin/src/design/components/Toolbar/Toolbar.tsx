import type {HTMLAttributes,ReactNode} from 'react';
import {SlidersHorizontal} from 'lucide-react';
import './toolbar.css';
import {useRef} from 'react';
import {useDetailsDismiss} from '../Popover/useDetailsDismiss';
import '../Popover/details-popover.css';

export function Toolbar({children,className='',...props}:HTMLAttributes<HTMLDivElement>){
  return <div {...props} className={'toolbar ds-toolbar '+className}>{children}</div>;
}

/** Native disclosure keeps existing controls mounted, with no controller or query ownership. */
export function ToolbarFilters({children,label='筛选',disabled=false}:{children:ReactNode;label?:string;disabled?:boolean}){
  const root=useRef<HTMLDetailsElement>(null);useDetailsDismiss(root);
  return <details ref={root} className="ds-toolbar-filters"><summary aria-disabled={disabled} onClick={event=>{if(disabled)event.preventDefault();}}><SlidersHorizontal aria-hidden="true"/>{label}</summary><div className="ds-toolbar-filter-content">{children}</div></details>;
}
