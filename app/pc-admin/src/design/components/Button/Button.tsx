import {useCallback,useContext,useId,useRef} from 'react';
import {DisabledReasonContext} from '../ReadOnlyBar/read-only-context';
import {Button as HeroButton} from '@heroui/react';
import type {ButtonHTMLAttributes,ComponentProps,Ref} from 'react';
import './button.css';
import {TooltipAnchor} from '../Tooltip/Tooltip';
import {cancelPointerButtonPress,endButtonPressFor,enterPointerButtonPress,isKeyboardPressActive,leavePointerButtonPress,startKeyboardButtonPress,startPointerButtonPress} from './press-feedback';

type HeroProps=ComponentProps<typeof HeroButton>;
export type ButtonProps=Omit<HeroProps,'variant'|'className'|'ref'|'onPointerEnter'|'onPointerLeave'|'onPointerDown'|'onFocus'|'onBlur'|'onKeyDown'> & Pick<ButtonHTMLAttributes<HTMLButtonElement>,'title'|'role'|'tabIndex'|'onPointerEnter'|'onPointerLeave'|'onPointerDown'|'onFocus'|'onBlur'|'onKeyDown'> & {
  ref?:Ref<HTMLButtonElement>;
  disabledReason?:string;
  tone?:'primary'|'secondary'|'ghost'|'danger';
  className?:string|undefined;
};

function mergeButtonRefs(first:Ref<HTMLButtonElement>|undefined,second:Ref<HTMLButtonElement>|undefined){
  return (node:HTMLButtonElement|null)=>{
    if(typeof first==='function')first(node);
    else if(first)(first as {current:HTMLButtonElement|null}).current=node;
    if(typeof second==='function')second(node);
    else if(second)(second as {current:HTMLButtonElement|null}).current=node;
  };
}

/** Presentation only: the caller retains every command, pending and disabled decision. */
export function Button({ref,tone='secondary',size='md',title,role,tabIndex,className='',children,disabledReason,onPointerEnter,onPointerLeave,onPointerDown,onFocus,onBlur,onKeyDown,...props}:ButtonProps){
  const inheritedReason=useContext(DisabledReasonContext),tooltip=useId();
  const reason=props.isDisabled?(disabledReason??inheritedReason):null;
  const content=<HeroButton {...props} {...(reason?{isDisabled:false,'aria-disabled':true,'aria-describedby':[props['aria-describedby'],tooltip].filter(Boolean).join(' '),onPress:()=>{}}:{})} size={size} variant={tone==='secondary'||tone==='danger'?'outline':tone} data-tone={tone} data-size={size} data-icon-only={props.isIconOnly?'true':undefined} className={'ds-button '+className}
    render={buttonProps=>{
      const renderedRef=(buttonProps as {ref?:Ref<HTMLButtonElement>}).ref;
      return <button
        {...buttonProps}
        ref={mergeButtonRefs(renderedRef,ref)}
        title={title??(props.isIconOnly?props['aria-label']:undefined)}
        role={role}
        tabIndex={tabIndex??buttonProps.tabIndex}
        onPointerEnter={event=>{buttonProps.onPointerEnter?.(event);onPointerEnter?.(event);}}
        onPointerLeave={event=>{buttonProps.onPointerLeave?.(event);onPointerLeave?.(event);}}
        onPointerDown={event=>{buttonProps.onPointerDown?.(event);onPointerDown?.(event);}}
        onFocus={event=>{buttonProps.onFocus?.(event);onFocus?.(event);}}
        onBlur={event=>{buttonProps.onBlur?.(event);onBlur?.(event);}}
        onKeyDown={event=>{buttonProps.onKeyDown?.(event);onKeyDown?.(event);}}
      />;
    }}>
    {state=><><span className="ds-button-label">{typeof children==='function'?children(state):children}</span>{state.isPending?<span className="ds-button-spinner" aria-hidden="true"/>:null}</>}
  </HeroButton>;
  return reason?<TooltipAnchor className="ds-read-only-control" data-readonly-disabled onClickCapture={event=>{event.preventDefault();event.stopPropagation();}} onKeyDownCapture={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();}}}>{content}<span id={tooltip} className="ds-read-only-tooltip" role="tooltip">{reason}</span></TooltipAnchor>:content;
}

export type CardActionButtonProps=Omit<ButtonHTMLAttributes<HTMLButtonElement>,'disabled'> & {
  ref?:Ref<HTMLButtonElement>;
  isDisabled?:boolean;
  disabledReason?:string;
  tone?:'primary'|'secondary'|'ghost'|'danger';
  size?:'sm'|'md'|'lg';
  isIconOnly?:boolean;
};

/** Lightweight design-system button for high-cardinality resting card tools preserving E1 `data-pressed` feedback and non-repeating press semantics. */
export function CardActionButton({ref,tone='ghost',size='sm',isIconOnly=true,isDisabled=false,disabledReason,title,className='',children,onClick,onPointerDown,onPointerLeave,onPointerEnter,onPointerCancel,onDragStart,onKeyDown,onBlur,...props}:CardActionButtonProps){
  const inheritedReason=useContext(DisabledReasonContext),tooltip=useId();
  const reason=isDisabled?(disabledReason??inheritedReason):null;
  const effectiveDisabled=isDisabled||Boolean(reason);
  const variant=tone==='secondary'||tone==='danger'?'outline':tone;
  const nodeRef=useRef<HTMLButtonElement|null>(null);
  if(effectiveDisabled&&nodeRef.current){
    const staleEl=nodeRef.current;
    queueMicrotask(()=>{if(nodeRef.current===staleEl)endButtonPressFor(staleEl);});
  }
  const setRef=useCallback((node:HTMLButtonElement|null)=>{
    const previous=nodeRef.current;
    if(previous&&previous!==node)endButtonPressFor(previous);
    nodeRef.current=node;
    if(typeof ref==='function')return ref(node);
    if(ref)ref.current=node;
  },[ref]);
  const button=<button {...props} ref={setRef} type={props.type??'button'} disabled={reason?false:isDisabled} data-slot="button" data-disabled={!reason&&isDisabled?'true':undefined} aria-disabled={reason?true:props['aria-disabled']} aria-describedby={reason?[props['aria-describedby'],tooltip].filter(Boolean).join(' '):props['aria-describedby']} data-tone={tone} data-size={size} data-icon-only={isIconOnly?'true':undefined} title={title??(isIconOnly?props['aria-label']:undefined)} className={`button button--${variant} button--${size}${isIconOnly?' button--icon-only':''} ds-button ${className}`}
    onPointerDown={event=>{
      onPointerDown?.(event);
      startPointerButtonPress(event,effectiveDisabled);
    }}
    onPointerLeave={event=>{
      onPointerLeave?.(event);
      leavePointerButtonPress(event);
    }}
    onPointerEnter={event=>{
      onPointerEnter?.(event);
      enterPointerButtonPress(event,effectiveDisabled);
    }}
    onPointerCancel={event=>{
      onPointerCancel?.(event);
      cancelPointerButtonPress(event);
    }}
    onDragStart={event=>{
      onDragStart?.(event);
      endButtonPressFor(event.currentTarget);
    }}
    onKeyDown={event=>{
      onKeyDown?.(event);
      startKeyboardButtonPress(event,effectiveDisabled);
    }}
    onBlur={event=>{
      onBlur?.(event);
      endButtonPressFor(event.currentTarget);
    }}
    onClick={event=>{
      if(reason)return;
      if(isKeyboardPressActive(event.currentTarget))return;
      onClick?.(event);
    }}><span className="ds-button-label">{children}</span></button>;
  return reason?<TooltipAnchor className="ds-read-only-control" data-readonly-disabled onClickCapture={event=>{event.preventDefault();event.stopPropagation();}} onKeyDownCapture={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();}}}>{button}<span id={tooltip} className="ds-read-only-tooltip" role="tooltip">{reason}</span></TooltipAnchor>:button;
}
