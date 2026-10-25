import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {createPilotAccessService} from '../app/server/src/p1-009-pilot-access-workbench.mjs';

test('an authorized internal-note receipt can be checked without its expired payload and is bound to principal, Ticket and server purpose',async()=>{
  await withWeb01Fixture(async({origin,cookies,tickets,pool})=>{
    const ticketId=tickets[5].ticket.id;
    const read=(path,index=0)=>fetch(origin+path,{headers:{cookie:cookies[index]}});
    const bootstrap=await (await read('/api/lifecycle/bootstrap')).json();
    const command={client_command_id:randomUUID(),expected_version:2,reason_code:'WORKBENCH_INTERNAL_NOTE',note:'T03 receipt synthetic private note',external_visible:false};
    const post=(path,body)=>fetch(origin+path,{method:'POST',headers:{cookie:cookies[0],origin,'content-type':'application/json','idempotency-key':body.client_command_id,'if-match':'"'+body.expected_version+'"','x-csrf-token':bootstrap.csrf_token},body:JSON.stringify(body)});
    const applied=await post('/api/tickets/'+ticketId+'/internal-notes',command);assert.equal(applied.status,200);const result=await applied.json();
    const path='/api/tickets/'+ticketId+'/internal-notes/commands/'+command.client_command_id;
    const receipt=await read(path);assert.equal(receipt.status,200);
    assert.deepEqual(await receipt.json(),{client_command_id:command.client_command_id,ticket_id:ticketId,state:'COMMITTED',result:{...result,replayed:true}});
    assert.equal((await read(path,1)).status,404);
    assert.deepEqual(await (await read(path,2)).json(),{client_command_id:command.client_command_id,ticket_id:ticketId,state:'UNKNOWN'});
    assert.equal((await read(path+'?payload=forbidden')).status,400);
    const wrong=await read('/api/tickets/'+tickets[6].ticket.id+'/internal-notes/commands/'+command.client_command_id);
    assert.deepEqual(await wrong.json(),{client_command_id:command.client_command_id,ticket_id:tickets[6].ticket.id,state:'UNKNOWN'});
    const absent=randomUUID();assert.deepEqual(await (await read('/api/tickets/'+ticketId+'/internal-notes/commands/'+absent)).json(),{client_command_id:absent,ticket_id:ticketId,state:'UNKNOWN'});
    const legacy={...command,client_command_id:randomUUID(),expected_version:3,external_visible:true,note:'T03 legacy compatibility synthetic note'};
    assert.equal((await post('/api/tickets/'+ticketId+'/notes',legacy)).status,200);
    assert.deepEqual(await (await read('/api/tickets/'+ticketId+'/internal-notes/commands/'+legacy.client_command_id)).json(),{client_command_id:legacy.client_command_id,ticket_id:ticketId,state:'UNKNOWN'});
    const stale={...command,client_command_id:randomUUID()};
    const refusal=await post('/api/tickets/'+ticketId+'/internal-notes',stale);assert.equal(refusal.status,409);const failed=await refusal.json();assert.match(failed.error.code,/VERSION_CONFLICT$/u);
    assert.deepEqual(await (await read('/api/tickets/'+ticketId+'/internal-notes/commands/'+stale.client_command_id)).json(),{client_command_id:stale.client_command_id,ticket_id:ticketId,state:'FAILED',error:{code:failed.error.code,retryable:false}});
    assert.equal((await post('/api/tickets/'+ticketId+'/internal-notes',{...command,client_command_id:randomUUID(),expected_version:4,receiptType:'WORKBENCH_INTERNAL_NOTE'})).status,400);
    const events=await (await read('/api/tickets/'+ticketId+'/events')).json();assert.equal(events.items.filter(event=>event.event_type==='ticket.note_added').length,2);
    await createPilotAccessService({pool}).upsertPrincipal({wecomUserId:'web01-synthetic-0',displayName:'林舟',roles:['HANDLER'],resolverTeamIds:[]});
    assert.equal((await read(path)).status,404);
  },{workbenchInternalNotesEnabled:true,workbenchDraftRecoveryEnabled:true});
});
