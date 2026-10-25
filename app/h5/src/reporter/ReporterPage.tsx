import '../components/command-messages';
import {useEffect,useMemo} from 'react';
import {useTranslation} from '../i18n-react';
import {followClientPreferences} from '../lib/preferences';
import {Icon} from '../components/Icon';
import {Button,ButtonLink,Card,CardHeader,CardTitle,CardContent,Badge} from '../components/ui/primitives';
import {mountReporterController} from './controller';
import type {ReporterEntry,CapturedReporterAccess} from './entry';
import './reporter.css';

export default function ReporterPage({access}:{access:CapturedReporterAccess}){
 const entry=useMemo<ReporterEntry>(()=>({...access,publicRef:/^\/wecom\/yixiaoxiu\/tickets\/([A-Za-z0-9_-]{32})$/u.exec(location.pathname)?.[1]??null,feedback:document.documentElement.dataset.reporterFeedback==='true'}),[access]);
 const{t,i18n}=useTranslation();
 useEffect(()=>followClientPreferences(language=>{if(i18n.language!==language)void i18n.changeLanguage(language);document.documentElement.lang=language;}),[i18n]);
 useEffect(()=>{
  let live=true,accessLost=false,stopFeedback:(()=>void)|undefined;
  const lost=()=>{accessLost=true;};
  document.addEventListener('reporter-logout',lost);document.addEventListener('reporter-access-lost',lost);
  const stop=mountReporterController(entry,key=>i18n.t(key.startsWith('reporter')?'command:'+key:key));
  if(entry.identityMode==='MEMBER_REQUIRED'&&entry.feedback&&entry.publicRef)void import('./feedback').then(module=>{if(live&&!accessLost&&entry.publicRef)stopFeedback=module.mountBotReporterFeedback(entry.publicRef);}).catch(()=>{if(live)document.dispatchEvent(new Event('reporter-feedback-unavailable'));});
  return()=>{live=false;stopFeedback?.();stop();document.removeEventListener('reporter-logout',lost);document.removeEventListener('reporter-access-lost',lost);};
 },[entry,i18n]);
 return <div className="app-shell detail-shell reporter-shell" data-h5-reporter="true"><header className="app-header"><div className="header-inner"><div className="detail-header-main"><ButtonLink id="reporter-back" variant="ghost" size="icon" href="/wecom/yixiaoxiu/#/reports" aria-label={t('back')}><Icon name="arrow_back"/></ButtonLink><a id="reporter-home" href="/wecom/yixiaoxiu/" className="brand-mark" aria-label={t('home')}>修</a><div className="detail-header-title"><h1>{t('detailTracking')}</h1><Badge variant="blue">{t('app')}</Badge></div></div><div className="header-tools"><Button id="refresh" variant="ghost" size="icon" aria-label={t('refresh')}><Icon name="refresh"/></Button></div></div></header><main id="main-content"><div className="reporter-page"><p id="status" className="reporter-status" role="status" aria-live="polite">{t('command:reporterLoading')}</p><section id="ticket" hidden><Card className="detail-overview"><CardHeader><div className="detail-number"><span id="number"/><Badge id="state" variant="blue"/></div><CardTitle id="title"/></CardHeader><CardContent><dl id="times" className="reporter-times"/></CardContent></Card><Card className="progress-card"><CardHeader><CardTitle>{t('progress')}</CardTitle></CardHeader><CardContent><ol id="timeline" className="reporter-timeline"/><Button id="more" variant="outline" hidden>{t('loadMore')}</Button></CardContent></Card><p id="reporter-guidance" className="reporter-guidance"/><div id="reporter-feedback-root"/></section><div className="reporter-access-actions"><ButtonLink id="reauth" variant="outline" href="/wecom/yixiaoxiu/login" hidden>{t('command:reporterReconnect')}</ButtonLink><Button id="logout" variant="ghost">{t('command:reporterLogout')}</Button></div></div></main></div>;
}
