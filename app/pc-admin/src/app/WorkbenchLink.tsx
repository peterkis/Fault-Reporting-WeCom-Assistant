import {Link as HeroLink} from '@heroui/react';
import {Link as RouterLink} from 'react-router';
import type {LinkProps} from 'react-router';
import type {Ref} from 'react';
import {CardLink} from '../design/components/Link/Link';

export function WorkbenchLink({children,className='',ref:outerRef,onPointerEnter,onPointerLeave,onPointerDown,onFocus,onBlur,onKeyDown,...routerProps}:LinkProps&{ref?:Ref<HTMLAnchorElement>}){
  return <HeroLink className={className} render={({ref,...props})=><RouterLink
    {...props}
    {...routerProps}
    className={props.className}
    onPointerEnter={event=>{props.onPointerEnter?.(event);onPointerEnter?.(event);}}
    onPointerLeave={event=>{props.onPointerLeave?.(event);onPointerLeave?.(event);}}
    onPointerDown={event=>{props.onPointerDown?.(event);onPointerDown?.(event);}}
    onFocus={event=>{props.onFocus?.(event);onFocus?.(event);}}
    onBlur={event=>{props.onBlur?.(event);onBlur?.(event);}}
    onKeyDown={event=>{props.onKeyDown?.(event);onKeyDown?.(event);}}
    ref={element=>{
      if(typeof ref==='function')ref(element);else if(ref)ref.current=element;
      if(typeof outerRef==='function')outerRef(element);else if(outerRef)(outerRef as {current:HTMLAnchorElement|null}).current=element;
    }}/>}>{children}</HeroLink>;
}

/** Route-wired high-cardinality card link built on the design-system CardLink primitive. */
export function WorkbenchCardLink({className='',tabIndex,ref:outerRef,...routerProps}:LinkProps&{ref?:Ref<HTMLAnchorElement>}){
  return <CardLink className={className} {...(tabIndex===undefined?{}:{tabIndex})} render={linkProps=><RouterLink {...routerProps} {...linkProps} ref={outerRef}/>}/>;
}
