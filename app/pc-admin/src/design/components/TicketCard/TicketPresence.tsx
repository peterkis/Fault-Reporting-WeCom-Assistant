import {Eye} from 'lucide-react';
import type {WorkbenchActivityPerson} from '../../../../../../contracts/workbench_activity_contracts';
import {PresenceTags} from '../PresenceTags/PresenceTags';

/** Card 30B B2: tags on the card's top edge; an unclaimed card adds a hover hint below itself, without blocking claiming. */
export function TicketPresence({people,unclaimed}:{people:readonly WorkbenchActivityPerson[];unclaimed:boolean}){
  const first=people[0];
  if(!first)return null;
  return <><PresenceTags people={people} className="ds-ticket-presence"/>
    {unclaimed?<p className="ds-presence-claim-hint" data-presence-claim-hint><Eye aria-hidden="true"/>{first.display_name}{first.mode==='EDITING'?'正在处理这张工单':'正在查看这张工单，领取前可先确认'}</p>:null}</>;
}
