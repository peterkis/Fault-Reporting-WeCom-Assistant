import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {seedPersistedIntake} from './helpers/p2-015-postgres-harness.mjs';
import {createP2G1InboundProjectionCoordinator,P2_G1_PROJECTION_STREAMS} from '../app/server/src/p2-g1-inbound-projection-coordinator.mjs';
import {createConversationControlService,createPilotConversationControlAuthorization} from '../app/server/src/p2-005-conversation-control.mjs';
import {appendRealtimeEvent} from '../app/server/src/p2-003-realtime-event-log.mjs';
import {migrateWorkbenchSourceGroups} from '../app/server/scripts/workbench-source-groups-migrate.mjs';
test('WEB01 real HTTP: scope, duplicate review, natural-day completion range, keyset and protected static',async()=>{
  await withWeb01Fixture(async({origin,cookies,tickets,waiting,pool,principals,databaseUrl})=>{
    const get=(path,index=0)=>fetch(origin+path,{headers:{cookie:cookies[index]}});
    assert.equal((await fetch(origin+'/api/workbench/board')).status,401);
    assert.equal((await fetch(origin+'/workbench/app/')).status,401);
    assert.equal((await fetch(origin+'/api/workbench/board',{headers:{cookie:'yxx_member_session=synthetic-reporter'}})).status,401);
    const read=async path=>{const response=await get(path);assert.equal(response.status,200,await response.clone().text());return response.json();};
    const bootstrap=await read('/api/lifecycle/bootstrap');assert.equal(bootstrap.principal_id,principals[0].id);
    assert.equal(bootstrap.source_group_directory_enabled,false);
    assert.equal((await get('/api/workbench/source-groups')).status,503);
    assert.equal((await migrateWorkbenchSourceGroups({databaseUrl,mode:'check'})).status,'PENDING');
    assert.equal((await pool.query("SELECT to_regclass('workbench.source_group_name')::text AS name")).rows[0].name,null);
    const pending=await read('/api/workbench/board?column=pending');
    assert.equal(pending.items.length,7);assert.equal(pending.items.filter(i=>i.intake_id===tickets[0].intake.intakeId).length,1);
    assert.ok(pending.items.some(i=>i.kind==='intake'&&i.id===waiting.intakeId&&i.status==='WAITING_DESCRIPTION'));
    assert.equal(pending.items.find(i=>i.id===waiting.intakeId).priority,null);
    assert.equal((await get('/api/workbench/items/intake/'+waiting.intakeId,1)).status,404);
    assert.ok((await read('/api/workbench/items/intake/'+waiting.intakeId)).records.some(r=>r.audience==='REPORT'));
    assert.equal(pending.items.find(i=>i.id===tickets[0].ticket.id).kind,'ticket');assert.ok(pending.items.some(i=>i.kind==='review'));
    assert.ok(pending.items.filter(i=>i.kind==='ticket').every(i=>i.created_at<pending.range.from)); // Old nonterminal Tickets remain visible.
    const first=await read('/api/workbench/board?column=pending&limit=2');assert.ok(first.next_cursor);
    const second=await read('/api/workbench/board?column=pending&limit=2&cursor='+first.next_cursor);
    assert.equal(new Set([...first.items,...second.items].map(i=>i.kind+i.id)).size,4);
    assert.equal((await get('/api/workbench/board?column=active&cursor='+first.next_cursor)).status,400);
    assert.equal((await get('/api/workbench/board?column=pending&limit=101')).status,400);
    const closed=await read('/api/workbench/board?column=closed');assert.equal(closed.items.length,4);
    await pool.query('UPDATE pilot_ticket.ticket SET updated_at=platform.local_now() WHERE id=$1::uuid',[tickets[11].ticket.id]);
    const closingFirst=await read('/api/workbench/board?column=closed&limit=1');
    assert.equal(closingFirst.items[0].id,tickets[9].ticket.id);
    const closingNext=await read('/api/workbench/board?column=closed&limit=1&cursor='+closingFirst.next_cursor);
    assert.equal(closingNext.items[0].id,tickets[10].ticket.id);
    const resolved=closed.items.find(i=>i.status==='RESOLVED');assert.ok(resolved);assert.equal(resolved.completed_at,null);
    await pool.query("UPDATE pilot_ticket.ticket_event SET created_at=date_trunc('day',platform.local_now())-interval '2 days' WHERE ticket_id=$1::uuid AND event_type='ticket.closed'",[tickets[9].ticket.id]);
    assert.equal((await read('/api/workbench/board?column=closed')).items.length,3);
    assert.equal((await read('/api/workbench/board?column=closed&range=all')).items.length,4);
    const commandId=randomUUID();
    const cancelled=await fetch(origin+'/api/tickets/'+tickets[0].ticket.id+'/cancel',{method:'POST',headers:{cookie:cookies[0],origin,'content-type':'application/json','x-csrf-token':bootstrap.csrf_token,'idempotency-key':commandId,'if-match':'"2"'},body:JSON.stringify({client_command_id:commandId,expected_version:2,reason_code:'WEB01_SYNTHETIC_CANCEL'})});
    assert.equal(cancelled.status,200,await cancelled.clone().text());
    assert.ok((await read('/api/workbench/board?column=closed&range=all')).items.every(i=>i.status!=='CANCELLED'));
    const cancellationView=await read('/api/workbench/board?column=closed&range=cancelled');
    assert.equal(cancellationView.items.length,1);assert.equal(cancellationView.items[0].status,'CANCELLED');
    const separateReview=pending.items.find(i=>i.kind==='review');
    await pool.query('UPDATE intake.contact_journey SET linked_ticket_id=$1::uuid WHERE id=(SELECT journey_id FROM intake.manual_review_item WHERE id=$2::uuid)',[tickets[5].ticket.id,separateReview.id]);
    assert.ok((await read('/api/workbench/board?column=active')).items.find(i=>i.id===tickets[5].ticket.id).review_reason);
    assert.ok((await read('/api/workbench/board?column=pending')).items.every(i=>i.id!==separateReview.id));
    const outsider=await get('/api/workbench/board?column=pending',1);assert.equal(outsider.status,200);assert.equal((await outsider.json()).items.length,0);
    const path='/api/workbench/items/ticket/'+tickets[5].ticket.id;
    assert.equal((await get(path,1)).status,404);
    const detail=await read(path);assert.ok(detail.records.some(r=>r.text==='仅供内部的合成处理记录'&&r.audience==='INTERNAL'));assert.ok(detail.records.some(r=>r.audience==='REPORT'));assert.equal(detail.item.title,'住院部西区无线网络频繁断开');
    assert.ok(detail.records.some(r=>r.audience==='REPORT'&&r.text?.includes('尚待判断的合成材料')));
    const shell=await get('/workbench/app/items/ticket/'+tickets[5].ticket.id);assert.equal(shell.status,200);assert.match(shell.headers.get('content-security-policy'),/script-src 'self'; style-src 'self'/u);
    assert.equal((await get('/workbench/app?view=list')).status,200);
    assert.equal((await get('/workbench/app/settings/source-groups')).status,200);
    assert.equal((await get('/workbench/app/settings/unavailable')).status,404);
    assert.equal((await fetch(origin+'/workbench/app/settings/source-groups')).status,401);
    assert.equal((await fetch(origin+'/workbench/app?view=list')).status,401);
    const html=await shell.text(),asset=html.match(/src="([^"]+\.js)"/u)?.[1];assert.ok(asset);assert.equal((await get(asset)).status,200);
    const stylesheet=html.match(/href="([^"]+\.css)"/u)?.[1];assert.ok(stylesheet);
    const css=await (await get(stylesheet)).text(),fonts=[...css.matchAll(/url\(["']?(\/workbench\/app\/assets\/[^"')]+\.woff2)["']?\)/gu)].map(match=>match[1]);
    assert.equal(new Set(fonts).size,99,'F1 all unicode-range shards remain separate local files');assert.equal(/url\(["']?data:font/iu.test(css),false);
    const font=fonts[0];assert.ok(font);assert.equal((await fetch(origin+font)).status,401,'font asset retains current workbench authentication');
    const fontResponse=await get(font);assert.equal(fontResponse.status,200);assert.equal(fontResponse.headers.get('content-type'),'font/woff2');assert.equal(Buffer.from(await fontResponse.arrayBuffer()).subarray(0,4).toString(),'wOF2');
    assert.equal((await get('/workbench/app/assets/unknown.woff2')).status,404,'unmanifested font stays rejected');
    assert.equal((await get('/workbench/app/assets/unknown.js')).status,404);
    assert.equal((await get('/workbench/app/src/main.tsx')).status,404);
    const unknown=await get('/api/unknown-web01');assert.equal(unknown.status,404);assert.match(unknown.headers.get('content-type'),/application\/json/u);
    assert.equal((await get('/workbench')).status,200);assert.equal((await get('/workbench/lifecycle')).status,200);
    assert.equal((await get('/api/reporter/bootstrap')).status,503); // Existing member closed flag is unchanged.
    await pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=false WHERE id=$1::uuid',[principals[0].id]);
    assert.equal((await get(path)).status,401);assert.equal((await get('/workbench/app/')).status,401);
  });
});

test('WEB01 current communication responsibility excludes a retained assignment after a real topic boundary',async()=>{
  await withWeb01Fixture(async({origin,cookies,tickets,pool,principals})=>{
    const read=async path=>{const response=await fetch(origin+path,{headers:{cookie:cookies[0]}});assert.equal(response.status,200);return response.json();};
    const coordinator=createP2G1InboundProjectionCoordinator({pool,enabled:true});
    const projectMessages=async()=>{
      const result=await coordinator.runOnce();
      // The visual fixture sets Ticket snapshot states; this regression drives
      // the normal channel-message stream that actually ends a service session.
      const stream=result.streams.find(value=>value.source_stream===P2_G1_PROJECTION_STREAMS.channelMessage);
      assert.ok(stream);assert.deepEqual(stream.failures,[]);
    };
    await projectMessages();
    const ticket=tickets[5],path='/api/workbench/items/ticket/'+ticket.ticket.id,historyPath='/api/tickets/'+ticket.ticket.id+'/responsibility';
    const session=(await read(historyPath)).conversations[0];assert.ok(session);assert.equal(session.combined_accept_allowed,true);
    const control=createConversationControlService({pool,enabled:true,authorize:createPilotConversationControlAuthorization({pool}),realtimeAppender:appendRealtimeEvent});
    const assigned=await control.takeoverSession({command_type:'TAKEOVER',session_id:session.session_id,client_command_id:randomUUID(),idempotency_scope:'WEB01_CONVERSATION_REGRESSION',expected_row_version:Number(session.session_row_version),actor_principal_id:principals[0].id,target_principal_id:principals[1].id,reason_code:'SYNTHETIC_REVIEW'});
    assert.equal(assigned.ok,true);
    const before=(await read(path)).responsibility;
    assert.deepEqual(before.conversation_assignees,[principals[1].display_name]);
    await pool.query("UPDATE conversation.session SET status='WAITING_USER' WHERE id=$1::uuid",[session.session_id]);
    assert.deepEqual((await read(path)).responsibility.conversation_assignees,[principals[1].display_name]);
    const source=(await pool.query('SELECT source_chat_id FROM intake.service_intake WHERE id=$1::uuid',[ticket.intake.intakeId])).rows[0];
    const next=await seedPersistedIntake({pool,text:'全新合成话题',status:'RECEIVED'});
    await pool.query('UPDATE channel.message_inbox SET chat_id=$1 WHERE id=$2::bigint',[source.source_chat_id,next.messageId]);
    await pool.query('UPDATE intake.service_intake SET source_chat_id=$1 WHERE id=$2::uuid',[source.source_chat_id,next.intakeId]);
    await projectMessages();
    const retained=(await read(historyPath)).conversations.find(value=>value.session_id===session.session_id);
    assert.equal(retained.combined_accept_allowed,false);
    assert.equal(retained.assignment_status,'ASSIGNED');
    assert.equal(retained.conversation_principal_name,principals[1].display_name);
    const after=(await read(path)).responsibility;
    assert.deepEqual(after.conversation_assignees,[]);
    assert.equal(after.ticket_assignee_name,before.ticket_assignee_name);
  });
});
test('source group HTTP: ADMIN metadata, scoped group identity, replay, conflict, origin and retention',async()=>{
  await withWeb01Fixture(async({origin,cookies,tickets,pool,principals,databaseUrl})=>{
    const get=(path,index=0)=>fetch(origin+path,{headers:{cookie:cookies[index]}});
    const read=async path=>{const r=await get(path);assert.equal(r.status,200,await r.clone().text());return r.json();};
    const bootstrap=await read('/api/lifecycle/bootstrap');assert.equal(bootstrap.source_group_directory_enabled,true);
    const handlerBootstrap=await get('/api/lifecycle/bootstrap',1);assert.equal(handlerBootstrap.status,200);const handlerCsrf=(await handlerBootstrap.json()).csrf_token;
    assert.equal((await migrateWorkbenchSourceGroups({databaseUrl,mode:'apply'})).status,'NOOP_ALREADY_APPLIED');
    const itemPath=id=>'/api/workbench/items/ticket/'+id;
    const first=(await read(itemPath(tickets[0].ticket.id))).item,ref=first.source_group.ref;
    assert.match(ref,/^[a-f0-9]{64}$/u);assert.equal(first.source_label,'群聊报修 · 群名称未登记');assert.equal(first.source_group.row_version,'0');
    const raw=(await pool.query('SELECT source_bot_id,source_chat_id FROM intake.service_intake WHERE id=$1::uuid',[first.intake_id])).rows[0];
    // Different Bot + same chatid must resolve to a different name record.
    await pool.query('UPDATE intake.service_intake SET source_chat_id=$2,source_bot_id=$3 WHERE id=$1::uuid',[tickets[1].intake.intakeId,raw.source_chat_id,'other-synthetic-bot']);
    const other=(await read(itemPath(tickets[1].ticket.id))).item;assert.notEqual(other.source_group.ref,ref);
    const another=(await read(itemPath(tickets[2].ticket.id))).item;assert.notEqual(another.source_group.ref,ref);
    const list=await read('/api/workbench/source-groups?limit=1');assert.equal(list.items.length,1);assert.ok(list.next_cursor);
    assert.equal((await get('/api/workbench/source-groups',1)).status,403);
    assert.equal((await get('/api/workbench/source-groups?limit=101')).status,400);
    assert.equal((await get('/api/workbench/source-groups?limit=1&limit=2')).status,400);
    const post=async(groupRef,body,extra={},index=0)=>fetch(origin+'/api/workbench/source-groups/'+groupRef+'/name',{method:'POST',headers:{cookie:cookies[index],origin,'content-type':'application/json','x-csrf-token':bootstrap.csrf_token,'idempotency-key':body.client_command_id,'if-match':'"'+body.expected_row_version+'"',...extra},body:JSON.stringify(body)});
    const command={client_command_id:randomUUID(),expected_row_version:'0',display_name:' 信息科支持群 '};
    assert.equal((await post(ref,command,{'x-csrf-token':'wrong'})).status,403);
    assert.equal((await post(ref,command,{origin:'https://other.invalid'})).status,403);
    assert.equal((await post(ref,command,{'idempotency-key':randomUUID()})).status,400);
    assert.equal((await post(ref,command,{'if-match':'"1"'})).status,409);
    assert.equal((await post(ref,command,{'x-csrf-token':handlerCsrf},1)).status,403);
    assert.equal((await post('f'.repeat(64),command)).status,404);
    assert.equal((await post(ref,{...command,chatid:'injected'})).status,400);
    const created=await post(ref,command);assert.equal(created.status,200,await created.clone().text());const saved=await created.json();
    assert.equal(saved.group.display_name,'信息科支持群');assert.equal(saved.group.row_version,'1');assert.equal(saved.replayed,false);
    const replay=await post(ref,command);assert.equal(replay.status,200);assert.equal((await replay.json()).replayed,true);
    assert.equal((await post(ref,{...command,display_name:'不同内容'})).status,409);
    assert.equal((await post(ref,{...command,client_command_id:randomUUID()})).status,409);
    const sameName=await post(other.source_group.ref,{client_command_id:randomUUID(),expected_row_version:'0',display_name:'信息科支持群'});assert.equal(sameName.status,200);
    const searched=await read('/api/workbench/source-groups?limit=1&q='+encodeURIComponent(' 信息科 '));
    assert.equal(searched.items.length,1);assert.ok(searched.next_cursor);
    const searchedNext=await read('/api/workbench/source-groups?limit=1&q='+encodeURIComponent('信息科')+'&cursor='+searched.next_cursor);
    assert.equal(searchedNext.items.length,1);assert.equal(searchedNext.next_cursor,null);
    assert.deepEqual(new Set([...searched.items,...searchedNext.items].map(g=>g.ref)),new Set([ref,other.source_group.ref]));
    assert.equal((await get('/api/workbench/source-groups?q=不同&cursor='+searched.next_cursor)).status,400);
    assert.equal((await get('/api/workbench/source-groups?q='+encodeURIComponent('信息科'),1)).status,403);
    assert.equal((await read('/api/workbench/source-groups?q='+encodeURIComponent('不存在的合成名称'))).items.length,0);
    assert.equal((await read('/api/workbench/source-groups?q='+encodeURIComponent('%'))).items.length,0);
    assert.equal((await read('/api/workbench/source-groups?q='+ref)).items[0].ref,ref);
    for(const path of ['/api/workbench/source-groups?q=a&q=b','/api/workbench/source-groups?q='+encodeURIComponent('a'.repeat(129)),'/api/workbench/source-groups?q='+encodeURIComponent('x\n')])assert.equal((await get(path)).status,400);
    // A later direct communication channel leaves the Journey origin unchanged.
    await pool.query("UPDATE intake.contact_journey SET current_channel='WECOM_DIRECT',entry_mode='GROUP_MENTION_TO_DIRECT_GUIDED' WHERE origin_intake_id=$1::uuid",[first.intake_id]);
    const withName=(await read(itemPath(first.id))).item;assert.equal(withName.source_label,'群聊报修 · 信息科支持群');assert.equal(withName.source_group.ref,ref);
    // Another Intake may be linked as a supplement; it does not own this Ticket's origin.
    await pool.query('UPDATE intake.contact_journey SET linked_ticket_id=$1::uuid WHERE origin_intake_id<>$2::uuid',[first.id,first.intake_id]);
    const afterSupplement=(await read(itemPath(first.id))).item;assert.equal(afterSupplement.source_group.ref,ref);assert.equal(afterSupplement.source_label,withName.source_label);
    assert.equal((await read('/api/workbench/board?column=pending')).items.find(i=>i.id===first.id).source_label,withName.source_label);
    const competing=await Promise.all(['甲群','乙群'].map(display_name=>post(ref,{client_command_id:randomUUID(),expected_row_version:'1',display_name})));
    assert.deepEqual(competing.map(r=>r.status).sort(),[200,409]);
    const final=(await read(itemPath(first.id))).item;assert.equal(final.source_group.row_version,'2');
    const changes=await pool.query('SELECT count(*)::int AS count FROM workbench.source_group_name_change WHERE group_ref=$1',[ref]);assert.equal(changes.rows[0].count,2);
    assert.deepEqual((await pool.query('SELECT source_bot_id,source_chat_id FROM intake.service_intake WHERE id=$1::uuid',[first.intake_id])).rows[0],raw);
    const json=JSON.stringify(await read('/api/workbench/source-groups'));assert.ok(!json.includes(raw.source_chat_id));assert.ok(!json.includes(raw.source_bot_id));
    const direct=await seedPersistedIntake({pool,text:'合成单聊报修',chatType:'single',status:'WAITING_DESCRIPTION'});
    const directItem=(await read('/api/workbench/items/intake/'+direct.intakeId)).item;assert.equal(directItem.source_group,null);assert.equal(directItem.source_label,'企业微信私聊');
    // A contradictory retained origin/leg fixture must degrade, never pick whichever group is newest.
    const originalJourney=(await pool.query('SELECT id FROM intake.contact_journey WHERE origin_intake_id=$1::uuid',[first.intake_id])).rows[0].id;
    const conflictingJourney=(await pool.query(`INSERT INTO intake.contact_journey(
      creation_key,origin_intake_id,origin_session_id,current_session_id,linked_ticket_id,entry_mode,origin_channel,current_channel,
      reporter_identity_hash,profile_resolution_status,profile_snapshot,profile_snapshot_hash,status,row_version,
      evaluation_due_at,evaluation_due_epoch_ms,reported_at,last_activity_at,ended_at,privacy_class,retention_until,retention_until_epoch_ms)
      SELECT $2,$3::uuid,origin_session_id,current_session_id,linked_ticket_id,entry_mode,origin_channel,current_channel,
      reporter_identity_hash,profile_resolution_status,profile_snapshot,profile_snapshot_hash,status,row_version,
      evaluation_due_at,evaluation_due_epoch_ms,reported_at,last_activity_at,ended_at,privacy_class,retention_until,retention_until_epoch_ms
      FROM intake.contact_journey WHERE id=$1::uuid RETURNING id`,[originalJourney,'t23-synthetic-conflicting-origin-'+randomUUID(),tickets[1].intake.intakeId])).rows[0].id;
    await pool.query('UPDATE intake.channel_leg SET journey_id=$2::uuid WHERE source_intake_id=$1::uuid',[first.intake_id,conflictingJourney]);
    const conflicting=(await read(itemPath(first.id))).item;assert.equal(conflicting.source_group,null);assert.equal(conflicting.source_label,'来源资料不可用');
    await pool.query('UPDATE intake.channel_leg SET journey_id=$2::uuid WHERE source_intake_id=$1::uuid',[first.intake_id,originalJourney]);
    await pool.query('DELETE FROM intake.contact_journey WHERE id=$1::uuid',[conflictingJourney]);
    assert.equal((await read(itemPath(first.id))).item.source_group.ref,ref);
    await pool.query("UPDATE intake.service_intake SET retention_until=platform.local_now()-interval '1 second' WHERE id=$1::uuid",[first.intake_id]);
    const expired=(await read(itemPath(first.id))).item;assert.equal(expired.source_group,null);assert.equal(expired.source_label,'来源资料不可用');
    assert.equal((await post(ref,command)).status,404);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM communication.delivery')).rows[0].count,0);
    await pool.query("DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid AND role='ADMIN'",[principals[0].id]);
    // Existing session cannot retain directory privileges after role removal.
    assert.ok([401,403].includes((await get('/api/workbench/source-groups')).status));
  },{sourceGroupDirectoryEnabled:true});
});


test('Card 11 HTTP catalog, source projections, state events and legacy search shape',async()=>{
  const {createWeb01WorkbenchQuery}=await import('../app/server/src/web01-workbench-query.mjs');
  const {loadServiceCatalog}=await import('../app/server/src/p2-007-service-catalog.mjs');
  const {createTicketActionService}=await import('../app/server/src/p1-006-ticket-state-actions.mjs');
  const {createDecisionStore}=await import('../app/server/src/p2-015-decision-store.mjs');
  const {safeHash}=await import('../app/server/src/p2-015-domain-contracts.mjs');
  await withWeb01Fixture(async({origin,cookies,tickets,pool,principals,runtime})=>{
    const get=(path,index=0)=>fetch(origin+path,{headers:{cookie:cookies[index]}});
    const path='/api/workbench/service-catalog';
    assert.equal((await fetch(origin+path)).status,401);
    assert.equal((await fetch(origin+path,{headers:{cookie:'yxx_member_session=synthetic-member'}})).status,401);
    const response=await get(path);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
    const directory=await response.json();assert.equal(directory.schema_version,1);assert.equal(directory.categories.length,11);
    assert.equal(JSON.stringify(directory).includes('default_owner_team'),false);assert.equal(JSON.stringify(directory).includes('aliases'),false);assert.equal(JSON.stringify(directory).includes('hash'),false);
    assert.equal((await get(path+'?unknown=1')).status,400);
    assert.equal((await fetch(origin+path,{method:'POST',headers:{cookie:cookies[0]}})).status,404);
    await pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=false WHERE id=$1::uuid',[principals[0].id]);
    assert.equal((await get(path)).status,401,'the existing test authenticator rejects a disabled identity');
    await pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=true WHERE id=$1::uuid',[principals[0].id]);
    assert.equal((await get(path,1)).status,200,'valid internal handler may read without a visible Ticket');
    const nativeQuery=pool.query.bind(pool);let revokeAfterAuthentication=true;
    pool.query=async(sql,values)=>{
      const result=await nativeQuery(sql,values);
      if(revokeAfterAuthentication&&typeof sql==='string'&&sql.includes('array_agg(r.role ORDER BY r.role)')&&values?.[0]===principals[0].id){
        revokeAfterAuthentication=false;await nativeQuery('UPDATE pilot_ticket.pilot_principal SET is_active=false WHERE id=$1::uuid',[principals[0].id]);
      }
      return result;
    };
    try{assert.equal((await get(path)).status,403,'authorization rechecks the identity accepted by authentication');}
    finally{pool.query=nativeQuery;await nativeQuery('UPDATE pilot_ticket.pilot_principal SET is_active=true WHERE id=$1::uuid',[principals[0].id]);}

    const authContext={principal_id:principals[0].id};const catalog=loadServiceCatalog();
    const cards=createWeb01WorkbenchQuery({pool,query:runtime.query,serviceCatalog:catalog});
    await assert.rejects(createWeb01WorkbenchQuery({pool,query:runtime.query}).serviceCatalog(authContext),{code:'P2_016_ACTION_FAILED',status:503});
    const input={authContext,column:'pending',range:'all',cursor:null,limit:'50'};
    const page=await cards.list(input);assert.ok(page.items.every(i=>Object.hasOwn(i,'service')&&Object.hasOwn(i,'stage_entered_at')));
    let sqlCount=0;
    const measured=createWeb01WorkbenchQuery({pool:{query:(...args)=>{sqlCount++;return pool.query(...args);}},query:runtime.query,serviceCatalog:catalog});
    await measured.list({...input,limit:'1'});const one=sqlCount;sqlCount=0;
    await measured.list(input);assert.equal(sqlCount,one,'projection SQL count stays constant as page size grows');
    console.log(JSON.stringify({card11_projection_queries:{one_card:one,full_page:sqlCount}}));
    const revoked=createWeb01WorkbenchQuery({pool:{query:async(...args)=>{
      const result=await pool.query(...args);
      if(args[0].startsWith("SELECT to_regclass('intake.web_submission')"))await pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=false WHERE id=$1::uuid',[principals[0].id]);
      return result;
    }},query:runtime.query,serviceCatalog:catalog});
    try{await assert.rejects(revoked.list(input),{code:'P2_016_FORBIDDEN',status:403});}
    finally{await pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=true WHERE id=$1::uuid',[principals[0].id]);}

    const expiredAfterProjection=createWeb01WorkbenchQuery({pool:{query:async(...args)=>{
      const result=await pool.query(...args);
      if(args[0].includes('SELECT * FROM projected_sources'))await pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=false WHERE id=$1::uuid',[principals[0].id]);
      return result;
    }},query:runtime.query,serviceCatalog:catalog});
    try{await assert.rejects(expiredAfterProjection.list(input),{code:'P2_016_FORBIDDEN',status:403});}
    finally{await pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=true WHERE id=$1::uuid',[principals[0].id]);}
    const handlerContext={principal_id:principals[1].id};
    const handlerPage=await cards.list({...input,authContext:handlerContext,limit:'1'});assert.equal(handlerPage.items[0].id,tickets[0].ticket.id);
    let removeTeam=true;
    const lostRead=createWeb01WorkbenchQuery({pool:{query:async(...args)=>{
      const result=await pool.query(...args);
      if(removeTeam&&args[0].includes('SELECT * FROM projected_sources')){removeTeam=false;await pool.query('DELETE FROM pilot_ticket.pilot_team_member WHERE principal_id=$1::uuid',[principals[1].id]);}
      return result;
    }},query:runtime.query,serviceCatalog:catalog});
    try{await assert.rejects(lostRead.list({...input,authContext:handlerContext,limit:'1'}),{code:'P2_016_NOT_FOUND',status:404});}
    finally{await pool.query("INSERT INTO pilot_ticket.pilot_team_member(principal_id,team_id) VALUES($1::uuid,'PILOT_IT') ON CONFLICT DO NOTHING",[principals[1].id]);}
    await pool.query("INSERT INTO pilot_ticket.resolver_team(team_id,display_name) VALUES('CARD11_OTHER','合成其他处理组')");
    await pool.query("INSERT INTO pilot_ticket.pilot_team_member(principal_id,team_id) VALUES($1::uuid,'CARD11_OTHER')",[principals[2].id]);
    let moveTicket=true;
    const movedOut=createWeb01WorkbenchQuery({pool:{query:async(...args)=>{
      const result=await pool.query(...args);
      if(moveTicket&&args[0].includes('SELECT * FROM projected_sources')){moveTicket=false;await pool.query("UPDATE pilot_ticket.ticket SET resolver_team_id='CARD11_OTHER' WHERE id=$1::uuid",[tickets[0].ticket.id]);}
      return result;
    }},query:runtime.query,serviceCatalog:catalog});
    try{await assert.rejects(movedOut.list({...input,authContext:handlerContext,limit:'1'}),{code:'P2_016_NOT_FOUND',status:404});}
    finally{await pool.query("UPDATE pilot_ticket.ticket SET resolver_team_id='PILOT_IT' WHERE id=$1::uuid",[tickets[0].ticket.id]);}
    const raw=await cards.authorizedItem(authContext,'ticket',tickets[0].ticket.id);
    assert.equal(Object.hasOwn(raw,'service'),false);assert.equal(Object.hasOwn(raw,'stage_entered_at'),false,'search uses the original authorizedItem shape');
    const read=async()=>{const res=await get('/api/workbench/items/ticket/'+tickets[0].ticket.id);assert.equal(res.status,200);return (await res.json()).item;};
    const actions=createTicketActionService({pool,authorize:async()=>true});
    let eventIndex=0,expectedStage=null;
    for(const action of ['accept','start','request-information','resume','wait-vendor','resume','add-note']){
      const ticket=(await pool.query('SELECT version FROM pilot_ticket.ticket WHERE id=$1::uuid',[tickets[0].ticket.id])).rows[0];
      const outcome=await actions.perform({ticketId:tickets[0].ticket.id,action,actor:{type:action==='resume'&&eventIndex===5?'SYSTEM':'PILOT_USER',id:principals[0].id},expectedVersion:ticket.version,internalNote:'synthetic event verification',traceId:'card11-events'});
      assert.equal(outcome.ok,true,JSON.stringify(outcome));
      const stamp='2026-11-02 01:00:'+String(50-eventIndex++).padStart(2,'0');
      await pool.query('UPDATE pilot_ticket.ticket_event SET created_at=$2::timestamp without time zone WHERE event_id=$1::uuid',[outcome.event.event_id,stamp]);
      if(action!=='add-note')expectedStage=stamp;
      assert.equal((await read()).stage_entered_at,expectedStage,action);
    }
    const original=(await pool.query('SELECT * FROM intake.deterministic_decision WHERE service_intake_id=$1::uuid ORDER BY decision_ordinal DESC LIMIT 1',[tickets[0].intake.intakeId])).rows[0];
    const service=catalog.listServices()[0];assert.ok(service);
    const result={...original.safe_result,known_fields:{selected_service_code:service.service_code},fact_provenance:[{field_path:'service.selected_service_code',normalized_value:service.service_code,status:'ACTIVE',assertion:'AFFIRMED',source_kind:'DETERMINISTIC_RULE'}],conflicts:[]};
    const record=async safe_result=>createDecisionStore().record({transaction:pool,input:{...original,decision_policy_version:'CARD11_'+randomUUID(),safe_result,result_hash:safeHash(safe_result),input_hash:safeHash({fixture:randomUUID()}),safe_action_suggestions:[]}});
    await record(result);assert.equal((await read()).service?.source,'RULE_DETERMINISTIC');
    await record({...result,known_fields:{selected_service_code:null},fact_provenance:[]});assert.equal((await read()).service,null,'new unknown result must not resurrect the old code');
    await record({...result,conflicts:[{field_path:'service.selected_service_code'}]});assert.equal((await read()).service,null);
    await record(result);
    const continuation=await seedPersistedIntake({pool,text:'同一 Journey 后继未知合成材料'});
    const leg=(await pool.query(`INSERT INTO intake.channel_leg(journey_id,leg_ordinal,leg_type,source_intake_id,provider_context_hash,channel_identity_hash,reporter_identity_hash,opened_at)
      SELECT journey_id,2,'GROUP_CONTINUATION',$2::uuid,provider_context_hash,channel_identity_hash,reporter_identity_hash,platform.local_now()
      FROM intake.channel_leg WHERE id=$1::uuid RETURNING id::text`,[original.channel_leg_id,continuation.intakeId])).rows[0];
    const window=(await pool.query('SELECT rel.sequence_no,m.id::text AS message_id,m.clean_text,m.msg_type FROM intake.service_intake_message rel JOIN channel.message_inbox m ON m.id=rel.channel_message_id WHERE rel.intake_id=$1::uuid ORDER BY rel.sequence_no',[continuation.intakeId])).rows;
    const unknown={...result,known_fields:{selected_service_code:null},fact_provenance:[]};
    await createDecisionStore().record({transaction:pool,input:{...original,service_intake_id:continuation.intakeId,channel_leg_id:leg.id,
      decision_policy_version:'CARD11_CONTINUATION',safe_result:unknown,result_hash:safeHash(unknown),input_hash:safeHash({fixture:randomUUID()}),
      source_hash:safeHash(window.map(row=>({sequence_no:row.sequence_no,message_id:row.message_id,clean_text_hash:safeHash({text:row.clean_text??'',type:row.msg_type})}))),safe_action_suggestions:[]}});
    assert.equal((await read()).service,null,'latest Journey decision wins even when it belongs to another Intake');
    await record(result);
    await pool.query("UPDATE intake.service_intake SET retention_until=platform.local_now()-interval '1 second' WHERE id=$1::uuid",[tickets[0].intake.intakeId]);
    assert.equal((await read()).service,null,'expired source facts do not survive the read projection');
  });
});


test('Card 11 Web explicit selection respects source revocation; unavailable catalog is HTTP 503',async()=>{
  const {loadServiceCatalog}=await import('../app/server/src/p2-007-service-catalog.mjs');
  await withWeb01Fixture(async({pool,tickets,origin,cookies})=>{
    const service=loadServiceCatalog().listServices()[0];assert.ok(service);
    await pool.query("UPDATE intake.web_submission SET safe_content=jsonb_set(safe_content,'{service_code}',to_jsonb($2::text)) WHERE intake_id=$1::uuid AND kind='SUBMIT'",[tickets[0].intake.intakeId,service.service_code]);
    const read=async()=>{const response=await fetch(origin+'/api/workbench/items/ticket/'+tickets[0].ticket.id,{headers:{cookie:cookies[0]}});assert.equal(response.status,200);return (await response.json()).item;};
    assert.deepEqual((await read()).service,{code:service.service_code,name_zh:service.name_zh,category:service.category,category_name_zh:service.category_name_zh,source:'REPORTER_EXPLICIT'});
    const original=pool.query,execute=original.bind(pool);let revokeDuringMaterial=true;
    pool.query=async(sql,values)=>{
      const result=await execute(sql,values);
      if(revokeDuringMaterial&&sql.includes('SELECT * FROM projected_sources')){
        revokeDuringMaterial=false;await execute('UPDATE intake.web_request_binding SET revoked_at=platform.local_now() WHERE intake_id=$1::uuid',[tickets[0].intake.intakeId]);
      }
      return result;
    };
    try{const item=await read();assert.equal(item.service,null,'final source fingerprint rejects a binding revoked during the material wait');assert.equal(Object.hasOwn(item,'safety_signature'),false);}
    finally{pool.query=original;}
    await pool.query('UPDATE intake.web_request_binding SET revoked_at=platform.local_now() WHERE intake_id=$1::uuid',[tickets[0].intake.intakeId]);
    assert.equal((await read()).service,null);
  },{ticketSelfHandlingEnabled:true});
  await withWeb01Fixture(async({origin,cookies})=>{
    const response=await fetch(origin+'/api/workbench/service-catalog',{headers:{cookie:cookies[0]}});
    assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');
    assert.equal((await response.json()).error.code,'P2_016_ACTION_FAILED');
    const board=await fetch(origin+'/api/workbench/board',{headers:{cookie:cookies[0]}});assert.equal(board.status,200);
    assert.ok((await board.json()).items.every(item=>item.service===null),'catalog failure does not disable board or state projections');
  },{serviceCatalog:null});
});

test('Card 11 preserves terminal Intake detail and resolved Review aliases',async()=>{
  await withWeb01Fixture(async({origin,cookies,pool,waiting,runtime,principals,processReviewIntake})=>{
    await processReviewIntake(waiting.intakeId);
    const review=(await pool.query("SELECT id::text,row_version::text FROM intake.manual_review_item WHERE service_intake_id=$1::uuid AND status='PENDING'",[waiting.intakeId])).rows[0];assert.ok(review);
    const result=await runtime.reviews.resolveManualReview({authContext:{principal_id:principals[0].id},reviewId:review.id,body:{client_command_id:randomUUID(),expected_row_version:review.row_version,resolution_code:'CANCEL_REVIEW',resolution_reason_code:'CARD11_FIXTURE'}});assert.equal(result.ok,true);
    for(const status of ['COMPLETED','IGNORED']){
      await pool.query('UPDATE intake.service_intake SET status=$2 WHERE id=$1::uuid',[waiting.intakeId,status]);
      for(const route of ['intake/'+waiting.intakeId,'review/'+review.id]){
        const response=await fetch(origin+'/api/workbench/items/'+route,{headers:{cookie:cookies[0]}});assert.equal(response.status,200,route+' '+status);
        const detail=await response.json();assert.equal(detail.item.kind,'intake');assert.equal(detail.item.id,waiting.intakeId);assert.equal(detail.item.stage_entered_at,null);
      }
    }
  },{workbenchManualReviewEnabled:true});
});


test('Card 11 final statement rejects a revoked Principal after source, route or postflight waits',async()=>{
  const {readWorkbenchCardProjections}=await import('../app/server/src/workbench-card-projections.mjs');
  for(const phase of ['source-read','postflight','route-check']){
    let active=true,checks=0;
    const item={kind:'ticket',id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',intake_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',status:'IN_PROGRESS'};
    const authority=async()=>{checks++;if(!active)throw Object.assign(new Error('revoked'),{code:'P2_016_FORBIDDEN',status:403});return {values:[true,'cccccccc-cccc-4ccc-8ccc-cccccccccccc',[]],roles:['ADMIN'],teams:[]};};
    const pool={query:async sql=>{
      if(sql.startsWith('SELECT to_regclass'))return {rows:[{web:false}]};
      if(sql.includes('SELECT * FROM projected_sources')){
        if(phase==='source-read')active=false;
        return {rows:[{kind:item.kind,id:item.id,status:item.status,evidence:[],safety_signature:'same'}]};
      }
      if(phase==='postflight')active=false;
      return {rows:[{principal_valid:active,scope_valid:active,session_valid:true,items:[{kind:item.kind,id:item.id,status:item.status,stage_entered_at:null,safety_signature:'same'}]}]};
    }};
    await assert.rejects(readWorkbenchCardProjections(pool,'WITH cards AS (SELECT 1)',{authority,finalRouteCheck:async()=>{if(phase==='route-check')active=false;}},[item],null,false),{code:'P2_016_FORBIDDEN',status:403},phase);
    assert.ok(checks>=2,'current authority is obtained after material waits');
  }
});

for(const endpoint of ['board','detail','catalog'])for(const invalidation of ['logout','physical-expiry'])test('Card 11 real Cookie '+endpoint+' rejects '+invalidation+' during its read wait',async()=>{
  const {setTimeout:delay}=await import('node:timers/promises');
  await withWeb01Fixture(async f=>{
    assert.ok(f.sessionId);
    const request=(path,init={})=>fetch((f.backendOrigin??f.origin)+path,{...init,headers:{cookie:f.cookies[0],...(init.headers??{})},signal:AbortSignal.timeout(20000)});
    const bootstrapResponse=await request('/api/lifecycle/bootstrap');assert.equal(bootstrapResponse.status,200);const bootstrap=await bootstrapResponse.json();
    const original=f.pool.query,execute=original.bind(f.pool);let entered=false;
    if(invalidation==='physical-expiry')await execute(`WITH deadline AS (SELECT platform.physical_epoch_ms()+3000 AS epoch)
      UPDATE pilot_ticket.workbench_auth_session SET expires_epoch_ms=deadline.epoch,expires_at=platform.local_from_epoch_ms(deadline.epoch) FROM deadline WHERE session_id=$1::uuid`,[f.sessionId]);
    f.pool.query=async(sql,values)=>{
      const result=await execute(sql,values);
      const boundary=typeof sql==='string'&&(endpoint==='catalog'?sql.includes('array_agg(DISTINCT r.role)'):sql.includes('SELECT * FROM projected_sources'));
      if(!entered&&boundary){
        entered=true;
        if(invalidation==='logout'){
          const logout=await request('/workbench/logout',{method:'POST',headers:{origin:f.origin,'x-csrf-token':bootstrap.csrf_token}});assert.equal(logout.status,200);
        }else{
          let expired=false;const bound=performance.now()+6000;
          while(performance.now()<bound){
            expired=(await execute('SELECT expires_epoch_ms<=platform.physical_epoch_ms() AS expired FROM pilot_ticket.workbench_auth_session WHERE session_id=$1::uuid',[f.sessionId])).rows[0].expired;
            if(expired)break;await delay(10);
          }
          assert.equal(expired,true,'session must actually expire during this wait');
        }
      }
      return result;
    };
    try{
      const path=endpoint==='board'?'/api/workbench/board':endpoint==='detail'?'/api/workbench/items/ticket/'+f.tickets[0].ticket.id:'/api/workbench/service-catalog';
      const response=await request(path);assert.equal(entered,true,'authenticated request must reach the intended wait');
      assert.equal(response.status,401,await response.clone().text());const denied=await response.json();
      assert.equal(denied.error.code,'WORKBENCH_UNAUTHENTICATED');
      for(const key of ['items','item','categories','next_cursor'])assert.equal(Object.hasOwn(denied,key),false);
    }finally{f.pool.query=original;}
  },{realWorkbenchAuthentication:true});
});
