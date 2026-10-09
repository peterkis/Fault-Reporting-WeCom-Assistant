import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
import type {ManualReportCommand} from '../contracts/workbench_manual_report_contracts.js';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {assertP2016Schema} from './helpers/p2-016-schema-assert.mjs';
interface Fixture {origin:string;cookies:string[];pool:PostgresPool}
interface Facts {receipts:number;intakes:number;tickets:number}
function object(value:unknown):Record<string,unknown>{assert.ok(value!==null&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function string(value:unknown):string{if(typeof value!=='string'||!value)assert.fail('nonempty string required');return value;}
async function facts(pool:PostgresPool):Promise<Facts>{
  const row=(await pool.query<Facts>(`SELECT
    (SELECT count(*)::integer FROM pilot_ticket.ticket_command_receipt WHERE command_type='WORKBENCH_MANUAL_REPORT') AS receipts,
    (SELECT count(*)::integer FROM intake.service_intake WHERE source_provider='STAFF_MANUAL_REPORT') AS intakes,
    (SELECT count(*)::integer FROM pilot_ticket.ticket t JOIN intake.service_intake i ON i.id=t.source_intake_id WHERE i.source_provider='STAFF_MANUAL_REPORT') AS tickets`)).rows[0];assert.ok(row);return row;
}

test('manual admission capabilities and read-only UNKNOWN reconcile the original principal-purpose ledger without duplicate intake and recheck current create authority',async()=>{
  await withWeb01Fixture(async({origin,cookies,pool}:Fixture)=>{
    const cookie=string(cookies[0]),get=(path:string,index=0)=>fetch(origin+path,{headers:{cookie:string(cookies[index])}});
    const bootstrapResponse=await get('/api/lifecycle/bootstrap');assert.equal(bootstrapResponse.status,200);
    const csrf=string(object(await bootstrapResponse.json()).csrf_token),before=await facts(pool);
    const capabilities=await get('/api/workbench/reports/capabilities');assert.equal(capabilities.status,200);
    assert.deepEqual(await capabilities.json(),{can_create:true,manual_contact_required:true,external_notification:false,draft_recovery_enabled:true});
    assert.equal((await get('/api/workbench/reports/capabilities',1)).status,403);
    const command={schema_version:1,client_command_id:randomUUID(),source:'PHONE',description:'合成回执代录：打印机无法打印',
      location:{text:null,unknown:true},reporter:{verification:'UNVERIFIED',name:'合成回执报修人',contact:'人工联系内线4567',department:null}} satisfies ManualReportCommand;
    const path='/api/workbench/reports/commands/'+command.client_command_id;
    const unknown=await get(path);assert.equal(unknown.status,200);
    assert.deepEqual(await unknown.json(),{client_command_id:command.client_command_id,state:'UNKNOWN'});
    assert.deepEqual(await (await get(path,2)).json(),{client_command_id:command.client_command_id,state:'UNKNOWN'});
    assert.equal((await get(path,1)).status,403);assert.equal((await get(path+'?payload=forbidden')).status,400);
    assert.equal((await get('/api/workbench/reports/commands/not-a-uuid')).status,400);
    assert.deepEqual(await facts(pool),before);
    const post=(body:ManualReportCommand=command)=>fetch(origin+'/api/workbench/reports',{method:'POST',headers:{cookie,origin,'content-type':'application/json','idempotency-key':body.client_command_id,'x-csrf-token':csrf},body:JSON.stringify(body)});
    const admitted=await post();assert.equal(admitted.status,202);const result=object(await admitted.json());
    await assertP2016Schema('workbench_manual_report_result',result);assert.equal(result.replayed,false);
    assert.equal(object(result.ticket).status,'QUEUED');
    const committed=await get(path);assert.equal(committed.status,200);
    const receipt=object(await committed.json());
    assert.deepEqual(receipt,{client_command_id:command.client_command_id,state:'COMMITTED',result:{...result,replayed:true}});
    assert.ok(!JSON.stringify(receipt).includes(command.reporter.name));assert.ok(!JSON.stringify(receipt).includes(command.reporter.contact));assert.ok(!JSON.stringify(receipt).includes(command.description));
    assert.deepEqual(await (await get(path,2)).json(),{client_command_id:command.client_command_id,state:'UNKNOWN'});
    const replay=await post();assert.equal(replay.status,200);assert.deepEqual(await replay.json(),{...result,replayed:true});
    const changed=await post({...command,description:command.description+'，另一意图'});assert.equal(changed.status,409);
    assert.equal(object(object(await changed.json()).error).code,'P2_016_COMMAND_CONFLICT');
    const once={receipts:before.receipts+1,intakes:before.intakes+1,tickets:before.tickets+1};assert.deepEqual(await facts(pool),once);
    await createPilotAccessService({pool}).upsertPrincipal({wecomUserId:'web01-synthetic-0',displayName:'林舟',roles:['HANDLER'],resolverTeamIds:[]});
    assert.equal((await get('/api/workbench/reports/capabilities')).status,403);
    assert.equal((await get(path)).status,403);assert.equal((await post()).status,403);
    assert.deepEqual(await facts(pool),once);
  },{workbenchManualReportsEnabled:true,workbenchDraftRecoveryEnabled:true});
});
