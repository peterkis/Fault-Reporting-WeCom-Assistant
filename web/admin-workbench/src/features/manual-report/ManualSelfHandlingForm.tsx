import {useEffect,useRef,useState} from 'react';
import {Link} from 'react-router';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {api,ApiError,errorMessage,workbenchTransportWritable} from '../../api/client';
import type {Principal} from '../../api/client';
import {clearSessionAuthorization} from '../../app/authorization';
import {MANUAL_REPORT_DRAFT_ID,emptyManualReportInput,hasManualReportInput,decodeManualReportInput} from '../../../../../src/workbench-manual-report-browser-contracts.mjs';
import type {ManualReportInput} from '../../../../../src/workbench-manual-report-browser-contracts.mjs';
import {MANUAL_SELF_HANDLING_PURPOSE,manualSelfHandlingCommand,decodeManualSelfHandlingResult} from '../../../../../src/workbench-manual-self-handling-browser-contracts.mjs';
import type {ManualReportSelfHandlingCommand,ManualReportSelfHandlingResult} from '../../../../../src/workbench-manual-self-handling-browser-contracts.mjs';
import {hasExistingDraft} from '../drafts/encrypted-drafts';
import {ConfirmedManualSelfHandlingFailure,manualSelfHandlingApi} from './self-handling-client';
import {manualSelfHandlingContextKey,useManualSelfHandlingDraft} from './use-manual-self-handling-draft';
type State='idle'|'submitting'|'checking'|'unknown'|'succeeded'|'denied';
export function ManualSelfHandlingForm({principal,initialValue,onOrdinary,onBlockedChange}:{principal:Principal;initialValue:ManualReportInput;onOrdinary:(value:ManualReportInput)=>void;onBlockedChange:(blocked:boolean)=>void}){
  const client=useQueryClient(),[value,setValue]=useState(initialValue),[team,setTeam]=useState(''),[contextTeam,setContextTeam]=useState(''),[pending,setPending]=useState<ManualReportSelfHandlingCommand|null>(null),[state,setState]=useState<State>('idle'),[message,setMessage]=useState(''),[result,setResult]=useState<ManualReportSelfHandlingResult|null>(null);
  const request=useRef<AbortController|null>(null),epoch=useRef(0),mounted=useRef(true),allowed=principal.manual_reports_enabled&&principal.ticket_self_handling_enabled;
  const context=useQuery({queryKey:[...manualSelfHandlingContextKey(principal.principal_id),contextTeam],queryFn:({signal})=>manualSelfHandlingApi.context(signal,contextTeam||undefined),enabled:allowed});
  const draft=useManualSelfHandlingDraft({principal,value,team,pending,onRestore:copy=>{setValue(copy.value);setTeam(copy.team);setContextTeam(copy.team);setPending(copy.pending);if(copy.pending){setState('unknown');setMessage('结果未知：原输入、处理组和操作标识已恢复，请只读核对。');}},onOperation:()=>{setState('unknown');setMessage('原操作仍未知，敏感内容不可恢复；只能只读核对。');},onSensitiveClear:settled=>{if(!settled){epoch.current++;request.current?.abort();request.current=null;}setValue(emptyManualReportInput());setTeam('');setContextTeam('');setPending(null);setResult(null);setState('idle');setMessage('');}});
  const busy=state==='submitting'||state==='checking',unresolved=Boolean(pending||draft.operationId)||state==='unknown',blocked=(busy||unresolved||hasManualReportInput(value)||Boolean(team))&&!draft.safeToLeave;
  useEffect(()=>{onBlockedChange(blocked);return()=>onBlockedChange(false);},[blocked,onBlockedChange]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;epoch.current++;request.current?.abort();};},[]);
  useEffect(()=>{if(!blocked)return;const warn=(e:BeforeUnloadEvent)=>e.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[blocked]);
  async function refuse(error:ApiError){
    if(error.status===401){await clearSessionAuthorization(client,principal.principal_id,401,'revoked');return;}
    await draft.revoke();
  }
  useEffect(()=>{if(context.error instanceof ApiError&&[401,403,404].includes(context.error.status))void refuse(context.error);},[context.error]);
  async function accepted(id:string,result:ManualReportSelfHandlingResult,token:number){
    const cleaned=await draft.success(id);if(!mounted.current||token!==epoch.current)return;setPending(null);setValue(emptyManualReportInput());setTeam('');setResult(result);setState('succeeded');setMessage('已受理并开始处理。这是当时结果，当前进度请打开工单查看。'+(cleaned?'':' 提交结果尚待核对，请先核对上次操作。'));void client.invalidateQueries({queryKey:['board',principal.principal_id]});
  }
  async function submit(){
    if(request.current||unresolved||!draft.canSubmit||!context.data?.can_take_and_start||context.isError||!context.data.resolver_teams.some(t=>t.id===team))return;
    if(!workbenchTransportWritable()){setMessage('连接尚未完成事实核验，原输入保留；本次尚未发送。');return;}
    let command:ManualReportSelfHandlingCommand;try{command=manualSelfHandlingCommand(value,crypto.randomUUID(),team);}catch{setMessage('请填写报修人、联系方式、故障描述及位置，并明确选择本人处理组。');return;}
    if(new TextEncoder().encode(JSON.stringify(command)).length>16384){setMessage('报修内容过长，请减少文字后再提交。');return;}
    const controller=new AbortController(),token=epoch.current;let dispatched=false;request.current=controller;setPending(command);setState('submitting');setMessage('正在受理并开始处理…');
    try{
      await draft.prepare(command);if(controller.signal.aborted||token!==epoch.current)return;dispatched=true;
      const result=await manualSelfHandlingApi.submit(command,principal.csrf_token,controller.signal);if(!mounted.current||controller.signal.aborted||token!==epoch.current)return;await accepted(command.client_command_id,result,token);
    }catch(error){
      if(!mounted.current||controller.signal.aborted||token!==epoch.current)return;
      if(error instanceof ConfirmedManualSelfHandlingFailure){try{await draft.knownFailure(command.client_command_id);if(!mounted.current||controller.signal.aborted||token!==epoch.current)return;setPending(null);setState('denied');setMessage(error.code==='P2_016_SELF_HANDLING_STATE_CONFLICT'?'此报修需要先复核。本次未受理，工单和责任均未更改。填写内容已保留，请改为登记并复核。':'本次未受理，工单和责任均未更改。填写内容已保留。'+errorMessage(error));}catch{if(!mounted.current||controller.signal.aborted||token!==epoch.current)return;setState('unknown');setMessage('失败结果尚未确认。请先核对上次操作。');}}
      else if(error instanceof ApiError&&[401,403,404].includes(error.status))await refuse(error);
      else if(!dispatched){setPending(null);setState('denied');setMessage('恢复副本尚未保存，本次未发送；请保留当前输入。');}
      else{setState('unknown');setMessage('结果未知：报修可能已受理并开始。填写内容已保留。请先核对上次操作，避免重复提交。');}
    }finally{if(request.current===controller)request.current=null;}
  }
  async function check(){
    const id=pending?.client_command_id??draft.operationId;if(!id||request.current)return;const controller=new AbortController(),token=epoch.current;request.current=controller;setState('checking');
    try{const receipt=await api.manualReportReceipt(id,controller.signal);if(!mounted.current||controller.signal.aborted||token!==epoch.current)return;
      if(receipt.state==='COMMITTED')await accepted(id,decodeManualSelfHandlingResult(receipt.result,id),token);
      else if(receipt.state==='FAILED'){const cleaned=await draft.success(id,true);if(!mounted.current||controller.signal.aborted||token!==epoch.current)return;setPending(null);setState('denied');setMessage('已核对原操作失败，原输入保留；可明确新的操作。'+(cleaned?'':' 恢复副本清理未完成，禁止新提交。'));}
      else{setState('unknown');setMessage('结果仍未知，未找到终态不证明未提交；没有发送新的操作。');}
    }catch(error){if(!mounted.current||controller.signal.aborted||token!==epoch.current)return;if(error instanceof ApiError&&[401,403,404].includes(error.status))await refuse(error);else{setState('unknown');setMessage('只读核对失败，原操作保持未定；没有发送新操作。');}}
    finally{if(request.current===controller)request.current=null;}
  }
  const disabled=busy||unresolved||!allowed||context.isError||!context.data?.can_take_and_start||draft.restoring;
  const change=(next:ManualReportInput)=>{if(disabled)return;try{decodeManualReportInput(next);}catch{setMessage('这次修改包含控制字符或超过字段上限，原输入保留。');return;}setValue(next);setMessage('');setResult(null);setState('idle');};
  async function ordinary(){if(busy||unresolved)return;const copy=value;await draft.discard();if(await hasExistingDraft({principal:principal.principal_id,kind:'intake',id:MANUAL_REPORT_DRAFT_ID,purpose:MANUAL_SELF_HANDLING_PURPOSE})){setMessage('原草稿清理尚未确认，请保留当前输入。');return;}onOrdinary(copy);}
  return <section className="workspace manual-report-page"><header className="page-title"><div><h1>新报修</h1><p>电话或现场代录，受理后由本人立即处理。</p></div><Link to="/" data-action="return-workbench" aria-disabled={blocked} onClick={e=>{if(blocked)e.preventDefault();}}>返回工作台</Link></header>
    <form hidden={Boolean(result&&!unresolved)} data-manual-report-form onSubmit={e=>{e.preventDefault();void submit();}}><p className="manual-report-operator">代录人：{principal.display_name} <span>处理人固定当前工作人员。</span></p><p className="manual-report-audience">报修人身份未核实，需人工联系；本次不会自动通知。</p>
      <label className="manual-report-check"><input type="checkbox" data-action="choose-manual-self-handling" checked disabled={busy||unresolved} onChange={()=>{void ordinary();}}/>由我处理</label>
      {!allowed?<p role="alert">本人立即处理当前尚未开放。</p>:context.isError?<p role="alert">{errorMessage(context.error)}；原副本保留，请重新读取页面。</p>:null}
      {!draft.operationId||pending?<fieldset disabled={disabled}><legend>本次报修情况</legend>
        <label>本人处理组<select aria-label="本人处理组" required value={team} onChange={e=>setTeam(e.target.value)}><option value="">请选择本人当前处理组</option>{context.data?.resolver_teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <label>来源<select aria-label="报修来源" value={value.source} onChange={e=>change({...value,source:e.target.value==='ON_SITE'?'ON_SITE':'PHONE'})}><option value="PHONE">电话代录</option><option value="ON_SITE">现场代录</option></select></label>
        <div className="manual-report-fields"><label>报修人姓名<input aria-label="报修人姓名" required value={value.name} onChange={e=>change({...value,name:e.target.value})}/></label><label>联系方式<input aria-label="联系方式" required value={value.contact} onChange={e=>change({...value,contact:e.target.value})}/></label></div>
        <label>报修人科室（可不填）<input aria-label="报修人科室" value={value.department} onChange={e=>change({...value,department:e.target.value})}/></label><label>故障描述<textarea aria-label="故障描述" required rows={5} value={value.description} onChange={e=>change({...value,description:e.target.value})}/><small>最多4000字符；不填写患者资料、口令或其它敏感业务记录。</small></label>
        <label className="manual-report-check"><input type="checkbox" aria-label="位置暂不清楚" checked={value.unknown} onChange={e=>change({...value,unknown:e.target.checked})}/>位置暂不清楚</label><label>位置<input aria-label="故障位置" required={!value.unknown} disabled={disabled||value.unknown} value={value.location} onChange={e=>change({...value,location:e.target.value})}/></label>
      </fieldset>:<p>原操作仍未知，敏感内容已清理；只能只读核对。</p>}
      <div className="manual-report-controls"><button type="submit" data-action="submit-manual-self-handling" disabled={disabled||!team||!draft.canSubmit}>受理并由我开始处理</button>{unresolved?<button type="button" data-action="check-manual-report-receipt" disabled={busy} onClick={()=>{void check();}}>核对上次操作</button>:null}<button type="button" disabled={busy} onClick={()=>window.location.reload()}>重新读取页面</button></div>
    </form>{draft.enabled?<p data-manual-report-draft-status role="status">{draft.message}</p>:null}{message?<div data-manual-report-result className="manual-report-receipt" role={state==='denied'||state==='unknown'?'alert':'status'}><p>{message}</p>{result?<><p>工单 {result.ticket.number}。请按原联系方式联系报修人。</p><Link data-action="open-admitted-report" to={'/items/ticket/'+result.ticket.id} aria-disabled={blocked} onClick={e=>{if(blocked)e.preventDefault();}}>打开工单继续处理</Link></>:state==='denied'&&hasManualReportInput(value)&&!disabled?<button type="button" data-action="manual-report-review-fallback" onClick={()=>{void ordinary();}}>保留内容，改为登记并复核</button>:null}</div>:null}
  </section>;
}
