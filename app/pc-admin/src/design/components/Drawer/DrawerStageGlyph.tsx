import type {WorkbenchCard} from '../../../api/client';

/** Drawer-only presentation; the original stage and status text remain authoritative. */
export function DrawerStageGlyph({stage}:{stage:WorkbenchCard['column']}){
  return <svg className="ds-drawer-stage-glyph" data-drawer-stage-glyph={stage} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    {stage==='closed'?<><circle cx="8" cy="8" r="7" fill="currentColor"/><path className="ds-drawer-stage-check" d="m5 8.2 2 2 4-4.2" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></>:<><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray={stage==='pending'?'2.4 2.1':undefined}/>{stage==='active'?<path d="M8 4.5 A3.5 3.5 0 0 1 8 11.5 Z" fill="currentColor"/>:null}</>}
  </svg>;
}
