import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withT26Fixture,t26Deliveries} from './helpers/t26-group-notification-fixture.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';
import {seedPersistedIntake} from './helpers/p2-015-postgres-harness.mjs';
import {createPilotTicketCore} from '../app/server/src/p1-005-pilot-ticket-core.mjs';
import {createTicketRoundNotifications} from '../app/server/src/workbench-ticket-round-notifications.mjs';
import type {P2016TicketDetail} from '../contracts/p2_016_contracts.js';

test('a 20-candidate page cannot permanently hide the completion node of its last real cycle',{timeout:240000},async()=>{
 await withT26Fixture(async context=>{
  const http=await t11Http(context),started:P2016TicketDetail[]=[];
  for(let n=0;n<20;n++){
   const tag='t26-page-'+n,intake=await seedPersistedIntake({pool:context.pool,text:'T26_PRIVATE_PAGE',chatType:'group',requestType:'INCIDENT',status:'RECEIVED',tag}),created=await createPilotTicketCore({pool:context.pool}).createForIntake({intakeId:intake.intakeId,occurredAt:intake.receivedAt,traceId:tag});assert.ok(created.ticket);started.push(await http.start(created.ticket.id));
  }
  started.sort((a,b)=>{assert.ok(a.handling_cycle&&b.handling_cycle);return a.handling_cycle.id.localeCompare(b.handling_cycle.id);});
  const last=started.at(-1);assert.ok(last?.handling_cycle);assert.equal((await http.post(last.id,'complete',http.command(last))).status,200);
  const consumer=createTicketRoundNotifications({pool:context.pool,enabled:true,botId:'bot-test',reporterAccess:context.runtime.reporterAccess});
  for(let sweep=0;sweep<6;sweep++){const result=await consumer.runOnce();assert.ok(result.scanned<=20,'the bounded resource limit remains 20 candidates');}
  const rows=await t26Deliveries(http,last.id);assert.deepEqual(rows.map(r=>[r.node,r.destination_type]).sort(),[['FIRST_RESPONSIBILITY','GROUP'],['FIRST_RESPONSIBILITY','PERSON'],['STAFF_COMPLETED','GROUP'],['STAFF_COMPLETED','PERSON']],'the 21st candidate must become visible on a later bounded page');
  let total=0;for(const item of started)total+=(await t26Deliveries(http,item.id)).length;assert.equal(total,42);
 });
});
