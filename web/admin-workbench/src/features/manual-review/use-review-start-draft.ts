import {useEffect,useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {api,ApiError,captureWorkbenchRead} from '../../api/client';
import type {Principal} from '../../api/client';
import {clearSessionAuthorization} from '../../app/authorization';
import {DraftError,hasExistingDraft,openDraft,purgeDrafts,removeSensitiveDraft} from '../drafts/encrypted-drafts';
import {useAuthorizedDraft} from '../drafts/use-note-draft';
import {canonicalItem,reviewVersion,resolutions} from './client';
import type {ReviewInput} from './use-review-draft';
import {decodeReviewStartCommand,decodeReviewStartTicket,decodeReviewStartSessions,reviewStartApi} from './start-client';
import type {ReviewResolveAndStartCommand} from './start-client';

export interface ReviewStartInput {
  review:ReviewInput;
  capture:{ticket:ReviewResolveAndStartCommand['expected_ticket'];team:string}|null;
  choice:ReviewResolveAndStartCommand['communication_choice'];
  sessions:ReviewResolveAndStartCommand['sessions'];
  touched:boolean;
  original:ReviewResolveAndStartCommand|null;
}
type Copy={value:ReviewStartInput;pending:ReviewResolveAndStartCommand|null};
export function emptyReviewStartInput(reviewId:string):ReviewStartInput{return {review:{review_id:reviewId,choice:'',reason:'',capture:null},capture:null,choice:'TAKE_SELECTED',sessions:[],touched:false,original:null};}
function object(value:unknown,keys:readonly string[]):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))throw new DraftError('DRAFT_CORRUPT');return value as Record<string,unknown>;}
function decode(text:string,reviewId:string):Copy{
  try{
    const root=object(JSON.parse(text),['schema','value','pending']),v=object(root.value,['review','capture','choice','sessions','touched','original']);
    const r=object(v.review,['review_id','choice','reason','capture']);
    if(root.schema!==1||r.review_id!==reviewId||typeof r.choice!=='string'||r.choice!==''&&!Object.hasOwn(resolutions,r.choice)||typeof r.reason!=='string'||r.reason!==''&&!/^[A-Z][A-Z0-9_]{0,63}$/u.test(r.reason)||typeof v.touched!=='boolean')throw new DraftError('DRAFT_CORRUPT');
    let material:ReviewInput['capture']=null;
    if(r.capture!==null){const c=object(r.capture,['row_version','material_basis','canonical_item']);if(typeof c.material_basis!=='string'||!/^[a-f0-9]{64}$/u.test(c.material_basis))throw new DraftError('DRAFT_CORRUPT');material={row_version:reviewVersion(c.row_version),material_basis:c.material_basis,canonical_item:canonicalItem(c.canonical_item)};}
    let capture:ReviewStartInput['capture']=null;
    if(v.capture!==null){const c=object(v.capture,['ticket','team']);if(typeof c.team!=='string'||c.team!==''&&!/^[A-Z][A-Z0-9_]{0,63}$/u.test(c.team))throw new DraftError('DRAFT_CORRUPT');
      capture={ticket:decodeReviewStartTicket(c.ticket),team:c.team};}
    if(v.choice!=='TAKE_SELECTED'&&v.choice!=='RETAIN_CURRENT'||!Array.isArray(v.sessions)||v.sessions.length>8)throw new DraftError('DRAFT_CORRUPT');
    const selected=decodeReviewStartSessions(v.sessions);
    if(v.choice==='RETAIN_CURRENT'&&selected.length)throw new DraftError('DRAFT_CORRUPT');
    const original=v.original===null?null:decodeReviewStartCommand(v.original),pending=root.pending===null?null:decodeReviewStartCommand(root.pending);
    if(pending&&(!original||JSON.stringify(pending)!==JSON.stringify(original)))throw new DraftError('DRAFT_CORRUPT');
    if(original&&(!material||!capture||original.expected_row_version!==material.row_version||original.expected_material_basis!==material.material_basis||original.resolution_reason_code!==r.reason
      ||r.choice!==original.resolution_code||JSON.stringify(original.expected_ticket)!==JSON.stringify(capture.ticket)||original.resolver_team_id!==capture.team||original.communication_choice!==v.choice||JSON.stringify(original.sessions)!==JSON.stringify(selected)))throw new DraftError('DRAFT_CORRUPT');
    return {value:{review:{review_id:reviewId,choice:r.choice as ReviewInput['choice'],reason:r.reason,capture:material},capture,choice:v.choice,sessions:selected,touched:v.touched,original},pending};
  }catch{throw new DraftError('DRAFT_CORRUPT');}
}
export function useReviewStartDraft({principal,reviewId,value,pending,onRestore,onSensitiveClear,onOperation}:{principal:Principal;reviewId:string;value:ReviewStartInput;pending:ReviewResolveAndStartCommand|null;onRestore:(copy:Copy)=>void;onSensitiveClear:()=>void;onOperation:(id:string)=>void}){
  const client=useQueryClient(),scope={principal:principal.principal_id,kind:'review' as const,id:reviewId,purpose:'review-resolve-start'},capability=principal.manual_review_resolve_and_start_enabled===true;
  const writeEnabled=capability&&principal.manual_review_draft_recovery_enabled,[existing,setExisting]=useState(false),[restoring,setRestoring]=useState(writeEnabled),[unavailable,setUnavailable]=useState(false);
  const revision=useRef(0),restoreRequest=useRef<AbortController|null>(null),validating=useRef(false);
  useEffect(()=>{let ignore=false;void hasExistingDraft(scope).then(async found=>{if(ignore)return;if(found&&!capability){await purgeDrafts({...scope,reason:'revoked'},{preserveOperations:true});return;}setExisting(found);}).catch(()=>{if(!ignore)setUnavailable(true);});return()=>{ignore=true;};},[principal.principal_id,reviewId,capability]);
  const clear=()=>{revision.current++;restoreRequest.current?.abort();restoreRequest.current=null;validating.current=false;setRestoring(false);onSensitiveClear();};
  const revoke=async(error:unknown)=>{
    clear();
    if(error instanceof ApiError&&error.status===401){await clearSessionAuthorization(client,scope.principal,401,'revoked');return;}
    await purgeDrafts({...scope,reason:'revoked'});
  };
  const draft=useAuthorizedDraft<ReviewStartInput,ReviewResolveAndStartCommand>({scope,enabled:capability&&(writeEnabled||existing),writeEnabled,value,pending,emptyValue:emptyReviewStartInput(reviewId),hasInput:value=>value.touched,
    serialise:copy=>JSON.stringify({schema:1,value:{...copy.value,original:copy.pending??copy.value.original},pending:copy.pending}),decode:text=>decode(text,reviewId),commandId:command=>command.client_command_id,
    authorize:async signal=>{
      const fresh=await api.bootstrap(signal);client.setQueryData(['session'],fresh);
      if(fresh.principal_id!==scope.principal)throw new DraftError('DRAFT_IDENTITY_CHANGED');
      if(!fresh.manual_review_resolve_and_start_enabled)throw new DraftError('DRAFT_ACTION_REVOKED');
      try{await reviewStartApi.context(reviewId,signal);}catch(error){if(error instanceof ApiError&&[403,404].includes(error.status))throw new DraftError('DRAFT_ACTION_REVOKED');throw error;}
      return fresh.manual_review_draft_recovery_enabled;
    },onAuthorityFailure:error=>{
      if(error instanceof ApiError&&[401,403].includes(error.status))void clearSessionAuthorization(client,scope.principal,error.status,'revoked');
      else if(error instanceof DraftError&&error.message==='DRAFT_IDENTITY_CHANGED')void clearSessionAuthorization(client,scope.principal,401,'revoked');
      else if(error instanceof DraftError&&error.message==='DRAFT_ACTION_REVOKED')void revoke(error).catch(()=>setUnavailable(true));
      else{setUnavailable(true);if(error instanceof DraftError&&error.message==='DRAFT_CORRUPT')void openDraft(scope,{restore:false}).then(copy=>removeSensitiveDraft(copy.handle,'revoked')).catch(()=>{});}
    },onRestore:copy=>{
      const controller=new AbortController(),token=++revision.current,current=captureWorkbenchRead(controller.signal);restoreRequest.current?.abort();restoreRequest.current=controller;validating.current=true;setRestoring(true);
      void(async()=>{
        const context=await reviewStartApi.context(reviewId,controller.signal);current();
        if(copy.value.capture?.team&&!context.resolver_teams.some(team=>team.team_id===copy.value.capture?.team))throw new DraftError('DRAFT_ACTION_REVOKED');
        const selected=copy.value.sessions;
        for(const row of selected){await api.readConversation(row.session_id,controller.signal);current();}
        const remaining=new Set(selected.map(row=>row.session_id)),ticketId=copy.value.capture?.ticket?.ticket_id??context.expected_ticket?.ticket_id;
        if(remaining.size&&!ticketId)throw new DraftError('DRAFT_RELATION_CHANGED');
        let cursor:string|null=null;const seen=new Set<string>();
        for(let pageNo=0;remaining.size&&ticketId&&pageNo<10;pageNo++){
          const page=await api.relatedConversations(ticketId,cursor,controller.signal);current();for(const row of page.items)remaining.delete(row.session_id);
          if(!page.next_cursor)break;if(seen.has(page.next_cursor))throw new DraftError('DRAFT_RELATION_CHANGED');seen.add(page.next_cursor);cursor=page.next_cursor;
        }
        if(remaining.size)throw new DraftError('DRAFT_RELATION_CHANGED');
        const stored=await openDraft(scope);current();
        if(stored.text===null||JSON.stringify(decode(stored.text,reviewId))!==JSON.stringify(copy))throw new DraftError('DRAFT_CHANGED');
        if(controller.signal.aborted||token!==revision.current)return;
        onRestore(copy);validating.current=false;setRestoring(false);restoreRequest.current=null;
      })().catch(error=>{if(controller.signal.aborted||token!==revision.current)return;validating.current=false;restoreRequest.current=null;setRestoring(false);setUnavailable(true);
        if(error instanceof ApiError&&error.status===401)void clearSessionAuthorization(client,scope.principal,401,'revoked');
        else if(error instanceof DraftError&&error.message!=='DRAFT_CHANGED')void draft.discard();
      });
    },onSensitiveClear:clear,onOperation});
  useEffect(()=>{if(!validating.current&&['ready','saved','failed','disabled'].includes(draft.status))setRestoring(false);},[draft.status]);
  useEffect(()=>()=>{revision.current++;restoreRequest.current?.abort();},[]);
  return {...draft,revoke,restoring,canSubmit:draft.canSubmit&&!restoring&&!unavailable,safeToLeave:draft.safeToLeave&&!restoring&&!unavailable,
    message:unavailable?'恢复核验暂未完成；当前不会发送新操作，请保持原副本并重新读取。':restoring?'正在核对原复合意图的当前权限与关系…':draft.message};
}
