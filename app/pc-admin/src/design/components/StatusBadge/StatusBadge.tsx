import type {HTMLAttributes} from 'react';
import type {Tone} from '../../status-map';
import './status-badge.css';

type Props=Omit<HTMLAttributes<HTMLSpanElement>,'style'|'color'> & {tone?:Tone};
export function StatusBadge({tone='neutral',className='',children,...props}:Props){
  return <span {...props} data-tone={tone} className={'ds-status-badge '+className}><span className="ds-status-dot" aria-hidden="true"/><span className="ds-status-text">{children??'状态待确认'}</span></span>;
}
