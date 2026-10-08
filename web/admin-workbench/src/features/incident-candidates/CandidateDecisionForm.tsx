import {useEffect,useRef,useState} from 'react';
import {useMutation,useQueryClient} from '@tanstack/react-query';
import {Link} from 'react-router';
import {api,ApiError,errorMessage} from '../../api/client';
import type {Principal} from '../../api/client';
import {candidateApi,CandidateCommandRefusal} from './client';
import type {CandidateAction,CandidateDetail,CandidateOperation,CandidateReason,CandidateCommandResult,IncidentScope} from './client';
import {IncidentResultView} from './IncidentResult';
import './candidate.css';

export interface CandidateDecisionValue {action:CandidateAction|'';reason:CandidateReason|'';scope:IncidentScope|'';owner:string;team:string;refs:string[];primary:string;capture:{version:string;basis:string|null}|null}
export const emptyCandidateDecision:CandidateDecisionValue={action:'',reason:'',scope:'',owner:'',team:'',refs:[],primary:'',capture:null};
export const candidateHasInput=(value:CandidateDecisionValue)=>Boolean(value.action||value.reason||value.scope||value.owner||value.team||value.refs.length||value.primary||value.capture);
const actionNames={START_REVIEW:'开始复核',REJECT_CANDIDATE:'拒绝候选',CONFIRM_INCIDENT:'人工确认公共故障'};
const reasonNames={OPERATOR_REVIEWED:'已由工作人员核对',INCORRECT_ASSOCIATION:'来源关联不正确',CONFIRMED_SHARED_FAULT:'确认共同故障'};
const scopeNames={LOCAL:'局部',BUILDING:'楼宇',CAMPUS:'院区',HOSPITAL_WIDE:'全院'};
type State='idle'|'submitting'|'checking'|'unknown'|'failed'|'denied'|'committed';
function refusalMessage(error:ApiError){if(error.code==='P2_012_SOURCE_CONFLICT')return '原材料依据已变化或过期；输入已保留，请核对当前事实。';if(error.code==='P2_012_OWNER_INVALID')return '负责人或责任组已失效；输入已保留，请重新核对。';return errorMessage(error);}

export function CandidateDecisionForm({principal,detail,onBlockedChange,onRefresh}:{principal:Principal;detail:CandidateDetail;onBlockedChange:(blocked:boolean)=>void;onRefresh:()=>void}){
  const client=useQueryClient(),request=useRef<AbortController|null>(null),[value,setValue]=useState<CandidateDecisionValue>(emptyCandidateDecision),latest=useRef(value);latest.current=value;
  const [pending,setPending]=useState<CandidateOperation|null>(null),[state,setState]=useState<State>('idle'),[message,setMessage]=useState(''),[reviewRequired,setReviewRequired]=useState(false),[known,setKnown]=useState<CandidateCommandResult|null>(null);
  const active=state==='submitting'||state==='checking',unknown=state==='unknown',purposeAllowed=detail.allowed_scopes.length>0;
  const navigationBlocked=active||unknown||candidateHasInput(value);
  useEffect(()=>{onBlockedChange(navigationBlocked);return()=>onBlockedChange(false);},[navigationBlocked,onBlockedChange]);
  useEffect(()=>()=>{request.current?.abort();},[]);
  useEffect(()=>{if(!purposeAllowed){request.current?.abort();setValue(emptyCandidateDecision);setPending(null);setState('idle');setMessage('');}},[purposeAllowed]);
  useEffect(()=>{
    if(!navigationBlocked)return;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();};
    const location=window.location.href,historyState:unknown=window.history.state;
    const back=(event:PopStateEvent)=>{event.stopImmediatePropagation();window.history.pushState(historyState,'',location);};
    window.addEventListener('beforeunload',warn);window.addEventListener('popstate',back,{capture:true});
    return()=>{window.removeEventListener('beforeunload',warn);window.removeEventListener('popstate',back,{capture:true});};
  },[navigationBlocked]);
  const refresh=()=>{onRefresh();void client.invalidateQueries({queryKey:['incident-candidates',principal.principal_id]});};
  const update=(change:Partial<CandidateDecisionValue>|((current:CandidateDecisionValue)=>Partial<CandidateDecisionValue>))=>setValue(current=>({...current,...(typeof change==='function'?change(current):change),capture:current.capture??{version:detail.row_version,basis:detail.material_basis}}));
  const applyCommit=(result:CandidateCommandResult,snapshot:string)=>{
    setKnown(result);setPending(null);setState('committed');setMessage(result.result_ref_type==='INCIDENT'?'公共故障已确认；将独立核对当前获权结果。':'候选决定已提交；请核对当前状态。');
    setValue(current=>JSON.stringify(current)===snapshot?emptyCandidateDecision:current);setReviewRequired(JSON.stringify(latest.current)!==snapshot);refresh();
  };
  const mutation=useMutation({mutationKey:['incident-candidate-command',principal.principal_id,detail.id],
    mutationFn:({operation,signal}:{operation:CandidateOperation;snapshot:string;signal:AbortSignal})=>candidateApi.perform(operation,principal.csrf_token,signal),
    onSuccess:(result,variables)=>applyCommit(result,variables.snapshot),
    onError:(error,variables)=>{
      if(error instanceof CandidateCommandRefusal){setPending(null);setState('failed');setReviewRequired(true);setMessage('原操作已明确失败：'+refusalMessage(error));refresh();}
      else if(error instanceof ApiError&&[401,403,404].includes(error.status)){setState('denied');setMessage('当前操作权限已变化，请重新核对。');refresh();}
      else{setPending(variables.operation);setState('unknown');setMessage('结果未知：原 UUID、版本、材料依据和正文保持不变，请先只读核对。');}
    },onSettled:()=>{request.current=null;}});
  const receipt=useMutation({mutationKey:['incident-candidate-receipt',principal.principal_id,detail.id],mutationFn:({operation,signal}:{operation:CandidateOperation;signal:AbortSignal})=>candidateApi.receipt(detail.id,operation.body.client_command_id,signal),
    onSuccess:result=>{
      if(result.state==='UNKNOWN'){setState('unknown');setMessage('结果仍未知：没有终态回执不代表未提交；尚未发送新的操作。');return;}
      setPending(null);setReviewRequired(true);refresh();
      if(result.state==='COMMITTED'){setKnown(result.result);setState('committed');setMessage('原操作已确认提交；当前输入保留，请核对当前事实。');}
      else{setState('failed');setMessage('原操作已明确失败；当前输入保留，请核对当前事实后再明确新的决定。');}
    },onError:()=>{setState('unknown');setMessage('只读核对未能完成，原操作仍未知；尚未发送新的操作。');},onSettled:()=>{request.current=null;}});
  const owner=detail.eligible_owners.find(owner=>owner.id===value.owner),teamValid=value.team==='NONE'||Boolean(owner?.teams.some(team=>team.team_id===value.team)),sources=new Map(detail.report_sources.map(source=>[source.source_decision_id,source]));
  const primaryOptions=[...new Map(value.refs.flatMap(ref=>{const source=sources.get(ref);return source?.ticket_id?[[source.ticket_id,{id:source.ticket_id,label:source.ticket_no??'当前编号不可用'}] as const]:[];})).values()];
  const currentCapture=Boolean(value.capture&&value.capture.version===detail.row_version),confirm=value.action==='CONFIRM_INCIDENT';
  const canConfirm=Boolean(detail.material_basis&&value.capture?.basis===detail.material_basis&&detail.materials.every(material=>material.status==='CURRENT')&&value.scope&&detail.allowed_scopes.includes(value.scope)&&owner&&value.team&&teamValid&&value.refs.length&&value.refs.every(ref=>sources.has(ref))&&value.primary&&(value.primary==='NONE'||primaryOptions.some(ticket=>ticket.id===value.primary)));
  const canSubmit=Boolean(value.action&&value.reason&&detail.allowed_actions.includes(value.action)&&currentCapture&&!reviewRequired&&!active&&!pending&&(!confirm||canConfirm));
  const send=async(operation:CandidateOperation,snapshot:string)=>{
    if(request.current)return;
    const controller=new AbortController();request.current=controller;setPending(operation);setState('submitting');setMessage('正在核对当前权限并提交明确决定…');
    try{
      const fresh=await api.bootstrap(controller.signal);if(fresh.principal_id!==principal.principal_id||!fresh.incident_candidate_workspace_enabled)throw new ApiError(403,'AUTHORIZATION_REJECTED');
      const current=await candidateApi.detail(detail.id,controller.signal);
      if(current.allowed_scopes.length===0||(operation.action==='CONFIRM_INCIDENT'&&!current.allowed_scopes.includes(operation.body.confirmed_scope)))throw new ApiError(403,'AUTHORIZATION_REJECTED');
      if(!current.allowed_actions.includes(operation.action))throw new ApiError(409,operation.action==='CONFIRM_INCIDENT'&&current.materials.some(material=>material.status!=='CURRENT')?'P2_012_SOURCE_CONFLICT':'P2_012_STATE_CONFLICT');
      // Fresh authorization never replaces the captured body or version.
      if(controller.signal.aborted)return;
      mutation.mutate({operation,snapshot,signal:controller.signal});
    }catch(error){request.current=null;setPending(null);setState('denied');setReviewRequired(true);setMessage('尚未发送：'+(error instanceof ApiError?refusalMessage(error):errorMessage(error)));refresh();}
  };
  const submit=()=>{
    if(!canSubmit||!value.action||!value.reason||!value.capture)return;
    const common={client_command_id:crypto.randomUUID(),reason_code:value.reason};let operation:CandidateOperation;
    if(value.action==='CONFIRM_INCIDENT'){
      if(!value.scope||!value.capture.basis)return;
      operation=Object.freeze({candidateId:detail.id,action:value.action,body:Object.freeze({...common,expected_candidate_version:value.capture.version,expected_material_basis:value.capture.basis,confirmed_scope:value.scope,owner_principal_id:value.owner,owner_team_id:value.team==='NONE'?null:value.team,selected_report_refs:Object.freeze([...value.refs]),primary_ticket_id:value.primary==='NONE'?null:value.primary})});
    }else operation=Object.freeze({candidateId:detail.id,action:value.action,body:Object.freeze({...common,expected_row_version:value.capture.version})});
    void send(operation,JSON.stringify(value));
  };
  const check=()=>{if(!pending||request.current)return;const controller=new AbortController();request.current=controller;setState('checking');setMessage('正在只读核对原操作…');receipt.mutate({operation:pending,signal:controller.signal});};
  return <section className="candidate-decision" aria-label="人工候选决定">
    {purposeAllowed?<form onSubmit={event=>{event.preventDefault();submit();}}><h2>人工决定</h2><p>各项由工作人员明确选择；刷新只更新当前事实，已捕获的决定依据保持不变。</p>
      <div className="candidate-form-grid"><label>人工决定<select aria-label="人工决定" value={value.action} onChange={event=>update({action:event.target.value as CandidateAction|''})}><option value="">请选择决定</option>{Object.entries(actionNames).map(([action,label])=><option key={action} value={action} disabled={!detail.allowed_actions.includes(action as CandidateAction)}>{label}{detail.allowed_actions.includes(action as CandidateAction)?'':'（当前不可用）'}</option>)}</select></label>
      <label>决定原因<select aria-label="决定原因" value={value.reason} onChange={event=>update({reason:event.target.value as CandidateReason|''})}><option value="">请选择原因</option>{Object.entries(reasonNames).map(([reason,label])=><option key={reason} value={reason}>{label}</option>)}</select></label></div>
      {value.capture?<p data-captured-basis>已捕获候选版本 {value.capture.version}；当前候选版本 {detail.row_version}。{confirm?'已捕获材料依据：'+(value.capture.basis??'不可用'):''}</p>:null}
      {confirm?<><div className="candidate-form-grid"><label>确认范围<select aria-label="确认范围" value={value.scope} onChange={event=>update({scope:event.target.value as IncidentScope|''})}><option value="">请选择范围</option>{value.scope&&!detail.allowed_scopes.includes(value.scope)?<option value={value.scope}>原选择当前不可用</option>:null}{detail.allowed_scopes.map(scope=><option key={scope} value={scope}>{scopeNames[scope]}</option>)}</select></label>
        <label>故障负责人<select aria-label="故障负责人" value={value.owner} onChange={event=>update({owner:event.target.value})}><option value="">请选择负责人</option>{value.owner&&!owner?<option value={value.owner}>原负责人当前不可用</option>:null}{detail.eligible_owners.map(owner=><option key={owner.id} value={owner.id}>{owner.display_name}</option>)}</select></label>
        <label>责任组<select aria-label="责任组" value={value.team} onChange={event=>update({team:event.target.value})}><option value="">请选择责任组或无责任组</option><option value="NONE">无责任组</option>{value.team&&!teamValid?<option value={value.team}>原责任组当前不可用</option>:null}{owner?.teams.map(team=><option key={team.team_id} value={team.team_id}>{team.display_name}</option>)}</select></label>
        <label>主工单<select aria-label="主工单" value={value.primary} onChange={event=>update({primary:event.target.value})}><option value="">请选择主工单或无主工单</option><option value="NONE">无主工单</option>{value.primary&&value.primary!=='NONE'&&!primaryOptions.some(ticket=>ticket.id===value.primary)?<option value={value.primary}>原主工单不在当前有效选择中</option>:null}{primaryOptions.map(ticket=><option key={ticket.id} value={ticket.id}>{ticket.label}</option>)}</select></label></div>
        <fieldset><legend>逐项选择关联报修来源</legend><p>获权来源总数：{detail.visible_report_source_count}；已提供选项：{detail.report_sources.length}；当前选择 {value.refs.length} 项 Report，涉及 {primaryOptions.length} 个个人工单。</p>{detail.report_sources.map((source,index)=><label className="candidate-report-choice" key={source.source_decision_id}><input type="checkbox" data-report-ref={source.source_decision_id} checked={value.refs.includes(source.source_decision_id)} onChange={event=>{const checked=event.target.checked;update(current=>({refs:checked?current.refs.includes(source.source_decision_id)?current.refs:[...current.refs,source.source_decision_id]:current.refs.filter(ref=>ref!==source.source_decision_id)}));}}/><span>{index+1}. {source.ticket_no??'未建单来源'} · 独立报修引用</span></label>)}{value.refs.some(ref=>!sources.has(ref))?<p role="alert">已有选择当前不可读取或未提供；没有自动替换或删除原选择，请重新核对。</p>:null}</fieldset>
        {detail.report_sources_truncated||detail.eligible_owners_truncated||owner?.teams_truncated?<p>部分选项已裁剪，仅能选择当前已提供的获权对象。</p>:null}
        {!detail.materials.every(material=>material.status==='CURRENT')?<p role="alert">原依据已有新材料或过期，不能确认；可重新核对或明确拒绝此候选。</p>:null}
      </>:null}
      <div className="note-controls"><button type="submit" data-action="submit-candidate" disabled={!canSubmit}>{active?'正在核对…':'提交明确决定'}</button>
        {!pending&&candidateHasInput(value)?<button type="button" data-action="adopt-candidate-basis" disabled={active} onClick={()=>{setValue(current=>({...current,capture:{version:detail.row_version,basis:detail.material_basis}}));setReviewRequired(false);}}>明确采用当前依据</button>:null}
        {!pending&&candidateHasInput(value)?<button type="button" data-action="clear-candidate-input" disabled={active} onClick={()=>{setValue(emptyCandidateDecision);setReviewRequired(false);}}>清除当前输入</button>:null}
        {pending?<button type="button" data-action="check-candidate-operation" disabled={active} onClick={check}>只读核对原操作</button>:null}
      </div>
    </form>:<p>当前可读取候选，没有人工决定权限。</p>}
    {message?<p role={state==='unknown'||state==='failed'||state==='denied'?'alert':'status'} data-candidate-outcome>{message}</p>:null}
    {known?.result_ref_type==='INCIDENT'?<div data-result-ref={known.result_ref_id}><p>原确认结果已提交。<Link to={'/incidents/'+known.result_ref_id} onClick={event=>{if(navigationBlocked)event.preventDefault();}}>打开独立公共故障页面</Link></p><IncidentResultView principal={principal} incidentId={known.result_ref_id} authorityRevision={detail.allowed_scopes.join(',')}/></div>:null}
  </section>;
}
