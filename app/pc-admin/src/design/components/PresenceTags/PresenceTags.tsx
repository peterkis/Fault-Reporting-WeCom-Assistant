import {memo,useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {KeyboardEvent,RefObject} from 'react';
import {Pencil} from 'lucide-react';
import type {WorkbenchActivityField,WorkbenchActivityPerson} from '../../../../../../contracts/workbench_activity_contracts';
import {Avatar} from '../Avatar/Avatar';
import {withPresentationKeys} from '../../presentation-keys';
import {useExitPresence} from '../../motion/presence';
import {NumberRoll} from '../../motion/number-roll';
import {trackAnimation} from '../../motion/lifecycle';
import {motionToken,prefersReducedMotion} from '../../motion/tokens';
import {useDebouncedPresence} from './use-debounced-presence';
import './presence-tags.css';
import {PersonHoverTrigger} from '../HoverCard/HoverCard';
import {useTooltipTrigger} from '../Tooltip/Tooltip';

const EMPTY_PEOPLE:readonly WorkbenchActivityPerson[]=Object.freeze([]);
type PresenceState='entering'|'present'|'exiting';

function usePresenceLifecycle(ref:RefObject<HTMLElement|null>,active:boolean,onExited?:()=>void){
  const retained=useExitPresence(active,'--dur-fast');
  const [phase,setPhase]=useState<'init'|'entering'|'present'>(()=>typeof document!=='undefined'&&document.hidden?'present':'init');
  const exitedCallback=useRef(onExited);exitedCallback.current=onExited;
  const wasRetained=useRef(retained);
  useLayoutEffect(()=>{
    if(!retained){
      if(wasRetained.current){wasRetained.current=false;exitedCallback.current?.();}
      setPhase(typeof document!=='undefined'&&document.hidden?'present':'init');
      return;
    }
    wasRetained.current=true;
    if(!active)return;
    const el=ref.current;
    if(phase==='init'){
      if(el){void getComputedStyle(el).opacity;if('getAnimations' in el)void el.getAnimations();}
      setPhase('entering');
      return;
    }
    if(phase==='entering'){
      const animations=el&&'getAnimations' in el?el.getAnimations():[];
      if(!animations.length){setPhase('present');return;}
      let cancelled=false;
      void Promise.allSettled(animations.map(animation=>animation.finished)).then(()=>{if(!cancelled)setPhase('present');});
      return()=>{cancelled=true;};
    }
  },[ref,active,retained,phase]);
  const state:PresenceState=!active?'exiting':phase==='present'?'present':'entering';
  return {retained,state,entering:active&&phase==='init',exiting:!active};
}

export const presenceFieldLabels:Readonly<Record<WorkbenchActivityField,string>>={'internal-note':'内部备注','ticket-handling':'处理记录','ticket-completion':'完成记录','manual-review':'人工复核'};
/** 「周宁正在编辑内部备注」/「沈然正在查看」. */
export function presenceAction(person:WorkbenchActivityPerson){return person.mode==='EDITING'?'正在编辑'+(person.field?presenceFieldLabels[person.field]:''):'正在查看';}
export function presenceDescription(people:readonly WorkbenchActivityPerson[]){return people.map(person=>person.display_name+presenceAction(person)).join('、');}
/** Names longer than four characters show their first three and an ellipsis; the full name stays in the tooltip and label. */
export function shortPresenceName(name:string){const characters=Array.from(name);return characters.length>4?characters.slice(0,3).join('')+'…':name;}
/** Card 32 A5: 「周宁正在编辑内部备注」 or, with several editors of one field, 「周宁等 2 人正在编辑内部备注」. */
export function presenceFieldBannerText(editors:readonly WorkbenchActivityPerson[],field:WorkbenchActivityField){const first=editors[0];return first?first.display_name+(editors.length>1?'等 '+editors.length+' 人':'')+'正在编辑'+presenceFieldLabels[field]:'';}
/** Card 32 A5: banner attached to the top of an input area's frame, with the same lucide pencil as the name tags. */
export function PresenceFieldBanner({text,active=true,onExited}:{text:string;active?:boolean;onExited?:()=>void}){
  const ref=useRef<HTMLSpanElement|null>(null);
  const {retained,state,entering,exiting}=usePresenceLifecycle(ref,active,onExited);
  if(!retained)return null;
  return <span ref={ref} className="ds-presence-field-banner" data-presence-field-banner data-presence-state={state} data-entering={entering?'true':undefined} data-exiting={exiting?'true':undefined} role="status"><Pencil aria-hidden="true"/><span>{text}</span></span>;
}
/** Card 30B B4 / D4: drawer top-bar presence capsule with --dur-fast opacity enter/exit. */
export function PresenceCapsule({people,debounced,active,onExited}:{people:readonly WorkbenchActivityPerson[];debounced:readonly WorkbenchActivityPerson[];active:boolean;onExited?:()=>void}){
  const ref=useRef<HTMLSpanElement|null>(null);
  const {retained,state,entering,exiting}=usePresenceLifecycle(ref,active,onExited);
  if(!retained)return null;
  return <span ref={ref} className="ds-presence-capsule" data-workbench-activity data-presence-state={state} data-entering={entering?'true':undefined} data-exiting={exiting?'true':undefined} role="status"><PresenceTags people={people} debounced={debounced}/><span className="ds-presence-capsule-label" aria-hidden="true">在看</span><span className="sr-only">{presenceDescription(people)}</span></span>;
}
export const presenceTone=(people:readonly WorkbenchActivityPerson[])=>people[0]?.mode==='EDITING'?'editing':people.length?'viewing':undefined;

function isInsidePresenceNameTag(target:EventTarget|null):boolean{
  return target instanceof Element&&Boolean(target.closest('.ds-presence-tag:not([data-mode="more"])'));
}

function hasFocusedPresenceNameTag(container:Element):boolean{
  const active=typeof document!=='undefined'?document.activeElement:null;
  if(!active)return false;
  if(container.contains(active)&&isInsidePresenceNameTag(active))return true;
  for(const tag of container.querySelectorAll<HTMLElement>('.ds-presence-tag:not([data-mode="more"])[aria-controls]')){
    const cardId=tag.getAttribute('aria-controls');
    const card=cardId?document.getElementById(cardId):null;
    if(card?.contains(active))return true;
  }
  return false;
}

function hasActivePresenceHoverCard(container:Element):boolean{
  return Boolean(container.querySelector('.ds-presence-tag:not([data-mode="more"]):is([aria-expanded="true"],[data-hover-card-present="true"])'));
}

const PresencePersonTag=memo(function PresencePersonTag({personKey,person,active,onExited}:{personKey:string;person:WorkbenchActivityPerson;active:boolean;onExited:(key:string)=>void}){
  const ref=useRef<HTMLSpanElement|null>(null);
  const handleExited=useCallback(()=>onExited(personKey),[onExited,personKey]);
  const {retained,state,entering,exiting}=usePresenceLifecycle(ref,active,handleExited);
  const previousMode=useRef(person.mode);
  const [pencilEnter,setPencilEnter]=useState(false);
  useLayoutEffect(()=>{
    const before=previousMode.current;previousMode.current=person.mode;
    if(before==='VIEWING'&&person.mode==='EDITING'){
      setPencilEnter(true);
      if(document.hidden||prefersReducedMotion())return;
      const icon=ref.current?.querySelector<SVGSVGElement>('svg');
      if(!icon)return;
      const animation=trackAnimation(
        icon.animate([{opacity:0},{opacity:1}],{duration:motionToken('--dur-base'),easing:motionToken('--ease-standard')}),
      );
      return()=>{animation.cancel();};
    }
    if(person.mode!=='EDITING')setPencilEnter(false);
  },[person.mode]);
  if(!retained)return null;
  const fullName=person.display_name.trim()||shortPresenceName(person.display_name);
  const tag=<span ref={ref} className="ds-presence-tag" data-mode={person.mode==='EDITING'?'editing':'viewing'} data-presence-person={personKey} data-presence-state={state} data-entering={entering?'true':undefined} data-exiting={exiting?'true':undefined} aria-label={fullName}>{person.mode==='EDITING'?<Pencil aria-hidden="true" data-presence-pencil-enter={pencilEnter?'true':undefined}/>:null}{shortPresenceName(person.display_name)}</span>;
  return <PersonHoverTrigger name={person.display_name} disabled={exiting}>{tag}</PersonHoverTrigger>;
},(prev,next)=>
  prev.personKey===next.personKey
  &&prev.active===next.active
  &&prev.onExited===next.onExited
  &&prev.person.display_name===next.person.display_name
  &&prev.person.mode===next.person.mode
  &&prev.person.field===next.person.field
);

function PresenceMoreTag({count,active}:{count:number;active:boolean}){
  const ref=useRef<HTMLSpanElement|null>(null);
  const [shownCount,setShownCount]=useState(count);
  if(active&&count>0&&count!==shownCount)setShownCount(count);
  const {retained,state,entering,exiting}=usePresenceLifecycle(ref,active);
  if(!retained||shownCount<=0)return null;
  return <span ref={ref} className="ds-presence-tag" data-mode="more" data-presence-person="more" data-presence-more={shownCount} data-presence-state={state} data-entering={entering?'true':undefined} data-exiting={exiting?'true':undefined} aria-hidden="true"><span className="ds-presence-more-value">+<NumberRoll value={shownCount} animate={active}/></span></span>;
}

interface RenderedTag {key:string;person:WorkbenchActivityPerson;active:boolean}

/**
 * Card 30B B1 / D4 (corner name tags). People arrive editors first. One or two people show a tag each;
 * three or more show the first tag plus a dark 「+N」 (NumberRoll). Leaves debounce 300ms in the display layer,
 * then exit over --dur-fast via useExitPresence.
 */
export function PresenceTags({people,debounced,className=''}:{people:readonly WorkbenchActivityPerson[];debounced?:readonly WorkbenchActivityPerson[];className?:string}){
  const tooltip=useTooltipTrigger();
  const groupRef=useRef<HTMLSpanElement|null>(null);
  const pointerOnAggregateRef=useRef(false);
  const tooltipEnterRef=useRef(tooltip.onPointerEnter);
  tooltipEnterRef.current=tooltip.onPointerEnter;
  const internalDebounced=useDebouncedPresence(debounced?EMPTY_PEOPLE:people);
  const current=debounced??internalDebounced;
  const containerRetained=useExitPresence(current.length>0,'--dur-fast');
  useEffect(()=>{
    const container=groupRef.current;
    if(!containerRetained||!container||typeof MutationObserver!=='function')return;
    const observer=new MutationObserver(()=>{
      const live=groupRef.current;
      if(!live||!pointerOnAggregateRef.current)return;
      if(!hasFocusedPresenceNameTag(live)&&!hasActivePresenceHoverCard(live)){
        tooltipEnterRef.current();
      }
    });
    observer.observe(container,{subtree:true,attributes:true,attributeFilter:['aria-expanded','data-hover-card-present']});
    return()=>{observer.disconnect();};
  },[containerRetained]);
  const shown=current.length<=2?current:current.slice(0,1);
  const keyedShown=withPresentationKeys(shown);
  const rest=current.length-shown.length;
  const [rendered,setRendered]=useState<RenderedTag[]>(()=>keyedShown.map(({key,item})=>({key,person:item,active:true})));
  const shownSignature=keyedShown.map(({key,item})=>key+'\u0000'+item.mode+'\u0000'+(item.field??'')).join('\u0001');
  useLayoutEffect(()=>{
    setRendered(previous=>{
      const activeKeys=new Set(keyedShown.map(entry=>entry.key));
      const next:RenderedTag[]=keyedShown.map(({key,item})=>({key,person:item,active:true}));
      for(const entry of previous)if(!activeKeys.has(entry.key))next.push({...entry,active:false});
      return next;
    });
  },[shownSignature]);
  const removeTag=useCallback((key:string)=>{setRendered(previous=>previous.filter(entry=>entry.key!==key||entry.active));},[]);
  useLayoutEffect(()=>{if(!containerRetained&&current.length===0)setRendered([]);},[containerRetained,current.length]);
  if(!containerRetained)return null;
  const tooltipPeople=people.length?people:current;
  const description=presenceDescription(people),listed=tooltipPeople.slice(0,8);
  const closeTooltip=()=>{tooltip.onKeyDown({key:'Escape'} as KeyboardEvent<HTMLElement>);};
  const routePointer=(target:EventTarget|null,container:HTMLElement)=>{
    if(isInsidePresenceNameTag(target)){
      pointerOnAggregateRef.current=false;
      closeTooltip();
      return;
    }
    pointerOnAggregateRef.current=true;
    if(hasFocusedPresenceNameTag(container)||hasActivePresenceHoverCard(container)){
      closeTooltip();
      return;
    }
    tooltip.onPointerEnter();
  };
  return <span
    ref={groupRef}
    className={'ds-presence-tags '+className}
    role="group"
    aria-label={description}
    data-presence-count={people.length}
    data-tooltip-open={tooltip['data-tooltip-open']}
    onFocusCapture={event=>{if(isInsidePresenceNameTag(event.target))closeTooltip();}}
    onBlurCapture={()=>{
      queueMicrotask(()=>{
        if(pointerOnAggregateRef.current&&groupRef.current&&!hasFocusedPresenceNameTag(groupRef.current)&&!hasActivePresenceHoverCard(groupRef.current)){
          tooltip.onPointerEnter();
        }
      });
    }}
    onPointerEnter={event=>{routePointer(event.target,event.currentTarget);}}
    onPointerOver={event=>{routePointer(event.target,event.currentTarget);}}
    onPointerMove={event=>{routePointer(event.target,event.currentTarget);}}
    onPointerLeave={()=>{pointerOnAggregateRef.current=false;closeTooltip();}}
    onKeyDown={tooltip.onKeyDown}
  >
    {rendered.map(entry=><PresencePersonTag key={entry.key} personKey={entry.key} person={entry.person} active={entry.active} onExited={removeTag}/>)}
    <PresenceMoreTag count={rest} active={rest>0}/>
    <span className="ds-presence-tooltip" aria-hidden="true">{withPresentationKeys(listed).map(({key,item:person})=><span key={key} className="ds-presence-tooltip-row"><Avatar name={person.display_name} size={20} className="ds-presence-tooltip-avatar" aria-hidden="true"/><strong>{person.display_name}</strong><span>{presenceAction(person)}</span></span>)}{tooltipPeople.length>listed.length?<span className="ds-presence-tooltip-more">另有 {tooltipPeople.length-listed.length} 人</span>:null}</span>
  </span>;
}
