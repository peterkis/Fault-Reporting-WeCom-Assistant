import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withT11Fixture,t11Http,t11NewTicket} from './helpers/t11-completion-fixture.mjs';
import {createTicketStaffCompletionService} from '../app/server/src/workbench-ticket-completion.mjs';
import {createP2016TicketQuery} from '../app/server/src/p2-016-ticket-query.mjs';
import {createP2016ReporterTimeline} from '../app/server/src/p2-016-reporter-timeline.mjs';
import {createYxxSelfServiceStore} from '../app/server/src/yxx-self-service-store.mjs';
import {createPostgresPool} from '../app/server/src/platform/postgres-pool.mjs';
import {createYxxSelfServiceAuthorization} from '../app/server/src/yxx-self-service-authorization.mjs';
import {createPilotAccessService,createPilotWorkbenchServer} from '../app/server/src/p1-009-pilot-access-workbench.mjs';
import {createTicketActionService} from '../app/server/src/p1-006-ticket-state-actions.mjs';
import {randomUUID} from 'node:crypto';

test('current handler closes one real cycle through one HTTP completion with independent internal and safe external records',async()=>{
  await withT11Fixture(async context=>{
    const http=await t11Http(context),ticket=context.tickets[0];assert.ok(ticket);
    const current=await http.start(ticket.ticket.id),command=http.command(current);
    const response=await http.post(ticket.ticket.id,'complete',command);assert.equal(response.status,200);
    const after=await http.detail(ticket.ticket.id);assert.equal(after.status,'CLOSED');assert.equal(after.version,current.version+1);assert.equal(after.assignee_id,context.principals[0]?.id);
    const staff=await (await http.get('/api/workbench/items/ticket/'+ticket.ticket.id)).json() as {records:{audience:string;text:string|null}[]};
    assert.ok(staff.records.some(row=>row.audience==='INTERNAL'&&row.text===command.internal_process));
    assert.ok(staff.records.some(row=>row.audience==='EXTERNAL'&&row.text===command.external_summary));
    const receipt:unknown=await response.json();assert.equal(JSON.stringify(receipt).includes('INTERNAL_T11_CANARY'),false);
  });
});

test('current handler authority, active membership and exact HTTP trust inputs fence completion without changing business facts',async()=>{
  await withT11Fixture(async context=>{
    const a=await t11Http(context),b=await t11Http(context,2),ticket=context.tickets[0],other=context.tickets[1],principal=context.principals[0];assert.ok(ticket);assert.ok(other);assert.ok(principal);
    const current=await a.start(ticket.ticket.id),id=ticket.ticket.id;
    assert.equal((await b.detail(id)).allowed_actions.includes('complete'),false);
    assert.equal((await b.post(id,'complete',a.command(current))).status,403);
    const bOwned=await b.start(other.ticket.id);assert.equal((await a.detail(other.ticket.id)).allowed_actions.includes('complete'),false);assert.equal((await a.post(other.ticket.id,'complete',a.command(bOwned))).status,403,'BROAD read permission is not takeover permission');
    for(const patch of [{actor:'REPORTER'},{ticket_id:id},{receipt_type:'WORKBENCH_INTERNAL_NOTE'},{source_intake_id:randomUUID()},{external_summary_confirmed:false},{internal_process:' '},{external_summary:'x'.repeat(501)},{expected_version:'4'}])assert.ok([400,409].includes((await a.post(id,'complete',{...a.command(current),...patch})).status));
    for(const headers of [{origin:'https://not-authorized.invalid'},{'x-csrf-token':'wrong'},{'idempotency-key':randomUUID()},{'if-match':'"999"'}])assert.ok([400,403,409].includes((await a.post(id,'complete',a.command(current),headers)).status));
    assert.equal((await a.post(id,'complete',{...a.command(current),expected_version:current.version-1})).status,409);
    assert.equal((await a.post(id,'complete',{...a.command(current),handling_cycle_id:randomUUID()})).status,409);
    const denied=async()=>{assert.equal((await a.detail(id)).allowed_actions.includes('complete'),false);assert.equal((await a.post(id,'complete',a.command(current))).status,403);};
    await context.pool.query('DELETE FROM pilot_ticket.pilot_team_member WHERE principal_id=$1::uuid',[principal.id]);await denied();
    await context.pool.query('INSERT INTO pilot_ticket.pilot_team_member(principal_id,team_id) VALUES($1::uuid,$2)',[principal.id,'PILOT_IT']);
    await context.pool.query("UPDATE pilot_ticket.resolver_team SET is_active=false WHERE team_id='PILOT_IT'");await denied();
    await context.pool.query("UPDATE pilot_ticket.resolver_team SET is_active=true WHERE team_id='PILOT_IT'");
    assert.equal((await a.detail(id)).version,current.version);assert.equal((await context.pool.query('SELECT count(*)::int AS n FROM pilot_ticket.staff_completion_notification_commitment')).rows[0]?.n,0);
    await context.pool.query('DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid',[principal.id]);assert.equal((await a.post(id,'complete',a.command(current))).status,401);
    await context.pool.query('INSERT INTO pilot_ticket.pilot_principal_role(principal_id,role) VALUES($1::uuid,$2)',[principal.id,'ADMIN']);
    await context.pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=false WHERE id=$1::uuid',[principal.id]);assert.equal((await a.post(id,'complete',a.command(current))).status,401);
    assert.equal((await context.pool.query('SELECT version FROM pilot_ticket.ticket WHERE id=$1::uuid',[id])).rows[0]?.version,current.version);
  });
});

test('competing actors, two UUIDs, original replay and terminal resubmission produce one completion and safe scoped receipts',async()=>{
  await withT11Fixture(async context=>{
    const a=await t11Http(context),b=await t11Http(context,2),first=context.tickets[0],second=context.tickets[1],third=context.tickets[4];assert.ok(first);assert.ok(second);assert.ok(third);
    const current=await a.start(first.ticket.id),contenders=await Promise.all([a.post(first.ticket.id,'complete',a.command(current)),b.post(first.ticket.id,'complete',a.command(current))]);
    assert.equal(contenders[0]?.status,200);assert.ok([403,409].includes(contenders[1]?.status??0));
    const secondCurrent=await a.start(second.ticket.id),different=await Promise.all([a.post(second.ticket.id,'complete',a.command(secondCurrent)),a.post(second.ticket.id,'complete',a.command(secondCurrent))]);assert.deepEqual(different.map(r=>r.status).sort(),[200,409]);
    const thirdCurrent=await a.start(third.ticket.id),command=a.command(thirdCurrent),repeated=await Promise.all(Array.from({length:4},()=>a.post(third.ticket.id,'complete',command)));assert.ok(repeated.every(r=>r.status===200));
    const results=await Promise.all(repeated.map(r=>r.json())) as {replayed:boolean;ticket_event_id:string;ticket_version:number}[];assert.equal(results.filter(r=>!r.replayed).length,1);assert.equal(new Set(results.map(r=>r.ticket_event_id)).size,1);
    for(const patch of [{internal_process:'changed private'},{external_summary:'changed safe'},{expected_version:command.expected_version+1},{handling_cycle_id:randomUUID()}])assert.equal((await a.post(third.ticket.id,'complete',{...command,...patch})).status,409);
    const closed=await a.detail(third.ticket.id);assert.equal(closed.status,'CLOSED');assert.equal(closed.version,thirdCurrent.version+1);assert.equal(closed.allowed_actions.includes('complete'),false);assert.equal((await a.post(third.ticket.id,'complete',a.command(closed))).status,409);
    const receiptPath='/api/tickets/'+third.ticket.id+'/completion/commands/'+command.client_command_id,receipt=await (await a.get(receiptPath)).json() as {state:string;result:{completion:{cycle_id:string}}};assert.equal(receipt.state,'COMMITTED');assert.equal(receipt.result.completion.cycle_id,command.handling_cycle_id);assert.equal(JSON.stringify(receipt).includes('INTERNAL_T11_CANARY'),false);
    assert.equal((await (await b.get(receiptPath)).json() as {state:string}).state,'UNKNOWN');assert.equal((await (await a.get('/api/tickets/'+first.ticket.id+'/completion/commands/'+command.client_command_id)).json() as {state:string}).state,'UNKNOWN');
    const old=context.tickets[8];assert.ok(old);const noteId=randomUUID(),note=await a.post(old.ticket.id,'internal-notes',{client_command_id:noteId,expected_version:2,reason_code:'WORKBENCH_INTERNAL_NOTE',note:'private old purpose',external_visible:false});assert.equal(note.status,200);assert.equal((await (await a.get('/api/tickets/'+old.ticket.id+'/completion/commands/'+noteId)).json() as {state:string}).state,'UNKNOWN');
    const counts=await context.pool.query<{ticket_id:string;n:number}>('SELECT ticket_id::text,count(*)::int AS n FROM pilot_ticket.staff_completion_notification_commitment GROUP BY ticket_id');assert.equal(counts.rows.length,3);assert.ok(counts.rows.every(row=>row.n===1));
    const mixedId=await t11NewTicket(context),mixedCurrent=await a.start(mixedId),completion=a.command(mixedCurrent),noteBody={client_command_id:randomUUID(),expected_version:mixedCurrent.version,reason_code:'WORKBENCH_INTERNAL_NOTE',note:'T11 mixed private note',external_visible:false};
    await context.runtime.coordinator.runOnce();await context.runtime.realtimeProjector.runOnce();
    const locker=await context.pool.connect(),requests:Promise<Response>[]=[];let coordinationFailure:unknown;
    try{
      await locker.query('BEGIN');await locker.query("SELECT pg_advisory_xact_lock(hashtextextended('P2_003_REALTIME_STREAM:CONVERSATION_WORKBENCH',0))");
      const waitForWaiters=async(minimum:number)=>{const deadline=Date.now()+5000;while(Date.now()<deadline){const q=await locker.query<{n:number}>("SELECT count(*)::int AS n FROM pg_locks WHERE locktype='advisory' AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())");if((q.rows[0]?.n??0)>=minimum)return;await new Promise(resolve=>setTimeout(resolve,25));}throw Error('T11_MIXED_WAITER_NOT_OBSERVED');};
      requests.push(a.post(mixedId,'complete',completion));await waitForWaiters(2); // One runtime projector and the first real HTTP command are queued.
      requests.push(a.post(mixedId,'internal-notes',noteBody));await waitForWaiters(3); // Notes holds its actual receipt FK before its stream waiter.
    }catch(error){coordinationFailure=error;}finally{await locker.query('ROLLBACK');locker.release();}
    const mixed=await Promise.all(requests);if(coordinationFailure)throw coordinationFailure;
    assert.deepEqual(mixed.map(r=>r.status).sort(),[200,409],'existing notes and completion must serialize without a DB deadlock refusal');
    const mixedAfter=await a.detail(mixedId);if(mixedAfter.status!=='CLOSED')assert.equal((await a.post(mixedId,'complete',a.command(mixedAfter))).status,200);
    assert.equal((await context.pool.query('SELECT count(*)::int AS n FROM pilot_ticket.staff_completion_notification_commitment WHERE ticket_id=$1::uuid',[mixedId])).rows[0]?.n,1);
    await context.pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=false WHERE id=$1::uuid',[context.principals[0]?.id]);assert.equal((await a.get(receiptPath)).status,401);
  });
});

test('lawful waiting completion retains resume and actual staff basis while legacy resolved confirmation remains separate',async()=>{
  await withT11Fixture(async context=>{
    const http=await t11Http(context),principal=context.principals[0];assert.ok(principal);const access=createPilotAccessService({pool:context.pool}),core=createTicketActionService({pool:context.pool,authorize:access.authorizeAction});
    for(const [index,action] of [[0,'request-information'],[1,'wait-vendor']] as const){
      const ticket=context.tickets[index];assert.ok(ticket);const started=await http.start(ticket.ticket.id);
      const waited=await core.perform({ticketId:ticket.ticket.id,action,actor:{type:'PILOT_USER',id:principal.id},expectedVersion:started.version,traceId:'t11-lawful-wait',reasonCode:'T11_WAIT'});assert.equal(waited.ok,true);
      const current=await http.detail(ticket.ticket.id);assert.ok(['WAITING_REQUESTER','WAITING_VENDOR'].includes(current.status));const command=http.command(current),response=await http.post(ticket.ticket.id,'complete',command);assert.equal(response.status,200);
      const after=await http.detail(ticket.ticket.id);assert.equal(after.version,current.version+2);assert.equal(after.status,'CLOSED');assert.equal(after.handling_cycle?.id,current.handling_cycle?.id);
      const events=(await context.pool.query<{event_type:string;reason_code:string;operator_type:string;operator_id:string;created_at:string}>('SELECT event_type,reason_code,operator_type,operator_id,created_at FROM pilot_ticket.ticket_event WHERE ticket_id=$1::uuid ORDER BY aggregate_version DESC LIMIT 2',[ticket.ticket.id])).rows;
      assert.deepEqual(events.map(row=>row.event_type),['ticket.closed','ticket.resumed']);assert.equal(events[0]?.reason_code,'STAFF_COMPLETED');assert.equal(events[0]?.operator_type,'PILOT_USER');assert.equal(events[0]?.operator_id,principal.id);assert.ok(events[0]?.created_at);
      assert.equal((await context.pool.query('SELECT closure_reason FROM pilot_ticket.ticket WHERE id=$1::uuid',[ticket.ticket.id])).rows[0]?.closure_reason,'STAFF_COMPLETED');assert.equal((await context.pool.query("SELECT count(*)::int AS n FROM notification.card_action_task WHERE ticket_id=$1::uuid AND action_key='confirm_resolved'",[ticket.ticket.id])).rows[0]?.n,0);
    }
    for(const [index,expected] of [[3,403],[5,403],[6,403],[7,403],[8,409],[9,403],[12,409]] as const){const ticket=context.tickets[index];assert.ok(ticket);const before=await http.detail(ticket.ticket.id);if(expected===403)assert.notEqual(before.assignee_id,principal.id);else assert.equal(before.assignee_id,principal.id);assert.equal(before.allowed_actions.includes('complete'),false);assert.equal((await http.post(ticket.ticket.id,'complete',{...http.command((await http.detail(context.tickets[0]?.ticket.id??''))),expected_version:before.version,handling_cycle_id:randomUUID()})).status,expected);assert.equal((await http.detail(ticket.ticket.id)).version,before.version);}
    const legacy=context.tickets[12];assert.ok(legacy);const resolved=await http.detail(legacy.ticket.id);assert.equal(resolved.status,'RESOLVED');assert.equal((await http.post(legacy.ticket.id,'confirm',{client_command_id:randomUUID(),expected_version:resolved.version,reason_code:'REQUESTER_CONFIRMED'})).status,200);
    assert.equal((await context.pool.query('SELECT closure_reason FROM pilot_ticket.ticket WHERE id=$1::uuid',[legacy.ticket.id])).rows[0]?.closure_reason,'REQUESTER_CONFIRMED');assert.equal((await context.pool.query('SELECT count(*)::int AS n FROM pilot_ticket.staff_completion_notification_commitment WHERE ticket_id=$1::uuid',[legacy.ticket.id])).rows[0]?.n,0);
  });
});

test('six DB commit failures roll back one target aggregate including waiting resume and leave only a stable FAILED audit',async()=>{
  await withT11Fixture(async context=>{
    const http=await t11Http(context),ticket=context.tickets[0],principal=context.principals[0];assert.ok(ticket);assert.ok(principal);const current=await http.start(ticket.ticket.id);
    const core=createTicketActionService({pool:context.pool,authorize:createPilotAccessService({pool:context.pool}).authorizeAction});assert.equal((await core.perform({ticketId:ticket.ticket.id,action:'wait-vendor',actor:{type:'PILOT_USER',id:principal.id},expectedVersion:current.version,reasonCode:'T11_ATOMIC_WAIT',traceId:'t11-atomic'})).ok,true);
    await context.runtime.coordinator.runOnce();await context.runtime.realtimeProjector.runOnce();
    const id=ticket.ticket.id,snapshot=async()=>({detail:await http.detail(id),events:await (await http.get('/api/tickets/'+id+'/events')).json(),deliveries:await (await http.get('/api/tickets/'+id+'/deliveries')).json(),counts:(await context.pool.query(`SELECT (SELECT count(*) FROM pilot_ticket.ticket_handling_cycle_event WHERE ticket_id=$1::uuid)::int AS links,(SELECT count(*) FROM pilot_ticket.staff_completion_notification_commitment WHERE ticket_id=$1::uuid)::int AS promises,(SELECT count(*) FROM conversation.realtime_event WHERE aggregate_type='TICKET' AND aggregate_id::text=$1::text)::int AS realtime`,[id])).rows[0]});
    for(const [table,event,when] of [['pilot_ticket.ticket_event','INSERT',"NEW.reason_code='STAFF_COMPLETED'"],['pilot_ticket.ticket_handling_cycle_event','INSERT','true'],['pilot_ticket.ticket_handling_cycle','UPDATE','NEW.staff_completion_event_id IS NOT NULL'],['pilot_ticket.staff_completion_notification_commitment','INSERT','true'],['conversation.realtime_event','INSERT',"NEW.event_type='ticket.command.committed'"],['pilot_ticket.ticket_command_receipt','UPDATE',"NEW.state='COMMITTED'"]]){
      const before=await snapshot(),body=http.command(before.detail);await context.pool.query("CREATE FUNCTION platform.t11_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'T11_SYNTHETIC_FAILURE'; END $$");await context.pool.query(`CREATE TRIGGER t11_failure BEFORE ${event} ON ${table} FOR EACH ROW WHEN (${when}) EXECUTE FUNCTION platform.t11_fail()`);
      try{const response=await http.post(id,'complete',body);assert.equal(response.status,503);assert.equal((await response.json() as {error:{code:string}}).error.code,'P2_016_ACTION_FAILED');assert.deepEqual(await snapshot(),before);}finally{await context.pool.query(`DROP TRIGGER t11_failure ON ${table}`);await context.pool.query('DROP FUNCTION platform.t11_fail()');}
      const replay=await http.post(id,'complete',body);assert.equal(replay.status,503);assert.equal((await replay.json() as {replayed:boolean}).replayed,true);assert.deepEqual(await snapshot(),before);
      const receipt=await (await http.get('/api/tickets/'+id+'/completion/commands/'+body.client_command_id)).json() as {state:string;error:{retryable:boolean}};assert.equal(receipt.state,'FAILED');assert.equal(receipt.error.retryable,false);
      const audit=(await context.pool.query('SELECT state,result_ticket_event_id FROM pilot_ticket.ticket_command_receipt WHERE client_command_id=$1::uuid',[body.client_command_id])).rows[0];assert.equal(audit?.state,'FAILED');assert.equal(audit?.result_ticket_event_id,null);
    }
    const fresh=await http.detail(id);assert.equal(fresh.status,'WAITING_VENDOR');assert.equal((await http.post(id,'complete',http.command(fresh))).status,200);
  });
});

test('disabled completion avoids migration040 and missing enabled schema fails closed before receipts or state writes',async()=>{
  for(const enabled of [false,true])await withT11Fixture(async context=>{
    const http=await t11Http(context),ticket=context.tickets[0];assert.ok(ticket);const bootstrap=await (await http.get('/api/lifecycle/bootstrap')).json() as {ticket_staff_completion_enabled:boolean;staff_completion_draft_recovery_enabled:boolean;draft_recovery_enabled:boolean};assert.equal(bootstrap.ticket_staff_completion_enabled,enabled);assert.equal(bootstrap.staff_completion_draft_recovery_enabled,enabled);assert.equal(bootstrap.draft_recovery_enabled,false);
    assert.equal((await context.pool.query("SELECT to_regclass('pilot_ticket.staff_completion_notification_commitment') AS relation")).rows[0]?.relation,null);
    const body={client_command_id:randomUUID(),expected_version:2,reason_code:'STAFF_COMPLETED',handling_cycle_id:randomUUID(),internal_process:'private',external_summary:'safe',external_summary_confirmed:true};assert.equal((await http.post(ticket.ticket.id,'complete',body)).status,503);assert.equal((await context.pool.query('SELECT count(*)::int AS n FROM pilot_ticket.ticket_command_receipt')).rows[0]?.n,0);assert.equal((await context.pool.query('SELECT version FROM pilot_ticket.ticket WHERE id=$1::uuid',[ticket.ticket.id])).rows[0]?.version,2);
    if(!enabled){const detail=await http.detail(ticket.ticket.id);assert.equal(detail.allowed_actions.includes('complete'),false);assert.equal(Object.hasOwn(detail.handling_cycle??{},'staff_completion_event_id'),false);assert.equal((await http.get('/api/tickets/'+ticket.ticket.id+'/completion/commands/'+body.client_command_id)).status,503);}
    else{const ready=await http.get('/health/ready');assert.equal(ready.status,503);assert.equal((await ready.json() as {checks:{ticket_staff_completion_schema:boolean}}).checks.ticket_staff_completion_schema,false);}
  },{completionEnabled:enabled,installCompletionSchema:false,notesEnabled:false});
});

test('default-false legacy Pilot profile cannot expose or execute staff completion outside the cycle and commitment transaction',async()=>{
  await withT11Fixture(async context=>{
    const ticket=context.tickets[8],principal=context.principals[0];assert.ok(ticket);assert.ok(principal);
    const old=createP2016TicketQuery({pool:context.pool,enabled:true});
    const view=await old.detail({authContext:{principal_id:principal.id},ticketId:ticket.ticket.id});
    assert.equal(view.allowed_actions.includes('complete'),false);assert.equal(Object.hasOwn(view,'handling_cycle'),false);
    assert.equal((await context.pool.query("SELECT to_regclass('pilot_ticket.staff_completion_notification_commitment') AS relation")).rows[0]?.relation,null);
    await context.runtime.stop();
    const access=createPilotAccessService({pool:context.pool}),core=createTicketActionService({pool:context.pool,authorize:access.authorizeAction}),server=createPilotWorkbenchServer({access,actions:{perform:core.performRaw},authenticate:async()=>({type:'PILOT_USER',id:principal.id})});
    try{
      await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.off('error',reject);resolve();});});
      const address=server.address();assert.ok(address&&typeof address!=='string');
      const response=await fetch('http://127.0.0.1:'+address.port+'/api/pilot/tickets/'+ticket.ticket.id+'/actions/complete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expectedVersion:2,traceId:'t11-legacy-profile',reasonCode:'STAFF_COMPLETED',internalProcess:'LEGACY_PRIVATE_CANARY',externalSummary:'独立安全摘要',externalSummaryConfirmed:true})});
      assert.equal(response.status,403);await response.json();
      const unchanged=await old.detail({authContext:{principal_id:principal.id},ticketId:ticket.ticket.id});assert.equal(unchanged.status,'IN_PROGRESS');assert.equal(unchanged.version,2);
    }finally{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));assert.equal(server.listening,false);}
  },{completionEnabled:false});
});

test('Reporter-safe and actual H5 owner projections show only confirmed summary and a fresh consumer rediscovers the original durable promise',async()=>{
  await withT11Fixture(async context=>{
    const http=await t11Http(context),ticket=context.tickets[0];assert.ok(ticket);assert.ok(ticket.intake.requestRef);
    const current=await http.start(ticket.ticket.id),command=http.command(current);
    const response=await http.post(ticket.ticket.id,'complete',command);assert.equal(response.status,200);
    const receipt=await response.json() as {ticket_event_id:string;completion:{cycle_id:string;cycle_no:number;event_id:string;basis:string}};
    const ref='T'.repeat(32);
    // The accepted Reporter projection composition Port supplies an already authorized exact owned Ticket scope.
    const reporter=createP2016ReporterTimeline({pool:context.pool,enabled:true,authorizeRead:async(_input,read)=>read(context.pool,{ticket_id:ticket.ticket.id,session_id:null,public_ref:ref})});
    const timeline=await reporter.timeline({sessionToken:'synthetic-authorized-port',publicRef:ref});
    assert.ok(timeline.items.some(item=>item.text.includes(command.external_summary)));
    assert.equal(JSON.stringify(timeline).includes('INTERNAL_T11_CANARY'),false);
    const binding=(await context.pool.query<{scope:string}>('SELECT canonical_reporter_binding AS scope FROM intake.web_request_binding WHERE intake_id=$1::uuid',[ticket.intake.intakeId])).rows[0];assert.ok(binding);
    // Only the protected synthetic member authenticator is replaced; real read authorization and Store ownership checks run.
    const authenticate=async(member:string)=>({scopeHash:member==='owner'?binding.scope:'a'.repeat(64),sourceCorpScope:'web01-synthetic-corp',sourceAppScope:'web01-synthetic-app',proofRef:'web01-synthetic-proof'});
    const authorization=createYxxSelfServiceAuthorization<string>({authenticate,recheck:Object.assign(authenticate,{localOnly:true as const}),profile:'MEMBER_SELF_SERVICE',flags:{YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true}});
    const store=createYxxSelfServiceStore({pool:context.pool}),readWeb=(request:string)=>authorization.read({request,operation:'WEB_TIMELINE',run:member=>store.timeline({scope:member.scope,requestRef:ticket.intake.requestRef})});
    const web=await readWeb('owner');
    assert.ok(web.items.some(item=>item.summary.includes(command.external_summary)));assert.equal(JSON.stringify(web).includes('INTERNAL_T11_CANARY'),false);
    await assert.rejects(readWeb('other'));
    await context.runtime.stop();
    const freshPool=createPostgresPool({connectionString:context.databaseUrl,max:1,application_name:'t11_restart_reader'});
    try{
      const fresh=createTicketStaffCompletionService({pool:freshPool,query:createP2016TicketQuery({pool:freshPool,enabled:true}),enabled:true});
      const found=await fresh.readCommittedStaffCompletions({limit:20});
      assert.equal(found.items.length,1);const first=found.items[0];assert.ok(first);const {occurred_at,...facts}=first;assert.match(occurred_at,/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u);assert.deepEqual(facts,{cycle_id:receipt.completion.cycle_id,cycle_no:1,node:'STAFF_COMPLETED',ticket_id:ticket.ticket.id,ticket_event_id:receipt.ticket_event_id,source_intake_id:ticket.intake.intakeId,external_summary:command.external_summary});
      assert.equal(JSON.stringify(found).includes('INTERNAL_T11_CANARY'),false);assert.deepEqual(await fresh.readCommittedStaffCompletions({afterCycleId:receipt.completion.cycle_id}),{items:[],next_cursor:null});
      assert.equal((await freshPool.query('SELECT count(*)::int AS n FROM communication.ticket_notification_binding WHERE ticket_event_id=$1::uuid',[receipt.ticket_event_id])).rows[0]?.n,0);
    }finally{await freshPool.end();}
  });
});
