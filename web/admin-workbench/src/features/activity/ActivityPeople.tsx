import {useEffect,useState} from 'react';
import type {RefObject} from 'react';
import type {Principal} from '../../api/client';
import type {WorkbenchActivityField,WorkbenchActivityPerson,WorkbenchActivityTarget} from '../../../../../contracts/workbench_activity_contracts';
import {registerActivity} from './client';
export function ActivityPeople({principal,target,root,readReady}:{principal:Principal;target:WorkbenchActivityTarget;root:RefObject<HTMLDivElement|null>;readReady:boolean}){
  const [people,setPeople]=useState<WorkbenchActivityPerson[]>([]);
  useEffect(()=>{
    const element=root.current;
    if(!principal.activity_enabled||!readReady||!element||typeof IntersectionObserver==='undefined')return;
    let intersecting=false;
    const own=registerActivity({principal,target,visible:false,people:setPeople});
    const visibility=()=>own.visible(intersecting&&document.visibilityState!=='hidden'&&navigator.onLine);
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
  if(!principal.activity_enabled||!readReady||!people.length)return null;
  return <p data-workbench-activity role="status">{people.map(person=>person.display_name+'正在'+(person.mode==='EDITING'?'编辑':'查看')).join('、')}</p>;
}
