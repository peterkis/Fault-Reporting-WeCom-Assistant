import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withT24Fixture} from './helpers/t24-round-notification-fixture.mjs';
import {t25WebOrigin,t25Deliveries} from './helpers/t25-web-origin-fixture.mjs';

test('a revoked original H5 source creates no App intent and does not stop a retained H5 source in the same existing consumer batch',{timeout:240000},async()=>{
 await withT24Fixture(async context=>{
  const withdrawn=await t25WebOrigin(context),retained=await t25WebOrigin(context,{memberId:'T25_CONSUMPTION_RETAINED_MEMBER_B'});
  const {web_report:_withdrawnReport,...coreBefore}=withdrawn.started;
  await context.pool.query('UPDATE intake.web_request_binding SET revoked_at=platform.local_from_epoch_ms(platform.physical_epoch_ms()) WHERE request_ref=$1',[withdrawn.requestRef]);
  assert.deepEqual(await t25Deliveries(withdrawn.http,withdrawn.ticketId),[]);assert.deepEqual(await t25Deliveries(retained.http,retained.ticketId),[]);
  await retained.round.runOnce();assert.deepEqual(await t25Deliveries(withdrawn.http,withdrawn.ticketId),[]);
  const delivered=await t25Deliveries(retained.http,retained.ticketId);assert.deepEqual(delivered.map(row=>({type:row.destination_type,route:row.route_kind,node:row.node,status:row.status,attempts:row.attempt_count})),[{type:'PERSON',route:'YIXIAOXIU_APP',node:'FIRST_RESPONSIBILITY',status:'PENDING',attempts:0}]);
  await retained.round.runOnce();assert.deepEqual(await t25Deliveries(retained.http,retained.ticketId),delivered);assert.deepEqual(await t25Deliveries(withdrawn.http,withdrawn.ticketId),[]);
  const after=await withdrawn.http.detail(withdrawn.ticketId);assert.equal(after.web_report,undefined);const {web_report:_afterReport,...coreAfter}=after;assert.deepEqual(coreAfter,coreBefore);assert.deepEqual(await retained.http.detail(retained.ticketId),retained.started);
 },{manualRoundConsumption:true});
});
