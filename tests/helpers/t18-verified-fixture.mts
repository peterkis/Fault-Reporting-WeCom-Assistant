import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {hashP2016,transactionP2016} from '../../src/p2-016-domain-contracts.mjs';
import {WorkbenchError} from '../../src/p2-006-workbench-query.mjs';
import {formatEpochMsToShanghaiLocal} from '../../src/platform/time-contract.mjs';
import type {PostgresPool} from '../../src/platform/postgres-pool.mjs';
import type {ManualReporterDirectoryOptions,WorkbenchReporterCandidate} from '../../contracts/workbench_reporter_candidates_contracts.js';

// Isolated configured authority only: no real directory, identity or message transport.
export function createT18Directory(refusal:'SEARCH'|'VERIFY'|null=null,coordinates:{application?:{sourceCorpScope:string;sourceAppScope:string};memberId?:string;scopeSecret?:string;mappingHash?:string;mappingProof?:string;bindingProof?:string}={}){
  const application=coordinates.application??{sourceCorpScope:'wbint-t18-synthetic-corp',sourceAppScope:'wbint-t18-synthetic-app'};
  const directoryScope='WBINT_T18_SYNTHETIC_DIRECTORY',mappingHash=coordinates.mappingHash??'c'.repeat(64),mappingProof=coordinates.mappingProof??'T18_SYNTHETIC_MAPPING_PROOF';
  const target={scopeHash:createHmac('sha256',coordinates.scopeSecret??'T18_ISOLATED_SCOPE_SECRET_NOT_A_LIVE_CREDENTIAL')
    .update(JSON.stringify(['member',application.sourceCorpScope,application.sourceAppScope,coordinates.memberId??'T18_SYNTHETIC_CANONICAL_MEMBER_A'])).digest('hex'),...application,proofRef:mappingProof};
  const observation={scope:target,mapping_config_hash:mappingHash,verification_method:'VERIFIED_DELEGATED_MAPPING',profile_source:'THIRD_PARTY_STAFF_DIRECTORY',
    directory_source_scope:directoryScope,directory_snapshot_version:'T18_SYNTHETIC_DIRECTORY_V1',profile_at_report:{display_name:'合成成员甲',departments:['合成门诊']},
    binding_proof_ref:coordinates.bindingProof??'T18_SYNTHETIC_BINDING_PROOF',account_status:'ACTIVE',binding_state:'VERIFIED',proof_kind:'SYNTHETIC',
    reachability:{status:'REACHABLE',target_scope_hash:target.scopeHash}};
  const candidate:WorkbenchReporterCandidate={candidate_ref:'t18_synthetic_allowed_candidate_01',
    candidate_version:hashP2016({candidate_ref:'t18_synthetic_allowed_candidate_01',...observation}),display_name:'合成成员甲',departments:['合成门诊'],
    profile_source:'THIRD_PARTY_STAFF_DIRECTORY',binding_verified:true,message_reachability:'REACHABLE'};
  const calls={search:0,verify:0};let principalId:string|null=null;
  const directory:ManualReporterDirectoryOptions={application,directorySourceScope:directoryScope,
    verificationAuthority:{mappingConfigHash:mappingHash,mappingProofRef:mappingProof,proofKind:'SYNTHETIC',validationProfile:'ISOLATED_TEST'},
    port:{
      async searchAuthorizedCandidates(input){
        calls.search++;assert.ok(principalId);assert.equal(input.principal_id,principalId);assert.deepEqual(input.application,application);
        assert.equal(input.directory_source_scope,directoryScope);input.signal.throwIfAborted();
        if(refusal==='SEARCH')throw new WorkbenchError('P2_016_FORBIDDEN',403);
        return {schema_version:1,candidates:[candidate],next_cursor:null,manual_fallback_available:true};
      },
      async verifyAuthorizedCandidate(input){
        calls.verify++;assert.ok(principalId);assert.equal(input.principal_id,principalId);assert.deepEqual(input.application,application);
        assert.equal(input.directory_source_scope,directoryScope);assert.equal(input.purpose,'ADMISSION');assert.equal(input.committed_target_scope,null);
        assert.deepEqual(input.selection,{verification:'VERIFIED_SELECTION',candidate_ref:candidate.candidate_ref,candidate_version:candidate.candidate_version});
        input.signal.throwIfAborted();if(refusal==='VERIFY')throw new WorkbenchError('P2_016_FORBIDDEN',403);
        const epoch=String(Date.now()),local=formatEpochMsToShanghaiLocal(epoch),until=String(BigInt(epoch)+300_000n);
        return {schema_version:1,purpose:'ADMISSION',selection:input.selection,application,directory_source_scope:directoryScope,actor_principal_id:principalId,
          object_access:'ALLOWED',authorized_at:local,authorized_at_epoch_ms:epoch,valid_until:formatEpochMsToShanghaiLocal(until),valid_until_epoch_ms:until,
          proof:{source:'VERIFIED_DIRECTORY_SELECTION',...observation,
            reachability:{...observation.reachability,checked_at:local,checked_at_epoch_ms:epoch,proof_ref:'T18_SYNTHETIC_REACHABILITY_PROOF'},
            verified_at:local,verified_at_epoch_ms:epoch,actor_principal_id:principalId}};
      },
    }};
  return {directory,candidate,calls,setPrincipal(value:string){principalId=value;}};
}

// This is only the original first tracer's forward-check caller. The production
// migration-entry gap remains a separate test; no business success is seeded here.
export async function applyT18ForwardCheck(pool:PostgresPool):Promise<void>{
  const id='051_workbench_verified_manual_report_candidate_ref_check';
  const sql=await readFile(new URL('../../database/migrations/'+id+'.sql',import.meta.url),'utf8');
  const body=/^\s*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/u.exec(sql)?.[1];if(!body)throw new Error('T18_051_MIGRATION_BODY_INVALID');
  const checksum=createHash('sha256').update(sql).digest('hex');
  await transactionP2016(pool,async tx=>{
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('VERIFIED_MANUAL_REPORTS_MIGRATION'))");
    if((await tx.query("SELECT 1 FROM platform.schema_migration WHERE migration_id='045_workbench_verified_manual_reports'")).rowCount!==1)throw new Error('T18_051_PREREQUISITE_MISSING');
    const old=(await tx.query<{checksum_sha256:string}>('SELECT checksum_sha256 FROM platform.schema_migration WHERE migration_id=$1',[id])).rows[0];
    if(old){if(old.checksum_sha256!==checksum)throw new Error('T18_051_CHECKSUM_CONFLICT');return;}
    await tx.query(body);
    await tx.query(`WITH stamp AS (SELECT platform.physical_epoch_ms() AS epoch) INSERT INTO platform.schema_migration(migration_id,checksum_sha256,applied_at,applied_epoch_ms)
      SELECT $1,$2,platform.local_from_epoch_ms(epoch),epoch FROM stamp`,[id,checksum]);
  });
}
