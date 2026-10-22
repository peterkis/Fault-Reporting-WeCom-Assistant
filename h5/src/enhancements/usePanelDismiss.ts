import {useEffect,useRef,useState} from 'react';
import {motionAllowed} from '../experience';
/** Only voluntary dismissal may finish a visual exit; auth/commit unmounts stay urgent. */
export function usePanelDismiss(animated:boolean,onClose:()=>void){
 const [open,setOpen]=useState(true),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const opener=useRef(document.activeElement);
 useEffect(()=>()=>{if(timer.current!==null)clearTimeout(timer.current);},[]);
 return {open,dismiss:()=>{if(timer.current!==null)return;setOpen(false);if(animated&&motionAllowed())timer.current=setTimeout(onClose,140);else onClose();},restoreFocus:(event:Event)=>{const target=opener.current;if(target instanceof HTMLElement&&target.isConnected){event.preventDefault();target.focus({preventScroll:true});}}};
}
