import {BoardConflictIntent} from '../board-actions/BoardConflictIntent';
import {useEffect,useRef,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {api,ApiError,errorMessage,workbenchTransportWritable} from '../../api/client';
import type {Principal,P2016SelfHandlingCommand,SelfHandlingAction} from '../../api/client';

type Pending={action:SelfHandlingAction;command:P2016SelfHandlingCommand};
type State='idle'|'submitting'|'checking'|'succeeded'|'denied'|'conflict'|'unknown';
export function TicketSelfHandling({ticketId,principal,onBlockedChange,boardMode=false}:{ticketId:string;principal:Principal;boardMode?:boolean;onBlockedChange:(blocked:boolean)=>void}){
  const client=useQueryClient(),request=useRef<AbortController|null>(null);
  const [state,setState]=useState<State>('idle'),[message,setMessage]=useState(''),[pending,setPending]=useState<Pending|null>(null);
  const context=useQuery({queryKey:['ticket-command-context',principal.principal_id,ticketId],queryFn:({signal})=>api.ticketCommandContext(ticketId,signal)});
  const blocked=['submitting','checking','unknown'].includes(state)||Boolean(boardMode&&state==='conflict'&&pending);
  useEffect(()=>{onBlockedChange(blocked);return()=>onBlockedChange(false);},[blocked,onBlockedChange]);
  useEffect(()=>()=>{request.current?.abort();},[]);
  useEffect(()=>{if(!blocked)return;const warn=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[blocked]);
  const refresh=()=>{
    void client.invalidateQueries({queryKey:['ticket-command-context',principal.principal_id,ticketId]});
    void client.invalidateQueries({queryKey:['detail',principal.principal_id,'ticket',ticketId]});
    void client.invalidateQueries({queryKey:['board',principal.principal_id]});
  };
  const mutation=useMutation({mutationKey:['ticket-self-handling',principal.principal_id,ticketId],
    mutationFn:({intent,signal}:{intent:Pending;signal:AbortSignal})=>api.selfHandle(ticketId,intent.action,intent.command,principal.csrf_token,signal),
    onSuccess:(result,variables)=>{setPending(null);setState('succeeded');setMessage(variables.intent.action==='accept-for-later'?'已接单，可稍后开始处理。':'已开始处理。');if(result.replayed)setMessage(variables.intent.action==='accept-for-later'?'已核对：原操作已接单。':'已核对：原操作已开始处理。');refresh();},
    onError:(error,variables)=>{
      if(error instanceof ApiError){setPending(boardMode&&error.status===409?variables.intent:null);setState(error.status===409?'conflict':'denied');setMessage(error.status===409?'操作冲突：请重新读取工单后确认新的操作。':'操作被拒绝：'+errorMessage(error));if(error.status===409)refresh();}
      else{setPending(variables.intent);setState('unknown');setMessage('结果未知：请求可能已提交。请核对原操作结果，原动作、版本和处理组保持不变。');}
    },onSettled:()=>{request.current=null;},
  });
  const send=(intent:Pending,checking:boolean)=>{
    if(!checking&&!workbenchTransportWritable()){setState('denied');setMessage('连接尚未完成事实核验，新处理操作尚未发送；请重新读取。');return;}
    if(request.current)return;const controller=new AbortController();request.current=controller;setPending(intent);setState(checking?'checking':'submitting');setMessage(checking?'正在核对原操作结果…':'正在提交处理操作…');mutation.mutate({intent,signal:controller.signal});
  };
  const submit=(action:SelfHandlingAction)=>{
    if(blocked||context.isFetching||!context.data?.allowed_actions.includes(action))return;
    send(Object.freeze({action,command:Object.freeze({client_command_id:crypto.randomUUID(),expected_version:context.data.version,reason_code:'WORKBENCH_SELF_HANDLING',resolver_team_id:context.data.resolver_team_id})}),false);
  };
  const cycle=context.data?.handling_cycle,allowed=context.data?.allowed_actions??[];
  // Keep the original request/result controller mounted; only its idle presentation is optional.
  if(principal.ticket_takeover_enabled&&!allowed.some(action=>action==='take-and-start'||action==='accept-for-later')&&!pending&&state==='idle')return null;
  return <section data-activity-field="ticket-handling" className="ticket-notes ticket-self-handling" aria-label="本人承接工单">
    {context.isPending?<p role="status">正在读取可用操作…</p>:context.isError?<p role="alert">{errorMessage(context.error)}</p>:<p hidden className="ticket-handling-version">工单版本 {context.data.version}</p>}
    {cycle?<p className="ticket-handling-cycle">处理轮次 {cycle.cycle_no}</p>:null}
    <div className="note-controls">
      {allowed.includes('take-and-start')?<button type="button" className="take-and-start" data-action="take-and-start" disabled={blocked||context.isFetching||context.isError} onClick={()=>submit('take-and-start')}>我来处理</button>:null}
      {allowed.includes('accept-for-later')?<button type="button" data-action="accept-for-later" disabled={blocked||context.isFetching||context.isError} onClick={()=>submit('accept-for-later')}>先接单，稍后处理</button>:null}
      {state==='unknown'&&pending?<button type="button" data-action="check-self-handling" onClick={()=>send(pending,true)}>核对原操作结果</button>:null}
      {!blocked?<button type="button" onClick={()=>{void context.refetch();}}>重新读取工单动作</button>:null}
    </div>
      {!context.isPending&&!context.isError&&!allowed.some(action=>['take-and-start','accept-for-later'].includes(action))&&!pending?<p>当前没有可用的本人承接动作。</p>:null}
    {state!=='idle'?<p className="ticket-handling-state" role={['denied','conflict','unknown'].includes(state)?'alert':'status'}>{message}</p>:null}
    {boardMode&&state==='conflict'&&pending?<BoardConflictIntent original={pending} onAdopt={()=>{setPending(null);setState('idle');setMessage('已保留填写内容，请按工单信息明确新的操作。');refresh();}}/>:null}
  </section>;
}
