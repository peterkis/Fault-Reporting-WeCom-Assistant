import {WorkbenchLink as Link} from '../../app/WorkbenchLink';
import {WorkbenchButton as HButton} from '../../app/WorkbenchButton';
import {Checkbox as HCheckbox,Fieldset as HFieldset,Form as HForm,ListBox} from "@heroui/react";
import {WorkbenchSelect} from "../../app/WorkbenchSelect";
import {ToastFeedback,DraftStatus,useFeedbackState} from '../../app/ToastFeedback';
import {useEffect,useRef,useState} from 'react';
import {useMutation,useQueryClient} from '@tanstack/react-query';

import {api,ApiError,errorMessage} from '../../api/client';
import type {Principal} from '../../api/client';
import {candidateApi,CandidateCommandRefusal} from './client';
import type {CandidateAction,CandidateDetail,CandidateOperation,CandidateReason,CandidateCommandResult,IncidentScope} from './client';
import {IncidentResultView} from './IncidentResult';
import {useCandidateDraft} from './use-candidate-draft';
import './candidate.css';

export interface CandidateDecisionValue {action:CandidateAction|'';reason:CandidateReason|'';scope:IncidentScope|'';owner:string;team:string;refs:string[];primary:string;capture:{version:string;basis:string|null}|null}
export const emptyCandidateDecision:CandidateDecisionValue={action:'',reason:'',scope:'',owner:'',team:'',refs:[],primary:'',capture:null};
export const candidateHasInput=(value:CandidateDecisionValue)=>Boolean(value.action||value.reason||value.scope||value.owner||value.team||value.refs.length||value.primary||value.capture);
const actionNames={START_REVIEW:'开始复核',REJECT_CANDIDATE:'拒绝候选',CONFIRM_INCIDENT:'人工确认公共故障'};
const reasonNames={OPERATOR_REVIEWED:'已由工作人员核对',INCORRECT_ASSOCIATION:'来源关联不正确',CONFIRMED_SHARED_FAULT:'确认共同故障'};
const scopeNames={LOCAL:'局部',BUILDING:'楼宇',CAMPUS:'院区',HOSPITAL_WIDE:'全院'};
type State='idle'|'submitting'|'checking'|'unknown'|'failed'|'denied'|'committed';
function refusalMessage(error:ApiError){if(error.code==='P2_012_SOURCE_CONFLICT')return '原材料依据已变化或过期；输入已保留，请核对当前事实。';if(error.code==='P2_012_OWNER_INVALID')return '负责人或责任组已失效；输入已保留，请重新核对。';return errorMessage(error);}
// Install before BrowserRouter subscribes: its POP must not unmount unsaved input.
let retainedNavigation:{location:string;state:unknown}|null=null;
window.addEventListener('popstate',event=>{const retained=retainedNavigation;if(!retained)return;event.stopImmediatePropagation();window.history.pushState(retained.state,'',retained.location);},{capture:true});

export function CandidateDecisionForm({principal,detail,onBlockedChange,onRefresh}:{principal:Principal;detail:CandidateDetail;onBlockedChange:(blocked:boolean)=>void;onRefresh:()=>void}){
  const client=useQueryClient(),request=useRef<AbortController|null>(null),[value,setValue]=useState<CandidateDecisionValue>(emptyCandidateDecision),latest=useRef(value);latest.current=value;
  const [pending,setPending]=useState<CandidateOperation|null>(null),[state,setState]=useState<State>('idle'),[message,setMessage,messageRevision]=useFeedbackState(''),[reviewRequired,setReviewRequired]=useState(false),[known,setKnown]=useState<CandidateCommandResult|null>(null),[checkedUnknown,setCheckedUnknown]=useState(false);
  const draft=useCandidateDraft({principal,candidateId:detail.id,value,pending,emptyValue:emptyCandidateDecision,hasInput:candidateHasInput,
    onRestore:copy=>{setValue(copy.value);setPending(copy.pending);if(copy.pending){setState('unknown');setMessage('原操作仍未知；请先只读核对原 UUID。');}},
    onOperation:id=>{setPending(null);setState('unknown');setMessage('原操作 '+id+' 仍未知，敏感恢复内容不可用；不能提交新操作。');},
    onSensitiveClear:()=>{request.current?.abort();setValue(emptyCandidateDecision);setPending(null);setState('idle');setKnown(null);setMessage('');setReviewRequired(false);setCheckedUnknown(false);}});
  const active=state==='submitting'||state==='checking',unknown=state==='unknown',purposeAllowed=detail.allowed_scopes.length>0,originalId=pending?.body.client_command_id??draft.operationId;
  const navigationBlocked=active||unknown||candidateHasInput(value);
  useEffect(()=>{onBlockedChange(navigationBlocked);return()=>onBlockedChange(false);},[navigationBlocked,onBlockedChange]);
  useEffect(()=>()=>{request.current?.abort();},[]);
  useEffect(()=>{if(!purposeAllowed){request.current?.abort();setValue(emptyCandidateDecision);setPending(null);setState('idle');setMessage('');}},[purposeAllowed]);
  useEffect(()=>{
    if(!navigationBlocked)return;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();};
    const retained={location:window.location.href,state:window.history.state as unknown};retainedNavigation=retained;
    window.addEventListener('beforeunload',warn);
    return()=>{window.removeEventListener('beforeunload',warn);if(retainedNavigation===retained)retainedNavigation=null;};
  },[navigationBlocked]);
  const refresh=()=>{onRefresh();void client.invalidateQueries({queryKey:['incident-candidates',principal.principal_id]});};
  const update=(change:Partial<CandidateDecisionValue>|((current:CandidateDecisionValue)=>Partial<CandidateDecisionValue>))=>setValue(current=>({...current,...(typeof change==='function'?change(current):change),capture:current.capture??{version:detail.row_version,basis:detail.material_basis}}));
  const applyCommit=(result:CandidateCommandResult,snapshot:string)=>{
    setKnown(result);setPending(null);setState('committed');setMessage(result.result_ref_type==='INCIDENT'?'公共故障已确认；将独立核对当前获权结果。':'候选决定已提交；请核对当前状态。');
    setValue(current=>JSON.stringify(current)===snapshot?emptyCandidateDecision:current);setReviewRequired(JSON.stringify(latest.current)!==snapshot);refresh();
  };
  const mutation=useMutation({mutationKey:['incident-candidate-command',principal.principal_id,detail.id],
    mutationFn:({operation,signal,csrfToken}:{operation:CandidateOperation;snapshot:string;signal:AbortSignal;csrfToken:string|null})=>candidateApi.perform(operation,csrfToken,signal),
    onSuccess:async(result,variables)=>{const cleaned=await draft.success(variables.operation.body.client_command_id,JSON.stringify(latest.current)!==variables.snapshot);applyCommit(result,variables.snapshot);if(!cleaned)setMessage((result.result_ref_type==='INCIDENT'?'公共故障已确认':'候选决定已提交')+'；恢复副本清理失败，原 UUID 已保留，禁止新提交，请只读核对。');},
    onError:async(error,variables)=>{
      if(variables.signal.aborted)return;
      if(error instanceof CandidateCommandRefusal){let cleaned=true;try{await draft.knownFailure(variables.operation.body.client_command_id);}catch{cleaned=false;}setPending(null);setState('failed');setReviewRequired(true);setMessage('原操作已明确失败：'+refusalMessage(error)+(cleaned?'':' 恢复副本清理失败，原 UUID 已保留，禁止新提交，请只读核对。'));refresh();}
      else if(error instanceof ApiError&&[401,403,404].includes(error.status)){setState('denied');setMessage('当前操作权限已变化，请重新核对。');refresh();}
      else{setPending(variables.operation);setState('unknown');setMessage('结果未知：原 UUID、版本、材料依据和正文保持不变，请先只读核对。');}
    },onSettled:()=>{request.current=null;}});
  const receipt=useMutation({mutationKey:['incident-candidate-receipt',principal.principal_id,detail.id],mutationFn:({commandId,signal}:{commandId:string;signal:AbortSignal})=>candidateApi.receipt(detail.id,commandId,signal),
    onSuccess:async(result,variables)=>{
      if(result.state==='UNKNOWN'){setCheckedUnknown(true);setState('unknown');setMessage('结果仍未知：没有终态回执不代表未提交；尚未发送新的操作。');return;}
      setCheckedUnknown(false);let cleaned=true;if(result.state==='COMMITTED')cleaned=await draft.success(variables.commandId,true);else try{await draft.knownFailure(variables.commandId);}catch{cleaned=false;}
      setPending(null);setReviewRequired(true);refresh();
      if(result.state==='COMMITTED'){setKnown(result.result);setState('committed');setMessage(cleaned?'原操作已确认提交；当前输入保留，请核对当前事实。':'原操作已确认提交；恢复副本清理失败，禁止新提交，请继续只读核对。');}
      else{setState('failed');setMessage('原操作已明确失败；当前输入保留，请核对当前事实后再明确新的决定。'+(cleaned?'':' 恢复副本清理失败，原 UUID 已保留，禁止新提交，请继续只读核对。'));}
    },onError:(_error,variables)=>{if(variables.signal.aborted)return;setState('unknown');setMessage('只读核对未能完成，原操作仍未知；尚未发送新的操作。');},onSettled:()=>{request.current=null;}});
  const owner=detail.eligible_owners.find(owner=>owner.id===value.owner),teamValid=value.team==='__NO_TEAM__'||Boolean(owner?.teams.some(team=>team.team_id===value.team)),sources=new Map(detail.report_sources.map(source=>[source.source_decision_id,source]));
  const primaryOptions=[...new Map(value.refs.flatMap(ref=>{const source=sources.get(ref);return source?.ticket_id?[[source.ticket_id,{id:source.ticket_id,label:source.ticket_no??'当前编号不可用'}] as const]:[];})).values()];
  const currentCapture=Boolean(value.capture&&value.capture.version===detail.row_version),confirm=value.action==='CONFIRM_INCIDENT';
  const canConfirm=Boolean(detail.material_basis&&value.capture?.basis===detail.material_basis&&detail.materials.every(material=>material.status==='CURRENT')&&value.scope&&detail.allowed_scopes.includes(value.scope)&&owner&&value.team&&teamValid&&value.refs.length&&value.refs.every(ref=>sources.has(ref))&&value.primary&&(value.primary==='NONE'||primaryOptions.some(ticket=>ticket.id===value.primary)));
  const canSubmit=Boolean(draft.canSubmit&&value.action&&value.reason&&detail.allowed_actions.includes(value.action)&&currentCapture&&!reviewRequired&&!active&&!pending&&(!confirm||canConfirm));
  const send=async(operation:CandidateOperation,snapshot:string)=>{
    if(request.current)return;
    const controller=new AbortController();request.current=controller;setCheckedUnknown(false);setPending(operation);setState('submitting');setMessage('正在核对当前权限并提交明确决定…');
    try{
      const fresh=await api.bootstrap(controller.signal);if(fresh.principal_id!==principal.principal_id||!fresh.incident_candidate_workspace_enabled)throw new ApiError(403,'AUTHORIZATION_REJECTED');
      const current=await candidateApi.detail(detail.id,controller.signal);
      if(current.allowed_scopes.length===0||(operation.action==='CONFIRM_INCIDENT'&&!current.allowed_scopes.includes(operation.body.confirmed_scope)))throw new ApiError(403,'AUTHORIZATION_REJECTED');
      if(!current.allowed_actions.includes(operation.action))throw new ApiError(409,operation.action==='CONFIRM_INCIDENT'&&current.materials.some(material=>material.status!=='CURRENT')?'P2_012_SOURCE_CONFLICT':'P2_012_STATE_CONFLICT');
      // Fresh authorization never replaces the captured body or version.
      if(controller.signal.aborted)return;
      await draft.prepare(operation);if(controller.signal.aborted)return;
      mutation.mutate({operation,snapshot,signal:controller.signal,csrfToken:fresh.csrf_token});
    }catch(error){request.current=null;setPending(null);setState('denied');setReviewRequired(true);setMessage('尚未发送：'+(error instanceof ApiError?refusalMessage(error):errorMessage(error)));refresh();}
  };
  const submit=()=>{
    if(!canSubmit||!value.action||!value.reason||!value.capture)return;
    const common={client_command_id:crypto.randomUUID(),reason_code:value.reason};let operation:CandidateOperation;
    if(value.action==='CONFIRM_INCIDENT'){
      if(!value.scope||!value.capture.basis)return;
      operation=Object.freeze({candidateId:detail.id,action:value.action,body:Object.freeze({...common,expected_candidate_version:value.capture.version,expected_material_basis:value.capture.basis,confirmed_scope:value.scope,owner_principal_id:value.owner,owner_team_id:value.team==='__NO_TEAM__'?null:value.team,selected_report_refs:Object.freeze([...value.refs]),primary_ticket_id:value.primary==='NONE'?null:value.primary})});
    }else operation=Object.freeze({candidateId:detail.id,action:value.action,body:Object.freeze({...common,expected_row_version:value.capture.version})});
    void send(operation,JSON.stringify(value));
  };
  const check=()=>{if(!originalId||request.current)return;const controller=new AbortController();request.current=controller;setState('checking');setMessage('正在只读核对原操作…');receipt.mutate({commandId:originalId,signal:controller.signal});};
  return <section className="candidate-decision" aria-label="人工候选决定">
    {principal.incident_candidate_draft_recovery_enabled?<DraftStatus data-candidate-draft>{draft.message}</DraftStatus>:null}
    {purposeAllowed?<HForm onSubmit={event=>{event.preventDefault();submit();}}><h2>人工决定</h2><p>各项由工作人员明确选择；刷新只更新当前事实，已捕获的决定依据保持不变。</p><div className="candidate-form-grid"><WorkbenchSelect label={<>人工决定</>} aria-label="人工决定" value={value.action} onChange={event=>update({action:event as CandidateAction|''})}><ListBox.Item id="" textValue={"请选择决定"}>请选择决定<ListBox.ItemIndicator/></ListBox.Item>{Object.entries(actionNames).map(([action,label])=><ListBox.Item key={action} id={action} isDisabled={!detail.allowed_actions.includes(action as CandidateAction)} textValue={String(label)+String(detail.allowed_actions.includes(action as CandidateAction)?'':'（当前不可用）')}>{label}{detail.allowed_actions.includes(action as CandidateAction)?'':'（当前不可用）'}<ListBox.ItemIndicator/></ListBox.Item>)}</WorkbenchSelect>
      <WorkbenchSelect label={<>决定原因</>} aria-label="决定原因" value={value.reason} onChange={event=>update({reason:event as CandidateReason|''})}><ListBox.Item id="" textValue={"请选择原因"}>请选择原因<ListBox.ItemIndicator/></ListBox.Item>{Object.entries(reasonNames).map(([reason,label])=><ListBox.Item key={reason} id={reason} textValue={String(label)}>{label}<ListBox.ItemIndicator/></ListBox.Item>)}</WorkbenchSelect></div>{value.capture?<p data-captured-basis>已捕获候选版本 {value.capture.version}；当前候选版本 {detail.row_version}。{confirm?'已捕获材料依据：'+(value.capture.basis??'不可用'):''}</p>:null}{confirm?<><div className="candidate-form-grid"><WorkbenchSelect label={<>确认范围</>} aria-label="确认范围" value={value.scope} onChange={event=>update({scope:event as IncidentScope|''})}><ListBox.Item id="" textValue={"请选择范围"}>请选择范围<ListBox.ItemIndicator/></ListBox.Item>{value.scope&&!detail.allowed_scopes.includes(value.scope)?<ListBox.Item id={value.scope} textValue={"原选择当前不可用"}>原选择当前不可用<ListBox.ItemIndicator/></ListBox.Item>:null}{detail.allowed_scopes.map(scope=><ListBox.Item key={scope} id={scope} textValue={String(scopeNames[scope])}>{scopeNames[scope]}<ListBox.ItemIndicator/></ListBox.Item>)}</WorkbenchSelect>
        <WorkbenchSelect label={<>故障负责人</>} aria-label="故障负责人" value={value.owner} onChange={event=>update({owner:event})}><ListBox.Item id="" textValue={"请选择负责人"}>请选择负责人<ListBox.ItemIndicator/></ListBox.Item>{value.owner&&!owner?<ListBox.Item id={value.owner} textValue={"原负责人当前不可用"}>原负责人当前不可用<ListBox.ItemIndicator/></ListBox.Item>:null}{detail.eligible_owners.map(owner=><ListBox.Item key={owner.id} id={owner.id} textValue={String(owner.display_name)}>{owner.display_name}<ListBox.ItemIndicator/></ListBox.Item>)}</WorkbenchSelect>
        <WorkbenchSelect label={<>责任组</>} aria-label="责任组" value={value.team} onChange={event=>update({team:event})}><ListBox.Item id="" textValue={"请选择责任组或无责任组"}>请选择责任组或无责任组<ListBox.ItemIndicator/></ListBox.Item><ListBox.Item id="__NO_TEAM__" textValue={"无责任组"}>无责任组<ListBox.ItemIndicator/></ListBox.Item>{value.team&&!teamValid?<ListBox.Item id={value.team} textValue={"原责任组当前不可用"}>原责任组当前不可用<ListBox.ItemIndicator/></ListBox.Item>:null}{owner?.teams.map(team=><ListBox.Item key={team.team_id} id={team.team_id} textValue={String(team.display_name)}>{team.display_name}<ListBox.ItemIndicator/></ListBox.Item>)}</WorkbenchSelect>
        <WorkbenchSelect label={<>主工单</>} aria-label="主工单" value={value.primary} onChange={event=>update({primary:event})}><ListBox.Item id="" textValue={"请选择主工单或无主工单"}>请选择主工单或无主工单<ListBox.ItemIndicator/></ListBox.Item><ListBox.Item id="NONE" textValue={"无主工单"}>无主工单<ListBox.ItemIndicator/></ListBox.Item>{value.primary&&value.primary!=='NONE'&&!primaryOptions.some(ticket=>ticket.id===value.primary)?<ListBox.Item id={value.primary} textValue={"原主工单不在当前有效选择中"}>原主工单不在当前有效选择中<ListBox.ItemIndicator/></ListBox.Item>:null}{primaryOptions.map(ticket=><ListBox.Item key={ticket.id} id={ticket.id} textValue={String(ticket.label)}>{ticket.label}<ListBox.ItemIndicator/></ListBox.Item>)}</WorkbenchSelect></div>
        <HFieldset><HFieldset.Legend>逐项选择关联报修来源</HFieldset.Legend><p>获权来源总数：{detail.visible_report_source_count}；已提供选项：{detail.report_sources.length}；当前选择 {value.refs.length} 项 Report，涉及 {primaryOptions.length} 个个人工单。</p>{detail.report_sources.map((source,index)=><HCheckbox data-report-ref={source.source_decision_id} isSelected={value.refs.includes(source.source_decision_id)} onChange={event=>{const checked=event;update(current=>({refs:checked?current.refs.includes(source.source_decision_id)?current.refs:[...current.refs,source.source_decision_id]:current.refs.filter(ref=>ref!==source.source_decision_id)}));}} className="candidate-report-choice" key={source.source_decision_id}><HCheckbox.Content><HCheckbox.Control><HCheckbox.Indicator/></HCheckbox.Control><span>{index+1}. {source.ticket_no??'未建单来源'} · 独立报修引用</span></HCheckbox.Content></HCheckbox>)}{value.refs.some(ref=>!sources.has(ref))?<p role="alert">已有选择当前不可读取或未提供；没有自动替换或删除原选择，请重新核对。</p>:null}</HFieldset>
        {detail.report_sources_truncated||detail.eligible_owners_truncated||owner?.teams_truncated?<p>部分选项已裁剪，仅能选择当前已提供的获权对象。</p>:null}
        {!detail.materials.every(material=>material.status==='CURRENT')?<p role="alert">原依据已有新材料或过期，不能确认；可重新核对或明确拒绝此候选。</p>:null}
      </>:null}<div className="note-controls"><HButton type="submit" data-action="submit-candidate" isDisabled={!canSubmit} variant="secondary">{active?'正在核对…':'提交明确决定'}</HButton>
        {!pending&&candidateHasInput(value)?<HButton type="button" data-action="adopt-candidate-basis" isDisabled={active} onClick={()=>{setValue(current=>({...current,capture:{version:detail.row_version,basis:detail.material_basis}}));setReviewRequired(false);}} variant="secondary">明确采用当前依据</HButton>:null}
        {!pending&&candidateHasInput(value)?<HButton type="button" data-action="clear-candidate-input" isDisabled={active} onClick={()=>{if(draft.enabled)void draft.discard();else{setValue(emptyCandidateDecision);setReviewRequired(false);}}} variant="secondary">清除当前输入</HButton>:null}
        {pending&&unknown&&draft.enabled?<HButton type="button" data-action="discard-candidate-recovery" isDisabled={active} onClick={()=>{void draft.discard();}} variant="secondary">清除敏感恢复内容（保留原操作核对）</HButton>:null}
        {originalId?<HButton type="button" data-action="check-candidate-operation" isDisabled={active} onClick={check} variant="secondary">只读核对原操作</HButton>:null}
        {pending&&checkedUnknown&&unknown?<HButton type="button" data-action="replay-candidate-operation" isDisabled={active} onClick={()=>{void send(pending,JSON.stringify(value));}} variant="secondary">明确重放原操作（保留原 UUID 和正文）</HButton>:null}
      </div></HForm>:<p>当前可读取候选，没有人工决定权限。</p>}
    {message?<ToastFeedback revision={messageRevision} source="incident-candidates" state={state} role={state==='unknown'||state==='failed'||state==='denied'?'alert':'status'} data-candidate-outcome>{message}</ToastFeedback>:null}
    {known?.result_ref_type==='INCIDENT'?<div data-result-ref={known.result_ref_id}><p>原确认结果已提交。<Link to={'/incidents/'+known.result_ref_id} onClick={event=>{if(navigationBlocked)event.preventDefault();}}>打开独立公共故障页面</Link></p><IncidentResultView principal={principal} incidentId={known.result_ref_id} authorityRevision={detail.allowed_scopes.join(',')}/></div>:null}
  </section>;
}
