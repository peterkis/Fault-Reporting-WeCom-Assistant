import { readFile } from 'node:fs/promises';
import { createRuleFirstOrchestrator } from '../../src/p2-015-rule-first-orchestrator.mjs';
import { createPilotTicketCore } from '../../src/p1-005-pilot-ticket-core.mjs';
import { createPilotAccessService } from '../../src/p1-009-pilot-access-workbench.mjs';
import { generateIncidentCandidate } from '../../src/p2-007-incident-candidate.mjs';
import { createP2012CandidateSourceAdapter,createP2012CandidateReviewStore } from '../../src/p2-012-candidate-source-adapter.mjs';
import { migrateP2016 } from '../../scripts/p2-016-migrate.mjs';
import { withP2016IsolatedDatabase,applyThrough030,assertNoP2016Residual } from './p2-016-postgres-harness.mjs';
import { seedPersistedIntake } from './p2-015-postgres-harness.mjs';
export const withP2012Database=withP2016IsolatedDatabase;
export const assertNoP2012Residual=assertNoP2016Residual;
export async function applyThrough031({pool,databaseUrl}){await applyThrough030({pool,databaseUrl});await migrateP2016({databaseUrl});}
export async function apply032Raw(pool){await pool.query(await readFile(new URL('../../database/migrations/032_p2_012_human_confirmed_incident.sql',import.meta.url),'utf8'));}
export async function fixtureP2012(pool,{reporters=10,sameReporter=false,reporterGroupSize=1}={}){
  const access=createPilotAccessService({pool});
  const admin=await access.upsertPrincipal({wecomUserId:'synthetic-incident-admin',displayName:'合成管理员',roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});
  const dispatcher=await access.upsertPrincipal({wecomUserId:'synthetic-incident-dispatcher',displayName:'合成调度员',roles:['DISPATCHER'],resolverTeamIds:['PILOT_IT']});
  const handler=await access.upsertPrincipal({wecomUserId:'synthetic-incident-handler',displayName:'合成工程师',roles:['HANDLER'],resolverTeamIds:['PILOT_IT']});
  const outsider=await access.upsertPrincipal({wecomUserId:'synthetic-incident-outsider',displayName:'范围外测试坐席',roles:['HANDLER'],resolverTeamIds:[]});
  const core=createPilotTicketCore({pool}),orchestrator=createRuleFirstOrchestrator({pool,identityHmacKey:'synthetic-incident-identity-hmac-key',safeActionExecutor:{execute:async()=>[]}});
  const reports=[];
  for(let i=0;i<reporters;i++){
    const intake=await seedPersistedIntake({pool,text:'HIS系统无法登录',chatType:i%2?'single':'group',requestType:'INCIDENT',status:'RECEIVED'});
    await pool.query("UPDATE intake.service_intake SET reporter_wecom_userid=$2,source_chat_id=CASE WHEN source_chat_type='group' THEN 'synthetic-incident-group' ELSE NULL END WHERE id=$1::uuid",[intake.intakeId,'synthetic-reporter-'+(sameReporter?0:Math.floor(i/reporterGroupSize))]);
    const ticket=(await core.createForIntake({intakeId:intake.intakeId,occurredAt:intake.receivedAt,traceId:'p2012-synthetic'})).ticket;
    const result=await orchestrator.processPersistedIntake({service_intake_id:intake.intakeId,feature_flags:{RULE_FIRST_ORCHESTRATION_ENABLED:true,MANUAL_REVIEW_QUEUE_ENABLED:true}});
    const binding=(await pool.query('SELECT reporter_identity_hash FROM intake.contact_journey WHERE id=$1::uuid',[result.journey.id])).rows[0].reporter_identity_hash;
    reports.push({decisionId:result.decision.id,ticketId:ticket.id,intakeId:intake.intakeId,reporterRef:binding,legId:result.leg.id});
  }
  const candidate=generateIncidentCandidate({service_family:'HIS',symptom_family:'LOGIN_FAILURE',authoritative_monitoring:reporters<3,
    reports:reports.map((r,i)=>({reporter_ref:r.reporterRef,department_ref:'department-'+i,location_ref:'location-'+i,observed_at:'2026-09-04 10:00:00',evidence_fact_ids:['fact_synthetic_'+i]}))});
  const sourceAdapter=createP2012CandidateSourceAdapter({pool,enabled:true}),store=createP2012CandidateReviewStore({pool,enabled:true});
  async function newCandidate(index=0){
    const source=await sourceAdapter.record({sourceDecisionId:reports[index].decisionId,candidate,reportDecisionIds:reports.map(r=>r.decisionId)});
    return store.importDecision({decisionId:source.id});
  }
  return {admin,dispatcher,handler,outsider,reports,candidate,newCandidate,sourceAdapter,store};
}
