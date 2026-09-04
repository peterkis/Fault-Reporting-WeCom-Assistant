import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createPilotTicketCore } from '../src/p1-005-pilot-ticket-core.mjs';
import { createPilotAccessService } from '../src/p1-009-pilot-access-workbench.mjs';
import { createConversationControlService,createPilotConversationControlAuthorization } from '../src/p2-005-conversation-control.mjs';
import { buildConversationThreadIdentity,buildConversationSessionScope } from '../src/p2-001-conversation-contracts.mjs';
import { appendRealtimeEvent } from '../src/p2-003-realtime-event-log.mjs';
import { createP2016TicketQuery } from '../src/p2-016-ticket-query.mjs';
import { createP2016TicketCommandFacade } from '../src/p2-016-ticket-command-facade.mjs';
import { createP2016ReporterAccess } from '../src/p2-016-reporter-access.mjs';
import { createP2016TicketNotificationProjector } from '../src/p2-016-ticket-notification-projector.mjs';
import { WorkbenchError } from '../src/p2-006-workbench-query.mjs';
import { assertP2016Schema } from './helpers/p2-016-schema-assert.mjs';
import { migrateP2016 } from '../scripts/p2-016-migrate.mjs';
import { seedPersistedIntake } from './helpers/p2-015-postgres-harness.mjs';
import { withP2016IsolatedDatabase,applyThrough030,assertNoP2016Residual } from './helpers/p2-016-postgres-harness.mjs';
const databaseUrl=process.env.PILOT_DATABASE_URL;

async function fixture(pool) {
  const access=createPilotAccessService({pool});
  const principal=async(label,roles=['ADMIN'],resolverTeamIds=['PILOT_IT'])=>access.upsertPrincipal({
    wecomUserId:'synthetic-p2016-'+label+'-'+randomUUID(),displayName:'测试坐席 '+label,roles,resolverTeamIds});
  const [admin,other,handler,outsider]=await Promise.all([principal('a'),principal('b'),principal('h',['HANDLER']),principal('x',['HANDLER'],[])]);
  const core=createPilotTicketCore({pool});
  const ticket=async()=>{
    const intake=await seedPersistedIntake({pool,text:'合成故障',requestType:'INCIDENT',status:'RECEIVED'});
    return (await core.createForIntake({intakeId:intake.intakeId,occurredAt:intake.receivedAt,traceId:'synthetic-p2016'})).ticket;
  };
  const session=async t=>{
    const tag=randomUUID(),identity=buildConversationThreadIdentity({provider:'WECOM_AIBOT',botId:'synthetic-bot',chatType:'single',senderUserId:'synthetic-'+tag});
    const thread=await pool.query('INSERT INTO conversation.thread(provider,channel_account_id,chat_type,external_thread_key,thread_key) VALUES($1,$2,$3,$4,$5) RETURNING id::text',[identity.provider,identity.channel_account_id,identity.chat_type,identity.external_thread_key,identity.thread_key]);
    const scope=buildConversationSessionScope({threadKey:identity.thread_key,participantKey:identity.participant_key,serviceIntakeId:t.intake_id,creationIdempotencyKey:'P2016:'+tag});
    return (await pool.query(`INSERT INTO conversation.session(thread_id,participant_key,service_intake_id,session_scope_key,creation_idempotency_key,status,control_mode,last_activity_at)
      VALUES($1::uuid,$2,$3::uuid,$4,$5,'OPEN','HUMAN',platform.local_now()) RETURNING id::text,row_version::integer`,[thread.rows[0].id,scope.participant_key,t.intake_id,scope.session_scope_key,scope.creation_idempotency_key])).rows[0];
  };
  const control=createConversationControlService({pool,enabled:true,authorize:createPilotConversationControlAuthorization({pool}),realtimeAppender:appendRealtimeEvent});
  const query=createP2016TicketQuery({pool,enabled:true});
  return {admin,other,handler,outsider,ticket,session,query,control,facade:createP2016TicketCommandFacade({pool,enabled:true,controlService:control,query})};
}
const command=(ticket,action,extra={})=>({action,ticket_id:ticket.id,expected_version:ticket.version,client_command_id:randomUUID(),reason_code:'SYNTHETIC_TEST',...extra});

test('P2-016 Ticket lifecycle, command persistence, authorization and independent responsibility',async()=>{
  assert.ok(databaseUrl,'database required');
  await withP2016IsolatedDatabase({databaseUrl,purpose:'p2016cmd',run:async({pool,databaseUrl:isolated})=>{
    await applyThrough030({pool,databaseUrl:isolated});await migrateP2016({databaseUrl:isolated});
    const f=await fixture(pool),authContext={principal_id:f.admin.id};
    let ticket=await f.ticket();
    const once=command(ticket,'accept');
    const parallel=await Promise.all(Array.from({length:12},()=>f.facade.perform({authContext,command:once})));
    assert.equal(parallel.filter(r=>!r.replayed).length,1);
    assert.ok(parallel.every(r=>r.ok&&r.ticket_version===2));
    await assert.rejects(f.facade.perform({authContext,command:{...once,reason_code:'DIFFERENT'}}),{code:'P2_016_COMMAND_CONFLICT'});
    assert.equal((await pool.query('SELECT count(*)::integer AS n FROM pilot_ticket.ticket_event WHERE ticket_id=$1::uuid',[ticket.id])).rows[0].n,1);
    for(const action of ['start','request-information','resume','wait-vendor','resume','resolve','confirm','reopen','start','resolve','confirm']){
      ticket=await f.query.detail({authContext,ticketId:ticket.id});
      const result=await f.facade.perform({authContext,command:command(ticket,action)});
      assert.equal(result.ok,true,JSON.stringify(result));
    }
    const events=await f.query.events({authContext,ticketId:ticket.id});
    assert.deepEqual(events.items.map(e=>e.event_ordinal),Array.from({length:12},(_,i)=>i+1));
    ticket=await f.query.detail({authContext,ticketId:ticket.id});assert.equal(ticket.status,'CLOSED');
    const invalid=await f.facade.perform({authContext,command:command(ticket,'accept')});
    assert.equal(invalid.error.code,'INVALID_STATE_TRANSITION');
    await assert.rejects(f.query.detail({authContext:{principal_id:f.outsider.id},ticketId:ticket.id}),{code:'P2_016_NOT_FOUND'});
    const listed=await f.query.list({authContext,state:'closed',limit:1});assert.equal(listed.items[0].id,ticket.id);
    assert.equal((await f.query.list({authContext,state:'mine',limit:1})).items.length,1);
    let cancelled=await f.ticket();assert.equal((await f.facade.perform({authContext,command:command(cancelled,'cancel')})).ok,true);
    const concurrent=await f.ticket();
    const race=await Promise.all([f.admin,f.other].map(p=>f.facade.perform({authContext:{principal_id:p.id},command:command(concurrent,'accept')})));
    assert.equal(race.filter(r=>r.ok).length,1);
    const combinedTicket=await f.ticket(),s=await f.session(combinedTicket);
    const combined=command(combinedTicket,'takeover-and-accept-ticket',{session_id:s.id,expected_session_row_version:1});
    const accepted=await f.facade.perform({authContext,command:combined});assert.equal(accepted.ok,true,JSON.stringify(accepted));
    let view=await f.query.responsibility({authContext,ticketId:combinedTicket.id});
    await assertP2016Schema('p2_016_responsibility_view',view);
    await assertP2016Schema('p2_016_ticket_detail',await f.query.detail({authContext,ticketId:combinedTicket.id}));
    await assertP2016Schema('p2_016_ticket_list',await f.query.list({authContext,state:'accepted'}));
    assert.equal(view.ticket_assignee_id,f.admin.id);assert.equal(view.conversations[0].conversation_principal_id,f.admin.id);
    const current=await f.query.detail({authContext,ticketId:combinedTicket.id});
    const transfer=await f.facade.perform({authContext,command:command(current,'transfer-assignment',{target_principal_id:f.handler.id})});
    assert.equal(transfer.ok,true,JSON.stringify(transfer));
    view=await f.query.responsibility({authContext,ticketId:combinedTicket.id});
    assert.equal(view.ticket_assignee_id,f.handler.id);assert.equal(view.conversations[0].conversation_principal_id,f.admin.id);
    assert.equal((await f.query.detail({authContext,ticketId:combinedTicket.id})).status,'ACCEPTED');
    const metadata=(await pool.query("SELECT assignment_metadata FROM pilot_ticket.ticket_event WHERE ticket_id=$1::uuid AND event_type='ticket.assignment_transferred'",[combinedTicket.id])).rows[0].assignment_metadata;
    assert.deepEqual(metadata,{old_assignee_id:f.admin.id,new_assignee_id:f.handler.id,old_team_id:'PILOT_IT',new_team_id:'PILOT_IT'});
    const rollback=await f.ticket(),rs=await f.session(rollback);
    const failed=await f.facade.perform({authContext,command:command(rollback,'takeover-and-accept-ticket',{session_id:rs.id,expected_session_row_version:1,expected_version:999})});
    assert.equal(failed.ok,false);
    assert.equal((await pool.query('SELECT count(*)::integer AS n FROM conversation.assignment WHERE session_id=$1::uuid',[rs.id])).rows[0].n,0);
    assert.equal((await pool.query('SELECT count(*)::integer AS n FROM conversation.control_event WHERE session_id=$1::uuid',[rs.id])).rows[0].n,0);
    assert.equal((await f.query.detail({authContext,ticketId:rollback.id})).status,'QUEUED');
    const takeoverFailure=await f.facade.perform({authContext,command:command(rollback,'takeover-and-accept-ticket',{session_id:rs.id,expected_session_row_version:999})});
    assert.equal(takeoverFailure.ok,false);assert.equal((await f.query.detail({authContext,ticketId:rollback.id})).version,1);
    assert.equal((await pool.query('SELECT count(*)::integer AS n FROM conversation.assignment WHERE session_id=$1::uuid',[rs.id])).rows[0].n,0);
    const transferred=await f.query.detail({authContext,ticketId:combinedTicket.id});
    const wrongTeam=await f.facade.perform({authContext,command:command(transferred,'transfer-assignment',{target_principal_id:f.outsider.id})});assert.equal(wrongTeam.ok,false);
    await pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=false WHERE id=$1::uuid',[f.handler.id]);
    const inactive=await f.facade.perform({authContext,command:command(transferred,'transfer-assignment',{target_principal_id:f.handler.id})});assert.equal(inactive.ok,false);
    const doomed=await f.ticket(),access=createP2016ReporterAccess({pool,enabled:true,hmacSecret:'synthetic-rollback-reporter-key-at-least-32'});
    const projector=createP2016TicketNotificationProjector({enabled:true,cardEnabled:true,reporterAccess:{...access,
      issueInTransaction:async()=>{throw new WorkbenchError('UNTRUSTED_PROVIDER_BODY patient-secret 10.0.0.1',503);}}});
    const broken=createP2016TicketCommandFacade({pool,enabled:true,notificationProjector:projector});
    const failedNotification=await broken.perform({authContext,command:command(doomed,'accept')});
    assert.equal(failedNotification.error.code,'P2_016_ACTION_FAILED');assert.equal(JSON.stringify(failedNotification).includes('patient-secret'),false);
    assert.equal((await f.query.detail({authContext,ticketId:doomed.id})).version,1);
    assert.equal((await pool.query('SELECT count(*)::integer AS n FROM pilot_ticket.ticket_event WHERE ticket_id=$1::uuid',[doomed.id])).rows[0].n,0);
    assert.equal((await pool.query('SELECT count(*)::integer AS n FROM communication.message')).rows[0].n,0);
    assert.equal((await pool.query('SELECT count(*)::integer AS n FROM pilot_ticket.reporter_public_ref WHERE ticket_id=$1::uuid',[doomed.id])).rows[0].n,0);
  }});
  await assertNoP2016Residual({databaseUrl});
});
