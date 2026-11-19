import {useCallback,useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {PresenceCapsule,PresenceFieldBanner,presenceFieldBannerText} from '../../design/components/PresenceTags/PresenceTags';
import {useDebouncedPresence} from '../../design/components/PresenceTags/use-debounced-presence';
import type {RefObject} from 'react';
import type {Principal} from '../../api/client';
import type {WorkbenchActivityField,WorkbenchActivityPerson,WorkbenchActivityTarget} from '../../../../../contracts/workbench_activity_contracts';
import {registerActivity} from './client';
import {isWorkbenchVisible} from '../../desktop/host';

const EMPTY_PEOPLE:readonly WorkbenchActivityPerson[]=Object.freeze([]);
interface BannerEntry {id:number;anchor:HTMLElement;area:HTMLElement;text:string;active:boolean}

export function ActivityPeople({principal,target,root,readReady,capsuleTarget=null}:{principal:Principal;target:WorkbenchActivityTarget;root:RefObject<HTMLDivElement|null>;readReady:boolean;capsuleTarget?:HTMLElement|null}){
  const [people,setPeople]=useState<WorkbenchActivityPerson[]>([]);
  const enabled=Boolean(principal.activity_enabled&&readReady);
  useEffect(()=>{
    const element=root.current;
    if(!enabled||!element||typeof IntersectionObserver==='undefined')return;
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
  },[principal.principal_id,principal.csrf_token,principal.authorization_revision,enabled,target.kind,target.id,root]);
  const activePeople=enabled?people:EMPTY_PEOPLE;
  const debouncedPeople=useDebouncedPresence(activePeople);
  // Card 30B B4 / Card 32 A5 / D4: a colleague editing a field marks that input area with an opacity-fading banner; input is never locked.
  const editing=enabled?debouncedPeople.filter(person=>person.mode==='EDITING'&&person.field):EMPTY_PEOPLE;
  const editingKey=editing.map(person=>person.display_name+'\u0000'+person.field).join('\u0001');
  const [banners,setBanners]=useState<readonly BannerEntry[]>([]);
  const anchorIds=useRef(new WeakMap<HTMLElement,number>()),nextAnchorId=useRef(1);
  const markedRef=useRef(new Set<HTMLElement>());
  const idForAnchor=(anchor:HTMLElement)=>{let id=anchorIds.current.get(anchor);if(id===undefined){id=nextAnchorId.current++;anchorIds.current.set(anchor,id);}return id;};
  useEffect(()=>{
    if(!enabled){
      for(const node of markedRef.current){node.removeAttribute('data-presence-editing');node.removeAttribute('data-presence-banner-host');}
      markedRef.current.clear();
      setBanners([]);
      return;
    }
    if(!editing.length||!root.current){
      for(const node of markedRef.current)node.removeAttribute('data-presence-editing');
      setBanners(current=>current.filter(entry=>entry.anchor.isConnected).map(entry=>entry.active?{...entry,active:false}:entry));
      return;
    }
    const fields=new Map<WorkbenchActivityField,WorkbenchActivityPerson[]>();
    for(const person of editing)if(person.field)fields.set(person.field,[...(fields.get(person.field)??[]),person]);
    // Areas can mount later (an inline form or dialog opened after the colleague began editing), so re-apply on DOM changes while someone edits.
    const apply=()=>{
      const nextActive=new Map<HTMLElement,{area:HTMLElement;text:string}>(),activeAreas=new Set<HTMLElement>();
      for(const [field,editors] of fields){const text=presenceFieldBannerText(editors,field);for(const area of document.querySelectorAll<HTMLElement>('[data-activity-field="'+field+'"]')){
        if(area.getAttribute('data-presence-editing')!==text)area.setAttribute('data-presence-editing',text);
        // Anchor contract (Card 32C-T): the banner is portalled into the element marked `data-presence-banner-anchor`. TicketNotes renders that
        // marker on its bordered input frame (`.ds-note-input`); any restructuring of TicketNotes must keep the marker on the frame, or the
        // banner falls back to the area itself.
        const frame=area.querySelector<HTMLElement>('[data-presence-banner-anchor]'),anchor=frame??area,host=frame?'frame':'area';
        if(anchor.getAttribute('data-presence-banner-host')!==host)anchor.setAttribute('data-presence-banner-host',host);
        markedRef.current.add(area);markedRef.current.add(anchor);activeAreas.add(area);nextActive.set(anchor,{area,text});}}
      for(const node of [...markedRef.current]){
        if(!node.isConnected){markedRef.current.delete(node);continue;}
        if(!activeAreas.has(node)&&node.hasAttribute('data-presence-editing'))node.removeAttribute('data-presence-editing');
      }
      setBanners(current=>{
        const next:BannerEntry[]=[];
        const seen=new Set<HTMLElement>();
        for(const [anchor,{area,text}] of nextActive){seen.add(anchor);next.push({id:idForAnchor(anchor),anchor,area,text,active:true});}
        for(const entry of current){if(!seen.has(entry.anchor)&&entry.anchor.isConnected)next.push(entry.active?{...entry,active:false}:entry);}
        return current.length===next.length&&current.every((banner,index)=>{const other=next[index];return other!==undefined&&banner.anchor===other.anchor&&banner.text===other.text&&banner.active===other.active;})?current:next;
      });
    };
    let frame=0;const observer=new MutationObserver(()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;apply();});});
    apply();observer.observe(document.body,{childList:true,subtree:true});
    return()=>{observer.disconnect();if(frame)cancelAnimationFrame(frame);};
  },[enabled,editingKey,root]);
  useEffect(()=>()=>{
    for(const node of markedRef.current){node.removeAttribute('data-presence-editing');node.removeAttribute('data-presence-banner-host');}
    markedRef.current.clear();
  },[]);
  const finishBannerExit=useCallback((anchor:HTMLElement)=>{
    setBanners(current=>{
      const stillActive=current.some(entry=>entry.anchor===anchor&&entry.active);
      if(!stillActive){anchor.removeAttribute('data-presence-banner-host');markedRef.current.delete(anchor);}
      return current.filter(entry=>entry.anchor!==anchor||entry.active);
    });
  },[]);
  if(!enabled)return null;
  const fieldBanners=banners.filter(banner=>banner.anchor.isConnected).map(banner=>createPortal(<PresenceFieldBanner text={banner.text} active={banner.active} onExited={()=>finishBannerExit(banner.anchor)}/>,banner.anchor,'field-banner-'+banner.id));
  const capsule=<PresenceCapsule people={activePeople} debounced={debouncedPeople} active={debouncedPeople.length>0}/>;
  return <>{capsuleTarget?createPortal(capsule,capsuleTarget):capsule}{fieldBanners}</>;
}
