import {useRef} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {api,ApiError} from '../../api/client';
import type {Principal} from '../../api/client';
import {clearSessionAuthorization} from '../../app/authorization';
import {DraftError,purgeDrafts} from '../drafts/encrypted-drafts';
import {useAuthorizedDraft} from '../drafts/use-note-draft';
import {candidateApi,candidateActions,candidateReasons,incidentScopes,decodeCandidateOperation} from './client';
import type {CandidateOperation} from './client';
import type {CandidateDecisionValue} from './CandidateDecisionForm';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,CODE=/^[A-Z][A-Z0-9_]{0,63}$/u;
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new DraftError('DRAFT_CORRUPT');return value as Record<string,unknown>;}
function exact(value:Record<string,unknown>,keys:readonly string[]){if(Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))throw new DraftError('DRAFT_CORRUPT');}
function member<T extends string>(value:unknown,allowed:readonly T[]):T|''{if(value==='')return '';if(typeof value!=='string'||!allowed.includes(value as T))throw new DraftError('DRAFT_CORRUPT');return value as T;}
function identity(value:unknown):string{if(typeof value!=='string'||!UUID.test(value))throw new DraftError('DRAFT_CORRUPT');return value;}
function decode(text:string,candidateId:string){
  const row=object(JSON.parse(text));exact(row,['schema','value','pending']);if(row.schema!==1)throw new DraftError('DRAFT_CORRUPT');
  const input=object(row.value);exact(input,['action','reason','scope','owner','team','refs','primary','capture']);
  if(!Array.isArray(input.refs)||input.refs.length>100)throw new DraftError('DRAFT_CORRUPT');const refs=input.refs.map(identity);if(new Set(refs).size!==refs.length)throw new DraftError('DRAFT_CORRUPT');
  const team=input.team;if(typeof team!=='string'||team!==''&&team!=='__NO_TEAM__'&&!CODE.test(team))throw new DraftError('DRAFT_CORRUPT');
  let capture:CandidateDecisionValue['capture']=null;
  if(input.capture!==null){const original=object(input.capture);exact(original,['version','basis']);if(typeof original.version!=='string'||! /^[1-9][0-9]{0,18}$/u.test(original.version)||BigInt(original.version)>9223372036854775807n||original.basis!==null&&(typeof original.basis!=='string'||! /^[a-f0-9]{64}$/u.test(original.basis)))throw new DraftError('DRAFT_CORRUPT');capture={version:original.version,basis:original.basis};}
  const value:CandidateDecisionValue={action:member(input.action,candidateActions),reason:member(input.reason,candidateReasons),scope:member(input.scope,incidentScopes),owner:input.owner===''?'':identity(input.owner),team,refs,primary:input.primary===''||input.primary==='NONE'?input.primary:identity(input.primary),capture};
  return {value,pending:row.pending===null?null:decodeCandidateOperation(row.pending,candidateId)};
}
export function useCandidateDraft({principal,candidateId,value,pending,emptyValue,hasInput,onRestore,onOperation,onSensitiveClear}:{principal:Principal;candidateId:string;value:CandidateDecisionValue;pending:CandidateOperation|null;emptyValue:CandidateDecisionValue;hasInput:(value:CandidateDecisionValue)=>boolean;onRestore:(copy:{value:CandidateDecisionValue;pending:CandidateOperation|null})=>void;onOperation:(id:string)=>void;onSensitiveClear:()=>void}){
  const client=useQueryClient(),stage=useRef<'session'|'candidate'>('session'),scope={principal:principal.principal_id,kind:'incident-candidate' as const,id:candidateId,purpose:'incident-review'};
  return useAuthorizedDraft<CandidateDecisionValue,CandidateOperation>({scope,enabled:principal.incident_candidate_draft_recovery_enabled,value,pending,emptyValue,hasInput,serialise:copy=>JSON.stringify({schema:1,...copy}),decode:text=>decode(text,candidateId),commandId:operation=>operation.body.client_command_id,
    authorize:async signal=>{stage.current='session';const fresh=await api.bootstrap(signal);signal.throwIfAborted();client.setQueryData(['session'],fresh);if(fresh.principal_id!==scope.principal)throw new DraftError('DRAFT_IDENTITY_CHANGED');if(!fresh.incident_candidate_workspace_enabled||!fresh.incident_candidate_draft_recovery_enabled)throw new DraftError('DRAFT_DISABLED');stage.current='candidate';const current=await candidateApi.detail(candidateId,signal);signal.throwIfAborted();client.setQueryData(['incident-candidate-detail',scope.principal,candidateId],current);return current.allowed_scopes.length>0;},
    onAuthorityFailure:error=>{if(error instanceof DraftError&&error.message==='DRAFT_IDENTITY_CHANGED'||error instanceof ApiError&&(error.status===401||error.status===403&&stage.current==='session'))void clearSessionAuthorization(client,scope.principal,401,'revoked');else if(error instanceof ApiError&&[403,404].includes(error.status)||error instanceof DraftError&&['DRAFT_DISABLED','DRAFT_ACTION_REVOKED'].includes(error.message)){onSensitiveClear();void purgeDrafts({...scope,reason:'revoked'}).catch(()=>{});}},onRestore,onOperation,onSensitiveClear});
}
