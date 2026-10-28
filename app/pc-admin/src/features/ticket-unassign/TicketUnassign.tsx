import {RadioGroup as HRadioGroup,Radio as HRadio} from "@heroui/react";
import {WorkbenchButton as HButton} from '../../app/WorkbenchButton';
import {Checkbox as HCheckbox,Fieldset as HFieldset,Label as HLabel,ListBox,TextArea as HTextArea} from "@heroui/react";
import {WorkbenchSelect} from "../../app/WorkbenchSelect";
import {ToastFeedback,DraftStatus,useFeedbackState} from '../../app/ToastFeedback';
// T08 consumer installed after the original real production-bundle RED.
// Local production-bundle validation does not enable the default-off feature or authorize deployment.
import {useEffect,useRef,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {api,ApiError,captureWorkbenchRead,errorMessage,workbenchTransportWritable} from '../../api/client';
import type {Principal} from '../../api/client';
import type {P2016UnassignCommand} from '../../../../../contracts/workbench_unassign_contracts';
import {DraftError} from '../drafts/encrypted-drafts';
import {clearSessionAuthorization,clearTicketAuthorization} from '../../app/authorization';
import {EMPTY_UNASSIGN,createUnassignCommand,hasUnassignInput,isUnassignChoiceRevocation,readUnassignChoices,unassignInputSnapshot,useUnassignDraft} from './use-unassign-draft';
import type {UnassignCopy,UnassignFence,UnassignInput} from './use-unassign-draft';

type State='idle'|'preparing'|'submitting'|'checking'|'unknown'|'conflict'|'failed'|'denied'|'committed';
interface Job extends UnassignFence {controller:AbortController;generation:number;mode:'command'|'ack'|'review'|'privacy'}
interface CommandVariables {command:P2016UnassignCommand;snapshot:string;csrfToken:string|null;job:Job}
interface AckVariables {commandId:string;snapshot:string|null;job:Job}
const sameId=(left:string,right:string|null)=>right!==null&&left.toLowerCase()===right.toLowerCase();
const boundedVersion=(value:string)=>/^[1-9][0-9]{0,18}$/u.test(value)&&BigInt(value)<=2147483647n;

export function TicketUnassign({ticketId,principal,onBlockedChange}:{ticketId:string;principal:Principal;onBlockedChange:(blocked:boolean)=>void}){
  const client=useQueryClient(),generation=useRef(0),request=useRef<Job|null>(null);
  const [value,setValue]=useState<UnassignInput>(EMPTY_UNASSIGN),latest=useRef(value);latest.current=value;
  const [pending,setPending]=useState<P2016UnassignCommand|null>(null),pendingRef=useRef(pending);pendingRef.current=pending;
  const pendingSnapshot=useRef<string|null>(null),[opaque,setOpaque]=useState<string|null>(null),opaqueRef=useRef(opaque);opaqueRef.current=opaque;
  const knownTerminal=useRef<{commandId:string;state:'COMMITTED'|'FAILED'}|null>(null);
  const forgetMutationViews=useRef<(variables?:unknown)=>void>(()=>{});
  const storedId=useRef<string|null>(null),[cursor,setCursor]=useState<string|null>(null),[state,setState]=useState<State>('idle'),[message,setMessage,messageRevision]=useFeedbackState('');
  const [reviewRequired,setReviewRequired]=useState(false),[cleanupBlocked,setCleanupBlocked]=useState(false);
  const context=useQuery({queryKey:['ticket-command-context',principal.principal_id,ticketId],queryFn:({signal})=>api.ticketCommandContext(ticketId,signal)});
  const allowed=Boolean(context.data?.allowed_actions.includes('unassign'));
  const busy=['preparing','submitting','checking'].includes(state),unknown=state==='unknown';
  const clearSensitive=()=>{
    const id=pendingRef.current?.client_command_id??opaqueRef.current??storedId.current;
    generation.current++;request.current?.controller.abort();request.current=null;
    forgetMutationViews.current(); // Mutation variables also contain the protected original body/snapshot.
    latest.current=EMPTY_UNASSIGN;pendingRef.current=null;pendingSnapshot.current=null;opaqueRef.current=id;
    setValue(EMPTY_UNASSIGN);setPending(null);setOpaque(id);setCursor(null);setReviewRequired(false);
    const known=id&&knownTerminal.current?.commandId===id?knownTerminal.current:null;
    if(known){setCleanupBlocked(true);setReviewRequired(true);}
    setState(known?(known.state==='COMMITTED'?'committed':'failed'):id?'unknown':'idle');
    setMessage(known?'原操作终态已读到；敏感内容已停止展示，须按原 UUID 重新读取当前事实。':id?'原操作仍须按原 UUID 只读核对，敏感内容已停止展示。':'当前撤派内容已停止展示。');
  };
  const draft=useUnassignDraft({ticketId,principal,value,pending,actionAllowed:allowed,
    onRestore:copy=>{latest.current=copy.value;pendingRef.current=copy.pending;pendingSnapshot.current=copy.pending?unassignInputSnapshot(copy.value):null;setValue(copy.value);setPending(copy.pending);if(copy.pending){setState('unknown');setMessage('已恢复原操作的 UUID、版本及选择；请先只读核对。');}},
    onOperation:id=>{
      const previous=pendingRef.current?.client_command_id??opaqueRef.current;
      if(previous&&previous!==id){generation.current++;request.current?.controller.abort();request.current=null;}
      pendingRef.current=null;pendingSnapshot.current=null;opaqueRef.current=id;setPending(null);setOpaque(id);
      const known=knownTerminal.current?.commandId===id?knownTerminal.current:null;
      if(known){setCleanupBlocked(true);setReviewRequired(true);setState(known.state==='COMMITTED'?'committed':'failed');setMessage('原操作终态已读到；当前恢复标记仍须按同一 UUID 只读核对。');}
      else{setState('unknown');setMessage('原操作 '+id+' 仍未知；只读核对不需要当前撤派或所选会话的写权限。');}
    },onSensitiveClear:clearSensitive});
  storedId.current=draft.operationId;
  const originalId=pending?.client_command_id??opaque??draft.operationId;
  const blocked=busy||unknown||cleanupBlocked||draft.restorationBlocked||draft.restoring;
  const navigationBlocked=busy||cleanupBlocked||((unknown||hasUnassignInput(value))&&!draft.safeToLeave);
  const selectionVisible=value.choice==='TRANSFER_SELECTED'&&allowed&&!unknown;
  const targets=useQuery({queryKey:['ticket-unassign-targets',principal.principal_id,ticketId,value.target],
    queryFn:({signal})=>api.unassignCommunicationTargets(ticketId,value.target,signal),enabled:selectionVisible&&!busy&&!draft.restoring,gcTime:0});
  const related=useQuery({queryKey:['ticket-related-conversations',principal.principal_id,ticketId,cursor],
    queryFn:({signal})=>api.relatedConversations(ticketId,cursor,signal),enabled:selectionVisible&&!busy&&!draft.restoring,gcTime:0});
  useEffect(()=>{onBlockedChange(navigationBlocked);return()=>onBlockedChange(false);},[navigationBlocked,onBlockedChange]);
  useEffect(()=>()=>{generation.current++;request.current?.controller.abort();},[]);
  const authorizationSnapshot=JSON.stringify([principal.principal_id,principal.csrf_token,principal.authorization_revision]);
  const previousAuthorization=useRef(authorizationSnapshot);
  useEffect(()=>{
    if(previousAuthorization.current===authorizationSnapshot)return;previousAuthorization.current=authorizationSnapshot;
    if(request.current)clearSensitive(); // The global epoch guard rejects the old response; this also releases its busy UI job.
  },[authorizationSnapshot]);
  useEffect(()=>{if(!navigationBlocked)return;const warn=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[navigationBlocked]);
  const roleSnapshot=JSON.stringify(principal.roles);
  useEffect(()=>{
    if(principal.roles.some(role=>role==='ADMIN'||role==='DISPATCHER'))return;
    // This is only a denial fence. Fresh server allowed_actions still grants the original command.
    if(request.current?.mode!=='ack'&&hasUnassignInput(latest.current))denySensitive({value:latest.current,pending:pendingRef.current},pendingRef.current?.client_command_id??opaqueRef.current);
    void client.cancelQueries({queryKey:['ticket-unassign-targets',principal.principal_id,ticketId]},{revert:false});
    client.removeQueries({queryKey:['ticket-unassign-targets',principal.principal_id,ticketId]});
    // A pending/opaque ACK is not aborted merely because dispatch authority disappears.
  },[client,principal.principal_id,ticketId,roleSnapshot]);
  const current=(job:Job)=>{try{job.requireCurrent();return true;}catch{return false;}};
  const end=(job:Job)=>{if(request.current===job)request.current=null;};
  const begin=(mode:Job['mode']):Job|null=>{
    if(request.current)return null;
    const controller=new AbortController(),token=++generation.current,read=captureWorkbenchRead(controller.signal);
    const job:Job={controller,signal:controller.signal,generation:token,mode,requireCurrent:()=>{
      controller.signal.throwIfAborted();read();
      const session=client.getQueryData<Principal>(['session']),ticketState=client.getQueryState(['ticket-command-context',principal.principal_id,ticketId]);
      if(request.current!==job||generation.current!==token||session&&session.principal_id!==principal.principal_id
        ||session&&!session.ticket_unassign_enabled||mode==='command'&&session&&!session.roles.some(role=>role==='ADMIN'||role==='DISPATCHER')||ticketState?.error instanceof ApiError&&[401,403,404].includes(ticketState.error.status))throw new DOMException('UNASSIGN_REQUEST_CHANGED','AbortError');
      // Deliberately no allowed_action/Control-write check: the original ACK is a Ticket READ.
    }};request.current=job;return job;
  };
  const refresh=()=>{for(const key of [
    ['ticket-command-context',principal.principal_id,ticketId],['detail',principal.principal_id,'ticket',ticketId],['board',principal.principal_id],
    ['ticket-related-conversations',principal.principal_id,ticketId],['ticket-unassign-targets',principal.principal_id,ticketId],
    ['item-conversations',principal.principal_id,'ticket',ticketId],
  ])void client.invalidateQueries({queryKey:key});};
  const freshRead=async(job:Job)=>{
    job.requireCurrent();const fresh=await api.bootstrap(job.signal);job.requireCurrent();
    if(fresh.principal_id!==principal.principal_id)throw new DraftError('DRAFT_IDENTITY_CHANGED');
    client.setQueryData(['session'],fresh);if(!fresh.ticket_unassign_enabled)throw new DraftError('DRAFT_DISABLED');
    const ticket=await api.ticketCommandContext(ticketId,job.signal);job.requireCurrent();
    client.setQueryData(['ticket-command-context',principal.principal_id,ticketId],ticket);return {fresh,ticket};
  };
  const applyKnown=(commandId:string,outcome:'COMMITTED'|'FAILED',snapshot:string|null,cleaned:boolean,job:Job)=>{
    job.requireCurrent();knownTerminal.current={commandId,state:outcome};pendingRef.current=null;pendingSnapshot.current=null;setPending(null);
    // An opaque ACK has no authenticated original form snapshot, so it never wipes a newer local input.
    if(outcome==='COMMITTED'&&snapshot!==null)setValue(input=>unassignInputSnapshot(input)===snapshot?EMPTY_UNASSIGN:input);
    opaqueRef.current=cleaned?null:commandId;setOpaque(cleaned?null:commandId);setCleanupBlocked(!cleaned);
    setReviewRequired(outcome==='FAILED'||snapshot===null&&hasUnassignInput(latest.current)||snapshot!==null&&unassignInputSnapshot(latest.current)!==snapshot);
    setState(outcome==='COMMITTED'?'committed':'failed');
    setMessage((outcome==='COMMITTED'?'原操作已核对为提交，正在读取当前工单事实。':'原操作已明确失败，当前输入保留；请重新读取并确认。')
      +(cleaned?'':' 原恢复标记清理尚未确认；禁止新提交，可继续只读核对。'));refresh();
  };
  // A command 403/404 may concern a selected Session/target. Confirm Ticket READ before any whole-Ticket purge.
  const denySensitive=(copy:UnassignCopy,commandId:string|null)=>{
    clearSensitive();if(commandId){opaqueRef.current=commandId;setOpaque(commandId);setState('unknown');}
    const job=begin('privacy');if(!job)return;setState('checking');
    void(async()=>{
      await freshRead(job);job.requireCurrent();
      const cleaned=await draft.dropSensitive(copy,job);job.requireCurrent();setCleanupBlocked(!cleaned);setState(commandId?'unknown':'idle');
      if(!cleaned)setMessage('当前敏感内容已停止展示；存储中存在不同修订，未删除该副本，禁止新提交并须重新读取。');
    })().catch(error=>{
      if(!current(job))return;
      if(error instanceof ApiError&&error.status===401||error instanceof DraftError&&error.message==='DRAFT_IDENTITY_CHANGED')void clearSessionAuthorization(client,principal.principal_id,401,'revoked');
      else if(error instanceof ApiError&&[403,404].includes(error.status))void clearTicketAuthorization(client,principal.principal_id,ticketId,error);
      else setMessage('当前敏感内容已停止展示；读取或清理暂未确认，原 UUID 只能只读核对。');
    }).finally(()=>end(job));
  };
  const selectionError=targets.error??related.error,handledSelectionError=useRef<unknown>(null);
  useEffect(()=>{
    if(selectionError===handledSelectionError.current)return;handledSelectionError.current=selectionError;
    if(selectionError instanceof ApiError&&[403,404].includes(selectionError.status))denySensitive({value:latest.current,pending:pendingRef.current},pendingRef.current?.client_command_id??opaqueRef.current);
    // 503/offline remains a temporary read failure; keep the current input and encrypted revision.
  },[selectionError]);
  const command=useMutation({mutationKey:['ticket-unassign',principal.principal_id,ticketId],gcTime:0,
    mutationFn:async(variables:CommandVariables)=>{variables.job.requireCurrent();const result=await api.unassignTicket(ticketId,variables.command,variables.csrfToken,variables.job.signal);variables.job.requireCurrent();return result;},
    onSuccess:async(_result,variables)=>{
      if(!current(variables.job))return;knownTerminal.current={commandId:variables.command.client_command_id,state:'COMMITTED'};
      try{variables.job.requireCurrent();const cleaned=await draft.settleKnown(variables.command.client_command_id,variables.job);variables.job.requireCurrent();applyKnown(variables.command.client_command_id,'COMMITTED',variables.snapshot,cleaned,variables.job);}
      catch{if(current(variables.job)){setCleanupBlocked(true);setOpaque(variables.command.client_command_id);setState('committed');setMessage('原操作返回已提交，但恢复清理尚未确认；禁止新提交，请继续只读核对。');refresh();}}
    },
    onError:async(error,variables)=>{
      if(!current(variables.job))return;
      if(error instanceof ApiError&&[401,403,404].includes(error.status)){
        if(error.status===401){clearSensitive();void clearSessionAuthorization(client,principal.principal_id,401,'revoked');}
        else denySensitive({value:latest.current,pending:variables.command},variables.command.client_command_id);
        return;
      }
      if(error instanceof ApiError){
        knownTerminal.current={commandId:variables.command.client_command_id,state:'FAILED'};
        try{variables.job.requireCurrent();const cleaned=await draft.settleKnown(variables.command.client_command_id,variables.job);variables.job.requireCurrent();applyKnown(variables.command.client_command_id,'FAILED',variables.snapshot,cleaned,variables.job);setState(error.status===409?'conflict':'failed');setMessage((error.status===409?'版本或责任发生冲突；原输入保留，请重新读取并明确确认。':errorMessage(error))+(cleaned?'':' 恢复清理尚未确认，禁止新提交，请只读核对。'));}
        catch{if(current(variables.job)){setCleanupBlocked(true);setOpaque(variables.command.client_command_id);setState('failed');setMessage('已知拒绝的本地恢复清理尚未确认；禁止新提交，请只读核对原 UUID。');}}
      }else{variables.job.requireCurrent();pendingRef.current=variables.command;setPending(variables.command);setState('unknown');setMessage('结果未知，原 UUID、版本和正文不变；只允许读取原操作回执。');}
    },onSettled:(_result,_error,variables)=>{end(variables.job);forgetMutationViews.current(variables);},
  });
  const acknowledgement=useMutation({mutationKey:['ticket-unassign-ack',principal.principal_id,ticketId],gcTime:0,
    mutationFn:async(variables:AckVariables)=>{variables.job.requireCurrent();const result=await api.unassignAcknowledgement(ticketId,variables.commandId,variables.job.signal);variables.job.requireCurrent();return result;},
    onSuccess:async(result,variables)=>{
      if(!current(variables.job))return;
      if(result.state==='UNKNOWN'){variables.job.requireCurrent();setState('unknown');setMessage('没有终态回执不代表未提交；原 UUID 仍须只读核对。');return;}
      knownTerminal.current={commandId:variables.commandId,state:result.state};
      try{variables.job.requireCurrent();const cleaned=await draft.settleKnown(variables.commandId,variables.job);variables.job.requireCurrent();applyKnown(variables.commandId,result.state,variables.snapshot,cleaned,variables.job);}
      catch{if(current(variables.job)){setCleanupBlocked(true);setOpaque(variables.commandId);setState(result.state==='COMMITTED'?'committed':'failed');setMessage('终态已读到，但恢复清理尚未确认；禁止新提交，可重读同一 UUID。');refresh();}}
    },onError:(error,variables)=>{
      if(!current(variables.job))return;
      if(error instanceof ApiError&&error.status===401){clearSensitive();void clearSessionAuthorization(client,principal.principal_id,401,'revoked');return;}
      if(error instanceof ApiError&&[403,404].includes(error.status)){denySensitive({value:latest.current,pending:pendingRef.current},variables.commandId);return;}
      variables.job.requireCurrent();setState('unknown');setMessage('只读核对暂未完成，原操作仍未知；未发送新的操作。');
    },onSettled:(_result,_error,variables)=>{end(variables.job);forgetMutationViews.current(variables);},
  });
  forgetMutationViews.current=(variables?:unknown)=>{
    if(variables===undefined||command.variables===variables)command.reset();
    if(variables===undefined||acknowledgement.variables===variables)acknowledgement.reset();
    for(const mutation of client.getMutationCache().findAll({predicate:item=>{
      const key=item.options.mutationKey;
      return Boolean(key&&['ticket-unassign','ticket-unassign-ack'].includes(String(key[0]))&&key[1]===principal.principal_id&&key[2]===ticketId&&(variables===undefined||item.state.variables===variables));
    }}))client.getMutationCache().remove(mutation);
  };
  const update=(change:Partial<UnassignInput>)=>{
    if(blocked||!allowed)return;
    setValue(input=>Object.freeze({...input,...change,version:input.version??context.data?.version??null}));
  };
  const submit=async()=>{
    if(blocked||!draft.canSubmit||!allowed||!context.data||context.isPending||context.isError||reviewRequired||!workbenchTransportWritable()
      ||!value.reason.trim()||value.reason.length>2000||value.version===null||value.version!==context.data.version
      ||value.choice==='TRANSFER_SELECTED'&&(!value.target||!value.sessions.length||targets.isPending||targets.isError||related.isPending||related.isError
        ||!targets.data?.items.some(row=>sameId(row.principal_id,value.target))))return;
    const input=latest.current,snapshot=unassignInputSnapshot(input);let intent:P2016UnassignCommand;
    try{intent=createUnassignCommand(input,crypto.randomUUID());}catch{setMessage('当前输入不符合撤派合同，尚未发送。');return;}
    const job=begin('command');if(!job)return;
    pendingRef.current=intent;pendingSnapshot.current=snapshot;setPending(intent);setState('preparing');setMessage('正在核对当前撤派权限与明确选择…');
    let prepared=false;
    try{
      const {fresh,ticket}=await freshRead(job);job.requireCurrent();
      if(!ticket.allowed_actions.includes('unassign'))throw new ApiError(409,'P2_016_UNASSIGN_STATE_CONFLICT');
      if(ticket.version!==intent.expected_version)throw new ApiError(409,'P2_016_VERSION_CONFLICT');
      await readUnassignChoices(ticketId,input,job);job.requireCurrent();
      if(!workbenchTransportWritable())throw new DraftError('WORKBENCH_TRANSPORT_NOT_WRITABLE');
      await draft.prepare(intent,job);job.requireCurrent();prepared=true;
      setState('submitting');setMessage('正在提交明确撤派…');command.mutate({command:intent,snapshot,csrfToken:fresh.csrf_token,job});
    }catch(error){
      if(!current(job))return;
      if(error instanceof ApiError&&[401,403,404].includes(error.status)||error instanceof DraftError&&error.message==='DRAFT_IDENTITY_CHANGED'||isUnassignChoiceRevocation(error)){
        end(job);if(error instanceof ApiError&&error.status===401||error instanceof DraftError&&error.message==='DRAFT_IDENTITY_CHANGED'){clearSensitive();void clearSessionAuthorization(client,principal.principal_id,401,'revoked');}
        else denySensitive({value:input,pending:prepared?intent:null},null);return;
      }
      // This catch precedes command.mutate: no POST was attempted; storage prepare failure still blocks through the shared draft status.
      if(prepared){try{job.requireCurrent();await draft.settleKnown(intent.client_command_id,job);job.requireCurrent();}catch{if(!current(job))return;setCleanupBlocked(true);}}
      pendingRef.current=null;pendingSnapshot.current=null;setPending(null);setState(error instanceof ApiError&&error.status===409?'conflict':'denied');setReviewRequired(true);
      setMessage('尚未发送：'+errorMessage(error)+' 原输入和捕获版本保留。');refresh();end(job);
    }
  };
  const check=async()=>{
    const id=pendingRef.current?.client_command_id??opaqueRef.current??draft.operationId;if(!id||request.current)return;
    const job=begin('ack');if(!job)return;setState('checking');setMessage('正在只读核对原操作…');
    try{await freshRead(job);job.requireCurrent();acknowledgement.mutate({commandId:id,snapshot:pendingRef.current?pendingSnapshot.current:null,job});}
    catch(error){if(current(job)){if(error instanceof ApiError&&error.status===401)void clearSessionAuthorization(client,principal.principal_id,401,'revoked');else if(error instanceof ApiError&&[403,404].includes(error.status))void clearTicketAuthorization(client,principal.principal_id,ticketId,error);else{setState('unknown');setMessage('当前读取暂未确认；原 UUID 保留，未发送新的操作。');}}end(job);}
  };
  const review=async()=>{
    if(originalId||request.current||cleanupBlocked)return;const job=begin('review');if(!job)return;
    const snapshot=unassignInputSnapshot(latest.current);setState('checking');
    try{const {ticket}=await freshRead(job);job.requireCurrent();if(!ticket.allowed_actions.includes('unassign'))throw new ApiError(409,'P2_016_UNASSIGN_STATE_CONFLICT');
      setValue(input=>unassignInputSnapshot(input)===snapshot?Object.freeze({...input,version:ticket.version}):input);setReviewRequired(false);setState('idle');setMessage('已明确重新读取当前版本；请核对原因和沟通选择后再确认。');}
    catch(error){if(current(job)){setState('conflict');setMessage('当前撤派事实暂未确认；原输入保留。');if(error instanceof ApiError&&[401,403,404].includes(error.status))denySensitive({value:latest.current,pending:null},null);}}
    finally{end(job);}
  };
  const discard=()=>{if(busy||request.current)return;denySensitive({value:latest.current,pending:pendingRef.current},originalId);};
  const toggle=(id:string,rowVersion:string,permitted:boolean)=>{
    if(blocked||!allowed)return;const already=value.sessions.some(row=>sameId(row.session_id,id));
    if(!already&&(!permitted||!boundedVersion(rowVersion)||value.sessions.length>=8))return;
    update({sessions:Object.freeze(already?value.sessions.filter(row=>!sameId(row.session_id,id)):[...value.sessions,Object.freeze({session_id:id,expected_row_version:Number(rowVersion)})])});
  };
  const selectedReady=value.choice==='RETAIN_CURRENT'||Boolean(value.target&&value.sessions.length&&targets.data?.items.some(row=>sameId(row.principal_id,value.target))&&!targets.isPending&&!targets.isError&&!related.isPending&&!related.isError);
  const canSubmit=!blocked&&draft.canSubmit&&allowed&&!context.isPending&&!context.isError&&!reviewRequired&&value.reason.length<=2000&&Boolean(value.reason.trim())&&value.version===context.data?.version&&selectedReady&&workbenchTransportWritable();
  const nextCursor=related.data?.next_cursor??null;
  const displayTarget=targets.data?.items.find(row=>sameId(row.principal_id,value.target))?.principal_id??value.target??'';
  const showForm=allowed&&principal.roles.some(role=>role==='ADMIN'||role==='DISPATCHER')&&!unknown&&request.current?.mode!=='ack'; // A readable Ticket's opaque ACK stays available when its write action disappears.
  return <section className="ticket-notes ticket-unassign" aria-label="撤销尚未开始的派工">
    <h3>撤销派工</h3>
    {context.isError?<p role="alert">{errorMessage(context.error)}</p>:null}
    {showForm?<>
      <HLabel>内部撤派原因<HTextArea value={value.reason} maxLength={2000} disabled={blocked||(context.isPending||context.isError)} onChange={event=>update({reason:event.target.value})}/></HLabel>
      <p>原因只进入内部记录。撤派保留原处理组，不会新增对外通知。</p>
      <HRadioGroup className="workbench-radio-group" name={'unassign-communication-'+ticketId} value={value.choice??''} onChange={next=>{if(next==="RETAIN_CURRENT"){update({choice:'RETAIN_CURRENT',target:null,sessions:Object.freeze([])});}if(next==="TRANSFER_SELECTED"){update({choice:'TRANSFER_SELECTED'});}}} isDisabled={blocked||(context.isPending||context.isError)}><HLabel>沟通责任</HLabel><HRadio value={"RETAIN_CURRENT"}><HRadio.Content><HRadio.Control><HRadio.Indicator/></HRadio.Control>保留当前沟通责任</HRadio.Content></HRadio><HRadio value={"TRANSFER_SELECTED"}><HRadio.Content><HRadio.Control><HRadio.Indicator/></HRadio.Control>明确选择会话和新的沟通同事</HRadio.Content></HRadio></HRadioGroup>
      {value.choice==='TRANSFER_SELECTED'?<>
        {targets.isError||related.isError?<p role="alert">{errorMessage(targets.error??related.error)} 当前选择保留，读取成功后重新核对。</p>:null}
        <WorkbenchSelect label={<>沟通同事</>} value={displayTarget} isDisabled={blocked||targets.isPending||targets.isError} onChange={event=>update({target:event||null})}><ListBox.Item id="" textValue={"请选择沟通同事"}>请选择沟通同事<ListBox.ItemIndicator/></ListBox.Item>{value.target&&!targets.data?.items.some(row=>sameId(row.principal_id,value.target))?<ListBox.Item id={value.target} textValue={"原选择需重新核验"}>原选择需重新核验<ListBox.ItemIndicator/></ListBox.Item>:null}{targets.data?.items.map(row=><ListBox.Item key={row.principal_id} id={row.principal_id} textValue={String(row.display_name)}>{row.display_name}<ListBox.ItemIndicator/></ListBox.Item>)}</WorkbenchSelect>
        <p>本次已选 {value.sessions.length} 个会话，最多 8 个。目标列表展示最多 100 人；原选择另行核验。</p>
        <ul className="conversation-choices">{related.data?.items.map(row=>{
          const chosen=value.sessions.find(item=>sameId(item.session_id,row.session_id)),permitted=row.take_allowed&&boundedVersion(row.session_row_version);
          return <li key={row.session_id}><HCheckbox data-session-choice={row.session_id} isSelected={Boolean(chosen)} isDisabled={blocked||!chosen&&(!permitted||value.sessions.length>=8)} onChange={()=>toggle(row.session_id,row.session_row_version,permitted)}><HCheckbox.Content><HCheckbox.Control><HCheckbox.Indicator/></HCheckbox.Control>{row.conversation_principal_name??'尚未分配沟通人'}<small>会话 {row.session_id} · 版本 {row.session_row_version}{!permitted?' · 当前不可交接':''}{chosen&&String(chosen.expected_row_version)!==row.session_row_version?' · 已变化，请取消后重新选择':''}</small></HCheckbox.Content></HCheckbox></li>;
        })}</ul>
        {value.sessions.length?<ul>{value.sessions.map(row=><li key={row.session_id}>已选会话 {row.session_id}<HButton type="button" isDisabled={blocked} onClick={()=>update({sessions:Object.freeze(value.sessions.filter(item=>!sameId(item.session_id,row.session_id)))})} variant="secondary">取消选择</HButton></li>)}</ul>:null}
        {cursor?<HButton type="button" isDisabled={blocked||(related.isPending||related.isError)} onClick={()=>setCursor(null)} variant="secondary">回到首批会话</HButton>:null}
        {nextCursor?<HButton type="button" isDisabled={blocked||(related.isPending||related.isError)} onClick={()=>setCursor(nextCursor)} variant="secondary">下一批关联会话</HButton>:null}
      </>:null}
      <HButton type="button" data-action="unassign" isDisabled={!canSubmit} onClick={()=>{void submit();}} variant="secondary">确认撤销派工</HButton>
    </>:<p>当前没有可提交的撤派动作；已存在的原 UUID 仍可按当前工单读权限核对。</p>}
    {draft.enabled?<DraftStatus data-unassign-draft-status role="status">{state==='failed'||state==='conflict'?'当前输入待重新读取和确认。':state==='committed'?'原操作已确认，当前事实须重新读取。':draft.message}</DraftStatus>:null}
    {originalId&&!busy?<HButton type="button" data-action="check-unassign-command" onClick={()=>{void check();}} variant="secondary">只读核对原操作</HButton>:null}
    {!originalId&&hasUnassignInput(value)&&(reviewRequired||value.version!==context.data?.version)?<HButton type="button" data-action="review-unassign-version" isDisabled={busy||cleanupBlocked} onClick={()=>{void review();}} variant="secondary">重新读取并确认版本</HButton>:null}
    {hasUnassignInput(value)&&!busy?<HButton type="button" data-action="discard-unassign-draft" onClick={discard} variant="secondary">清除敏感填写内容</HButton>:null}
    {message?<ToastFeedback revision={messageRevision} source="ticket-unassign" state={state} role={['unknown','conflict','failed','denied'].includes(state)?'alert':'status'}>{message}</ToastFeedback>:null}
  </section>;
}
