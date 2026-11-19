import {useEffect} from 'react';
import type {RefObject} from 'react';

/** Keep native details/summary semantics while making filter popovers dismissible like other E4 menus. */
export function useDetailsDismiss(ref:RefObject<HTMLDetailsElement|null>){
  useEffect(()=>{
    const escape=(event:KeyboardEvent)=>{const node=ref.current;if(event.key==='Escape'&&!event.defaultPrevented&&node?.open){event.preventDefault();event.stopPropagation();node.open=false;node.querySelector('summary')?.focus();}};
    const outside=(event:PointerEvent)=>{
      const node=ref.current,target=event.target;if(!node?.open||!(target instanceof Element)||node.contains(target))return;
      // A child HeroUI calendar/select is portalled outside the native details.
      if(target.closest('.popover,.select__popover,.date-picker__popover,[role=dialog]'))return;
      node.open=false;
    };
    document.addEventListener('keydown',escape);document.addEventListener('pointerdown',outside);
    return()=>{document.removeEventListener('keydown',escape);document.removeEventListener('pointerdown',outside);};
  },[ref]);
}
