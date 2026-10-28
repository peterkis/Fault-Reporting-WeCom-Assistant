import {useEffect,useState} from 'react';
import {LoaderCircle} from 'lucide-react';

export function DetailLoading({label,compact=false}:{label:string;compact?:boolean}){
  const [visible,setVisible]=useState(false);
  useEffect(()=>{const timer=window.setTimeout(()=>setVisible(true),200);return()=>window.clearTimeout(timer);},[]);
  return <span className={'detail-loading'+(compact?' is-compact':'')} role="status" aria-live="polite" aria-busy="true">
    {visible?<><LoaderCircle size={compact?18:20} aria-hidden="true"/><span>{label}</span></>:null}
  </span>;
}
