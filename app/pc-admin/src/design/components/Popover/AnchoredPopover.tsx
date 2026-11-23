import {useCallback,useLayoutEffect,useRef,useState} from 'react';
import type {KeyboardEventHandler,ReactNode,RefObject} from 'react';
import {createPortal} from 'react-dom';
import {usePopoverPresence} from './usePopoverPresence';

export interface AnchoredPopoverProps {
  open:boolean;
  present?:boolean|undefined;
  presenceAttributes?:Record<string,unknown>|undefined;
  anchorRef:RefObject<HTMLElement|null>;
  popoverRef?:RefObject<HTMLDivElement|null>|undefined;
  align?:'start'|'end'|undefined;
  gap?:number|undefined;
  viewportMargin?:number|undefined;
  portal?:boolean|undefined;
  onAnchorHidden?:(()=>void)|undefined;
  className?:string|undefined;
  role?:string|undefined;
  ariaLabel?:string|undefined;
  onKeyDown?:KeyboardEventHandler<HTMLDivElement>|undefined;
  children:ReactNode;
}

const DEFAULT_GAP=4;
const DEFAULT_VIEWPORT_MARGIN=8;
const CLIPPING_OVERFLOWS=new Set(['hidden','clip','auto','scroll','overlay']);

function containingBlockOffset(el:HTMLElement):{x:number;y:number}{
  let parent=el.parentElement;
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

function resolveBounds(popoverEl:HTMLElement,portal:boolean,viewportMargin:number){
  const vw=document.documentElement.clientWidth||window.innerWidth;
  const vh=document.documentElement.clientHeight||window.innerHeight;
  let left=viewportMargin;
  let top=viewportMargin;
  let right=Math.max(viewportMargin,vw-viewportMargin);
  let bottom=Math.max(viewportMargin,vh-viewportMargin);
  if(!portal){
    for(let parent=popoverEl.parentElement;parent&&parent!==document.body&&parent!==document.documentElement;parent=parent.parentElement){
      const style=window.getComputedStyle(parent);
      const rect=parent.getBoundingClientRect();
      if(CLIPPING_OVERFLOWS.has(style.overflowX)){
        left=Math.max(left,rect.left+parent.clientLeft);
        right=Math.min(right,rect.left+parent.clientLeft+parent.clientWidth);
      }
      if(CLIPPING_OVERFLOWS.has(style.overflowY)){
        top=Math.max(top,rect.top+parent.clientTop);
        bottom=Math.min(bottom,rect.top+parent.clientTop+parent.clientHeight);
      }
    }
  }
  return {
    left,
    top,
    right:Math.max(left,right),
    bottom:Math.max(top,bottom),
  };
}

/** Shared anchored popover with 36A presence support and collision-aware flip/clamp placement. */
export function AnchoredPopover({
  open,
  present,
  presenceAttributes,
  anchorRef,
  popoverRef,
  align='end',
  gap=DEFAULT_GAP,
  viewportMargin=DEFAULT_VIEWPORT_MARGIN,
  portal=true,
  onAnchorHidden,
  className,
  role,
  ariaLabel,
  onKeyDown,
  children,
}:AnchoredPopoverProps){
  const internalPresence=usePopoverPresence(open,{immediateEnter:true});
  const isPresent=present??internalPresence.present;
  const attrs=presenceAttributes??internalPresence.attributes;
  const localRef=useRef<HTMLDivElement|null>(null);
  const [placement,setPlacement]=useState<'bottom'|'top'>('bottom');
  const openRef=useRef(open);
  openRef.current=open;
  const onAnchorHiddenRef=useRef(onAnchorHidden);
  onAnchorHiddenRef.current=onAnchorHidden;

  const setRef=useCallback((node:HTMLDivElement|null)=>{
    localRef.current=node;
    if(popoverRef)popoverRef.current=node;
  },[popoverRef]);

  const updatePosition=useCallback(()=>{
    const anchorEl=anchorRef.current;
    const popoverEl=localRef.current;
    if(!anchorEl||!popoverEl)return;
    if(!anchorEl.isConnected){
      if(openRef.current)onAnchorHiddenRef.current?.();
      return;
    }

    const triggerRect=anchorEl.getBoundingClientRect();
    const popoverWidth=popoverEl.offsetWidth||popoverEl.getBoundingClientRect().width;
    const popoverHeight=Math.max(popoverEl.offsetHeight||popoverEl.getBoundingClientRect().height,popoverEl.scrollHeight);
    const clipBounds=resolveBounds(popoverEl,portal,0);
    if(
      openRef.current&&
      ((triggerRect.width===0&&triggerRect.height===0)||
        triggerRect.bottom<=clipBounds.top||
        triggerRect.top>=clipBounds.bottom||
        triggerRect.right<=clipBounds.left||
        triggerRect.left>=clipBounds.right)
    ){
      onAnchorHiddenRef.current?.();
      return;
    }
    const bounds=resolveBounds(popoverEl,portal,viewportMargin);

    const spaceBelow=bounds.bottom-triggerRect.bottom;
    const spaceAbove=triggerRect.top-bounds.top;
    let nextPlacement:'bottom'|'top'='bottom';
    if(spaceBelow<popoverHeight+gap&&(spaceAbove>=popoverHeight+gap||spaceAbove>spaceBelow)){
      nextPlacement='top';
    }

    const availableSpace=Math.max(0,(nextPlacement==='bottom'?spaceBelow:spaceAbove)-gap);
    if(popoverHeight>availableSpace){
      const cappedMaxHeight=`${availableSpace}px`;
      if(popoverEl.style.maxHeight!==cappedMaxHeight)popoverEl.style.maxHeight=cappedMaxHeight;
      if(popoverEl.style.overflowY!=='auto')popoverEl.style.overflowY='auto';
    }else{
      if(popoverEl.style.maxHeight!=='')popoverEl.style.removeProperty('max-height');
      if(popoverEl.style.overflowY!=='')popoverEl.style.removeProperty('overflow-y');
    }

    const renderedHeight=popoverHeight>availableSpace?Math.min(popoverHeight,availableSpace):popoverHeight;
    const preferredTop=nextPlacement==='bottom'?triggerRect.bottom+gap:triggerRect.top-gap-renderedHeight;
    const maxTop=Math.max(bounds.top,bounds.bottom-renderedHeight);
    const vpTop=Math.min(Math.max(bounds.top,preferredTop),maxTop);

    const preferredLeft=align==='end'?triggerRect.right-popoverWidth:triggerRect.left;
    const maxLeft=Math.max(bounds.left,bounds.right-popoverWidth);
    const vpLeft=Math.min(Math.max(bounds.left,preferredLeft),maxLeft);

    const offset=portal
      ?containingBlockOffset(popoverEl)
      :(popoverEl.offsetParent instanceof HTMLElement
        ?(()=>{
          const parent=popoverEl.offsetParent;
          const parentRect=parent.getBoundingClientRect();
          return {x:parentRect.left+parent.clientLeft,y:parentRect.top+parent.clientTop};
        })()
        :containingBlockOffset(popoverEl));

    popoverEl.style.left=`${vpLeft-offset.x}px`;
    popoverEl.style.top=`${vpTop-offset.y}px`;
    popoverEl.style.right='auto';
    popoverEl.style.bottom='auto';
    setPlacement(current=>current===nextPlacement?current:nextPlacement);
  },[anchorRef,align,gap,portal,viewportMargin]);

  useLayoutEffect(()=>{
    if(!isPresent)return;
    updatePosition();
    const popoverEl=localRef.current;
    const anchorEl=anchorRef.current;
    const observer=typeof ResizeObserver==='function'?new ResizeObserver(()=>updatePosition()):null;
    if(observer){
      if(popoverEl)observer.observe(popoverEl);
      if(anchorEl){
        observer.observe(anchorEl);
        const layoutHost=anchorEl.closest('.board-column,.board,.ds-page');
        if(layoutHost)observer.observe(layoutHost);
      }
      if(typeof document!=='undefined'&&document.documentElement)observer.observe(document.documentElement);
    }
    const onViewportChange=()=>updatePosition();
    window.addEventListener('resize',onViewportChange);
    window.addEventListener('scroll',onViewportChange,true);
    document.addEventListener('transitionend',onViewportChange,true);
    document.addEventListener('animationend',onViewportChange,true);
    return ()=>{
      observer?.disconnect();
      window.removeEventListener('resize',onViewportChange);
      window.removeEventListener('scroll',onViewportChange,true);
      document.removeEventListener('transitionend',onViewportChange,true);
      document.removeEventListener('animationend',onViewportChange,true);
    };
  },[isPresent,open,updatePosition,anchorRef]);

  if(!isPresent)return null;

  const content=<div
    {...attrs}
    ref={setRef}
    className={className}
    role={role}
    aria-label={ariaLabel}
    data-placement={placement}
    onKeyDown={onKeyDown}
  >{children}</div>;

  return portal&&typeof document!=='undefined'?createPortal(content,document.body):content;
}
