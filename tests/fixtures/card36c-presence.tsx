import '../../app/pc-admin/src/design/fonts.css';
import '../../app/pc-admin/src/design/foundation.css';
import '../../app/pc-admin/src/design/motion/controls.css';
import '../../app/pc-admin/src/app/heroui-workbench.css';
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {TicketCard,TicketCardBody} from '../../app/pc-admin/src/design/components/TicketCard/TicketCard';
import {TicketPresence} from '../../app/pc-admin/src/design/components/TicketCard/TicketPresence';
import {useDebouncedPresence,usePresenceModeTransition} from '../../app/pc-admin/src/design/components/PresenceTags/use-debounced-presence';
import {installMotionDebug} from '../../app/pc-admin/src/design/motion/debug';
import type {WorkbenchActivityPerson} from '../../contracts/workbench_activity_contracts';

declare global {
  interface Window {setCard36cPeople: (people: WorkbenchActivityPerson[]) => void}
}

installMotionDebug();
function PresenceFixture(){
  const [people,setPeople]=useState<WorkbenchActivityPerson[]>([]);
  const debounced=useDebouncedPresence(people);
  const first=debounced[0];
  const mode=first?.mode==='EDITING'?'editing':first?'viewing':undefined;
  const transition=usePresenceModeTransition(mode);
  window.setCard36cPeople=next=>flushSync(()=>setPeople(next));
  return <main style={{padding:'3rem',maxWidth:'28rem'}}>
    <TicketCard id="card36c-presence" data-presence={mode} data-presence-transition={transition}>
      <div className="card-open"><TicketCardBody number="IT-0036（合成）" title="PACS 调阅影像时加载缓慢（合成）"
        metadata="影像科 · 阅片室（合成）" tags={[]} owner={null} activity={null}/></div>
      <TicketPresence people={people} debounced={debounced} unclaimed={false}/>
    </TicketCard>
  </main>;
}

const root=document.getElementById('root');
if(!root)throw new Error('Missing presence fixture root');
createRoot(root).render(<PresenceFixture/>);
