import {useEffect,useRef,useState} from 'react';
import type {Principal} from '../../api/client';
import {DraftError,hasExistingDraft} from '../drafts/encrypted-drafts';
import {useAuthorizedDraft} from '../drafts/use-note-draft';
import {decodeSupplementCommand,decodeSupplementTarget,sameSupplementTarget} from './client';
import type {SupplementFollowUpCommand,SupplementFollowUpTarget} from './client';
export interface SupplementDispositionInput {target:SupplementFollowUpTarget|null;note:string}
export const EMPTY_SUPPLEMENT_INPUT:SupplementDispositionInput=Object.freeze({target:null,note:''});
function decodeCopy(text:string):{value:SupplementDispositionInput;pending:SupplementFollowUpCommand|null}{
 try{
  const parsed:unknown=JSON.parse(text);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new DraftError('DRAFT_CORRUPT');const row=parsed as Record<string,unknown>;
  if(Object.keys(row).length!==3||row.schema!==1||!row.value||typeof row.value!=='object'||Array.isArray(row.value))throw new DraftError('DRAFT_CORRUPT');const value=row.value as Record<string,unknown>;
  if(Object.keys(value).length!==2||typeof value.note!=='string'||Array.from(value.note).length>2000)throw new DraftError('DRAFT_CORRUPT');
  const input={target:value.target===null?null:decodeSupplementTarget(value.target),note:value.note};
  if(input.note&&!input.target)throw new DraftError('DRAFT_CORRUPT');
  const pending=row.pending===null?null:decodeSupplementCommand(row.pending);
  if(pending&&(!input.target||!sameSupplementTarget(pending,input.target)||pending.disposition_note!==input.note))throw new DraftError('DRAFT_CORRUPT');
  return {value:input,pending};
 }catch{throw new DraftError('DRAFT_CORRUPT');}
}
interface Options {
 ticketId:string;principal:Principal;readReady:boolean;value:SupplementDispositionInput;pending:SupplementFollowUpCommand|null;
 authorize:(signal:AbortSignal,copy?:{value:SupplementDispositionInput;pending:SupplementFollowUpCommand|null})=>Promise<boolean>;
 onAuthorityFailure:(error:unknown)=>void;
 onRestore:(copy:{value:SupplementDispositionInput;pending:SupplementFollowUpCommand|null},signal:AbortSignal)=>Promise<void>;
 onOperation:(id:string)=>void;onSensitiveClear:()=>void;
}
export function useSupplementDraft(options:Options){
 const {ticketId,principal,value,pending}=options,scope={principal:principal.principal_id,kind:'ticket' as const,id:ticketId,purpose:'supplement-disposition'};
 const rawEnabled=principal.supplement_follow_up_enabled===true&&principal.supplement_follow_up_draft_recovery_enabled===true;
 const [existing,setExisting]=useState(false),[probing,setProbing]=useState(true),[restoring,setRestoring]=useState(false),latest=useRef(options);latest.current=options;
 const identity=JSON.stringify([principal.principal_id,principal.authorization_revision,principal.expires_epoch_ms,principal.csrf_token,principal.roles,principal.supplement_follow_up_enabled,principal.supplement_follow_up_draft_recovery_enabled,ticketId]);
 const currentIdentity=useRef(identity);currentIdentity.current=identity;const restoreRequest=useRef<AbortController|null>(null);
 useEffect(()=>{
  const controller=new AbortController();setExisting(false);setProbing(true);
  if(!options.readReady||rawEnabled){setProbing(false);return()=>controller.abort();}
  void hasExistingDraft(scope).then(found=>{if(!controller.signal.aborted)setExisting(found);}).catch(error=>{if(!controller.signal.aborted)latest.current.onAuthorityFailure(error);}).finally(()=>{if(!controller.signal.aborted)setProbing(false);});
  return()=>controller.abort();
 },[identity,rawEnabled,options.readReady]);
 useEffect(()=>{setRestoring(false);return()=>{restoreRequest.current?.abort();restoreRequest.current=null;};},[identity]);
 const draft=useAuthorizedDraft<SupplementDispositionInput,SupplementFollowUpCommand>({scope,enabled:rawEnabled||existing,writeEnabled:rawEnabled,value,pending,emptyValue:EMPTY_SUPPLEMENT_INPUT,
  hasInput:input=>Boolean(input.note),serialise:copy=>JSON.stringify({schema:1,...copy}),decode:decodeCopy,commandId:command=>command.client_command_id,
  authorize:(signal,copy)=>latest.current.authorize(signal,copy),onAuthorityFailure:error=>latest.current.onAuthorityFailure(error),refreshBlankAfterPurposeRemoval:true,
  onRestore:copy=>{
   const controller=new AbortController(),captured=currentIdentity.current;restoreRequest.current?.abort();restoreRequest.current=controller;setRestoring(true);
   void latest.current.onRestore(copy,controller.signal).catch(error=>{if(!controller.signal.aborted&&restoreRequest.current===controller&&captured===currentIdentity.current)latest.current.onAuthorityFailure(error);}).finally(()=>{if(restoreRequest.current===controller){restoreRequest.current=null;setRestoring(false);}});
  },onOperation:id=>latest.current.onOperation(id),onSensitiveClear:()=>{restoreRequest.current?.abort();restoreRequest.current=null;setRestoring(false);latest.current.onSensitiveClear();}
 });
 return {...draft,scope,rawEnabled,existing,probing,restoring};
}
