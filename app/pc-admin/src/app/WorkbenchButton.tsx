import {Button} from '@heroui/react';
import type {ComponentProps,ButtonHTMLAttributes} from 'react';

type HeroProps=ComponentProps<typeof Button>;
type Props=Omit<HeroProps,'className'> & Pick<ButtonHTMLAttributes<HTMLButtonElement>,'title'|'role'|'tabIndex'> & {className?:HeroProps['className']|undefined};

/** HeroUI composition preserves native hints and existing accessible widget roles. */
export function WorkbenchButton({title,role,tabIndex,className='',...props}:Props){
  return <Button {...props} className={className} render={buttonProps=><button {...buttonProps} title={title} role={role} tabIndex={tabIndex??buttonProps.tabIndex}/>}/>;
}
