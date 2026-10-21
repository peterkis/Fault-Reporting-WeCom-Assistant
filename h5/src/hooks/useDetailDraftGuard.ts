import {useLayoutEffect} from 'react';

/** A detail dialog owns only this flag; report drafts and command fences stay independent. */
export function useDetailDraftGuard(dirty:boolean):void{
 useLayoutEffect(()=>{
  if(!dirty)return;
  const root=document.documentElement;
  root.dataset.h5DetailDraft='true';
  const protect=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
  window.addEventListener('beforeunload',protect);
  return()=>{window.removeEventListener('beforeunload',protect);root.removeAttribute('data-h5-detail-draft');};
 },[dirty]);
}
