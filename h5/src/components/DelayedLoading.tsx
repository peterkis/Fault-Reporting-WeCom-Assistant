import {useEffect,useState} from 'react';
import {useTranslation} from "../i18n-react";
import {Skeleton} from './ui/primitives';

export function Loading(){
 const {t}=useTranslation(),[visible,setVisible]=useState(false);
 useEffect(()=>{const timer=window.setTimeout(()=>setVisible(true),160);return()=>window.clearTimeout(timer);},[]);
 return visible?<div className="loading-stack" role="status" aria-label={t('loading')}><Skeleton className="loading-title"/><Skeleton className="loading-card"/><Skeleton className="loading-card"/></div>:null;
}
