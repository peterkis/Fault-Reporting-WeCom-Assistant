import {useEffect,useRef,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {api,ApiError,errorMessage,workbenchTransportWritable} from '../../api/client';
import type {Principal,P2016AssignmentAction,P2016AssignmentCommand} from '../../api/client';
import {useAssignmentDraft,EMPTY_ASSIGNMENT} from './use-assignment-draft';
import type {AssignmentIntent,AssignmentInput} from './use-assignment-draft';

export function TicketAssignment({ticketId,principal,onBlockedChange}:{ticketId:string;principal:Principal;onBlockedChange:(blocked:boolean)=>void}){
  const client=useQueryClient(),request=useRef<AbortController|null>(null),generation=useRef(0);
  const [pending,setPending]=useState<AssignmentIntent|null>(null);
  const [team,setTeam]=useState(''),[person,setPerson]=useState(''),[choice,setChoice]=useState<P2016AssignmentCommand['communication_choice']|null>(null),[selected,setSelected]=useState<P2016AssignmentCommand['sessions']>([]),[cursor,setCursor]=useState<string|null>(null),[state,setState]=useState<'idle'|'submitting'|'unknown'|'conflict'|'denied'|'succeeded'>('idle'),[message,setMessage]=useState('');
  const context=useQuery({queryKey:['ticket-command-context',principal.principal_id,ticketId],queryFn:({signal})=>api.ticketCommandContext(ticketId,signal)});
  const targets=useQuery({queryKey:['ticket-assignment-targets',principal.principal_id,ticketId,team],queryFn:({signal})=>api.assignmentTargets(ticketId,team||null,signal),gcTime:0});
  const related=useQuery({queryKey:['ticket-related-conversations',principal.principal_id,ticketId,cursor],queryFn:({signal})=>api.relatedConversations(ticketId,cursor,signal),gcTime:0});
  const setInput=(value:AssignmentInput)=>{setTeam(value.team);setPerson(value.person);setChoice(value.choice);setSelected(value.sessions);};
  const draft=useAssignmentDraft({ticketId,principal,value:{team,person,choice,sessions:selected},pending,onRestore:copy=>{setInput(copy.value);setPending(copy.pending);if(copy.pending){setState('unknown');setMessage('结果未知：已恢复原操作，原动作与版本保持不变。');}},onSensitiveClear:()=>{generation.current++;request.current?.abort();request.current=null;setInput(EMPTY_ASSIGNMENT);setPending(null);setState('idle');setMessage('');},onOperation:()=>{setPending(null);setState('unknown');setMessage('结果未知：敏感恢复内容已清理，只能只读核对原操作。');}});
  const blocked=state==='submitting'||state==='unknown',navigationBlocked=blocked||(draft.enabled&&Boolean(team||person||choice||selected.length)&&!draft.safeToLeave);
  useEffect(()=>{onBlockedChange(navigationBlocked);return()=>onBlockedChange(false);},[navigationBlocked,onBlockedChange]);
  useEffect(()=>()=>{generation.current++;request.current?.abort();},[]);
  useEffect(()=>{if(!navigationBlocked)return;const warn=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[navigationBlocked]);
  const refresh=()=>{for(const key of [['ticket-command-context',principal.principal_id,ticketId],['ticket-related-conversations',principal.principal_id,ticketId],['ticket-assignment-targets',principal.principal_id,ticketId],['detail',principal.principal_id,'ticket',ticketId],['board',principal.principal_id]])void client.invalidateQueries({queryKey:key});};
  const mutation=useMutation({mutationKey:['ticket-assignment',principal.principal_id,ticketId],mutationFn:({intent,signal}:{intent:AssignmentIntent;signal:AbortSignal;token:number})=>api.assignTicket(ticketId,intent.action,intent.command,principal.csrf_token,signal),
    onSuccess:async(_result,variables)=>{if(variables.token!==generation.current)return;const cleaned=await draft.settle(variables.intent.command.client_command_id);setInput(EMPTY_ASSIGNMENT);setPending(null);setState('succeeded');setMessage('责任已交接，正在读取当前工单事实。'+(cleaned?'':' 恢复副本清理尚未确认，禁止新操作。'));refresh();},
    onError:async(error,variables)=>{if(variables.token!==generation.current)return;if(error instanceof ApiError){setPending(null);await draft.knownFailure(variables.intent.command.client_command_id).catch(()=>{});setState(error.status===409?'conflict':'denied');setMessage(error.status===409?'操作冲突，请重新读取工单与目标后明确确认。':errorMessage(error));if(error.status===409)refresh();}else{setPending(variables.intent);setState('unknown');setMessage('结果未知，原操作可能已提交；原动作、版本与选择保持不变，勿重复提交。');}},onSettled:()=>{request.current=null;}});
  const acknowledgement=useMutation({mutationKey:['ticket-assignment-ack',principal.principal_id,ticketId],mutationFn:({commandId,signal}:{commandId:string;signal:AbortSignal})=>api.assignmentAcknowledgement(ticketId,commandId,signal),onSuccess:async(result,variables)=>{if(result.state==='UNKNOWN'){setState('unknown');setMessage('结果仍未知，未找到终态不代表未提交；请继续只读核对。');return;}const cleaned=await draft.settle(variables.commandId);setInput(EMPTY_ASSIGNMENT);setPending(null);setState(result.state==='COMMITTED'?'succeeded':'conflict');setMessage((result.state==='COMMITTED'?'已核对原操作结果：已提交。':'已核对原操作失败，请读取当前事实后明确新的操作。')+(cleaned?'':' 恢复副本清理尚未确认，禁止新操作。'));refresh();},onError:()=>{setState('unknown');setMessage('只读核对失败，原操作仍未知；未发送新的操作。');},onSettled:()=>{request.current=null;}});
  const send=async(intent:AssignmentIntent,checking=false)=>{if(request.current||(!checking&&!workbenchTransportWritable()))return;const controller=new AbortController(),token=generation.current;request.current=controller;setPending(intent);setState('submitting');setMessage(checking?'正在核对原操作结果…':'正在提交责任交接…');try{await draft.prepare(intent);}catch{request.current=null;setState(checking?'unknown':'denied');setMessage('恢复存储尚未准备，本次未发送新的操作。');return;}if(!controller.signal.aborted&&generation.current===token)mutation.mutate({intent,signal:controller.signal,token});};
  const check=()=>{const commandId=pending?.command.client_command_id??draft.operationId;if(request.current||!commandId)return;if(!draft.enabled&&pending){void send(pending,true);return;}const controller=new AbortController();request.current=controller;setState('submitting');setMessage('正在只读核对原操作…');acknowledgement.mutate({commandId,signal:controller.signal});};
  const allowed=context.data?.allowed_actions??[],action:P2016AssignmentAction=allowed.includes('assign')?'assign':'transfer-assignment';
  const submit=()=>{if(blocked||!draft.canSubmit||request.current||!context.data||!allowed.includes(action)||context.isFetching||targets.isFetching||!workbenchTransportWritable()||!choice||(choice==='TRANSFER_SELECTED'&&(!selected.length||related.isFetching||related.isError))||!team||!targets.data?.items.some(item=>item.principal_id===person))return;
    void send(Object.freeze({action,command:Object.freeze({client_command_id:crypto.randomUUID(),expected_version:context.data.version,reason_code:action==='assign'?'WORKBENCH_ASSIGN':'WORKBENCH_TRANSFER',target_principal_id:person,resolver_team_id:team,communication_choice:choice,sessions:Object.freeze(choice==='RETAIN_CURRENT'?[]:selected.map(row=>Object.freeze({...row})))} )}));};
  const toggle=(sessionId:string,version:string,permitted:boolean)=>{if(blocked)return;setSelected(previous=>previous.some(row=>row.session_id===sessionId)?previous.filter(row=>row.session_id!==sessionId):permitted&&previous.length<8?[...previous,{session_id:sessionId,expected_row_version:Number(version)}]:previous);};
  return <section className="ticket-notes ticket-assignment" aria-label="工单派单与转派">
    <h3>交接处理责任</h3>
    {context.isError||targets.isError?<p role="alert">{errorMessage(context.error??targets.error)}</p>:null}
    <label>处理组<select value={team} disabled={blocked||targets.isFetching} onChange={event=>{setTeam(event.target.value);setPerson('');}}><option value="">请选择处理组</option>{targets.data?.resolver_teams.map(group=><option key={group.team_id} value={group.team_id}>{group.display_name}</option>)}</select></label>
    <label>处理人<select value={person} disabled={blocked||!team||targets.isFetching} onChange={event=>setPerson(event.target.value)}><option value="">请选择处理同事</option>{targets.data?.items.map(item=><option key={item.principal_id} value={item.principal_id}>{item.display_name}</option>)}</select></label>
    <fieldset disabled={blocked}><legend>沟通责任</legend>
      <label><input type="radio" name={'assignment-communication-'+ticketId} value="RETAIN_CURRENT" checked={choice==='RETAIN_CURRENT'} onChange={()=>setChoice('RETAIN_CURRENT')}/>保留当前沟通责任</label>
      <label><input type="radio" name={'assignment-communication-'+ticketId} value="TRANSFER_SELECTED" checked={choice==='TRANSFER_SELECTED'} onChange={()=>setChoice('TRANSFER_SELECTED')}/>将下方明确选择的沟通交给承接同事</label>
    </fieldset>
    {choice==='TRANSFER_SELECTED'?<>
      {related.isError?<p role="alert">{errorMessage(related.error)}</p>:null}
      <p>已选择 {selected.length} 个会话（最多 8 个）。</p>
      <ul className="conversation-choices">{related.data?.items.map(row=><li key={row.session_id}><label><input type="checkbox" data-session-choice={row.session_id} checked={selected.some(item=>item.session_id===row.session_id)} disabled={blocked||(!selected.some(item=>item.session_id===row.session_id)&&(!row.take_allowed||selected.length>=8))} onChange={()=>toggle(row.session_id,row.session_row_version,row.take_allowed)}/>{row.conversation_principal_name??'尚未分配沟通人'}<small>会话 {row.session_id} · 版本 {row.session_row_version}{!row.take_allowed?' · 当前不可交接':''}{selected.some(item=>item.session_id===row.session_id&&String(item.expected_row_version)!==row.session_row_version)?' · 已变更，请取消后重新选择':''}</small></label></li>)}</ul>
      {cursor?<button type="button" disabled={blocked||related.isFetching} onClick={()=>setCursor(null)}>回到首批会话</button>:null}
      {related.data?.next_cursor?<button type="button" disabled={blocked||related.isFetching} onClick={()=>setCursor(related.data.next_cursor)}>下一批关联会话</button>:null}
    </>:null}
    <p>责任交接不会接单或开始处理；沟通责任按明确选择处理。</p>
    {draft.enabled?<p data-assignment-draft-status role="status">{draft.message}</p>:null}
    <button type="button" data-action={action} disabled={blocked||!draft.canSubmit||context.isFetching||context.isError||targets.isFetching||targets.isError||!allowed.includes(action)||!team||!person||!choice||(choice==='TRANSFER_SELECTED'&&(!selected.length||related.isFetching||related.isError))} onClick={submit}>{action==='assign'?'确认派单':'确认转派'}</button>
    {state==='unknown'&&(pending||draft.operationId)?<button type="button" data-action="check-assignment-command" onClick={check}>{draft.enabled?'只读核对原操作':'核对原操作结果'}</button>:null}
    {draft.enabled&&Boolean(team||person||choice||selected.length)&&!blocked?<button type="button" data-action="discard-assignment-draft" onClick={()=>{void draft.discard();}}>丢弃选择内容</button>:null}
    {message?<p role={['unknown','denied','conflict'].includes(state)?'alert':'status'}>{message}</p>:null}
  </section>;
}
