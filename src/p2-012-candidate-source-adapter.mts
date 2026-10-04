import type { PostgresPool, PostgresTransaction } from './platform/postgres-pool.mjs';
import type { DecisionRow, DecisionInput } from './p2-015-decision-store.mjs';
import type { CandidateProjection } from './p2-012-domain-contracts.mjs';
type Options = { pool: PostgresPool; enabled?: boolean };
// JSON fields remain unknown until the existing per-field legacy guards or
// validateCandidate prove the projection. This is only the consumed shape.
export interface CandidateSourceDecision extends Omit<DecisionRow, 'safe_result'> { safe_result: { incident_candidate?: unknown; incident_review_candidate?: unknown; known_fields?: { selected_service_code?: unknown; symptom_codes?: unknown[] }; fact_provenance?: { fact_id?: unknown }[]; clinical_safety_risk?: unknown; incident_report_decision_ids?: string[] }; manual_review_id?: string | null }
export type CandidateImportResult = { id: string; status: 'CANDIDATE' | 'UNDER_REVIEW' | 'CONFIRMED' | 'REJECTED' | 'EXPIRED'; row_version: string; created: boolean };
import { createDecisionStore } from './p2-015-decision-store.mjs';
import { guard,uuid,hash,validateCandidate,frozen,fail,transaction } from './p2-012-domain-contracts.mjs';

// Trusted application seam for an already-computed frozen P2-007 result. No clustering,
// threshold selection, raw-message reading or existing Decision mutation happens here.
export function createP2012CandidateSourceAdapter({pool,enabled=false}: Options){
  const store=createDecisionStore();
  return Object.freeze({async record({sourceDecisionId,candidate,reportDecisionIds,transaction:providedTransaction=null}: { sourceDecisionId: string; candidate: unknown; reportDecisionIds: string[]; transaction?: PostgresTransaction | null }){
    guard(enabled);sourceDecisionId=uuid(sourceDecisionId);const safe=validateCandidate(candidate);
    if(!Array.isArray(reportDecisionIds)||!reportDecisionIds.length||reportDecisionIds.length>100)fail();
    const ids=[...new Set(reportDecisionIds.map(uuid))].sort();
    const record=async (tx: PostgresTransaction)=>{
      const q=await tx.query<DecisionRow>('SELECT * FROM intake.deterministic_decision WHERE id=$1::uuid',[sourceDecisionId]);
      if(q.rowCount!==1)fail('SOURCE_NOT_FOUND',404);const source=(q.rows[0] as DecisionRow);
      await tx.query('SELECT id FROM intake.contact_journey WHERE id=$1::uuid FOR UPDATE',[source.journey_id]);
      const refs=await tx.query('SELECT id::text FROM intake.deterministic_decision WHERE id=ANY($1::uuid[])',[ids]);
      if(refs.rowCount!==ids.length)fail('SOURCE_NOT_FOUND',404);
      const payload={incident_candidate:{...safe,is_candidate:true,creates_incident:false,human_confirmation_required:true},
        incident_report_decision_ids:ids,source_decision_id:sourceDecisionId,source_result_hash:source.result_hash,
        p2_007_candidate_hash:hash(candidate),catalog_version:source.catalog_version,rule_set_version:source.rule_set_version};
      const identity=hash(payload);
      return store.record({transaction:tx,input:{...source,engine_version:'p2-012-candidate-source/1',
        decision_policy_version:'candidate/1/'+identity.slice(0,40),result_code:'INCIDENT_REVIEW_CANDIDATE',
        reason_code:'INCIDENT_CANDIDATE_HUMAN_CONFIRMATION',input_hash:identity,result_hash:hash(payload),safe_result:payload,
        requires_manual_review:true,ticket_creation_recommended:false,incident_review_candidate:true,safe_action_suggestions:[]} as DecisionInput<typeof payload>});
    };
    return providedTransaction ? record(providedTransaction) : transaction(pool,record);
  }});
}

// Legacy P2-015 Decisions are sufficient authority for review. Missing cluster
// metadata stays null; this projection never reconstructs a window or threshold.
export function projectPersistedCandidate(d: CandidateSourceDecision): CandidateProjection{
  if(d.safe_result?.incident_candidate)return validateCandidate(d.safe_result.incident_candidate);
  if(d.result_code!=='INCIDENT_REVIEW_CANDIDATE'||d.safe_result?.incident_review_candidate!==true)fail('SOURCE_EVIDENCE_INCOMPLETE',409);
  const r=d.safe_result,known=r.known_fields??{},safeCode=(v: unknown)=>typeof v==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/u.test(v)?v:'UNKNOWN';
  const facts=Array.isArray(r.fact_provenance)?r.fact_provenance:[];
  return frozen({cluster_key_hash:null,service_family:safeCode(known.selected_service_code),symptom_family:safeCode(known.symptom_codes?.[0]),
    scope_candidate:'UNKNOWN',clinical_severity_candidate:['LOW','MEDIUM','HIGH','CRITICAL'].includes(r.clinical_safety_risk as string)?r.clinical_safety_risk as string:'UNKNOWN',
    distinct_reporters:null,distinct_departments:null,distinct_locations:null,correlation_window_ms:null,
    first_seen_at:null,last_seen_at:null,reason_codes:[safeCode(d.reason_code)],
    evidence_fact_ids:[...new Set(facts.map(f=>f.fact_id).filter((id): id is string=>typeof id==='string'&&/^fact_[A-Za-z0-9_-]{8,96}$/u.test(id)))].sort().slice(0,1000)});
}
export function createP2012CandidateReviewStore({pool,enabled=false}: Options){
  return Object.freeze({async importDecision({decisionId}: { decisionId: string }): Promise<CandidateImportResult>{
    guard(enabled);decisionId=uuid(decisionId);
    return transaction(pool,async tx=>{
      const q=await tx.query<CandidateSourceDecision>(`SELECT d.*,r.id AS manual_review_id FROM intake.deterministic_decision d
        LEFT JOIN intake.manual_review_item r ON r.decision_id=d.id WHERE d.id=$1::uuid`,[decisionId]);
      if(q.rowCount!==1||(q.rows[0] as CandidateSourceDecision).result_code!=='INCIDENT_REVIEW_CANDIDATE')fail('SOURCE_NOT_FOUND',404);
      const d=(q.rows[0] as CandidateSourceDecision),c=projectPersistedCandidate(d);
      const key='candidate_v1_'+hash({source_decision_id:d.id,result_hash:d.result_hash});
      const values=[key,d.id,d.manual_review_id??null,d.result_hash,...['cluster_key_hash','service_family','symptom_family','scope_candidate','clinical_severity_candidate','distinct_reporters','distinct_departments','distinct_locations','correlation_window_ms','first_seen_at','last_seen_at'].map(k=>c[k as keyof CandidateProjection]),JSON.stringify(c.reason_codes),JSON.stringify(c.evidence_fact_ids),JSON.stringify({catalog_version:d.catalog_version,rule_set_version:d.rule_set_version,engine_version:d.engine_version,decision_policy_version:d.decision_policy_version,source_hash:d.source_hash,input_hash:d.input_hash,result_hash:d.result_hash})];
      const result=await tx.query(`WITH clock AS (SELECT platform.physical_epoch_ms()+86400000 AS expiry)
        INSERT INTO incident.candidate_review(candidate_key,source_decision_id,source_manual_review_id,source_result_hash,
          cluster_key_hash,service_family,symptom_family,scope_candidate,clinical_severity_candidate,distinct_reporters,
          distinct_departments,distinct_locations,correlation_window_ms,first_seen_at,last_seen_at,reason_codes,evidence_fact_ids,source_versions,expires_at,expires_epoch_ms)
        SELECT $1,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::timestamp without time zone,$15::timestamp without time zone,$16::jsonb,$17::jsonb,$18::jsonb,platform.local_from_epoch_ms(expiry),expiry FROM clock
        ON CONFLICT(candidate_key) DO NOTHING RETURNING id::text`,values);
      const row=((await tx.query<Omit<CandidateImportResult, 'created'>>('SELECT id::text,status,row_version::text FROM incident.candidate_review WHERE candidate_key=$1',[key])).rows[0] as Omit<CandidateImportResult, "created">);
      return frozen({...row,created:result.rowCount===1});
    });
  }});
}
