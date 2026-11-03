import {Drawer as HeroDrawer} from '@heroui/react';
import {useEffect,useRef} from 'react';
import type {HTMLAttributes,ReactNode} from 'react';
import {MoreHorizontal} from 'lucide-react';
import './drawer.css';
import './drawer-v21.css';

export function Drawer({children,dismissBlocked,onClose}:{children:ReactNode;dismissBlocked:boolean;onClose:()=>void}){
  return <HeroDrawer.Backdrop className="workbench-drawer-backdrop ds-drawer-backdrop" isOpen isDismissable={!dismissBlocked} isKeyboardDismissDisabled={dismissBlocked} onOpenChange={open=>{if(!open)onClose();}}>
    <HeroDrawer.Content placement="right" className="workbench-drawer-content ds-drawer-content"><HeroDrawer.Dialog data-workbench-overlay data-dismiss-blocked={dismissBlocked?'true':'false'} className="detail-dialog ds-detail ds-drawer" style={{borderRadius:'calc(var(--radius-lg) + var(--space-0-5))'}} aria-label="事项详情">{children}</HeroDrawer.Dialog></HeroDrawer.Content>
  </HeroDrawer.Backdrop>;
}

/** A disclosure keeps command owners mounted while their entry points are tucked away. */
export function DrawerMoreActions({children,label='更多工单操作'}:{children:ReactNode;label?:string}){
  const root=useRef<HTMLDetailsElement>(null);
  useEffect(()=>{const close=(event:PointerEvent)=>{
    const menu=root.current;if(!menu||!(event.target instanceof Node)||menu.contains(event.target))return;
    // A portalled child dialog owns outside interaction and restores its original trigger.
    const owner=menu.closest('[role=dialog]');
    if([...document.querySelectorAll('[role=dialog]')].some(dialog=>dialog!==owner&&dialog.checkVisibility()))return;
    menu.open=false;
  };
  // Capture before a portalled button's React event layer stops DOM bubbling.
  const menu=root.current,escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&menu?.open&&event.target instanceof Node&&menu.contains(event.target)){event.preventDefault();event.stopPropagation();menu.open=false;menu.querySelector('summary')?.focus();}};
  document.addEventListener('pointerdown',close);menu?.addEventListener('keydown',escape,true);
  return()=>{document.removeEventListener('pointerdown',close);menu?.removeEventListener('keydown',escape,true);};},[]);
  return <details className="ds-drawer-more" ref={root}>
    <summary data-action="open-detail-actions" aria-label={label} title={label}><MoreHorizontal aria-hidden="true"/></summary>
    <div className="ds-drawer-more-panel" aria-label={label}>{children}</div>
  </details>;
}

export function DrawerActions({status,children,className='',...props}:HTMLAttributes<HTMLElement>&{status:ReactNode}){
  return <section {...props} className={'detail-common-actions ds-drawer-actions '+className}><div className="ds-drawer-status">{status}</div><div className="ds-drawer-command-buttons">{children}</div></section>;
}
