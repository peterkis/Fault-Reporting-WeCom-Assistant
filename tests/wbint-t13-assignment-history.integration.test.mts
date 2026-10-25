import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {acceptedSetup,acceptedOptions,http,object,rows,text,version} from './helpers/t07-public-fixture.mjs';
import type {T07Fixture} from './helpers/t07-public-fixture.mjs';
import {createPilotAccessService} from '../app/server/src/p1-009-pilot-access-workbench.mjs';
import {assertP2016Schema} from './helpers/p2-016-schema-assert.mjs';

test('an authorized colleague pages the actual first acceptance and coupled transfer chain without replacing the predecessor by the current owner or final start event',async()=>{
  await withWeb01Fixture(async(f:T07Fixture)=>{
    const s=await acceptedSetup(f);
    // Synthetic setup uses the existing Principal Port; ADMIN can legally transfer occupied communication.
    const actor=await createPilotAccessService({pool:f.pool}).upsertPrincipal({
      wecomUserId:'web01-synthetic-1',displayName:'陈悦',roles:['ADMIN'],resolverTeamIds:['PILOT_IT','T07_NETWORK'],
    });
    assert.equal(actor.id,s.actor.id);
    const colleague=await http(f,2),related=await colleague.get(s.path+'/related-conversations');
    assert.equal(related.status,200);
    const selected=rows(related.value.items).find(row=>row.conversation_principal_id===s.owner.id);
    assert.ok(selected);
    const command={
      client_command_id:randomUUID(),expected_version:version(s.before.version),reason_code:'T13_PUBLIC_CHAIN',
      resolver_team_id:'T07_NETWORK',communication_choice:'TAKE_SELECTED',
      sessions:[{session_id:text(selected.session_id),expected_row_version:version(Number(text(selected.session_row_version)))}],
    };
    const written=await colleague.post(s.path+'/takeover-and-start',command);
    assert.equal(written.status,200,JSON.stringify(written.value));
    const changedCommunication=rows(written.value.conversations);
    assert.equal(changedCommunication.length,1);
    assert.equal(changedCommunication[0]?.changed,true);
    const publicEvents=await s.a.get(s.path+'/events');
    assert.equal(publicEvents.status,200);
    const appended=rows(publicEvents.value.items).slice(rows(s.events.items).length);
    assert.deepEqual(appended.map(row=>row.event_type),['ticket.assignment_transferred','ticket.started']);
    assert.equal(written.value.ticket_event_id,appended[1]?.event_id);
    const cycle=object(s.before.handling_cycle),originalTeam=text(s.communication.resolver_team_name);

    // This new real GET is the first T13 behavior: it must return recorded history, not a current snapshot.
    const page1=await s.a.get(s.path+'/assignment-history?limit=1');
    assert.equal(page1.status,200,JSON.stringify(page1.value));
    await assertP2016Schema('p2_016_assignment_history_page',page1.value);
    assert.equal(page1.value.initial_basis,'RECORDED');
    assert.equal(page1.value.ticket_id,s.first.ticket.id);
    const firstPage=rows(page1.value.items);
    assert.equal(firstPage.length,1);
    const accepted=firstPage[0];assert.ok(accepted);
    assert.equal(accepted.kind,'FIRST_RESPONSIBILITY');
    assert.equal(accepted.ticket_event_id,cycle.first_responsibility_event_id);
    assert.deepEqual(accepted.actor,{state:'KNOWN',name:'林舟'});
    assert.deepEqual(accepted.previous,{person:{state:'NONE'},team:{state:'KNOWN',name:originalTeam}});
    assert.deepEqual(accepted.next,{person:{state:'KNOWN',name:'林舟'},team:{state:'KNOWN',name:originalTeam}});
    assert.deepEqual(accepted.handling_cycle,{state:'KNOWN',cycle_no:1});
    const initialCommunication=rows(accepted.communication);
    assert.equal(initialCommunication.length,1);
    assert.equal(initialCommunication[0]?.session_id,selected.session_id);
    assert.deepEqual(initialCommunication[0]?.previous,{state:'NONE'});
    assert.deepEqual(initialCommunication[0]?.next,{state:'KNOWN',name:'林舟'});

    const cursor=text(page1.value.next_cursor);assert.ok(cursor.length>0);
    const page2=await s.a.get(s.path+'/assignment-history?limit=1&cursor='+encodeURIComponent(cursor));
    assert.equal(page2.status,200,JSON.stringify(page2.value));
    await assertP2016Schema('p2_016_assignment_history_page',page2.value);
    const secondPage=rows(page2.value.items);assert.equal(secondPage.length,1);
    const transfer=secondPage[0];assert.ok(transfer);
    assert.equal(transfer.kind,'RESPONSIBILITY_CHANGE');
    assert.equal(transfer.ticket_event_id,appended[0]?.event_id);
    assert.notEqual(transfer.ticket_event_id,written.value.ticket_event_id,'a final start event is not the transfer fact');
    assert.deepEqual(transfer.actor,{state:'KNOWN',name:'陈悦'});
    assert.deepEqual(transfer.previous,{person:{state:'KNOWN',name:'林舟'},team:{state:'KNOWN',name:originalTeam}});
    assert.deepEqual(transfer.next,{person:{state:'KNOWN',name:'陈悦'},team:{state:'KNOWN',name:'合成网络处理组'}});
    assert.deepEqual(transfer.handling_cycle,{state:'KNOWN',cycle_no:1});
    const communication=rows(transfer.communication);assert.equal(communication.length,1);
    assert.equal(communication[0]?.session_id,selected.session_id);
    assert.equal(communication[0]?.control_event_id,changedCommunication[0]?.control_event_id);
    assert.deepEqual(communication[0]?.previous,{state:'KNOWN',name:'林舟'});
    assert.deepEqual(communication[0]?.next,{state:'KNOWN',name:'陈悦'});
    assert.deepEqual(communication[0]?.actor,{state:'KNOWN',name:'陈悦'});
    assert.equal(page2.value.next_cursor,null);
    assert.ok(version(transfer.event_ordinal)>version(accepted.event_ordinal));
    for(const page of [page1.value,page2.value]){
      const safe=JSON.stringify(page);
      assert.ok(!safe.includes('web01-synthetic'),'raw external Principal identity is not a display projection');
      assert.ok(!safe.includes('仅供内部的合成处理记录'),'history must not include internal material');
      assert.ok(!safe.includes(command.client_command_id),'history must not dump the private command receipt');
    }
  },{...acceptedOptions,workbenchAssignmentHistoryEnabled:true});
});

