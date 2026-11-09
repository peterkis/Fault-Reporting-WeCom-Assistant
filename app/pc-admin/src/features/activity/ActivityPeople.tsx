import {useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {PresenceFieldBanner,PresenceTags,presenceDescription,presenceFieldBannerText} from '../../design/components/PresenceTags/PresenceTags';
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
  // Card 30B B4 / Card 32 A5: a colleague editing a field that is visible here marks that input area with a banner; input is never locked.
  const editing=principal.activity_enabled&&readReady?people.filter(person=>person.mode==='EDITING'&&person.field):[];
  const editingKey=editing.map(person=>person.display_name+'\u0000'+person.field).join('\u0001');
  const [banners,setBanners]=useState<readonly {anchor:HTMLElement;text:string}[]>([]);
  useEffect(()=>{
    if(!editing.length||!root.current)return;
    const fields=new Map<WorkbenchActivityField,WorkbenchActivityPerson[]>();
    for(const person of editing)if(person.field)fields.set(person.field,[...(fields.get(person.field)??[]),person]);
    const marked=new Set<HTMLElement>();
    // Areas can mount later (an inline form or dialog opened after the colleague began editing), so re-apply on DOM changes while someone edits.
    const apply=()=>{
      const next:{anchor:HTMLElement;text:string}[]=[];
      for(const [field,editors] of fields){const text=presenceFieldBannerText(editors,field);for(const area of document.querySelectorAll<HTMLElement>('[data-activity-field="'+field+'"]')){
        if(area.getAttribute('data-presence-editing')!==text)area.setAttribute('data-presence-editing',text);
        // Anchor contract (Card 32C-T): the banner is portalled into the element marked `data-presence-banner-anchor`. TicketNotes renders that
        // marker on its bordered input frame (`.ds-note-input`); any restructuring of TicketNotes must keep the marker on the frame, or the
        // banner falls back to the area itself. When an anchor unmounts, the MutationObserver below re-runs `apply`, which drops it from
        // `banners` (React then removes the portal) and from `marked`; the effect cleanup clears the remaining attributes.
        // The composer marks its bordered input frame; other areas carry the banner on themselves.
        const frame=area.querySelector<HTMLElement>('[data-presence-banner-anchor]'),anchor=frame??area,host=frame?'frame':'area';
        if(anchor.getAttribute('data-presence-banner-host')!==host)anchor.setAttribute('data-presence-banner-host',host);
        marked.add(area);marked.add(anchor);next.push({anchor,text});}}
      for(const node of marked)if(!node.isConnected)marked.delete(node);
      setBanners(current=>current.length===next.length&&current.every((banner,index)=>banner.anchor===next[index]?.anchor&&banner.text===next[index]?.text)?current:next);
    };
    let frame=0;const observer=new MutationObserver(()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;apply();});});
    apply();observer.observe(document.body,{childList:true,subtree:true});
    return()=>{observer.disconnect();if(frame)cancelAnimationFrame(frame);for(const node of marked){node.removeAttribute('data-presence-editing');node.removeAttribute('data-presence-banner-host');}setBanners([]);};
  },[editingKey,root]);
  const fieldBanners=banners.map((banner,index)=>createPortal(<PresenceFieldBanner text={banner.text}/>,banner.anchor,'field-banner-'+index));
  if(!principal.activity_enabled||!readReady||!people.length)return null;
  const capsule=<span className="ds-presence-capsule" data-workbench-activity role="status"><PresenceTags people={people}/><span className="ds-presence-capsule-label" aria-hidden="true">在看</span><span className="sr-only">{presenceDescription(people)}</span></span>;
  return <>{capsuleTarget?createPortal(capsule,capsuleTarget):capsule}{fieldBanners}</>;
}
