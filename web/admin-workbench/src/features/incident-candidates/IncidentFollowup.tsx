import {useEffect,useRef,useState} from 'react';
import {useInfiniteQuery,useQuery,useQueryClient} from '@tanstack/react-query';
import {Link} from 'react-router';
import type {Principal} from '../../api/client';
import {api,ApiError,captureWorkbenchRead,errorMessage,workbenchTransportWritable} from '../../api/client';
import {clearSessionAuthorization} from '../../app/authorization';
import {candidateApi,incidentApi,incidentActions,incidentScopes,candidateReasons,IncidentCommandRefusal,decodeIncidentOperation,incidentRoleAllowed} from './client';
import type {IncidentAction,IncidentOperation,IncidentResult,IncidentChildPage,IncidentReportItem,IncidentSubscriptionItem} from './client';
import {IncidentResultFacts} from './IncidentResult';
import {useIncidentDraft} from './use-incident-draft';
import type {IncidentDraftValue} from './use-incident-draft';

const broad=(roles:readonly string[])=>roles.some(role=>role==='ADMIN'||role==='DISPATCHER');
const admin=(roles:readonly string[])=>roles.includes('ADMIN');
const labels:Record<IncidentAction,string>={START_INVESTIGATING:'开始调查',CORRECT_SCOPE:'纠正确认范围',SET_PRIMARY_TICKET:'设置或清除主工单',LINK_REPORT:'关联个人报修',UNLINK_REPORT:'解除报修关联',MARK_REPORTER_RECOVERED:'记录单人恢复',PAUSE_SUBSCRIPTION:'暂停通知订阅',RESUME_SUBSCRIPTION:'恢复通知订阅',RESOLVE_INCIDENT:'记录公共故障恢复',CLOSE_INCIDENT:'关闭公共故障'};
const unavailable=(error:unknown)=>error instanceof ApiError&&[401,403,404].includes(error.status);
function actionAllowed(action:IncidentAction,result:IncidentResult){
  if(result.status==='CLOSED')return false;
  if(action==='MARK_REPORTER_RECOVERED')return broad(result.roles)||result.roles.includes('HANDLER');
  if(!broad(result.roles))return false;
  if(['CORRECT_SCOPE','PAUSE_SUBSCRIPTION','RESUME_SUBSCRIPTION','CLOSE_INCIDENT'].includes(action)&&!admin(result.roles))return false;
  if(action==='START_INVESTIGATING')return result.status.startsWith('CONFIRMED_');
  if(action==='RESOLVE_INCIDENT')return result.status==='INVESTIGATING';
  if(action==='CLOSE_INCIDENT')return result.status==='RESOLVED';
  return action!=='LINK_REPORT'||result.status!=='RESOLVED';
}
let retainedNavigation:{location:string;state:unknown}|null=null;
window.addEventListener('popstate',event=>{const retained=retainedNavigation;if(!retained)return;event.stopImmediatePropagation();window.history.pushState(retained.state,'',retained.location);},{capture:true});

function usePart<T>(principal:Principal,incidentId:string,part:string,enabled:boolean,read:(id:string,cursor:string|null,signal:AbortSignal)=>Promise<IncidentChildPage<T>>){
  const client=useQueryClient(),key=['incident-children',principal.principal_id,incidentId,part];
  const query=useInfiniteQuery({queryKey:key,enabled,queryFn:({pageParam,signal})=>read(incidentId,pageParam,signal),initialPageParam:null as string|null,getPreviousPageParam:()=>undefined,getNextPageParam:page=>page.next_cursor??undefined,maxPages:3});
  const items=query.data?.pages.flatMap(page=>page.items)??[];
  return {...query,items,restart:()=>client.resetQueries({queryKey:key,exact:true})};
}
function PageControls({title,count,current,more,busy,next,restart}:{title:string;count:number;current:number;more:boolean;busy:boolean;next:()=>void;restart:()=>void}){
  return <div className="note-controls"><p>{title}：当前页 {current} 项；已加载窗口 {count} 项（最近最多三页，每页30）。</p><button type="button" disabled={busy||!more} onClick={next}>下一页{title}</button><button type="button" disabled={busy} onClick={restart}>回到{title}起点</button></div>;
}

export function IncidentFollowup({principal,incidentId,onBlockedChange}:{principal:Principal;incidentId:string;onBlockedChange:(blocked:boolean)=>void}){
  const client=useQueryClient(),queryKey=['incident-result',principal.principal_id,incidentId,'standalone'];
  const query=useQuery({queryKey,queryFn:({signal})=>candidateApi.incident(incidentId,signal)}),detail=query.data;
  const readable=Boolean(detail&&!unavailable(query.error)),wide=readable&&broad(principal.roles)&&broad(detail?.roles??[]);
  const reports=usePart(principal,incidentId,'reports',readable,incidentApi.reports),subscriptions=usePart(principal,incidentId,'subscriptions',wide,incidentApi.subscriptions),linkable=usePart(principal,incidentId,'linkable-reports',wide,incidentApi.linkable);
  const request=useRef<AbortController|null>(null),knownCommit=useRef(false);
  const [action,setAction]=useState<IncidentAction|''>(''),[reason,setReason]=useState(''),[capturedVersion,setCapturedVersion]=useState<string|null>(null);
  const [scope,setScope]=useState(''),[primary,setPrimary]=useState(''),[source,setSource]=useState(''),[report,setReport]=useState<IncidentReportItem|null>(null),[subscription,setSubscription]=useState<IncidentSubscriptionItem|null>(null);
  const [pending,setPending]=useState<IncidentOperation|null>(null),[state,setState]=useState<'idle'|'preparing'|'submitting'|'checking'|'unknown'|'failed'|'committed'|'denied'>('idle'),[message,setMessage]=useState(''),[reviewRequired,setReviewRequired]=useState(false),[checkedUnknown,setCheckedUnknown]=useState(false);
  const busy=state==='preparing'||state==='submitting'||state==='checking',unknown=state==='unknown',hasInput=Boolean(action||reason||capturedVersion),blocked=busy||unknown||hasInput;
  const selectedTicket=report?.ticket_id??null;
  const assignee=useQuery({queryKey:['incident-report-assignee',principal.principal_id,incidentId,selectedTicket],enabled:Boolean(readable&&action==='MARK_REPORTER_RECOVERED'&&!wide&&selectedTicket),queryFn:({signal})=>incidentApi.ticketAssignee(selectedTicket??'',signal)});
  const readDenied=unavailable(query.error)||unavailable(reports.error),purposeDenied=Boolean(detail&&action&&(!incidentRoleAllowed(action,principal.roles)||!incidentRoleAllowed(action,detail.roles)));
  const readReady=Boolean(detail&&!query.isFetching&&!query.isError&&reports.isSuccess&&(!wide||(subscriptions.isSuccess&&linkable.isSuccess)));
  const allowed=Boolean(detail&&action&&actionAllowed(action,detail)&&!purposeDenied);
  const required=action==='CORRECT_SCOPE'?Boolean(scope):action==='SET_PRIMARY_TICKET'?Boolean(primary):action==='LINK_REPORT'?Boolean(source):action==='UNLINK_REPORT'||action==='MARK_REPORTER_RECOVERED'?Boolean(report&&report.link_state==='LINKED'&&(wide||assignee.data===principal.principal_id)):action==='PAUSE_SUBSCRIPTION'||action==='RESUME_SUBSCRIPTION'?Boolean(subscription&&subscription.status!=='ENDED'):true;
  const clearInput=()=>{setAction('');setReason('');setCapturedVersion(null);setScope('');setPrimary('');setSource('');setReport(null);setSubscription(null);setReviewRequired(false);};
  const emptyValue:IncidentDraftValue={action:'',reason:'',capturedVersion:null,scope:'',primary:'',source:'',report:null,subscription:null};
  const draft=useIncidentDraft({principal,incidentId,value:{action,reason,capturedVersion,scope,primary,source,report,subscription},pending,emptyValue,onRestore:copy=>{const v=copy.value;setAction(v.action);setReason(v.reason);setCapturedVersion(v.capturedVersion);setScope(v.scope);setPrimary(v.primary);setSource(v.source);setReport(v.report);setSubscription(v.subscription);setPending(copy.pending);if(copy.pending){setState('unknown');setMessage('原操作结果未知；原 UUID、正文和捕获版本已恢复，不会自动发送。');}},onOperation:()=>{setState('unknown');setMessage('原操作仍未知；完整敏感正文不可用，只能只读核对。');},onSensitiveClear:()=>{clearInput();setPending(null);setCheckedUnknown(false);}});
  const originalId=pending?.body.client_command_id??draft.operationId;
  const canSubmit=readReady&&allowed&&Boolean(reason)&&required&&(action!=='START_INVESTIGATING'||reason==='OPERATOR_REVIEWED')&&capturedVersion===detail?.row_version&&!busy&&!unknown&&!pending&&!originalId&&!reviewRequired&&state!=='committed'&&draft.canSubmit&&!draft.restoring&&workbenchTransportWritable()&&navigator.onLine;
  useEffect(()=>{onBlockedChange(blocked);return()=>onBlockedChange(false);},[blocked,onBlockedChange]);
  useEffect(()=>()=>{request.current?.abort();request.current=null;},[]);
  useEffect(()=>{if(!readDenied&&!purposeDenied)return;request.current?.abort();request.current=null;clearInput();setPending(null);setState(knownCommit.current?'committed':'denied');setMessage(knownCommit.current?'原操作已提交；当前权限已变化，原输入已停止展示。':'当前操作权限不可用；原输入已停止展示。');},[readDenied,purposeDenied]);
  useEffect(()=>{if(!blocked)return;const warn=(event:BeforeUnloadEvent)=>event.preventDefault(),retained={location:window.location.href,state:window.history.state as unknown};retainedNavigation=retained;window.addEventListener('beforeunload',warn);return()=>{window.removeEventListener('beforeunload',warn);if(retainedNavigation===retained)retainedNavigation=null;};},[blocked]);
  const capture=()=>{if(detail)setCapturedVersion(current=>current??detail.row_version);};
  const refresh=()=>{void query.refetch();void reports.refetch();if(wide){void subscriptions.refetch();void linkable.refetch();}if(selectedTicket&&!wide)void assignee.refetch();};
  function operation():IncidentOperation{
    if(!action||!capturedVersion)throw new ApiError(400,'INVALID_INPUT');
    const base={client_command_id:crypto.randomUUID(),expected_row_version:capturedVersion,reason_code:reason};
    const extra=action==='CORRECT_SCOPE'?{confirmed_scope:scope}:action==='SET_PRIMARY_TICKET'?{primary_ticket_id:primary==='NONE'?null:primary}:action==='LINK_REPORT'?{source_decision_id:source}:action==='UNLINK_REPORT'||action==='MARK_REPORTER_RECOVERED'?{expected_report_version:report?.row_version}:action==='PAUSE_SUBSCRIPTION'||action==='RESUME_SUBSCRIPTION'?{expected_subscription_version:subscription?.row_version}:{};
    return decodeIncidentOperation({incidentId,action,body:{...base,...extra},...(action==='UNLINK_REPORT'||action==='MARK_REPORTER_RECOVERED'?{reportId:report?.id}:{}),...(action==='PAUSE_SUBSCRIPTION'||action==='RESUME_SUBSCRIPTION'?{subscriptionId:subscription?.id}:{})});
  }
  const send=async(command:IncidentOperation,replay=false)=>{
    if(request.current)return;
    const controller=new AbortController(),requireCurrent=captureWorkbenchRead(controller.signal);request.current=controller;
    const current=()=>{requireCurrent();if(request.current!==controller)throw new DOMException('REPLACED_INCIDENT_REQUEST','AbortError');};
    setPending(command);setState('preparing');setMessage('正在核对当前权限和公共故障版本…');let sent=false;
    try{
      if(!replay)await draft.prepare(command);current();
      const fresh=await api.bootstrap(controller.signal);current();
      if(fresh.principal_id!==principal.principal_id){await clearSessionAuthorization(client,principal.principal_id,401,'revoked');return;}
      client.setQueryData(['session'],fresh);
      if(!fresh.incident_candidate_workspace_enabled)throw new ApiError(403,'AUTHORIZATION_REJECTED');
      const incident=await candidateApi.incident(incidentId,controller.signal);current();client.setQueryData(queryKey,incident);
      if(!actionAllowed(command.action,incident)||!actionAllowed(command.action,{...incident,roles:fresh.roles}))throw new ApiError(403,'AUTHORIZATION_REJECTED');
      if(incident.row_version!==command.body.expected_row_version)throw new ApiError(409,'P2_012_VERSION_CONFLICT');
      if(command.action==='MARK_REPORTER_RECOVERED'&&!broad(fresh.roles)){
        if(!selectedTicket||await incidentApi.ticketAssignee(selectedTicket,controller.signal)!==fresh.principal_id)throw new ApiError(403,'AUTHORIZATION_REJECTED');current();
      }
      if(!workbenchTransportWritable()||!navigator.onLine)throw new ApiError(503,'WORKBENCH_OFFLINE');
      current();sent=true;setState('submitting');setMessage('正在提交'+labels[command.action]+'…');
      await incidentApi.perform(command,fresh.csrf_token,controller.signal);current();knownCommit.current=true;const cleaned=await draft.success(command.body.client_command_id);current();setPending(null);clearInput();setState('committed');setMessage(labels[command.action]+'已提交；正在重新读取当前事实。个人工单仍保持各自状态与责任，提交不代表通知已送达。'+(cleaned?'':'恢复副本清理失败；已知提交保持，原 UUID 保留，禁止新提交，请只读核对并重试清理。'));
      void client.invalidateQueries({queryKey:['incident-result',principal.principal_id,incidentId]});void client.invalidateQueries({queryKey:['incident-children',principal.principal_id,incidentId]});
    }catch(error){
      if(request.current!==controller||controller.signal.aborted)return;
      try{requireCurrent();}catch{setState(sent?'unknown':'failed');setReviewRequired(true);if(!sent)setPending(null);setMessage(sent?'授权上下文已更新，原操作结果仍未知；原 UUID、版本和正文保留，不能发起新操作。':'当前授权上下文已更新，尚未发送；请重新读取并核对。');return;}
      if(unavailable(error)){clearInput();setPending(null);setState('denied');setMessage('当前权限已变化；原输入已停止展示。');if(error instanceof ApiError&&error.status===401)await clearSessionAuthorization(client,principal.principal_id,401,'revoked');else refresh();}
      else if(!sent&&replay){setState('unknown');setMessage('尚未重放；原操作结果仍未知、UUID 和正文保持，请再次只读核对。');}
      else if(!sent||error instanceof IncidentCommandRefusal){let cleaned=true;try{await draft.knownFailure(command.body.client_command_id);}catch{cleaned=false;}setPending(null);setState('failed');setReviewRequired(true);setMessage((sent?'原操作已明确失败：':'尚未发送：')+errorMessage(error)+' 输入保留，请重新核对当前事实。'+(cleaned?'':'恢复副本清理失败；原 UUID 保留，禁止新提交。'));refresh();}
      else{setState('unknown');setMessage('结果未知：原 UUID、父子版本和正文保留。当前状态读取不能确认原操作结果；请核对原操作，不能重复提交。');}
    }finally{if(request.current===controller)request.current=null;}
  };
  const submit=()=>{if(canSubmit&&!request.current)void send(operation());};
  const check=async()=>{if(!originalId||request.current)return;const controller=new AbortController(),current=captureWorkbenchRead(controller.signal);request.current=controller;setState('checking');try{const receipt=await incidentApi.receipt(incidentId,originalId,controller.signal);current();if(request.current!==controller)return;if(receipt.state==='UNKNOWN'){setCheckedUnknown(true);setState('unknown');setMessage('原操作仍未知；没有终态回执不代表未提交，没有发送新操作。');return;}let cleaned=true;if(receipt.state==='COMMITTED'){knownCommit.current=true;cleaned=await draft.success(originalId);}else try{await draft.knownFailure(originalId);}catch{cleaned=false;}current();setPending(null);setCheckedUnknown(false);if(receipt.state==='COMMITTED'){clearInput();setState('committed');setMessage('原操作已确认提交；个人工单保持独立，通知送达仍按各路结果。'+(cleaned?'':'恢复副本清理失败，原 UUID 保留，禁止新提交。'));}else{setState('failed');setReviewRequired(true);setMessage('原操作已明确失败；输入保留，请核对当前事实。'+(cleaned?'':'恢复副本清理失败，原 UUID 保留，禁止新提交。'));}refresh();}catch(error){if(controller.signal.aborted||request.current!==controller)return;try{current();}catch{return;}if(unavailable(error)){draft.revoke(error);clearInput();setPending(null);setState('denied');setMessage('当前原动作用途权限已变化，恢复内容停止展示。');}else{setState(knownCommit.current?'committed':'unknown');setMessage(knownCommit.current?'已知提交保留；本次核对未能完成。':'只读核对未能完成，原操作仍未知，没有发送新操作。');}}finally{if(request.current===controller)request.current=null;}};
  const showDetail=Boolean(detail&&!readDenied&&(broad(principal.roles)||!broad(detail.roles))),locked=busy||unknown||Boolean(originalId)||state==='committed'||draft.restoring||!readReady;
  const page=(title:string,part:{items:unknown[];data:{pages:Array<{items:unknown[]}>}|undefined;hasNextPage:boolean;isFetching:boolean;fetchNextPage:()=>unknown;restart:()=>unknown})=><PageControls title={title} count={part.items.length} current={part.data?.pages.at(-1)?.items.length??0} more={part.hasNextPage} busy={part.isFetching||busy} next={()=>{void part.fetchNextPage();}} restart={()=>{void part.restart();}}/>;
  return <article className="detail-page"><div className="detail-navigation"><Link to="/incidents/candidates" aria-disabled={blocked} onClick={event=>{if(blocked)event.preventDefault();}}>返回候选队列</Link><button type="button" data-action="refresh-incident" disabled={state==='preparing'||state==='submitting'} onClick={refresh}>刷新当前事实</button></div><div className="detail-body">
    {!readReady&&!readDenied&&!query.isError?<p role="status">正在读取当前获权的公共故障及关联窗口…</p>:null}
    {query.isError?<p role="alert">{errorMessage(query.error)} 已知结果和原输入不会由读取失败改写。</p>:null}
    {showDetail&&detail&&readReady?<IncidentResultFacts result={detail}/>:null}
    {showDetail&&detail?<section className="candidate-decision" aria-label="公共故障跟进"><h2>跟进公共故障</h2>{draft.enabled?<p data-incident-draft>{draft.message}</p>:null}<form onSubmit={event=>{event.preventDefault();submit();}}><div className="candidate-form-grid">
      <label>公共故障操作<select aria-label="公共故障操作" value={action} disabled={locked} onChange={event=>{setAction(incidentActions.find(value=>value===event.target.value)??'');capture();}}><option value="">请选择操作</option>{incidentActions.map(value=><option key={value} value={value} disabled={!actionAllowed(value,{...detail,roles:principal.roles})||!actionAllowed(value,detail)}>{labels[value]}</option>)}</select></label>
      <label>决定原因<select aria-label="决定原因" value={reason} disabled={locked} onChange={event=>{setReason(event.target.value);capture();}}><option value="">请选择原因</option>{candidateReasons.map(value=><option key={value} value={value}>{value}</option>)}</select></label>
      {action==='CORRECT_SCOPE'?<label>确认范围<select aria-label="确认范围" value={scope} disabled={locked} onChange={event=>{setScope(event.target.value);capture();}}><option value="">请选择范围</option>{incidentScopes.map(value=><option key={value} value={value}>{value}</option>)}</select></label>:null}
      {action==='SET_PRIMARY_TICKET'?<label>主工单<select aria-label="主工单" value={primary} disabled={locked} onChange={event=>{setPrimary(event.target.value);capture();}}><option value="">请选择主工单或无主工单</option><option value="NONE">无主工单</option>{reports.items.filter(item=>item.link_state==='LINKED'&&item.ticket_id).map(item=><option key={item.id} value={item.ticket_id??''}>{item.ticket_no??item.ticket_id}</option>)}</select></label>:null}
      {action==='LINK_REPORT'?<label>报修来源<select aria-label="报修来源" value={source} disabled={locked} onChange={event=>{setSource(event.target.value);capture();}}><option value="">请选择真实来源</option>{linkable.items.map(item=><option key={item.id} value={item.source_decision_id}>{item.ticket_no}</option>)}</select></label>:null}
      {action==='UNLINK_REPORT'||action==='MARK_REPORTER_RECOVERED'?<label>关联报修<select aria-label="关联报修" value={report?.id??''} disabled={locked} onChange={event=>{setReport(reports.items.find(item=>item.id===event.target.value)??null);capture();}}><option value="">请选择个人报修</option>{report&&!reports.items.some(item=>item.id===report.id)?<option value={report.id}>{report.ticket_no??report.id}（保留原选择）</option>:null}{reports.items.filter(item=>item.link_state==='LINKED').map(item=><option key={item.id} value={item.id}>{item.ticket_no??item.id}</option>)}</select>{report?<span>捕获报修版本 {report.row_version}；当前页缺席不代表失权。</span>:null}{!wide&&report?<span>{assignee.data===principal.principal_id?'当前本人负责，可明确记录单人恢复。':'仅当前本人负责的个人工单可记录恢复。'}</span>:null}</label>:null}
      {action==='PAUSE_SUBSCRIPTION'||action==='RESUME_SUBSCRIPTION'?<label>通知订阅<select aria-label="通知订阅" value={subscription?.id??''} disabled={locked} onChange={event=>{setSubscription(subscriptions.items.find(item=>item.id===event.target.value)??null);capture();}}><option value="">请选择订阅</option>{subscription&&!subscriptions.items.some(item=>item.id===subscription.id)?<option value={subscription.id}>{subscription.id}（保留原选择）</option>:null}{subscriptions.items.filter(item=>item.status!=='ENDED').map(item=><option key={item.id} value={item.id}>{item.id} · {item.status}</option>)}</select>{subscription?<span>捕获订阅版本 {subscription.row_version}。</span>:null}</label>:null}
    </div>{capturedVersion?<p>已捕获公共故障版本 {capturedVersion}；当前版本 {detail.row_version}。{capturedVersion!==detail.row_version?'当前事实已变化，需要明确采用当前版本。':''}</p>:null}<div className="note-controls"><button type="submit" data-action="submit-incident" disabled={!canSubmit}>{busy?'正在处理…':'提交明确操作'}</button>{hasInput&&!pending&&!busy&&state!=='committed'?<><button type="button" data-action="adopt-incident-version" disabled={!readReady||!allowed} onClick={()=>{setCapturedVersion(detail.row_version);setReviewRequired(false);setState('idle');setMessage('已明确采用当前公共故障版本；原子目标版本与输入保留，请核对后提交。');}}>明确采用当前版本</button><button type="button" data-action="clear-incident-input" onClick={()=>{clearInput();setState('idle');setMessage('当前未提交输入已清除。');}}>清除当前输入</button></>:null}</div></form></section>:null}
    {message?<p role={state==='failed'||state==='unknown'||state==='denied'?'alert':'status'} data-incident-outcome>{message}</p>:null}
    {originalId&&unknown?<p data-incident-unknown>原操作 UUID：{originalId}；原父版本：{pending?.body.expected_row_version??'敏感正文不可用'}。{draft.enabled?'恢复副本仅在当前浏览器保留。':'此页未保存跨刷新恢复副本。'}读取不会核对或重发操作。</p>:null}
    {originalId?<button type="button" data-action="check-incident-operation" disabled={busy||draft.restoring} onClick={()=>{void check();}}>只读核对原操作</button>:null}
    {pending&&checkedUnknown&&unknown?<button type="button" data-action="replay-incident-operation" disabled={busy||draft.restoring} onClick={()=>{void send(pending,true);}}>明确重放原操作（原 UUID 和正文）</button>:null}
    {draft.enabled&&hasInput?<button type="button" data-action="discard-incident-draft" disabled={busy||draft.restoring} onClick={()=>{void draft.discard();}}>丢弃敏感恢复内容</button>:null}
    {showDetail?<section aria-label="关联个人报修"><h2>关联个人报修</h2>{reports.isError?<p role="alert">{errorMessage(reports.error)}</p>:null}<ul>{reports.items.map(item=><li key={item.id}>{item.ticket_no??'无个人工单'} · {item.link_state} · {item.impact_state} · 版本 {item.row_version}</li>)}</ul>{page('报修',reports)}</section>:null}
    {showDetail&&wide?<><section aria-label="通知订阅窗口"><h2>各人通知订阅</h2><ul>{subscriptions.items.map(item=><li key={item.id}>{item.id} · {item.status} · {item.impact_state} · 版本 {item.row_version}</li>)}</ul>{page('订阅',subscriptions)}</section><section aria-label="可关联来源窗口"><h2>可关联报修来源</h2><ul>{linkable.items.map(item=><li key={item.id}>{item.ticket_no}</li>)}</ul>{page('来源',linkable)}</section></>:null}
  </div></article>;
}
