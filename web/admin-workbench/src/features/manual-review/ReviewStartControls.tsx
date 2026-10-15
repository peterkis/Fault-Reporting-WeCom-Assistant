import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {api,ApiError,errorMessage,captureWorkbenchRead} from '../../api/client';
import type {Principal} from '../../api/client';
import {clearSessionAuthorization} from '../../app/authorization';
import {reviewStartApi} from './start-client';
import type {ReviewResolveAndStartCommand,ReviewResolveAndStartResult} from './start-client';
import type {ReviewInput} from './use-review-draft';

type Capture={ticket:ReviewResolveAndStartCommand['expected_ticket'];team:string};
export function ReviewStartControls({principal,reviewId,value,available,request,onBlockedChange,onStarted}:{principal:Principal;reviewId:string;value:ReviewInput;available:boolean;request:{current:AbortController|null};onBlockedChange:(value:boolean)=>void;onStarted:()=>void}){
  const client=useQueryClient(),generation=useRef(0),mounted=useRef(true),adopted=useRef<ReviewInput['capture']>(null);
  const [capture,setCapture]=useState<Capture|null>(null),[choice,setChoice]=useState<'TAKE_SELECTED'|'RETAIN_CURRENT'>('TAKE_SELECTED'),[selected,setSelected]=useState<ReviewResolveAndStartCommand['sessions']>([]);
  const [pending,setPending]=useState<ReviewResolveAndStartCommand|null>(null),[result,setResult]=useState<ReviewResolveAndStartResult|null>(null),[state,setState]=useState<'idle'|'submitting'|'unknown'|'failed'|'denied'|'succeeded'>('idle'),[message,setMessage]=useState('');
  const key=['review-start-context',principal.principal_id,reviewId] as const;
  const context=useQuery({queryKey:key,queryFn:async({signal})=>{const current=await reviewStartApi.context(reviewId,signal),sessions=current.expected_ticket?await api.relatedConversations(current.expected_ticket.ticket_id,null,signal):{items:[],next_cursor:null};return {...current,sessions};}});
  const busy=state==='submitting';
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;request.current?.abort();};},[]);
  useEffect(()=>{onBlockedChange(busy||Boolean(pending));return()=>onBlockedChange(false);},[busy,pending,onBlockedChange]);
  useEffect(()=>{
    if(!context.data||!value.capture||pending||adopted.current===value.capture)return;
    adopted.current=value.capture;const current=context.data;
    setCapture({ticket:current.expected_ticket,team:current.resolver_team_id??(current.resolver_teams.length===1?current.resolver_teams[0]?.team_id??'':'')});
    setState('idle');
    setSelected(previous=>previous.flatMap(s=>{const actual=current.sessions.items.find(row=>row.session_id===s.session_id&&row.take_allowed);return actual?[{session_id:s.session_id,expected_row_version:Number(actual.session_row_version)}]:[];}));
  },[context.data,value.capture,pending]);
  const deny=(error:ApiError)=>{
    generation.current++;request.current?.abort();request.current=null;setCapture(null);setSelected([]);setPending(null);setResult(null);setState('denied');setMessage('当前确认并开始用途不可用，已清除此用途的操作内容。');
    if(error.status===401)void clearSessionAuthorization(client,principal.principal_id,401,'revoked');
    else{const query=client.getQueryCache().find({queryKey:key,exact:true});query?.setState({data:undefined,dataUpdatedAt:0,error,status:'error',fetchStatus:'idle'});}
  };
  useEffect(()=>{if(context.error instanceof ApiError&&[401,403,404].includes(context.error.status))deny(context.error);},[context.error]);
  async function send(command:ReviewResolveAndStartCommand){
    if(request.current)return;const controller=new AbortController(),token=generation.current,current=captureWorkbenchRead(controller.signal);request.current=controller;setPending(command);setState('submitting');setMessage('正在确认复核、处理责任与明确选择的沟通责任…');
    let bootstrap=false;
    try{
      bootstrap=true;const fresh=await api.bootstrap(controller.signal);current();bootstrap=false;
      if(fresh.principal_id!==principal.principal_id)throw new ApiError(401,'IDENTITY_CHANGED');
      if(!fresh.manual_review_resolve_and_start_enabled)throw new ApiError(403,'PURPOSE_DISABLED');
      const committed=await reviewStartApi.perform(reviewId,command,fresh.csrf_token,controller.signal);current();
      if(!mounted.current||generation.current!==token)return;
      setResult(committed);setPending(null);setState('succeeded');setMessage('已确认明确故障并开始处理；原工单与实际沟通责任已在一次操作中记录。');onStarted();
    }catch(error){
      if(!mounted.current||generation.current!==token)return;
      if(controller.signal.aborted)return;
      try{current();}catch{return;}
      if(error instanceof ApiError){if([401,403,404].includes(error.status)){if(bootstrap&&error.status===403)void clearSessionAuthorization(client,principal.principal_id,403,'revoked');else deny(error);return;}
        setPending(null);setState('failed');setMessage('此次操作未完成：'+errorMessage(error)+'。已保留明确选择；请读取当前事实后重新采用材料。');
      }else{setState('unknown');setMessage('结果未知：原UUID、材料、版本与选择保持不变。不会自动提交，请明确核对原操作。');}
    }finally{if(request.current===controller)request.current=null;}
  }
  const changed=Boolean(context.data&&capture&&(capture.ticket?.ticket_id!==context.data.expected_ticket?.ticket_id||capture.ticket?.expected_version!==context.data.expected_ticket?.expected_version
    ||selected.some(s=>!context.data?.sessions.items.some(current=>current.session_id===s.session_id&&current.session_row_version===String(s.expected_row_version)&&current.take_allowed))));
  const canSubmit=available&&!changed&&context.data?.allowed&&value.choice==='CONFIRM_TICKET_ELIGIBLE'&&value.reason&&value.capture&&capture?.team&&!busy&&!pending&&state==='idle'
    &&(choice==='RETAIN_CURRENT'||selected.length>0);
  if(context.isPending)return <p role="status">正在核对确认并开始用途及真实责任选择…</p>;
  if(context.isError)return <p role="alert">{errorMessage(context.error)} <button type="button" onClick={()=>{void context.refetch();}}>重新核对确认并开始权限</button></p>;
  return <section data-review-start-controls aria-label="确认明确故障并开始处理">
    <h4>确认明确故障并开始处理</h4><p>只用于已明确为故障的材料；描述不足仍可记录澄清结论。不会先提交其他责任命令。</p>
    <label>本次处理组 <select aria-label="确认并开始的处理组" value={capture?.team??''} disabled={busy||Boolean(pending)||Boolean(capture?.ticket)||state==='succeeded'} onChange={event=>setCapture(previous=>previous?{...previous,team:event.target.value}:previous)}>
      <option value="">请选择处理组</option>{context.data.resolver_teams.map(team=><option key={team.team_id} value={team.team_id}>{team.display_name}</option>)}
    </select></label>
    <label><input type="radio" name={'review-start-communication-'+reviewId} checked={choice==='TAKE_SELECTED'} disabled={busy||Boolean(pending)||state==='succeeded'} onChange={()=>setChoice('TAKE_SELECTED')}/>同时承接下方明确选择的真实沟通会话</label>
    <label><input type="radio" name={'review-start-communication-'+reviewId} checked={choice==='RETAIN_CURRENT'} disabled={busy||Boolean(pending)||state==='succeeded'} onChange={()=>{setChoice('RETAIN_CURRENT');setSelected([]);}}/>保留当前沟通责任</label>
    <p>已选择 {selected.length} 个会话（最多8个）。</p>
    {changed?<p role="alert">处理或沟通版本已变化；原选择仍保留，请读取后明确重新采用当前材料。</p>:null}
    {context.data.sessions.items.map(session=><label key={session.session_id}><input type="checkbox" data-session-choice={session.session_id} checked={selected.some(s=>s.session_id===session.session_id)}
      disabled={!session.take_allowed||choice!=='TAKE_SELECTED'||busy||Boolean(pending)||state==='succeeded'||selected.length>=8&&!selected.some(s=>s.session_id===session.session_id)}
      onChange={event=>setSelected(previous=>event.target.checked?[...previous,{session_id:session.session_id,expected_row_version:Number(session.session_row_version)}]:previous.filter(s=>s.session_id!==session.session_id))}/>{session.conversation_principal_name??'尚未分配沟通人'} · 会话版本 {session.session_row_version}</label>)}
    {context.data.sessions.next_cursor?<p>只展示当前有权会话的第一页；此页未选择的会话不会被更改。</p>:null}
    <button type="button" data-action="resolve-and-start-review" disabled={!canSubmit} onClick={()=>{if(!canSubmit||!value.capture||!capture)return;void send(Object.freeze({client_command_id:crypto.randomUUID(),expected_row_version:value.capture.row_version,
      expected_material_basis:value.capture.material_basis,resolution_code:'CONFIRM_TICKET_ELIGIBLE',resolution_reason_code:value.reason,expected_ticket:capture.ticket?Object.freeze({...capture.ticket}):null,resolver_team_id:capture.team,communication_choice:choice,sessions:Object.freeze(selected.map(session=>Object.freeze({...session})))}));}}>确认明确故障并开始处理</button>
    <button type="button" data-action="refresh-review-start" disabled={busy} onClick={()=>{void context.refetch();}}>重新读取处理与沟通选择</button>
    {state==='unknown'&&pending?<button type="button" data-action="replay-review-start" disabled={busy} onClick={()=>{void send(pending);}}>明确重放原UUID与原意图</button>:null}
    {message?<p data-review-start-result role={state==='unknown'||state==='failed'||state==='denied'?'alert':'status'}>{message}</p>:null}
    {result?<p>本次处理事件已记录；当前状态以重新读取的事项为准。</p>:null}
  </section>;
}
