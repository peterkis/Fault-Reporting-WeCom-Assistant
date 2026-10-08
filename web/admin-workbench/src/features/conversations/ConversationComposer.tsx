import {useEffect,useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {api,ApiError,errorMessage} from '../../api/client';
import type {Principal} from '../../api/client';
import {clearItemAuthorization,clearSessionAuthorization} from '../../app/authorization';
import {useAuthorizedDraft} from '../drafts/use-note-draft';
import {DraftError} from '../drafts/encrypted-drafts';
import {conversations,UUID} from './client';
import type {ConversationWorkspaceEntry,ConversationPurpose,ConversationTextCommand,ConversationMessageResult} from './client';
interface SavedCommand {session_id:string;purpose:ConversationPurpose;command:ConversationTextCommand}
interface AuthorityAttempt {stage:'session'|'conversation';signal:AbortSignal;token:number;failure?:unknown}
function decode(text:string,session:string,purpose:ConversationPurpose){
  const v:unknown=JSON.parse(text);if(!v||typeof v!=='object'||Array.isArray(v))throw new DraftError('DRAFT_CORRUPT');const o=v as Record<string,unknown>;
  if(Object.keys(o).length!==3||o.schema!==1||typeof o.value!=='string'||o.value.length>2000)throw new DraftError('DRAFT_CORRUPT');
  let pending:SavedCommand|null=null;
  if(o.pending!==null){const p=o.pending;if(!p||typeof p!=='object'||Array.isArray(p))throw new DraftError('DRAFT_CORRUPT');const s=p as Record<string,unknown>,c=s.command;
    if(Object.keys(s).length!==3||s.session_id!==session||s.purpose!==purpose||!c||typeof c!=='object'||Array.isArray(c))throw new DraftError('DRAFT_CORRUPT');const body=c as Record<string,unknown>;
    if(Object.keys(body).length!==3||typeof body.client_command_id!=='string'||!UUID.test(body.client_command_id)||typeof body.expected_row_version!=='number'||!Number.isSafeInteger(body.expected_row_version)||body.expected_row_version<1||typeof body.text!=='string'||!body.text.trim()||body.text.length>2000)throw new DraftError('DRAFT_CORRUPT');
    pending={session_id:session,purpose,command:Object.freeze({client_command_id:body.client_command_id,expected_row_version:body.expected_row_version,text:body.text})};
  }return {value:o.value,pending};
}
export function ConversationComposer({entry,principal,purpose,onBlockedChange,onCommitted}:{entry:ConversationWorkspaceEntry;principal:Principal;purpose:ConversationPurpose;onBlockedChange:(value:boolean)=>void;onCommitted:(result:ConversationMessageResult)=>void}){
  const session=entry.session.session_id,action=purpose==='messages'?'REPLY':'INTERNAL_NOTE',client=useQueryClient();
  const [value,setValue]=useState(''),[pending,setPending]=useState<SavedCommand|null>(null),[outcome,setOutcome]=useState(''),[busy,setBusy]=useState(false);
  const request=useRef<AbortController|null>(null),epoch=useRef(0),latest=useRef(value);latest.current=value;
  const draftAuthority=useRef<AuthorityAttempt|null>(null);
  const sensitiveClear=()=>{epoch.current++;request.current?.abort();request.current=null;latest.current='';setValue('');setPending(null);setBusy(false);setOutcome('');};
  const isCurrent=(attempt:AuthorityAttempt)=>!attempt.signal.aborted&&epoch.current===attempt.token&&client.getQueryData<Principal>(['session'])?.principal_id===principal.principal_id;
  const authorityFailure=(error:unknown,attempt:AuthorityAttempt)=>{
    if(!isCurrent(attempt)||!(error instanceof ApiError))return false;
    if(error.status===401||(error.status===403&&attempt.stage==='session')){void clearSessionAuthorization(client,principal.principal_id,error.status,'revoked');return true;}
    if([403,404].includes(error.status)){void clearItemAuthorization(client,principal.principal_id,'conversation',session,error);return true;}
    return false;
  };
  async function freshBootstrap(attempt:AuthorityAttempt){
    attempt.stage='session';if(!isCurrent(attempt))throw new DraftError('DRAFT_IDENTITY_CHANGED');
    const fresh=await api.bootstrap(attempt.signal);if(!isCurrent(attempt))throw new DraftError('DRAFT_IDENTITY_CHANGED');
    if(fresh.principal_id!==principal.principal_id){void clearSessionAuthorization(client,principal.principal_id,undefined,'revoked');throw new DraftError('DRAFT_IDENTITY_CHANGED');}
    client.setQueryData(['session'],fresh);return fresh;
  }
  const draft=useAuthorizedDraft<string,SavedCommand>({scope:{principal:principal.principal_id,kind:'conversation',id:session,purpose:purpose==='messages'?'conversation-reply':'conversation-note'},enabled:principal.conversation_draft_recovery_enabled,value,pending,emptyValue:'',hasInput:v=>Boolean(v),serialise:v=>JSON.stringify({schema:1,...v}),decode:t=>decode(t,session,purpose),commandId:v=>v.command.client_command_id,
    authorize:async signal=>{const attempt:AuthorityAttempt={stage:'session',signal,token:epoch.current};draftAuthority.current=attempt;
      try{const fresh=await freshBootstrap(attempt);if(!fresh.conversation_workspace_enabled||!fresh.conversation_draft_recovery_enabled)throw new DraftError('DRAFT_DISABLED');attempt.stage='conversation';const current=await conversations.detail(session,signal);if(!isCurrent(attempt))throw new DraftError('DRAFT_IDENTITY_CHANGED');return current.capabilities.includes(action);}
      catch(error){attempt.failure=error;throw error;}
    },onAuthorityFailure:error=>{const attempt=draftAuthority.current;if(attempt&&attempt.failure===error)authorityFailure(error,attempt);},
    onRestore:v=>{setValue(v.value);setPending(v.pending);if(v.pending)setOutcome('结果未知：请核对原操作，正文与版本保持不变。');},onOperation:()=>setOutcome('结果未知：敏感内容不可用，只能只读核对原操作。'),onSensitiveClear:sensitiveClear});
  const unknown=Boolean(pending||draft.operationId),allowed=entry.capabilities.includes(action),blocked=(busy||unknown||(Boolean(value)&&draft.enabled))&&!draft.safeToLeave;
  useEffect(()=>{onBlockedChange(blocked);return()=>onBlockedChange(false);},[blocked,onBlockedChange]);
  useEffect(()=>()=>{epoch.current++;request.current?.abort();},[]);
  useEffect(()=>{if(!blocked)return;const warn=(e:BeforeUnloadEvent)=>e.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[blocked]);
  async function confirmed(nonce:string,result:ConversationMessageResult,original:string|undefined,token:number){
    if(epoch.current!==token||request.current?.signal.aborted)return;
    const preserve=original===undefined?Boolean(latest.current):latest.current!==original;
    const cleaned=await draft.success(nonce,preserve);if(epoch.current!==token||request.current?.signal.aborted)return;
    if(!preserve){latest.current='';setValue('');}setPending(null);onCommitted(result);
    setOutcome((purpose==='messages'?'已受理发送；请查看本条回复的投递状态。':'已保存内部备注，仅供获权工作人员查看。')+(preserve?' 较新的输入已保留。':'')+(cleaned?'':' 恢复副本清理尚未确认，请只读核对。'));
  }
  async function send(saved?:SavedCommand){
    if(request.current)return;const controller=new AbortController(),token=epoch.current;request.current=controller;setBusy(true);
    const attempt:AuthorityAttempt={stage:'session',signal:controller.signal,token};
    let command=saved;
    try{
      const fresh=await freshBootstrap(attempt);if(!fresh.conversation_workspace_enabled)throw new DraftError('DRAFT_DISABLED');
      attempt.stage='conversation';const current=await conversations.detail(session,controller.signal);if(!isCurrent(attempt))return;if(!current.capabilities.includes(action))throw new ApiError(403,'AUTHORIZATION_REJECTED');
      if(!command)command={session_id:session,purpose,command:Object.freeze({client_command_id:crypto.randomUUID(),expected_row_version:current.session.row_version,text:latest.current.trim()})};
      if(!saved)await draft.prepare(command);if(!isCurrent(attempt))return;
      setPending(command);setOutcome('正在提交原操作…');const result=await conversations.send(session,purpose,command.command,fresh.csrf_token,controller.signal);await confirmed(command.command.client_command_id,result,command.command.text,token);
    }catch(error){if(!isCurrent(attempt))return;
      if(error instanceof ApiError){if(authorityFailure(error,attempt))return;if(command){try{await draft.knownFailure(command.command.client_command_id);setPending(null);}catch{setPending(command);}}setOutcome(error.status===409?'版本已变化，内容已保留；读取当前事实后明确新的操作。':errorMessage(error));}
      else if(command){setPending(command);setOutcome('结果未知：请求可能已提交。请只读核对原操作，或使用保留的原命令核对。');}
      else setOutcome('恢复副本未保存，尚未发送；请保留输入并重新核验。');
    }finally{if(request.current===controller){request.current=null;setBusy(false);}}
  }
  async function check(){
    const nonce=draft.operationId??pending?.command.client_command_id;if(!nonce||request.current)return;const controller=new AbortController(),token=epoch.current;request.current=controller;setBusy(true);
    const attempt:AuthorityAttempt={stage:'conversation',signal:controller.signal,token};
    try{const result=await conversations.receipt(session,purpose,nonce,controller.signal);if(epoch.current!==token||controller.signal.aborted)return;if(result.state==='UNKNOWN'){setOutcome('结果仍未知；未找到收据不代表未提交，请继续只读核对。');return;}await confirmed(nonce,result.result,pending?.command.text,token);}
    catch(error){if(isCurrent(attempt)){if(authorityFailure(error,attempt))return;setOutcome('只读核对失败，原操作仍未知。');}}
    finally{if(request.current===controller){request.current=null;setBusy(false);}}
  }
  const label=purpose==='messages'?'回复报修人':'内部备注';
  return <section className={'conversation-composer '+(purpose==='internal-notes'?'internal-composer':'')} aria-label={label}>
    <form onSubmit={e=>{e.preventDefault();if(allowed&&!busy&&!unknown&&draft.canSubmit&&value.trim())void send();}}>
      <label htmlFor={'conversation-'+purpose}>{label}</label><p id={'audience-'+purpose}>{purpose==='messages'?'发给本服务主题的原报修人；群来源通过 Bot 私聊回复。':'仅供获权工作人员协作，不向报修人发送。'}</p>
      <textarea id={'conversation-'+purpose} data-purpose={purpose} aria-describedby={'audience-'+purpose} maxLength={2000} value={value} disabled={!allowed||busy||unknown} onChange={e=>setValue(e.target.value)}/>
      {draft.enabled?<p role="status" data-conversation-draft={purpose}>{draft.message}</p>:null}
      <div className="note-controls"><button type="submit" data-action={purpose==='messages'?'send-conversation-reply':'save-conversation-note'} disabled={!allowed||busy||unknown||!draft.canSubmit||!value.trim()}>{busy?'正在核对…':label}</button>
        {unknown?<button type="button" data-action={'check-'+purpose} disabled={busy} onClick={()=>void check()}>只读核对原操作</button>:null}
        {pending&&allowed?<button type="button" disabled={busy} onClick={()=>void send(pending)}>用原命令核对</button>:null}
        {value&&draft.enabled&&!busy?<button type="button" data-action={'discard-'+purpose} onClick={()=>void draft.discard()}>清理敏感草稿</button>:null}
      </div><p role="status" {...(purpose==='messages'?{'data-reply-outcome':''}:{'data-note-outcome':''})}>{outcome}</p>
    </form>
  </section>;
}
