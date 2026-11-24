import {
  cloneElement,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  type RefAttributes,
} from 'react';
import {createPortal} from 'react-dom';
import {usePopoverPresence} from '../Popover/usePopoverPresence';
import {motionToken} from '../../motion/tokens';
import './hover-card.css';

export type HoverCardKind='person'|'ticket';
export type HoverCardState='loading'|'ready'|'denied'|'missing';

export interface HoverCardRenderContext {
  titleId:string;
  close:()=>void;
}

export interface HoverCardProps {
  kind:HoverCardKind;
  width?:number;
  state?:HoverCardState;
  disabled?:boolean;
  children:ReactElement<Record<string,unknown>&RefAttributes<HTMLElement>>;
  renderContent:(context:HoverCardRenderContext)=>ReactNode;
}

export interface PersonHoverTriggerProps {
  name:string;
  personId?:string|null;
  isSelf?:boolean;
  disabled?:boolean;
  children:ReactElement<Record<string,unknown>&RefAttributes<HTMLElement>>;
}

export type PersonHoverRenderer=(props:PersonHoverTriggerProps)=>ReactElement;

export const PersonHoverRendererContext=createContext<PersonHoverRenderer|null>(null);

const HoverCardLevelContext=createContext<number>(0);

const DISABLE_MEDIA_QUERY='(pointer: coarse), (max-width: 640px)';
const VIEWPORT_MARGIN=8;
const PLACEMENT_GAP=6;

interface CoordinatorEntry {
  level:number;
  triggerEl:HTMLElement|null;
  closeNow:(restoreFocus:boolean)=>void;
  containsNode:(node:Node)=>boolean;
  setPointerChildInside:(inside:boolean)=>void;
}

const activeByLevel=new Map<number,CoordinatorEntry>();
const lastClosedAtByLevel=new Map<number,number>();

let globalInputWired=false;
let lastInteractionKeyboard=false;

function ensureGlobalInputTracker(){
  if(globalInputWired||typeof document==='undefined')return;
  globalInputWired=true;
  document.addEventListener('keydown',event=>{
    if(event.key==='Tab'||event.key==='Escape'||event.key==='Enter'||event.key===' '||event.key.startsWith('Arrow')){
      lastInteractionKeyboard=true;
    }
  },true);
  document.addEventListener('pointerdown',()=>{
    lastInteractionKeyboard=false;
  },true);
}

let sharedMediaQuery:MediaQueryList|null=null;
let sharedMediaDisabled=false;
const mediaListeners=new Set<()=>void>();

function getSharedMediaDisabled():boolean{
  if(typeof window==='undefined'||typeof window.matchMedia!=='function')return false;
  if(!sharedMediaQuery){
    sharedMediaQuery=window.matchMedia(DISABLE_MEDIA_QUERY);
    sharedMediaDisabled=sharedMediaQuery.matches;
    const onChange=()=>{
      const next=sharedMediaQuery?.matches??false;
      if(next===sharedMediaDisabled)return;
      sharedMediaDisabled=next;
      for(const listener of mediaListeners)listener();
    };
    if(typeof sharedMediaQuery.addEventListener==='function'){
      sharedMediaQuery.addEventListener('change',onChange);
    }else{
      const legacy=sharedMediaQuery as MediaQueryList&{addListener?:(fn:()=>void)=>void};
      legacy.addListener?.(onChange);
    }
  }
  return sharedMediaDisabled;
}

function subscribeMediaDisabled(listener:()=>void){
  getSharedMediaDisabled();
  mediaListeners.add(listener);
  return ()=>{mediaListeners.delete(listener);};
}

function getServerMediaDisabled():boolean{
  return false;
}

function useHoverCardDisabled():boolean{
  return useSyncExternalStore(subscribeMediaDisabled,getSharedMediaDisabled,getServerMediaDisabled);
}

function isNativelyInteractiveChild(
  children:ReactElement<Record<string,unknown>>,
):boolean{
  if(typeof children.type==='string'){
    return /^(button|a|input|select|textarea|summary)$/iu.test(children.type);
  }
  const props=children.props;
  if(
    props.role==='button'
    ||props.role==='link'
    ||typeof props.to==='string'
    ||typeof props.href==='string'
    ||typeof props.onPress==='function'
    ||typeof props.tone==='string'
  ){
    return true;
  }
  return !('name' in props)&&!('systemIcon' in props);
}

function focusableElements(container:HTMLElement):HTMLElement[]{
  const selector='button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return [...container.querySelectorAll<HTMLElement>(selector)].filter(node=>{
    if(node.hasAttribute('disabled')||node.getAttribute('aria-hidden')==='true'||node.hasAttribute('inert'))return false;
    return Boolean(node.offsetParent||node.getClientRects().length);
  });
}

function isElementFocusVisible(node:HTMLElement):boolean{
  try{
    if(node.matches(':focus-visible'))return true;
  }catch{
    // JSDOM / older engines may throw on :focus-visible; fall back to recent keyboard input.
  }
  return lastInteractionKeyboard;
}

function resolvePortalContainer(triggerEl:HTMLElement|null):{container:HTMLElement;overlay:boolean}|null{
  if(typeof document==='undefined')return null;
  if(!triggerEl)return {container:document.body,overlay:false};
  const portalAncestor=triggerEl.closest<HTMLElement>('.ds-modal-container, .ds-drawer-content');
  const inOverlay=Boolean(portalAncestor||triggerEl.closest('[data-workbench-modal], [data-workbench-overlay], [role="dialog"]'));
  return {container:portalAncestor??document.body,overlay:inOverlay};
}

function containingBlockOffset(cardEl:HTMLElement):{x:number;y:number}{
  let parent=cardEl.parentElement;
  while(parent&&parent!==document.body&&parent!==document.documentElement){
    const style=window.getComputedStyle(parent);
    if(
      style.transform!=='none'
      ||style.filter!=='none'
      ||style.perspective!=='none'
      ||style.contain==='paint'
      ||style.contain==='layout'
      ||style.contain==='strict'
      ||style.contain==='content'
    ){
      const rect=parent.getBoundingClientRect();
      return {x:rect.left+parent.clientLeft,y:rect.top+parent.clientTop};
    }
    parent=parent.parentElement;
  }
  return {x:0,y:0};
}

function isInsideNestedCard(level:number,node:Node|null):boolean{
  if(!node)return false;
  for(const [entryLevel,entry] of activeByLevel){
    if(entryLevel>level&&entry.containsNode(node))return true;
  }
  return false;
}

function topmostActiveLevel():number{
  let max=-1;
  for(const level of activeByLevel.keys()){
    if(level>max)max=level;
  }
  return max;
}

interface HoverTriggerProxy {
  enter:(pointerType:string)=>void;
  leave:()=>void;
  down:()=>void;
}

const triggerProxies=new WeakMap<HTMLElement,HoverTriggerProxy>();

/** Forwards pointer hover/press from a non-interactive companion label to an anchored hover-card trigger. */
export function forwardHoverTriggerPointer(
  triggerEl:HTMLElement|null|undefined,
  action:'enter'|'leave'|'down',
  pointerType='mouse',
):void{
  if(!triggerEl)return;
  const proxy=triggerProxies.get(triggerEl);
  if(!proxy)return;
  if(action==='enter')proxy.enter(pointerType);
  else if(action==='leave')proxy.leave();
  else proxy.down();
}

export function HoverCard({kind,width,state,disabled:propDisabled=false,children,renderContent}:HoverCardProps){
  const mediaDisabled=useHoverCardDisabled();
  const disabled=mediaDisabled||propDisabled;
  const level=useContext(HoverCardLevelContext);
  const titleId=useId();
  const cardId=useId();

  const triggerRef=useRef<HTMLElement|null>(null);
  const origRefRef=useRef<Ref<HTMLElement>|undefined>(undefined);
  const cardRef=useRef<HTMLDivElement|null>(null);
  const openTimerRef=useRef<number|null>(null);
  const closeTimerRef=useRef<number|null>(null);
  const pointerOnTriggerRef=useRef(false);
  const pointerOnCardRef=useRef(false);
  const pointerOnChildRef=useRef(false);
  const suppressFocusOpenRef=useRef(false);
  const focusOpenedRef=useRef(false);
  const proxyRef=useRef<HoverTriggerProxy>({
    enter:()=>{},
    leave:()=>{},
    down:()=>{},
  });

  const [open,setOpen]=useState(false);
  const [placement,setPlacement]=useState<'bottom'|'top'>('bottom');
  const nativelyInteractive=isNativelyInteractiveChild(children);
  const {present,attributes}=usePopoverPresence(open&&!disabled,{immediateEnter:true});

  const mergedTriggerRef=useCallback((value:HTMLElement|null)=>{
    if(triggerRef.current&&triggerRef.current!==value){
      triggerProxies.delete(triggerRef.current);
    }
    triggerRef.current=value;
    if(value){
      triggerProxies.set(value,{
        enter:pointerType=>proxyRef.current.enter(pointerType),
        leave:()=>proxyRef.current.leave(),
        down:()=>proxyRef.current.down(),
      });
    }
    const external=origRefRef.current;
    if(!external)return;
    if(typeof external==='function')external(value);
    else (external as {current:HTMLElement|null}).current=value;
  },[]);

  const clearOpenTimer=useCallback(()=>{
    if(openTimerRef.current!==null){
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current=null;
    }
  },[]);

  const clearCloseTimer=useCallback(()=>{
    if(closeTimerRef.current!==null){
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current=null;
    }
  },[]);

  const closeDeeperCards=useCallback(()=>{
    for(const [entryLevel,entry] of [...activeByLevel]){
      if(entryLevel>level)entry.closeNow(false);
    }
  },[level]);

  const closeImmediately=useCallback((restoreFocus=false)=>{
    clearOpenTimer();
    clearCloseTimer();
    closeDeeperCards();
    pointerOnChildRef.current=false;
    focusOpenedRef.current=false;
    if(open){
      lastClosedAtByLevel.set(level,Date.now());
    }
    setOpen(false);
    if(restoreFocus&&triggerRef.current){
      if(document.activeElement!==triggerRef.current)suppressFocusOpenRef.current=true;
      triggerRef.current.focus();
    }
  },[clearCloseTimer,clearOpenTimer,closeDeeperCards,level,open]);

  const performOpen=useCallback(()=>{
    clearOpenTimer();
    clearCloseTimer();
    // Close any sibling card at the same level or deeper levels so only one card is open per level.
    for(const [entryLevel,entry] of [...activeByLevel]){
      if(entryLevel>=level&&entry.closeNow!==closeImmediately){
        entry.closeNow(false);
      }
    }
    setOpen(true);
  },[clearCloseTimer,clearOpenTimer,closeImmediately,level]);

  const scheduleOpen=useCallback((delayMs:number)=>{
    clearCloseTimer();
    if(open)return;
    clearOpenTimer();
    if(delayMs===0){
      performOpen();
      return;
    }
    openTimerRef.current=window.setTimeout(()=>{
      openTimerRef.current=null;
      performOpen();
    },delayMs);
  },[clearCloseTimer,clearOpenTimer,open,performOpen]);

  const scheduleClose=useCallback(()=>{
    clearOpenTimer();
    if(!open)return;
    clearCloseTimer();
    closeTimerRef.current=window.setTimeout(()=>{
      closeTimerRef.current=null;
      if(pointerOnTriggerRef.current||pointerOnCardRef.current||pointerOnChildRef.current)return;
      const active=document.activeElement;
      if(cardRef.current&&active&&cardRef.current.contains(active))return;
      if(focusOpenedRef.current&&triggerRef.current&&active===triggerRef.current)return;
      closeImmediately(false);
    },motionToken('--delay-hover-card-close'));
  },[clearCloseTimer,clearOpenTimer,closeImmediately,open]);

  const openDelayForHover=useCallback(():number=>{
    const hasSiblingOpen=[...activeByLevel.entries()].some(([entryLevel,entry])=>entryLevel===level&&entry.closeNow!==closeImmediately);
    if(hasSiblingOpen)return 0;
    const lastClosed=lastClosedAtByLevel.get(level);
    if(lastClosed!==undefined&&Date.now()-lastClosed<motionToken('--delay-hover-card-warm'))return 0;
    return motionToken('--delay-tooltip');
  },[closeImmediately,level]);

  proxyRef.current={
    enter:(pointerType:string)=>{
      if(propDisabled||pointerType==='touch')return;
      ensureGlobalInputTracker();
      pointerOnTriggerRef.current=true;
      scheduleOpen(openDelayForHover());
    },
    leave:()=>{
      pointerOnTriggerRef.current=false;
      if(open)scheduleClose();
      else clearOpenTimer();
    },
    down:()=>{
      ensureGlobalInputTracker();
      suppressFocusOpenRef.current=true;
    },
  };

  useEffect(()=>{
    if(!disabled)return;
    clearOpenTimer();
    clearCloseTimer();
    if(open){
      closeDeeperCards();
      setOpen(false);
    }
  },[clearCloseTimer,clearOpenTimer,closeDeeperCards,disabled,open]);

  useEffect(()=>{
    if(!open||disabled)return;
    const entry:CoordinatorEntry={
      level,
      triggerEl:triggerRef.current,
      closeNow:closeImmediately,
      containsNode:node=>Boolean((cardRef.current&&cardRef.current.contains(node))||(triggerRef.current&&triggerRef.current.contains(node))),
      setPointerChildInside:inside=>{
        pointerOnChildRef.current=inside;
        if(inside)clearCloseTimer();
      },
    };
    activeByLevel.set(level,entry);
    if(level>0){
      activeByLevel.get(level-1)?.setPointerChildInside(true);
    }
    return ()=>{
      if(activeByLevel.get(level)===entry)activeByLevel.delete(level);
      if(level>0)activeByLevel.get(level-1)?.setPointerChildInside(false);
    };
  },[clearCloseTimer,closeImmediately,disabled,level,open]);

  useEffect(()=>()=>{
    clearOpenTimer();
    clearCloseTimer();
  },[clearCloseTimer,clearOpenTimer]);

  useEffect(()=>{
    if(!present||!open)return;
    const onScroll=(event:Event)=>{
      const target=event.target;
      if(target instanceof Node){
        if(cardRef.current?.contains(target))return;
        if(isInsideNestedCard(level,target))return;
      }
      closeImmediately(false);
    };
    const onPointerDown=(event:Event)=>{
      const target=event.target;
      if(target instanceof Node){
        if(triggerRef.current?.contains(target)||cardRef.current?.contains(target))return;
        if(isInsideNestedCard(level,target))return;
      }
      closeImmediately(false);
    };
    const onKeyDown=(event:globalThis.KeyboardEvent)=>{
      if(event.key==='Escape'&&topmostActiveLevel()===level){
        const rootEntry=activeByLevel.get(0);
        const rootTrigger=rootEntry?.triggerEl??triggerRef.current;
        const onlineRoot=document.querySelector<HTMLElement>('[data-online-colleagues]:has(.ds-online-panel:not([data-exiting]))');
        const active=document.activeElement;
        const hoverOwnsFocus=Boolean(
          active&&(
            [...activeByLevel.values()].some(entry=>entry.containsNode(active))
            ||(cardRef.current&&cardRef.current.contains(active))
            ||(triggerRef.current&&triggerRef.current.contains(active))
            ||(rootTrigger&&rootTrigger.contains(active))
          ),
        );
        if(onlineRoot&&(!rootTrigger||!onlineRoot.contains(rootTrigger))&&!hoverOwnsFocus){
          if(rootEntry)rootEntry.closeNow(false);
          else closeImmediately(false);
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        closeImmediately(true);
      }
    };
    window.addEventListener('scroll',onScroll,true);
    document.addEventListener('pointerdown',onPointerDown,true);
    document.addEventListener('keydown',onKeyDown,true);
    return ()=>{
      window.removeEventListener('scroll',onScroll,true);
      document.removeEventListener('pointerdown',onPointerDown,true);
      document.removeEventListener('keydown',onKeyDown,true);
    };
  },[closeImmediately,level,open,present]);

  const updatePosition=useCallback(()=>{
    const triggerEl=triggerRef.current;
    const cardEl=cardRef.current;
    if(!triggerEl||!cardEl)return;

    if(typeof width==='number'){
      cardEl.style.width=`${width}px`;
    }else{
      cardEl.style.removeProperty('width');
    }

    const triggerRect=triggerEl.getBoundingClientRect();
    const cardWidth=cardEl.offsetWidth||cardEl.getBoundingClientRect().width;
    const cardHeight=Math.max(cardEl.offsetHeight||cardEl.getBoundingClientRect().height,cardEl.scrollHeight);
    const vw=document.documentElement.clientWidth||window.innerWidth;
    const vh=document.documentElement.clientHeight||window.innerHeight;

    const spaceBelow=vh-triggerRect.bottom-VIEWPORT_MARGIN;
    const spaceAbove=triggerRect.top-VIEWPORT_MARGIN;
    let nextPlacement:'bottom'|'top'='bottom';
    if(spaceBelow<cardHeight+PLACEMENT_GAP&&(spaceAbove>=cardHeight+PLACEMENT_GAP||spaceAbove>spaceBelow)){
      nextPlacement='top';
    }

    const availableSpace=Math.max(0,(nextPlacement==='bottom'?spaceBelow:spaceAbove)-PLACEMENT_GAP);
    if(cardHeight>availableSpace){
      const cappedMaxHeight=`${availableSpace}px`;
      if(cardEl.style.maxHeight!==cappedMaxHeight)cardEl.style.maxHeight=cappedMaxHeight;
    }else if(cardEl.style.maxHeight!==''){
      cardEl.style.removeProperty('max-height');
    }

    const renderedHeight=cardHeight>availableSpace?(cardEl.offsetHeight||Math.min(cardHeight,availableSpace)):cardHeight;
    const vpTop=nextPlacement==='bottom'?triggerRect.bottom+PLACEMENT_GAP:triggerRect.top-PLACEMENT_GAP-renderedHeight;
    const maxLeft=Math.max(VIEWPORT_MARGIN,vw-cardWidth-VIEWPORT_MARGIN);
    const vpLeft=Math.min(Math.max(VIEWPORT_MARGIN,triggerRect.left),maxLeft);

    const offset=containingBlockOffset(cardEl);
    cardEl.style.left=`${vpLeft-offset.x}px`;
    cardEl.style.top=`${vpTop-offset.y}px`;
    setPlacement(current=>current===nextPlacement?current:nextPlacement);
  },[width]);

  useLayoutEffect(()=>{
    if(!present)return;
    updatePosition();
    const cardEl=cardRef.current;
    const triggerEl=triggerRef.current;
    const observer=typeof ResizeObserver==='function'?new ResizeObserver(()=>updatePosition()):null;
    if(observer){
      if(cardEl)observer.observe(cardEl);
      if(triggerEl)observer.observe(triggerEl);
    }
    const onResize=()=>updatePosition();
    window.addEventListener('resize',onResize);
    return ()=>{
      observer?.disconnect();
      window.removeEventListener('resize',onResize);
    };
  },[present,state,updatePosition,width]);

  if(mediaDisabled){
    return <>{children}{null}</>;
  }

  const childProps=children.props;
  origRefRef.current=childProps.ref as Ref<HTMLElement>|undefined;
  const origPointerEnter=childProps.onPointerEnter as ((event:ReactPointerEvent<HTMLElement>)=>void)|undefined;
  const origPointerLeave=childProps.onPointerLeave as ((event:ReactPointerEvent<HTMLElement>)=>void)|undefined;
  const origPointerDown=childProps.onPointerDown as ((event:ReactPointerEvent<HTMLElement>)=>void)|undefined;
  const origFocus=childProps.onFocus as ((event:FocusEvent<HTMLElement>)=>void)|undefined;
  const origBlur=childProps.onBlur as ((event:FocusEvent<HTMLElement>)=>void)|undefined;
  const origKeyDown=childProps.onKeyDown as ((event:KeyboardEvent<HTMLElement>)=>void)|undefined;

  const portalTarget=present?resolvePortalContainer(triggerRef.current):null;

  const triggerClone=cloneElement(children,{
    ref:mergedTriggerRef,
    'data-hover-card-trigger':kind,
    ...(present?{'data-hover-card-present':'true'}:{}),
    'aria-haspopup':'dialog',
    'aria-expanded':open?'true':'false',
    ...(open?{'aria-controls':cardId}:{}),
    ...(!nativelyInteractive&&childProps.tabIndex===undefined?{tabIndex:0}:{}),
    onPointerEnter:(event:ReactPointerEvent<HTMLElement>)=>{
      origPointerEnter?.(event);
      if(propDisabled||event.pointerType==='touch')return;
      ensureGlobalInputTracker();
      pointerOnTriggerRef.current=true;
      scheduleOpen(openDelayForHover());
    },
    onPointerLeave:(event:ReactPointerEvent<HTMLElement>)=>{
      origPointerLeave?.(event);
      pointerOnTriggerRef.current=false;
      if(open){
        scheduleClose();
      }else{
        clearOpenTimer();
      }
    },
    onPointerDown:(event:ReactPointerEvent<HTMLElement>)=>{
      ensureGlobalInputTracker();
      suppressFocusOpenRef.current=true;
      origPointerDown?.(event);
    },
    onFocus:(event:FocusEvent<HTMLElement>)=>{
      origFocus?.(event);
      if(propDisabled)return;
      ensureGlobalInputTracker();
      if(suppressFocusOpenRef.current){
        suppressFocusOpenRef.current=false;
        return;
      }
      if(!isElementFocusVisible(event.currentTarget))return;
      focusOpenedRef.current=true;
      scheduleOpen(0);
    },
    onBlur:(event:FocusEvent<HTMLElement>)=>{
      origBlur?.(event);
      suppressFocusOpenRef.current=false;
      const related=event.relatedTarget as Node|null;
      if(related&&(cardRef.current?.contains(related)||isInsideNestedCard(level,related)))return;
      if(!pointerOnTriggerRef.current&&!pointerOnCardRef.current&&!pointerOnChildRef.current){
        closeImmediately(false);
      }else{
        focusOpenedRef.current=false;
      }
    },
    onKeyDown:(event:KeyboardEvent<HTMLElement>)=>{
      if(event.key==='Tab'&&!event.shiftKey&&open&&cardRef.current){
        const items=focusableElements(cardRef.current);
        const first=items[0];
        if(first){
          event.preventDefault();
          first.focus();
          return;
        }
      }
      origKeyDown?.(event);
    },
  });

  const portalNode=present&&portalTarget?createPortal(
    <HoverCardLevelContext.Provider value={level+1}>
      <div
        ref={cardRef}
        id={cardId}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        className="ds-hover-card"
        data-hover-card={kind}
        data-placement={placement}
        data-hover-card-state={state}
        data-overlay={portalTarget.overlay?'true':undefined}
        tabIndex={-1}
        {...attributes}
        onPointerEnter={event=>{
          if(event.pointerType==='touch')return;
          pointerOnCardRef.current=true;
          clearCloseTimer();
          if(level>0)activeByLevel.get(level-1)?.setPointerChildInside(true);
        }}
        onPointerLeave={()=>{
          pointerOnCardRef.current=false;
          if(level>0)activeByLevel.get(level-1)?.setPointerChildInside(false);
          scheduleClose();
        }}
        onFocusCapture={()=>{
          clearCloseTimer();
        }}
        onBlur={event=>{
          const related=event.relatedTarget as Node|null;
          if(related&&(cardRef.current?.contains(related)||triggerRef.current?.contains(related)||isInsideNestedCard(level,related)))return;
          if(!pointerOnTriggerRef.current&&!pointerOnCardRef.current&&!pointerOnChildRef.current){
            closeImmediately(false);
          }
        }}
        onKeyDown={event=>{
          if(event.key==='Tab'&&event.shiftKey&&cardRef.current){
            const items=focusableElements(cardRef.current);
            const active=document.activeElement;
            if(!items.length||active===items[0]||active===cardRef.current){
              event.preventDefault();
              if(triggerRef.current){
                suppressFocusOpenRef.current=false;
                triggerRef.current.focus();
              }
            }
          }
        }}
      >
        {renderContent({titleId,close:()=>closeImmediately(false)})}
      </div>
    </HoverCardLevelContext.Provider>,
    portalTarget.container,
  ):null;

  return <>{triggerClone}{portalNode}</>;
}

/** Design-layer bridge so design components can expose person hover cards without importing features. */
export function PersonHoverTrigger({name,personId,isSelf,disabled,children}:PersonHoverTriggerProps){
  const renderPerson=useContext(PersonHoverRendererContext);
  if(!renderPerson||!name.trim())return children;
  return renderPerson({name,...(personId!==undefined?{personId}:{}),...(isSelf!==undefined?{isSelf}:{}),...(disabled!==undefined?{disabled}:{}),children});
}
