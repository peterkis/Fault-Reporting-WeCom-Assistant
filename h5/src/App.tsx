import{useEffect,useRef,useState}from'react';
import{HashRouter,Route,Routes,Navigate}from'react-router';
import{useQuery,useQueryClient}from'@tanstack/react-query';
import{useTranslation}from'react-i18next';
import{api,authLost,ApiError}from'./api/client';
import{SessionContext}from'./session';
import{CommandProvider}from'./hooks/useCommand';
import{Shell,Loading,ErrorPanel}from'./components/Common';
import{Alert,AlertTitle,AlertDescription}from'./components/ui/primitives';
import{followClientPreferences}from'./lib/preferences';
import Home from'./pages/Home';
import Report from'./pages/Report';
import Reports from'./pages/Reports';
import Detail from'./pages/Detail';
import Department from'./pages/Department';
function LegacyEntry(){const params=new URLSearchParams(location.search);const ref=params.get('request_ref');return ref?<Navigate replace to={'/requests/'+encodeURIComponent(ref)}/>:<Home/>;}
export default function App(){
 const{t,i18n}=useTranslation(),client=useQueryClient();const[denied,setDenied]=useState(false);const previous=useRef<string|null>(null);
 const bootstrap=useQuery({queryKey:['bootstrap'],queryFn:({signal})=>api.bootstrap(signal),enabled:!denied,staleTime:0});
 useEffect(()=>followClientPreferences(language=>{if(i18n.language!==language)void i18n.changeLanguage(language);document.documentElement.lang=language;}),[i18n]);
 useEffect(()=>{const lost=()=>{setDenied(true);void client.cancelQueries();client.clear();};authLost.addEventListener('lost',lost);return()=>authLost.removeEventListener('lost',lost);},[client]);
 useEffect(()=>{const scope=bootstrap.data?.recovery_scope;if(!scope)return;if(previous.current&&previous.current!==scope){void client.cancelQueries({predicate:query=>query.queryKey[0]!=='bootstrap'});client.removeQueries({predicate:query=>query.queryKey[0]!=='bootstrap'});}previous.current=scope;},[bootstrap.data?.recovery_scope,client]);
 useEffect(()=>{const check=()=>{if(document.visibilityState==='visible'&&!denied)void bootstrap.refetch();};document.addEventListener('visibilitychange',check);window.addEventListener('pageshow',check);return()=>{document.removeEventListener('visibilitychange',check);window.removeEventListener('pageshow',check);};},[denied,bootstrap.refetch]);
 if(denied||(bootstrap.error instanceof ApiError&&[401,403].includes(bootstrap.error.status)))return <div className="standalone-state"><Alert variant="destructive"><AlertTitle>{t('authRequired')}</AlertTitle></Alert></div>;
 if(bootstrap.isPending)return <div className="standalone-state"><Loading/></div>;
 if(bootstrap.isError&&!bootstrap.data)return <div className="standalone-state"><ErrorPanel error={bootstrap.error} retry={()=>void bootstrap.refetch()}/></div>;
 if(!bootstrap.data?.h5)return <div className="standalone-state"><Alert><AlertDescription>{t('notAvailable')}</AlertDescription></Alert></div>;
 const session=bootstrap.isError?{...bootstrap.data,can_submit:false,can_supplement:false,h5:{...bootstrap.data.h5,can_upload:false,can_urge:false,can_evaluate:false}}:bootstrap.data;
 return <SessionContext.Provider value={session} key={bootstrap.data.recovery_scope}><CommandProvider><HashRouter><Shell>{bootstrap.isError&&<div className="session-warning"><ErrorPanel error={bootstrap.error} retry={()=>void bootstrap.refetch()}/></div>}<Routes><Route path="/" element={<LegacyEntry/>}/><Route path="/report" element={<Report/>}/><Route path="/reports" element={<Reports/>}/><Route path="/requests/:requestRef" element={<Detail/>}/><Route path="/department" element={<Department/>}/><Route path="*" element={<Navigate replace to="/"/>}/></Routes></Shell></HashRouter></CommandProvider></SessionContext.Provider>;
}
