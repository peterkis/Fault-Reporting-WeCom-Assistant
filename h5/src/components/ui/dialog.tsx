import {useEffect,type ComponentProps} from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {cn} from '../../lib/utils';
export const Dialog=DialogPrimitive.Root;
export const DialogTrigger=DialogPrimitive.Trigger;
export const DialogClose=DialogPrimitive.Close;
export const DialogTitle=DialogPrimitive.Title;
export const DialogDescription=DialogPrimitive.Description;
let locks=0;
export function DialogScrollLock(){useEffect(()=>{locks+=1;document.body.classList.add('h5-dialog-open');return()=>{locks-=1;if(locks===0)document.body.classList.remove('h5-dialog-open');};},[]);return null;}
export function DialogContent({children,className,...props}:ComponentProps<typeof DialogPrimitive.Content>){return <DialogPrimitive.Portal><div data-slot="dialog-overlay" aria-hidden="true" className="ui-dialog-overlay"/><DialogPrimitive.Content data-slot="dialog-content" className={cn('ui-dialog-content',className)} {...props}><DialogScrollLock/>{children}</DialogPrimitive.Content></DialogPrimitive.Portal>;}
