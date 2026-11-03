import type {WorkbenchCard} from '../../../api/client';
import {stagePresentation} from '../../status-map';
import {StatusBadge} from '../StatusBadge/StatusBadge';

/** Drawer adapter for the canonical stage badge merged in Card 17. */
export function DrawerStageGlyph({stage}:{stage:WorkbenchCard['column']}){
  const {label,tone}=stagePresentation[stage];
  return <StatusBadge className="ds-stage-pill" tone={tone}>{label}</StatusBadge>;
}
