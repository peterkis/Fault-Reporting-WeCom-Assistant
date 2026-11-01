import type {HTMLAttributes} from 'react';
import {MessageSquare,Smartphone,Phone,Radio} from 'lucide-react';
import './source-label.css';

type Props=Omit<HTMLAttributes<HTMLSpanElement>,'style'|'color'> & {source:string;label:string};
export function SourceLabel({source,label,className='',...props}:Props){
  const Icon=/PORTAL|H5|WEB/u.test(source)?Smartphone:/PHONE|MANUAL/u.test(source)?Phone:/WECOM|BOT|GROUP|CHAT/u.test(source)?MessageSquare:Radio;
  return <span title={label} {...props} className={'ds-source-label '+className}><Icon aria-hidden="true"/><span>{label||'来源未提供'}</span></span>;
}
