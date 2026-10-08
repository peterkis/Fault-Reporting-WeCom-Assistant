import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {createP2012IncidentQuery} from '../src/p2-012-incident-query.mjs';
import {createP2012IncidentCommandService} from '../src/p2-012-incident-command-service.mjs';
import {withP2012Database,applyThrough031,apply032Raw,fixtureP2012,assertNoP2012Residual} from './helpers/p2-012-postgres-harness.mjs';
import {createChannelMessageInbox} from '../src/p1-003-channel-message-inbox.mjs';
import {createServiceIntakeProcessor} from '../src/p1-004-service-intake.mjs';
import {adaptWeComSdkFrame} from '../src/p1-002-wecom-sdk-adapter.mjs';
const databaseUrl=process.env.PILOT_DATABASE_URL;
const command=(action,id,version='1',extra={})=>({action,candidate_review_id:id,client_command_id:randomUUID(),reason_code:'OPERATOR_REVIEWED',...(action==='CONFIRM_INCIDENT'?{expected_candidate_version:version}:{expected_row_version:version}),...extra});

test('T27 confirmation refuses appended material without rewriting the immutable evidence or parent version',async()=>{
  await withP2012Database({databaseUrl,purpose:'t27material',run:async({pool,databaseUrl})=>{
    await applyThrough031({pool,databaseUrl});await apply032Raw(pool);
    const f=await fixtureP2012(pool,{reporters:3}),query=createP2012IncidentQuery({pool,enabled:true}),service=createP2012IncidentCommandService({pool,enabled:true});
    const authContext={principal_id:f.admin.id},candidate=await f.newCandidate();
    assert.equal((await service.perform({authContext,command:command('START_REVIEW',candidate.id)})).ok,true);
    const before=await query.detail({authContext,id:candidate.id,kind:'candidate'});
    const target=(await pool.query('SELECT source_bot_id,source_chat_id,reporter_wecom_userid,retention_until,last_message_at FROM intake.service_intake WHERE id=$1::uuid',[f.reports[0].intakeId])).rows[0];
    const frame=adaptWeComSdkFrame({cmd:'aibot_msg_callback',headers:{req_id:'t27-'+randomUUID()},body:{msgid:'t27-'+randomUUID(),aibotid:target.source_bot_id,chattype:'group',chatid:target.source_chat_id,from:{userid:target.reporter_wecom_userid},msgtype:'text',text:{content:'补充：HIS故障仍在，新增材料'}}},{receivedAt:target.last_message_at});
    assert.equal(frame.ok,true);
    const supplement=await createChannelMessageInbox({pool}).accept({message:frame.message,traceId:'t27-synthetic-supplement',privacyClass:'INTERNAL',retentionUntil:target.retention_until},createServiceIntakeProcessor({existingIntakeSelector:()=>({id:f.reports[0].intakeId})}));
    assert.equal(supplement.ok,true,JSON.stringify(supplement));assert.equal(supplement.result.intake.id,f.reports[0].intakeId);assert.equal(supplement.result.message.sequence_no,2);
    const result=await service.perform({authContext,command:command('CONFIRM_INCIDENT',candidate.id,'2',{confirmed_scope:'LOCAL',owner_principal_id:f.handler.id,selected_report_refs:[f.reports[0].decisionId]})});
    assert.equal(result.ok,false,'new material must fence confirmation although the old Decision hash is immutable');
    assert.equal(result.error.code,'P2_012_SOURCE_CONFLICT');
    const after=await query.detail({authContext,id:candidate.id,kind:'candidate'});
    assert.equal(after.row_version,'2');assert.equal(after.source_result_hash,before.source_result_hash);
    assert.equal((await query.list({authContext,kind:'incident'})).items.length,0);
  }});await assertNoP2012Residual({databaseUrl});
});

test('T27 a readable candidate does not disclose inaccessible source populations or evidence references',async()=>{
  await withP2012Database({databaseUrl,purpose:'t27privacy',run:async({pool,databaseUrl})=>{
    await applyThrough031({pool,databaseUrl});await apply032Raw(pool);
    const f=await fixtureP2012(pool,{reporters:3}),query=createP2012IncidentQuery({pool,enabled:true});
    await pool.query("INSERT INTO pilot_ticket.resolver_team(team_id,display_name) VALUES('T27_OTHER','合成另一组')");
    await pool.query("UPDATE pilot_ticket.ticket SET resolver_team_id='T27_OTHER' WHERE id=ANY($1::uuid[])",[f.reports.slice(1).map(r=>r.ticketId)]);
    const candidate=await f.newCandidate(),authContext={principal_id:f.handler.id};
    const detail=await query.detail({authContext,id:candidate.id,kind:'candidate'});
    assert.equal(detail.report_sources.length,1);
    assert.equal(detail.distinct_reporters,null,'a root Ticket read does not authorize whole-cluster populations');
    assert.equal(detail.distinct_departments,null);assert.equal(detail.distinct_locations,null);
    assert.deepEqual(detail.evidence_fact_ids,[]);
    assert.equal(detail.visible_report_source_count,1);
    const page=await query.list({authContext,kind:'candidate',pageLimit:1});
    assert.equal(page.items[0].distinct_reporters,null);assert.deepEqual(page.items[0].evidence_fact_ids,[]);
    const broad=await query.detail({authContext:{principal_id:f.admin.id},id:candidate.id,kind:'candidate'});
    assert.equal(broad.visible_report_source_count,3);assert.equal(broad.distinct_reporters,3);
  }});await assertNoP2012Residual({databaseUrl});
});
