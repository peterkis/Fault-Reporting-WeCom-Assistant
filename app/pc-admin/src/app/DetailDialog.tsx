import {WorkbenchButton as HButton} from './WorkbenchButton';
import {createContext,useCallback,useContext,useEffect,useId,useMemo,useState} from 'react';
import type {ReactNode} from 'react';
import {Modal} from '@heroui/react';
import {X} from 'lucide-react';

interface DialogScope {active:string|null;request:(id:string)=>void;release:(id:string)=>void}
const DialogContext=createContext<DialogScope|null>(null);
export function DetailDialogProvider({children}:{children:ReactNode}){
  const [active,setActive]=useState<string|null>(null);
  const request=useCallback((id:string)=>setActive(current=>current??id),[]);
  const release=useCallback((id:string)=>setActive(current=>current===id?null:current),[]);
  const scope=useMemo(()=>({active,request,release}),[active,request,release]);
  return <DialogContext.Provider value={scope}>{children}</DialogContext.Provider>;
}
export function useDetailModalOpen(){const scope=useContext(DialogContext);return scope!==null&&scope.active!==null;}
export function DetailDialog({open,onClose,closeBlocked=false,title,closeLabel,accessibleName,className='detail-action-dialog',actions,children,onOpenChange}:{open:boolean;onClose:()=>void;closeBlocked?:boolean;title:string;closeLabel:string;accessibleName?:string;className?:string;actions?:ReactNode;children:ReactNode;onOpenChange?:((open:boolean)=>void)|undefined}){
  const scope=useContext(DialogContext),id=useId();
  const request=scope?.request,release=scope?.release,active=scope?.active,visible=open&&(!scope||active===id);
  useEffect(()=>{if(open&&active===null)request?.(id);if(!open)release?.(id);},[open,active,id,request,release]);
  useEffect(()=>()=>release?.(id),[release,id]);
  useEffect(()=>{
    onOpenChange?.(visible);
    return()=>{onOpenChange?.(false);};
  },[visible,onOpenChange]);
  useEffect(()=>{
    if(!visible)return;
    // A pending command may disable/remove the focused button. Keep subsequent
    // keyboard input in this purpose while leaving live popover focus alone.
    const frame=requestAnimationFrame(()=>{if(document.activeElement===document.body)document.getElementById(id)?.focus({preventScroll:true});});
    return()=>cancelAnimationFrame(frame);
  },[visible,children,id]);
  const close=()=>{if(!closeBlocked)onClose();};
  return <Modal.Backdrop className="workbench-modal-backdrop" isOpen={visible} onOpenChange={next=>{if(!next)close();}} isDismissable={false} isKeyboardDismissDisabled={closeBlocked}>
    <Modal.Container size="lg" className="workbench-modal-container"><Modal.Dialog data-workbench-overlay className={className} aria-label={accessibleName??title}>
      <header><Modal.Heading id={id} tabIndex={-1}>{title}</Modal.Heading><div className="detail-modal-actions">{actions}<HButton type="button" className="icon-button" aria-label={closeLabel} isDisabled={closeBlocked} onPress={close} variant="ghost"><X size={18}/></HButton></div></header>{children}
    </Modal.Dialog></Modal.Container>
  </Modal.Backdrop>;
}
