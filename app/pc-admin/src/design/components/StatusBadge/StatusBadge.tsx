import type {HTMLAttributes} from 'react';
import {stagePresentation,type Tone} from '../../status-map';
import {StageGlyph} from '../StageGlyph/StageGlyph';
import './status-badge.css';

type Props=Omit<HTMLAttributes<HTMLSpanElement>,'style'|'color'> & {tone?:Tone};
export function StatusBadge({tone='neutral',className='',children,...props}:Props){
  const stage=(Object.keys(stagePresentation) as (keyof typeof stagePresentation)[]).find(key=>stagePresentation[key].label===children);
  return <span {...props} data-tone={tone} data-stage={stage} className={'ds-status-badge '+className}>{stage?<StageGlyph stage={stage}/>:<span className="ds-status-dot" aria-hidden="true"/>}<span className="ds-status-text">{children??'状态待确认'}</span></span>;
}
