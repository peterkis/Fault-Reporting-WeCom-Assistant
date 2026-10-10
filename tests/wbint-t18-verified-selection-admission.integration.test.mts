// NEXT_FIRST_NOT_RUN. Original external e3a05f9 source is separately preserved.
// Only the legal configured authority envelope/version/time were aligned; original
// public202/minimal13field/CoreQUEUED/originalUUID READ ACK assertions remain.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {hashP2016,P2016_ERROR_CODES} from '../src/p2-016-domain-contracts.mjs';
import {WORKBENCH_ERROR_CODES,WorkbenchError} from '../src/p2-006-workbench-query.mjs';
import {reporterVerificationAuthority,parseReporterVerification} from '../src/workbench-reporter-verification.mjs';
import {createWorkbenchReporterCandidates} from '../src/workbench-reporter-candidates.mjs';
import {formatEpochMsToShanghaiLocal} from '../src/platform/time-contract.mjs';
import {PostgresBoundaryError} from '../src/platform/postgres-pool.mjs';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
import type {ManualReporterDirectoryOptions,ManualReporterVerificationInput,VerifiedManualReportCommand} from '../contracts/workbench_reporter_candidates_contracts.js';
interface Fixture {origin:string;cookies:string[];principals:{id:string}[];pool:PostgresPool}
function object(value:unknown):Record<string,unknown>{assert.ok(value!==null&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function string(value:unknown):string{assert.equal(typeof value,'string');if(typeof value!=='string')throw Error('EXPECTED_STRING');return value;}
const diagnosticErrorCodes:readonly string[]=Object.freeze([...P2016_ERROR_CODES,...Object.values(WORKBENCH_ERROR_CODES)]);
// Retain only finite public error codes and a boolean. Body, message, labels, proof,
// headers and credentials are never diagnostic output. This is not a server-cause observer.
function safePublicError(input:unknown):{error_code:string;retryable:boolean|null}{
  const error=input!==null&&typeof input==='object'&&!Array.isArray(input)&&'error'in input?input.error:null;
  if(error===null||typeof error!=='object'||Array.isArray(error)||!('code'in error)
    ||typeof error.code!=='string'||!diagnosticErrorCodes.includes(error.code))return {error_code:'UNKNOWN',retryable:null};
  return {error_code:error.code,retryable:'retryable'in error&&typeof error.retryable==='boolean'?error.retryable:null};
}
type PostResponseShape='LEDGER_FAILURE_FRESH'|'LEDGER_FAILURE_REPLAY'|'ERROR_ONLY'|'UNKNOWN';
function safePostResponseShape(input:unknown):PostResponseShape{
  if(input===null||typeof input!=='object'||Array.isArray(input))return 'UNKNOWN';
  if('ok'in input&&input.ok===false&&'replayed'in input){
    if(input.replayed===false)return 'LEDGER_FAILURE_FRESH';
    if(input.replayed===true)return 'LEDGER_FAILURE_REPLAY';
  }
  if(!('ok'in input)&&!('replayed'in input)&&Object.keys(input).length===1&&safePublicError(input).error_code!=='UNKNOWN')return 'ERROR_ONLY';
  return 'UNKNOWN';
}
type ReceiptState='UNKNOWN'|'FAILED'|'COMMITTED';
function safeReceiptState(input:unknown):ReceiptState{
  if(input!==null&&typeof input==='object'&&!Array.isArray(input)&&'state'in input){
    const state=input.state;
    if(state==='UNKNOWN'||state==='FAILED'||state==='COMMITTED')return state;
  }
  return 'UNKNOWN';
}
type VerifierStage='CAPTURE'|'AUTHORITY_NORMALIZE'|'PARSE'|'FENCE';
type VerifierDiagnostic={stage:VerifierStage;status:'PASS'}|{stage:VerifierStage;status:'FAIL';error_code:string;error_name:'WorkbenchError'|'TypeError'|'Error'|'UNKNOWN'};
function safeVerifierFailure(error:unknown):{error_code:string;error_name:'WorkbenchError'|'TypeError'|'Error'|'UNKNOWN'}{
  const code=error!==null&&typeof error==='object'&&'code'in error&&typeof error.code==='string'&&diagnosticErrorCodes.includes(error.code)?error.code:'UNKNOWN';
  return {error_code:code,error_name:error instanceof WorkbenchError?'WorkbenchError':error instanceof TypeError?'TypeError':error instanceof Error?'Error':'UNKNOWN'};
}
const application={sourceCorpScope:'wbint-t18-synthetic-corp',sourceAppScope:'wbint-t18-synthetic-app'};
const directoryScope='WBINT_T18_SYNTHETIC_DIRECTORY',mappingHash='c'.repeat(64),mappingProof='T18_SYNTHETIC_MAPPING_PROOF';
// Controlled isolated authority represents an explicit mapped canonical member;
// this HMAC follows the existing member-purpose convention and is not live proof.
const targetScope={scopeHash:createHmac('sha256','T18_ISOLATED_SCOPE_SECRET_NOT_A_LIVE_CREDENTIAL').update(JSON.stringify(['member',application.sourceCorpScope,application.sourceAppScope,'T18_SYNTHETIC_CANONICAL_MEMBER_A'])).digest('hex'),
  ...application,proofRef:mappingProof};
const stableObservation={scope:targetScope,mapping_config_hash:mappingHash,verification_method:'VERIFIED_DELEGATED_MAPPING',profile_source:'THIRD_PARTY_STAFF_DIRECTORY',
  directory_source_scope:directoryScope,directory_snapshot_version:'T18_SYNTHETIC_DIRECTORY_V1',profile_at_report:{display_name:'合成成员甲',departments:['合成门诊']},
  binding_proof_ref:'T18_SYNTHETIC_BINDING_PROOF',account_status:'ACTIVE',binding_state:'VERIFIED',proof_kind:'SYNTHETIC',
  reachability:{status:'REACHABLE',target_scope_hash:targetScope.scopeHash}};
const candidate={candidate_ref:'t18_synthetic_allowed_candidate_01',candidate_version:hashP2016({candidate_ref:'t18_synthetic_allowed_candidate_01',...stableObservation}),
  display_name:'合成成员甲',departments:['合成门诊'],profile_source:'THIRD_PARTY_STAFF_DIRECTORY',binding_verified:true,message_reachability:'REACHABLE'};
test('a real verified selection is rechecked by server authority and produces one durable manual admission with a stored minimal acknowledgement',async()=>{
  let authorizedPrincipalId:string|null=null,verifyCalls=0;
  const verificationStages:string[]=[];
  const captured:{input:ManualReporterVerificationInput|null;envelope:unknown}={input:null,envelope:null};
  let profile={display_name:'合成成员甲',departments:['合成门诊']};
  const directory:ManualReporterDirectoryOptions={
    application,
    directorySourceScope:directoryScope,
    verificationAuthority:{mappingConfigHash:mappingHash,mappingProofRef:mappingProof,proofKind:'SYNTHETIC',validationProfile:'ISOLATED_TEST'},
    port:{
      async searchAuthorizedCandidates(input){
        assert.equal(input.principal_id,authorizedPrincipalId);
        assert.deepEqual(input.application,directory.application);
        assert.equal(input.directory_source_scope,directory.directorySourceScope);
        input.signal.throwIfAborted();
        return {schema_version:1,candidates:[candidate],next_cursor:null,manual_fallback_available:true};
      },
      async verifyAuthorizedCandidate(input){
        verifyCalls++;
        verificationStages.push('VERIFY_ENTERED');
        captured.input=input;
        assert.ok(authorizedPrincipalId);assert.equal(input.principal_id,authorizedPrincipalId);
        assert.deepEqual(input.application,directory.application);
        assert.equal(input.directory_source_scope,directory.directorySourceScope);
        assert.deepEqual(input.selection,{verification:'VERIFIED_SELECTION',candidate_ref:candidate.candidate_ref,candidate_version:candidate.candidate_version});
        assert.equal(input.purpose,'ADMISSION');assert.equal(input.committed_target_scope,null);
        verificationStages.push('VERIFY_ASSERTIONS_PASSED');
        input.signal.throwIfAborted();
        // Only a controlled synthetic authority supplies the identity/proof. No browser name,
        // phone, directory ID or raw WeCom ID is used to manufacture a binding.
        const epoch=String(Date.now()),local=formatEpochMsToShanghaiLocal(epoch),until=String(BigInt(epoch)+300_000n);
        verificationStages.push('VERIFY_ENVELOPE_RETURNING');
        const envelope={schema_version:1,purpose:'ADMISSION',selection:input.selection,application:directory.application,directory_source_scope:directory.directorySourceScope,
          actor_principal_id:authorizedPrincipalId,object_access:'ALLOWED',authorized_at:local,authorized_at_epoch_ms:epoch,
          valid_until:formatEpochMsToShanghaiLocal(until),valid_until_epoch_ms:until,
          proof:{source:'VERIFIED_DIRECTORY_SELECTION',...stableObservation,profile_at_report:profile,
            reachability:{...stableObservation.reachability,checked_at:local,checked_at_epoch_ms:epoch,proof_ref:'T18_SYNTHETIC_REACHABILITY_PROOF'},
            verified_at:local,verified_at_epoch_ms:epoch,actor_principal_id:authorizedPrincipalId}};
        captured.envelope=envelope;return envelope;
      },
    },
  };
  await withWeb01Fixture(async({origin,cookies,principals,pool}:Fixture)=>{
    assert.ok(principals[0]);authorizedPrincipalId=principals[0].id;
    assert.ok(cookies[0]);const cookie=cookies[0];
    const get=(path:string)=>fetch(origin+path,{headers:{cookie}});
    const bootstrap=await get('/api/lifecycle/bootstrap');assert.equal(bootstrap.status,200);
    const csrf=string(object(await bootstrap.json()).csrf_token);
    const page=await get('/api/workbench/reporter-candidates?q='+encodeURIComponent('合成')+'&limit=2');
    assert.equal(page.status,200);assert.deepEqual(await page.json(),{schema_version:1,candidates:[candidate],next_cursor:null,manual_fallback_available:true});
    const command:VerifiedManualReportCommand={schema_version:1,client_command_id:randomUUID(),source:'PHONE',description:'合成经核实代录：打印机无法打印',location:{text:null,unknown:true},reporter:{verification:'VERIFIED_SELECTION',candidate_ref:candidate.candidate_ref,candidate_version:candidate.candidate_version}};
    const queryRejections:{sequence:number;event:'REJECT'|'SYNC_THROW';sqlstate:string;error_class:'PostgresBoundaryError'|'TypeError'|'Error'|'UNKNOWN'}[]=[];
    let querySequence=0,observerActive=true;
    function recordQueryFailure(sequence:number,event:'REJECT'|'SYNC_THROW',error:unknown):void{
      if(!observerActive)return;
      try{
        const code=error!==null&&typeof error==='object'&&'code'in error&&typeof error.code==='string'&&/^[A-Z0-9]{5}$/u.test(error.code)?error.code:'UNKNOWN';
        const error_class=error instanceof PostgresBoundaryError?'PostgresBoundaryError':error instanceof TypeError?'TypeError':error instanceof Error?'Error':'UNKNOWN';
        if(queryRejections.length<16)queryRejections.push({sequence,event,sqlstate:code,error_class});
      }catch{/* The observation branch never changes the original thrown/rejected object. */}
    }
    const originalConnect=pool.connect,restoreQueries=new Map<object,()=>void>();
    // Proxy the existing overloaded functions without replacing their return contracts.
    // Default property forwarding retains the existing guard marker; do not create one.
    pool.connect=new Proxy(originalConnect,{apply(target,thisArg:unknown,args:unknown[]):unknown{
      const connected:unknown=Reflect.apply(target,thisArg,args);
      try{if(connected instanceof Promise){
        void connected.then((value:unknown)=>{
          try{
            if(!observerActive)return;
            if(value===null||typeof value!=='object'||!('query'in value)||typeof value.query!=='function'||restoreQueries.has(value))return;
            const originalQuery=value.query,client=value;
            restoreQueries.set(client,()=>{client.query=originalQuery;});
            client.query=new Proxy(originalQuery,{apply(query,receiver:unknown,queryArgs:unknown[]):unknown{
              const sequence=++querySequence;
              let result:unknown;
              try{result=Reflect.apply(query,receiver,queryArgs);}
              catch(error){recordQueryFailure(sequence,'SYNC_THROW',error);throw error;}
              try{if(result instanceof Promise)void result.then(()=>{},(error:unknown)=>{recordQueryFailure(sequence,'REJECT',error);});}
              catch{/* Attaching observation cannot replace the original result. */}
              return result;
            }});
          }catch{/* Unsupported observation setup leaves original acquisition unchanged. */}
        },()=>{});
      }}catch{/* Return the same original connect Promise even if observation is unavailable. */}
      return connected;
    }});
    let admitted:Response;
    try{
      admitted=await fetch(origin+'/api/workbench/reports',{method:'POST',headers:{cookie,origin,'content-type':'application/json','idempotency-key':command.client_command_id,'x-csrf-token':csrf},body:JSON.stringify(command)});
    }finally{
      observerActive=false;
      pool.connect=originalConnect;for(const restore of restoreQueries.values())restore();
    }
    // This narrow window can include existing runtime queries; sequence is not causality.
    // Callback/stream failures are NOT_OBSERVED, while those returns remain unchanged.
    console.log('T18_QUERY_REJECTION_DIAGNOSTIC '+JSON.stringify(queryRejections));
    // Observe the same real response without consuming it or adding another request.
    // The prior d980 body remains NOT_CAPTURED; this successor retains safe fields only.
    let diagnosticPayload:unknown=null;try{diagnosticPayload=await admitted.clone().json();}catch{/* UNKNOWN, never print raw text */}
    console.log('T18_POST_DIAGNOSTIC '+JSON.stringify({http_phase:'POST_RETURNED',status:admitted.status,
      ...safePublicError(diagnosticPayload),response_shape:safePostResponseShape(diagnosticPayload),verify_stages:[...verificationStages]}));
    // Pure public verifier observation uses only this POST's actual producer objects.
    // Clone data after producer completion, retaining its exact AbortSignal reference.
    // Do not call Directory.verify, change clocks or probe any old archived object.
    const verifierDiagnostics:VerifierDiagnostic[]=[];
    if(captured.input===null||captured.envelope===null){
      verifierDiagnostics.push({stage:'CAPTURE',status:'FAIL',error_code:'UNKNOWN',error_name:'UNKNOWN'});
    }else{
      let stage:VerifierStage='CAPTURE';
      try{
        const {signal,...data}=captured.input;
        const inputCopy:ManualReporterVerificationInput={...structuredClone(data),signal};
        const envelopeCopy:unknown=structuredClone(captured.envelope);
        verifierDiagnostics.push({stage,status:'PASS'});
        stage='AUTHORITY_NORMALIZE';const authority=reporterVerificationAuthority(directory.verificationAuthority);
        verifierDiagnostics.push({stage,status:'PASS'});
        stage='PARSE';const parsed=parseReporterVerification(envelopeCopy,inputCopy,authority);
        verifierDiagnostics.push({stage,status:'PASS'});
        stage='FENCE';createWorkbenchReporterCandidates({enabled:true,directory}).fence(inputCopy.principal_id,inputCopy.selection,parsed,inputCopy.committed_target_scope);
        verifierDiagnostics.push({stage,status:'PASS'});
      }catch(error){verifierDiagnostics.push({stage,status:'FAIL',...safeVerifierFailure(error)});}
    }
    console.log('T18_PUBLIC_VERIFIER_DIAGNOSTIC '+JSON.stringify(verifierDiagnostics));
    // One existing public READ, using this POST's original UUID and current cookie.
    // Retain only status/state/finite code; never print receipt result, body or ID.
    const receiptDiagnostic:{status:number|null;state:ReceiptState;error_code:string}={status:null,state:'UNKNOWN',error_code:'UNKNOWN'};
    try{
      const receiptObservation=await get('/api/workbench/reports/commands/'+command.client_command_id);
      receiptDiagnostic.status=receiptObservation.status;
      let receiptPayload:unknown=null;try{receiptPayload=await receiptObservation.json();}catch{/* UNKNOWN, no raw text */}
      receiptDiagnostic.state=receiptObservation.status===200?safeReceiptState(receiptPayload):'UNKNOWN';
      receiptDiagnostic.error_code=safePublicError(receiptPayload).error_code;
    }catch{/* Observation remains UNKNOWN; original POST assertions still execute. */}
    console.log('T18_COMMAND_RECEIPT_DIAGNOSTIC '+JSON.stringify(receiptDiagnostic));
    assert.equal(admitted.status,202);const result=object(await admitted.json());
    assert.equal(verifyCalls,1);assert.equal(result.ok,true);assert.equal(result.client_command_id,command.client_command_id);
    assert.equal(result.reporter_verification,'VERIFIED');assert.equal(result.notification_eligibility,'ELIGIBLE');
    assert.equal(result.manual_contact_required,false);assert.equal(result.external_notification,false);assert.equal(result.replayed,false);
    assert.equal(object(result.ticket).status,'QUEUED');assert.equal(result.review,null);
    assert.deepEqual(Object.keys(result).sort(),['ok','client_command_id','intake_id','intake_no','source','reporter_verification','manual_contact_required','notification_eligibility','external_notification','result_code','ticket','review','replayed'].sort());
    // The minimal ACK is stored admission, not a re-read of current directory data.
    profile={display_name:'目录后来更名',departments:['目录后来调岗']};
    const acknowledgement=await get('/api/workbench/reports/commands/'+command.client_command_id);
    assert.equal(acknowledgement.status,200);
    assert.deepEqual(await acknowledgement.json(),{client_command_id:command.client_command_id,state:'COMMITTED',result:{...result,replayed:true}});
    assert.equal(verifyCalls,1);
    // This slice proves public admission and stable minimal receipt only. Criterion 3's
    // actual immutable name/departments/proof projection, negative binding/authorization,
    // physical Outbox/Delivery conservation and rollback are later explicit slices.
  },{workbenchManualReportsEnabled:true,workbenchReporterCandidatesEnabled:true,manualReporterDirectory:directory,workbenchDraftRecoveryEnabled:true});
});
