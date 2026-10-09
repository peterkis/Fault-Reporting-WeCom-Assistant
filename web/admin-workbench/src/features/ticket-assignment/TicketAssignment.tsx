import {useEffect,useRef,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {api,ApiError,errorMessage,workbenchTransportWritable} from '../../api/client';
import type {Principal,P2016AssignmentAction,P2016AssignmentCommand} from '../../api/client';

export function TicketAssignment({ticketId,principal,onBlockedChange}:{ticketId:string;principal:Principal;onBlockedChange:(blocked:boolean)=>void}){
  const client=useQueryClient(),request=useRef<AbortController|null>(null);
  const [team,setTeam]=useState(''),[person,setPerson]=useState(''),[retain,setRetain]=useState(false),[state,setState]=useState<'idle'|'submitting'|'unknown'|'conflict'|'denied'|'succeeded'>('idle'),[message,setMessage]=useState('');
  const context=useQuery({queryKey:['ticket-command-context',principal.principal_id,ticketId],queryFn:({signal})=>api.ticketCommandContext(ticketId,signal)});
  const targets=useQuery({queryKey:['ticket-assignment-targets',principal.principal_id,ticketId,team],queryFn:({signal})=>api.assignmentTargets(ticketId,team||null,signal),gcTime:0});
  const blocked=state==='submitting'||state==='unknown';
  useEffect(()=>{onBlockedChange(blocked);return()=>onBlockedChange(false);},[blocked,onBlockedChange]);
  useEffect(()=>()=>{request.current?.abort();},[]);
  useEffect(()=>{if(!blocked)return;const warn=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[blocked]);
  const refresh=()=>{void client.invalidateQueries({queryKey:['ticket-command-context',principal.principal_id,ticketId]});void client.invalidateQueries({queryKey:['detail',principal.principal_id,'ticket',ticketId]});void client.invalidateQueries({queryKey:['board',principal.principal_id]});};
  const mutation=useMutation({mutationKey:['ticket-assignment',principal.principal_id,ticketId],mutationFn:({action,command,signal}:{action:P2016AssignmentAction;command:P2016AssignmentCommand;signal:AbortSignal})=>api.assignTicket(ticketId,action,command,principal.csrf_token,signal),
    onSuccess:()=>{setState('succeeded');setMessage('责任已交接，正在读取当前工单事实。');refresh();},
    onError:error=>{if(error instanceof ApiError){setState(error.status===409?'conflict':'denied');setMessage(error.status===409?'操作冲突，请重新读取工单与目标后明确确认。':errorMessage(error));if(error.status===409)refresh();}else{setState('unknown');setMessage('结果未知，原操作可能已提交；请保留页面，勿重复提交。');}},onSettled:()=>{request.current=null;}});
  const allowed=context.data?.allowed_actions??[],action:P2016AssignmentAction=allowed.includes('assign')?'assign':'transfer-assignment';
  const submit=()=>{if(blocked||request.current||!context.data||!allowed.includes(action)||context.isFetching||targets.isFetching||!workbenchTransportWritable()||!retain||!team||!targets.data?.items.some(item=>item.principal_id===person))return;
    const controller=new AbortController();request.current=controller;setState('submitting');setMessage('正在提交责任交接…');
    mutation.mutate({action,command:Object.freeze({client_command_id:crypto.randomUUID(),expected_version:context.data.version,reason_code:action==='assign'?'WORKBENCH_ASSIGN':'WORKBENCH_TRANSFER',target_principal_id:person,resolver_team_id:team,communication_choice:'RETAIN_CURRENT',sessions:[]}),signal:controller.signal});};
  return <section className="ticket-notes ticket-assignment" aria-label="工单派单与转派">
    <h3>交接处理责任</h3>
    {context.isError||targets.isError?<p role="alert">{errorMessage(context.error??targets.error)}</p>:null}
    <label>处理组<select value={team} disabled={blocked||targets.isFetching} onChange={event=>{setTeam(event.target.value);setPerson('');}}><option value="">请选择处理组</option>{targets.data?.resolver_teams.map(group=><option key={group.team_id} value={group.team_id}>{group.display_name}</option>)}</select></label>
    <label>处理人<select value={person} disabled={blocked||!team||targets.isFetching} onChange={event=>setPerson(event.target.value)}><option value="">请选择处理同事</option>{targets.data?.items.map(item=><option key={item.principal_id} value={item.principal_id}>{item.display_name}</option>)}</select></label>
    <label><input type="radio" name={'assignment-communication-'+ticketId} value="RETAIN_CURRENT" checked={retain} disabled={blocked} onChange={()=>setRetain(true)}/>保留当前沟通责任</label>
    <p>责任交接不会接单或开始处理；当前沟通责任按此明确选择保留。</p>
    <button type="button" data-action={action} disabled={blocked||context.isFetching||context.isError||targets.isFetching||targets.isError||!allowed.includes(action)||!team||!person||!retain} onClick={submit}>{action==='assign'?'确认派单':'确认转派'}</button>
    {message?<p role={['unknown','denied','conflict'].includes(state)?'alert':'status'}>{message}</p>:null}
  </section>;
}
