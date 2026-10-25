import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {readFile} from 'node:fs/promises';
import type {PostgresPool} from '../app/server/src/platform/postgres-pool.mjs';
import {createP2012Runtime} from '../app/server/src/p2-012-workbench-assembly.mjs';
import type {P2012RuntimeOptions} from '../app/server/src/p2-012-workbench-assembly.mjs';
import {migrateP2012} from '../app/server/scripts/p2-012-migrate.mjs';
import type {IncidentInternalNoteInput,IncidentInternalNoteHostOptions} from '../contracts/workbench_incident_internal_notes_contracts.js';
import {withP2012Database,applyThrough031,fixtureP2012,assertNoP2012Residual} from './helpers/p2-012-postgres-harness.mjs';

interface DatabaseContext {pool:PostgresPool;databaseUrl:string}
interface Fixture {
  admin:{id:string};dispatcher:{id:string};handler:{id:string};outsider:{id:string};
  reports:{decisionId:string;ticketId:string}[];
  newCandidate():Promise<{id:string}>;
}
function record(value:unknown):Record<string,unknown>{
  assert.ok(value!==null&&typeof value==='object'&&!Array.isArray(value));
  return value as Record<string,unknown>;
}
function text(value:unknown):string {assert.equal(typeof value,'string');assert.ok(typeof value==='string');return value;}
function rows(value:unknown):Record<string,unknown>[]{assert.ok(Array.isArray(value));return value.map(record);}

test('T30 an authorized Incident operator records a traceable internal disposition through real staff HTTP without changing personal Tickets or notifications',async()=>{
  const databaseUrl=process.env.PILOT_DATABASE_URL;
  await withP2012Database({databaseUrl,purpose:'t30note',run:async({pool,databaseUrl}:DatabaseContext)=>{
    await applyThrough031({pool,databaseUrl});await migrateP2012({databaseUrl});
    // SOURCE-only reservation: an absent future migration must not replace the
    // genuine new HTTP RED with an import/setup error. Every behavior assertion
    // still runs. A final implemented candidate must require/apply its schema.
    let plannedDdl:string|null=null;
    try {plannedDdl=await readFile(new URL('../database/migrations/055_workbench_incident_internal_notes.sql',import.meta.url),'utf8');}
    catch(error){if(!(error instanceof Error&&'code' in error&&error.code==='ENOENT'))throw error;}
    if(plannedDdl!==null)await pool.query(plannedDdl);
    const fixture:Fixture=await fixtureP2012(pool,{reporters:3}),candidate=await fixture.newCandidate();
    const listener=createServer();await new Promise<void>(resolve=>listener.listen(0,'127.0.0.1',resolve));
    const address=listener.address();assert.ok(address!==null&&typeof address==='object');
    const port=address.port;await new Promise<void>((resolve,reject)=>listener.close(error=>error?reject(error):resolve()));
    const origin='http://127.0.0.1:'+port;
    const options:P2012RuntimeOptions & IncidentInternalNoteHostOptions & {flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true}}={
      pool,principalIds:[fixture.admin.id,fixture.dispatcher.id,fixture.handler.id,fixture.outsider.id],publicOrigin:origin,listenPort:port,
      flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},incidentFlags:{INCIDENT_CORRELATION_ENABLED:true},incidentBackgroundMaintenance:false,
      incidentCandidateWorkspaceEnabled:true,incidentInternalNotesEnabled:true,externalSendEnabled:false,
    };
    const runtime=createP2012Runtime(options);
    try {
      const started=await runtime.start(),cookies=started.cookies;assert.ok(Array.isArray(cookies));
      const cookie=record(cookies[0]),cookieHeader=text(cookie.name)+'='+text(cookie.value);
      const get=async(path:string)=>{
        const response=await fetch(origin+path,{headers:{cookie:cookieHeader}}),body:unknown=await response.json();
        assert.equal(response.status,200,JSON.stringify(body));return record(body);
      };
      const csrf=text((await get('/api/lifecycle/bootstrap')).csrf_token);
      const post=async(path:string,body:Record<string,unknown>)=>{
        const expected=text(body.expected_candidate_version??body.expected_row_version),response=await fetch(origin+path,{method:'POST',
          headers:{cookie:cookieHeader,origin,'content-type':'application/json','x-csrf-token':csrf,'idempotency-key':text(body.client_command_id),'if-match':'"'+expected+'"'},body:JSON.stringify(body)});
        const result:unknown=await response.json();return {status:response.status,body:record(result)};
      };
      const candidatePath='/api/incident-candidates/'+candidate.id;
      const reviewed=await post(candidatePath+'/start-review',{client_command_id:randomUUID(),reason_code:'OPERATOR_REVIEWED',expected_row_version:'1'});
      assert.equal(reviewed.status,200);assert.equal(reviewed.body.ok,true);
      const current=await get(candidatePath),confirmed=await post(candidatePath+'/confirm',{
        client_command_id:randomUUID(),reason_code:'CONFIRMED_SHARED_FAULT',expected_candidate_version:text(current.row_version),expected_material_basis:text(current.material_basis),
        confirmed_scope:'LOCAL',owner_principal_id:fixture.handler.id,owner_team_id:'PILOT_IT',selected_report_refs:fixture.reports.map(report=>report.decisionId),primary_ticket_id:null,
      });
      assert.equal(confirmed.status,200);assert.equal(confirmed.body.ok,true);assert.equal(confirmed.body.result_ref_type,'INCIDENT');
      const incidentId=text(confirmed.body.result_ref_id),path='/api/incidents/'+incidentId,before=await get(path);
      const personal=await Promise.all(fixture.reports.map(async report=>({ticketId:report.ticketId,detail:await get('/api/tickets/'+report.ticketId),events:await get('/api/tickets/'+report.ticketId+'/events?limit=200')})));
      const notifications=await get(path+'/notifications?limit=100');
      const body:IncidentInternalNoteInput={client_command_id:randomUUID(),expected_row_version:text(before.row_version),reason_code:'WORKBENCH_INTERNAL_DISPOSITION',audience:'INTERNAL',text:'合成内部处置：已在隔离环境检查终端连接，继续排查原因。'};
      // The first missing behavior is the actual authorized new HTTP command.
      const saved=await post(path+'/internal-notes',{...body});
      assert.equal(saved.status,200,'authorized internal disposition must be accepted by the real Incident HTTP command');assert.equal(saved.body.ok,true);
      assert.equal(saved.body.result_ref_type,'INCIDENT');assert.equal(saved.body.result_ref_id,incidentId);
      const expectedVersion=(BigInt(body.expected_row_version)+1n).toString();assert.equal(saved.body.result_row_version,expectedVersion);
      const page=await get(path+'/internal-notes?limit=30');assert.equal(page.incident_id,incidentId);assert.equal(page.next_cursor,null);
      const items=rows(page.items);assert.equal(items.length,1);const note=items[0];assert.ok(note);
      assert.equal(note.id,saved.body.result_event_id);assert.equal(note.incident_id,incidentId);assert.equal(note.incident_row_version,expectedVersion);
      assert.equal(note.actor_principal_id,fixture.admin.id);assert.equal(note.actor_display_name,'合成管理员');assert.equal(note.audience,'INTERNAL');assert.equal(note.text,body.text);
      assert.match(text(note.event_ordinal),/^[1-9][0-9]*$/u);assert.match(text(note.occurred_at),/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u);
      const after=await get(path);assert.equal(after.row_version,expectedVersion);assert.equal(after.status,before.status);assert.equal(after.owner_principal_id,before.owner_principal_id);
      assert.deepEqual(await get(path+'/notifications?limit=100'),notifications);
      for(const snapshot of personal){assert.deepEqual(await get('/api/tickets/'+snapshot.ticketId),snapshot.detail);assert.deepEqual(await get('/api/tickets/'+snapshot.ticketId+'/events?limit=200'),snapshot.events);}
    } finally {await runtime.stop();assert.equal(runtime.server.listening,false);}
  }});
  await assertNoP2012Residual({databaseUrl});
});
