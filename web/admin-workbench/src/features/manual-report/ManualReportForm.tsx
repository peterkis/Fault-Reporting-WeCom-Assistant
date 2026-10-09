import {useEffect,useRef,useState} from 'react';
import {Link} from 'react-router';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {api,ApiError,errorMessage,workbenchTransportWritable} from '../../api/client';
import type {Principal} from '../../api/client';
import type {ManualReportCommand,ManualReportResult} from '../../../../../contracts/workbench_manual_report_contracts';
import {emptyManualReportInput,hasManualReportInput,manualReportCommandFromInput,decodeManualReportInput} from '../../../../../src/workbench-manual-report-browser-contracts.mjs';
import type {ManualReportInput} from '../../../../../src/workbench-manual-report-browser-contracts.mjs';
import {clearSessionAuthorization} from '../../app/authorization';
import {clearManualReportAuthority,manualReportCapabilitiesKey,useManualReportDraft} from './use-manual-report-draft';
import './manual-report.css';
export function ManualReportEntry({principal,blocked}:{principal:Principal;blocked:boolean}){
  const context=useQuery({queryKey:manualReportCapabilitiesKey(principal.principal_id),queryFn:({signal})=>api.manualReportCapabilities(signal),enabled:principal.manual_reports_enabled});
  if(!principal.manual_reports_enabled||context.isError||!context.data?.can_create)return null;
  return <Link className="manual-report-entry" data-action="new-report" to="/reports/new" aria-disabled={blocked} onClick={event=>{if(blocked)event.preventDefault();}}>新报修</Link>;
}
type State='idle'|'submitting'|'checking'|'unknown'|'succeeded'|'denied';
export function ManualReportForm({principal,onBlockedChange}:{principal:Principal;onBlockedChange:(value:boolean)=>void}){
  const client=useQueryClient(),request=useRef<AbortController|null>(null),mounted=useRef(true),generation=useRef(0);
  const [value,setValue]=useState<ManualReportInput>(emptyManualReportInput),[pending,setPending]=useState<ManualReportCommand|null>(null),[state,setState]=useState<State>('idle'),[message,setMessage]=useState(''),[result,setResult]=useState<ManualReportResult|null>(null);
  const context=useQuery({queryKey:manualReportCapabilitiesKey(principal.principal_id),queryFn:({signal})=>api.manualReportCapabilities(signal),enabled:principal.manual_reports_enabled});
  const draft=useManualReportDraft({principal,value,pending,onRestore:restored=>{setValue(restored.value);setPending(restored.pending);if(restored.pending){setState('unknown');setMessage('结果未知：原报修内容和操作标识已恢复，只能只读核对。');}},
    onOperation:()=>{setState('unknown');setMessage('结果未知：敏感内容不可恢复，只能只读核对原操作。');},
    onSensitiveClear:()=>{generation.current++;request.current?.abort();request.current=null;setValue(emptyManualReportInput());setPending(null);setState('idle');setMessage('');setResult(null);}});
  const busy=state==='submitting'||state==='checking',unresolved=state==='unknown'||Boolean(pending)||Boolean(draft.operationId);
  const blocked=(busy||unresolved||hasManualReportInput(value))&&!draft.safeToLeave;
  useEffect(()=>{onBlockedChange(blocked);return()=>onBlockedChange(false);},[blocked,onBlockedChange]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;request.current?.abort();};},[]);
  useEffect(()=>{if(!blocked)return;const warn=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[blocked]);
  const deny=(error:ApiError)=>{generation.current++;request.current?.abort();request.current=null;setValue(emptyManualReportInput());setPending(null);setResult(null);setState('denied');setMessage('当前身份已没有代录权限，输入及恢复副本已清理。');
    if(error.status===401)void clearSessionAuthorization(client,principal.principal_id,401,'revoked');else void clearManualReportAuthority(client,principal.principal_id,error);};
  useEffect(()=>{if(context.error instanceof ApiError&&[401,403,404].includes(context.error.status))deny(context.error);},[context.error]);
  const refresh=()=>{void client.invalidateQueries({queryKey:['board',principal.principal_id]});};
  async function accepted(id:string,accepted:ManualReportResult,label:string){
    const cleaned=await draft.success(id);if(!mounted.current)return;setPending(null);setValue(emptyManualReportInput());setResult(accepted);setState('succeeded');
    setMessage(label+(cleaned?'':' 恢复副本清理尚未确认，禁止新提交；请只读核对并重试清理。'));refresh();
  }
  async function submit(){
    if(request.current||unresolved||!draft.canSubmit||!context.data?.can_create||context.isError)return;
    if(!workbenchTransportWritable()){setState('denied');setMessage('连接尚未完成事实核验，报修尚未发送；输入已保留，请重新读取。');return;}
    let command:ManualReportCommand;try{command=manualReportCommandFromInput(value,crypto.randomUUID());}catch{setState('denied');setMessage('请完整填写报修人、联系方式和故障描述，并填写位置或选择位置暂不清楚。');return;}
    if(new TextEncoder().encode(JSON.stringify(command)).length>16384){setState('denied');setMessage('报修内容超出16 KiB，请减少输入后再提交。');return;}
    const controller=new AbortController(),token=generation.current;let dispatched=false;request.current=controller;setPending(command);setState('submitting');setMessage('正在受理报修…');
    try{
      await draft.prepare(command);if(controller.signal.aborted||token!==generation.current)return;
      dispatched=true;const admitted=await api.submitManualReport(command,principal.csrf_token,controller.signal);if(!mounted.current||controller.signal.aborted||token!==generation.current)return;
      await accepted(command.client_command_id,admitted,admitted.replayed?'已受理：已核对原操作结果。':'已受理报修。');
    }catch(error){
      if(!mounted.current||controller.signal.aborted||token!==generation.current)return;
      if(error instanceof ApiError&&[401,403,404].includes(error.status)){deny(error);return;}
      if(error instanceof ApiError){await draft.knownFailure(command.client_command_id).catch(()=>{});setPending(null);setState('denied');setMessage('受理被拒绝，输入已保留：'+errorMessage(error));}
      else if(!dispatched){setPending(null);setState('denied');setMessage('恢复副本未保存，本次尚未发送；请保留并检查当前输入。');}
      else{setState('unknown');setPending(command);setMessage('结果未知：报修可能已受理。原内容和操作标识保持不变，请只读核对。');}
    }finally{if(request.current===controller)request.current=null;}
  }
  async function check(){
    const id=pending?.client_command_id??draft.operationId;if(request.current||!id)return;const controller=new AbortController(),token=generation.current;request.current=controller;setState('checking');
    try{const receipt=await api.manualReportReceipt(id,controller.signal);if(!mounted.current||controller.signal.aborted||token!==generation.current)return;
      if(receipt.state==='COMMITTED')await accepted(id,receipt.result,'已受理：已核对原操作结果。');
      else if(receipt.state==='FAILED'){const cleaned=await draft.success(id,true);if(!mounted.current)return;setPending(null);setState('denied');setMessage('已核对原操作失败；输入已保留，请明确新的报修操作。'+(cleaned?'':' 恢复副本清理尚未确认，禁止新提交。'));}
      else{setState('unknown');setMessage('结果仍未知：未找到终态不代表未受理；没有发送新的报修，请继续只读核对。');}
    }catch(error){if(!mounted.current||controller.signal.aborted||token!==generation.current)return;if(error instanceof ApiError&&[401,403,404].includes(error.status))deny(error);else{setState('unknown');setMessage('只读核对失败，原操作仍未知；没有发送新的报修。');}}
    finally{if(request.current===controller)request.current=null;}
  }
  const change=(next:ManualReportInput)=>{if(unresolved||busy)return;try{decodeManualReportInput(next);}catch{setState('denied');setMessage('这次修改包含控制字符或超过字段上限，原输入已保留。');return;}setValue(next);setResult(null);setMessage('');setState('idle');};
  const controlsDisabled=busy||unresolved||context.isError||!context.data?.can_create;
  return <section className="workspace manual-report-page"><header className="page-title"><div><h1>新报修</h1><p>电话或现场代录，先保存清楚的原始情况。</p></div><Link to="/" data-action="return-workbench" aria-disabled={blocked} onClick={event=>{if(blocked)event.preventDefault();}}>返回工作台</Link></header>
    {!principal.manual_reports_enabled?<p role="status">电话与现场代录尚未开放。</p>:context.isPending?<p role="status">正在核验当前代录权限…</p>:context.isError&&!context.data?<p role="alert">{errorMessage(context.error)} <button onClick={()=>{void context.refetch();}}>重新读取代录权限</button></p>:<form data-manual-report-form onSubmit={event=>{event.preventDefault();void submit();}}>
      <p className="manual-report-operator">代录人：{principal.display_name} <span>工作人员身份由当前会话记录。</span></p>
      <p className="manual-report-audience">报修人身份未核实，需人工联系；本次不会自动通知。</p>
      {!draft.operationId||pending?<fieldset disabled={controlsDisabled}><legend>本次报修情况</legend>
        <label>来源<select aria-label="报修来源" value={value.source} onChange={event=>change({...value,source:event.target.value==='ON_SITE'?'ON_SITE':'PHONE'})}><option value="PHONE">电话代录</option><option value="ON_SITE">现场代录</option></select></label>
        <div className="manual-report-fields"><label>报修人姓名<input aria-label="报修人姓名" required value={value.name} onChange={event=>change({...value,name:event.target.value})}/></label><label>联系方式<input aria-label="联系方式" required value={value.contact} onChange={event=>change({...value,contact:event.target.value})}/></label></div>
        <label>报修人科室（可不填）<input aria-label="报修人科室" value={value.department} onChange={event=>change({...value,department:event.target.value})}/></label>
        <label>故障描述<textarea aria-label="故障描述" required rows={5} value={value.description} onChange={event=>change({...value,description:event.target.value})}/><small>最多4000字符；不填写患者资料、口令或其它敏感业务记录。</small></label>
        <label className="manual-report-check"><input type="checkbox" aria-label="位置暂不清楚" checked={value.unknown} onChange={event=>change({...value,unknown:event.target.checked})}/>位置暂不清楚</label>
        <label>位置<input aria-label="故障位置" required={!value.unknown} disabled={value.unknown||controlsDisabled} value={value.location} onChange={event=>change({...value,location:event.target.value})}/></label>
      </fieldset>:<p>原操作仍未知，敏感内容已清理；只能只读核对。</p>}
      <div className="manual-report-controls"><button type="submit" data-action="submit-manual-report" disabled={controlsDisabled||!draft.canSubmit}>保存并受理</button>
        {unresolved?<button type="button" data-action="check-manual-report-receipt" disabled={busy} onClick={()=>{void check();}}>只读核对原操作</button>:null}
        {draft.enabled&&hasManualReportInput(value)&&!unresolved?<button type="button" disabled={busy} data-action="discard-manual-report-draft" onClick={()=>{void draft.discard();}}>丢弃草稿内容</button>:null}
        <button type="button" disabled={busy} data-action="refresh-manual-report-authority" onClick={()=>{void context.refetch();}}>重新读取代录权限</button>
      </div>
    </form>}
    {draft.enabled?<p data-manual-report-draft-status role="status">{draft.message}</p>:null}
    {message?<div data-manual-report-result role={state==='denied'||state==='unknown'?'alert':'status'}><p>{message}</p>{result?<><p>{result.ticket?'工单 '+result.ticket.number+'，已进入待接单队列。':result.review?'已保存原始报修，进入人工复核。':'已保存原始报修及规则处理结果。'}</p><p>需人工联系；不会自动通知报修人。</p></>:null}</div>:null}
  </section>;
}
