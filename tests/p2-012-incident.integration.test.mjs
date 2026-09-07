import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createP2012IncidentCommandService } from '../src/p2-012-incident-command-service.mjs';
import { createP2012IncidentQuery } from '../src/p2-012-incident-query.mjs';
import { createP2012WorkbenchExtension } from '../src/p2-012-workbench-assembly.mjs';
import { createP2012NotificationPolicy } from '../src/p2-012-notification-policy.mjs';
import { withP2012Database,applyThrough031,apply032Raw,fixtureP2012,assertNoP2012Residual } from './helpers/p2-012-postgres-harness.mjs';
const databaseUrl=process.env.PILOT_DATABASE_URL;
const command=(action,id,version='1',extra={})=>({action,client_command_id:randomUUID(),reason_code:'OPERATOR_REVIEWED',
  ...(['START_REVIEW','REJECT_CANDIDATE','EXPIRE_CANDIDATE','CONFIRM_INCIDENT'].includes(action)?{candidate_review_id:id}:{incident_id:id}),
  ...(action==='CONFIRM_INCIDENT'?{expected_candidate_version:version}:{expected_row_version:version}),...extra});

test('P2-012 maintenance expires a bounded ordered batch through private SYSTEM commands without notifications',async()=>{
  await withP2012Database({databaseUrl,purpose:'p2012expiry',run:async({pool,databaseUrl})=>{
    await applyThrough031({pool,databaseUrl});await apply032Raw(pool);
    const f=await fixtureP2012(pool,{reporters:29}),authContext={principal_id:f.admin.id};
    const extension=()=>createP2012WorkbenchExtension({pool,featureFlags:{INCIDENT_CORRELATION_ENABLED:true}});
    const runtime=extension(),candidates=[];
    for(let i=0;i<29;i++)candidates.push(await f.newCandidate(i));
    assert.equal(Object.hasOwn(runtime,'maintenance'),false);
    await assert.rejects(runtime.commands.expireCandidate(command('EXPIRE_CANDIDATE',candidates[0].id)),{code:'P2_012_FORBIDDEN'});
    await assert.rejects(runtime.commands.perform({authContext,command:command('EXPIRE_CANDIDATE',candidates[0].id)}),{code:'P2_012_FORBIDDEN'});
    assert.equal((await runtime.commands.perform({authContext,command:command('START_REVIEW',candidates[26].id)})).ok,true);
    assert.equal((await runtime.commands.perform({authContext,command:command('REJECT_CANDIDATE',candidates[27].id)})).ok,true);
    assert.equal((await runtime.commands.perform({authContext,command:command('START_REVIEW',candidates[28].id)})).ok,true);
    assert.equal((await runtime.commands.perform({authContext,command:command('CONFIRM_INCIDENT',candidates[28].id,'2',{
      confirmed_scope:'LOCAL',owner_principal_id:f.admin.id,selected_report_refs:[f.reports[28].decisionId]})})).ok,true);
    await assert.rejects(createP2012IncidentCommandService({pool,enabled:true,maintenanceEnabled:true}).expireCandidate(command('START_REVIEW',candidates[0].id)),{code:'P2_012_FORBIDDEN'});
    await pool.query(`WITH clock AS MATERIALIZED (SELECT platform.physical_epoch_ms()-1000 AS expiry)
      UPDATE incident.candidate_review SET created_at=platform.local_now()-interval '2 days',
      expires_epoch_ms=clock.expiry,expires_at=platform.local_from_epoch_ms(clock.expiry)
      FROM clock WHERE id<>$1::uuid`,[candidates[25].id]);
    await pool.query("UPDATE incident.candidate_review SET row_version='9007199254740993'::bigint WHERE id=$1::uuid",[candidates[0].id]);
    const before=(await pool.query(`SELECT (SELECT count(*) FROM incident.incident)::int AS incidents,
      (SELECT count(*) FROM incident.incident_report)::int AS reports,(SELECT count(*) FROM incident.reporter_subscription)::int AS subscriptions,
      (SELECT count(*) FROM communication.message)::int AS messages,(SELECT count(*) FROM communication.outbox)::int AS outboxes,
      (SELECT count(*) FROM communication.delivery)::int AS deliveries`)).rows[0];
    const expected=(await pool.query("SELECT id FROM incident.candidate_review WHERE status='CANDIDATE' AND expires_epoch_ms<=platform.physical_epoch_ms() ORDER BY expires_epoch_ms,id LIMIT 20")).rows.map(r=>r.id);
    assert.equal((await runtime.runOnce()).expired,20);
    const actual=(await pool.query("SELECT aggregate_id AS id FROM conversation.realtime_event WHERE event_type='incident.candidate.expired' AND authorization_scope_type='SYSTEM' ORDER BY event_id")).rows.map(r=>r.id);
    assert.deepEqual(actual,expected);
    assert.equal((await extension().runOnce()).expired,5);
    assert.equal((await extension().runOnce()).expired,0);
    assert.equal((await pool.query('SELECT row_version::text FROM incident.candidate_review WHERE id=$1::uuid',[candidates[0].id])).rows[0].row_version,'9007199254740994');
    assert.equal((await runtime.commands.perform({authContext,command:command('START_REVIEW',candidates[0].id)})).error.code,'P2_012_VERSION_CONFLICT');
    const states=(await pool.query('SELECT status,count(*)::int AS n FROM incident.candidate_review GROUP BY status ORDER BY status')).rows;
    assert.deepEqual(states,[{status:'CANDIDATE',n:1},{status:'CONFIRMED',n:1},{status:'EXPIRED',n:25},{status:'REJECTED',n:1},{status:'UNDER_REVIEW',n:1}]);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM incident.command_receipt WHERE command_scope='P2_012:SYSTEM' AND state='COMMITTED' AND client_command_id=candidate_review_id")).rows[0].n,25);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM incident.incident_event WHERE event_type='candidate.expired' AND actor_kind='SYSTEM' AND safe_payload->>'reason_code'='MAINTENANCE_EXPIRED'")).rows[0].n,25);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM conversation.realtime_event WHERE event_type='incident.candidate.expired' AND authorization_scope_type='SYSTEM'")).rows[0].n,25);
    const after=(await pool.query(`SELECT (SELECT count(*) FROM incident.incident)::int AS incidents,
      (SELECT count(*) FROM incident.incident_report)::int AS reports,(SELECT count(*) FROM incident.reporter_subscription)::int AS subscriptions,
      (SELECT count(*) FROM communication.message)::int AS messages,(SELECT count(*) FROM communication.outbox)::int AS outboxes,
      (SELECT count(*) FROM communication.delivery)::int AS deliveries`)).rows[0];
    assert.deepEqual(after,before);
    assert.deepEqual(await createP2012WorkbenchExtension({pool:{query(){assert.fail('disabled scanned');}}}).runOnce(),{processed:0});
  }});await assertNoP2012Residual({databaseUrl});
});

test('P2-012 maintenance replays concurrent scans, handles human/time races and surfaces a still-due failure',async()=>{
  await withP2012Database({databaseUrl,purpose:'p2012race',run:async({pool,databaseUrl})=>{
    await applyThrough031({pool,databaseUrl});await apply032Raw(pool);
    const f=await fixtureP2012(pool,{reporters:4}),authContext={principal_id:f.admin.id};
    const expire=async id=>pool.query(`WITH clock AS MATERIALIZED(SELECT platform.physical_epoch_ms()-1000 AS expiry)
      UPDATE incident.candidate_review SET created_at=platform.local_now()-interval '2 days',expires_epoch_ms=clock.expiry,
        expires_at=platform.local_from_epoch_ms(clock.expiry) FROM clock WHERE id=$1::uuid`,[id]);
    const extension=p=>createP2012WorkbenchExtension({pool:p,featureFlags:{INCIDENT_CORRELATION_ENABLED:true}});
    const scannedPool=after=>({connect:()=>pool.connect(),query:async(sql,args)=>{
      const result=await pool.query(sql,args);
      if(sql.includes('SELECT id::text,row_version::text,expires_epoch_ms::text'))await after(result);
      return result;
    }});
    const candidate=await f.newCandidate();await expire(candidate.id);
    const barrier=Promise.withResolvers();let scans=0;
    const p=scannedPool(async result=>{assert.equal(result.rowCount,1);if(++scans===2)barrier.resolve();await barrier.promise;});
    const results=await Promise.all([extension(p).runOnce(),extension(p).runOnce()]);
    assert.equal(results.reduce((n,r)=>n+r.expired,0),1);
    assert.equal(results.reduce((n,r)=>n+r.expiration_replayed,0),1);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM incident.incident_event WHERE event_type='candidate.expired'")).rows[0].n,1);
    const humanCandidate=await f.newCandidate(1);
    await pool.query(`WITH clock AS MATERIALIZED(SELECT platform.physical_epoch_ms()+3000 AS expiry)
      UPDATE incident.candidate_review SET expires_epoch_ms=clock.expiry,expires_at=platform.local_from_epoch_ms(clock.expiry)
      FROM clock WHERE id=$1::uuid`,[humanCandidate.id]);
    const beforeCommit=Promise.withResolvers(),releaseCommit=Promise.withResolvers();
    const humanPool={query:(sql,args)=>pool.query(sql,args),connect:async()=>{const tx=await pool.connect();return {release:destroy=>tx.release(destroy),query:async(sql,args)=>{
      if(sql==='COMMIT'){beforeCommit.resolve();await releaseCommit.promise;}return tx.query(sql,args);
    }};}};
    const human=createP2012IncidentCommandService({pool:humanPool,enabled:true}).perform({authContext,command:command('START_REVIEW',humanCandidate.id)});
    try{
      await beforeCommit.promise;
      while(!(await pool.query('SELECT expires_epoch_ms<=platform.physical_epoch_ms() AS due FROM incident.candidate_review WHERE id=$1::uuid',[humanCandidate.id])).rows[0].due){
        await new Promise(resolve=>setTimeout(resolve,25));
      }
      const racePool=scannedPool(async result=>{assert.equal(result.rows[0].id,humanCandidate.id);releaseCommit.resolve();assert.equal((await human).ok,true);});
      assert.equal((await extension(racePool).runOnce()).expiration_race_lost,1);
    }finally{releaseCommit.resolve();await human;}
    assert.equal((await pool.query('SELECT status FROM incident.candidate_review WHERE id=$1::uuid',[humanCandidate.id])).rows[0].status,'UNDER_REVIEW');
    const timeCandidate=await f.newCandidate(2);await expire(timeCandidate.id);
    const timePool=scannedPool(async()=>pool.query(`WITH clock AS MATERIALIZED(SELECT platform.physical_epoch_ms()+86400000 AS expiry)
      UPDATE incident.candidate_review SET expires_epoch_ms=clock.expiry,expires_at=platform.local_from_epoch_ms(clock.expiry) FROM clock WHERE id=$1::uuid`,[timeCandidate.id]));
    assert.equal((await extension(timePool).runOnce()).expiration_race_lost,1);
    const failure=await f.newCandidate(3);await expire(failure.id);
    const failurePool=scannedPool(async()=>pool.query('UPDATE incident.candidate_review SET row_version=row_version+1 WHERE id=$1::uuid',[failure.id]));
    await assert.rejects(extension(failurePool).runOnce(),{code:'P2_012_COMMAND_FAILED'});
    assert.equal((await pool.query('SELECT status FROM incident.candidate_review WHERE id=$1::uuid',[failure.id])).rows[0].status,'CANDIDATE');
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM incident.command_receipt WHERE state='COMMITTED' AND command_type='EXPIRE_CANDIDATE'")).rows[0].n,1);
    await assert.rejects(extension(scannedPool(async()=>{throw new Error('SYNTHETIC_SCAN_FAILURE');})).runOnce(),/SYNTHETIC_SCAN_FAILURE/u);
  }});await assertNoP2012Residual({databaseUrl});
});

test('P2-012 maintenance scans after import and expires an imported due candidate in the same iteration',async()=>{
  await withP2012Database({databaseUrl,purpose:'p2012impdue',run:async({pool,databaseUrl})=>{
    await applyThrough031({pool,databaseUrl});await apply032Raw(pool);
    const f=await fixtureP2012(pool,{reporters:1});
    await f.sourceAdapter.record({sourceDecisionId:f.reports[0].decisionId,candidate:f.candidate,reportDecisionIds:[f.reports[0].decisionId]});
    // Model the clock boundary at the import transaction, using real rows and constraints.
    const importPool={query:(sql,args)=>pool.query(sql,args),connect:async()=>{const tx=await pool.connect();return {
      release:destroy=>tx.release(destroy),query:async(sql,args)=>{
        const result=await tx.query(sql,args);
        if(sql.startsWith('SELECT id::text,status,row_version::text FROM incident.candidate_review WHERE candidate_key')){
          await tx.query(`WITH clock AS MATERIALIZED(SELECT platform.physical_epoch_ms()-1000 AS expiry)
            UPDATE incident.candidate_review SET created_at=platform.local_now()-interval '2 days',expires_epoch_ms=clock.expiry,
              expires_at=platform.local_from_epoch_ms(clock.expiry) FROM clock WHERE id=$1::uuid`,[result.rows[0].id]);
        }
        return result;
      },
    };}};
    const result=await createP2012WorkbenchExtension({pool:importPool,featureFlags:{INCIDENT_CORRELATION_ENABLED:true}}).runOnce();
    assert.equal(result.imported,1);assert.equal(result.expired,1);
    assert.equal((await pool.query('SELECT status,row_version::text FROM incident.candidate_review')).rows[0].status,'EXPIRED');
    assert.equal((await pool.query('SELECT row_version::text FROM incident.candidate_review')).rows[0].row_version,'2');
  }});await assertNoP2012Residual({databaseUrl});
});

test('P2-012 real database human confirmation, idempotency, recovery isolation and notification facts',async()=>{
  assert.ok(databaseUrl,'database required');
  await withP2012Database({databaseUrl,purpose:'p2012core',run:async({pool,databaseUrl})=>{
    await applyThrough031({pool,databaseUrl});await apply032Raw(pool);
    const f=await fixtureP2012(pool),query=createP2012IncidentQuery({pool,enabled:true}),authContext={principal_id:f.admin.id};
    const notifications=createP2012NotificationPolicy({enabled:true,publicEnabled:true,privateEnabled:true});
    const service=createP2012IncidentCommandService({pool,enabled:true,query,notifications});
    const run=c=>service.perform({authContext,command:c});
    const c=await f.newCandidate();assert.equal((await f.newCandidate()).created,false);
    assert.equal((await pool.query('SELECT count(*)::integer AS n FROM incident.incident')).rows[0].n,0);
    await assert.rejects(createP2012IncidentCommandService({pool}).perform({authContext,command:command('START_REVIEW',c.id)}),{code:'P2_012_DISABLED'});
    await assert.rejects(service.perform({authContext:{principal_id:f.handler.id},command:command('START_REVIEW',c.id)}),{code:'P2_012_FORBIDDEN'});
    assert.equal((await run(command('START_REVIEW',c.id))).ok,true);
    const confirm=command('CONFIRM_INCIDENT',c.id,'2',{confirmed_scope:'LOCAL',owner_principal_id:f.admin.id,selected_report_refs:f.reports.map(r=>r.decisionId)});
    const results=await Promise.all(Array.from({length:12},()=>run(confirm)));
    assert.ok(results.every(r=>r.ok),JSON.stringify(results));assert.equal(results.filter(r=>!r.replayed).length,1);
    const id=results[0].result_ref_id;
    await assert.rejects(run({...confirm,confirmed_scope:'BUILDING'}),{code:'P2_012_COMMAND_CONFLICT'});
    const rows=async sql=>(await pool.query(sql)).rows;
    assert.equal((await rows('SELECT count(*)::integer AS n FROM incident.incident'))[0].n,1);
    assert.equal((await rows('SELECT count(*)::integer AS n FROM incident.incident_report'))[0].n,10);
    assert.equal((await rows('SELECT count(*)::integer AS n FROM incident.reporter_subscription'))[0].n,10);
    assert.equal((await rows('SELECT count(*)::integer AS n FROM communication.incident_notification_binding'))[0].n,6);
    assert.equal((await run(confirm)).replayed,true);
    assert.equal((await rows('SELECT count(*)::integer AS n FROM communication.message'))[0].n,6);
    assert.equal((await query.list({authContext,kind:'candidate'})).items[0].status,'CONFIRMED');
    await assert.rejects(query.detail({authContext:{principal_id:f.outsider.id},id}),{code:'P2_012_NOT_FOUND'});
    assert.equal((await run(command('CLOSE_INCIDENT',id))).ok,false);
    assert.equal((await run(command('START_INVESTIGATING',id))).ok,true);
    let incident=await query.detail({authContext,id});assert.equal(incident.status,'INVESTIGATING');
    const reports=(await query.children({authContext,id,part:'reports'})).items;
    assert.equal((await run(command('MARK_REPORTER_RECOVERED',id,incident.row_version,{incident_report_id:reports[0].id,expected_report_version:reports[0].row_version}))).ok,true);
    incident=await query.detail({authContext,id});assert.equal(incident.status,'INVESTIGATING');
    const impact=await rows("SELECT impact_state,count(*)::integer AS n FROM incident.incident_report GROUP BY impact_state ORDER BY impact_state");
    assert.deepEqual(impact,[{impact_state:'IMPACTED',n:9},{impact_state:'RECOVERED',n:1}]);
    assert.equal((await rows("SELECT count(*)::integer AS n FROM pilot_ticket.ticket WHERE status='QUEUED'"))[0].n,10);
    assert.equal((await run(command('SET_PRIMARY_TICKET',id,incident.row_version,{primary_ticket_id:reports[1].ticket_id}))).ok,true);
    incident=await query.detail({authContext,id});
    assert.equal((await run(command('UNLINK_REPORT',id,incident.row_version,{incident_report_id:reports[1].id,expected_report_version:reports[1].row_version}))).error.code,'P2_012_PRIMARY_STILL_LINKED');
    assert.equal((await run(command('SET_PRIMARY_TICKET',id,incident.row_version,{primary_ticket_id:null}))).ok,true);
    incident=await query.detail({authContext,id});
    assert.equal((await run(command('UNLINK_REPORT',id,incident.row_version,{incident_report_id:reports[1].id,expected_report_version:reports[1].row_version}))).ok,true);
    assert.equal((await rows('SELECT count(*)::integer AS n FROM pilot_ticket.ticket'))[0].n,10);
    assert.equal((await rows('SELECT count(*)::integer AS n FROM intake.service_intake'))[0].n,10);
    for(const action of ['RESOLVE_INCIDENT','CLOSE_INCIDENT']){incident=await query.detail({authContext,id});assert.equal((await run(command(action,id,incident.row_version))).ok,true);}
    incident=await query.detail({authContext,id});assert.equal(incident.status,'CLOSED');
    assert.equal((await run(command('START_INVESTIGATING',id,incident.row_version))).ok,false);
    assert.equal((await rows("SELECT count(*)::integer AS n FROM pilot_ticket.ticket WHERE status='QUEUED'"))[0].n,10);
    const other=await f.newCandidate(1);assert.notEqual(other.id,c.id);
    assert.equal((await run(command('REJECT_CANDIDATE',other.id))).ok,true);
    assert.equal((await rows('SELECT count(*)::integer AS n FROM incident.incident'))[0].n,1);
  }});
  await assertNoP2012Residual({databaseUrl});
});
