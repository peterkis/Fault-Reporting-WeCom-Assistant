import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Link,useParams} from 'react-router';
import type {Principal} from '../../api/client';
import {api,ApiError,captureWorkbenchRead,errorMessage,workbenchTransportWritable} from '../../api/client';
import {clearSessionAuthorization} from '../../app/authorization';
import {candidateApi,incidentApi,IncidentCommandRefusal} from './client';
import type {IncidentInvestigationCommand,IncidentResult} from './client';
import './candidate.css';

const hasInvestigationRole=(roles:readonly string[])=>roles.some(role=>role==='ADMIN'||role==='DISPATCHER');
const canInvestigate=(result:IncidentResult)=>hasInvestigationRole(result.roles)&&['CONFIRMED_LOCAL','CONFIRMED_BUILDING','CONFIRMED_CAMPUS','CONFIRMED_HOSPITAL_WIDE'].includes(result.status);
// Installed before BrowserRouter, so a POP cannot discard an in-flight intent.
let retainedIncidentNavigation:{location:string;state:unknown}|null=null;
window.addEventListener('popstate',event=>{const retained=retainedIncidentNavigation;if(!retained)return;event.stopImmediatePropagation();window.history.pushState(retained.state,'',retained.location);},{capture:true});

export function IncidentResultPage({principal,onBlockedChange}:{principal:Principal;onBlockedChange:(blocked:boolean)=>void}){
  const {id=''}=useParams();
  if(!principal.incident_candidate_workspace_enabled)return <div className="workspace"><h1>公共故障</h1><p role="status">候选工作区尚未启用。</p><a href="/workbench">返回现有工作台</a></div>;
  return <IncidentInvestigation key={principal.principal_id+':'+id} principal={principal} incidentId={id} onBlockedChange={onBlockedChange}/>;
}
function IncidentInvestigation({principal,incidentId,onBlockedChange}:{principal:Principal;incidentId:string;onBlockedChange:(blocked:boolean)=>void}){
  const client=useQueryClient(),queryKey=['incident-result',principal.principal_id,incidentId,'standalone'];
  const query=useQuery({queryKey,queryFn:({signal})=>candidateApi.incident(incidentId,signal)}),detail=query.data;
  const request=useRef<AbortController|null>(null),knownCommit=useRef(false);
  const [action,setAction]=useState<''|'START_INVESTIGATING'>(''),[reason,setReason]=useState<''|'OPERATOR_REVIEWED'>(''),[capturedVersion,setCapturedVersion]=useState<string|null>(null);
  const [pending,setPending]=useState<IncidentInvestigationCommand|null>(null),[state,setState]=useState<'idle'|'preparing'|'submitting'|'unknown'|'failed'|'committed'|'denied'>('idle'),[message,setMessage]=useState(''),[reviewRequired,setReviewRequired]=useState(false);
  const busy=state==='preparing'||state==='submitting',unknown=state==='unknown',hasInput=Boolean(action||reason||capturedVersion),blocked=busy||unknown||hasInput;
  const readDenied=query.error instanceof ApiError&&[401,403,404].includes(query.error.status);
  const purposeAllowed=hasInvestigationRole(principal.roles)&&(!detail||hasInvestigationRole(detail.roles));
  const allowed=Boolean(detail&&purposeAllowed&&canInvestigate(detail)),readReady=Boolean(detail&&!query.isFetching&&!query.isError);
  useEffect(()=>{onBlockedChange(blocked);return()=>onBlockedChange(false);},[blocked,onBlockedChange]);
  useEffect(()=>()=>{request.current?.abort();request.current=null;},[]);
  useEffect(()=>{
    if(!readDenied&&purposeAllowed)return;
    request.current?.abort();request.current=null;setAction('');setReason('');setCapturedVersion(null);setPending(null);setReviewRequired(false);setState(knownCommit.current?'committed':'denied');setMessage(knownCommit.current?'开始调查已提交；当前读取或操作权限已变化，原输入已停止展示。':'当前调查权限不可用；原输入已停止展示。');
  },[readDenied,purposeAllowed]);
  useEffect(()=>{
    if(!blocked)return;
    const warn=(event:BeforeUnloadEvent)=>event.preventDefault(),retained={location:window.location.href,state:window.history.state as unknown};
    retainedIncidentNavigation=retained;window.addEventListener('beforeunload',warn);
    return()=>{window.removeEventListener('beforeunload',warn);if(retainedIncidentNavigation===retained)retainedIncidentNavigation=null;};
  },[blocked]);
  const canSubmit=readReady&&allowed&&action==='START_INVESTIGATING'&&reason==='OPERATOR_REVIEWED'&&capturedVersion===detail?.row_version&&!busy&&!unknown&&!pending&&!reviewRequired&&state!=='committed'&&workbenchTransportWritable()&&navigator.onLine;
  const refresh=()=>{void query.refetch();};
  const submit=async()=>{
    if(!canSubmit||!capturedVersion||request.current)return;
    const command:IncidentInvestigationCommand=Object.freeze({client_command_id:crypto.randomUUID(),expected_row_version:capturedVersion,reason_code:'OPERATOR_REVIEWED'});
    const controller=new AbortController(),requireCurrent=captureWorkbenchRead(controller.signal);request.current=controller;
    const current=()=>{requireCurrent();if(request.current!==controller)throw new DOMException('REPLACED_INCIDENT_REQUEST','AbortError');};
    setPending(command);setState('preparing');setMessage('正在核对当前权限和公共故障版本…');
    let sent=false;
    try{
      const fresh=await api.bootstrap(controller.signal);current();
      if(fresh.principal_id!==principal.principal_id){await clearSessionAuthorization(client,principal.principal_id,401,'revoked');return;}
      client.setQueryData(['session'],fresh);
      if(!fresh.incident_candidate_workspace_enabled||!hasInvestigationRole(fresh.roles))throw new ApiError(403,'AUTHORIZATION_REJECTED');
      const incident=await candidateApi.incident(incidentId,controller.signal);current();
      if(!hasInvestigationRole(incident.roles))throw new ApiError(403,'AUTHORIZATION_REJECTED');
      client.setQueryData(queryKey,incident);
      if(!canInvestigate(incident))throw new ApiError(409,'P2_012_STATE_CONFLICT');
      if(incident.row_version!==command.expected_row_version)throw new ApiError(409,'P2_012_VERSION_CONFLICT');
      if(!workbenchTransportWritable()||!navigator.onLine)throw new ApiError(503,'WORKBENCH_OFFLINE');
      current();sent=true;setState('submitting');setMessage('正在提交开始调查…');
      await incidentApi.startInvestigation(incidentId,command,fresh.csrf_token,controller.signal);current();
      // Only the exact command ACK settles the intent; a detail GET cannot.
      knownCommit.current=true;
      setPending(null);setAction('');setReason('');setCapturedVersion(null);setReviewRequired(false);setState('committed');setMessage('开始调查已提交；正在重新读取当前事实。个人工单仍保持各自状态与责任，提交不代表通知已送达。');
      // A failed refresh must not turn a known commit back into UNKNOWN.
      void client.invalidateQueries({queryKey:['incident-result',principal.principal_id,incidentId]});
    }catch(error){
      if(request.current!==controller||controller.signal.aborted)return;
      try{requireCurrent();}catch{
        setState(sent?'unknown':'failed');setReviewRequired(true);if(!sent)setPending(null);
        setMessage(sent?'授权上下文已更新，原操作结果仍未知；原 UUID、版本和正文保留，不能发起新操作。':'当前授权上下文已更新，尚未发送；请重新读取并核对。');return;
      }
      if(error instanceof ApiError&&[401,403,404].includes(error.status)){
        setAction('');setReason('');setCapturedVersion(null);setPending(null);setState('denied');setMessage('当前权限已变化；原输入已停止展示。');
        if(error.status===401)await clearSessionAuthorization(client,principal.principal_id,401,'revoked');else refresh();
      }else if(!sent||error instanceof IncidentCommandRefusal){
        setPending(null);setState('failed');setReviewRequired(true);setMessage((sent?'原操作已明确失败：':'尚未发送：')+errorMessage(error)+' 输入保留，请重新核对当前事实。');refresh();
      }else{
        setState('unknown');setMessage('结果未知：原 UUID、父版本和正文保留。读取当前状态不能确认本次操作结果，请保持此页；尚未开放原操作回执核对，不能重复提交。');
      }
    }finally{if(request.current===controller)request.current=null;}
  };
  // A bootstrap role reduction must not display the older broad detail while it refreshes.
  const showDetail=Boolean(detail&&!readDenied&&(hasInvestigationRole(principal.roles)||!hasInvestigationRole(detail.roles)));
  return <article className="detail-page">
    <div className="detail-navigation"><Link to="/incidents/candidates" aria-disabled={blocked} onClick={event=>{if(blocked)event.preventDefault();}}>返回候选队列</Link><button type="button" data-action="refresh-incident" disabled={busy} onClick={refresh}>刷新当前事实</button></div>
    <div className="detail-body">
      {query.isPending?<p role="status">正在读取当前获权的公共故障…</p>:null}
      {query.isError?<p role="alert">{errorMessage(query.error)} {state==='committed'?'开始调查的已知提交结果仍保留。':'输入及未知结果不会由读取失败改写。'}</p>:null}
      {showDetail&&detail?<IncidentResultFacts result={detail}/>:null}
      {detail&&purposeAllowed&&!readDenied?<section className="candidate-decision" aria-label="公共故障跟进"><h2>跟进公共故障</h2>
        <form onSubmit={event=>{event.preventDefault();void submit();}}>
          <div className="candidate-form-grid">
            <label>公共故障操作<select aria-label="公共故障操作" value={action} disabled={busy||unknown||state==='committed'||!readReady} onChange={event=>{setAction(event.target.value==='START_INVESTIGATING'?'START_INVESTIGATING':'');setCapturedVersion(current=>current??detail.row_version);}}><option value="">请选择操作</option><option value="START_INVESTIGATING" disabled={!allowed}>开始调查{allowed?'':'（当前不可用）'}</option></select></label>
            <label>决定原因<select aria-label="决定原因" value={reason} disabled={busy||unknown||state==='committed'||!readReady} onChange={event=>{setReason(event.target.value==='OPERATOR_REVIEWED'?'OPERATOR_REVIEWED':'');setCapturedVersion(current=>current??detail.row_version);}}><option value="">请选择原因</option><option value="OPERATOR_REVIEWED">已由工作人员核对</option></select></label>
          </div>
          {capturedVersion?<p>已捕获公共故障版本 {capturedVersion}；当前版本 {detail.row_version}。{capturedVersion!==detail.row_version?'当前事实已变化，需要明确采用当前版本。':''}</p>:null}
          <div className="note-controls"><button type="submit" data-action="submit-incident" disabled={!canSubmit}>{busy?'正在处理…':'提交明确操作'}</button>
            {hasInput&&!pending&&!busy&&state!=='committed'?<><button type="button" data-action="adopt-incident-version" disabled={!readReady||!allowed} onClick={()=>{setCapturedVersion(detail.row_version);setReviewRequired(false);setState('idle');setMessage('已明确采用当前公共故障版本；请核对选择后提交。');}}>明确采用当前版本</button><button type="button" data-action="clear-incident-input" onClick={()=>{setAction('');setReason('');setCapturedVersion(null);setReviewRequired(false);setState('idle');setMessage('当前未提交输入已清除。');}}>清除当前输入</button></>:null}
          </div>
        </form>
      </section>:null}
      {message?<p role={state==='failed'||state==='unknown'||state==='denied'?'alert':'status'} data-incident-outcome>{message}</p>:null}
      {pending&&unknown?<p data-incident-unknown>原操作 UUID：{pending.client_command_id}；原父版本：{pending.expected_row_version}。此页未保存跨刷新恢复副本；离开提示不会核对或重发操作。</p>:null}
    </div>
  </article>;
}
export function IncidentResultView({principal,incidentId,authorityRevision='standalone'}:{principal:Principal;incidentId:string;authorityRevision?:string}){
  const query=useQuery({queryKey:['incident-result',principal.principal_id,incidentId,authorityRevision],queryFn:({signal})=>candidateApi.incident(incidentId,signal)});
  if(query.isPending)return <p role="status">正在独立读取当前获权的公共故障…</p>;
  if(query.isError)return <section aria-label="公共故障读取结果"><p role="alert">{errorMessage(query.error)} 已知确认结果仍保留；这里仅显示当前获权事实。</p><button type="button" onClick={()=>{void query.refetch();}}>重新读取公共故障</button></section>;
  return <IncidentResultFacts result={query.data}/>;
}
function IncidentResultFacts({result}:{result:IncidentResult}){
  return <section className="properties" aria-label="当前公共故障" data-incident-id={result.id}>
    <h2>{result.incident_no} · {result.safe_title}</h2><dl><dt>状态</dt><dd>{result.status}</dd><dt>确认范围</dt><dd>{result.confirmed_scope}</dd><dt>公共故障版本</dt><dd>{result.row_version}</dd><dt>确认时间</dt><dd>{result.confirmed_at}（北京时间）</dd>
      {result.owner_principal_id!==undefined?<><dt>故障负责人</dt><dd>{result.owner_display_name??'当前姓名不可用'}</dd><dt>责任组</dt><dd>{result.owner_team_id??'未设责任组'}</dd><dt>主处理参考</dt><dd>{result.primary_ticket_id===null?'无主工单':result.primary_ticket_no??'当前编号不可用'}</dd></>:null}
    </dl><p>这是独立 Incident 的当前投影；个人工单仍保持各自的状态与责任，确认不代表通知已发送。</p>
  </section>;
}
