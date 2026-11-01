import type {HTMLAttributes} from 'react';
import type {Tone} from '../../status-map';
import {actionPresentation} from '../../status-map';
import './tag.css';

type Props=Omit<HTMLAttributes<HTMLSpanElement>,'style'|'color'> & {tone?:Tone};
export function Tag({tone='neutral',className='',children,...props}:Props){
  return <span {...props} data-tone={tone} className={'ds-tag '+className}><span className="ds-tag-content">{children??'—'}</span></span>;
}

/** Legacy hooks remain here; consumers express the existing urge meaning. */
export function UrgencyTag(props:Omit<Props,'tone'>){
  return <Tag {...props} tone={actionPresentation.urge.tone} className={'status-chip orange web-report-urge '+(props.className??'')}/>;
}
