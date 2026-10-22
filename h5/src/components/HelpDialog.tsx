import './help-messages';
import {useTranslation} from "../i18n-react";
import {useIdentity} from '../session';
import {Icon} from './Icon';
import {Button,ButtonLink} from './ui/primitives';
import {Dialog,DialogContent,DialogTitle,DialogDescription,DialogClose} from './ui/dialog';
export default function HelpDialog({open,onOpenChange}:{open:boolean;onOpenChange:(open:boolean)=>void}){const{t}=useTranslation(),{t:h}=useTranslation('help'),session=useIdentity();return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogTitle>{t('selfCheck')}</DialogTitle><DialogDescription>{h('checksEmergency')}</DialogDescription><div className="help-list">{(['Printer','Offline','System']as const).map(key=><section key={key}><h3>{h('checks'+key)}</h3><p>{h('checks'+key+'Text')}</p></section>)}</div><ButtonLink href={'tel:'+session.h5.support.emergency_phone}><Icon name="call" data-icon="inline-start"/>{t('emergency')}</ButtonLink><DialogClose asChild><Button variant="outline">{t('close')}</Button></DialogClose></DialogContent></Dialog>;}
