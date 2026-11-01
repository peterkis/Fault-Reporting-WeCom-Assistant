import type {HTMLAttributes} from 'react';
import './message-bubble.css';

export function MessageBubble({side='incoming',internal=false,className='',children,...props}:HTMLAttributes<HTMLDivElement>&{side?:'incoming'|'outgoing'|'system';internal?:boolean}){
 return <div {...props} className={'inbox-bubble ds-message-bubble '+className} data-side={side} data-internal={internal||undefined}>{internal?<span className="ds-message-prefix">内部</span>:null}{children}</div>;
}
