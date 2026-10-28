import {Component,Suspense,lazy,useEffect,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {Route,Routes} from 'react-router';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Button} from '@heroui/react/button';
import {Link as HLink} from '@heroui/react/link';
import {WorkbenchLink as Link} from './WorkbenchLink';
import {api,errorMessage} from '../api/client';
import {clearSessionAuthorization} from './authorization';
import {useUiStore} from './ui-store';
import {desktopHost} from '../desktop/host';
import {useWorkbenchRealtime} from '../realtime/useRealtime';
import {useManualReportAuthority} from '../features/manual-report/use-manual-report-draft';
import {WorkbenchLoading} from './WorkbenchLoading';

// Start UI loading immediately; Session can validate identity while this module downloads.
const workbenchModule=import('./Workbench');
const WorkbenchPage=lazy(()=>workbenchModule.then(module=>({default:module.WorkbenchPage})));
// A failed preload is presented by the boundary when the authenticated view mounts.
void workbenchModule.catch(()=>{});
function Message({text,retry}:{text:string;retry?:()=>void}){
  return <div className="state-message" role="status"><p>{text}</p>{retry?<Button variant="secondary" onPress={retry}>重新读取</Button>:null}</div>;
}
class WorkbenchLoadBoundary extends Component<{children:ReactNode},{failed:boolean}>{
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?<div className="entry-state"><h1>医小修工作台</h1><Message text="工作台界面加载未完成，请重新打开。" retry={()=>location.reload()}/></div>:this.props.children;}
}
function ExpiredDesktopSession(){
  const client=useQueryClient(),requested=useRef(false);
  useEffect(()=>{
    let active=true;
    // Mount after the old business view unmounts, so its beforeunload guards are released.
    void clearSessionAuthorization(client,undefined,401,'revoked').then(async()=>{
      if(!active||!desktopHost||useUiStore.getState().sessionError!==401)return;
      await desktopHost.updateContext({epoch:null,blocked:false,live:false,remindersAvailable:false});
      if(!active||requested.current||useUiStore.getState().sessionError!==401)return;
      requested.current=true;await desktopHost.requestLogin();
    }).catch(()=>{if(active)useUiStore.getState().closeSession('自动打开扫码登录未完成，请重新进入企业微信登录。');});
    return()=>{active=false;};
  },[client]);
  return <div className="entry-state" role="status">正在打开企业微信扫码登录…</div>;
}
function Session(){const failure=useUiStore(s=>s.sessionError),closedNotice=useUiStore(s=>s.sessionClosedNotice),reset=useUiStore(s=>s.reset);
  const [navigationBlocked,setNavigationBlocked]=useState(false);
  const bootstrap=useQuery({queryKey:['session'],queryFn:({signal})=>api.bootstrap(signal),enabled:failure===null&&closedNotice===null});
  const realtime=useWorkbenchRealtime(failure===null&&closedNotice===null?bootstrap.data:undefined);
  useManualReportAuthority(failure===null&&closedNotice===null?bootstrap.data:undefined);
  if(closedNotice)return <div className="entry-state"><h1>医小修工作台</h1><Message text={closedNotice} retry={reset}/><HLink href={desktopHost?"/workbench/desktop":"/workbench"}>{desktopHost?"重新扫码登录":"返回现有工作台入口"}</HLink></div>;
  if(desktopHost&&failure===401)return <ExpiredDesktopSession/>;
  if(failure)return <div className="entry-state"><h1>医小修工作台</h1><Message text={failure===401?'会话已失效，请重新进入已授权工作台。':'当前身份没有查看权限。'} retry={reset}/><HLink href={desktopHost?"/workbench/desktop":"/workbench"}>{desktopHost?"重新扫码登录":"返回现有工作台入口"}</HLink></div>;
  if(bootstrap.isPending)return <WorkbenchLoading/>;
  if(bootstrap.isError&&!bootstrap.data)return <div className="entry-state"><h1>医小修工作台</h1><Message text={errorMessage(bootstrap.error)} retry={()=>{void bootstrap.refetch();}}/><HLink href={desktopHost?"/workbench/desktop":"/workbench"}>{desktopHost?"重新扫码登录":"返回现有工作台入口"}</HLink></div>;
  return <WorkbenchLoadBoundary><Suspense fallback={<WorkbenchLoading/>}><WorkbenchPage principal={bootstrap.data} realtime={realtime} navigationBlocked={navigationBlocked} setNavigationBlocked={setNavigationBlocked}/></Suspense></WorkbenchLoadBoundary>;
}
export function App(){return <Routes><Route path="/" element={<Session/>}/><Route path="items/:kind/:id" element={<Session/>}/><Route path="settings/source-groups" element={<Session/>}/><Route path="reports/new" element={<Session/>}/><Route path="notification-exceptions" element={<Session/>}/><Route path="conversations" element={<Session/>}/><Route path="conversations/:sessionId" element={<Session/>}/><Route path="incidents/candidates" element={<Session/>}/><Route path="incidents/candidates/:id" element={<Session/>}/><Route path="incidents/:id" element={<Session/>}/><Route path="*" element={<div className="entry-state"><Message text="页面不存在。"/><Link to="/">返回工作台</Link></div>}/></Routes>;}
