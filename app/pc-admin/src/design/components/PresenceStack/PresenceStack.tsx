import {Avatar} from '../Avatar/Avatar';
import './presence-stack.css';

/** Card 31 F1: up to three overlapping avatars with a green online dot, then 「+N」. Callers pass people editors/viewers first. */
export function PresenceStack({names,max=3}:{names:readonly string[];max?:number}){
  if(!names.length)return null;
  const shown=names.slice(0,max),rest=names.length-shown.length;
  return <span className="ds-presence-stack" aria-hidden="true">
    {shown.map((name,index)=><span key={name+index} className="ds-presence-stack-person"><Avatar name={name} size={20}/><span className="ds-presence-stack-dot"/></span>)}
    {rest>0?<span className="ds-presence-stack-more">+{rest}</span>:null}
  </span>;
}
