// SOURCE_NOT_RUN. Copy into tests/ only in the next explicitly granted source batch.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';
import type {PilotPrincipal} from '../src/p1-009-pilot-access-workbench.mjs';
import type {ManualReporterDirectoryOptions,VerifiedManualReportCommand} from '../contracts/workbench_reporter_candidates_contracts.js';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {createT18Directory,applyT18ForwardCheck} from './helpers/t18-verified-fixture.mjs';
interface Fixture {origin:string;cookies:string[];principals:PilotPrincipal[];pool:PostgresPool}
function object(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function text(value:unknown):string{assert.equal(typeof value,'string');assert.ok(value);return value as string;}
function command(source:ReturnType<typeof createT18Directory>):VerifiedManualReportCommand{return {schema_version:1,client_command_id:randomUUID(),source:'PHONE',description:'合成核实代录：打印机无法打印',location:{text:null,unknown:true},reporter:{verification:'VERIFIED_SELECTION',candidate_ref:source.candidate.candidate_ref,candidate_version:source.candidate.candidate_version}};}
async function client(fixture:Fixture){
  const cookie=fixture.cookies[0];assert.ok(cookie);const get=(path:string)=>fetch(fixture.origin+path,{headers:{cookie}});
  const bootstrap=await get('/api/lifecycle/bootstrap');assert.equal(bootstrap.status,200);const csrf=text(object(await bootstrap.json()).csrf_token);
  return {get,post:(body:VerifiedManualReportCommand)=>fetch(fixture.origin+'/api/workbench/reports',{method:'POST',headers:{cookie,origin:fixture.origin,'content-type':'application/json','x-csrf-token':csrf,'idempotency-key':body.client_command_id},body:JSON.stringify(body)})};
}
async function facts(pool:PostgresPool){const row=(await pool.query(`SELECT
  (SELECT count(*)::integer FROM intake.service_intake WHERE source_channel='MANUAL') AS intakes,
  (SELECT count(*)::integer FROM intake.contact_journey WHERE entry_mode='STAFF_MANUAL_REPORT') AS journeys,
  (SELECT count(*)::integer FROM intake.channel_leg WHERE leg_type='MANUAL_REPORT') AS legs,
  (SELECT count(*)::integer FROM intake.deterministic_decision WHERE source_kind='MANUAL') AS decisions,
  (SELECT count(*)::integer FROM intake.manual_review_item r JOIN intake.service_intake i ON i.id=r.service_intake_id WHERE i.source_channel='MANUAL') AS reviews,
  (SELECT count(*)::integer FROM pilot_ticket.ticket t JOIN intake.service_intake i ON i.id=t.source_intake_id WHERE i.source_channel='MANUAL') AS tickets,
  (SELECT count(*)::integer FROM pilot_ticket.ticket_event e JOIN pilot_ticket.ticket t ON t.id=e.ticket_id JOIN intake.service_intake i ON i.id=t.source_intake_id WHERE i.source_channel='MANUAL') AS ticket_events,
  (SELECT count(*)::integer FROM intake.service_intake_event e JOIN intake.service_intake i ON i.id=e.intake_id WHERE i.source_channel='MANUAL') AS intake_events,
  (SELECT count(*)::integer FROM pilot_ticket.ticket_command_receipt WHERE command_type='WORKBENCH_MANUAL_REPORT') AS receipts,
  (SELECT count(*)::integer FROM channel.message_inbox) AS messages,(SELECT count(*)::integer FROM conversation.session) AS conversations,
  (SELECT count(*)::integer FROM communication.message) AS communications,(SELECT count(*)::integer FROM communication.outbox) AS outbox,
  (SELECT count(*)::integer FROM communication.delivery) AS deliveries,(SELECT count(*)::integer FROM notification.outbox) AS notifications,
  (SELECT count(*)::integer FROM notification.delivery) AS notification_deliveries`)).rows[0];assert.ok(row);return row;}
const enabled={workbenchManualReportsEnabled:true,workbenchReporterCandidatesEnabled:true,workbenchDraftRecoveryEnabled:true};

test('a preflight object refusal returns the original UUID FAILED receipt without admission; replay preserves that ledger and changed intent conflicts',async()=>{
  const source=createT18Directory('VERIFY');await withWeb01Fixture(async(fixture:Fixture)=>{
    const actor=fixture.principals[0];assert.ok(actor);source.setPrincipal(actor.id);await applyT18ForwardCheck(fixture.pool);const http=await client(fixture),input=command(source),before=await facts(fixture.pool);
    assert.equal(before.intakes,0);assert.equal(before.tickets,0);assert.equal(before.receipts,0);
    const failure={code:'P2_016_FORBIDDEN',retryable:false},receipt={client_command_id:input.client_command_id,state:'FAILED',error:failure};
    const rejected=await http.post(input);assert.equal(rejected.status,403);assert.deepEqual(await rejected.json(),{error:failure,receipt});assert.equal(source.calls.verify,1);
    const after=await facts(fixture.pool);assert.deepEqual(after,{...before,receipts:1});
    const readLedger=async()=>(await fixture.pool.query<{receipt:unknown}>("SELECT to_jsonb(r) AS receipt FROM pilot_ticket.ticket_command_receipt r WHERE r.actor_principal_id=$1::uuid AND r.client_command_id=$2::uuid AND r.command_type='WORKBENCH_MANUAL_REPORT'",[actor.id,input.client_command_id])).rows;
    const original=await readLedger();assert.equal(original.length,1);assert.equal(object(original[0]?.receipt).state,'FAILED');assert.equal(object(original[0]?.receipt).error_code,'P2_016_FORBIDDEN');
    const ack=await http.get('/api/workbench/reports/commands/'+input.client_command_id);assert.equal(ack.status,200);assert.deepEqual(await ack.json(),receipt);
    const replay=await http.post(input);assert.equal(replay.status,403);assert.deepEqual(await replay.json(),{error:failure,receipt});assert.deepEqual(await readLedger(),original);assert.deepEqual(await facts(fixture.pool),after);
    const calls=source.calls.verify,conflict=await http.post({...input,description:input.description+'，另一个意图'});assert.equal(conflict.status,409);
    const body=object(await conflict.json());assert.equal(object(body.error).code,'P2_016_COMMAND_CONFLICT');assert.equal(Object.hasOwn(body,'receipt'),false);assert.equal(source.calls.verify,calls);
    assert.deepEqual(await readLedger(),original);assert.deepEqual(await facts(fixture.pool),after);
  },{...enabled,manualReporterDirectory:source.directory});
});

test('creation authority lost while the real Directory Port is awaited refuses without recording a failed receipt or any source and outbound facts',async()=>{
  const source=createT18Directory('VERIFY'),stages:string[]=[];let revokeCreate:(()=>Promise<void>)|null=null;
  const directory:ManualReporterDirectoryOptions={...source.directory,port:{...source.directory.port,async verifyAuthorizedCandidate(input){
    stages.push('DIRECTORY_ENTERED');assert.ok(revokeCreate);await revokeCreate();stages.push('CREATE_REVOKED');return source.directory.port.verifyAuthorizedCandidate(input);
  }}};
  await withWeb01Fixture(async(fixture:Fixture)=>{
    const actor=fixture.principals[0];assert.ok(actor);source.setPrincipal(actor.id);await applyT18ForwardCheck(fixture.pool);const access=createPilotAccessService({pool:fixture.pool});
    const principal={wecomUserId:actor.wecom_user_id,displayName:actor.display_name,roles:['HANDLER' as const]};
    // Remove ADMIN first: membership revocation alone would not revoke an administrator's creation permission.
    await access.upsertPrincipal({...principal,resolverTeamIds:['PILOT_IT']});
    revokeCreate=async()=>{await access.upsertPrincipal({...principal,resolverTeamIds:[]});};
    const http=await client(fixture),input=command(source),before=await facts(fixture.pool);assert.equal(before.intakes,0);assert.equal(before.receipts,0);
    assert.equal((await http.get('/api/workbench/reports/capabilities')).status,200);
    const rejected=await http.post(input);assert.equal(rejected.status,403);const body=object(await rejected.json());
    assert.equal(object(body.error).code,'P2_016_FORBIDDEN');assert.equal(Object.hasOwn(body,'receipt'),false);assert.equal(Object.hasOwn(body,'result'),false);
    assert.deepEqual(stages,['DIRECTORY_ENTERED','CREATE_REVOKED']);assert.equal(source.calls.verify,1);assert.equal((await http.get('/api/workbench/reports/capabilities')).status,403);
    assert.deepEqual(await facts(fixture.pool),before);
    assert.equal((await fixture.pool.query('SELECT 1 FROM pilot_ticket.ticket_command_receipt WHERE client_command_id=$1::uuid',[input.client_command_id])).rowCount,0);
  },{...enabled,manualReporterDirectory:directory});
});
