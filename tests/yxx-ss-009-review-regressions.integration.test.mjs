import test from 'node:test';
import assert from 'node:assert/strict';
import {withSS009Database} from './helpers/yxx-ss-009-resources.mjs';
import {seedPersistedIntake} from './helpers/p2-015-postgres-harness.mjs';
import {migrateCurrentBaseline,migrateCurrentBaselineWithYxx} from '../scripts/migrate-current-baseline.mjs';
import {migrateYxxSelfService} from '../scripts/yxx-self-service-migrate.mjs';
import {createPilotTicketCore} from '../src/p1-005-pilot-ticket-core.mjs';
import {createRuleFirstOrchestrator} from '../src/p2-015-rule-first-orchestrator.mjs';
import {createDecisionStore} from '../src/p2-015-decision-store.mjs';
import {createManualReviewStore} from '../src/p2-015-manual-review.mjs';
import {createServiceIntakeDecisionPort} from '../src/p2-015-service-intake-decision-port.mjs';
import {createSafeActionExecutor,createExistingTicketCommandPort,createP2004FixedCommunicationPort} from '../src/p2-015-safe-action-executor.mjs';
import {createYxxSelfServiceStore} from '../src/yxx-self-service-store.mjs';
import {createYxxSelfServiceOrchestrator} from '../src/yxx-self-service-orchestrator.mjs';
import {g2EvidenceTime} from '../src/p2-g2-evidence-time.mjs';
import {g2CandidateInventory} from '../src/p2-g2-candidate.mjs';
import {input} from './helpers/yxx-ss-009-http-fixture.mjs';

const tables=['channel.message_inbox','intake.service_intake','intake.service_intake_message','intake.service_intake_event',
  'intake.contact_journey','intake.channel_leg','intake.deterministic_decision','intake.safe_action_suggestion',
  'intake.manual_review_item','pilot_ticket.ticket','communication.message','communication.outbox','communication.delivery'];
const receipt=(t,value)=>t.diagnostic('SS009_RECEIPT '+JSON.stringify({...g2EvidenceTime(),candidate_fingerprint:g2CandidateInventory(process.cwd()).fingerprint,status:'PASS',...value}));

test('SS-009 populated 032 Bot graph remains readable linked and replayable after 033 and 034',async t=>{
  await withSS009Database({testContext:t,databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'ss009botup',run:async({pool,databaseUrl})=>{
    await migrateCurrentBaseline({databaseUrl});
    const decisionStore=createDecisionStore(),manualReviewStore=createManualReviewStore();
    const executor=createSafeActionExecutor({intakeDecisionPort:createServiceIntakeDecisionPort(),
      ticketCommandPort:createExistingTicketCommandPort({ticketCore:createPilotTicketCore({pool})}),
      communicationPort:createP2004FixedCommunicationPort(),manualReviewStore,decisionStore});
    const orchestrator=createRuleFirstOrchestrator({pool,identityHmacKey:'ss009-synthetic-bot-upgrade-key-32-characters',decisionStore,safeActionExecutor:executor});
    const entries=[];
    for(const [text,chatType] of [['处方提交不了','group'],['重置密码','single'],['系统不行','group'],['这个问题一直没处理我要投诉','group']]){
      const seed=await seedPersistedIntake({pool,text,chatType});
      const result=await orchestrator.processPersistedIntake({service_intake_id:seed.intakeId,feature_flags:{RULE_FIRST_ORCHESTRATION_ENABLED:true,MANUAL_REVIEW_QUEUE_ENABLED:true}});
      entries.push({seed,result});
    }
    const columns={};for(const table of tables){const [schema,name]=table.split('.');columns[table]=(await pool.query('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position',[schema,name])).rows.map(r=>r.column_name);assert.ok(columns[table].length);assert.ok(columns[table].every(c=>/^[a-z_]+$/u.test(c)));}
    async function snapshot(){const rows={};for(const table of tables)rows[table]=(await pool.query('SELECT to_jsonb(t) AS row FROM (SELECT '+columns[table].join(',')+' FROM '+table+') t ORDER BY to_jsonb(t)::text')).rows.map(r=>r.row);return rows;}
    const before=await snapshot();for(const table of tables)assert.ok(before[table].length>0,'must exercise populated '+table);
    assert.equal((await migrateYxxSelfService({databaseUrl,mode:'check'})).status,'CHECK_ROLLBACK_SUCCEEDED');assert.deepEqual(await snapshot(),before);
    assert.equal((await migrateYxxSelfService({databaseUrl})).status,'APPLIED');
    // The before/after assertion must detect loss of an existing relationship.
    assert.deepEqual(await snapshot(),before);
    assert.equal((await migrateYxxSelfService({databaseUrl})).status,'NOOP_ALREADY_APPLIED');assert.deepEqual(await snapshot(),before);
    const links=(await pool.query(`SELECT i.id::text,i.primary_message_id::text,j.id::text AS journey_id,l.id::text AS leg_id,d.id::text AS decision_id
      FROM intake.service_intake i JOIN channel.message_inbox m ON m.id=i.primary_message_id
      JOIN intake.service_intake_message im ON im.intake_id=i.id AND im.channel_message_id=m.id
      JOIN intake.contact_journey j ON j.origin_intake_id=i.id
      JOIN intake.channel_leg l ON l.source_intake_id=i.id AND l.journey_id=j.id
      JOIN intake.deterministic_decision d ON d.service_intake_id=i.id AND d.journey_id=j.id AND d.channel_leg_id=l.id`)).rows;
    assert.equal(links.length,entries.length);
    for(const {seed,result} of entries){assert.ok(links.some(l=>l.id===seed.intakeId&&l.primary_message_id===seed.messageId&&l.journey_id===result.journey.id&&l.decision_id===result.decision.id));
      const replay=await orchestrator.processPersistedIntake({service_intake_id:seed.intakeId,feature_flags:{RULE_FIRST_ORCHESTRATION_ENABLED:true,MANUAL_REVIEW_QUEUE_ENABLED:true}});assert.equal(replay.decision.replayed,true);assert.equal(replay.decision.id,result.decision.id);}
    assert.deepEqual(await snapshot(),before);
    receipt(t,{kind:'catalog',populated_bot_upgrade:true,baseline:'032',migrations:['033','034'],graph_rows:Object.fromEntries(tables.map(table=>[table,before[table].length])),linked_roots:links.length,existing_rows_unchanged:true,existing_command_replays:true});
  }});
});

test('SS-009 rule savepoint removes a real partial write while committing manual fallback',async t=>{
  await withSS009Database({testContext:t,databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'ss009svpt',run:async({pool,databaseUrl})=>{
    await migrateCurrentBaselineWithYxx({databaseUrl});
    const store=createYxxSelfServiceStore({pool,scopeSecret:'ss009-synthetic-savepoint-secret-32-characters'});
    const scope={scopeHash:'c'.repeat(64),sourceCorpScope:'synthetic-corp',sourceAppScope:'synthetic-app',proofRef:'tests/ss009-savepoint'};
    const body=input('无法安全判断'),accepted=await store.accept({scope,input:body});
    const intake=(await pool.query('SELECT intake_id::text FROM intake.web_request_binding WHERE request_ref=$1',[accepted.receipt.request_ref])).rows[0].intake_id;
    let partialWriteObserved=false,rollbackObserved=false;
    const injectedPool={query:pool.query.bind(pool),async connect(){const client=await pool.connect();return {release:destroy=>client.release(destroy),async query(sql,...args){
      const result=await client.query(sql,...args);
      if(sql==='SAVEPOINT yxx_rule_evaluation'){
        const written=await client.query('UPDATE intake.service_intake SET summary=$2 WHERE id=$1::uuid RETURNING summary',[intake,'synthetic partial mutation']);
        assert.equal(written.rows[0].summary,'synthetic partial mutation');partialWriteObserved=true;
      }
      if(sql==='ROLLBACK TO SAVEPOINT yxx_rule_evaluation')rollbackObserved=true;
      return result;
    }};}};
    const orchestrator=createYxxSelfServiceOrchestrator({pool:injectedPool,profile:'MEMBER_SELF_SERVICE',featureFlags:{YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true},
      ruleEngine:{catalog_version:'TEST',rule_set_version:'TEST',evaluate(){assert.equal(partialWriteObserved,true);throw Error('synthetic rule failure after write');}}});
    const processed=await orchestrator.processOne({requestRef:accepted.receipt.request_ref});
    assert.equal(processed.processed,true);assert.equal(processed.result_code,'MANUAL_REVIEW_REQUIRED');assert.equal(rollbackObserved,true);
    const row=(await pool.query(`SELECT i.summary,i.status,i.pilot_ticket_id::text,b.input_revision,b.processed_revision,
      (SELECT count(*)::int FROM intake.deterministic_decision d WHERE d.service_intake_id=i.id AND d.result_code='MANUAL_REVIEW_REQUIRED') AS decisions,
      (SELECT count(*)::int FROM intake.manual_review_item r WHERE r.service_intake_id=i.id AND r.status='PENDING') AS reviews,
      (SELECT count(*)::int FROM intake.web_command_receipt) AS receipts,
      (SELECT count(*)::int FROM intake.contact_journey j WHERE j.origin_intake_id=i.id) AS journeys
      FROM intake.service_intake i JOIN intake.web_request_binding b ON b.intake_id=i.id WHERE i.id=$1::uuid`,[intake])).rows[0];
    assert.deepEqual(row,{summary:body.description,status:'WAITING_TRIAGE',pilot_ticket_id:null,input_revision:'1',processed_revision:'1',decisions:1,reviews:1,receipts:1,journeys:1});
    assert.equal((await orchestrator.processOne({requestRef:accepted.receipt.request_ref})).replayed,true);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM intake.manual_review_item')).rows[0].n,1);
    receipt(t,{kind:'fault',savepoint_partial_write:true,partial_write_observed:partialWriteObserved,partial_write_rolled_back:true,fallback_decisions:row.decisions,fallback_reviews:row.reviews,acceptance_retained:true});
  }});
});
