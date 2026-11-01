import type {HTMLAttributes,ReactNode} from 'react';
import {Info,TriangleAlert,CheckCircle2} from 'lucide-react';
import './inline-alert.css';

type Props=HTMLAttributes<HTMLDivElement> & {tone?:'neutral'|'info'|'success'|'warning'|'danger';action?:ReactNode};
export function InlineAlert({tone='info',children,action,className='',...props}:Props){
  const Icon=tone==='danger'||tone==='warning'?TriangleAlert:tone==='success'?CheckCircle2:Info;
  return <div role={tone==='danger'?'alert':'status'} {...props} data-tone={tone} className={'ds-inline-alert '+className}><Icon aria-hidden="true"/><div>{children}</div>{action?<div className="ds-alert-action">{action}</div>:null}</div>;
}
