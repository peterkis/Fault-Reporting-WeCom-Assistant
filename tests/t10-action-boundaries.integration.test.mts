import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withT10Fixture} from './helpers/t10-waiting-fixture.mjs';
import {t11Http,t11NewTicket} from './helpers/t11-completion-fixture.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';
import {assertP2016Schema} from './helpers/p2-016-schema-assert.mjs';
const body=(version:number)=>({client_command_id:randomUUID(),expected_version:version,reason_code:'HUMAN_INTERNAL_REASON',note:'  INTERNAL_T10_BOUNDARY_CANARY：合成人工原因。  ',external_visible:false});

test('legal cancellation is ADMIN or DISPATCHER only and retains both real accepted round history and nullable queued history',async()=>{
  await withT10Fixture(async context=>{
    const admin=await t11Http(context),handler=await t11Http(context,2),queued=context.tickets[0];assert.ok(queued);
    const before=await admin.detail(queued.ticket.id);assert.equal(before.status,'QUEUED');assert.equal(before.handling_cycle,null);
    assert.equal((await handler.post(queued.ticket.id,'cancel',body(before.version))).status,403);assert.deepEqual(await admin.detail(queued.ticket.id),before);
    const canceled=await admin.post(queued.ticket.id,'cancel',body(before.version));assert.equal(canceled.status,200);const result=await canceled.json() as {handling_cycle_id:string|null};await assertP2016Schema('p2_016_waiting_action_result',result);assert.equal(result.handling_cycle_id,null);
    const id=await t11NewTicket(context),initial=await admin.detail(id);assert.equal(initial.status,'NEW');assert.equal((await admin.post(id,'queue',{client_command_id:randomUUID(),expected_version:initial.version,reason_code:'T10_REAL_QUEUE'})).status,200);
    const current=await handler.detail(id),accepted=await handler.post(id,'accept-for-later',{client_command_id:randomUUID(),expected_version:current.version,reason_code:'T10_REAL_ACCEPT',resolver_team_id:current.resolver_team_id});assert.equal(accepted.status,200);
    const round=await admin.detail(id);assert.equal(round.status,'ACCEPTED');assert.ok(round.handling_cycle?.first_responsibility_event_id);
    const communication=await (await admin.get('/api/tickets/'+id+'/responsibility')).json() as unknown,deliveries=await (await admin.get('/api/tickets/'+id+'/deliveries')).json() as unknown;
    const actor=context.principals[0];assert.ok(actor);const identity=(await context.pool.query<{wecom_user_id:string;display_name:string}>('SELECT wecom_user_id,display_name FROM pilot_ticket.pilot_principal WHERE id=$1::uuid',[actor.id])).rows[0];assert.ok(identity);
    await createPilotAccessService({pool:context.pool}).upsertPrincipal({wecomUserId:identity.wecom_user_id,displayName:identity.display_name,roles:['DISPATCHER'],resolverTeamIds:['PILOT_IT']});
    const intent=body(round.version),response=await admin.post(id,'cancel',intent);assert.equal(response.status,200);const receipt=await response.json() as {ticket_event_id:string;handling_cycle_id:string|null};assert.equal(receipt.handling_cycle_id,round.handling_cycle.id);
    const after=await admin.detail(id);assert.equal(after.status,'CANCELLED');assert.equal(after.version,round.version+1);assert.equal(after.assignee_id,round.assignee_id);assert.equal(after.resolver_team_id,round.resolver_team_id);assert.deepEqual(after.handling_cycle,round.handling_cycle);
    assert.deepEqual(await (await admin.get('/api/tickets/'+id+'/responsibility')).json(),communication);assert.deepEqual(await (await admin.get('/api/tickets/'+id+'/deliveries')).json(),deliveries);
    const raw=(await context.pool.query<{internal_note:string;external_note:string|null}>('SELECT internal_note,external_note FROM pilot_ticket.ticket_event WHERE event_id=$1::uuid',[receipt.ticket_event_id])).rows[0];assert.equal(raw?.internal_note,intent.note,'the server does not rewrite the captured raw body or hash');assert.equal(raw.external_note,null);
    const replay=await admin.post(id,'cancel',intent);assert.equal(replay.status,200);assert.equal((await replay.json() as {replayed:boolean}).replayed,true);assert.equal((await admin.post(id,'cancel',{...intent,note:'another original body'})).status,409);
  });
});
test('closed waiting inputs and real HTTP security gates refuse authority injection and oversized reasons before a receipt or business write',async()=>{
  await withT10Fixture(async context=>{
    const http=await t11Http(context,2),target=context.tickets[0];assert.ok(target);const current=await http.start(target.ticket.id),command=body(current.version);
    const facts=async()=>({ticket:await http.detail(target.ticket.id),events:await (await http.get('/api/tickets/'+target.ticket.id+'/events')).json() as unknown,receipts:(await context.pool.query('SELECT client_command_id::text,state FROM pilot_ticket.ticket_command_receipt ORDER BY id')).rows});const before=await facts();
    for(const change of [{note:''},{note:'   '},{note:'😀'.repeat(1001)},{external_visible:true},{actor_principal_id:randomUUID()},{target_principal_id:randomUUID()},{handling_cycle_id:randomUUID()},{status:'CANCELLED'},{expected_version:String(current.version)}])assert.equal((await http.post(target.ticket.id,'wait-vendor',{...command,...change})).status,400);
    for(const [headers,status] of [[{'idempotency-key':randomUUID()},400],[{'if-match':'"1"'},409],[{'x-csrf-token':'synthetic-wrong'},403],[{origin:'https://foreign.invalid'},403]] as const)assert.equal((await http.post(target.ticket.id,'wait-vendor',command,headers)).status,status);
    assert.equal((await http.post(target.ticket.id,'wait-vendor',{...command,note:'X'.repeat(32769)})).status,413);assert.deepEqual(await facts(),before);
  });
});
test('waiting and resume reject illegal states and cancellation never acts as return or release of a started responsibility',async()=>{
  await withT10Fixture(async context=>{
    const admin=await t11Http(context),handler=await t11Http(context,2),target=context.tickets[0];assert.ok(target);
    const queued=await admin.detail(target.ticket.id);for(const action of ['request-information','wait-vendor','resume'])assert.equal((await admin.post(target.ticket.id,action,body(queued.version))).status,409);assert.deepEqual(await admin.detail(target.ticket.id),queued);
    const started=await handler.start(target.ticket.id),responsibility=await (await admin.get('/api/tickets/'+target.ticket.id+'/responsibility')).json() as unknown;
    assert.equal((await admin.post(target.ticket.id,'cancel',body(started.version))).status,409);assert.equal((await admin.post(target.ticket.id,'resume',body(started.version))).status,409);assert.deepEqual(await admin.detail(target.ticket.id),started);assert.deepEqual(await (await admin.get('/api/tickets/'+target.ticket.id+'/responsibility')).json(),responsibility);
    const outsider=await t11Http(context,1);assert.equal((await outsider.post(target.ticket.id,'request-information',body(started.version))).status,404);
    const waited=await handler.post(target.ticket.id,'request-information',body(started.version));assert.equal(waited.status,200);const waiting=await handler.detail(target.ticket.id);assert.equal((await handler.post(target.ticket.id,'wait-vendor',body(waiting.version))).status,409);assert.deepEqual(await handler.detail(target.ticket.id),waiting);
    assert.equal((await admin.post(target.ticket.id,'resume',body(waiting.version))).status,200);assert.deepEqual((await handler.detail(target.ticket.id)).handling_cycle,started.handling_cycle);
  });
});
test('true mode without039 fails before receipt while default-off legacy waiting keeps its original no-cycle wire contract',async()=>{
  for(const waitingEnabled of [true,false])await withT10Fixture(async context=>{
    const http=await t11Http(context,2),target=context.tickets[5];assert.ok(target);const before=(await context.pool.query('SELECT status,version,assignee_id,resolver_team_id FROM pilot_ticket.ticket WHERE id=$1::uuid',[target.ticket.id])).rows;
    const bootstrap=await (await http.get('/api/lifecycle/bootstrap')).json() as {ticket_waiting_actions_enabled:boolean};assert.equal(bootstrap.ticket_waiting_actions_enabled,waitingEnabled);
    const command=waitingEnabled?body(2):{client_command_id:randomUUID(),expected_version:2,reason_code:'T10_LEGACY_WAIT'};
    const response=await http.post(target.ticket.id,'request-information',command);
    if(waitingEnabled){assert.equal(response.status,503);assert.deepEqual((await context.pool.query('SELECT status,version,assignee_id,resolver_team_id FROM pilot_ticket.ticket WHERE id=$1::uuid',[target.ticket.id])).rows,before);assert.equal((await context.pool.query('SELECT 1 FROM pilot_ticket.ticket_command_receipt')).rowCount,0);}
    else{assert.equal(response.status,200);const result=await response.json() as Record<string,unknown>;assert.equal(Object.hasOwn(result,'handling_cycle_id'),false);const ack=await http.get('/api/tickets/'+target.ticket.id+'/request-information/commands/'+command.client_command_id);assert.equal(ack.status,200);assert.deepEqual(await ack.json(),{state:'COMMITTED',ticket_id:target.ticket.id,ticket_version:result.ticket_version,ticket_event_id:result.ticket_event_id});}
  },{waitingEnabled,installCycleSchema:false,recoveryEnabled:false});
});
