import test from 'node:test';
import assert from 'node:assert/strict';
import {withT40ReminderFirstFixture,object,text} from './helpers/t40-reminder-first-fixture.mjs';

test('T40 public reminder GET validates its window and binds a real due fact to its original immutable identifiers',async()=>{
  await withT40ReminderFirstFixture(async fixture=>{
    const initial=await fixture.http.get('/api/workbench/reminders?limit=1');assert.equal(initial.status,200);
    assert.deepEqual(initial.value.items,[]);assert.equal(initial.value.reset_required,false);
    const after=text(initial.value.as_of_event_id),token=text(initial.value.baseline_token);
    assert.deepEqual(await fixture.runtime.runFollowUpDueBatch({limit:20}),{scanned:1,emitted:1,skipped:0});
    const path='/api/workbench/reminders?'+new URLSearchParams({limit:'1',after_event_id:after,baseline_token:token});
    const current=await fixture.http.get(path);assert.equal(current.status,200);assert.ok(Array.isArray(current.value.items));
    const due=current.value.items.map(object).find(row=>row.reason==='RELATED_FOLLOW_UP_DUE');assert.ok(due);
    assert.deepEqual(due.canonical_item,{kind:'ticket',id:fixture.ticketId});assert.equal(due.source_revision,'1');
    const repeat=await fixture.http.get(path);assert.equal(repeat.status,200);assert.deepEqual(repeat.value.items,current.value.items);
    const forged=await fixture.http.get('/api/workbench/reminders?'+new URLSearchParams({after_event_id:after,baseline_token:token.slice(0,-1)+(token.endsWith('a')?'b':'a')}));
    assert.equal(forged.status,200);assert.deepEqual(forged.value.items,[]);assert.equal(forged.value.reset_required,true);
    for(const query of ['?limit=51','?limit=1&limit=2','?unknown=1','?after_event_id=9223372036854775808'])assert.equal((await fixture.http.get('/api/workbench/reminders'+query)).status,400);
    const recovery=await fixture.http.get('/api/workbench/reminders');assert.equal(recovery.status,200);assert.deepEqual(recovery.value.items,[]);
  });
});
