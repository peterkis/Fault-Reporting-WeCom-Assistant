import {useEffect,useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {api,ApiError} from '../../api/client';
import type {P2016InternalNoteCommand,Principal} from '../../api/client';
import {DraftError,claimDraftReplay,draftScopeKey,matchesDraft,openDraft,rebaseDraft,refreshEmptyDraft,releaseUnsentOperation,removeOwnedSensitiveDraft,removeSensitiveDraft,saveDraft,settleDraft,subscribeDrafts} from './encrypted-drafts';
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
/**
 * Codex review: while a draft is being restored the original operation may already have been submitted and nothing is restored
 * yet, so a restore failure never claims 「本次没有提交，你的输入还在」; that wording belongs to a save before a submit.
 */
function failureMessage(error:unknown,phase:'save'|'restore'='save'):string{
  const reason=error instanceof DraftError?error.message:'';
  if(reason==='DRAFT_FULL')return '恢复不可用：当前浏览器已达到20份草稿上限；当前输入未保存，请先处理已有草稿。';
  if(reason==='DRAFT_OPERATION_FULL')return '恢复不可用：已达到20个未核对操作上限；不能清除它们来提交新操作，请先核对已有操作。';
  if(reason==='DRAFT_TOO_LARGE')return '内容过长：草稿无法保存，本次没有提交。请删减后再提交。';
  if(reason==='DRAFT_OPERATION_CORRUPT')return '恢复不可用：未核对操作记录已损坏，标识仍保留；不能推断原操作失败或提交新操作，请核对当前工单事实。';
  if(phase==='restore')return '草稿暂未恢复：上次的内容和结果暂时读不到，请先不要重复办理。重新打开详情或刷新页面后再试。';
  return '草稿未能保存：本次没有提交，你的输入还在。检查浏览器存储后重试。';
}
export interface AuthorizedDraftValue<T,C> {value:T;pending:C|null}
export interface AuthorizedDraftOptions<T,C> {
  scope:DraftScope;enabled:boolean;writeEnabled?:boolean;refreshBlankAfterPurposeRemoval?:boolean;revalidateRetained?:boolean;value:T;pending:C|null;emptyValue:T;
  hasInput:(value:T)=>boolean;serialise:(value:AuthorizedDraftValue<T,C>)=>string;
  decode:(text:string)=>AuthorizedDraftValue<T,C>;commandId:(command:C)=>string;
  authorize:(signal:AbortSignal,copy?:AuthorizedDraftValue<T,C>)=>Promise<boolean>;onAuthorityFailure:(error:unknown)=>void;
  onRestore:(value:AuthorizedDraftValue<T,C>,retained?:boolean,owned?:DraftHandle)=>void;onOperation:(id:string,preserveInput?:boolean)=>void;onOperationCleared?:(conflict?:boolean)=>void;onSensitiveClear:()=>void;
}
export function useAuthorizedDraft<T,C>(options:AuthorizedDraftOptions<T,C>){
  const {scope,enabled,value,pending,emptyValue}=options,scopeKey=draftScopeKey(scope),writeEnabled=options.writeEnabled??enabled;
  const protocol=useRef(options);protocol.current=options;
  const encode=(value:AuthorizedDraftValue<T,C>)=>protocol.current.serialise(value);
  const hasInput=(value:T)=>protocol.current.hasInput(value);
  const [status,setStatus]=useState(enabled?'loading':'disabled'),[message,setMessage]=useState(''),[initialized,setInitialized]=useState(false);
  const [operationId,setOperationId]=useState<string|null>(null);
  const [sharedConflict,setSharedConflict]=useState(false);
  const [refreshIndex,setRefreshIndex]=useState(0);
  const handle=useRef<DraftHandle|null>(null),generation=useRef(0),restore=useRef(options.onRestore),latest=useRef<AuthorizedDraftValue<T,C>>({value,pending});
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null),queue=useRef<Promise<void>>(Promise.resolve()),lastSaved=useRef(''),pendingRevision=useRef<string|undefined>(undefined);
  const callbacks=useRef(options);callbacks.current=options;
  const authorityRequest=useRef<AbortController|null>(null);
  const blankRefreshPending=useRef(false);
  // A different page's operation must not own this page's unsubmitted input.
  const retainedInput=useRef<AuthorizedDraftValue<T,C>|null>(null),retainedVisible=useRef(false),retainedRestore=useRef<string|null>(null);
  restore.current=options.onRestore;latest.current={value,pending};
  if(sharedConflict&&!pending&&!retainedInput.current&&hasInput(value)){retainedInput.current={value,pending:null};retainedVisible.current=true;}
  if(retainedInput.current&&!pending){
    const rendered={value,pending:null};
    if(retainedVisible.current)retainedInput.current=rendered;
    else if(retainedRestore.current!==null&&(encode(rendered)===retainedRestore.current||hasInput(value))){retainedVisible.current=true;retainedRestore.current=null;retainedInput.current=rendered;}
  }
  const cancelTimer=()=>{if(timer.current!==null)clearTimeout(timer.current);timer.current=null;};
  const cancelAuthority=()=>{authorityRequest.current?.abort();authorityRequest.current=null;};
  const clearRetained=()=>{retainedInput.current=null;retainedVisible.current=false;retainedRestore.current=null;latest.current={value:emptyValue,pending:null};callbacks.current.onSensitiveClear();};
  async function write(value:AuthorizedDraftValue<T,C>,operation?:{commandId:string;prepared?:boolean;preparedText?:string;claimPrepared?:boolean}){
    if(!protocol.current.enabled||protocol.current.writeEnabled===false)throw new DraftError('DRAFT_DISABLED');
    const token=generation.current,text=encode(value);
    setStatus('saving');setMessage('正在保存草稿…');
    const task=queue.current.catch(()=>{}).then(async()=>{
      if(generation.current!==token||!handle.current)throw new DraftError('DRAFT_CHANGED');
      if(!protocol.current.enabled||protocol.current.writeEnabled===false)throw new DraftError('DRAFT_DISABLED');
      const target=handle.current,saveOptions:{commandId?:string;prepared?:boolean;preparedText?:string;claimPrepared?:boolean}=operation??(value.pending?{commandId:protocol.current.commandId(value.pending)}:{});
      let record;
      try{record=await saveDraft(target,text,saveOptions);}
      catch(error){
        if(!(error instanceof DraftError)||error.message!=='DRAFT_CHANGED'||!target.record)throw error;
        const controller=new AbortController();authorityRequest.current=controller;
        try{
          const allowed=await protocol.current.authorize(controller.signal,value);
          if(controller.signal.aborted||generation.current!==token||handle.current!==target)throw new DraftError('DRAFT_CHANGED');
          if(!allowed){await removeSensitiveDraft(target,'revoked');throw new DraftError('DRAFT_ACTION_REVOKED');}
          await rebaseDraft(target);
          if(controller.signal.aborted||generation.current!==token||handle.current!==target)throw new DraftError('DRAFT_CHANGED');
          record=await saveDraft(target,text,saveOptions);
        }catch(failure){if(!controller.signal.aborted&&generation.current===token)protocol.current.onAuthorityFailure(failure);throw failure;}
        finally{if(authorityRequest.current===controller)authorityRequest.current=null;}
      }
      if(generation.current!==token)throw new DraftError('DRAFT_CHANGED');
      lastSaved.current=text;
      if(saveOptions.commandId){pendingRevision.current=record.revision;setOperationId(saveOptions.commandId);}
      if(encode(latest.current)===text){setStatus('saved');setMessage('草稿已保存');}
    });
    queue.current=task;
    try{await task;}catch(error){if(generation.current===token){setStatus('failed');setMessage(failureMessage(error));}throw error;}
  }
  useEffect(()=>{
    if(!enabled)return;
    const controller=new AbortController(),token=++generation.current;setSharedConflict(false);
    setStatus('loading');
    void (async()=>{
      const allowed=await protocol.current.authorize(controller.signal);
      if(controller.signal.aborted||generation.current!==token)return;
      const copy=await openDraft(scope,{restore:allowed});
      if(controller.signal.aborted||generation.current!==token)return;
      const value=copy.text===null?null:protocol.current.decode(copy.text);
      handle.current=copy.handle;
      // An action that is simply not offered, with nothing stored and nothing typed, stays silent. Purging the empty slot would
      // broadcast an 'expired' invalidation that this hook's own subscriber reads as a real expiry of the user's draft.
      if(!allowed&&!copy.handle.record&&!copy.handle.operation&&!hasInput(latest.current.value)&&!latest.current.pending){setStatus('ready');setMessage('');return;}
      if(!allowed){await removeSensitiveDraft(copy.handle);if(!copy.handle.operation)throw new DraftError('DRAFT_ACTION_REVOKED');}
      if(copy.handle.operation){setOperationId(copy.handle.operation.commandId);if(copy.text===null||!allowed){callbacks.current.onSensitiveClear();callbacks.current.onOperation(copy.handle.operation.commandId);setStatus('saved');setMessage(copy.expired?'草稿已过期，敏感内容已清理；原操作仍未知，只能只读核对。':'原操作仍未知，敏感恢复内容不可用；只能只读核对。');setInitialized(true);return;}}
      if(value&&!hasInput(latest.current.value)&&!latest.current.pending){
        latest.current=value;lastSaved.current=copy.text??'';pendingRevision.current=copy.handle.record?.revision;restore.current(value);
        setStatus('saved');setMessage('已恢复当前浏览器的草稿；最长保留24小时。');
      }else{setStatus('ready');setMessage('草稿仅在当前浏览器恢复，最长24小时。');}
      setInitialized(true);
    })().catch(error=>{
      if(controller.signal.aborted||generation.current!==token)return;
      setStatus('failed');setMessage(error instanceof DraftError&&error.message==='DRAFT_EXPIRED'?'草稿已过期并清理；过期不代表原操作未提交。':failureMessage(error,'restore'));
      protocol.current.onAuthorityFailure(error);
    });
    return()=>{controller.abort();generation.current++;cancelTimer();cancelAuthority();handle.current=null;retainedInput.current=null;retainedVisible.current=false;retainedRestore.current=null;};
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
          }catch(error){if(!controller.signal.aborted&&generation.current===token){setStatus('failed');setMessage(failureMessage(error,'restore'));protocol.current.onAuthorityFailure(error);}}
          finally{if(authorityRequest.current===controller)authorityRequest.current=null;}
        }).finally(()=>{blankRefreshPending.current=false;});
        queue.current=task;void task.catch(()=>{});return;
      }
      const released=value.reason==='released';
      const previousOperation=handle.current?.operation?.commandId;
      const previousRevision=handle.current?.record?.revision;
      const changed=value.reason==='settled'||released||value.reason==='discard'&&retainedInput.current!==null;
      const preparing=latest.current.pending!==null&&protocol.current.commandId(latest.current.pending)!==previousOperation;
      const unsaved=changed&&hasInput(latest.current.value)&&(preparing||!latest.current.pending&&encode(latest.current)!==lastSaved.current);
      const preserve=released||changed&&retainedInput.current!==null||value.reason==='settled'&&encode(latest.current)!==lastSaved.current;
      cancelTimer();cancelAuthority();const token=++generation.current;lastSaved.current='';pendingRevision.current=undefined;
      if(!changed){retainedInput.current=null;retainedVisible.current=false;retainedRestore.current=null;setSharedConflict(false);}
      if(!preserve&&!changed){latest.current={value:emptyValue,pending:null};callbacks.current.onSensitiveClear();}
      setStatus('loading');setMessage('正在清除草稿…');
      void openDraft(scope,{restore:false}).then(async copy=>{
        if(generation.current!==token)return;handle.current=copy.handle;setOperationId(copy.handle.operation?.commandId??null);
        // A peer may have already ended its operation before this notification
        // is read. Keep both pages' edits if its failed draft is a new revision.
        if(changed&&unsaved&&!copy.handle.operation&&copy.handle.record&&copy.handle.record.revision!==previousRevision&&!retainedInput.current){
          retainedInput.current={value:latest.current.value,pending:null};retainedVisible.current=true;
        }
        if(copy.handle.operation){
          const different=copy.handle.operation.commandId!==previousOperation,retain=different&&(retainedInput.current!==null||unsaved);
          if(retain&&!retainedInput.current){retainedInput.current={value:latest.current.value,pending:null};retainedVisible.current=true;}
          if(changed&&different&&!retain){latest.current={value:emptyValue,pending:null};callbacks.current.onSensitiveClear();}
          callbacks.current.onOperation(copy.handle.operation.commandId,retain);
          if(retain&&retainedInput.current&&!hasInput(latest.current.value)){
            const local=retainedInput.current,target=copy.handle,controller=new AbortController();authorityRequest.current=controller;
            try{
              const allowed=await protocol.current.authorize(controller.signal,local);
              if(controller.signal.aborted||generation.current!==token||handle.current!==target)return;
              if(!allowed||protocol.current.writeEnabled===false)throw new DraftError('DRAFT_ACTION_REVOKED');
              latest.current=local;retainedRestore.current=encode(local);restore.current(local,true);
            }catch(error){
              if(!controller.signal.aborted&&generation.current===token){setStatus('failed');setMessage(error instanceof DraftError&&error.message==='DRAFT_ACTION_REVOKED'?'当前操作权限已变化，内容已停止展示。':'本页输入暂未恢复，请保留本页并联系管理员。');if(error instanceof DraftError&&error.message==='DRAFT_ACTION_REVOKED'){clearRetained();if(target.operation)callbacks.current.onOperation(target.operation.commandId);}else protocol.current.onAuthorityFailure(error);}return;
            }finally{if(authorityRequest.current===controller)authorityRequest.current=null;}
          }
        }else if(changed&&retainedInput.current){
          const target=copy.handle,owned=target.record===null;
          const controller=new AbortController();authorityRequest.current=controller;
          try{
            while(retainedInput.current){
              const local=retainedInput.current,text=encode(local);
              const allowed=await protocol.current.authorize(controller.signal,local);
              if(controller.signal.aborted||generation.current!==token||handle.current!==target)return;
              if(!allowed||protocol.current.writeEnabled===false)throw new DraftError('DRAFT_ACTION_REVOKED');
              if(!retainedInput.current||encode(retainedInput.current)!==text)continue;
              if(!owned){
                setSharedConflict(true);
                if(callbacks.current.onOperationCleared){
                  callbacks.current.onOperationCleared(true);
                  if(!retainedVisible.current||protocol.current.revalidateRetained){latest.current=local;retainedRestore.current=text;restore.current(local,true);}
                }
                else{if(!retainedVisible.current)callbacks.current.onSensitiveClear();latest.current=local;retainedRestore.current=text;restore.current(local,true);}
                setStatus('failed');setMessage('本页输入未保存；另一页面仍有草稿，请先自行留存。');return;
              }
              await saveDraft(target,text);
              if(controller.signal.aborted||generation.current!==token||handle.current!==target)return;
              if(!retainedInput.current||encode(retainedInput.current)!==text){lastSaved.current=text;continue;}
              retainedInput.current=null;retainedVisible.current=false;retainedRestore.current=null;setSharedConflict(false);lastSaved.current=text;callbacks.current.onSensitiveClear();callbacks.current.onOperationCleared?.();latest.current=local;
              restore.current(local,true,{...target});setStatus('saved');setMessage('草稿已保存，本页输入已保留。');setRefreshIndex(index=>index+1);return;
            }
          }catch(error){
            if(!controller.signal.aborted&&generation.current===token){setStatus('failed');setMessage(error instanceof DraftError&&error.message==='DRAFT_ACTION_REVOKED'?'当前操作权限已变化，内容已停止展示。':'本页输入未保存，请先自行留存，再重新打开。');if(error instanceof DraftError&&error.message==='DRAFT_ACTION_REVOKED'){clearRetained();if(target.record)setSharedConflict(true);}else protocol.current.onAuthorityFailure(error);}return;
          }finally{if(authorityRequest.current===controller)authorityRequest.current=null;}
        }else if((released||value.reason==='settled'&&copy.handle.record!==null)&&previousOperation&&(!latest.current.pending||protocol.current.commandId(latest.current.pending)===previousOperation)){
          const editable={...latest.current,pending:null};
          const peerDraft=Boolean(released&&copy.handle.record&&!hasInput(editable.value));
          if(callbacks.current.onOperationCleared)callbacks.current.onOperationCleared(peerDraft);else callbacks.current.onSensitiveClear();
          latest.current=editable;
          if(peerDraft){setSharedConflict(true);setStatus('failed');setMessage('另一页面的草稿仍在，本页暂时无法提交；请重新打开。');return;}
          if(hasInput(editable.value))restore.current(editable);
        }else if(!preserve){const clearsPrevious=changed&&previousOperation&&(!latest.current.pending||protocol.current.commandId(latest.current.pending)===previousOperation);latest.current={value:emptyValue,pending:null};callbacks.current.onSensitiveClear();if(clearsPrevious)callbacks.current.onOperationCleared?.();}
        else if(changed&&previousOperation&&!latest.current.pending){if(callbacks.current.onOperationCleared)callbacks.current.onOperationCleared();else{const editable=latest.current;callbacks.current.onSensitiveClear();latest.current=editable;restore.current(editable);}}
        setStatus('ready');setMessage(unsaved&&copy.handle.operation?'本页输入未保存；请先核对另一页面的操作。':released?'':value.reason==='expired'?'草稿已过期，敏感内容已清理；原操作须核对。':'草稿已清除');setRefreshIndex(index=>index+1);
      }).catch(()=>{if(generation.current===token){setStatus('failed');setMessage('草稿未能清空：为避免重复提交，暂时只能查看。点击重试。');}});
    });}catch(error){generation.current++;setInitialized(false);setStatus('failed');setMessage(failureMessage(error,'restore'));return;}
  },[enabled,scopeKey]);
  useEffect(()=>{
    if(sharedConflict&&!pending&&hasInput(value))setMessage('本页输入未保存；另一页面仍有草稿，请先自行留存。');
  },[sharedConflict,pending,value]);
  useEffect(()=>{
    if(!writeEnabled){cancelTimer();return;}
    if(!enabled||!initialized||!handle.current||pending||operationId||sharedConflict||retainedInput.current!==null||status==='loading'||!hasInput(value)||encode(latest.current)===lastSaved.current)return;
    setStatus('saving');setMessage('正在保存草稿…');
    // Keep the first timer: continuous typing starts one bounded save every 500 ms.
    if(timer.current===null)timer.current=setTimeout(()=>{timer.current=null;void write({...latest.current}).catch(()=>{});},500);
  // A failed save must stay visible until input or a storage event changes.
  },[enabled,writeEnabled,value,pending,operationId,sharedConflict,initialized,refreshIndex]);
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
    /** The operation the shared draft holds right now (another tab may have replaced it), read without waiting for a render. */
    currentOperation:():string|null=>handle.current?.operation?.commandId??null,
    hasRetainedInput:()=>retainedInput.current!==null,
    hasUnsavedInput:()=>retainedInput.current!==null||!latest.current.pending&&hasInput(latest.current.value)&&encode(latest.current)!==lastSaved.current,
    forgetRetainedInput:()=>{retainedInput.current=null;retainedVisible.current=false;retainedRestore.current=null;cancelTimer();},
    async restrictOperation(commandId:string){
      if(!enabled||!handle.current)return null;
      const target=handle.current,token=generation.current,observed=await openDraft(scope,{restore:false});
      if(generation.current!==token||handle.current!==target)return null;
      if(observed.handle.operation?.commandId===commandId&&observed.handle.record){
        try{await removeOwnedSensitiveDraft(observed.handle);}catch(error){if(!(error instanceof DraftError&&error.message==='DRAFT_CHANGED'))throw error;}
      }
      const current=await openDraft(scope,{restore:false}),next=current.handle.operation?.commandId??null;
      if(generation.current===token&&handle.current===target&&next&&next!==commandId){
        generation.current++;cancelTimer();cancelAuthority();handle.current=current.handle;lastSaved.current='';pendingRevision.current=undefined;
        const retained=retainedInput.current!==null;if(!retained){latest.current={value:emptyValue,pending:null};callbacks.current.onSensitiveClear();}
        setOperationId(next);callbacks.current.onOperation(next,retained);setStatus('ready');setMessage('');
      }
      return next;
    },
    // Capture the preparation's handle and text for cleanup, even if unmount or invalidation clears the live handle.
    prepareSend(command:C){
      if(!enabled)return null;
      const target=handle.current;
      if(!writeEnabled||!initialized||!target)throw new DraftError('DRAFT_STORAGE_UNAVAILABLE');
      const editable={value:latest.current.value,pending:null};
      const commandId=protocol.current.commandId(command);
      const text=encode(editable);
      const ready={...editable,pending:command},preparedText=encode(ready),token=generation.current;
      return {
        async save(){
          cancelTimer();
          latest.current=editable;
          // Keep editable text separate while the original command stays encrypted in control.
          await write(editable,{commandId,prepared:true,preparedText});
        },
        async claim(){
          if(!await claimDraftReplay(scope,commandId,target))throw new DraftError('DRAFT_CHANGED');
          if(generation.current===token&&handle.current===target){
            latest.current=ready;pendingRevision.current=target.record?.revision;lastSaved.current=preparedText;
          }
        },
        release:()=>releaseUnsentOperation(target,commandId,text),
      };
    },
    async claimReplay(commandId:string){
      if(!enabled)return true;
      const target=handle.current,token=generation.current,claimed=await claimDraftReplay(scope,commandId,target??undefined);
      if(claimed&&generation.current===token&&handle.current===target)pendingRevision.current=target?.record?.revision;
      return claimed;
    },
    operationId,canSubmit:!enabled||(initialized&&!sharedConflict&&status!=='failed'&&status!=='loading'&&operationId===null),
    safeToLeave:enabled&&!sharedConflict&&status==='saved'&&encode(latest.current)===lastSaved.current,
    async discard(){
      if(!enabled||!handle.current)return;cancelTimer();cancelAuthority();const token=++generation.current,target=handle.current;
      if(retainedInput.current){
        // The shared record belongs to the other page. Discard only this page's input.
        retainedInput.current=null;retainedVisible.current=false;retainedRestore.current=null;latest.current={value:emptyValue,pending:null};callbacks.current.onSensitiveClear();
        if(target.operation)callbacks.current.onOperation(target.operation.commandId);
        if(target.record&&!target.operation){setSharedConflict(true);setStatus('failed');setMessage('另一页面的草稿仍在，本页暂时无法提交；请重新打开。');}
        else{setStatus('ready');setMessage('本页输入已清空。');}
        return;
      }
      // An encryption already in flight can still commit its revision. Remove
      // that final local revision after the save settles, without touching a
      // newer copy written by another tab.
      const task=queue.current.catch(()=>{}).then(async()=>{if(generation.current!==token||handle.current!==target)return;await removeSensitiveDraft(target,'discard');});
      queue.current=task;
      try{await task;}
      catch{setStatus('failed');setMessage('草稿未能清空：为避免重复提交，暂时只能查看。点击重试。');}
    },
    async prepare(command:C){
      if(!enabled||!writeEnabled)return;
      if(!initialized||!handle.current)throw new DraftError('DRAFT_STORAGE_UNAVAILABLE');
      cancelTimer();latest.current={value:latest.current.value,pending:command};
      if(encode(latest.current)!==lastSaved.current)await write({...latest.current});
    },
    async success(commandId:string,preserveInput=false){
      if(!enabled)return true;
      cancelTimer();cancelAuthority();
      const token=++generation.current,target=handle.current;
      if(retainedInput.current&&!preserveInput){retainedVisible.current=false;retainedRestore.current=null;}
      latest.current={value:preserveInput?latest.current.value:emptyValue,pending:null};lastSaved.current='';
      try{if(target)await settleDraft(target,commandId,pendingRevision.current??target.record?.revision);}
      catch{
        if(generation.current===token&&handle.current===target){setStatus('failed');setMessage('草稿未能清空：为避免重复提交，暂时只能查看。点击重试。');}
        return false;
      }
      // A successful settlement broadcasts too. That subscriber owns the refresh if the handle changed.
      const cleaned=target?.operation===null;
      if(generation.current!==token||handle.current!==target)return cleaned;
      pendingRevision.current=undefined;lastSaved.current='';setOperationId(target?.operation?.commandId??null);setStatus('ready');setMessage(cleaned?'草稿已清空。':'');
      return cleaned;
    },
    async knownFailure(commandId:string,preserveShared=false,options:{revalidateBlocked?:boolean;adoptShared?:boolean;notifyLocal?:boolean;notifyReplacement?:boolean;signal?:AbortSignal;requireCurrent?:()=>void}={}){
      if(!enabled)return true;
      const target=handle.current,token=generation.current;
      // A temporary restore error may block editing. Only the shared-copy
      // path can retry in that state: it reauthorizes the stored intent before
      // changing its revision and cannot replace it with this page's input.
      if(!target||!writeEnabled&&!options.revalidateBlocked||options.revalidateBlocked&&!preserveShared||options.adoptShared&&!options.revalidateBlocked)return false;
      if(retainedInput.current||preserveShared){
        // This page's input is independent of the failed operation. Preserve
        // the other page's own draft rather than writing this page's value into it.
        const controller=new AbortController(),signal=options.signal?AbortSignal.any([controller.signal,options.signal]):controller.signal;authorityRequest.current=controller;let observed:DraftHandle|null=null;
        const requireCurrent=()=>{signal.throwIfAborted();options.requireCurrent?.();};
        try{
          requireCurrent();if(!await protocol.current.authorize(signal))throw new DraftError('DRAFT_ACTION_REVOKED');requireCurrent();
          if(generation.current!==token||handle.current!==target)return false;
          const copy=await openDraft(scope);
          requireCurrent();if(generation.current!==token||handle.current!==target)return false;
          if(copy.handle.operation?.commandId!==commandId){
            const next=copy.handle.operation?.commandId;
            if(next){handle.current=copy.handle;setOperationId(next);if(options.notifyReplacement!==false)callbacks.current.onOperation(next,retainedInput.current!==null);}
            return false;
          }
          if(copy.text===null){
            if(!preserveShared)return false;
            const notifyLocal=options.notifyLocal!==false||retainedInput.current!==null;
            await settleDraft(copy.handle,commandId,undefined,{notifyLocal});requireCurrent();
            if(!notifyLocal&&generation.current===token&&handle.current===target){handle.current=copy.handle;setOperationId(null);setStatus('ready');setMessage('草稿已清空。');}
            return copy.handle.operation===null;
          }
          observed={...copy.handle};
          const other=protocol.current.decode(copy.text);
          if(!other.pending||protocol.current.commandId(other.pending)!==commandId)return false;
          if(!await protocol.current.authorize(signal,other))throw new DraftError('DRAFT_ACTION_REVOKED');requireCurrent();
          if(generation.current!==token||handle.current!==target)return false;
          await saveDraft(copy.handle,encode({value:other.value,pending:null}),{settledCommandId:commandId});
          requireCurrent();if(generation.current!==token||handle.current!==target)return false;
          const own=latest.current.pending!==null&&protocol.current.commandId(latest.current.pending)===commandId;
          const conflict=retainedInput.current!==null||preserveShared&&!own&&!options.adoptShared;
          handle.current=copy.handle;setOperationId(null);setSharedConflict(conflict);setStatus(conflict?'failed':'saved');
          setMessage(conflict?(retainedInput.current?'本页输入未保存；另一页面仍有草稿，请先自行留存。':'另一页面的草稿仍在，本页暂时无法提交；请重新打开。'):'草稿已保存');
          if(options.adoptShared&&!conflict){const restored={value:other.value,pending:null};latest.current=restored;lastSaved.current=encode(restored);restore.current(restored,true,{...copy.handle});}
          if(options.notifyLocal!==false)callbacks.current.onOperationCleared?.(conflict);
          return true;
        }catch(error){
          try{requireCurrent();}catch{return false;}
          if(!signal.aborted&&generation.current===token){
            if(error instanceof DraftError&&error.message==='DRAFT_ACTION_REVOKED'){
              let retainedAllowed=false;
              try{
                while(retainedInput.current){
                  const local=retainedInput.current,text=encode(local),allowed=await protocol.current.authorize(signal,local);requireCurrent();
                  if(generation.current!==token||handle.current!==target)return false;
                  if(!retainedInput.current||encode(retainedInput.current)!==text)continue;
                  retainedAllowed=allowed&&protocol.current.writeEnabled!==false;break;
                }
              }catch(localError){
                if(signal.aborted||generation.current!==token||handle.current!==target)return false;
                if(!(localError instanceof DraftError&&localError.message==='DRAFT_ACTION_REVOKED')){setStatus('failed');setMessage('本页输入暂未恢复，请保留本页并重新核对权限。');protocol.current.onAuthorityFailure(localError);return false;}
              }
              if(!retainedAllowed)clearRetained();
              try{if(observed?.record&&observed.operation?.commandId===commandId)await settleDraft(observed,commandId,observed.record.revision);}catch{/* A different revision or operation belongs to another page. */}
              requireCurrent();if(generation.current!==token||handle.current!==target)return false;
              try{const current=await openDraft(scope,{restore:false}),next=current.handle.operation?.commandId;requireCurrent();if(generation.current!==token||handle.current!==target)return false;if(next&&next!==commandId){handle.current=current.handle;setOperationId(next);callbacks.current.onOperation(next);}}catch{/* Keep the original operation unresolved when storage cannot be read. */}
              setStatus('failed');setMessage(retainedAllowed?'原操作权限已变化；本页输入已保留，请重新核对。':'当前输入的权限已变化，内容已停止展示。');return false;
            }
            protocol.current.onAuthorityFailure(error);
          }
          throw error;
        }
        finally{if(authorityRequest.current===controller)authorityRequest.current=null;}
      }
      latest.current={...latest.current,pending:null};
      await queue.current.catch(()=>{});
      if(generation.current!==token||handle.current!==target||protocol.current.writeEnabled===false)return false;
      const text=encode(latest.current);
      try{await saveDraft(target,text,{settledCommandId:commandId});}
      catch(error){
        // A different tab may have cleared this command and prepared another
        // before its notification reaches us. Read only the current operation.
        if(error instanceof DraftError&&['DRAFT_CHANGED','DRAFT_OPERATION_UNRESOLVED'].includes(error.message)){
          try{
            const copy=await openDraft(scope,{restore:false}),next=copy.handle.operation?.commandId;
            if(generation.current===token&&handle.current===target&&next&&next!==commandId){
              generation.current++;handle.current=copy.handle;lastSaved.current='';pendingRevision.current=undefined;
              setOperationId(next);callbacks.current.onSensitiveClear();callbacks.current.onOperation(next);
              setStatus('ready');setMessage('');
            }
          }catch{/* Keep the old operation unresolved when storage cannot be read. */}
        }
        throw error;
      }
      if(generation.current!==token||handle.current!==target)return false;
      lastSaved.current=text;setOperationId(null);setStatus('saved');
      return target.operation===null;
    },
  };
}

export function useNoteDraft({scope,principal,note,pending,onRestore,onOperation,onOperationCleared,onSensitiveClear}:{scope:DraftScope;principal:Principal;note:string;pending:P2016InternalNoteCommand|null;onRestore:(value:NoteDraft)=>void;onOperation:(id:string)=>void;onOperationCleared?:(conflict?:boolean)=>void;onSensitiveClear:()=>void}){
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
    },onRestore:value=>onRestore({schema:1,note:value.value,pending:value.pending}),onOperation,...(onOperationCleared?{onOperationCleared}:{}),onSensitiveClear});
}
