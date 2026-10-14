// T33 current roles, independent grants, exact parents, and closed public input.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {t33WholeHttp,t33Text} from './helpers/t33-whole-fixture.mjs';

test('T33 controls require current independent grants and exact Incident READ without owner or generic Conversation authority',{timeout:120000},async t=>{
 await t33WholeHttp(async ctx=>{
  const parent='/api/incidents/'+ctx.incidentId,rows=await ctx.getLifecycleRows();
  const selected=rows.find(row=>row.audience_type==='GROUP');assert.ok(selected);
  const deliveryId=t33Text(selected.delivery_id),path=parent+'/notifications/'+deliveryId;
  const incident=await ctx.get(parent);assert.equal(incident.status,200);
  const version=t33Text(incident.body.row_version);
  const fresh=()=>({client_command_id:randomUUID(),expected_row_version:version,expected_status:'PENDING',expected_side_effect_state:'NOT_ATTEMPTED',expected_delivery_attempt_count:0,reason_code:'OPERATOR_RETRY'});
  const key=(actor:string,permission:string)=>actor+'|'+ctx.incidentId+'|'+permission;
  const unchanged=async()=>{assert.deepEqual(await ctx.getLifecycleRows(),rows);assert.equal(ctx.senderCalls(),0);assert.equal((await ctx.get(parent)).body.row_version,version);};
  assert.equal(selected.attempt_count,0);
  const cap=await ctx.get(path+'/control');assert.equal(cap.status,200);assert.equal(cap.body.retry,true);assert.equal(cap.body.attempt_count,0);

  assert.equal((await ctx.get(parent,1)).status,200,'the dispatcher already reads this exact Incident');
  const dispatcherNoGrant=await ctx.get(path+'/control',1);assert.equal(dispatcherNoGrant.status,200);assert.equal(dispatcherNoGrant.body.retry,false);
  assert.equal((await ctx.post(path+'/retry',fresh(),1)).status,403);
  ctx.grants.add(key(ctx.dispatcherId,'INCIDENT_DELIVERY_RETRY'));
  const dispatcherCommand=fresh(),dispatcherRetry=await ctx.post(path+'/retry',dispatcherCommand,1);
  assert.equal(dispatcherRetry.status,200,JSON.stringify(dispatcherRetry.body));assert.equal(dispatcherRetry.body.replayed,false);assert.equal(dispatcherRetry.body.attempt_count,0);await unchanged();
  ctx.grants.delete(key(ctx.dispatcherId,'INCIDENT_DELIVERY_RETRY'));
  assert.equal((await ctx.post(path+'/retry',dispatcherCommand,1)).status,403,'current independent retry permission precedes original UUID replay');
  assert.equal((await ctx.get(parent+'/notification-commands/'+dispatcherCommand.client_command_id,1)).status,403);
  await unchanged();

  assert.equal((await ctx.get(parent,2)).status,200,'the owner/HANDLER has existing team READ, which is separate from control authority');
  assert.equal(incident.body.owner_principal_id,ctx.handlerId);
  for(const actor of [ctx.handlerId,ctx.outsiderId]){
   ctx.grants.add(key(actor,'INCIDENT_DELIVERY_RETRY'));ctx.grants.add(key(actor,'INCIDENT_DELIVERY_RECONCILE'));
  }
  const ownerCap=await ctx.get(path+'/control',2);assert.equal(ownerCap.status,200);assert.equal(ownerCap.body.retry,false);assert.equal(ownerCap.body.reconcile,false);assert.equal(ownerCap.body.receipt_read,false);
  assert.equal((await ctx.post(path+'/retry',fresh(),2)).status,403,'owner and HANDLER plus an independent grant still lack the settled role');
  assert.equal((await ctx.get(parent,3)).status,404,'the independent grant does not create Incident READ');
  assert.equal((await ctx.get(path+'/control',3)).status,404);
  assert.equal((await ctx.post(path+'/retry',fresh(),3)).status,404);
  await unchanged();

  ctx.grants.delete(key(ctx.adminId,'INCIDENT_DELIVERY_RETRY'));
  assert.equal((await ctx.get(path+'/control')).body.retry,false);
  assert.equal((await ctx.post(path+'/retry',fresh())).status,403,'ADMIN role alone is insufficient');
  ctx.grants.add(key(ctx.adminId,'INCIDENT_DELIVERY_RETRY'));
  const adminCommand=fresh(),adminRetry=await ctx.post(path+'/retry',adminCommand);
  assert.equal(adminRetry.status,200,JSON.stringify(adminRetry.body));assert.equal(adminRetry.body.status,'PENDING');assert.equal(adminRetry.body.side_effect_state,'NOT_ATTEMPTED');assert.equal(adminRetry.body.attempt_count,0);
  const receipt=await ctx.get(parent+'/notification-commands/'+adminCommand.client_command_id);assert.equal(receipt.status,200);assert.equal(receipt.body.state,'COMMITTED');assert.deepEqual(receipt.body.result,adminRetry.body);
  await unchanged();

  const invalid:Record<string,unknown>[]=[
   {...fresh(),unexpected:'INTERNAL_RECORD'},
   ...['0','01','-1','9223372036854775808',1].map(expected_row_version=>({...fresh(),expected_row_version})),
   ...[-1,0.5,2147483648,'0',null].map(expected_delivery_attempt_count=>({...fresh(),expected_delivery_attempt_count})),
   {...fresh(),reason_code:'internal text'},
   {...fresh(),reason_code:'A'.repeat(129)},
   {...fresh(),expected_side_effect_state:'UNKNOWN'},
   {...fresh(),expected_status:'SENT'},
  ];
  for(const body of invalid){const response=await ctx.post(path+'/retry',body);assert.equal(response.status,400,JSON.stringify(response.body));}
  assert.equal((await ctx.get(path+'/control?limit=1')).status,400);
  assert.equal((await ctx.get(parent+'/notification-commands/'+adminCommand.client_command_id+'?limit=1')).status,400);
  await unchanged();

  const otherId=await ctx.secondIncident();assert.notEqual(otherId,ctx.incidentId);
  const other=await ctx.get('/api/incidents/'+otherId);assert.equal(other.status,200,'the wrong parent is a real readable Incident');
  const wrongPath='/api/incidents/'+otherId+'/notifications/'+deliveryId;
  assert.equal((await ctx.get(wrongPath+'/control')).status,404);
  const wrong=await ctx.post(wrongPath+'/retry',{...fresh(),expected_row_version:t33Text(other.body.row_version)});
  assert.equal(wrong.status,404,JSON.stringify(wrong.body));
  await unchanged();

  const linked=(await ctx.pool.query<{ticket_id:string}>('SELECT ticket_id::text FROM incident.incident_report WHERE incident_id=$1::uuid AND ticket_id IS NOT NULL ORDER BY id LIMIT 1',[ctx.incidentId])).rows[0];assert.ok(linked);
  const ticket=await ctx.get('/api/tickets/'+linked.ticket_id);assert.equal(ticket.status,200);
  const legacy={client_command_id:randomUUID(),reason_code:'OPERATOR_RETRY'};
  assert.equal((await ctx.post('/api/tickets/'+linked.ticket_id+'/deliveries/'+deliveryId+'/retry',legacy)).status,404,'the original Ticket entry requires its own exact binding');
  const generic=await ctx.post('/api/deliveries/'+deliveryId+'/retry',{...legacy,client_command_id:randomUUID()});
  t.diagnostic(JSON.stringify({observation:'T33_GENERIC_CONVERSATION_CANNOT_CONTROL_INCIDENT',status:generic.status,sender_calls:ctx.senderCalls(),incident_id:ctx.incidentId,delivery_id:deliveryId}));
  assert.equal(generic.status,404,JSON.stringify(generic.body));
  await unchanged();
 },{externalSend:true});
});
