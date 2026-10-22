import '../components/interaction-messages';
import type {ComponentProps} from 'react';
import * as Modal from '@animate-ui/react/primitives/radix-ui/dialog';
import * as Progress from '@animate-ui/react/primitives/radix-ui/progress';
import * as Radio from '@animate-ui/react/primitives/radix-ui/radio-group';
import {Button as MotionButton} from '@animate-ui/react/primitives/buttons/button';
import {Button as StaticButton,buttonVariants} from '../components/ui/primitives';
import {DialogScrollLock} from '../components/ui/dialog';
import {Icon} from '../components/Icon';
import {useTranslation} from '../i18n-react';
import {cn} from '../lib/utils';

export {ImageZoom} from '@animate-ui/react/primitives/effects/image-zoom';
export const Dialog=Modal.Root,DialogTitle=Modal.Title,DialogDescription=Modal.Description,DialogClose=Modal.Close;
export function DialogContent({children,className,...props}:ComponentProps<typeof Modal.Content>){
 return <Modal.Portal><Modal.Overlay className="ui-dialog-overlay" transition={{duration:0.22}} exitTransition={{duration:0.14}}/><Modal.Content {...props} data-slot="dialog-content" className={cn('ui-dialog-content h5-experience-sheet',className)} from="bottom" transition={{duration:0.22,ease:[0.16,1,0.3,1]}} exitTransition={{duration:0.14,ease:'easeIn'}}><DialogScrollLock/>{children}</Modal.Content></Modal.Portal>;
}
export function Button({variant,size,className,type='button',...props}:ComponentProps<typeof StaticButton>){
 return <MotionButton asChild hoverScale={1} tapScale={0.98} transition={{type:'spring',stiffness:350,damping:28}}><button {...props} type={type} data-slot="button" className={cn(buttonVariants({variant,size}),className)}/></MotionButton>;
}
export function UploadProgress({value,label}:{value:number;label:string}){
 return <Progress.Root value={value} max={100} aria-label={label} className="h5-upload-progress"><Progress.Indicator className="h5-upload-indicator" style={{transform:`translateX(${value-100}%)`}} transition={{duration:0.18,ease:'easeOut'}}/></Progress.Root>;
}
export function Rating({value,onChange,disabled}:{value:number;onChange:(value:number)=>void;disabled:boolean}){
 const {t}=useTranslation();
 return <Radio.Root className="rating-options h5-rating" value={String(value)} onValueChange={next=>onChange(Number(next))} disabled={disabled} aria-label={t('interaction:ratingLabel')}>
  {[1,2,3,4,5].map(star=><Radio.Item key={star} value={String(star)} aria-label={t('interaction:rating',{count:star})} className="h5-rating-item"><Icon name="star" className={star<=value?'star-selected':''}/><Radio.Indicator className="h5-rating-indicator"/></Radio.Item>)}
 </Radio.Root>;
}
