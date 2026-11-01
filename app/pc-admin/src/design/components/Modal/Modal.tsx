import {Modal as HeroModal} from '@heroui/react';
import type {ComponentProps} from 'react';
import './modal.css';

function Container({size='md',className='',...props}:Omit<ComponentProps<typeof HeroModal.Container>,'size'>&{size?:'sm'|'md'|'lg'}){
 return <HeroModal.Container {...props} size={size} data-size={size} className={'workbench-modal-container ds-modal-container '+className}/>;
}
function Dialog({className='',...props}:ComponentProps<typeof HeroModal.Dialog>){return <HeroModal.Dialog {...props} className={'ds-modal '+className}/>;}
export const Modal={Backdrop:HeroModal.Backdrop,Container,Dialog,Heading:HeroModal.Heading};
