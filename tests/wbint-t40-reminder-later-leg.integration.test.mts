import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {withT40ReminderRiskFixture,object,text} from './helpers/t40-reminder-risk-fixture.mjs';

test('T40 currently related Ticket receives a genuine later Leg PRIMARY revision one as a new material reminder',{timeout:240_000},async()=>{
  await withT40ReminderRiskFixture(async fixture=>{
    const baseline=await fixture.http.get('/api/workbench/reminders');assert.equal(baseline.status,200);assert.deepEqual(baseline.value.items,[]);
    const source=await fixture.appendLaterPrimary(),path='/api/workbench/reminders?'+new URLSearchParams({after_event_id:text(baseline.value.as_of_event_id),baseline_token:text(baseline.value.baseline_token)});
    const current=await fixture.http.get(path);assert.equal(current.status,200);assert.ok(Array.isArray(current.value.items));
    const sourceKey=createHash('sha256').update(source.sourceRef).digest('hex');
    const found=current.value.items.map(object).find(row=>row.reason==='RELATED_NEW_MATERIAL'&&row.source_key===sourceKey);
    assert.ok(found,'same authorized Ticket/Journey must retain the later PRIMARY as supplement, even with sequence one');
    assert.deepEqual(found.canonical_item,{kind:'ticket',id:fixture.ticketId});assert.equal(found.source_revision,'1');
    const repeated=await fixture.http.get(path);assert.equal(repeated.status,200);assert.deepEqual(repeated.value.items,current.value.items);
  });
});
