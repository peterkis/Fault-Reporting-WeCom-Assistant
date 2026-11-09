import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {withT32Fixture,t32Record,t32Text,seedCard21Exceptions,seedN3SessionProfile} from './helpers/t32-notification-exception-fixture.mjs';
import type {T32Fixture} from './helpers/t32-notification-exception-fixture.mjs';
import type {PostgresPoolClient,PostgresQuery} from '../app/server/src/platform/postgres-pool.mjs';
import {createPilotAccessService} from '../app/server/src/p1-009-pilot-access-workbench.mjs';
import {createWorkbenchNotificationExceptions} from '../app/server/src/workbench-notification-exceptions.mjs';
import {createP2016TicketQuery} from '../app/server/src/p2-016-ticket-query.mjs';
import {createWeComWorkbenchAuthentication} from '../app/server/src/p2-016-workbench-wecom-auth.mjs';
import {migrateWorkbenchAuth} from '../app/server/scripts/p2-016-workbench-auth-migrate.mjs';
import {createCommunicationDeliveryWorker} from '../app/server/src/p2-004-communication-delivery-worker.mjs';
import {createCommunicationSenderPort} from '../app/server/src/p2-004-communication-sender-port.mjs';

test('T32 Session failures and UNKNOWN use independent current VIEW and real controls without raw message content',{timeout:240000},async()=>{
  await withT32Fixture(async f=>{
    const session=(await f.pool.query<{id:string}>('SELECT id::text FROM conversation.session WHERE service_intake_id=$1::uuid',[f.tickets[0]?.intake.intakeId])).rows[0];assert.ok(session);
    const path='/api/conversations/'+session.id;
    assert.equal((await f.get(path,0)).status,200);assert.equal((await f.get(path,2)).status,404);
    const current=(await f.get(path)).body;
    const takeover=await f.post(path+'/takeover',{client_command_id:randomUUID(),expected_row_version:t32Record(current.session).row_version});assert.equal(takeover.status,200,JSON.stringify(takeover.body));
    const deliveryIds:string[]=[];let senderCalls=0;
    for(const unknown of [false,true]){
      const detail=(await f.get(path)).body;
      const response=await f.post(path+'/messages',{client_command_id:randomUUID(),expected_row_version:t32Record(detail.session).row_version,text:'T32_PRIVATE_REPLY_CANARY',message_type:'text'});
      assert.equal(response.status,202,JSON.stringify(response.body));assert.ok(Array.isArray(response.body.delivery_ids));const id=t32Text(response.body.delivery_ids[0]);deliveryIds.push(id);
      const worker=createCommunicationDeliveryWorker({pool:f.pool,enabled:true,sender:createCommunicationSenderPort(()=>{senderCalls++;return {outcome:unknown?'UNKNOWN':'REJECTED_NOT_APPLIED',provider_message_id:null,error_code:'T32_RAW_ERROR_CANARY',retryable:false};})});
      assert.ok(await worker.deliver({deliveryId:id}));
    }
    const response=await f.get('/api/notification-exceptions?domain=SESSION');assert.equal(response.status,200);
    assert.ok(Array.isArray(response.body.items));assert.equal(response.body.items.length,2,'actual Session facts must be queried before bounded pagination');
    const rows=response.body.items.map(t32Record),failed=rows.find(row=>row.status==='DEAD_LETTER'),unknown=rows.find(row=>row.status==='RECONCILIATION_REQUIRED');assert.ok(failed&&unknown);
    assert.equal(failed.parent_id,session.id);assert.equal(failed.source_kind,'SESSION_MESSAGE');assert.deepEqual(failed.allowed_actions,['RETRY']);assert.deepEqual(unknown.allowed_actions,['RECONCILE']);assert.equal(unknown.error_code,'RESULT_UNCONFIRMED');
    assert.equal((await f.get('/api/notification-exceptions/session/'+session.id+'/'+deliveryIds[0],2)).status,404);
    const other=(await f.pool.query<{id:string}>('SELECT id::text FROM conversation.session WHERE id<>$1::uuid ORDER BY id LIMIT 1',[session.id])).rows[0];assert.ok(other);
    assert.equal((await f.get('/api/notification-exceptions/session/'+other.id+'/'+deliveryIds[0])).status,404);
    const denied=await f.get('/api/notification-exceptions?domain=SESSION',2);assert.deepEqual(denied.body,{items:[],has_more:false,next_cursor:null});
    const one=await f.get('/api/notification-exceptions?domain=SESSION&limit=1');assert.equal(one.body.has_more,true);const cursor=t32Text(one.body.next_cursor);
    assert.equal((await f.get('/api/notification-exceptions?domain=SESSION&limit=1&cursor='+encodeURIComponent(cursor),1)).status,400);
    assert.equal((await f.get('/api/notification-exceptions?domain=TICKET&limit=1&cursor='+encodeURIComponent(cursor))).status,400);
    assert.equal((await f.get('/api/notification-exceptions?domain=SESSION&state=UNKNOWN')).body.items instanceof Array,true);
    const unknownOnly=(await f.get('/api/notification-exceptions?domain=SESSION&state=UNKNOWN')).body;assert.ok(Array.isArray(unknownOnly.items));assert.equal(unknownOnly.items.length,1);
    const member=await f.get('/api/notification-exceptions?domain=SESSION',1);assert.ok(Array.isArray(member.body.items));const memberUnknown=member.body.items.map(t32Record).find(row=>row.status==='RECONCILIATION_REQUIRED');assert.ok(memberUnknown);assert.deepEqual(memberUnknown.allowed_actions,[],'Session VIEW does not confer ADMIN reconciliation');
    assert.equal(/T32_PRIVATE_REPLY_CANARY|T32_RAW_ERROR_CANARY|target_id|target_hash|provider_message|binding_hash/u.test(JSON.stringify(response.body)),false);
    assert.equal(senderCalls,2);
  });
});

function observeExceptionQueries(f:T32Fixture){
  const originals=new Map<PostgresPoolClient,PostgresQuery>();let count=0,finals=0,beforeFinal:(()=>Promise<void>)|null=null;
  const listener=(client:PostgresPoolClient)=>{
    if(originals.has(client))return;const original=client.query;originals.set(client,original);
    client.query=new Proxy(original,{apply(target,receiver,args){
      const sql=typeof args[0]==='string'?args[0]:'';count++;
      if(sql.includes('N3_SOURCE_DISPLAY_FINAL')){finals++;const wait=beforeFinal;beforeFinal=null;if(wait)return wait().then(()=>Reflect.apply(target,receiver,args));}
      return Reflect.apply(target,receiver,args);
    }});
  };
  f.pool.on('acquire',listener);
  return {reset(){count=0;finals=0;},counts:()=>({count,finals}),wait(callback:()=>Promise<void>){beforeFinal=callback;},close(){f.pool.off('acquire',listener);for(const [client,original] of originals)client.query=original;}};
}

test('N3 projects current Ticket facts and only retained identity-bound Session names with constant query count',{timeout:240000},async()=>{
 await withT32Fixture(async f=>{
  const seed=await seedCard21Exceptions(f),calls=seed.senderCalls(),path='/api/notification-exceptions';
  const initial=await f.get(path);assert.equal(initial.status,200);assert.ok(Array.isArray(initial.body.items));assert.ok(initial.body.items.map(t32Record).filter(row=>row.domain==='SESSION').every(row=>row.reporter_name===null));
  const journey=await seedN3SessionProfile(f,seed.sessionId),page=await f.get(path);assert.equal(page.status,200);assert.ok(Array.isArray(page.body.items));const rows=page.body.items.map(t32Record);
  for(const row of rows){
   if(row.domain==='TICKET'){const ticket=(await f.pool.query<{ticket_no:string;title:string}>('SELECT ticket_no,title FROM pilot_ticket.ticket WHERE id=$1::uuid',[row.parent_id])).rows[0];assert.ok(ticket);assert.equal(row.ticket_no,ticket.ticket_no);assert.equal(row.ticket_title,ticket.title);assert.equal(row.reporter_name,null);}
   else{assert.equal(row.ticket_no,null);assert.equal(row.ticket_title,null);assert.equal(row.reporter_name,'欧阳慧敏（合成）');}
   const item=await f.get(path+'/'+t32Text(row.domain).toLowerCase()+'/'+t32Text(row.parent_id)+'/'+t32Text(row.delivery_id));assert.equal(item.status,200);assert.deepEqual(item.body,row);
  }
  const observer=observeExceptionQueries(f);
  try{observer.reset();assert.equal((await f.get(path+'?limit=1')).status,200);const one=observer.counts();observer.reset();assert.equal((await f.get(path+'?limit=50')).status,200);assert.deepEqual(observer.counts(),one);assert.equal(one.finals,1);console.log('N3_QUERY_BUDGET '+JSON.stringify(one));}finally{observer.close();}
  const ticket=rows.find(row=>row.domain==='TICKET'&&row.parent_id!==f.tickets[0]?.ticket.id);assert.ok(ticket);
  await f.pool.query("UPDATE pilot_ticket.ticket SET status='COMPLETED' WHERE id=$1::uuid",[ticket.parent_id]);
  await f.pool.query("WITH stamp AS(SELECT platform.physical_epoch_ms()-1 AS epoch) UPDATE intake.service_intake i SET retention_until_epoch_ms=stamp.epoch,retention_until=platform.local_from_epoch_ms(stamp.epoch) FROM stamp,pilot_ticket.ticket t WHERE t.source_intake_id=i.id AND t.id=$1::uuid",[ticket.parent_id]);
  const retained=await f.get(path+'/ticket/'+t32Text(ticket.parent_id)+'/'+t32Text(ticket.delivery_id));assert.equal(retained.status,200);assert.equal(retained.body.ticket_no,ticket.ticket_no);assert.equal(retained.body.ticket_title,ticket.ticket_title);
  const session=rows.find(row=>row.domain==='SESSION');assert.ok(session);const sessionPath=path+'/session/'+seed.sessionId+'/'+t32Text(session.delivery_id);
  await f.pool.query("UPDATE intake.contact_journey SET profile_resolution_status='DEFERRED' WHERE id=$1::uuid",[journey]);assert.equal((await f.get(sessionPath)).body.reporter_name,null);
  await f.pool.query("UPDATE intake.contact_journey SET profile_resolution_status='RESOLVED' WHERE id=$1::uuid",[journey]);
  await assert.rejects(f.pool.query(`INSERT INTO intake.channel_leg(journey_id,source_intake_id,leg_type,leg_ordinal,conversation_thread_id,conversation_session_id,provider_context_hash,channel_identity_hash,reporter_identity_hash,opened_at)
    SELECT journey_id,source_intake_id,leg_type,leg_ordinal,conversation_thread_id,conversation_session_id,provider_context_hash,channel_identity_hash,reporter_identity_hash,opened_at FROM intake.channel_leg WHERE journey_id=$1::uuid`,[journey]),error=>Boolean(error&&typeof error==='object'&&'code' in error&&error.code==='23505'),'the real schema refuses an ambiguous second Journey/Leg binding');
  const source=(await f.pool.query<{reporter:string;until_epoch:string}>('SELECT i.reporter_wecom_userid AS reporter,j.retention_until_epoch_ms::text AS until_epoch FROM intake.contact_journey j JOIN intake.service_intake i ON i.id=j.origin_intake_id WHERE j.id=$1::uuid',[journey])).rows[0];assert.ok(source);
  await f.pool.query("UPDATE intake.service_intake SET reporter_wecom_userid='N3_PRIVATE_WRONG_IDENTITY' WHERE id=(SELECT origin_intake_id FROM intake.contact_journey WHERE id=$1::uuid)",[journey]);const wrong=await f.get(sessionPath);assert.equal(wrong.status,200);assert.equal(wrong.body.reporter_name,null);assert.doesNotMatch(JSON.stringify(wrong.body),/N3_PRIVATE_WRONG_IDENTITY/u);
  await f.pool.query('UPDATE intake.service_intake SET reporter_wecom_userid=$2 WHERE id=(SELECT origin_intake_id FROM intake.contact_journey WHERE id=$1::uuid)',[journey,source.reporter]);
  // Keep the synthetic report strictly before the expired second-precision retention boundary.
  await f.pool.query('WITH stamp AS(SELECT platform.physical_epoch_ms()-1 AS epoch) UPDATE intake.contact_journey j SET reported_at=LEAST(j.reported_at,platform.local_from_epoch_ms(stamp.epoch-1000)),retention_until_epoch_ms=stamp.epoch,retention_until=platform.local_from_epoch_ms(stamp.epoch) FROM stamp WHERE j.id=$1::uuid',[journey]);assert.equal((await f.get(sessionPath)).body.reporter_name,null);
  assert.equal(seed.senderCalls(),calls);assert.doesNotMatch(JSON.stringify(page.body),/T32_PRIVATE_SESSION_CANARY|target_id|target_hash|profile_snapshot|participant_key|binding_hash/u);
 });
});

test('N3 final batch consumes the official stored-session proof after a projection wait',{timeout:240000},async()=>{
 await withT32Fixture(async f=>{
  await seedCard21Exceptions(f);const migration={databaseUrl:f.databaseUrl,mode:'apply'};await migrateWorkbenchAuth(migration);
  const auth=createWeComWorkbenchAuthentication({pool:f.pool,publicOrigin:'https://127.0.0.1:'+new URL(f.origin).port,corpId:'ww-n3-synthetic',agentId:'1000001',identityHashKey:'n3-synthetic-identity-key',accessTokenProvider:async()=> 'n3-synthetic-token',fetchImpl:async(input,init)=>{
    const url=new URL(String(input));assert.equal(url.origin,'https://qyapi.weixin.qq.com');assert.equal(url.pathname,'/cgi-bin/batch/userid_to_openuserid');assert.equal(typeof init?.body,'string');const body=t32Record(JSON.parse(String(init?.body)));assert.ok(Array.isArray(body.userid_list));return new Response(JSON.stringify({errcode:0,open_userid_list:body.userid_list.map(user=>({userid:t32Text(user),open_userid:'open-'+t32Text(user)}))}),{headers:{'content-type':'application/json'}});
  }});
  try{
   await auth.initialize();const principal=f.principals[0];assert.ok(principal);const now=Date.now(),expires=String(now+3600000),hash=(text:string)=>createHash('sha256').update(text).digest('hex');
   const stored=(await f.pool.query<{id:string}>(`INSERT INTO pilot_ticket.workbench_auth_session(session_token_hash,csrf_token_hash,principal_id,identity_hash,created_at,created_epoch_ms,last_seen_at,last_seen_epoch_ms,expires_epoch_ms,expires_at)
    VALUES($1,$2,$3::uuid,$4,platform.local_from_epoch_ms($5),$5,platform.local_from_epoch_ms($5),$5,$6,platform.local_from_epoch_ms($6)) RETURNING session_id::text AS id`,[hash('n3-synthetic-cookie'),hash('n3-synthetic-csrf'),principal.id,hash('n3-synthetic-identity'),now,expires])).rows[0];assert.ok(stored);
   const context={principal_id:principal.id,auth_method:'COOKIE',session_id:stored.id,expires_epoch_ms:expires},endpoint=createWorkbenchNotificationExceptions({pool:f.pool,query:createP2016TicketQuery({pool:f.pool,enabled:true}),enabled:true,currentSessionPredicate:auth.currentSessionPredicate}),url=new URL(f.origin+'/api/notification-exceptions?domain=TICKET');
   assert.ok((await endpoint.list(context,url)).items.length>0);
   const observer=observeExceptionQueries(f);let reached=()=>{},release=()=>{};const ready=new Promise<void>(resolve=>{reached=resolve;}),proceed=new Promise<void>(resolve=>{release=resolve;});observer.wait(async()=>{reached();await proceed;});const pending=endpoint.list(context,url);
   try{
    await Promise.race([ready,pending.then(()=>{throw Error('N3_FINAL_QUERY_NOT_REACHED');})]);
    await f.pool.query("WITH stamp AS(SELECT platform.physical_epoch_ms() AS epoch) UPDATE pilot_ticket.workbench_auth_session SET state='REVOKED',revoked_epoch_ms=stamp.epoch,revoked_at=platform.local_from_epoch_ms(stamp.epoch) FROM stamp WHERE session_id=$1::uuid",[stored.id]);
    release();await assert.rejects(pending,error=>error instanceof Error&&'status' in error&&error.status===401);
   }finally{release();await pending.catch(()=>undefined);observer.close();}
  }finally{await auth.close();}
 });
});

test('N3 final batch rejects changed roles or teams and rechecks the n+1 parent before exposing a continuation',{timeout:240000},async()=>{
 for(const mode of ['roles','teams','parent'] as const)await withT32Fixture(async f=>{
  const seed=await seedCard21Exceptions(f),access=createPilotAccessService({pool:f.pool}),handler=f.principals[1];assert.ok(handler);
  if(mode!=='roles')await access.upsertPrincipal({wecomUserId:'web01-synthetic-1',displayName:'N3处理人（合成）',roles:['HANDLER'],resolverTeamIds:['PILOT_IT']});
  const actor=mode==='roles'?0:1,path='/api/notification-exceptions?domain=TICKET&limit=1',initial=await f.get(path,actor);assert.equal(initial.status,200);assert.equal(initial.body.has_more,true);
  const ordered=(await f.pool.query<{id:string}>('SELECT b.ticket_id::text AS id FROM communication.ticket_notification_binding b JOIN communication.delivery d ON d.id=b.delivery_id ORDER BY d.created_at DESC,d.id DESC LIMIT 2')).rows;assert.equal(ordered.length,2);const lookahead=ordered[1];assert.ok(lookahead);
  const observer=observeExceptionQueries(f);let reached=()=>{},release=()=>{};const ready=new Promise<void>(resolve=>{reached=resolve;}),proceed=new Promise<void>(resolve=>{release=resolve;});observer.wait(async()=>{reached();await proceed;});
  const pending=f.get(path,actor);
  try{
   await Promise.race([ready,pending.then(()=>{throw Error('N3_FINAL_QUERY_NOT_REACHED');})]);
   if(mode==='roles')await access.upsertPrincipal({wecomUserId:'web01-synthetic-0',displayName:'N3角色变化（合成）',roles:['HANDLER'],resolverTeamIds:['PILOT_IT']});
   else if(mode==='teams')await access.upsertPrincipal({wecomUserId:'web01-synthetic-1',displayName:'N3团队变化（合成）',roles:['HANDLER'],resolverTeamIds:[]});
   else{await f.pool.query("INSERT INTO pilot_ticket.resolver_team(team_id,display_name) VALUES('N3_HIDDEN_SYNTHETIC','N3隔离组（合成）')");await f.pool.query("UPDATE pilot_ticket.ticket SET resolver_team_id='N3_HIDDEN_SYNTHETIC',assignee_id=NULL WHERE id=$1::uuid",[lookahead.id]);}
   release();const result=await pending;assert.equal(result.status,mode==='parent'?404:403,mode);assert.equal(Object.hasOwn(result.body,'items'),false);assert.doesNotMatch(JSON.stringify(result.body),/IT-[0-9]|ticket_title|reporter_name|next_cursor/u);assert.equal(seed.senderCalls()>0,true);
  }finally{release();await pending.catch(()=>undefined);observer.close();}
 });
});
