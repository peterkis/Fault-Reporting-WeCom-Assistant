import {Tooltip as HeroTooltip} from '@heroui/react';
import {useEffect,useId,useState,useSyncExternalStore} from 'react';
import type {ComponentProps,FocusEvent,HTMLAttributes,KeyboardEvent,PointerEvent} from 'react';
import {motionToken} from '../../motion/tokens';

let warm=false,cooldown:ReturnType<typeof setTimeout>|undefined;
const listeners=new Set<()=>void>();
const owners=new Set<string>();
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
function setWarm(value:boolean){if(warm===value)return;warm=value;for(const listener of listeners)listener();}
function opened(owner:string){owners.add(owner);clearTimeout(cooldown);setWarm(true);}
function closed(owner:string){if(!owners.delete(owner)||owners.size)return;clearTimeout(cooldown);cooldown=setTimeout(()=>setWarm(false),motionToken('--delay-tooltip'));}
function useWarm(){return useSyncExternalStore(subscribe,()=>warm,()=>false);}

/** Shared warmup includes custom CSS tooltips and HeroUI portal tooltips. */
export function useTooltipTrigger(){
  const [open,setOpen]=useState(false),[waiting,setWaiting]=useState(false),isWarm=useWarm(),owner=useId();
  useEffect(()=>{
    if(!waiting)return;
    const timer=setTimeout(()=>{opened(owner);setOpen(true);setWaiting(false);},isWarm?0:motionToken('--delay-tooltip'));
    return()=>clearTimeout(timer);
  },[waiting,isWarm]);
  useEffect(()=>()=>closed(owner),[owner]);
  const leave=()=>{setWaiting(false);setOpen(false);closed(owner);};
  return {'data-tooltip-open':open?'true':undefined,onPointerEnter:()=>setWaiting(true),onPointerLeave:(event:PointerEvent<HTMLElement>)=>{if(!event.currentTarget.contains(document.activeElement))leave();},onFocus:()=>setWaiting(true),onBlur:(event:FocusEvent<HTMLElement>)=>{if(!event.currentTarget.contains(event.relatedTarget)&&!event.currentTarget.matches(':hover'))leave();},onKeyDown:(event:KeyboardEvent)=>{if(event.key==='Escape')leave();}};
}
export function TooltipAnchor({as='span',...props}:HTMLAttributes<HTMLElement>&{as?:'span'|'div'}){
  const attributes=useTooltipTrigger();
  return as==='div'?<div {...props} {...attributes}/>:<span {...props} {...attributes}/>;
}
function Root({onOpenChange,...props}:ComponentProps<typeof HeroTooltip>){
  const isWarm=useWarm(),owner=useId();
  useEffect(()=>{if(props.isOpen)opened(owner);return()=>closed(owner);},[owner,props.isOpen]);
  return <HeroTooltip {...props} delay={isWarm?0:motionToken('--delay-tooltip')} closeDelay={0} onOpenChange={next=>{if(next)opened(owner);else closed(owner);onOpenChange?.(next);}}/>;
}
export const Tooltip=Object.assign(Root,{Trigger:HeroTooltip.Trigger,Content:HeroTooltip.Content});
