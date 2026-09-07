import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { createP2012Runtime } from '../src/p2-012-workbench-assembly.mjs';
import { migrateP2012 } from '../scripts/p2-012-migrate.mjs';
import { withP2012Database,applyThrough031,fixtureP2012 } from './helpers/p2-012-postgres-harness.mjs';
export async function freeP2012Port(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
test('P2-012 actual HTTP inherits authentication, CSRF, command fence and durable realtime',async()=>{
  await withP2012Database({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'p2012http',run:async({pool,databaseUrl})=>{
    await applyThrough031({pool,databaseUrl});await migrateP2012({databaseUrl});
    const f=await fixtureP2012(pool,{reporters:3}),candidate=await f.newCandidate(),port=await freeP2012Port(),origin='http://127.0.0.1:'+port;
    const runtime=createP2012Runtime({pool,principalId:f.admin.id,publicOrigin:origin,listenPort:port,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},incidentFlags:{INCIDENT_CORRELATION_ENABLED:true}});
    let reader;const abort=new AbortController();
    try{
      const started=await runtime.start(),cookie=started.cookie.name+'='+started.cookie.value;
      const get=path=>fetch(origin+path,{headers:{cookie}});
      assert.equal((await fetch(origin+'/api/incident-candidates')).status,401);
      assert.equal((await get('/api/incidents?token=bad')).status,401);
      assert.equal((await get('/api/incident-candidates?limit=101')).status,400);
      assert.equal((await get('/workbench/incidents')).status,200);
      const bootstrap=await (await get('/api/lifecycle/bootstrap')).json();
      const candidateDetail=await (await get('/api/incident-candidates/'+candidate.id)).json();assert.equal(candidateDetail.source_decision.result_code,'INCIDENT_REVIEW_CANDIDATE');assert.equal(candidateDetail.report_sources.length,3);assert.ok(candidateDetail.report_sources.every(r=>r.journey_id));
      assert.equal(/reporter_identity_hash|reporter_wecom_userid|source_chat_id|clean_text/u.test(JSON.stringify(candidateDetail)),false);
      const command={client_command_id:randomUUID(),expected_row_version:'1',reason_code:'OPERATOR_REVIEWED'};
      const post=(headers={},body=command)=>fetch(origin+'/api/incident-candidates/'+candidate.id+'/start-review',{method:'POST',headers:{cookie,origin,'content-type':'application/json','idempotency-key':body.client_command_id,'if-match':'"1"',...headers},body:JSON.stringify(body)});
      assert.equal((await post()).status,403);
      assert.equal((await post({'x-csrf-token':bootstrap.csrf_token,origin:'https://attacker.invalid'})).status,403);
      const success=await post({'x-csrf-token':bootstrap.csrf_token});assert.equal(success.status,200,JSON.stringify(await success.clone().json()));
      assert.equal((await (await post({'x-csrf-token':bootstrap.csrf_token})).json()).replayed,true);
      assert.equal((await post({'x-csrf-token':bootstrap.csrf_token},{...command,raw_target:'forbidden'})).status,400);
      const events=(await pool.query("SELECT event_type,aggregate_version::text,payload FROM conversation.realtime_event WHERE publisher_name='P2_012_WORKBENCH'")).rows;
      assert.ok(events.some(e=>e.event_type==='incident.candidate.review_started'&&e.aggregate_version==='2'));
      assert.doesNotMatch(JSON.stringify(events),/reporter_identity_hash|target_id|reason_code|patient/u);
      const sse=await fetch(origin+'/api/realtime/events',{headers:{cookie},signal:abort.signal});assert.equal(sse.status,200);reader=sse.body.getReader();assert.equal((await reader.read()).done,false);
      const projected=await runtime.coordinator.runOnce();assert.equal(projected.failures,0,JSON.stringify(projected));
      const ready=await (await get('/health/ready')).json();assert.equal(ready.base_service_ready,true,JSON.stringify(ready));assert.equal(ready.ai_enhancement_ready,false);
    }finally{abort.abort();await reader?.cancel().catch(()=>{});await runtime.stop();}
    assert.equal(runtime.server.listening,false);
  }});
});

test('P2-012 actual HTTP preserves notification failure, rollback and durable replay before explicit recovery',async()=>{
  await withP2012Database({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'p2012status',run:async({pool,databaseUrl})=>{
    await applyThrough031({pool,databaseUrl});await migrateP2012({databaseUrl});
    const f=await fixtureP2012(pool,{reporters:6}),candidate=await f.newCandidate();
    let unavailable=true,appends=0;
    // Fail the second append at the existing Communication conflict seam, after
    // the first notification has written real Message/Outbox/Delivery facts.
    const failingPool={query:(...args)=>pool.query(...args),connect:async()=>{
      const tx=await pool.connect();return {release:destroy=>tx.release(destroy),query:async(sql,args)=>{
        if(sql.includes('FROM communication.message')&&sql.includes('WHERE idempotency_scope = $1')){
          appends++;
          if(unavailable&&appends===2)return {rowCount:1,rows:[{command_hash:'synthetic-conflict'}]};
        }
        return tx.query(sql,args);
      }};
    }};
    const port=await freeP2012Port(),origin='http://127.0.0.1:'+port;
    const runtime=createP2012Runtime({pool:failingPool,principalId:f.admin.id,publicOrigin:origin,listenPort:port,
      flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},incidentFlags:{INCIDENT_CORRELATION_ENABLED:true,INCIDENT_PUBLIC_NOTICE_ENABLED:true,INCIDENT_PRIVATE_NOTICE_ENABLED:true}});
    try{
      const started=await runtime.start(),cookie=started.cookie.name+'='+started.cookie.value;
      const bootstrap=await (await fetch(origin+'/api/lifecycle/bootstrap',{headers:{cookie}})).json();
      const post=async(path,body)=>{const response=await fetch(origin+path,{method:'POST',headers:{cookie,origin,'content-type':'application/json',
        'x-csrf-token':bootstrap.csrf_token,'idempotency-key':body.client_command_id,'if-match':'"'+(body.expected_candidate_version??body.expected_row_version)+'"'},body:JSON.stringify(body)});
        return {status:response.status,body:await response.json()};};
      const command=(version='1')=>({client_command_id:randomUUID(),expected_row_version:version,reason_code:'OPERATOR_REVIEWED'});
      const root='/api/incident-candidates/'+candidate.id;
      assert.equal((await post(root+'/start-review',command())).status,200);
      const tables=['incident.incident','incident.incident_report','incident.incident_event','incident.reporter_subscription',
        'communication.incident_notification_binding','communication.message','communication.outbox','communication.delivery','conversation.realtime_event'];
      const counts=async()=>Promise.all(tables.map(async table=>(await pool.query('SELECT count(*)::int AS n FROM '+table)).rows[0].n));
      const before=await counts(),confirm={client_command_id:randomUUID(),expected_candidate_version:'2',reason_code:'OPERATOR_REVIEWED',
        confirmed_scope:'LOCAL',owner_principal_id:f.admin.id,selected_report_refs:f.reports.slice(0,4).map(r=>r.decisionId)};
      const first=await post(root+'/confirm',confirm);
      assert.equal(first.status,503);assert.deepEqual(first.body,{ok:false,error:{code:'P2_012_NOTIFICATION_FAILED',retryable:false},replayed:false});
      assert.equal(appends,2);assert.deepEqual(await counts(),before);
      assert.deepEqual((await pool.query('SELECT status,row_version::text FROM incident.candidate_review WHERE id=$1',[candidate.id])).rows,[{status:'UNDER_REVIEW',row_version:'2'}]);
      assert.deepEqual((await pool.query('SELECT state,error_code,retryable FROM incident.command_receipt WHERE client_command_id=$1',[confirm.client_command_id])).rows,
        [{state:'FAILED',error_code:'P2_012_NOTIFICATION_FAILED',retryable:false}]);
      unavailable=false;
      const replay=await post(root+'/confirm',confirm);
      assert.deepEqual(replay,{status:503,body:{...first.body,replayed:true}});assert.equal(appends,2);assert.deepEqual(await counts(),before);
      const recovered=await post(root+'/confirm',{...confirm,client_command_id:randomUUID()});assert.equal(recovered.status,200);
      const id=recovered.body.result_ref_id,after=await counts();
      assert.deepEqual(after.slice(0,2),[1,4]);assert.equal(after[3],4);
      assert.deepEqual(after.slice(4,8),[3,3,3,3]);assert.equal(appends,5);
      const stateConflict=await post('/api/incidents/'+id+'/close',command());
      assert.equal(stateConflict.status,409);assert.equal(stateConflict.body.error.code,'P2_012_STATE_CONFLICT');
      const conflict=await post('/api/incidents/'+id+'/start-investigating',command('2'));
      assert.equal(conflict.status,409);assert.equal(conflict.body.error.code,'P2_012_VERSION_CONFLICT');
      assert.equal((await post('/api/incidents/'+randomUUID()+'/close',command())).status,404);
      assert.equal((await post('/api/incidents/'+id+'/close',{...command(),unexpected:true})).status,400);
      const get=async path=>{const response=await fetch(origin+path,{headers:{cookie}});return {status:response.status,body:await response.json()};};
      const subs=(await pool.query("SELECT id,direct_channel_leg_id FROM incident.reporter_subscription WHERE status='ACTIVE' ORDER BY id")).rows;
      assert.equal(subs.length,2);
      const nested=sub=>'/api/incidents/'+id+'/subscriptions/'+sub+'/direct-destinations';
      for(const sub of subs){
        const page=await get(nested(sub.id)+'?limit=1');assert.equal(page.status,200);
        assert.equal(page.body.items.length,1);assert.equal(page.body.items[0].id,sub.direct_channel_leg_id);
        assert.equal(page.body.items[0].subscription_id,sub.id);assert.equal(page.body.next_cursor,null);
        assert.deepEqual(Object.keys(page.body.items[0]).sort(),['id','source_intake_no','subscription_id']);
      }
      const broad=await get('/api/incidents/'+id+'/direct-destinations?limit=1');assert.equal(broad.status,200);assert.ok(broad.body.next_cursor);
      const next=await get('/api/incidents/'+id+'/direct-destinations?limit=1&cursor='+broad.body.next_cursor);
      assert.equal(next.status,200);assert.equal(next.body.items.length,1);assert.notEqual(next.body.items[0].subscription_id,broad.body.items[0].subscription_id);
      assert.equal((await get(nested(subs[0].id)+'?cursor='+broad.body.next_cursor)).status,400);
      for(const suffix of ['?limit=0','?limit=101','?cursor=bad'])assert.equal((await get(nested(subs[0].id)+suffix)).status,400);
      assert.equal((await get(nested(subs[0].id)+'?cursor='+'x'.repeat(2049))).status,414);
      assert.deepEqual(await get(nested(randomUUID())),{status:200,body:{items:[],next_cursor:null}});
      assert.equal((await get(nested(subs[0].id).replace(id,randomUUID()))).status,404);
      const otherCandidate=await f.newCandidate(4),otherRoot='/api/incident-candidates/'+otherCandidate.id;
      assert.equal((await post(otherRoot+'/start-review',command())).status,200);
      const other=await post(otherRoot+'/confirm',{...confirm,client_command_id:randomUUID(),selected_report_refs:f.reports.slice(4).map(r=>r.decisionId)});
      assert.equal(other.status,200);const otherId=other.body.result_ref_id;
      const otherSub=(await pool.query("SELECT id FROM incident.reporter_subscription WHERE incident_id=$1 AND status='ACTIVE'",[otherId])).rows[0].id;
      assert.deepEqual(await get(nested(otherSub)),{status:200,body:{items:[],next_cursor:null}});
      assert.deepEqual(await get(nested(subs[0].id).replace(id,otherId)),{status:200,body:{items:[],next_cursor:null}});
      await pool.query('UPDATE pilot_ticket.ticket SET assignee_id=$1 WHERE id=$2',[f.admin.id,f.reports[0].ticketId]);
      for(const role of ['DISPATCHER','HANDLER']){
        await pool.query('UPDATE pilot_ticket.pilot_principal_role SET role=$2 WHERE principal_id=$1',[f.admin.id,role]);
        assert.equal((await get(nested(subs[0].id))).status,403);
        assert.equal((await get('/api/incidents/'+id+'/direct-destinations')).status,403);
        assert.equal((await post('/api/incidents/'+id+'/close',command())).status,403);
      }
      await pool.query('DELETE FROM pilot_ticket.pilot_team_member WHERE principal_id=$1',[f.admin.id]);
      assert.equal((await get(nested(otherSub).replace(id,otherId))).status,404);
    }finally{await runtime.stop();}
    assert.equal(runtime.server.listening,false);
  }});
});
