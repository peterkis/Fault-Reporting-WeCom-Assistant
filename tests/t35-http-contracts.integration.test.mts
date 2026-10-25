import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withT35Fixture} from './helpers/t35-read-fixture.mjs';
import {assertP2016Schema} from './helpers/p2-016-schema-assert.mjs';
import {personalReadCommand,personalReadRevision} from '../app/server/src/workbench-personal-read.mjs';
import {createPilotAccessService} from '../app/server/src/p1-009-pilot-access-workbench.mjs';

test('T35 public personal-read contracts stay closed, bounded, private, currently authorized and default off',async()=>{
  const id=randomUUID(),valid={client_command_id:id,source_ref:'channel:9223372036854775807',revision:'9223372036854775807'};
  assert.deepEqual(personalReadCommand(valid),valid);assert.equal(personalReadRevision('9007199254740993'),'9007199254740993');
  for(const value of [{...valid,principal_id:randomUUID()},{...valid,source_ref:'channel:0'},{...valid,source_ref:'channel:9223372036854775808'},{...valid,revision:'9223372036854775808'},{...valid,revision:'01'},{...valid,revision:1}])assert.throws(()=>personalReadCommand(value),{status:400});
  await withT35Fixture(async f=>{
    const selected=f.tickets[1],other=f.tickets[2],retained=f.tickets[8];assert.ok(selected);assert.ok(other);assert.ok(retained);
    const source=async(intakeId:string)=>{const row=(await f.pool.query<{id:string}>('SELECT channel_message_id::text AS id FROM intake.service_intake_message WHERE intake_id=$1::uuid AND sequence_no=1',[intakeId])).rows[0];assert.ok(row);return 'channel:'+row.id;};
    const path='/api/workbench/items/ticket/'+selected.ticket.id+'/read-position',command={client_command_id:randomUUID(),source_ref:await source(selected.intake.intakeId),revision:'1'};
    await assertP2016Schema('workbench_personal_read_command',command);
    const page=await f.get(path);assert.equal(page.status,200);await assertP2016Schema('workbench_personal_read_page',await page.json());
    const unknown=await f.get(path+'/commands/'+command.client_command_id);assert.equal(unknown.status,200);const unknownBody=await unknown.json();assert.deepEqual(unknownBody,{client_command_id:command.client_command_id,state:'UNKNOWN'});await assertP2016Schema('workbench_personal_read_receipt',unknownBody);
    const ack=await f.post(path,command);assert.equal(ack.status,200);const ackBody=await ack.json();await assertP2016Schema('workbench_personal_read_acknowledgement',ackBody);
    const receipt=await f.get(path+'/commands/'+command.client_command_id);assert.equal(receipt.status,200);await assertP2016Schema('workbench_personal_read_receipt',await receipt.json());
    for(const query of ['?actor='+randomUUID(),'?limit=101','?limit=1&limit=2','?cursor=bad'])assert.equal((await f.get(path+query)).status,400);
    assert.equal((await f.post(path,{...command,client_command_id:randomUUID(),source_ref:await source(other.intake.intakeId)})).status,404);
    assert.equal((await f.post(path,{...command,principal_id:f.principals[1]?.id})).status,400);
    assert.equal((await fetch(f.origin+path)).status,401);
    assert.equal((await fetch(f.origin+path,{headers:{cookie:f.outsiderCookie}})).status,404);
    const bootstrap=await (await f.get('/api/lifecycle/bootstrap')).json() as {csrf_token:string};
    const raw=(body:string,headers:Record<string,string>={})=>fetch(f.origin+path,{method:'POST',headers:{cookie:f.firstCookie,origin:f.origin,'content-type':'application/json','idempotency-key':command.client_command_id,'x-csrf-token':bootstrap.csrf_token,...headers},body});
    const body=JSON.stringify(command);
    assert.equal((await raw(body,{'content-type':'text/plain'})).status,415);
    assert.equal((await raw(body,{origin:'https://t35-other.invalid'})).status,403);
    assert.equal((await raw(body,{'x-csrf-token':'not-the-current-csrf'})).status,403);
    assert.equal((await raw(body,{'sec-fetch-site':'cross-site'})).status,403);
    assert.equal((await raw(body,{'idempotency-key':randomUUID()})).status,400);
    assert.equal((await raw(body+' '.repeat(8193))).status,413,'the HTTP budget must return a bounded rejection instead of losing the connection');
    await createPilotAccessService({pool:f.pool}).upsertPrincipal({wecomUserId:'web01-synthetic-0',displayName:'T35已失去该团队范围',roles:['HANDLER'],resolverTeamIds:[]});
    for(const request of [()=>f.get(path),()=>f.post(path,command),()=>f.get(path+'/commands/'+command.client_command_id)]){const denied=await request();assert.equal(denied.status,404);assert.doesNotMatch(await denied.text(),/channel:|source_key|SELECT|postgres|T35已失去/u);}
    assert.equal((await f.get('/api/workbench/items/ticket/'+retained.ticket.id+'/read-position')).status,200,'another currently assigned Item stays readable');
  });
  await withT35Fixture(async f=>{
    const selected=f.tickets[1];assert.ok(selected);const path='/api/workbench/items/ticket/'+selected.ticket.id+'/read-position';
    const bootstrap=await (await f.get('/api/lifecycle/bootstrap')).json() as {personal_read_enabled:boolean};assert.equal(bootstrap.personal_read_enabled,false);
    assert.equal((await f.get(path)).status,503);assert.equal((await f.get(path+'/commands/'+randomUUID())).status,503);assert.equal((await f.post(path,{client_command_id:randomUUID(),source_ref:'invalid',revision:'0'})).status,503);
    assert.equal((await f.get('/api/workbench/items/ticket/'+selected.ticket.id)).status,200);
  },{enabled:false,migrate:false});
});
