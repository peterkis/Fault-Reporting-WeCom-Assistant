import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {withT12Fixture} from './helpers/t12-completion-fixture.mjs';
import {acceptedSetup,object,rows,text,version} from './helpers/t07-public-fixture.mjs';
import {t12FreshHttp} from './helpers/t12-fresh-http.mjs';
import {createP2016Runtime} from '../src/p2-016-runtime.mjs';
import {listenConversationWorkbenchServer,closeConversationWorkbenchServer} from '../src/p2-006-workbench-http.mjs';

test('independent T12 and existing notes serialize real receipt FK and stream waits without a deadlock, enabling no legacy business capability',async()=>{
 await withT12Fixture(async f=>{
  const s=await acceptedSetup(f);assert.equal((await s.a.post(s.path+'/start',{client_command_id:randomUUID(),expected_version:version(s.before.version),reason_code:'T12_MIXED_START'})).status,200);
  const original=(await s.b.get(s.path)).value,cycle=object(original.handling_cycle);await f.runtime.stop();
  const runtime=createP2016Runtime({pool:f.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:f.origin,listenPort:Number(new URL(f.origin).port),principalIds:[s.owner.id,f.outsider.id,s.actor.id],externalSendEnabled:false,ticketTakeoverCompletionEnabled:true,workbenchInternalNotesEnabled:true});
  try{
   const started=await runtime.start();assert.ok(started.cookies);const profile={origin:f.origin,cookies:started.cookies.map(cookie=>cookie.name+'='+cookie.value)};
   // The explicit public listener has no scheduled projection waiter in this bounded coordination case.
   await runtime.stop();await listenConversationWorkbenchServer(runtime.server,{port:Number(new URL(f.origin).port)});
   const a=await t12FreshHttp(profile,0),b=await t12FreshHttp(profile,2),bootstrap=(await b.get('/api/lifecycle/bootstrap')).value;
   assert.equal(bootstrap.ticket_takeover_completion_enabled,true);assert.equal(bootstrap.internal_notes_enabled,true);for(const flag of ['ticket_takeover_enabled','ticket_staff_completion_enabled','ticket_self_handling_enabled','ticket_conversation_self_handling_enabled'])assert.equal(bootstrap[flag],false);
   assert.equal(object((await b.get(s.path)).value.handling_cycle).id,cycle.id);assert.deepEqual((await b.get(s.path+'/takeover-completion-targets?resolver_team_id=T07_NETWORK')).value.allowed_actions,['takeover-and-complete']);
   const command={client_command_id:randomUUID(),expected_version:version(original.version),reason_code:'STAFF_COMPLETED',resolver_team_id:'T07_NETWORK',handling_cycle_id:text(cycle.id),communication_choice:'RETAIN_CURRENT',sessions:[],internal_process:'T12_MIXED_PRIVATE_PROCESS',external_summary:'服务已恢复，请重新尝试。',external_summary_confirmed:true},note={client_command_id:randomUUID(),expected_version:version(original.version),reason_code:'WORKBENCH_INTERNAL_NOTE',note:'T12_MIXED_INDEPENDENT_PRIVATE_NOTE',external_visible:false};
   const locker=await f.pool.connect(),requests:Promise<{status:number;value:Record<string,unknown>}>[]=[];let coordinationFailure:unknown;
   try{
    await locker.query('BEGIN');await locker.query("SELECT pg_advisory_xact_lock(hashtextextended('P2_003_REALTIME_STREAM:CONVERSATION_WORKBENCH',0))");
    const waitFor=async(minimum:number)=>{const deadline=Date.now()+5000;while(Date.now()<deadline){const q=await locker.query<{n:number}>("SELECT count(*)::int AS n FROM pg_locks WHERE locktype='advisory' AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())");if((q.rows[0]?.n??0)>=minimum)return;await new Promise(resolve=>setTimeout(resolve,25));}throw Error('T12_ACTUAL_MIXED_WAITER_NOT_OBSERVED');};
    requests.push(b.post(s.path+'/takeover-and-complete',command));await waitFor(1);
    requests.push(a.post(s.path+'/internal-notes',note));await waitFor(2);
   }catch(error){coordinationFailure=error;}finally{await locker.query('ROLLBACK');locker.release();}
   const results=await Promise.all(requests);if(coordinationFailure)throw coordinationFailure;
   console.log('T12_INDEPENDENT_MIXED_QUEUE '+JSON.stringify({actual_stream_waiters:2,legacy_flags_false:true,statuses:results.map(reply=>reply.status),errors:results.map(reply=>reply.value.error??null)}));
   assert.deepEqual(results.map(reply=>reply.status).sort(),[200,409],'independent T12 and notes must serialize version conflict without a DB deadlock refusal');
   const fresh=(await b.get(s.path)).value;
   if(fresh.status!=='CLOSED'){assert.equal((await b.post(s.path+'/takeover-and-complete',{...command,client_command_id:randomUUID(),expected_version:version(fresh.version)})).status,200);}
   const after=(await b.get(s.path)).value;assert.equal(after.status,'CLOSED');assert.equal(object(after.handling_cycle).id,cycle.id);assert.equal((await f.pool.query('SELECT 1 FROM pilot_ticket.staff_completion_notification_commitment WHERE ticket_id=$1::uuid',[s.first.ticket.id])).rowCount,1);
   const events=rows((await a.get(s.path+'/events')).value.items);assert.equal(events.filter(row=>row.event_type==='ticket.closed').length,1);assert.equal(events.filter(row=>row.event_type==='ticket.assignment_transferred').length,1);
   assert.equal((await f.pool.query('SELECT 1 FROM conversation.control_event WHERE client_command_id=$1::uuid',[command.client_command_id])).rowCount,0);
  }finally{runtime.server.closeAllConnections();await closeConversationWorkbenchServer(runtime.server);await runtime.stop();assert.equal(runtime.server.listening,false);const connections=await new Promise<number>((resolve,reject)=>runtime.server.getConnections((error,count)=>error?reject(error):resolve(count)));assert.equal(connections,0);}
 });
});
