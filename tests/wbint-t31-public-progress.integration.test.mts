import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
import {createP2012Runtime} from '../src/p2-012-workbench-assembly.mjs';
import type {P2012RuntimeOptions} from '../src/p2-012-workbench-assembly.mjs';
import type {IncidentPublicProgressHostOptions,IncidentPublicProgressInput} from '../contracts/workbench_incident_public_progress_contracts.js';
import {migrateP2012} from '../scripts/p2-012-migrate.mjs';
import {migrateIncidentInternalNotes} from '../scripts/incident-internal-notes-migrate.mjs';
import {withP2012Database,applyThrough031,fixtureP2012,assertNoP2012Residual} from './helpers/p2-012-postgres-harness.mjs';
import {closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

function record(value:unknown):Record<string,unknown>{assert.ok(value!==null&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function text(value:unknown):string{assert.equal(typeof value,'string');assert.ok(typeof value==='string');return value;}
function rows(value:unknown):Record<string,unknown>[]{assert.ok(Array.isArray(value));return value.map(record);}

test('T31 explicit safe public summary creates one immutable publication and only a valid personal intent through real staff HTTP',async()=>{
  const databaseUrl=process.env.PILOT_DATABASE_URL;
  await withP2012Database({databaseUrl,purpose:'t31publish',run:async({pool,databaseUrl}:{pool:PostgresPool;databaseUrl:string})=>{
    await applyThrough031({pool,databaseUrl});await migrateP2012({databaseUrl});await migrateIncidentInternalNotes({databaseUrl,mode:'apply'});
    // Only the exact absent future DDL is tolerated before implementation. The
    // real new HTTP and persistent-fact assertions below still run unchanged.
    let sql:string|null=null;
    try{sql=await readFile(new URL('../database/migrations/058_workbench_incident_public_progress.sql',import.meta.url),'utf8');}
    catch(error){if(!(error instanceof Error&&'code' in error&&error.code==='ENOENT'))throw error;}
    if(sql!==null)await pool.query(sql);
    const f=await fixtureP2012(pool,{reporters:3}),probe=createServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));
    const address=probe.address();assert.ok(address&&typeof address==='object');const port=address.port;await new Promise<void>((resolve,reject)=>probe.close(error=>error?reject(error):resolve()));
    const origin='http://127.0.0.1:'+port,options:P2012RuntimeOptions & IncidentPublicProgressHostOptions & {flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true}}={pool,principalIds:[text(record(f.admin).id),text(record(f.dispatcher).id),text(record(f.handler).id),text(record(f.outsider).id)],publicOrigin:origin,listenPort:port,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},incidentFlags:{INCIDENT_CORRELATION_ENABLED:true},incidentBackgroundMaintenance:false,incidentCandidateWorkspaceEnabled:true,incidentInternalNotesEnabled:true,incidentPublicProgressEnabled:true,incidentTestLabel:true,externalSendEnabled:false};
    const runtime=createP2012Runtime(options);let primaryError:unknown;
    try{
      const started=record(await runtime.start());assert.ok(Array.isArray(started.cookies));const cookie=record(started.cookies[0]),cookieHeader=text(cookie.name)+'='+text(cookie.value);
      const get=async(path:string)=>{const response=await fetch(origin+path,{headers:{cookie:cookieHeader}}),body=record(await response.json());assert.equal(response.status,200,JSON.stringify(body));return body;};
      const csrf=text((await get('/api/lifecycle/bootstrap')).csrf_token);
      const post=async(path:string,body:Record<string,unknown>)=>{const response=await fetch(origin+path,{method:'POST',headers:{cookie:cookieHeader,origin,'content-type':'application/json','x-csrf-token':csrf,'idempotency-key':text(body.client_command_id),'if-match':'"'+text(body.expected_candidate_version??body.expected_row_version)+'"'},body:JSON.stringify(body)});return {status:response.status,body:record(await response.json())};};
      const candidate=text(record(await f.newCandidate()).id),candidatePath='/api/incident-candidates/'+candidate;
      assert.equal((await post(candidatePath+'/start-review',{client_command_id:randomUUID(),reason_code:'OPERATOR_REVIEWED',expected_row_version:'1'})).status,200);
      const current=await get(candidatePath),confirmed=await post(candidatePath+'/confirm',{client_command_id:randomUUID(),reason_code:'CONFIRMED_SHARED_FAULT',expected_candidate_version:text(current.row_version),expected_material_basis:text(current.material_basis),confirmed_scope:'LOCAL',owner_principal_id:text(record(f.handler).id),owner_team_id:null,selected_report_refs:f.reports.map(report=>text(record(report).decisionId)),primary_ticket_id:null});
      assert.equal(confirmed.status,200);const incidentId=text(confirmed.body.result_ref_id),path='/api/incidents/'+incidentId,privateText='合成内部标记T31-PRIVATE：不得复制到公开摘要。';
      assert.equal((await post(path+'/internal-notes',{client_command_id:randomUUID(),expected_row_version:'1',reason_code:'WORKBENCH_INTERNAL_DISPOSITION',audience:'INTERNAL',text:privateText})).status,200);
      const before=await get(path),personal=await Promise.all(f.reports.map(async report=>({ticketId:text(record(report).ticketId),detail:await get('/api/tickets/'+text(record(report).ticketId)),events:await get('/api/tickets/'+text(record(report).ticketId)+'/events?limit=200')})));
      const body:IncidentPublicProgressInput={client_command_id:randomUUID(),expected_row_version:text(before.row_version),reason_code:'WORKBENCH_PUBLIC_PROGRESS',summary:'合成人工公开摘要：正在核查服务连接，后续进展会再次明确发布。',preview_confirmed:true};
      const published=await post(path+'/publish-update',{...body});
      assert.equal(published.status,200,'authorized explicit safe publication must reach the real new Incident HTTP behavior');assert.equal(published.body.ok,true);
      const expectedVersion=(BigInt(body.expected_row_version)+1n).toString();assert.equal(published.body.result_row_version,expectedVersion);
      const page=await get(path+'/public-progress?limit=10'),items=rows(page.items);assert.equal(items.length,1);assert.equal(page.next_cursor,null);
      const publication=items[0];assert.ok(publication);assert.equal(publication.id,published.body.result_event_id);assert.equal(publication.incident_id,incidentId);assert.equal(publication.incident_row_version,expectedVersion);assert.equal(publication.actor_principal_id,text(record(f.admin).id));assert.equal(publication.summary,body.summary);assert.match(text(publication.event_ordinal),/^[1-9][0-9]*$/u);assert.match(text(publication.occurred_at),/^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$/u);
      const routePage=await get(path+'/public-progress/'+text(publication.id)+'/deliveries?limit=30'),routes=rows(routePage.items);assert.equal(routes.length,1);assert.equal(routePage.next_cursor,null);assert.equal(routes[0]?.route,'BOT_DIRECT');assert.equal(routes[0]?.audience,'REPORTER_DIRECT');assert.equal(routes[0]?.status,'PENDING');assert.ok(!JSON.stringify(routePage).includes(privateText));
      const replay=await post(path+'/publish-update',{...body});assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.equal(replay.body.result_event_id,published.body.result_event_id);
      assert.deepEqual(await get(path+'/public-progress?limit=10'),page);assert.deepEqual(await get(path+'/public-progress/'+text(publication.id)+'/deliveries?limit=30'),routePage);
      const facts=await pool.query<{event_count:string;intent_count:string;group_count:string;private_count:string}>(`SELECT (SELECT count(*)::text FROM incident.incident_event WHERE incident_id=$1::uuid AND event_type='incident.public_progress_published') AS event_count,(SELECT count(*)::text FROM communication.incident_notification_binding WHERE incident_event_id=$2::uuid) AS intent_count,(SELECT count(*)::text FROM communication.incident_notification_binding b JOIN communication.outbox o ON o.message_id=b.communication_message_id JOIN communication.delivery d ON d.outbox_id=o.id WHERE b.incident_event_id=$2::uuid AND d.target_type='GROUP') AS group_count,(SELECT count(*)::text FROM communication.incident_notification_binding b JOIN communication.message m ON m.id=b.communication_message_id WHERE b.incident_event_id=$2::uuid AND m.content::text LIKE '%'||$3||'%') AS private_count`,[incidentId,publication.id,privateText]);
      assert.deepEqual(facts.rows[0],{event_count:'1',intent_count:'1',group_count:'0',private_count:'0'});
      const after=await get(path);assert.equal(after.status,before.status);assert.equal(after.owner_principal_id,before.owner_principal_id);
      for(const snapshot of personal){assert.deepEqual(await get('/api/tickets/'+snapshot.ticketId),snapshot.detail);assert.deepEqual(await get('/api/tickets/'+snapshot.ticketId+'/events?limit=200'),snapshot.events);}
    }catch(error){primaryError=error;}
    await closeBrowserTestResources([()=>runtime.stop(),()=>{assert.equal(runtime.server.listening,false);}],primaryError);
  }});await assertNoP2012Residual({databaseUrl});
});
