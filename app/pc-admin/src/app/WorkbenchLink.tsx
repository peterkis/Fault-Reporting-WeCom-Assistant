import {Link as HeroLink} from '@heroui/react';
import {Link as RouterLink} from 'react-router';
import type {LinkProps} from 'react-router';

export function WorkbenchLink({children,className='',...routerProps}:LinkProps){
  return <HeroLink className={className} render={({ref,...props})=><RouterLink {...props} {...routerProps} className={props.className} ref={element=>{if(typeof ref==='function')return ref(element);if(ref)ref.current=element;}}/>}>{children}</HeroLink>;
}
