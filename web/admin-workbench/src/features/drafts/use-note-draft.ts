import {useEffect,useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {api,ApiError} from '../../api/client';
import type {P2016InternalNoteCommand,Principal} from '../../api/client';
import {DraftError,draftScopeKey,matchesDraft,openDraft,rebaseDraft,refreshEmptyDraft,removeSensitiveDraft,saveDraft,settleDraft,subscribeDrafts} from './encrypted-drafts';
import type {DraftHandle,DraftScope} from './encrypted-drafts';
import {clearSessionAuthorization,clearTicketAuthorization} from '../../app/authorization';

interface NoteDraft {schema:1;note:string;pending:P2016InternalNoteCommand|null}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function decodeCommand(value:unknown):P2016InternalNoteCommand|null{
  if(value===null)return null;
  if(!value||typeof value!=='object'||Array.isArray(value))throw new DraftError('DRAFT_CORRUPT');
  const v=value as Record<string,unknown>;
  if(Object.keys(v).length!==5||typeof v.client_command_id!=='string'||!UUID.test(v.client_command_id)
    ||typeof v.expected_version!=='number'||!Number.isSafeInteger(v.expected_version)||v.expected_version<1||v.expected_version>2147483647
    ||typeof v.reason_code!=='string'||! /^[A-Z][A-Z0-9_]{0,63}$/u.test(v.reason_code)||typeof v.note!=='string'||v.note.length>2000||!v.note.trim()||v.external_visible!==false)throw new DraftError('DRAFT_CORRUPT');
  return Object.freeze({client_command_id:v.client_command_id,expected_version:v.expected_version,reason_code:v.reason_code,note:v.note,external_visible:false});
}
function decodeNote(text:string):NoteDraft{
  const value:unknown=JSON.parse(text);
  if(!value||typeof value!=='object'||Array.isArray(value))throw new DraftError('DRAFT_CORRUPT');
  const v=value as Record<string,unknown>;
  if(Object.keys(v).length!==3||v.schema!==1||typeof v.note!=='string'||v.note.length>2000)throw new DraftError('DRAFT_CORRUPT');
  return {schema:1,note:v.note,pending:decodeCommand(v.pending)};
}
function failureMessage(error:unknown):string{
  const reason=error instanceof DraftError?error.message:'';
  if(reason==='DRAFT_FULL')return '恢复不可用：当前浏览器已达到20份草稿上限；当前输入未保存，请先处理已有草稿。';
  if(reason==='DRAFT_OPERATION_FULL')return '恢复不可用：已达到20个未核对操作上限；不能清除它们来提交新操作，请先核对已有操作。';
  if(reason==='DRAFT_TOO_LARGE')return '恢复不可用：恢复副本超出16 KiB（16384 bytes），本次未发送；请减少当前输入。';
  if(reason==='DRAFT_OPERATION_CORRUPT')return '恢复不可用：未核对操作记录已损坏，标识仍保留；不能推断原操作失败或提交新操作，请核对当前工单事实。';
  return '恢复不可用：当前输入未保存为恢复副本；本次不会发送新的操作。';
}
export interface AuthorizedDraftValue<T,C> {value:T;pending:C|null}
export interface AuthorizedDraftOptions<T,C> {
  scope:DraftScope;enabled:boolean;writeEnabled?:boolean;refreshBlankAfterPurposeRemoval?:boolean;value:T;pending:C|null;emptyValue:T;
  hasInput:(value:T)=>boolean;serialise:(value:AuthorizedDraftValue<T,C>)=>string;
  decode:(text:string)=>AuthorizedDraftValue<T,C>;commandId:(command:C)=>string;
  authorize:(signal:AbortSignal,copy?:AuthorizedDraftValue<T,C>)=>Promise<boolean>;onAuthorityFailure:(error:unknown)=>void;
  onRestore:(value:AuthorizedDraftValue<T,C>)=>void;onOperation:(id:string)=>void;onSensitiveClear:()=>void;
}
export function useAuthorizedDraft<T,C>(options:AuthorizedDraftOptions<T,C>){
  const {scope,enabled,value,pending,emptyValue}=options,scopeKey=draftScopeKey(scope),writeEnabled=options.writeEnabled??enabled;
  const protocol=useRef(options);protocol.current=options;
  const encode=(value:AuthorizedDraftValue<T,C>)=>protocol.current.serialise(value);
  const hasInput=(value:T)=>protocol.current.hasInput(value);
  const [status,setStatus]=useState(enabled?'loading':'disabled'),[message,setMessage]=useState(''),[initialized,setInitialized]=useState(false);
  const [operationId,setOperationId]=useState<string|null>(null);
  const [refreshIndex,setRefreshIndex]=useState(0);
  const handle=useRef<DraftHandle|null>(null),generation=useRef(0),restore=useRef(options.onRestore),latest=useRef<AuthorizedDraftValue<T,C>>({value,pending});
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null),queue=useRef<Promise<void>>(Promise.resolve()),lastSaved=useRef(''),pendingRevision=useRef<string|undefined>(undefined);
  const callbacks=useRef(options);callbacks.current=options;
  const authorityRequest=useRef<AbortController|null>(null);
  const blankRefreshPending=useRef(false);
  restore.current=options.onRestore;latest.current={value,pending};
  const cancelTimer=()=>{if(timer.current!==null)clearTimeout(timer.current);timer.current=null;};
  const cancelAuthority=()=>{authorityRequest.current?.abort();authorityRequest.current=null;};
  async function write(value:AuthorizedDraftValue<T,C>){
    if(!protocol.current.enabled||protocol.current.writeEnabled===false)throw new DraftError('DRAFT_DISABLED');
    const token=generation.current,text=encode(value);
    setStatus('saving');setMessage('正在保存恢复副本…');
    const task=queue.current.catch(()=>{}).then(async()=>{
      if(generation.current!==token||!handle.current)throw new DraftError('DRAFT_CHANGED');
      if(!protocol.current.enabled||protocol.current.writeEnabled===false)throw new DraftError('DRAFT_DISABLED');
      const target=handle.current,saveOptions=value.pending?{commandId:protocol.current.commandId(value.pending)}:{};
      let record;
      try{record=await saveDraft(target,text,saveOptions);}
      catch(error){
        if(!(error instanceof DraftError)||error.message!=='DRAFT_CHANGED'||!target.record)throw error;
        const controller=new AbortController();authorityRequest.current=controller;
        try{
          const allowed=await protocol.current.authorize(controller.signal,value);
          if(controller.signal.aborted||generation.current!==token||handle.current!==target)throw new DraftError('DRAFT_CHANGED');
          if(!allowed){await removeSensitiveDraft(target);throw new DraftError('DRAFT_ACTION_REVOKED');}
          await rebaseDraft(target);
          if(controller.signal.aborted||generation.current!==token||handle.current!==target)throw new DraftError('DRAFT_CHANGED');
          record=await saveDraft(target,text,saveOptions);
        }catch(failure){if(!controller.signal.aborted&&generation.current===token)protocol.current.onAuthorityFailure(failure);throw failure;}
        finally{if(authorityRequest.current===controller)authorityRequest.current=null;}
      }
      if(generation.current!==token)throw new DraftError('DRAFT_CHANGED');
      lastSaved.current=text;
      if(value.pending){pendingRevision.current=record.revision;setOperationId(protocol.current.commandId(value.pending));}
      if(encode(latest.current)===text){setStatus('saved');setMessage('已保存恢复副本；最长24小时。');}
    });
    queue.current=task;
    try{await task;}catch(error){if(generation.current===token){setStatus('failed');setMessage(failureMessage(error));}throw error;}
  }
  useEffect(()=>{
    if(!enabled)return;
    const controller=new AbortController(),token=++generation.current;
    setStatus('loading');
    void (async()=>{
      const allowed=await protocol.current.authorize(controller.signal);
      if(controller.signal.aborted||generation.current!==token)return;
      const copy=await openDraft(scope,{restore:allowed});
      if(controller.signal.aborted||generation.current!==token)return;
      const value=copy.text===null?null:protocol.current.decode(copy.text);
      handle.current=copy.handle;
      if(!allowed){await removeSensitiveDraft(copy.handle);if(!copy.handle.operation)throw new DraftError('DRAFT_ACTION_REVOKED');}
      if(copy.handle.operation){setOperationId(copy.handle.operation.commandId);if(copy.text===null||!allowed){callbacks.current.onSensitiveClear();callbacks.current.onOperation(copy.handle.operation.commandId);setStatus('saved');setMessage(copy.expired?'草稿已过期，敏感内容已清理；原操作仍未知，只能只读核对。':'原操作仍未知，敏感恢复内容不可用；只能只读核对。');setInitialized(true);return;}}
      if(value&&!hasInput(latest.current.value)&&!latest.current.pending){
        latest.current=value;lastSaved.current=copy.text??'';pendingRevision.current=copy.handle.record?.revision;restore.current(value);
        setStatus('saved');setMessage('已恢复当前浏览器的草稿；最长保留24小时。');
      }else{setStatus('ready');setMessage('草稿仅在当前浏览器恢复，最长24小时。');}
      setInitialized(true);
    })().catch(error=>{
      if(controller.signal.aborted||generation.current!==token)return;
      setStatus('failed');setMessage(error instanceof DraftError&&error.message==='DRAFT_EXPIRED'?'草稿已过期并清理；过期不代表原操作未提交。':failureMessage(error));
      protocol.current.onAuthorityFailure(error);
    });
    return()=>{controller.abort();generation.current++;cancelTimer();cancelAuthority();handle.current=null;};
  },[enabled,scopeKey]);
  useEffect(()=>{
    if(!enabled)return;
    try{return subscribeDrafts(value=>{
      if(!matchesDraft(value,scope)){
        const target=handle.current;
        const refreshOtherPurpose=value.reason==='settled'||protocol.current.refreshBlankAfterPurposeRemoval===true&&['expired','discard','revoked'].includes(value.reason);
        if(!refreshOtherPurpose||value.principal!==scope.principal||!value.kind||!value.id||!value.purpose||!target||target.record!==null||target.operation!==null||hasInput(latest.current.value)||latest.current.pending!==null||blankRefreshPending.current)return;
        // Capture blankness before any new input; never reopen a stale null
        // handle using the private value that a purge may have cleared.
        const token=generation.current;blankRefreshPending.current=true;
        const task=queue.current.catch(()=>{}).then(async()=>{
          if(generation.current!==token||handle.current!==target)return;
          if(target.record!==null||target.operation!==null)return;
          const controller=new AbortController();authorityRequest.current=controller;
          try{
            const allowed=await protocol.current.authorize(controller.signal);
            if(controller.signal.aborted||generation.current!==token||handle.current!==target)return;
            if(!allowed)throw new DraftError('DRAFT_ACTION_REVOKED');
            await refreshEmptyDraft(target);
            if(controller.signal.aborted||generation.current!==token||handle.current!==target)return;
            setStatus('ready');setMessage('草稿仅在当前浏览器恢复，最长24小时。');setRefreshIndex(index=>index+1);
          }catch(error){if(!controller.signal.aborted&&generation.current===token){setStatus('failed');setMessage(failureMessage(error));protocol.current.onAuthorityFailure(error);}}
          finally{if(authorityRequest.current===controller)authorityRequest.current=null;}
        }).finally(()=>{blankRefreshPending.current=false;});
        queue.current=task;void task.catch(()=>{});return;
      }
      const preserve=value.reason==='settled'&&encode(latest.current)!==lastSaved.current;
      cancelTimer();cancelAuthority();const token=++generation.current;lastSaved.current='';pendingRevision.current=undefined;
      if(!preserve){latest.current={value:emptyValue,pending:null};callbacks.current.onSensitiveClear();}
      setStatus('loading');setMessage('正在核对已清理的恢复副本…');
      void openDraft(scope,{restore:false}).then(copy=>{
        if(generation.current!==token)return;handle.current=copy.handle;setOperationId(copy.handle.operation?.commandId??null);
        if(copy.handle.operation)callbacks.current.onOperation(copy.handle.operation.commandId);
        setStatus('ready');setMessage(value.reason==='expired'?'草稿已过期，敏感内容已清理；原操作须核对。':'恢复副本已清理。');setRefreshIndex(index=>index+1);
      }).catch(()=>{if(generation.current===token){setStatus('failed');setMessage('恢复副本清理状态无法核验；不会发送新的操作。');}});
    });}catch(error){generation.current++;setInitialized(false);setStatus('failed');setMessage(failureMessage(error));return;}
  },[enabled,scopeKey]);
  useEffect(()=>{
    if(!writeEnabled){cancelTimer();return;}
    if(!enabled||!initialized||!handle.current||pending||!hasInput(value)||encode(latest.current)===lastSaved.current)return;
    setStatus('saving');setMessage('正在保存恢复副本…');
    // Keep the first timer: continuous typing starts one bounded save every 500 ms.
    if(timer.current===null)timer.current=setTimeout(()=>{timer.current=null;void write({...latest.current}).catch(()=>{});},500);
  },[enabled,writeEnabled,value,pending,initialized,refreshIndex]);
  useEffect(()=>{
    const target=handle.current;if(!enabled||!target?.record)return;
    const token=generation.current;
    const expiry=setTimeout(()=>{cancelTimer();cancelAuthority();generation.current++;void removeSensitiveDraft(target).then(()=>{
      if(generation.current!==token+1)return;lastSaved.current='';pendingRevision.current=undefined;callbacks.current.onSensitiveClear();
      if(target.operation){setOperationId(target.operation.commandId);callbacks.current.onOperation(target.operation.commandId);setStatus('saved');}else{setOperationId(null);setStatus('ready');}
      setMessage('草稿已过期，敏感内容已清理；原操作状态以服务器核对为准。');
    }).catch(()=>{setStatus('failed');callbacks.current.onSensitiveClear();setMessage('草稿到期，恢复存储清理失败；当前内容已停止展示。');});},Math.max(0,target.record.expiresAt-Date.now()));
    return()=>clearTimeout(expiry);
  },[enabled,status,operationId]);
  return {enabled,status,message,
    operationId,canSubmit:!enabled||(initialized&&status!=='failed'&&operationId===null),
    safeToLeave:enabled&&status==='saved'&&encode(latest.current)===lastSaved.current,
    async discard(){
      if(!enabled||!handle.current)return;cancelTimer();cancelAuthority();generation.current++;
      try{await removeSensitiveDraft(handle.current,'discard');}
      catch{setStatus('failed');setMessage('恢复副本清理失败；请保留当前输入。');}
    },
    async prepare(command:C){
      if(!enabled||!writeEnabled)return;
      if(!initialized||!handle.current)throw new DraftError('DRAFT_STORAGE_UNAVAILABLE');
      cancelTimer();latest.current={value:latest.current.value,pending:command};
      if(encode(latest.current)!==lastSaved.current)await write({...latest.current});
    },
    async success(commandId:string,preserveInput=false){
      if(!enabled)return true;
      cancelTimer();cancelAuthority();generation.current++;
      latest.current={value:preserveInput?latest.current.value:emptyValue,pending:null};lastSaved.current='';
      try{if(handle.current)await settleDraft(handle.current,commandId,pendingRevision.current??handle.current.record?.revision);}
      catch{setStatus('failed');setMessage('原操作结果已确认，但恢复副本清理失败；禁止新提交，请只读核对并重试清理。');return false;}
      pendingRevision.current=undefined;lastSaved.current='';setOperationId(handle.current?.operation?.commandId??null);setStatus('ready');setMessage('已提交；恢复副本已清理。');
      return handle.current?.operation===null;
    },
    async knownFailure(commandId:string){if(enabled&&writeEnabled&&handle.current){latest.current={...latest.current,pending:null};await queue.current.catch(()=>{});if(protocol.current.writeEnabled===false)return;await saveDraft(handle.current,encode(latest.current),{settledCommandId:commandId});lastSaved.current=encode(latest.current);setOperationId(null);setStatus('saved');}},
  };
}

export function useNoteDraft({scope,principal,note,pending,onRestore,onOperation,onSensitiveClear}:{scope:DraftScope;principal:Principal;note:string;pending:P2016InternalNoteCommand|null;onRestore:(value:NoteDraft)=>void;onOperation:(id:string)=>void;onSensitiveClear:()=>void}){
  const client=useQueryClient(),stage=useRef<'session'|'ticket'>('session');
  return useAuthorizedDraft<string,P2016InternalNoteCommand>({scope,enabled:principal.draft_recovery_enabled,value:note,pending,emptyValue:'',hasInput:value=>Boolean(value),
    serialise:value=>JSON.stringify({schema:1,note:value.value,pending:value.pending}),decode:text=>{const value=decodeNote(text);return {value:value.note,pending:value.pending};},commandId:command=>command.client_command_id,
    authorize:async signal=>{
      stage.current='session';const fresh=await api.bootstrap(signal);client.setQueryData(['session'],fresh);
      if(fresh.principal_id!==scope.principal)throw new DraftError('DRAFT_IDENTITY_CHANGED');
      if(!fresh.draft_recovery_enabled||!fresh.internal_notes_enabled)throw new DraftError('DRAFT_DISABLED');
      stage.current='ticket';const context=await api.ticketCommandContext(scope.id,signal);client.setQueryData(['ticket-command-context',scope.principal,scope.id],context);return context.allowed_actions.includes('add-note');
    },onAuthorityFailure:error=>{
      if(error instanceof ApiError&&error.status===401)void clearSessionAuthorization(client,scope.principal,401,'revoked');
      else if(error instanceof ApiError&&error.status===403&&stage.current==='session')void clearSessionAuthorization(client,scope.principal,403,'revoked');
      else if(error instanceof ApiError&&[403,404].includes(error.status))void clearTicketAuthorization(client,scope.principal,scope.id,error);
    },onRestore:value=>onRestore({schema:1,note:value.value,pending:value.pending}),onOperation,onSensitiveClear});
}
