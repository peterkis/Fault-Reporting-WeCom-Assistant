import {useEffect,useRef,useState} from 'react';
import {useTranslation} from '../i18n-react';

/** The indicator may finish after content appears; content never waits for it. */
export function LoadingProgress({active}:{active:boolean}){
 const {t}=useTranslation(),[phase,setPhase]=useState<'hidden'|'running'|'complete'>('hidden');
 const current=useRef(phase),shownAt=useRef(0);
 useEffect(()=>{
  let timer:number|undefined;
  const show=(next:typeof phase)=>{current.current=next;setPhase(next);};
  if(active){
   if(current.current==='hidden')timer=window.setTimeout(()=>{shownAt.current=performance.now();show('running');},200);
   else show('running');
  }else if(current.current!=='hidden'){
   timer=window.setTimeout(()=>{show('complete');timer=window.setTimeout(()=>show('hidden'),150);},Math.max(0,300-(performance.now()-shownAt.current)));
  }
  return()=>window.clearTimeout(timer);
 },[active]);
 return phase==='hidden'?null:<div className="loading-progress" data-h5-progress={phase} role="progressbar" aria-label={t('loading')}><span/></div>;
}

/** Section reads are announced without replacing their layout with placeholders. */
export function Loading(){const {t}=useTranslation();return <span className="sr-only" role="status">{t('loading')}</span>;}
