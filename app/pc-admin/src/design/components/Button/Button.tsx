import {Button as HeroButton} from '@heroui/react';
import type {ButtonHTMLAttributes,ComponentProps} from 'react';
import './button.css';

type HeroProps=ComponentProps<typeof HeroButton>;
export type ButtonProps=Omit<HeroProps,'variant'|'className'> & Pick<ButtonHTMLAttributes<HTMLButtonElement>,'title'|'role'|'tabIndex'> & {
  tone?:'primary'|'secondary'|'ghost'|'danger';
  className?:string|undefined;
};

/** Presentation only: the caller retains every command, pending and disabled decision. */
export function Button({tone='secondary',size='md',title,role,tabIndex,className='',children,...props}:ButtonProps){
  return <HeroButton {...props} size={size} variant={tone==='secondary'||tone==='danger'?'outline':tone} data-tone={tone} data-size={size} data-icon-only={props.isIconOnly?'true':undefined} className={'ds-button '+className}
    render={buttonProps=><button {...buttonProps} title={title??(props.isIconOnly?props['aria-label']:undefined)} role={role} tabIndex={tabIndex??buttonProps.tabIndex}/>}>
    {state=><><span className="ds-button-label">{typeof children==='function'?children(state):children}</span>{state.isPending?<span className="ds-button-spinner" aria-hidden="true"/>:null}</>}
  </HeroButton>;
}
