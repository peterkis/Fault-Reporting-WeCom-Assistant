import {useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {PresenceTags,presenceDescription,presenceFieldLabels} from '../../design/components/PresenceTags/PresenceTags';
import type {RefObject} from 'react';
import type {Principal} from '../../api/client';
import type {WorkbenchActivityField,WorkbenchActivityPerson,WorkbenchActivityTarget} from '../../../../../contracts/workbench_activity_contracts';
import {registerActivity} from './client';
import {isWorkbenchVisible} from '../../desktop/host';
export function ActivityPeople({principal,target,root,readReady,capsuleTarget=null}:{principal:Principal;target:WorkbenchActivityTarget;root:RefObject<HTMLDivElement|null>;readReady:boolean;capsuleTarget?:HTMLElement|null}){
  const [people,setPeople]=useState<WorkbenchActivityPerson[]>([]);
  useEffect(()=>{
    const element=root.current;
    if(!principal.activity_enabled||!readReady||!element||typeof IntersectionObserver==='undefined')return;
    let intersecting=false;
    const own=registerActivity({principal,target,visible:false,people:setPeople});
    const visibility=()=>own.visible(intersecting&&isWorkbenchVisible()&&navigator.onLine);
    const observer=new IntersectionObserver(entries=>{intersecting=entries.some(entry=>entry.isIntersecting);visibility();});observer.observe(element);
    const touch=(event:Event)=>{
      if(!event.isTrusted)return;
      let field:WorkbenchActivityField|null=null;
      if((event.type==='input'||event.type==='change')&&event.target instanceof HTMLElement){
        const input=event.target;if(!(input instanceof HTMLInputElement||input instanceof HTMLTextAreaElement||input instanceof HTMLSelectElement)||input.disabled||input.matches(':disabled')||('readOnly' in input&&input.readOnly)||input.getClientRects().length===0)return;
        const bounds=input.getBoundingClientRect();if(bounds.bottom<=0||bounds.right<=0||bounds.top>=window.innerHeight||bounds.left>=window.innerWidth)return;
        const value=input.closest('[data-activity-field]')?.getAttribute('data-activity-field');
        if(value==='internal-note'||value==='ticket-handling'||value==='ticket-completion'||value==='manual-review')field=value;
      }
      own.touch(field);
    };
    const events=['pointerdown','keydown','scroll','input','change'] as const;
    for(const event of events)element.addEventListener(event,touch,{passive:true});
    document.addEventListener('visibilitychange',visibility);window.addEventListener('offline',visibility);window.addEventListener('online',visibility);
    return()=>{observer.disconnect();own.dispose();for(const event of events)element.removeEventListener(event,touch);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('offline',visibility);window.removeEventListener('online',visibility);};
  },[principal.principal_id,principal.csrf_token,principal.authorization_revision,principal.activity_enabled,target.kind,target.id,readReady,root]);
  // Card 30B B4: a colleague editing a field that is visible here marks that input area; input is never locked.
  const editing=principal.activity_enabled&&readReady?people.filter(person=>person.mode==='EDITING'&&person.field):[];
  const editingKey=editing.map(person=>person.display_name+'\u0000'+person.field).join('\u0001');
  useEffect(()=>{
    const element=root.current;if(!element)return;
    const marked:HTMLElement[]=[];
    for(const person of editing){const field=person.field;if(!field)continue;const area=element.querySelector<HTMLElement>('[data-activity-field="'+field+'"]');if(!area||area.hasAttribute('data-presence-editing'))continue;
      area.setAttribute('data-presence-editing',person.display_name+'正在编辑'+presenceFieldLabels[field]+'，同时编辑可能互相覆盖');marked.push(area);}
    return()=>{for(const area of marked)area.removeAttribute('data-presence-editing');};
  },[editingKey,root]);
  if(!principal.activity_enabled||!readReady||!people.length)return null;
  const capsule=<span className="ds-presence-capsule" data-workbench-activity role="status"><PresenceTags people={people}/><span className="ds-presence-capsule-label" aria-hidden="true">在看</span><span className="sr-only">{presenceDescription(people)}</span></span>;
  return capsuleTarget?createPortal(capsule,capsuleTarget):capsule;
}
