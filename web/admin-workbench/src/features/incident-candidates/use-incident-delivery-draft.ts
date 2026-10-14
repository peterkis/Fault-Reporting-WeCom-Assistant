import {useEffect,useRef,useState} from 'react';
import type {Principal} from '../../api/client';
import {DRAFT_TTL_MS,DraftError,hasExistingDraft} from '../drafts/encrypted-drafts';
import {useAuthorizedDraft} from '../drafts/use-note-draft';
import {decodeIncidentDeliveryOperation,decodeIncidentDeliveryVersion,decodeIncidentDeliveryAttemptCount} from '../../../../../src/workbench-incident-delivery-browser-contracts.mjs';
import type {IncidentDeliveryOperation,IncidentDeliveryPurpose,IncidentDeliveryResolution,IncidentDeliveryStatus,IncidentDeliverySideEffect} from '../../../../../src/workbench-incident-delivery-browser-contracts.mjs';
export interface IncidentDeliveryDraftValue {deliveryId:string|null;action:''|'RETRY'|'RECONCILE';reason:string;resolution:''|IncidentDeliveryResolution;version:string|null;status:IncidentDeliveryStatus|null;effect:IncidentDeliverySideEffect|null;attemptCount:number|null}
export const EMPTY_INCIDENT_DELIVERY_DRAFT:IncidentDeliveryDraftValue={deliveryId:null,action:'',reason:'',resolution:'',version:null,status:null,effect:null,attemptCount:null};
function corrupt():never{throw new DraftError('DRAFT_CORRUPT');}
function closed(value:unknown,keys:readonly string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))return corrupt();const row=value as Record<string,unknown>;
 if(Object.keys(row).length!==keys.length||keys.some(key=>!Object.hasOwn(row,key)))return corrupt();return row;
}
function decodeCopy(text:string,incidentId:string,purpose:IncidentDeliveryPurpose):{value:IncidentDeliveryDraftValue;pending:IncidentDeliveryOperation|null}{
 try{
  const row=closed(JSON.parse(text),['schema','value','pending']);if(row.schema!==2)return corrupt();
  const value=closed(row.value,['deliveryId','action','reason','resolution','version','status','effect','attemptCount']);
  if(value.deliveryId!==null&&(typeof value.deliveryId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value.deliveryId))||value.action!==''&&value.action!=='RETRY'&&value.action!=='RECONCILE'||typeof value.reason!=='string'||value.reason!==''&&!/^[A-Z0-9_]{1,128}$/u.test(value.reason)||value.resolution!==''&&value.resolution!=='CONFIRMED_SENT'&&value.resolution!=='CONFIRMED_NOT_SENT_REQUEUE'&&value.resolution!=='CANCEL')return corrupt();
  const status=value.status;
  if(status!==null&&status!=='PENDING'&&status!=='LEASED'&&status!=='SENDING'&&status!=='SENT'&&status!=='RECONCILIATION_REQUIRED'&&status!=='DEAD_LETTER'&&status!=='CANCELLED'||value.effect!==null&&value.effect!=='NOT_ATTEMPTED'&&value.effect!=='ACKNOWLEDGED'&&value.effect!=='UNKNOWN')return corrupt();
  const version=value.version===null?null:decodeIncidentDeliveryVersion(value.version);
  const attemptCount=value.attemptCount===null?null:decodeIncidentDeliveryAttemptCount(value.attemptCount);
  const input:IncidentDeliveryDraftValue={deliveryId:value.deliveryId,action:value.action,reason:value.reason,resolution:value.resolution,version,status,effect:value.effect,attemptCount};
  const pending=row.pending===null?null:decodeIncidentDeliveryOperation(row.pending,{incidentId,purpose});
  if(pending&&(pending.deliveryId!==input.deliveryId||pending.action!==input.action||pending.body.expected_row_version!==input.version||pending.body.expected_status!==input.status||pending.body.expected_side_effect_state!==input.effect||pending.body.expected_delivery_attempt_count!==input.attemptCount||pending.body.reason_code!==input.reason||pending.action==='RECONCILE'&&pending.body.resolution!==input.resolution))return corrupt();
  return {value:input,pending};
 }catch{return corrupt();}
}
interface Options {
 principal:Principal;incidentId:string;purpose:IncidentDeliveryPurpose;readReady:boolean;writeReady:boolean;
 value:IncidentDeliveryDraftValue;pending:IncidentDeliveryOperation|null;
 authorize:(signal:AbortSignal)=>Promise<boolean>;
 onAuthorityFailure:(error:unknown)=>void;
 onRestore:(copy:{value:IncidentDeliveryDraftValue;pending:IncidentDeliveryOperation|null},signal:AbortSignal)=>Promise<void>;
 onOperation:(id:string)=>void;onSensitiveClear:()=>void;
}
export function useIncidentDeliveryDraft(options:Options){
 const {principal,incidentId,purpose,value,pending}=options;
 const scope={principal:principal.principal_id,kind:'incident' as const,id:incidentId,purpose:purpose==='INCIDENT_LIFECYCLE'?'incident-delivery-lifecycle':'incident-delivery-public-progress'};
 const rawEnabled=principal.incident_delivery_control_enabled===true&&principal.incident_delivery_control_draft_recovery_enabled===true;
 const [existing,setExisting]=useState(false),[probing,setProbing]=useState(true),[restoring,setRestoring]=useState(false);
 const restoreRequest=useRef<AbortController|null>(null),latest=useRef(options);latest.current=options;
 const identity=JSON.stringify([principal.principal_id,principal.authorization_revision,principal.csrf_token,principal.expires_epoch_ms,principal.roles,principal.incident_delivery_control_enabled,principal.incident_delivery_control_draft_recovery_enabled,incidentId,purpose]),currentIdentity=useRef(identity);currentIdentity.current=identity;
 useEffect(()=>{
  const controller=new AbortController();setExisting(false);setProbing(true);
  if(!options.readReady){setProbing(false);return()=>controller.abort();}
  if(rawEnabled){setProbing(false);return()=>controller.abort();}
  void hasExistingDraft(scope).then(found=>{if(!controller.signal.aborted)setExisting(found);}).catch(error=>{if(!controller.signal.aborted)latest.current.onAuthorityFailure(error);}).finally(()=>{if(!controller.signal.aborted)setProbing(false);});
  return()=>controller.abort();
 },[identity,rawEnabled,options.readReady]);
 useEffect(()=>{setRestoring(false);return()=>{restoreRequest.current?.abort();restoreRequest.current=null;};},[identity]);
 const draft=useAuthorizedDraft<IncidentDeliveryDraftValue,IncidentDeliveryOperation>({scope,enabled:rawEnabled||existing,writeEnabled:rawEnabled&&options.writeReady,value,pending,emptyValue:EMPTY_INCIDENT_DELIVERY_DRAFT,hasInput:input=>Boolean(input.deliveryId||input.action||input.reason||input.version),
  serialise:copy=>JSON.stringify({schema:2,...copy}),decode:text=>decodeCopy(text,incidentId,purpose),commandId:operation=>operation.body.client_command_id,
  authorize:signal=>latest.current.authorize(signal),onAuthorityFailure:error=>latest.current.onAuthorityFailure(error),
  onRestore:copy=>{
   const controller=new AbortController(),captured=currentIdentity.current;restoreRequest.current?.abort();restoreRequest.current=controller;setRestoring(true);
   void latest.current.onRestore(copy,controller.signal).catch(error=>{if(!controller.signal.aborted&&restoreRequest.current===controller&&captured===currentIdentity.current)latest.current.onAuthorityFailure(error);}).finally(()=>{if(restoreRequest.current===controller){restoreRequest.current=null;setRestoring(false);}});
  },
  onOperation:id=>latest.current.onOperation(id),onSensitiveClear:()=>{restoreRequest.current?.abort();restoreRequest.current=null;setRestoring(false);latest.current.onSensitiveClear();}
 });
 return {...draft,scope,rawEnabled,probing,restoring,existing,ttl:DRAFT_TTL_MS};
}
