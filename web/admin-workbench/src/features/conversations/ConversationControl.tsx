import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {ApiError,errorMessage,workbenchTransportWritable} from '../../api/client';
import type {Principal} from '../../api/client';
import {clearItemAuthorization} from '../../app/authorization';
import {conversations} from './client';
import type {ConversationControlCommand,ConversationWorkspaceEntry} from './client';
export function ConversationControl({entry,principal,onBlockedChange,chat=false,takeoverLabel='我来接待'}:{entry:ConversationWorkspaceEntry;principal:Principal;onBlockedChange:(value:boolean)=>void;chat?:boolean;takeoverLabel?:string}){
  const client=useQueryClient(),request=useRef<AbortController|null>(null),generation=useRef(0);
  const [target,setTarget]=useState(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[pending,setPending]=useState<{action:string;command:ConversationControlCommand}|null>(null);
  const id=entry.session.session_id,canTransfer=entry.capabilities.some(v=>['TRANSFER','FORCE_TRANSFER'].includes(v));
  const eligible=useQuery({queryKey:['conversation-eligible',principal.principal_id,id],queryFn:({signal})=>conversations.eligible(id,signal),enabled:canTransfer});
  useEffect(()=>{onBlockedChange(busy||Boolean(pending));return()=>onBlockedChange(false);},[busy,pending,onBlockedChange]);
  useEffect(()=>()=>{generation.current++;request.current?.abort();},[]);
  useEffect(()=>{if(!busy&&!pending)return;const warn=(e:BeforeUnloadEvent)=>e.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[busy,pending]);
  async function act(action:string,force=false,saved?:{action:string;command:ConversationControlCommand}){
    if(!saved&&!workbenchTransportWritable()){setNotice('连接尚未完成事实核验，新沟通操作尚未准备或发送；选择已保留，请重新读取。');return;}
    if(request.current)return;const controller=new AbortController(),token=generation.current;request.current=controller;setBusy(true);
    const attempt=saved??{action,command:Object.freeze({client_command_id:crypto.randomUUID(),expected_row_version:entry.session.row_version,...(action==='transfer'?{target_principal_id:target,force}:{}),...(force?{reason_code:reason}:{}),...(entry.handoff&&['takeover','handoff/cancel'].includes(action)?{handoff_id:entry.handoff.handoff_id}:{})})};
    try{await conversations.control(id,attempt.action,attempt.command,principal.csrf_token,controller.signal);if(generation.current!==token||controller.signal.aborted)return;setPending(null);setNotice('沟通操作已确认；处理责任与工单状态另行管理。');}
    catch(error){if(generation.current!==token||controller.signal.aborted)return;if(error instanceof ApiError){setPending(null);setNotice(errorMessage(error));if([403,404].includes(error.status))void clearItemAuthorization(client,principal.principal_id,'conversation',id,error);}else{setPending(attempt);setNotice('操作结果未知：保留原命令，请核对当前沟通事实后用原命令核对。');}}
    finally{if(request.current===controller){request.current=null;setBusy(false);void client.invalidateQueries({predicate:q=>q.queryKey[1]===principal.principal_id&&['conversation-view','conversation-chat','conversation-related','conversation-inbox'].includes(String(q.queryKey[0]))});}}
  }
  const disabled=busy||Boolean(pending);
  return <section className="conversation-controls" aria-label="沟通责任"><h3>沟通责任</h3><p>{entry.assignment.assigned_display_name??'暂未分配沟通人'}{entry.assignment.assigned_to_me?'（我负责沟通）':''} · {entry.session.control_mode==='HUMAN'?'人工沟通':entry.session.control_mode}</p>
    <div className="note-controls">
      {entry.capabilities.includes('TAKEOVER')?<button disabled={disabled} onClick={()=>void act('takeover')} data-action="takeover-conversation">{chat?takeoverLabel:'接管沟通'}</button>:null}
      {entry.capabilities.includes('RELEASE')?<button disabled={disabled} onClick={()=>void act('release')}>释放沟通责任</button>:null}
      {entry.capabilities.includes('REQUEST_HANDOFF')?<button disabled={disabled} onClick={()=>void act('handoff/request')}>请求人工接管</button>:null}
      {entry.capabilities.includes('CANCEL_HANDOFF')?<button disabled={disabled} onClick={()=>void act('handoff/cancel')}>取消人工接管请求</button>:null}
    </div>{canTransfer?<div className="transfer-controls"><label>转派给<select aria-label="沟通转派对象" disabled={disabled||eligible.isError} value={target} onChange={e=>setTarget(e.target.value)}><option value="">选择当前获权工作人员</option>{eligible.data?.items.filter(p=>p.principal_id!==principal.principal_id).map(p=><option value={p.principal_id} key={p.principal_id}>{p.display_name}</option>)}</select></label>
      {entry.capabilities.includes('TRANSFER')?<button disabled={disabled||!target} onClick={()=>void act('transfer')}>转派沟通</button>:null}
      {entry.capabilities.includes('FORCE_TRANSFER')?<><label>强制转派原因码<input aria-label="强制转派原因码" maxLength={64} value={reason} onChange={e=>setReason(e.target.value)}/></label><button disabled={disabled||!target||! /^[A-Z][A-Z0-9_]{0,63}$/u.test(reason)} onClick={()=>void act('transfer',true)}>强制转派沟通</button></>:null}{eligible.isError?<p role="alert">{errorMessage(eligible.error)}</p>:null}</div>:null}
    {pending?<button disabled={busy} onClick={()=>void act(pending.action,false,pending)}>用保留的原命令核对</button>:null}<p role="status">{notice}</p>
  </section>;
}
