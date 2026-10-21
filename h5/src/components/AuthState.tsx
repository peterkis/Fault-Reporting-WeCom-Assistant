import {useEffect,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Button} from './ui/primitives';
import {reconnect} from '../lib/reauth';
import {hasProtectedInput} from '../lib/reload';
import './auth-messages';

export default function AuthState({expired,blocked,returnTo}:{expired:boolean;blocked:boolean;returnTo:string}){
 const {t}=useTranslation('auth'),[intent,setIntent]=useState<'automatic'|'manual'|'confirmed'|null>(null),[protectedInput,setProtectedInput]=useState(blocked);
 const connecting=intent!==null;
 useEffect(()=>{if(expired&&!blocked&&!hasProtectedInput()&&new URLSearchParams(location.search).get('auth_return')!=='1'&&/wxwork/i.test(navigator.userAgent))setIntent('automatic');},[expired,blocked,returnTo]);
 useEffect(()=>{
  if(!intent)return;
  // Commit and paint the reconnect state before leaving this document.
  let frame=requestAnimationFrame(()=>{frame=requestAnimationFrame(()=>{
   if(!reconnect(returnTo,{automatic:intent==='automatic',blocked,confirmed:intent==='confirmed'})){setIntent(null);if(hasProtectedInput())setProtectedInput(true);}
  });});
  return()=>cancelAnimationFrame(frame);
 },[intent,blocked,returnTo]);
 const retry=()=>{
  const mustConfirm=protectedInput||hasProtectedInput();
  if(mustConfirm&&!protectedInput){setProtectedInput(true);return;}
  setIntent(mustConfirm?'confirmed':'manual');
 };
 return <main className="auth-state" aria-labelledby="auth-title" aria-busy={connecting}>
  <a className="auth-brand" href="#/" aria-label={t('app')}><span className="brand-mark">修</span><span>{t('app')}</span></a>
  <section className="auth-message">
   <svg className={'auth-connection'+(connecting?' is-connecting':'')} viewBox="0 0 240 184" fill="none" aria-hidden="true">
    <circle cx="120" cy="92" r="79" className="auth-orbit"/>
    <path d="M37 103h31m104-22h31M64 48l16 16m80 56 16 16" className="auth-traces"/>
    <path d="M75 45h65l25 25v67a10 10 0 0 1-10 10H75a10 10 0 0 1-10-10V55a10 10 0 0 1 10-10Z" className="auth-paper"/>
    <path d="M140 46v19a5 5 0 0 0 5 5h19M85 111h39m-39 13h24" className="auth-lines"/>
    <path d="M107 70v20m-10-10h20" className="auth-cross"/>
    <circle cx="162" cy="124" r="27" className="auth-seal"/>
    {expired?<path d="M151 122a11 11 0 0 1 18-6l4 4m0-8v8h-8m8 7a11 11 0 0 1-18 6l-4-4m0 8v-8h8" className="auth-seal-icon"/>:<><rect x="152" y="122" width="20" height="14" rx="4" className="auth-seal-icon"/><path d="M157 122v-5a5 5 0 0 1 10 0v5" className="auth-seal-icon"/></>}
    <circle cx="47" cy="67" r="4" className="auth-node"/><circle cx="191" cy="111" r="3" className="auth-node"/>
   </svg>
   <h1 id="auth-title">{t(connecting?'reconnectingTitle':expired?'reconnectTitle':'accessTitle')}</h1>
   <p role="status" aria-live="polite">{t(connecting?'reconnectingText':expired?'reconnectText':'accessText')}</p>
   {protectedInput&&<p className="auth-protected">{t('reconnectProtected')}</p>}
   <Button className="auth-retry" disabled={connecting} onClick={retry}>{t(connecting?'reconnectingAction':protectedInput?'reconnectConfirm':'reconnectAction')}</Button>
   <span className="auth-footnote">{t('reconnectFootnote')}</span>
  </section>
 </main>;
}
