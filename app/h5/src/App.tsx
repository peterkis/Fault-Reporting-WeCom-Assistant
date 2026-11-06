import {lazy,Suspense,useCallback,useDeferredValue,useEffect,useLayoutEffect,useMemo,useRef,useState,useSyncExternalStore,type ReactNode} from 'react';
import {useNavigationType} from 'react-router';
import {HashRouter,useLocation,Navigate,Routes,Route} from './navigation';
import {useTranslation} from './i18n-react';
import {SessionProvider,useSessionStatus,type SessionStatus} from './session';
import {CommandProvider} from './hooks/useCommand';
import {Shell,Loading} from './components/AppShell';
import {LoadingProgress} from './components/LoadingProgress';
import {followClientPreferences} from './lib/preferences';
import {canReconnectAutomatically,reconnect} from './lib/reauth';
import {hasProtectedInput} from './lib/reload';
import {describeRoute,loginReturnPath,pages,type PageRoute} from './routing';
import type {PageRuntime} from './page-runtime';
const PageFailure=lazy(()=>import('./components/PageFailure'));
const AuthState=lazy(()=>import('./components/AuthState'));
function PageRoutes({reportsSearch}:{reportsSearch:string|null}){return <Routes><Route caseSensitive path="/" element={<pages.home/>}/><Route caseSensitive path="/report" element={<pages.report/>}/><Route caseSensitive path="/reports" element={<pages.reports {...(reportsSearch===null?{}:{targetSearch:reportsSearch})}/>}/><Route caseSensitive path="/requests/:requestRef" element={<pages.request/>}/><Route caseSensitive path="/department" element={<pages.department/>}/><Route path="*" element={<Navigate to="/" replace/>}/></Routes>;}
const viewIdentity=(scope:string,revision:string,route:PageRoute)=>JSON.stringify([scope,revision,route.key]);
function PresentedPage({route,identity,onPresented,reportsSearch}:{route:PageRoute;identity:string;onPresented:(identity:string)=>void;reportsSearch:string|null}){
 const status=useSessionStatus();
 useLayoutEffect(()=>{onPresented(identity);},[identity,onPresented]);
 return <div aria-busy={status.checking} data-h5-ready={status.writeReady?route.input.view:undefined} data-h5-checking={String(status.checking)} data-h5-write-ready={String(status.writeReady)} data-request-ref={route.input.view==='request'?route.input.request_ref:undefined}><PageRoutes reportsSearch={reportsSearch}/></div>;
}
function PagePresentation({route,scope,revision,onPresented,notice,reportsSearch}:{route:PageRoute|null;scope:string;revision:string;onPresented:(identity:string)=>void;notice:ReactNode;reportsSearch:string|null}){
 const displayed=useDeferredValue(route,null);
 // Authorization loss is urgent: never retain a deferred route across a cleared view.
 return <Suspense fallback={null}>{route&&displayed?<Routes location={displayed.path}><Route path="*" element={<Shell>{notice}<PresentedPage route={displayed} identity={viewIdentity(scope,revision,displayed)} onPresented={onPresented} reportsSearch={reportsSearch}/></Shell>}/></Routes>:null}</Suspense>;
}
function Navigation({runtime,embedded}:{runtime:PageRuntime;embedded:boolean}){
 const location=useLocation(),navigationType=useNavigationType(),snapshot=useSyncExternalStore(runtime.subscribe,runtime.getSnapshot,runtime.getSnapshot);
 const route=useMemo(()=>describeRoute(location.pathname,location.search),[location.pathname,location.search]);
 const [presented,setPresented]=useState<string|null>(null),[authAttempt,setAuthAttempt]=useState<'idle'|'redirecting'|'blocked'>('idle');
 const onPresented=useCallback((identity:string)=>setPresented(identity),[]);
 const scroll=useRef<{positions:Map<string,number>;key:string|null;identity:string|null;frame:number}>({positions:new Map(),key:null,identity:null,frame:0});
 useLayoutEffect(()=>{
  const state=scroll.current;if(state.frame){cancelAnimationFrame(state.frame);state.frame=0;}if(state.key!==null)state.positions.set(state.key,window.scrollY);
 },[location.key]);
 useLayoutEffect(()=>{
  if(!snapshot.session||presented!==viewIdentity(snapshot.session.recovery_scope,snapshot.membershipRevision,route))return;
  const state=scroll.current,identity=JSON.stringify([route.input.view,route.input.view==='request'?route.input.request_ref:null]);
  if(state.frame){cancelAnimationFrame(state.frame);state.frame=0;}
  if(state.identity!==identity)window.scrollTo(0,navigationType==='POP'?state.positions.get(location.key)??0:0);
  state.key=location.key;state.identity=identity;state.positions.set(location.key,window.scrollY);
 },[presented,location.key,navigationType,route,snapshot.session,snapshot.membershipRevision]);
 useEffect(()=>{
  const state=scroll.current,save=()=>{if(state.frame)return;const key=state.key;state.frame=requestAnimationFrame(()=>{state.frame=0;if(key!==null&&key===state.key)state.positions.set(key,window.scrollY);});};
  window.addEventListener('scroll',save,{passive:true});return()=>{window.removeEventListener('scroll',save);if(state.frame)cancelAnimationFrame(state.frame);};
 },[]);
 const returnTo=loginReturnPath(route);
 const automatic=embedded&&snapshot.expired&&!snapshot.recoveryBlocked&&!hasProtectedInput()&&canReconnectAutomatically()&&authAttempt!=='blocked';
 const silent=snapshot.expired&&(automatic||authAttempt==='redirecting');
 useLayoutEffect(()=>{if(embedded)void runtime.navigate(route).catch(()=>undefined);},[runtime,route,embedded]);
 useEffect(()=>{if(automatic&&authAttempt==='idle')setAuthAttempt(reconnect(returnTo,{automatic:true,blocked:snapshot.recoveryBlocked})?'redirecting':'blocked');},[automatic,authAttempt,returnTo,snapshot.recoveryBlocked]);
 useEffect(()=>{
  if(snapshot.session&&!snapshot.expired&&!snapshot.denied){
   if(authAttempt!=='idle')setAuthAttempt('idle');
   if(new URLSearchParams(window.location.search).get('auth_return')==='1'){const url=new URL(window.location.href);url.searchParams.delete('auth_return');window.history.replaceState(window.history.state,'',url.href);}
  }
 },[snapshot.session,snapshot.expired,snapshot.denied,authAttempt]);
 const checking=snapshot.checking||snapshot.route.key!==route.key||!snapshot.session||presented!==viewIdentity(snapshot.session.recovery_scope,snapshot.membershipRevision,route);
 const status=useMemo<SessionStatus>(()=>({checking,writeReady:!checking&&snapshot.ready&&!snapshot.error&&!snapshot.denied&&!snapshot.expired,membershipRevision:snapshot.membershipRevision,refresh:runtime.refresh}),[checking,snapshot.ready,snapshot.error,snapshot.denied,snapshot.expired,snapshot.membershipRevision,runtime]);
 const terminal=!embedded||snapshot.denied||snapshot.expired&&!silent;
 let content:ReactNode=null;
 if(terminal)content=<Suspense fallback={null}><AuthState external={!embedded} expired={snapshot.expired} blocked={snapshot.recoveryBlocked} returnTo={returnTo}/></Suspense>;
 else if(snapshot.session){
  const legacyRef=location.pathname==='/'&&route.input.view==='request'?route.input.request_ref:null;
  const notice=snapshot.error?<div className="session-warning"><Suspense fallback={<Loading/>}><PageFailure error={snapshot.error} runtime={runtime}/></Suspense></div>:null;
  content=<SessionProvider session={snapshot.session} status={status} key={snapshot.session.recovery_scope}><CommandProvider>{legacyRef?<Navigate replace to={'/requests/'+encodeURIComponent(legacyRef)}/>:<PagePresentation key={snapshot.membershipRevision} route={snapshot.displayRoute} scope={snapshot.session.recovery_scope} revision={snapshot.membershipRevision} onPresented={onPresented} reportsSearch={route.input.view==='reports'?location.search:null} notice={notice}/>}</CommandProvider></SessionProvider>;
 }else if(snapshot.error)content=<div className="standalone-state"><Suspense fallback={null}><PageFailure error={snapshot.error} runtime={runtime}/></Suspense></div>;
 return <><LoadingProgress active={embedded&&!terminal&&!snapshot.error&&(silent||checking)}/>{content}</>;
}
export default function App({runtime,embedded=true}:{runtime:PageRuntime;embedded?:boolean}){
 const{i18n}=useTranslation();
 useLayoutEffect(()=>{const previous=history.scrollRestoration;history.scrollRestoration='manual';return()=>{history.scrollRestoration=previous;};},[]);
 useEffect(()=>followClientPreferences(language=>{if(i18n.language!==language)void i18n.changeLanguage(language);document.documentElement.lang=language;}),[i18n]);
 return <HashRouter><Navigation runtime={runtime} embedded={embedded}/></HashRouter>;
}
