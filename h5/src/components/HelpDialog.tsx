import {useTranslation} from 'react-i18next';
import {useIdentity} from '../session';
import {Icon} from './Icon';
import {Button,ButtonLink} from './ui/primitives';
import {Dialog,DialogContent,DialogTitle,DialogDescription,DialogClose} from './ui/dialog';
export default function HelpDialog({open,onOpenChange}:{open:boolean;onOpenChange:(open:boolean)=>void}){const{t}=useTranslation(),session=useIdentity();return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogTitle>{t('selfCheck')}</DialogTitle><DialogDescription>{t('checksEmergency')}</DialogDescription><div className="help-list">{(['Printer','Offline','System']as const).map(key=><section key={key}><h3>{t('checks'+key)}</h3><p>{t('checks'+key+'Text')}</p></section>)}</div><ButtonLink href={'tel:'+session.h5.support.emergency_phone}><Icon name="call" data-icon="inline-start"/>{t('emergency')}</ButtonLink><DialogClose asChild><Button variant="outline">{t('close')}</Button></DialogClose></DialogContent></Dialog>;}
