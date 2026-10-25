import {useEffect,useRef,useState} from 'react';
import {Link,useSearchParams} from 'react-router';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {api,ApiError,ConfirmedManualReportRejection,errorMessage,workbenchTransportWritable} from '../../api/client';
import type {Principal} from '../../api/client';
import type {ManualReportAdmissionCommand,ManualReportAdmissionResult} from '../../contracts/workbench-manual-report-browser-contracts.mjs';
import type {WorkbenchReporterCandidate,WorkbenchReporterCandidates} from '../../../../../contracts/workbench_reporter_candidates_contracts';
import {emptyManualReportInput,hasManualReportInput,manualReportCommandFromInput,verifiedManualReportCommandFromInput,decodeManualReportInput} from '../../contracts/workbench-manual-report-browser-contracts.mjs';
import type {ManualReportInput} from '../../contracts/workbench-manual-report-browser-contracts.mjs';
import {clearSessionAuthorization} from '../../app/authorization';
import {clearManualReportAuthority,manualReportCapabilitiesKey,useManualReportDraft} from './use-manual-report-draft';
import {hasExistingDraft} from '../drafts/encrypted-drafts';
import {MANUAL_REPORT_DRAFT_ID} from '../../contracts/workbench-manual-report-browser-contracts.mjs';
import {ManualSelfHandlingForm} from './ManualSelfHandlingForm';
import './manual-report.css';
export function ManualReportEntry({principal,blocked}:{principal:Principal;blocked:boolean}){
  const context=useQuery({queryKey:manualReportCapabilitiesKey(principal.principal_id),queryFn:({signal})=>api.manualReportCapabilities(signal),enabled:principal.manual_reports_enabled});
  if(!principal.manual_reports_enabled||context.isError||!context.data?.can_create)return null;
  return <Link className="manual-report-entry" data-action="new-report" to="/reports/new" aria-disabled={blocked} onClick={event=>{if(blocked)event.preventDefault();}}>新报修</Link>;
}
type State='idle'|'submitting'|'checking'|'unknown'|'succeeded'|'denied';
export function ManualReportForm({principal,onBlockedChange}:{principal:Principal;onBlockedChange:(value:boolean)=>void}){
  const [parameters,setParameters]=useSearchParams(),[seed,setSeed]=useState<ManualReportInput>(emptyManualReportInput);
  const self=parameters.get('handling')==='self';
  const mode=(self:boolean,value:ManualReportInput)=>{setSeed(value);const next=new URLSearchParams(parameters);if(self)next.set('handling','self');else next.delete('handling');setParameters(next,{replace:true});};
  return self?<ManualSelfHandlingForm key="self" principal={principal} initialValue={seed} onOrdinary={value=>mode(false,value)} onBlockedChange={onBlockedChange}/>
    :<OrdinaryManualReportForm key="ordinary" principal={principal} initialValue={seed} onSelf={value=>mode(true,value)} onBlockedChange={onBlockedChange}/>;
}
function OrdinaryManualReportForm({principal,initialValue,onSelf,onBlockedChange}:{principal:Principal;initialValue:ManualReportInput;onSelf:(value:ManualReportInput)=>void;onBlockedChange:(value:boolean)=>void}){
  const client=useQueryClient(),request=useRef<AbortController|null>(null),mounted=useRef(true),generation=useRef(0);
  const [value,setValue]=useState<ManualReportInput>(initialValue),[pending,setPending]=useState<ManualReportAdmissionCommand|null>(null),[state,setState]=useState<State>('idle'),[message,setMessage]=useState(''),[result,setResult]=useState<ManualReportAdmissionResult|null>(null);
  const [selected,setSelected]=useState<WorkbenchReporterCandidate|null>(null),[manual,setManual]=useState(false),[selectionIntent,setSelectionIntent]=useState(false),[page,setPage]=useState<WorkbenchReporterCandidates|null>(null),[searchMessage,setSearchMessage]=useState(''),[searching,setSearching]=useState(false);
  const candidateRequest=useRef<AbortController|null>(null);
  const context=useQuery({queryKey:manualReportCapabilitiesKey(principal.principal_id),queryFn:({signal})=>api.manualReportCapabilities(signal),enabled:principal.manual_reports_enabled});
  const draft=useManualReportDraft({principal,value,pending,selectionIntent,onRestore:restored=>{setValue(restored.value);setSelectionIntent(restored.selectionIntent===true);setSelected(null);setPending(restored.pending);if(restored.pending){setState('unknown');setMessage('结果未知：原报修内容和操作标识已恢复，只能只读核对。');}},
    onOperation:()=>{setState('unknown');setMessage('结果未知：敏感内容不可恢复，只能只读核对原操作。');},
    onSensitiveClear:()=>{generation.current++;request.current?.abort();request.current=null;setValue(emptyManualReportInput());setSelected(null);setSelectionIntent(false);setPage(null);candidateRequest.current?.abort();setPending(null);setState('idle');setMessage('');setResult(null);}});
  const busy=state==='submitting'||state==='checking',unresolved=state==='unknown'||Boolean(pending)||Boolean(draft.operationId);
  const selectionRequired=selectionIntent&&(!selected||!principal.reporter_candidates_enabled);
  const blocked=(busy||unresolved||hasManualReportInput(value))&&!draft.safeToLeave;
  useEffect(()=>{onBlockedChange(blocked);return()=>onBlockedChange(false);},[blocked,onBlockedChange]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;request.current?.abort();};},[]);
  useEffect(()=>{if(!blocked)return;const warn=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[blocked]);
  const deny=(error:ApiError)=>{generation.current++;request.current?.abort();request.current=null;setValue(emptyManualReportInput());setSelected(null);setSelectionIntent(false);setPage(null);candidateRequest.current?.abort();setPending(null);setResult(null);setState('denied');setMessage('当前身份已没有代录权限，输入及恢复副本已清理。');
    if(error.status===401)void clearSessionAuthorization(client,principal.principal_id,401,'revoked');else void clearManualReportAuthority(client,principal.principal_id,error);};
  async function retainCandidateRefusal(controller:AbortController,token:number,commandId?:string,confirmedFailure=false){
    const acquired=request.current===null;if(acquired)request.current=controller;
    try{
      const fresh=await context.refetch();
      if(!mounted.current||controller.signal.aborted||token!==generation.current)return;
      if(fresh.error instanceof ApiError&&[401,403,404].includes(fresh.error.status)){deny(fresh.error);return;}
      if(commandId&&(!confirmedFailure||fresh.isError||!fresh.data?.can_create)){
        setState('unknown');setMessage('结果未知：报修可能已受理。原操作标识保持不变，请显式只读核对。');return;
      }
      if(commandId){
        try{await draft.knownFailure(commandId);}catch{if(mounted.current&&!controller.signal.aborted&&token===generation.current){setState('unknown');setMessage('成员选择已被拒绝，但恢复副本尚未核对，请先只读核对原操作。');}return;}
        if(!mounted.current||controller.signal.aborted||token!==generation.current)return;
        setPending(null);
      }
      const notice=fresh.isError||!fresh.data?.can_create?'当前代录权限暂无法核验，输入已保留；请重新读取代录权限。':'成员选择未获准，当前代录权限仍有效；输入已保留，可明确改为手填。';
      setPage(null);setState('denied');setMessage(notice);setSearchMessage(notice);
    }finally{if(acquired&&request.current===controller)request.current=null;}
  }
  useEffect(()=>{if(context.error instanceof ApiError&&[401,403,404].includes(context.error.status))deny(context.error);},[context.error]);
  const refresh=()=>{void client.invalidateQueries({queryKey:['board',principal.principal_id]});};
  async function accepted(id:string,accepted:ManualReportAdmissionResult,label:string){
    const cleaned=await draft.success(id);if(!mounted.current)return;setPending(null);setValue(emptyManualReportInput());setSelected(null);setSelectionIntent(false);setPage(null);setResult(accepted);setState('succeeded');
    setMessage(label+(cleaned?'':' 恢复副本清理尚未确认，禁止新提交；请只读核对并重试清理。'));refresh();
  }
  async function submit(){
    if(request.current||unresolved||selectionRequired||!draft.canSubmit||!context.data?.can_create||context.isError)return;
    if(!workbenchTransportWritable()){setState('denied');setMessage('连接尚未完成事实核验，报修尚未发送；输入已保留，请重新读取。');return;}
    let command:ManualReportAdmissionCommand;try{command=selected&&principal.reporter_candidates_enabled?verifiedManualReportCommandFromInput(value,crypto.randomUUID(),{verification:'VERIFIED_SELECTION',candidate_ref:selected.candidate_ref,candidate_version:selected.candidate_version}):manualReportCommandFromInput(value,crypto.randomUUID());}catch{setState('denied');setMessage('请完整填写报修人、联系方式和故障描述，并填写位置或选择位置暂不清楚。');return;}
    if(new TextEncoder().encode(JSON.stringify(command)).length>16384){setState('denied');setMessage('报修内容超出16 KiB，请减少输入后再提交。');return;}
    const controller=new AbortController(),token=generation.current;let dispatched=false;request.current=controller;setPending(command);setState('submitting');setMessage('正在受理报修…');
    try{
      await draft.prepare(command);if(controller.signal.aborted||token!==generation.current)return;
      dispatched=true;const admitted=await api.submitManualReport(command,principal.csrf_token,controller.signal);if(!mounted.current||controller.signal.aborted||token!==generation.current)return;
      await accepted(command.client_command_id,admitted,admitted.replayed?'已受理：已核对原操作结果。':'已受理报修。');
    }catch(error){
      if(!mounted.current||controller.signal.aborted||token!==generation.current)return;
      if(error instanceof ApiError&&command.reporter.verification==='VERIFIED_SELECTION'){
        if(error.status===401)deny(error);else await retainCandidateRefusal(controller,token,command.client_command_id,error instanceof ConfirmedManualReportRejection&&error.commandId===command.client_command_id);return;
      }
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
  const candidatesEnabled=principal.reporter_candidates_enabled===true&&!manual;
  async function searchCandidates(cursor:string|null){
    if(!candidatesEnabled||selected||controlsDisabled)return;
    const query=value.name.trim();if([...query].length<2)return;
    candidateRequest.current?.abort();const controller=new AbortController(),token=generation.current;candidateRequest.current=controller;setSearching(true);setPage(null);setSearchMessage('正在查找可选择成员…');
    try{const found=await api.reporterCandidates(query,cursor,controller.signal);if(!mounted.current||controller.signal.aborted||token!==generation.current)return;setPage(found);setSearchMessage(found.candidates.length?'请明确选择本次报修人。':'没有找到可选择成员，可以继续手填。');}
    catch(error){if(!mounted.current||controller.signal.aborted||token!==generation.current)return;if(error instanceof ApiError&&[401,403,404].includes(error.status)){if(error.status===401)deny(error);else await retainCandidateRefusal(controller,token);return;}setSearchMessage('成员目录暂不可用，原输入已保留，可以继续手填。');}
    finally{if(candidateRequest.current===controller){candidateRequest.current=null;setSearching(false);}}
  }
  useEffect(()=>{
    setPage(null);setSearchMessage('');setSearching(false);candidateRequest.current?.abort();
    if(!candidatesEnabled||selected||controlsDisabled||[...value.name.trim()].length<2)return;
    const timer=window.setTimeout(()=>{void searchCandidates(null);},250);
    return()=>{window.clearTimeout(timer);candidateRequest.current?.abort();};
  },[candidatesEnabled,selected,value.name,controlsDisabled,principal.principal_id]);
  return <section className="workspace manual-report-page"><header className="page-title"><div><h1>新报修</h1><p>登记电话或现场报修，保存后继续复核或接单。</p></div><Link to="/" data-action="return-workbench" aria-disabled={blocked} onClick={event=>{if(blocked)event.preventDefault();}}>返回工作台</Link></header>
    {message?<div data-manual-report-result className="manual-report-receipt" role={state==='denied'||state==='unknown'?'alert':'status'}><h2>{message}</h2>{result?<><p>{result.ticket?'工单 '+result.ticket.number+' 已进入待接单队列。':result.review?'报修 '+result.intake_no+' 已保存，请继续人工复核。':'报修 '+result.intake_no+' 已保存原始情况。'}</p><p>{result.reporter_verification==='VERIFIED'?(result.manual_contact_required?'本次成员已核实，消息暂不可达，请人工联系。':'本次成员已核实，通知结果请在工单中查看。'):'报修人联系方式已记录，请通过电话或现场联系；不会自动发送消息。'}</p>
      <div className="manual-report-controls"><Link data-action="open-admitted-report" className="receipt-next" to={'/items/'+(result.ticket?'ticket/'+result.ticket.id:result.review?'review/'+result.review.id:'intake/'+result.intake_id)} aria-disabled={blocked} onClick={event=>{if(blocked)event.preventDefault();}}>{result.ticket?'打开工单并接单':result.review?'打开报修并复核':'查看已保存的报修'}</Link><button type="button" disabled={blocked} data-action="next-manual-report" onClick={()=>{setResult(null);setMessage('');setState('idle');}}>继续代录下一条</button></div></>:null}</div>:null}
    {!principal.manual_reports_enabled?<p role="status">电话与现场代录尚未开放。</p>:context.isPending?<p role="status">正在核验当前代录权限…</p>:context.isError&&!context.data?<p role="alert">{errorMessage(context.error)} <button onClick={()=>{void context.refetch();}}>重新读取代录权限</button></p>:<form data-manual-report-form hidden={Boolean(result&&!unresolved)} onSubmit={event=>{event.preventDefault();void submit();}}>
      <p className="manual-report-operator">代录人：{principal.display_name} <span>工作人员身份由当前会话记录。</span></p>
      <p className="manual-report-audience">{selected?'已明确选择报修人，提交时将重新核验身份及通知资格；本次受理不表示通知已送达。':'报修人身份未核实，需人工联系；本次不会自动通知。'}</p>
      {principal.ticket_self_handling_enabled?<label className="manual-report-check"><input type="checkbox" data-action="choose-manual-self-handling" checked={false} disabled={controlsDisabled||selectionIntent||Boolean(selected)} onChange={()=>{const captured=value;void(async()=>{await draft.discard();if(await hasExistingDraft({principal:principal.principal_id,kind:'intake',id:MANUAL_REPORT_DRAFT_ID,purpose:'manual-report'})){setMessage('原草稿清理尚未确认，请保留当前输入。');return;}onSelf(captured);})();}}/>由我处理{selectionIntent||selected?'（先明确改为手填报修人）':''}</label>:null}
      {selectionRequired&&!unresolved?<p role="status">{principal.reporter_candidates_enabled?'已恢复先前选择成员的意图，请重新选择报修人，或明确改为手填。':'成员选择当前不可用，先前选择不能继续提交；请明确改为手填。'}</p>:null}
      {!draft.operationId||pending?<fieldset disabled={controlsDisabled}><legend>本次报修情况</legend>
        <label>来源<select aria-label="报修来源" value={value.source} onChange={event=>change({...value,source:event.target.value==='ON_SITE'?'ON_SITE':'PHONE'})}><option value="PHONE">电话代录</option><option value="ON_SITE">现场代录</option></select></label>
                <div className="manual-report-fields"><label>报修人姓名<input aria-label="报修人姓名" role={candidatesEnabled?'combobox':undefined} aria-autocomplete={candidatesEnabled?'list':undefined} aria-controls={candidatesEnabled?'reporter-candidates':undefined} aria-expanded={candidatesEnabled?Boolean(page?.candidates.length):undefined} autoComplete="off" required value={value.name} onChange={event=>{setSelected(null);change({...value,name:event.target.value});}}/></label>{!selected?<label>联系方式<input aria-label="联系方式" required value={value.contact} onChange={event=>change({...value,contact:event.target.value})}/></label>:<p data-selected-reporter>已选择：{selected.display_name} · {selected.departments.join('、')||'未提供科室'}</p>}</div>
        {candidatesEnabled&&page?.candidates.length?<div id="reporter-candidates" role="listbox" aria-label="可选择报修人">{page.candidates.map(candidate=><button type="button" role="option" aria-selected={false} key={candidate.candidate_ref} onClick={()=>{setSelectionIntent(true);setSelected(candidate);change({...value,name:candidate.display_name});setPage(null);setSearchMessage('');}}>{candidate.display_name} · {candidate.departments.join('、')||'未提供科室'}</button>)}</div>:null}
        {searchMessage?<p role="status">{searchMessage}</p>:null}
        {candidatesEnabled&&page?.next_cursor?<button type="button" disabled={searching} onClick={()=>{void searchCandidates(page?.next_cursor??null);}}>下一页候选</button>:null}
        {(principal.reporter_candidates_enabled||selectionIntent)&&!manual?<button type="button" data-action="manual-reporter-fallback" onClick={()=>{setSelectionIntent(false);setSelected(null);setManual(true);setPage(null);setSearchMessage('');}}>改为手填报修人</button>:null}
        {!selected?<label>报修人科室（可不填）<input aria-label="报修人科室" value={value.department} onChange={event=>change({...value,department:event.target.value})}/></label>:null}
        <label>故障描述<textarea aria-label="故障描述" required rows={5} value={value.description} onChange={event=>change({...value,description:event.target.value})}/><small>最多4000字符；不填写患者资料、口令或其它敏感业务记录。</small></label>
        <label className="manual-report-check"><input type="checkbox" aria-label="位置暂不清楚" checked={value.unknown} onChange={event=>change({...value,unknown:event.target.checked})}/>位置暂不清楚</label>
        <label>位置<input aria-label="故障位置" required={!value.unknown} disabled={value.unknown||controlsDisabled} value={value.location} onChange={event=>change({...value,location:event.target.value})}/></label>
      </fieldset>:<p>原操作仍未知，敏感内容已清理；只能只读核对。</p>}
      <div className="manual-report-controls"><button type="submit" data-action="submit-manual-report" disabled={controlsDisabled||selectionRequired||!draft.canSubmit}>保存并受理</button>
        {unresolved?<button type="button" data-action="check-manual-report-receipt" disabled={busy} onClick={()=>{void check();}}>核对上次操作</button>:null}
        {draft.enabled&&hasManualReportInput(value)&&!unresolved?<button type="button" disabled={busy} data-action="discard-manual-report-draft" onClick={()=>{void draft.discard();}}>丢弃草稿内容</button>:null}
        <button type="button" disabled={busy} data-action="refresh-manual-report-authority" onClick={()=>{void context.refetch();}}>重新读取代录权限</button>
      </div>
    </form>}
    {draft.enabled?<p data-manual-report-draft-status role="status">{draft.message}</p>:null}
  </section>;
}
