// shadcn/ui @shadcn registry (new-york-v4, Radix), adapted to the fixed H5 tokens.
// Source retrieved with shadcn CLI view; Material Symbols replace the registry icon.
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';
const buttonVariants=cva('ui-button',{variants:{variant:{default:'ui-button-primary',outline:'ui-button-outline',secondary:'ui-button-secondary',ghost:'ui-button-ghost',link:'ui-button-link',destructive:'ui-button-destructive',warm:'ui-button-warm',voice:'ui-button-voice',media:'ui-button-media'},size:{default:'ui-button-default',sm:'ui-button-sm',lg:'ui-button-lg',icon:'ui-button-icon'}},defaultVariants:{variant:'default',size:'default'}});
export function Button({className,variant,size,type='button',...props}:React.ComponentProps<'button'>&VariantProps<typeof buttonVariants>){return <button data-slot="button" type={type} className={cn(buttonVariants({variant,size}),className)} {...props}/>;}
export function ButtonLink({className,variant,size,disabled=false,href,onClick,tabIndex,...props}:React.ComponentProps<'a'>&VariantProps<typeof buttonVariants>&{disabled?:boolean}){return <a {...props} data-slot="button" href={disabled?undefined:href} className={cn(buttonVariants({variant,size}),className)} aria-disabled={disabled||undefined} tabIndex={disabled?-1:tabIndex} onClick={event=>{if(disabled)event.preventDefault();else onClick?.(event);}}/>;}
export function Card({className,...props}:React.ComponentProps<'section'>){return <section data-slot="card" className={cn('ui-card',className)} {...props}/>;}
export function CardHeader({className,...props}:React.ComponentProps<'div'>){return <div data-slot="card-header" className={cn('ui-card-header',className)} {...props}/>;}
export function CardTitle({className,...props}:React.ComponentProps<'h2'>){return <h2 data-slot="card-title" className={cn('ui-card-title',className)} {...props}/>;}
export function CardDescription({className,...props}:React.ComponentProps<'p'>){return <p data-slot="card-description" className={cn('ui-card-description',className)} {...props}/>;}
export function CardContent({className,...props}:React.ComponentProps<'div'>){return <div data-slot="card-content" className={cn('ui-card-content',className)} {...props}/>;}
export function CardFooter({className,...props}:React.ComponentProps<'div'>){return <div data-slot="card-footer" className={cn('ui-card-footer',className)} {...props}/>;}
const badgeVariants=cva('ui-badge',{variants:{variant:{default:'badge-neutral',success:'badge-success',warning:'badge-warning',danger:'badge-danger',blue:'badge-blue',purple:'badge-purple'}},defaultVariants:{variant:'default'}});
export function Badge({className,variant,...props}:React.ComponentProps<'span'>&VariantProps<typeof badgeVariants>){return <span data-slot="badge" className={cn(badgeVariants({variant}),className)} {...props}/>;}
export function Input({className,...props}:React.ComponentProps<'input'>){return <input data-slot="input" className={cn('ui-input',className)} {...props}/>;}
export function Textarea({className,...props}:React.ComponentProps<'textarea'>){return <textarea data-slot="textarea" className={cn('ui-textarea',className)} {...props}/>;}
export function FieldGroup({className,...props}:React.ComponentProps<'div'>){return <div data-slot="field-group" className={cn('ui-field-group',className)} {...props}/>;}
export function Field({className,...props}:React.ComponentProps<'div'>){return <div data-slot="field" role="group" className={cn('ui-field',className)} {...props}/>;}
export function FieldLabel({className,...props}:React.ComponentProps<'label'>){return <label data-slot="field-label" className={cn('ui-field-label',className)} {...props}/>;}
export function FieldDescription({className,...props}:React.ComponentProps<'p'>){return <p data-slot="field-description" className={cn('ui-field-description',className)} {...props}/>;}
export function Skeleton({className,...props}:React.ComponentProps<'div'>){return <div data-slot="skeleton" className={cn('ui-skeleton',className)} {...props}/>;}
export function Empty({className,...props}:React.ComponentProps<'div'>){return <div data-slot="empty" className={cn('ui-empty',className)} {...props}/>;}
export function EmptyHeader({className,...props}:React.ComponentProps<'div'>){return <div data-slot="empty-header" className={cn('ui-empty-header',className)} {...props}/>;}
export function EmptyMedia({className,...props}:React.ComponentProps<'div'>){return <div data-slot="empty-media" className={cn('ui-empty-media',className)} {...props}/>;}
export function EmptyTitle({className,...props}:React.ComponentProps<'h3'>){return <h3 data-slot="empty-title" className={cn('ui-empty-title',className)} {...props}/>;}
export function EmptyDescription({className,...props}:React.ComponentProps<'p'>){return <p data-slot="empty-description" className={cn('ui-empty-description',className)} {...props}/>;}
export function Alert({className,variant='default',...props}:React.ComponentProps<'div'>&{variant?:'default'|'destructive'}){return <div data-slot="alert" role="alert" className={cn('ui-alert',variant==='destructive'&&'ui-alert-destructive',className)} {...props}/>;}
export function AlertTitle({className,...props}:React.ComponentProps<'h3'>){return <h3 data-slot="alert-title" className={cn('ui-alert-title',className)} {...props}/>;}
export function AlertDescription({className,...props}:React.ComponentProps<'div'>){return <div data-slot="alert-description" className={cn('ui-alert-description',className)} {...props}/>;}
export function Separator(){return <div role="separator" data-slot="separator" className="ui-separator"/>;}
export function Avatar({src,fallback,alt}:{src:string|null;fallback:string;alt:string}){const[failed,setFailed]=React.useState(false);return <span data-slot="avatar" className="ui-avatar"><span data-slot="avatar-fallback">{fallback}</span>{src&&!failed&&<img data-slot="avatar-image" src={src} alt={alt} onError={()=>setFailed(true)}/>}</span>;}
