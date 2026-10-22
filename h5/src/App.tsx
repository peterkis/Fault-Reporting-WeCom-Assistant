import{lazy,Suspense,useEffect,useLayoutEffect,useMemo,useSyncExternalStore}from'react';
import{HashRouter,useLocation,Navigate,Routes,Route}from'./navigation';
import{useTranslation}from"./i18n-react";
import{SessionProvider,type SessionStatus}from'./session';
import{CommandProvider}from'./hooks/useCommand';
import{Shell,Loading}from'./components/AppShell';
import{followClientPreferences}from'./lib/preferences';
import{describeRoute,pages}from'./routing';
import type{PageRuntime}from'./page-runtime';
const PageFailure=lazy(()=>import('./components/PageFailure'));
const AuthState=lazy(()=>import('./components/AuthState'));
function PageRoutes(){return <Routes><Route caseSensitive path="/" element={<pages.home/>}/><Route caseSensitive path="/report" element={<pages.report/>}/><Route caseSensitive path="/reports" element={<pages.reports/>}/><Route caseSensitive path="/requests/:requestRef" element={<pages.request/>}/><Route caseSensitive path="/department" element={<pages.department/>}/><Route path="*" element={<Navigate to="/" replace/>}/></Routes>;}
function Navigation({runtime}:{runtime:PageRuntime}){
 const location=useLocation();const snapshot=useSyncExternalStore(runtime.subscribe,runtime.getSnapshot,runtime.getSnapshot);
 const route=useMemo(()=>describeRoute(location.pathname,location.search),[location.pathname,location.search]);
 useLayoutEffect(()=>{void runtime.navigate(route).catch(()=>undefined);},[runtime,route]);
 useEffect(()=>{if(snapshot.session&&!snapshot.expired&&!snapshot.denied&&new URLSearchParams(window.location.search).get('auth_return')==='1'){const url=new URL(window.location.href);url.searchParams.delete('auth_return');window.history.replaceState(window.history.state,'',url.href);}},[snapshot.session,snapshot.expired,snapshot.denied]);
 const cached=runtime.canUseCached(route),checking=snapshot.checking&&!cached||snapshot.route.key!==route.key&&!cached,routeReady=snapshot.ready&&snapshot.route.key===route.key||cached;
 const status=useMemo<SessionStatus>(()=>({checking,writeReady:!checking&&snapshot.ready&&!snapshot.error&&!snapshot.denied,membershipRevision:snapshot.membershipRevision,refresh:runtime.refresh}),[checking,snapshot.ready,snapshot.error,snapshot.denied,snapshot.membershipRevision,runtime]);
 if(snapshot.denied||snapshot.expired)return <Suspense fallback={<div className="standalone-state"><Loading/></div>}><AuthState expired={snapshot.expired} blocked={snapshot.recoveryBlocked} returnTo={route.input.view==='request'?'/requests/'+encodeURIComponent(route.input.request_ref):location.pathname+location.search}/></Suspense>;
 if(!snapshot.session)return <div className="standalone-state">{snapshot.error?<Suspense fallback={<Loading/>}><PageFailure error={snapshot.error} runtime={runtime}/></Suspense>:<Loading/>}</div>;
 const ref=route.input.view==='request'?route.input.request_ref:undefined;
 const legacyRef=location.pathname==='/'&&route.input.view==='request'?ref:null;
 return <SessionProvider session={snapshot.session} status={status} key={snapshot.session.recovery_scope}><CommandProvider><Shell>{Boolean(snapshot.error)&&<div className="session-warning"><Suspense fallback={<Loading/>}><PageFailure error={snapshot.error} runtime={runtime}/></Suspense></div>}{!routeReady?snapshot.error?null:<Loading/>:legacyRef?<Navigate replace to={'/requests/'+encodeURIComponent(legacyRef)}/>:<Suspense fallback={<Loading/>}><div key={snapshot.membershipRevision} data-h5-ready={routeReady&&!checking&&!snapshot.error?route.input.view:undefined} data-h5-checking={String(checking)} data-h5-write-ready={String(status.writeReady)} data-request-ref={ref}><PageRoutes/></div></Suspense>}</Shell></CommandProvider></SessionProvider>;
}
export default function App({runtime}:{runtime:PageRuntime}){
 const{i18n}=useTranslation();
 useEffect(()=>followClientPreferences(language=>{if(i18n.language!==language)void i18n.changeLanguage(language);document.documentElement.lang=language;}),[i18n]);
 return <HashRouter><Navigation runtime={runtime}/></HashRouter>;
}
