import type {WorkbenchCard} from '../../../api/client';
import './stage-glyph.css';

export function StageGlyph({stage}:{stage:WorkbenchCard['column']}){
  return <svg className="ds-stage-glyph" data-stage-glyph={stage} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    {stage==='pending'?<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2.4 2.1"/>:
      stage==='active'?<><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.6"/><path d="M8 4.5A3.5 3.5 0 0 1 8 11.5Z" fill="currentColor"/></>:
        <><circle cx="8" cy="8" r="7" fill="currentColor"/><path className="ds-stage-check" d="m5 8.2 2 2 4-4.2" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></>}
  </svg>;
}
