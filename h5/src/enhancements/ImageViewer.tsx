import '../components/interaction-messages';
import {useEffect,useState} from 'react';
import * as StaticDialog from '../components/ui/dialog';
import {Button as StaticButton,ButtonLink} from '../components/ui/primitives';
import {useTranslation} from '../i18n-react';
import {motionAllowed} from '../experience';
import {interactions} from './loader';
import {usePanelDismiss} from './usePanelDismiss';

export default function ImagePreview({url,original,loading,error,onOriginal,onClose}:{url:string;original:boolean;loading:boolean;error:boolean;onOriginal:()=>void;onClose:()=>void}){
 const {t}=useTranslation(),[kit]=useState(()=>motionAllowed()?interactions.get():null),[zoomed,setZoomed]=useState(false);
 const {Dialog,DialogContent,DialogTitle,DialogDescription,DialogClose}=kit??StaticDialog,Button=kit?.Button??StaticButton;
 const panel=usePanelDismiss(kit!==null,onClose);
 useEffect(()=>setZoomed(false),[url]);
 const label=t(zoomed?'interaction:imageReset':'interaction:imageZoom');
 return <Dialog open={panel.open} onOpenChange={open=>{if(!open)panel.dismiss();}}><DialogContent onCloseAutoFocus={panel.restoreFocus} className="h5-experience-sheet h5-image-preview"><DialogTitle>{t('photoAlt')}</DialogTitle><DialogDescription>{t('interaction:imagePreviewHint')}</DialogDescription>
  {kit?<kit.ImageZoom key={url} role="button" tabIndex={0} aria-label={label} aria-pressed={zoomed} zoomScale={2} zoomOnHover={false} onClick={()=>setZoomed(value=>!value)} onKeyDown={event=>{if(event.key===' '||event.key==='Enter'){event.preventDefault();event.currentTarget.click();}}} className="h5-image-zoom"><img src={url} alt={t('photoAlt')} draggable={false}/></kit.ImageZoom>:<button type="button" className="h5-image-zoom" aria-label={label} aria-pressed={zoomed} onClick={()=>setZoomed(value=>!value)}><img src={url} alt={t('photoAlt')} draggable={false} style={{transform:zoomed?'scale(2)':undefined}}/></button>}
  <div className="h5-image-actions">{original?<ButtonLink href={url} target="_blank" rel="noreferrer" variant="outline">{t('downloadOriginal')}</ButtonLink>:<Button variant="outline" disabled={loading} onClick={onOriginal}>{t(loading?'loading':error?'retry':'downloadOriginal')}</Button>}<DialogClose asChild><Button variant="outline">{t('close')}</Button></DialogClose></div>
 </DialogContent></Dialog>;
}
