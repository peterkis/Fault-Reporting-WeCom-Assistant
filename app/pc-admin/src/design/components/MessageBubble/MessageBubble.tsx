import type {HTMLAttributes,ReactNode} from 'react';
import './message-bubble.css';

export function MessageBubble({side='incoming',internal=false,avatar,meta,footer,className='',children,...props}:HTMLAttributes<HTMLDivElement>&{side?:'incoming'|'outgoing'|'system';internal?:boolean;avatar?:ReactNode;meta?:ReactNode;footer?:ReactNode}){
 const bubble=<div {...props} className={'inbox-bubble ds-message-bubble '+className} data-side={side} data-internal={internal||undefined}>{internal?<span className="ds-message-prefix">内部</span>:null}{children}</div>;
 return avatar===undefined?bubble:<div className="ds-message-group" data-side={side}><span className="ds-message-avatar">{avatar}</span><div className="ds-message-content">{meta}{bubble}{footer}</div></div>;
}
