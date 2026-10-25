import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {createP2012Runtime} from '../app/server/src/p2-012-workbench-assembly.mjs';
import {migrateP2012} from '../app/server/scripts/p2-012-migrate.mjs';
import {withP2012Database,applyThrough031,fixtureP2012,assertNoP2012Residual} from './helpers/p2-012-postgres-harness.mjs';

test('T27 real HTTP preserves exact captured basis, principal-scoped original command recovery and independent Incident authority',async()=>{
  const databaseUrl=process.env.PILOT_DATABASE_URL;
  await withP2012Database({databaseUrl,purpose:'t27commands',run:async({pool,databaseUrl})=>{
    await applyThrough031({pool,databaseUrl});await migrateP2012({databaseUrl});
    const f=await fixtureP2012(pool,{reporters:3}),candidate=await f.newCandidate(),otherCandidate=await f.newCandidate(1),version='9007199254740993';
    await pool.query('UPDATE incident.candidate_review SET row_version=$2::bigint WHERE id=$1::uuid',[candidate.id,version]);
    const personal=await pool.query('SELECT id::text,status,version FROM pilot_ticket.ticket ORDER BY id');
    const eventCount=(await pool.query('SELECT count(*)::integer AS count FROM pilot_ticket.ticket_event')).rows[0].count;
    const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
    const origin='http://127.0.0.1:'+port,runtime=createP2012Runtime({pool,principalIds:[f.admin.id,f.dispatcher.id,f.handler.id,f.outsider.id],publicOrigin:origin,listenPort:port,
      flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},incidentFlags:{INCIDENT_CORRELATION_ENABLED:true},incidentBackgroundMaintenance:false,incidentCandidateWorkspaceEnabled:true,externalSendEnabled:false});
    const root='/api/incident-candidates/'+candidate.id;
    try{
      const started=await runtime.start(),cookies=started.cookies.map(cookie=>cookie.name+'='+cookie.value);
      const get=async(path,index=0)=>{const response=await fetch(origin+path,{headers:{cookie:cookies[index]}});return {status:response.status,etag:response.headers.get('etag'),body:await response.json()};};
      const bootstraps=await Promise.all(cookies.map((_cookie,index)=>get('/api/lifecycle/bootstrap',index)));
      const post=async(path,body,index=0,match='"'+(body.expected_candidate_version??body.expected_row_version)+'"')=>{
        const response=await fetch(origin+path,{method:'POST',headers:{cookie:cookies[index],origin,'content-type':'application/json','x-csrf-token':bootstraps[index].body.csrf_token,'idempotency-key':body.client_command_id,'if-match':match},body:JSON.stringify(body)});
        return {status:response.status,body:await response.json()};
      };
      const initial=await get(root);assert.equal(initial.status,200);assert.equal(initial.body.row_version,version);assert.equal(initial.etag,'"'+version+'"');
      const start={client_command_id:randomUUID(),expected_row_version:version,reason_code:'OPERATOR_REVIEWED'};
      for(const match of [version,'W/"'+version+'"','"'+(BigInt(version)+1n)+'"'])assert.equal((await post(root+'/start-review',start,0,match)).status,409);
      assert.equal((await post(root+'/start-review',{...start,candidate_review_id:otherCandidate.id})).status,400);
      assert.equal((await post(root+'/start-review',start,2)).status,403);
      assert.equal((await pool.query('SELECT count(*)::integer AS count FROM incident.command_receipt WHERE client_command_id=$1::uuid',[start.client_command_id])).rows[0].count,0);
      const opened=await post(root+'/start-review',start);assert.equal(opened.status,200);assert.equal(opened.body.result_row_version,(BigInt(version)+1n).toString());
      const current=(await get(root)).body;
      const bad={client_command_id:randomUUID(),expected_candidate_version:current.row_version,expected_material_basis:'0'.repeat(64),reason_code:'CONFIRMED_SHARED_FAULT',confirmed_scope:'LOCAL',owner_principal_id:f.handler.id,owner_team_id:'PILOT_IT',selected_report_refs:f.reports.slice(0,2).map(r=>r.decisionId),primary_ticket_id:null};
      const rejected=await post(root+'/confirm',bad);assert.equal(rejected.status,409,'the captured basis must be an accepted HTTP field and checked against current material');assert.equal(rejected.body.error.code,'P2_012_SOURCE_CONFLICT');
      assert.equal((await pool.query('SELECT count(*)::integer AS count FROM incident.incident')).rows[0].count,0);
      const original={...bad,client_command_id:randomUUID(),expected_material_basis:current.material_basis};
      const attempts=await Promise.all([post(root+'/confirm',original,0),post(root+'/confirm',original,1)]);
      const winner=attempts.findIndex(attempt=>attempt.status===200),loser=winner===0?1:0;
      assert.ok(winner===0||winner===1);assert.equal(attempts[loser].status,409);assert.equal(attempts[loser].body.error.code,'P2_012_VERSION_CONFLICT');
      const committed=attempts[winner].body;assert.equal(committed.result_ref_type,'INCIDENT');
      const replay=await post(root+'/confirm',original,winner);assert.equal(replay.status,200);assert.equal(replay.body.result_ref_id,committed.result_ref_id);assert.equal(replay.body.replayed,true);
      assert.equal((await post(root+'/confirm',{...original,selected_report_refs:f.reports.map(r=>r.decisionId)},winner)).body.error.code,'P2_012_COMMAND_CONFLICT');
      const oldFailure=await post(root+'/confirm',bad);assert.equal(oldFailure.status,409);assert.equal(oldFailure.body.error.code,'P2_012_SOURCE_CONFLICT');assert.equal(oldFailure.body.replayed,true);
      const receiptPath=root+'/commands/'+original.client_command_id;
      const receipt=await get(receiptPath,winner);assert.equal(receipt.status,200,'an original operation must be checked through the dedicated read-only receipt route');
      assert.deepEqual(receipt.body,{candidate_review_id:candidate.id,client_command_id:original.client_command_id,state:'COMMITTED',result:{...committed,replayed:true}});
      assert.equal((await get(receiptPath,loser)).body.state,'FAILED');
      const missing=await get(root+'/commands/'+randomUUID(),winner);assert.equal(missing.status,200);assert.equal(missing.body.state,'UNKNOWN');assert.deepEqual(Object.keys(missing.body).sort(),['candidate_review_id','client_command_id','state']);
      const swapped=await get('/api/incident-candidates/'+otherCandidate.id+'/commands/'+original.client_command_id,winner);assert.equal(swapped.status,200);assert.equal(swapped.body.state,'UNKNOWN');
      assert.equal((await get(receiptPath+'?state=COMMITTED',winner)).status,400);assert.equal((await get(receiptPath,2)).status,403);assert.equal((await get(receiptPath,3)).status,404);
      assert.equal((await fetch(origin+receiptPath)).status,401);
      const internal=await get('/api/incidents/'+committed.result_ref_id,winner),publicView=await get('/api/incidents/'+committed.result_ref_id,2);
      assert.equal(internal.status,200);assert.equal(internal.body.owner_principal_id,f.handler.id);assert.equal(internal.body.owner_team_id,'PILOT_IT');assert.equal(internal.body.primary_ticket_id,null);
      assert.equal(publicView.status,200);for(const field of ['owner_principal_id','owner_display_name','owner_team_id','primary_ticket_id','primary_ticket_no'])assert.equal(Object.hasOwn(publicView.body,field),false);
      assert.equal((await get('/api/incidents/'+committed.result_ref_id,3)).status,404);
      assert.doesNotMatch(JSON.stringify(receipt.body),/command_hash|selected_report_refs|reporter_identity_hash|clean_text|source_chat_id/u);
      assert.equal((await pool.query('SELECT count(*)::integer AS count FROM incident.incident')).rows[0].count,1);
      assert.equal((await pool.query('SELECT count(*)::integer AS count FROM incident.incident_report')).rows[0].count,2);
      assert.deepEqual((await pool.query('SELECT id::text,status,version FROM pilot_ticket.ticket ORDER BY id')).rows,personal.rows);
      assert.equal((await pool.query('SELECT count(*)::integer AS count FROM pilot_ticket.ticket_event')).rows[0].count,eventCount);
      for(const table of ['communication.message','communication.outbox','communication.delivery'])assert.equal((await pool.query('SELECT count(*)::integer AS count FROM '+table)).rows[0].count,0);
    }finally{await runtime.stop();assert.equal(runtime.server.listening,false);}
  }});await assertNoP2012Residual({databaseUrl});
});
