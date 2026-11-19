import {Eye} from 'lucide-react';
import type {WorkbenchActivityPerson} from '../../../../../../contracts/workbench_activity_contracts';
import {PresenceTags} from '../PresenceTags/PresenceTags';

/** Card 30B B2 / D4: tags on the card's top edge; keep PresenceTags mounted so useExitPresence completes cleanly. */
export function TicketPresence({people,debounced,unclaimed}:{people:readonly WorkbenchActivityPerson[];debounced?:readonly WorkbenchActivityPerson[];unclaimed:boolean}){
  const shown=debounced??people,first=shown[0];
  return <><PresenceTags people={people} {...(debounced?{debounced}:{})} className="ds-ticket-presence"/>
    {first&&unclaimed?<p className="ds-presence-claim-hint" data-presence-claim-hint><Eye aria-hidden="true"/><span>{first.display_name}{first.mode==='EDITING'?'正在处理这张工单':'正在查看这张工单，领取前可先确认'}</span></p>:null}</>;
}
