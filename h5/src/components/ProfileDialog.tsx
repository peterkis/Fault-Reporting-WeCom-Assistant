import './interaction-messages';
import {useTranslation} from "../i18n-react";
import {useDisplayProfile} from '../hooks/useDisplayProfile';
import {Icon} from './Icon';
import {Button,Separator} from './ui/primitives';
import {Dialog,DialogContent,DialogTitle,DialogDescription,DialogClose} from './ui/dialog';
export default function ProfileDialog({open,onOpenChange}:{open:boolean;onOpenChange:(open:boolean)=>void}){const{t}=useTranslation(),profile=useDisplayProfile();return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogTitle>{t('profile')}</DialogTitle><DialogDescription>{t('interaction:profileHint')}</DialogDescription><div className="profile-block"><span className="large-avatar"><Icon name="person"/></span><h3>{profile.name||t('member')}</h3><p>{profile.department||t('departmentUnknown')}</p><p>{profile.phone||t('interaction:phoneMissing')}</p></div><Separator/><DialogClose asChild><Button variant="outline">{t('close')}</Button></DialogClose></DialogContent></Dialog>;}
