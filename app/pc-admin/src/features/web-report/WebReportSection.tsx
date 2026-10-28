import {WorkbenchButton as HButton} from '../../app/WorkbenchButton';
import {Checkbox as HCheckbox,Form as HForm,Input as HInput,Label as HLabel,TextArea as HTextArea} from "@heroui/react";
import {ToastFeedback,useFeedbackState} from '../../app/ToastFeedback';
import {useEffect,useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {api,ApiError,captureWorkbenchRead,errorMessage,workbenchTransportWritable} from '../../api/client';
import type {Principal} from '../../api/client';
import type {WorkbenchMemberProgressInput} from '../../../../../contracts/workbench_web_report_contracts';
import {clearItemAuthorization,clearSessionAuthorization} from '../../app/authorization';
import {MemberProgressRejected,webReportApi} from './client';
import {DetailDialog} from '../../app/DetailDialog';
import type {WebReportQuery} from './use-web-report';

type Outcome='idle'|'preparing'|'submitting'|'unknown'|'checking'|'failed'|'committed';
export function WebReportSection({principal,kind,id,requested,readReady,otherBlocked,onBlockedChange,view}:{view:WebReportQuery;principal:Principal;kind:'ticket'|'review'|'intake';id:string;requested:{kind:'ticket'|'review'|'intake';id:string};readReady:boolean;otherBlocked:boolean;onBlockedChange:(value:boolean)=>void}){
 const client=useQueryClient(),key=['web-report',principal.principal_id,kind,id],request=useRef<AbortController|null>(null),alive=useRef(true),epoch=useRef(0);
 const [open,setOpen]=useState(false),[lastReadError,setLastReadError]=useState<unknown>(null);
 const [summary,setSummary]=useState(''),[eta,setEta]=useState(''),[confirmed,setConfirmed]=useState(false),[notice,setNotice,noticeRevision]=useFeedbackState(''),[outcome,setOutcome]=useState<Outcome>('idle'),[pending,setPending]=useState<Readonly<WorkbenchMemberProgressInput>|null>(null),[receiptId,setReceiptId]=useState<string|null>(null),[checked,setChecked]=useState(false),[capturedVersion,setCapturedVersion]=useState<number|null>(null),[denied,setDenied]=useState(false);
 useEffect(()=>{if(view.isError)setLastReadError(view.error);else if(view.isSuccess)setLastReadError(null);},[view.error,view.isError,view.isSuccess]);
 const clearSensitive=()=>{epoch.current++;request.current?.abort();setOpen(false);setSummary('');setEta('');setConfirmed(false);setCapturedVersion(null);setPending(null);setOutcome(previous=>previous==='committed'?'committed':'unknown');setDenied(true);};
 const revokeRead=(error:ApiError)=>{clearSensitive();if(error.status===401)void clearSessionAuthorization(client,principal.principal_id,401,'revoked');else{void clearItemAuthorization(client,principal.principal_id,kind,id,error);if(requested.kind!==kind||requested.id!==id)void clearItemAuthorization(client,principal.principal_id,requested.kind,requested.id,error);}};
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;epoch.current++;request.current?.abort();};},[]);
 const busy=['preparing','submitting','checking'].includes(outcome),blocked=busy||receiptId!==null||Boolean(summary||eta);
 useEffect(()=>{onBlockedChange(blocked);return()=>onBlockedChange(false);},[blocked,onBlockedChange]);
 useEffect(()=>{if(view.error instanceof ApiError&&[401,403,404].includes(view.error.status))revokeRead(view.error);},[view.error]);
 useEffect(()=>{if(view.data&&!view.data.applicable){epoch.current++;request.current?.abort();setSummary('');setEta('');setConfirmed(false);setPending(null);setCapturedVersion(null);setOutcome(receiptId?'unknown':'idle');}},[view.dataUpdatedAt]);
 // Public-progress input shares the canonical and original-route READ boundary.
 useEffect(()=>client.getQueryCache().subscribe(event=>{const q=event.query.queryKey,error=event.query.state.error;if(event.type==='updated'&&q[1]===principal.principal_id&&(q[0]==='detail'||q[0]==='web-report')&&(q[2]===kind&&q[3]===id||q[2]===requested.kind&&q[3]===requested.id)&&error instanceof ApiError&&[401,403,404].includes(error.status))clearSensitive();}),[client,principal.principal_id,kind,id,requested.kind,requested.id]);
 const refresh=()=>{void client.invalidateQueries({queryKey:key,exact:true});void client.invalidateQueries({queryKey:['detail',principal.principal_id,kind,id]});void client.invalidateQueries({queryKey:['board',principal.principal_id]});void client.invalidateQueries({queryKey:['ticket-command-context',principal.principal_id,id]});};
 const settle=()=>{setOutcome('committed');setPending(null);setReceiptId(null);setSummary('');setEta('');setConfirmed(false);setCapturedVersion(null);setChecked(false);setNotice('公开进度已保存，报修人可在页面查看。');setOpen(false);refresh();};
 async function authorize(signal:AbortSignal,write:boolean){const current=captureWorkbenchRead(signal),fresh=await api.bootstrap(signal);current();if(fresh.principal_id!==principal.principal_id||!fresh.web_reports_enabled)throw new ApiError(401,'AUTHORIZATION_REJECTED');client.setQueryData(['session'],fresh);const detail=await webReportApi.view(kind,id,signal);current();client.setQueryData(key,detail);if(write&&!detail.can_publish_progress)throw new ApiError(403,'WRITE_AUTHORIZATION_REJECTED');return {fresh,detail};}
 const send=async(original:Readonly<WorkbenchMemberProgressInput>,replay=false)=>{
  if(request.current||kind!=='ticket')return;const abort=new AbortController(),generation=epoch.current,current=captureWorkbenchRead(abort.signal);request.current=abort;setOutcome('preparing');setNotice('正在核验当前处理权限…');let sent=false;
  const active=()=>{current();if(!alive.current||generation!==epoch.current)throw new DOMException('WEB_REPORT_SCOPE_CHANGED','AbortError');};
  try{const {fresh,detail}=await authorize(abort.signal,true);active();if(!replay&&detail.ticket_version!==original.expected_version)throw new MemberProgressRejected(409,'YXX_VERSION_CONFLICT');if(!workbenchTransportWritable()||!navigator.onLine)throw new ApiError(503,'WORKBENCH_OFFLINE');setPending(original);setReceiptId(original.client_command_id);setOutcome('submitting');sent=true;await webReportApi.publish(id,original,fresh.csrf_token,abort.signal);active();settle();}
  catch(error){if(!alive.current||generation!==epoch.current)return;
   if(error instanceof ApiError&&error.status===401){revokeRead(error);setNotice('会话需要重新核验。原操作结果仍须核对。');setOutcome(pending||sent?'unknown':'failed');return;}
   if(!sent&&!replay||error instanceof MemberProgressRejected&&!replay){setOutcome('failed');setPending(null);setReceiptId(null);setConfirmed(false);setNotice(error instanceof ApiError&&error.status===403?'当前处理权限已变化，请重新读取。':'本次未提交成功，请重新读取版本并确认公开内容。');refresh();}
   else{setOutcome('unknown');setPending(original);setReceiptId(original.client_command_id);setChecked(false);setNotice('提交结果尚未确认。已保留原操作，请先核对结果。');}
  }finally{if(request.current===abort)request.current=null;}
 };
 const check=async()=>{if(!receiptId||request.current||kind!=='ticket')return;const abort=new AbortController(),generation=epoch.current,current=captureWorkbenchRead(abort.signal);request.current=abort;setOutcome('checking');
  try{await authorize(abort.signal,false);current();const result=await webReportApi.receipt(id,receiptId,abort.signal);current();if(!alive.current||generation!==epoch.current)return;setDenied(false);if(result.state==='COMMITTED')settle();else{setOutcome('unknown');setChecked(true);setNotice('原操作仍没有明确结果。可以继续核对，或明确重试原操作。');}}
  catch(error){if(!alive.current||generation!==epoch.current)return;if(error instanceof ApiError&&[401,403,404].includes(error.status))revokeRead(error);setOutcome('unknown');setNotice('本次核对未完成，原操作保持。');}
  finally{if(request.current===abort)request.current=null;}
 };
 if(!principal.web_reports_enabled)return null;
 if(denied)return <div className="web-report-details" aria-label="报修资料读取状态"><p role="status">当前报修资料已停止展示，请重新核验权限。</p>{receiptId?<HButton type="button" isDisabled={busy} onClick={()=>{void check();}} variant="secondary">只读核对原操作结果</HButton>:<HButton type="button" isDisabled={view.isFetching} onClick={()=>{void view.refetch().then(result=>{if(result.isSuccess)setDenied(false);});}} variant="secondary">重新核验读取权限</HButton>}</div>;
 if(!view.data){const error=lastReadError??view.error;return error?<div className="web-report-details"><p role="status">{errorMessage(error)}</p><HButton type="button" isDisabled={view.isFetching} onClick={()=>{void view.refetch();}} variant="secondary">重试读取报修资料</HButton>{receiptId?<HButton type="button" isDisabled={busy} onClick={()=>{void check();}} variant="secondary">只读核对原操作结果</HButton>:null}</div>:null;}
 if(!view.data.applicable)return receiptId?<div aria-label="公开进度原操作"><p role="status">报修资料当前不可用，原操作仍需核对。</p><HButton type="button" isDisabled={busy} onClick={()=>{void check();}} variant="secondary">只读核对原操作结果</HButton></div>:null;
 const data=view.data,locked=busy||receiptId!==null||otherBlocked||!readReady||!data.can_publish_progress||!workbenchTransportWritable(),changedVersion=capturedVersion!==null&&capturedVersion!==data.ticket_version;
 const edited=()=>{setConfirmed(false);if(capturedVersion===null)setCapturedVersion(data.ticket_version);if(outcome==='committed')setOutcome('idle');};
 if(!data.contact_requested&&!data.public_progress&&!data.evaluation&&!data.can_publish_progress&&!summary&&!eta&&!receiptId&&!notice&&!view.isError)return null;
 return <div className="web-report-details">
  {view.isError?<p role="status">资料暂未更新，保留最近已确认内容。<HButton type="button" isDisabled={view.isFetching} onClick={()=>{void view.refetch();}} variant="secondary">重试</HButton></p>:null}
  {data.contact_requested?<p className="web-contact-request">报修人请求主动联系。请使用已有联系方式或原获权渠道联系。</p>:null}
  {data.public_progress?<section aria-label="报修人可见进度"><h4>报修人可见进度</h4><p className="web-public-text">{data.public_progress.summary}</p>{data.public_progress.estimated_at?<p>预计完成：{data.public_progress.estimated_at}（北京时间）</p>:null}<small>更新于 {data.public_progress.updated_at}（北京时间）</small></section>:null}
  {data.evaluation?<section aria-label="报修人评价"><h4>本轮评价</h4><p>{data.evaluation.rating} / 5 星</p>{data.evaluation.comment?<p className="web-public-text">{data.evaluation.comment}</p>:null}<small>{data.evaluation.evaluated_at}（北京时间）</small></section>:null}
  {kind==='ticket'&&(data.can_publish_progress||summary||eta||receiptId)?<HButton type="button" className="report-progress-trigger" data-action="open-public-progress" isDisabled={busy||otherBlocked&&!receiptId&&!summary&&!eta||!readReady&&!receiptId} onClick={()=>setOpen(true)} variant="secondary">{receiptId?'核对公开进度':summary||eta?'继续编辑公开进度':'更新公开进度'}</HButton>:null}
  {!open&&(summary||eta)&&!receiptId?<p className="detail-inline-state">有未提交的公开进度，可继续编辑或丢弃。</p>:null}

  <DetailDialog open={open} onClose={()=>setOpen(false)} closeBlocked={busy} title="更新公开进度" closeLabel="关闭公开进度窗口" className="detail-action-dialog detail-progress-dialog">
  {kind==='ticket'&&(data.can_publish_progress||summary||receiptId)?<HForm onSubmit={event=>{event.preventDefault();if(locked||!confirmed||!summary.trim()||[...summary.trim()].length>500||changedVersion||capturedVersion===null)return;const command=Object.freeze({client_command_id:crypto.randomUUID(),expected_version:capturedVersion,summary:summary.trim(),estimated_at:eta?eta.replace('T',' ')+':00':null});void send(command);}} aria-label="维护公开进度"><p>公开内容会展示给报修人。请单独填写并确认，勿复制内部备注。</p><HLabel>公开进度<HTextArea aria-label="公开进度" maxLength={1000} value={summary} disabled={locked} onChange={event=>{edited();setSummary(event.target.value);}}/><small>{[...summary].length}/500</small></HLabel><HLabel>预计完成时间（北京时间，可选）<HInput aria-label="预计完成时间" type="datetime-local" step="60" value={eta} disabled={locked} onChange={event=>{edited();setEta(event.target.value);}}/></HLabel>{summary.trim()?<div className="web-progress-preview"><strong>公开预览</strong><p className="web-public-text">{summary.trim()}</p>{eta?<p>预计完成：{eta.replace('T',' ')}（北京时间）</p>:null}<HCheckbox aria-label="确认公开进度内容" isSelected={confirmed} isDisabled={locked} onChange={event=>setConfirmed(event)}><HCheckbox.Content><HCheckbox.Control><HCheckbox.Indicator/></HCheckbox.Control>我已确认以上内容可向报修人公开</HCheckbox.Content></HCheckbox></div>:null}{changedVersion?<p role="status">工单版本已变化。请重新核对当前资料并确认内容。</p>:null}<div className="note-controls"><HButton type="submit" isDisabled={locked||!confirmed||!summary.trim()||[...summary.trim()].length>500||changedVersion||capturedVersion===null} variant="secondary">保存公开进度</HButton>{!busy&&!pending&&(summary||eta)?<><HButton type="button" isDisabled={!readReady||!data.can_publish_progress} onClick={()=>{setCapturedVersion(data.ticket_version);setConfirmed(false);setOutcome('idle');}} variant="secondary">采用当前版本并重新确认</HButton><HButton type="button" onClick={()=>{setSummary('');setEta('');setConfirmed(false);setCapturedVersion(null);}} variant="secondary">丢弃未提交内容</HButton></>:null}</div></HForm>:null}
    {receiptId?<div className="note-controls"><HButton type="button" isDisabled={busy} onClick={()=>{void check();}} variant="secondary">核对原操作结果</HButton>{outcome==='unknown'&&checked&&pending&&data.can_publish_progress?<HButton type="button" isDisabled={busy||!readReady} onClick={()=>{void send(pending,true);}} variant="secondary">明确重试原操作</HButton>:null}</div>:null}
  </DetailDialog>{notice?<ToastFeedback revision={noticeRevision} source="web-report" state={outcome} role={outcome==='unknown'||outcome==='failed'?'alert':'status'}>{notice}</ToastFeedback>:null}
 </div>;
}
