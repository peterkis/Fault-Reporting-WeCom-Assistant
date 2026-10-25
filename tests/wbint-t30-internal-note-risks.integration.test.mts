import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {t30Http,record,text} from './helpers/t30-internal-note-fixture.mjs';
import {ownedHttp} from './helpers/t36-supplement-fixture.mjs';
import {createP2012ReporterTimelineAdapter} from '../app/server/src/p2-012-reporter-timeline-adapter.mjs';
import {createP2012IncidentQuery} from '../app/server/src/p2-012-incident-query.mjs';
import {createWeComWorkbenchAuthentication} from '../app/server/src/p2-016-workbench-wecom-auth.mjs';
import {migrateWorkbenchAuth} from '../app/server/scripts/p2-016-workbench-auth-migrate.mjs';
import {createP2012Runtime} from '../app/server/src/p2-012-workbench-assembly.mjs';
import {closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import type {PostgresTransaction,PostgresQueryRow} from '../app/server/src/platform/postgres-pool.mjs';
const input=(version:string,note='合成内部检查')=>({client_command_id:randomUUID(),expected_row_version:version,reason_code:'WORKBENCH_INTERNAL_DISPOSITION',audience:'INTERNAL',text:note});

for(const scenario of [
  {state:'UNKNOWN',loss:'logout'}, {state:'FAILED',loss:'logout'}, {state:'CANDIDATE',loss:'logout'},
  {state:'CONFIRMATION',loss:'logout'}, {state:'CANDIDATE',loss:'idle'}, {state:'CONFIRMATION',loss:'broad'},
] as const)test(`T27 candidate ${scenario.state} receipt refuses ${scenario.loss} lost during its actual HTTP data wait`,async()=>{
  await t30Http({purpose:'t27rcpt'},async({pool,databaseUrl,f,post,get,runtime,origin})=>{
    const candidate=text(record(await f.newCandidate()).id),root='/api/incident-candidates/'+candidate,commandId=randomUUID(),principalId=text(record(f.admin).id);
    const start={client_command_id:scenario.state==='CANDIDATE'?commandId:randomUUID(),expected_row_version:'1',reason_code:'OPERATOR_REVIEWED'};
    assert.equal((await post(root+'/start-review',start)).status,200);
    if(scenario.state==='FAILED'||scenario.state==='CONFIRMATION'){
      const detail=(await get(root)).body,result=await post(root+'/confirm',{client_command_id:commandId,expected_candidate_version:text(detail.row_version),expected_material_basis:scenario.state==='FAILED'?'0'.repeat(64):text(detail.material_basis),reason_code:'CONFIRMED_SHARED_FAULT',confirmed_scope:'LOCAL',owner_principal_id:text(record(f.handler).id),owner_team_id:null,selected_report_refs:f.reports.map(report=>text(record(report).decisionId)),primary_ticket_id:null});
      assert.equal(result.status,scenario.state==='FAILED'?409:200,JSON.stringify(result.body));
    }
    const facts=async()=>(await pool.query(`SELECT (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM incident.command_receipt r) AS receipts,
      (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM incident.incident i) AS incidents,
      (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM incident.candidate_review c) AS candidates,
      (SELECT count(*)::text FROM pilot_ticket.ticket_event) AS ticket_events,
      (SELECT count(*)::text FROM communication.delivery) AS deliveries`)).rows;
    const before=await facts(),migrationOptions={databaseUrl,mode:'apply'};await migrateWorkbenchAuth(migrationOptions);
    const auth=createWeComWorkbenchAuthentication({pool,publicOrigin:'https://pr99-auth.invalid',corpId:'pr99-synthetic',agentId:'1',identityHashKey:'pr99-only-synthetic-identity-hash-key',accessTokenProvider:async()=> 'pr99-synthetic-token',fetchImpl:async(_url,init)=>{
      const request=record(JSON.parse(typeof init?.body==='string'?init.body:'{}'));assert.ok(Array.isArray(request.userid_list));
      return new Response(JSON.stringify({errcode:0,open_userid_list:request.userid_list.map(user=>({userid:user,open_userid:'pr99-'+String(user)}))}),{headers:{'content-type':'application/json'}});
    }});await auth.initialize();
    const epoch=Date.now(),expiry=epoch+3600000,token=randomUUID(),csrf=randomUUID(),hash=(value:string)=>createHash('sha256').update(value).digest('hex'),cookie='__Host-wecom_workbench_session='+token+'; __Host-wecom_workbench_csrf='+csrf;
    const session=(await pool.query<{session_id:string}>(`INSERT INTO pilot_ticket.workbench_auth_session(session_token_hash,csrf_token_hash,principal_id,identity_hash,created_at,created_epoch_ms,last_seen_at,last_seen_epoch_ms,expires_epoch_ms,expires_at)
      VALUES($1,$5,$2::uuid,$1,platform.local_from_epoch_ms($3),$3,platform.local_from_epoch_ms($3),$3,$4,platform.local_from_epoch_ms($4)) RETURNING session_id::text`,[hash(token),principalId,epoch,expiry,hash(csrf)])).rows[0];assert.ok(session);
    let armed=false,entered:()=>void=()=>{},resume:()=>void=()=>{};const reached=new Promise<void>(resolve=>{entered=resolve;}),release=new Promise<void>(resolve=>{resume=resolve;});
    const gated:PostgresTransaction={query:async<R extends PostgresQueryRow=Record<string,unknown>>(sql:string,values?:unknown[])=>{
      const result=await pool.query<R>(sql,values);
      if(armed&&(scenario.state==='CONFIRMATION'?sql.includes('SELECT c.* FROM incident.incident c'):sql.includes('SELECT state,command_type,result_ref_type'))){entered();await release;}
      return result;
    }};
    await runtime.stop();const observed=new Proxy(pool,{get(target,key){if(key==='query')return gated.query;const member:unknown=Reflect.get(target,key);return typeof member==='function'?member.bind(target):member;}});
    const official=createP2012Runtime({pool:observed,publicOrigin:'https://pr99-auth.invalid',listenPort:Number(new URL(origin).port),workbenchAuthentication:auth,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},incidentFlags:{INCIDENT_CORRELATION_ENABLED:true},incidentCandidateWorkspaceEnabled:true,incidentBackgroundMaintenance:false,externalSendEnabled:false});
    let pending:Promise<{status:number;body:Record<string,unknown>}>|undefined,primaryError:unknown;
    // This fixture restarts its App on the same port. Each request owns its
    // connection so it cannot reuse a socket belonging to the stopped App.
    const read=async()=>{const response=await ownedHttp(origin+root+'/commands/'+commandId,{headers:{cookie}});return {status:response.status,body:record(await response.json())};};
    try{
      await official.start();const initial=await read();assert.equal(initial.status,200,JSON.stringify(initial.body));assert.equal(initial.body.state,['CANDIDATE','CONFIRMATION'].includes(scenario.state)?'COMMITTED':scenario.state);
      armed=true;pending=read();await reached;
      if(scenario.loss==='logout'){
        const logout=await ownedHttp(origin+'/workbench/logout',{method:'POST',headers:{cookie,origin:'https://pr99-auth.invalid','x-csrf-token':csrf}});assert.equal(logout.status,200);
        assert.equal((await pool.query("SELECT 1 FROM pilot_ticket.workbench_auth_session WHERE session_id=$1::uuid AND state='REVOKED'",[session.session_id])).rowCount,1);
      }else if(scenario.loss==='idle'){
        await pool.query(`UPDATE pilot_ticket.workbench_auth_session SET created_epoch_ms=$2,created_at=platform.local_from_epoch_ms($2),last_seen_epoch_ms=$3,last_seen_at=platform.local_from_epoch_ms($3) WHERE session_id=$1::uuid`,[session.session_id,Date.now()-3600000,Date.now()-1800001]);
      }else{
        await pool.query("DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid AND role='ADMIN'",[principalId]);
        await pool.query("INSERT INTO pilot_ticket.pilot_principal_role(principal_id,role) VALUES($1::uuid,'HANDLER') ON CONFLICT DO NOTHING",[principalId]);
      }
      resume();const result=await pending;assert.equal(result.status,403,JSON.stringify(result.body));assert.equal(Object.hasOwn(result.body,'result'),false);assert.equal(Object.hasOwn(result.body,'state'),false);assert.deepEqual(await facts(),before,'a refused read cannot mutate the original command or business facts');
    }catch(error){primaryError=error;}
    await closeBrowserTestResources([
      async()=>{resume();try{await pending;}catch(error){if(error!==primaryError)throw error;}},
      ()=>official.stop(),()=>auth.close(),()=>{assert.equal(official.server.listening,false);},
    ],primaryError);
  });
});

for(const loss of ['role','scope','session','receipt-role','late-purpose-role'] as const)test(`T30 private query refuses ${loss} authority lost while the actual final data query awaits`,async()=>{
  await t30Http({purpose:'t30fence'},async({pool,databaseUrl,f,confirm,post,runtime,origin})=>{
    const incident=await confirm(),command=input('1','PR99 synthetic private note must not escape a revoked read');assert.equal((await post('/api/incidents/'+incident+'/internal-notes',command)).status,200);
    const principalId=text(record(loss==='scope'?f.dispatcher:f.admin).id);let auth:ReturnType<typeof createWeComWorkbenchAuthentication>|undefined;
    let authContext:Record<string,unknown>={principal_id:principalId},sessionCookie='',sessionCsrf='';let officialRuntime:ReturnType<typeof createP2012Runtime>|undefined;
    if(loss==='session'){
      const migrationOptions={databaseUrl,mode:'apply'};await migrateWorkbenchAuth(migrationOptions);
      auth=createWeComWorkbenchAuthentication({pool,publicOrigin:'https://pr99-auth.invalid',corpId:'pr99-synthetic',agentId:'1',identityHashKey:'pr99-only-synthetic-identity-hash-key',accessTokenProvider:async()=> 'pr99-synthetic-token',fetchImpl:async(_url,init)=>{
        const request=record(JSON.parse(typeof init?.body==='string'?init.body:'{}'));assert.ok(Array.isArray(request.userid_list));
        return new Response(JSON.stringify({errcode:0,open_userid_list:request.userid_list.map(user=>({userid:user,open_userid:'pr99-'+String(user)}))}),{headers:{'content-type':'application/json'}});
      }});await auth.initialize();
      const epoch=Date.now(),expiry=epoch+3600000,token=randomUUID();sessionCsrf=randomUUID();sessionCookie='__Host-wecom_workbench_session='+token+'; __Host-wecom_workbench_csrf='+sessionCsrf;
      const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
      const session=(await pool.query<{session_id:string}>(`INSERT INTO pilot_ticket.workbench_auth_session(session_token_hash,csrf_token_hash,principal_id,identity_hash,created_at,created_epoch_ms,last_seen_at,last_seen_epoch_ms,expires_epoch_ms,expires_at)
        VALUES($1,$5,$2::uuid,$1,platform.local_from_epoch_ms($3),$3,platform.local_from_epoch_ms($3),$3,$4,platform.local_from_epoch_ms($4)) RETURNING session_id::text`,[hash(token),principalId,epoch,expiry,hash(sessionCsrf)])).rows[0];assert.ok(session);
      authContext={principal_id:principalId,auth_method:'COOKIE',session_id:session.session_id,expires_epoch_ms:String(expiry)};
    }
    let entered:()=>void=()=>{},resume:()=>void=()=>{},armed=false,purposeChecks=0;const reached=new Promise<void>(resolve=>{entered=resolve;}),release=new Promise<void>(resolve=>{resume=resolve;});
    const gated:PostgresTransaction={query:async<R extends PostgresQueryRow=Record<string,unknown>>(sql:string,values?:unknown[])=>{
      const result=await pool.query<R>(sql,values);
      if(armed&&(loss==='late-purpose-role'?sql.includes('FROM pg_index')&&++purposeChecks===2:loss==='receipt-role'?sql.includes('SELECT state,result_ref_type'):sql.includes('e.internal_note_text AS text'))){entered();await release;}
      return result;
    }};
    const options={pool:gated,enabled:true,internalNotesEnabled:true,currentSessionPredicate:auth?.currentSessionPredicate},query=createP2012IncidentQuery(options);
    let pending:Promise<unknown>|undefined;
    try{
      if(auth){
        await runtime.stop();const observed=new Proxy(pool,{get(target,key){if(key==='query')return gated.query;const member:unknown=Reflect.get(target,key);return typeof member==='function'?member.bind(target):member;}});
        officialRuntime=createP2012Runtime({pool:observed,publicOrigin:'https://pr99-auth.invalid',listenPort:Number(new URL(origin).port),workbenchAuthentication:auth,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},incidentFlags:{INCIDENT_CORRELATION_ENABLED:true},incidentCandidateWorkspaceEnabled:true,incidentInternalNotesEnabled:true,incidentBackgroundMaintenance:false,externalSendEnabled:false});await officialRuntime.start();
        const read=()=>ownedHttp(origin+'/api/incidents/'+incident+'/internal-notes',{headers:{cookie:sessionCookie}});
        const before=await read();assert.equal(before.status,200);const page=record(await before.json());assert.ok(Array.isArray(page.items));assert.equal(record(page.items[0]).text,command.text);armed=true;
        pending=read().then(async response=>({ok:response.status===200,value:await response.json()}));
      }else{const before=await query.internalNotes({authContext,incidentId:incident});assert.equal(before.items[0]?.text,command.text);armed=true;
        pending=(loss==='receipt-role'?query.incidentCommandReceipt({authContext,id:incident,commandId:command.client_command_id}):query.internalNotes({authContext,incidentId:incident})).then(value=>({ok:true,value}),error=>({ok:false,error}));}
      await reached;
      if(loss==='scope')assert.equal((await post('/api/incidents/'+incident+'/correct-scope',{client_command_id:randomUUID(),expected_row_version:'2',reason_code:'SCOPE_CORRECTION',confirmed_scope:'CAMPUS'})).status,200);
      else if(loss==='session'){const logout=await ownedHttp(origin+'/workbench/logout',{method:'POST',headers:{cookie:sessionCookie,origin:'https://pr99-auth.invalid','x-csrf-token':sessionCsrf}});assert.equal(logout.status,200);assert.equal((await pool.query("SELECT 1 FROM pilot_ticket.workbench_auth_session WHERE session_id=$1::uuid AND state='REVOKED'",[authContext.session_id])).rowCount,1);}
      else{await pool.query("DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid AND role='ADMIN'",[principalId]);await pool.query("INSERT INTO pilot_ticket.pilot_principal_role(principal_id,role) VALUES($1::uuid,'HANDLER') ON CONFLICT DO NOTHING",[principalId]);}
      resume();const outcome=record(await pending);assert.equal(outcome.ok,false,'the final read must reject instead of returning a prior authorized snapshot');assert.equal(JSON.stringify(outcome).includes(command.text),false);
    }finally{resume();await pending;await officialRuntime?.stop();await auth?.close();}
  });
});
test('T30 real HTTP enforces exact input, current purpose, stable private pages, concurrency and original-ledger recovery without outward effects',async()=>{
  await t30Http({purpose:'t30risk',notifications:true},async({pool,f,confirm,get,post})=>{
    const incident=await confirm(),path='/api/incidents/'+incident,notes=path+'/internal-notes';
    const outward=await pool.query(`SELECT (SELECT count(*) FROM communication.incident_notification_binding)::text AS bindings,(SELECT count(*) FROM communication.outbox)::text AS outbox,(SELECT count(*) FROM communication.delivery)::text AS deliveries,(SELECT count(*) FROM conversation.realtime_event)::text AS sse`);
    const reporter=createP2012ReporterTimelineAdapter({pool,enabled:true}),ticketId=text(record(f.reports[0]).ticketId),milestones=await reporter.milestones({ticketId}),personal=(await get('/api/tickets/'+ticketId)).body,events=(await get(path+'/events')).body;
    for(const changes of [{text:''},{text:' \n\t'},{text:'x\u0001'},{text:'x'.repeat(2001)},{text:'x\ud800'},{audience:'GROUP'},{actor_principal_id:text(record(f.admin).id)},{expected_row_version:'9223372036854775808'},{expected_row_version:1}]){const response=await post(notes,{...input('1'),...changes});assert.ok([400,409].includes(response.status),JSON.stringify(response.body));assert.equal(JSON.stringify(response.body).includes('x'.repeat(20)),false);}
    assert.equal((await post(notes,input('1'),0,{'if-match':'W/"1"'})).status,409);assert.equal((await post(notes,input('1'),0,{'idempotency-key':randomUUID()})).status,400);
    assert.equal((await post(notes,input('1'),0,{'origin':'http://outside.invalid'})).status,403);assert.equal((await post(notes,input('1'),0,{'x-csrf-token':'invalid'})).status,403);
    assert.equal((await get(notes+'?limit=101')).status,400);assert.equal((await get(notes+'?limit=1&limit=2')).status,400);assert.equal((await get(notes+'?state=ACTIVE')).status,400);
    for(const actor of [2,3]){assert.ok([403,404].includes((await get(notes,actor)).status));assert.ok([403,404].includes((await post(notes,input('1'),actor)).status));}
    const command=input('1','私有并发正文：不能进入 Reporter、通知或 SSE'),same=await Promise.all([post(notes,command),post(notes,command),post(notes,command)]);assert.ok(same.every(r=>r.status===200));assert.equal(same.filter(r=>r.body.replayed===false).length,1);assert.ok(same.every(r=>r.body.result_event_id===same[0]?.body.result_event_id));
    assert.equal((await post(notes,{...command,text:'不同正文'})).status,409);
    const receipt=(await get(path+'/commands/'+command.client_command_id)).body;assert.equal(receipt.state,'COMMITTED');assert.equal(JSON.stringify(receipt).includes(command.text),false);
    const a=input('2','第二条'),b=input('2','竞争不应保存'),race=await Promise.all([post(notes,a),post(notes,b)]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
    const first=(await get(notes+'?limit=1')).body;assert.ok(Array.isArray(first.items));assert.equal(first.items.length,1);assert.equal(record(first.items[0]).incident_row_version,'2');const cursor=text(first.next_cursor),second=(await get(notes+'?limit=1&cursor='+encodeURIComponent(cursor))).body;assert.ok(Array.isArray(second.items));assert.equal(second.items.length,1);assert.equal(second.next_cursor,null);assert.equal(record(second.items[0]).incident_row_version,'3');assert.equal((await get(notes+'?cursor='+encodeURIComponent(cursor),1)).status,400);
    assert.deepEqual((await get(path+'/events')).body,events);assert.deepEqual(await reporter.milestones({ticketId}),milestones);assert.deepEqual((await get('/api/tickets/'+ticketId)).body,personal);assert.equal((await get(notes,1)).status,200);assert.equal((await post(path+'/correct-scope',{client_command_id:randomUUID(),expected_row_version:'3',reason_code:'SCOPE_CORRECTION',confirmed_scope:'CAMPUS'})).status,200);
    assert.equal((await get(notes,1)).status,403);assert.equal((await post(notes,input('4'),1)).status,403);assert.equal((await get(notes+'?cursor='+encodeURIComponent(cursor))).status,400);
    await pool.query("DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid AND role='ADMIN'",[text(record(f.admin).id)]);await pool.query("INSERT INTO pilot_ticket.pilot_principal_role(principal_id,role) VALUES($1::uuid,'DISPATCHER')",[text(record(f.admin).id)]);
    assert.equal((await get(path+'/commands/'+command.client_command_id)).status,403);assert.equal((await post(notes,command)).status,403);
    await pool.query("DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid AND role='DISPATCHER'",[text(record(f.admin).id)]);await pool.query("INSERT INTO pilot_ticket.pilot_principal_role(principal_id,role) VALUES($1::uuid,'ADMIN')",[text(record(f.admin).id)]);
    assert.equal((await post(notes,command)).body.replayed,true);
    const after=await pool.query(`SELECT (SELECT count(*) FROM communication.incident_notification_binding)::text AS bindings,(SELECT count(*) FROM communication.outbox)::text AS outbox,(SELECT count(*) FROM communication.delivery)::text AS deliveries,(SELECT count(*) FROM conversation.realtime_event)::text AS sse`);
    // The explicit scope command legitimately produces its existing safe SSE;
    // no internal-note event or body is projected into that stream.
    assert.deepEqual({bindings:after.rows[0]?.bindings,outbox:after.rows[0]?.outbox,deliveries:after.rows[0]?.deliveries},{bindings:outward.rows[0]?.bindings,outbox:outward.rows[0]?.outbox,deliveries:outward.rows[0]?.deliveries});
    assert.equal((await pool.query('SELECT 1 FROM conversation.realtime_event WHERE payload::text LIKE $1',['%私有并发正文%'])).rowCount,0);assert.equal((await pool.query("SELECT 1 FROM incident.incident_event WHERE event_type='incident.internal_note_added' AND safe_payload<>'{}'::jsonb")).rowCount,0);
  });
});
test('Incident original recovery receipt retains its exact HANDLER assignee purpose through the last read wait',async()=>{
  await t30Http({purpose:'t30target'},async({pool,f,confirm,post})=>{
    const incident=await confirm(),handler=text(record(f.handler).id),ticket=text(record(f.reports[0]).ticketId);
    await pool.query('UPDATE pilot_ticket.ticket SET assignee_id=$2::uuid WHERE id=$1::uuid',[ticket,handler]);
    const report=(await pool.query<{id:string;row_version:string}>('SELECT id::text,row_version::text FROM incident.incident_report WHERE incident_id=$1::uuid AND ticket_id=$2::uuid',[incident,ticket])).rows[0];assert.ok(report);
    const command={client_command_id:randomUUID(),expected_row_version:'1',expected_report_version:report.row_version,reason_code:'RECOVERY_CONFIRMED'};
    assert.equal((await post('/api/incidents/'+incident+'/reports/'+report.id+'/mark-recovered',command,2)).status,200);
    let armed=false,checks=0,entered:()=>void=()=>{},resume:()=>void=()=>{};const reached=new Promise<void>(resolve=>{entered=resolve;}),release=new Promise<void>(resolve=>{resume=resolve;});
    const gated:PostgresTransaction={query:async<R extends PostgresQueryRow=Record<string,unknown>>(sql:string,values?:unknown[])=>{
      if(armed&&sql.includes('SELECT EXISTS(SELECT 1 FROM pilot_ticket.pilot_principal actor')&&++checks===4){entered();await release;}
      return pool.query<R>(sql,values);
    }};
    const query=createP2012IncidentQuery({pool:gated,enabled:true}),authContext={principal_id:handler},read=()=>query.incidentCommandReceipt({authContext,id:incident,commandId:command.client_command_id});
    assert.equal((await read()).state,'COMMITTED');armed=true;const pending=read().then(value=>({ok:true,value}),error=>({ok:false,error}));
    try{await reached;await pool.query('UPDATE pilot_ticket.ticket SET assignee_id=$2::uuid WHERE id=$1::uuid',[ticket,text(record(f.admin).id)]);await query.resource({authContext,id:incident,kind:'incident'});
      resume();assert.equal((await pending).ok,false,'team READ does not retain the original recovery assignee purpose');
    }finally{resume();await pending;}
  });
});
test('T30 disabled host mounts no private purpose on the unchanged 032 schema',async()=>{
  await t30Http({purpose:'t30off',notes:false,ddl:false},async({confirm,get,post,pool})=>{const incident=await confirm(),path='/api/incidents/'+incident+'/internal-notes';assert.equal((await get(path)).status,404);assert.equal((await post(path,input('1'))).status,404);assert.equal((await pool.query("SELECT 1 FROM information_schema.columns WHERE table_schema='incident' AND table_name='incident_event' AND column_name='internal_note_text'")).rowCount,0);});
});
test('T30 a note in RESOLVED remains a note, CLOSED rejects new writes and original committed replay keeps its submission version',async()=>{
  await t30Http({purpose:'t30closed'},async({confirm,post,get})=>{
    const incident=await confirm(),path='/api/incidents/'+incident;
    assert.equal((await post(path+'/start-investigating',{client_command_id:randomUUID(),expected_row_version:'1',reason_code:'OPERATOR_REVIEWED'})).status,200);
    assert.equal((await post(path+'/resolve',{client_command_id:randomUUID(),expected_row_version:'2',reason_code:'RECOVERY_CONFIRMED'})).status,200);
    const command=input('3','合成恢复之后的内部交接');assert.equal((await post(path+'/internal-notes',command)).status,200);assert.equal((await get(path)).body.status,'RESOLVED');
    assert.equal((await post(path+'/close',{client_command_id:randomUUID(),expected_row_version:'4',reason_code:'RECOVERY_CONFIRMED'})).status,200);
    assert.equal((await post(path+'/internal-notes',input('5'))).status,409);assert.equal((await get(path)).body.row_version,'5');
    const page=(await get(path+'/internal-notes')).body;assert.ok(Array.isArray(page.items));assert.equal(page.items.length,1);assert.equal(record(page.items[0]).incident_row_version,'4');assert.equal((await post(path+'/internal-notes',command)).body.replayed,true);
  });
});
