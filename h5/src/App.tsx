import{Suspense,useEffect,useMemo,useSyncExternalStore}from'react';
import{HashRouter,useLocation,Navigate}from'./navigation';
import{useTranslation}from'react-i18next';
import{SessionProvider,type SessionStatus}from'./session';
import{CommandProvider}from'./hooks/useCommand';
import{Shell,Loading,ErrorPanel}from'./components/Common';
import{Alert,AlertTitle,Button}from'./components/ui/primitives';
import{followClientPreferences}from'./lib/preferences';
import{describeRoute,pages}from'./routing';
import type{PageRuntime}from'./page-runtime';
import{hasProtectedInput,reloadIfSafe}from'./lib/reload';
function PageFailure({error,runtime}:{error:unknown;runtime:PageRuntime}){const{t}=useTranslation();const asset=error instanceof Error&&/dynamically imported module|loading chunk|preload CSS/i.test(error.message),protectedDraft=hasProtectedInput();return <><ErrorPanel error={error} retry={()=>void runtime.refresh().catch(()=>undefined)}/>{asset&&<Alert><AlertTitle>{t('notAvailable')}</AlertTitle>{protectedDraft&&<p>{t('preserveDraft')}</p>}<Button variant="outline" disabled={protectedDraft} onClick={reloadIfSafe}>{t('refresh')}</Button></Alert>}</>;}
function Navigation({runtime}:{runtime:PageRuntime}){
 const{t}=useTranslation(),location=useLocation();const snapshot=useSyncExternalStore(runtime.subscribe,runtime.getSnapshot,runtime.getSnapshot);
 const route=useMemo(()=>describeRoute(location.pathname,location.search),[location.pathname,location.search]);
 useEffect(()=>{void runtime.navigate(route).catch(()=>undefined);},[runtime,route]);
 const checking=snapshot.checking||snapshot.route.key!==route.key,routeReady=snapshot.ready&&snapshot.route.key===route.key;
 const status=useMemo<SessionStatus>(()=>({checking,writeReady:!checking&&snapshot.ready&&!snapshot.error&&!snapshot.denied,membershipRevision:snapshot.membershipRevision,refresh:runtime.refresh}),[checking,snapshot.ready,snapshot.error,snapshot.denied,snapshot.membershipRevision,runtime]);
 if(snapshot.denied)return <div className="standalone-state"><Alert variant="destructive"><AlertTitle>{t('authRequired')}</AlertTitle></Alert></div>;
 if(!snapshot.session)return <div className="standalone-state">{snapshot.error?<PageFailure error={snapshot.error} runtime={runtime}/>:<Loading/>}</div>;
 const Page=pages[route.input.view],ref=route.input.view==='request'?route.input.request_ref:undefined;
 const legacyRef=location.pathname==='/'&&route.input.view==='request'?ref:null;
 return <SessionProvider session={snapshot.session} status={status} key={snapshot.session.recovery_scope}><CommandProvider><Shell>{Boolean(snapshot.error)&&<div className="session-warning"><PageFailure error={snapshot.error} runtime={runtime}/></div>}{!routeReady?snapshot.error?null:<Loading/>:legacyRef?<Navigate replace to={'/requests/'+encodeURIComponent(legacyRef)}/>:<Suspense fallback={<Loading/>}><div key={snapshot.membershipRevision} data-h5-ready={snapshot.ready&&!checking&&!snapshot.error?route.input.view:undefined} data-h5-checking={String(checking)} data-h5-write-ready={String(status.writeReady)} data-request-ref={ref}><Page/></div></Suspense>}</Shell></CommandProvider></SessionProvider>;
}
export default function App({runtime}:{runtime:PageRuntime}){
 const{i18n}=useTranslation();
 useEffect(()=>followClientPreferences(language=>{if(i18n.language!==language)void i18n.changeLanguage(language);document.documentElement.lang=language;}),[i18n]);
 return <HashRouter><Navigation runtime={runtime}/></HashRouter>;
}
