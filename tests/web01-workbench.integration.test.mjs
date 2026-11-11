import {createChannelMessageInbox} from '../app/server/src/p1-003-channel-message-inbox.mjs';
import {adaptWeComSdkFrame} from '../app/server/src/p1-002-wecom-sdk-adapter.mjs';
import {createServiceIntakeProcessor} from '../app/server/src/p1-004-service-intake.mjs';
import {formatEpochMsToShanghaiLocal} from '../app/server/src/platform/time-contract.mjs';
import {insertClosureRecord,normalizeClosureInput} from '../app/server/src/service-closure-records.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {seedPersistedIntake} from './helpers/p2-015-postgres-harness.mjs';
import {createP2G1InboundProjectionCoordinator,P2_G1_PROJECTION_STREAMS} from '../app/server/src/p2-g1-inbound-projection-coordinator.mjs';
import {createConversationControlService,createPilotConversationControlAuthorization} from '../app/server/src/p2-005-conversation-control.mjs';
import {appendRealtimeEvent} from '../app/server/src/p2-003-realtime-event-log.mjs';
import {migrateWorkbenchSourceGroups} from '../app/server/scripts/workbench-source-groups-migrate.mjs';
import {appendTicketEvent} from '../app/server/src/p1-006-ticket-state-actions.mjs';
import {assertP2016Schema} from './helpers/p2-016-schema-assert.mjs';
import {createDecisionStore} from '../app/server/src/p2-015-decision-store.mjs';
import {createServiceIntakeDecisionPort} from '../app/server/src/p2-015-service-intake-decision-port.mjs';
import {safeHash} from '../app/server/src/p2-015-domain-contracts.mjs';
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
    const closed=await read('/api/workbench/board?column=handled');assert.equal(closed.items.length,4);
    await pool.query('UPDATE pilot_ticket.ticket SET updated_at=platform.local_now() WHERE id=$1::uuid',[tickets[11].ticket.id]);
    const closingFirst=await read('/api/workbench/board?column=handled&limit=1');
    assert.equal(closingFirst.items[0].id,tickets[9].ticket.id);
    const closingNext=await read('/api/workbench/board?column=handled&limit=1&cursor='+closingFirst.next_cursor);
    assert.equal(closingNext.items[0].id,tickets[10].ticket.id);
    const resolved=closed.items.find(i=>i.status==='RESOLVED');assert.ok(resolved);assert.equal(resolved.completed_at,null);
    await pool.query("UPDATE pilot_ticket.ticket_event SET created_at=date_trunc('day',platform.local_now())-interval '2 days' WHERE ticket_id=$1::uuid AND event_type='ticket.completed'",[tickets[9].ticket.id]);
    assert.equal((await read('/api/workbench/board?column=handled')).items.length,3);
    assert.equal((await read('/api/workbench/board?column=handled&range=all')).items.length,4);
    const commandId=randomUUID();
    const cancelled=await fetch(origin+'/api/tickets/'+tickets[0].ticket.id+'/dismiss',{method:'POST',headers:{cookie:cookies[0],origin,'content-type':'application/json','x-csrf-token':bootstrap.csrf_token,'idempotency-key':commandId,'if-match':'"2"'},body:JSON.stringify({client_command_id:commandId,expected_version:2,reason_code:'OTHER',note:'取消原因（合成）'})});
    assert.equal(cancelled.status,200,await cancelled.clone().text());
    assert.ok((await read('/api/workbench/board?column=handled&range=all')).items.some(i=>i.id===tickets[0].ticket.id&&i.status==='DISMISSED'));
    const cancellationView=(await read('/api/workbench/board?column=handled&range=all')).items.filter(item=>item.status==='DISMISSED');
    assert.equal(cancellationView.length,1);assert.equal(cancellationView[0].status,'DISMISSED');
    assert.equal((await get('/api/workbench/board?column=handled&range=cancelled')).status,400,'the removed cancelled range is rejected');
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
    const favicon=html.match(/href="([^" ]*yixiaoxiu-favicon-[^" ]+\.svg)"/u)?.[1];assert.ok(favicon);
    const inventory=JSON.parse(await readFile(new URL('../web/admin-workbench/asset-inventory.json',import.meta.url),'utf8'));
    const logoFile=inventory.find(file=>/^assets\/yixiaoxiu-logo-[A-Za-z0-9_-]+\.svg$/u.test(file));assert.ok(logoFile);const logo='/workbench/app/'+logoFile;
    for(const image of [favicon,logo]){assert.equal((await fetch(origin+image)).status,401);const response=await get(image);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/svg+xml');assert.match(await response.text(),/<svg\b/u);}
    assert.equal((await get('/workbench/app/assets/yixiaoxiu-logo-not-in-inventory.svg')).status,404);
    assert.equal((await get('/workbench/app/assets/arbitrary.svg')).status,404);
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
    for(const status of ['COMPLETED','DISMISSED']){
      if(status==='COMPLETED')await pool.query('UPDATE intake.service_intake SET status=$2 WHERE id=$1::uuid',[waiting.intakeId,status]);
      else{
        await pool.query("UPDATE intake.service_intake SET status='WAITING_TRIAGE' WHERE id=$1::uuid",[waiting.intakeId]);
        const current=(await pool.query('SELECT version FROM intake.service_intake WHERE id=$1::uuid',[waiting.intakeId])).rows[0],bootstrap=await (await fetch(origin+'/api/lifecycle/bootstrap',{headers:{cookie:cookies[0]}})).json(),id=randomUUID();
        const close=await fetch(origin+'/api/intakes/'+waiting.intakeId+'/close',{method:'POST',headers:{cookie:cookies[0],origin,'content-type':'application/json','x-csrf-token':bootstrap.csrf_token,'idempotency-key':id,'if-match':'"'+current.version+'"'},body:JSON.stringify({client_command_id:id,expected_version:current.version,reason_code:'FALSE_REPORT_OR_TEST'})});assert.equal(close.status,200,await close.clone().text());
      }
      for(const route of ['intake/'+waiting.intakeId,'review/'+review.id]){
        const response=await fetch(origin+'/api/workbench/items/'+route,{headers:{cookie:cookies[0]}});assert.equal(response.status,200,route+' '+status);
        const detail=await response.json();assert.equal(detail.item.kind,'intake');assert.equal(detail.item.id,waiting.intakeId);assert.equal(detail.item.stage_entered_at,null);
      }
    }
  },{workbenchManualReviewEnabled:true});
});

test('Card 27A closure facts, default groups, date boundaries and list filters share the authorized canonical items',async()=>{
  await withWeb01Fixture(async({origin,cookies,pool,tickets,principals,runtime,processReviewIntake})=>{
    const get=(path,index=0)=>fetch(origin+path,{headers:{cookie:cookies[index]}});
    const read=async(path,index=0)=>{const response=await get(path,index);assert.equal(response.status,200,await response.clone().text());assert.equal(response.headers.get('cache-control'),'no-store');const value=await response.json();
      if(path.startsWith('/api/workbench/board'))await assertP2016Schema('web01_workbench_board',value);
      if(path.startsWith('/api/workbench/search'))await assertP2016Schema('workbench_search_page',value);return value;};
    const bootstrap=await read('/api/lifecycle/bootstrap');
    const commandId=randomUUID(),cancelledId=tickets[0].ticket.id;
    const cancel=await fetch(origin+'/api/tickets/'+cancelledId+'/dismiss',{method:'POST',headers:{cookie:cookies[0],origin,
      'content-type':'application/json','x-csrf-token':bootstrap.csrf_token,'idempotency-key':commandId,'if-match':'"2"'},
      body:JSON.stringify({client_command_id:commandId,expected_version:2,reason_code:'FALSE_REPORT_OR_TEST',note:'误报核对后取消（合成）'})});
    assert.equal(cancel.status,200,await cancel.clone().text());
    const cancelledEvent=(await pool.query("SELECT reason_code,internal_note,to_char(created_at,'YYYY-MM-DD HH24:MI:SS') AS ended_at FROM pilot_ticket.ticket_event WHERE ticket_id=$1::uuid AND event_type='ticket.dismissed' ORDER BY aggregate_version DESC,event_ordinal DESC LIMIT 1",[cancelledId])).rows[0];
    assert.equal(cancelledEvent.reason_code,'FALSE_REPORT_OR_TEST');assert.equal(cancelledEvent.internal_note,'误报核对后取消（合成）');
    const cancellation=await read('/api/workbench/items/ticket/'+cancelledId);
    assert.deepEqual(cancellation.item.closure,{kind:'DISMISSED',source:'MANUAL',reason_code:'FALSE_REPORT_OR_TEST',reason_label:'误报或测试',secondary_reason:null,reason_note:'误报核对后取消（合成）',
      ended_by_display_name:principals[0].display_name,ended_at:(await pool.query("SELECT to_char(ended_at,'YYYY-MM-DD HH24:MI:SS') AS at FROM pilot_ticket.closure_record WHERE ticket_id=$1::uuid AND restored_at IS NULL",[cancelledId])).rows[0].at,duplicate_of:null,can_restore:true});
    assert.ok(cancellation.records.some(record=>record.audience==='INTERNAL'&&record.text===cancellation.item.closure.reason_note),'the closure note was already visible under the existing internal Ticket READ');
    assert.equal((await read('/api/tickets/'+cancelledId)).allowed_actions.includes('reopen'),false,'completion reopen remains separate from restoring a closure');
    assert.equal((await get('/api/workbench/items/ticket/'+cancelledId,1)).status,404);

    const duplicateId=tickets[1].ticket.id;
    const duplicate=(await pool.query("UPDATE pilot_ticket.ticket SET status='DISMISSED',title='重复事项（合成）',version=version+1 WHERE id=$1::uuid RETURNING *",[duplicateId])).rows[0];
    const duplicateEvent=await appendTicketEvent({transaction:pool,ticket:duplicate,eventType:'ticket.dismissed',actor:{type:'SYSTEM',id:null},oldStatus:tickets[1].ticket.status,internalNote:null,externalNote:null,traceId:'card27a-duplicate-synthetic'});
    await insertClosureRecord({transaction:pool,subjectType:'TICKET',subjectId:duplicateId,beforeStatus:tickets[1].ticket.status,beforeVersion:tickets[1].ticket.version,beforeAssignee:tickets[1].ticket.assignee_id,beforeTeam:tickets[1].ticket.resolver_team_id,beforeSnapshot:{},actor:null,source:'SYSTEM',input:normalizeClosureInput({reason_code:'DUPLICATE'}),ticketEventId:duplicateEvent.event_id});
    const duplicateCard=(await read('/api/workbench/items/ticket/'+duplicateId)).item;
    assert.equal(duplicateCard.closure.kind,'DISMISSED');assert.equal(duplicateCard.closure.source,'SYSTEM');assert.equal(duplicateCard.closure.reason_label,'重复报修');
    assert.equal(duplicateCard.closure.duplicate_of,null,'no original Ticket reference can be inferred from this existing event');assert.equal(duplicateCard.closure.can_restore,true);
    assert.equal((await read('/api/tickets/'+duplicateId)).allowed_actions.includes('reopen'),false);

    const resolve=async(text,resolution_code,resolution_reason_code,oldObservation=false)=>{
      const intake=await seedPersistedIntake({pool,text,status:'RECEIVED'});await processReviewIntake(intake.intakeId);
      const review=(await pool.query("SELECT id::text,row_version::text FROM intake.manual_review_item WHERE service_intake_id=$1::uuid AND status='PENDING'",[intake.intakeId])).rows[0];assert.ok(review);
      if(oldObservation)await pool.query("UPDATE intake.deterministic_decision SET observed_at=platform.local_now()-interval '3 days' WHERE id=(SELECT decision_id FROM intake.manual_review_item WHERE id=$1::uuid)",[review.id]);
      const result=await runtime.reviews.resolveManualReview({authContext:{principal_id:principals[0].id},reviewId:review.id,
        body:{client_command_id:randomUUID(),expected_row_version:review.row_version,resolution_code,resolution_reason_code,...(resolution_code==='MARK_OUT_OF_SCOPE'?{reason_code:'NOT_IT_SCOPE',secondary_reason_code:resolution_reason_code}:{})}});
      assert.equal(result.ok,true);return {intake,review,result};
    };
    const manual=await resolve('范围外请求人工核对（合成）','MARK_OUT_OF_SCOPE','OUT_OF_SCOPE_CONFIRMED',true);
    const manualCard=(await read('/api/workbench/items/intake/'+manual.intake.intakeId)).item;
    assert.equal(manualCard.status,'DISMISSED');assert.equal(manualCard.closure.kind,'DISMISSED');assert.equal(manualCard.closure.source,'MANUAL');
    assert.equal(manualCard.closure.reason_code,'NOT_IT_SCOPE');assert.deepEqual(manualCard.closure.secondary_reason,{code:'OUT_OF_SCOPE_CONFIRMED',label:'已核对为范围外诉求'});assert.equal(manualCard.closure.ended_by_display_name,principals[0].display_name);
    assert.equal(manualCard.closure.reason_note,null);assert.equal(manualCard.closure.can_restore,true);
    const manualTimes=(await pool.query("SELECT to_char(r.resolved_at,'YYYY-MM-DD HH24:MI:SS') AS resolved_at,to_char(e.occurred_at,'YYYY-MM-DD HH24:MI:SS') AS event_at FROM intake.manual_review_item r JOIN intake.service_intake_event e ON e.payload->>'decision_id'=r.resolution_decision_id::text WHERE r.id=$1::uuid AND e.event_type='intake.rule_decision_applied'",[manual.review.id])).rows[0];
    assert.ok(manualTimes.event_at<manualTimes.resolved_at,'the existing BOT writer retains the earlier observation time');
    assert.equal(manualCard.closure.ended_at,(await pool.query("SELECT to_char(ended_at,'YYYY-MM-DD HH24:MI:SS') AS at FROM pilot_ticket.closure_record WHERE intake_id=$1::uuid AND restored_at IS NULL",[manual.intake.intakeId])).rows[0].at,'closing time is the actual closure transaction, independent of old source observations');assert.ok(manualCard.closure.ended_at>=manualTimes.resolved_at);
    const alternateReason=await resolve('人工范围外复核选择其它既有原因（合成）','MARK_OUT_OF_SCOPE','HUMAN_CONFIRMED');
    const alternateCard=(await read('/api/workbench/items/intake/'+alternateReason.intake.intakeId)).item;
    assert.equal(alternateCard.closure.reason_code,'NOT_IT_SCOPE');assert.equal(alternateCard.closure.reason_label,'非 IT 范围');assert.deepEqual(alternateCard.closure.secondary_reason,{code:'HUMAN_CONFIRMED',label:'人工核对确认'},'the eight options remain secondary reasons');
    const completed=await resolve('确认收到的受理事项（合成）','ACKNOWLEDGE','ACKNOWLEDGED');
    const completedCard=(await read('/api/workbench/items/intake/'+completed.intake.intakeId)).item;
    assert.equal(completedCard.status,'COMPLETED');assert.equal(completedCard.closure.kind,'COMPLETED');assert.equal(completedCard.closure.source,'MANUAL');assert.equal(completedCard.closure.can_restore,false);
    const consultation=await resolve('已核对业务咨询（合成）','CLASSIFY_BUSINESS_CONSULTATION','BUSINESS_CONSULTATION_CONFIRMED');
    assert.equal((await read('/api/workbench/items/intake/'+consultation.intake.intakeId)).item.closure.kind,'COMPLETED');
    const retired=await resolve('取消复核再自动判断（合成）','CANCEL_REVIEW','STALE_REVIEW_CANCELLED');
    assert.equal((await pool.query('SELECT status FROM intake.service_intake WHERE id=$1::uuid',[retired.intake.intakeId])).rows[0].status,'WAITING_TRIAGE','cancelling a review does not close the Intake');
    const original=(await pool.query('SELECT * FROM intake.deterministic_decision WHERE service_intake_id=$1::uuid AND status=$2 ORDER BY decision_ordinal LIMIT 1',[retired.intake.intakeId,'RECORDED'])).rows[0];assert.ok(original);
    const safe_result={...original.safe_result,result_code:'OUT_OF_SCOPE',reason_code:'RULE_OUT_OF_SCOPE',manual_review_required:false};
    const delayedAt=(await pool.query("SELECT to_char(platform.local_now()-interval '3 days','YYYY-MM-DD HH24:MI:SS') AS at")).rows[0].at;
    const automatic=await createDecisionStore().record({transaction:pool,input:{...original,observed_at:delayedAt,result_code:'OUT_OF_SCOPE',reason_code:'RULE_OUT_OF_SCOPE',safe_result,
      decision_policy_version:'CARD27A_'+randomUUID(),result_hash:safeHash(safe_result),input_hash:safeHash({fixture:randomUUID()}),safe_action_suggestions:[]}});
    const applied=await createServiceIntakeDecisionPort().apply({transaction:pool,input:{intake_id:retired.intake.intakeId,decision_id:automatic.id,result_code:'OUT_OF_SCOPE',
      catalog_version:original.catalog_version,rule_set_version:original.rule_set_version,occurred_at:delayedAt,trace_id:'card27a-automatic-synthetic'}});
    assert.equal(applied.applied,true);
    const automaticCard=(await read('/api/workbench/items/intake/'+retired.intake.intakeId)).item;
    assert.equal(automaticCard.status,'DISMISSED');assert.equal(automaticCard.closure.source,'SYSTEM');assert.equal(automaticCard.closure.reason_label,'非 IT 范围');
    assert.equal(automaticCard.closure.reason_code,'NOT_IT_SCOPE');assert.equal(automaticCard.closure.ended_by_display_name,null);assert.equal(automaticCard.closure.reason_note,null);
    assert.ok(automaticCard.closure.ended_at>delayedAt,'the closure record persists the physical closing instant while the source event keeps its observed time');
    const automaticEvent=(await pool.query("SELECT to_char(occurred_at,'YYYY-MM-DD HH24:MI:SS') AS at FROM intake.service_intake_event WHERE intake_id=$1::uuid AND event_type='intake.rule_decision_applied' ORDER BY aggregate_version DESC,event_ordinal DESC LIMIT 1",[retired.intake.intakeId])).rows[0];assert.equal(automaticEvent.at,delayedAt);

    const pending=await read('/api/workbench/board?column=pending'),active=await read('/api/workbench/board?column=active');
    for(const page of [pending,active]){assert.equal(Object.hasOwn(page,'group_counts'),false);assert.ok(page.items.every(item=>Object.hasOwn(item,'closure')&&item.closure===null));}
    const all=await read('/api/workbench/board?column=handled&range=all');
    assert.deepEqual(new Set(all.items.map(item=>item.status)),new Set(['RESOLVED','COMPLETED','DISMISSED']));
    const counted={completed:all.items.filter(item=>item.closure.kind==='COMPLETED').length,dismissed:all.items.filter(item=>item.closure.kind==='DISMISSED').length};
    assert.deepEqual(all.group_counts,counted);assert.ok(all.items.some(item=>item.id===cancelledId));
    const paged=[];let cursor=null;
    do{
      const page=await read('/api/workbench/board?column=handled&range=all&limit=2'+(cursor?'&cursor='+encodeURIComponent(cursor):''));
      assert.deepEqual(page.group_counts,counted,'each page counts the complete selected range, before the keyset limit');paged.push(...page.items);cursor=page.next_cursor;
    }while(cursor);
    assert.deepEqual(paged.map(item=>item.kind+':'+item.id),all.items.map(item=>item.kind+':'+item.id));
    assert.equal(new Set(paged.map(item=>item.kind+':'+item.id)).size,paged.length);
    const empty=await read('/api/workbench/board?column=handled&range=all',1);assert.deepEqual(empty.items,[]);assert.deepEqual(empty.group_counts,{completed:0,dismissed:0});
    assert.equal((await get('/api/workbench/board?column=handled&range=cancelled')).status,400,'the removed board mode is rejected instead of silently changing the date range');
    assert.equal((await get('/api/workbench/search?column=handled&range=cancelled')).status,400,'the removed list mode is rejected');
    // ADR-0058: every dismissed Ticket / Intake now has the single status DISMISSED (no separate DUPLICATE_LINKED / IGNORED), so the status filter selects exactly the dismissed set.
    const dismissedIds=new Set(all.items.filter(item=>item.closure.kind==='DISMISSED').map(item=>item.kind+':'+item.id));assert.ok(dismissedIds.size>1);
    const cancelledOnly=await read('/api/workbench/search?column=handled&range=all&closure_kind=dismissed&statuses=DISMISSED');assert.deepEqual(new Set(cancelledOnly.items.map(item=>item.kind+':'+item.id)),dismissedIds);assert.ok(cancelledOnly.items.some(item=>item.id===cancelledId));assert.ok(cancelledOnly.items.every(item=>item.status==='DISMISSED'&&item.closure.kind==='DISMISSED'));
    assert.deepEqual((await read('/api/workbench/search?column=handled&range=all&closure_kind=dismissed&statuses=COMPLETED')).items,[],'a completed status never matches a dismissed closure');

    const day=(await pool.query("SELECT to_char(platform.local_now(),'YYYY-MM-DD') AS today,to_char(date_trunc('day',platform.local_now()),'YYYY-MM-DD HH24:MI:SS') AS start")).rows[0];
    await pool.query("UPDATE pilot_ticket.closure_record SET ended_at=$2::timestamp WHERE ticket_id=$1::uuid AND restored_at IS NULL",[cancelledId,day.start]);
    await pool.query("UPDATE pilot_ticket.closure_record SET ended_at=$2::timestamp-interval '1 second' WHERE ticket_id=$1::uuid AND restored_at IS NULL",[duplicateId,day.start]);
    await pool.query('UPDATE pilot_ticket.ticket SET updated_at=platform.local_now() WHERE id=ANY($1::uuid[])',[[cancelledId,duplicateId]]);
    const custom=await read('/api/workbench/board?column=handled&range=custom&handled_from='+day.today+'&handled_to='+day.today);
    assert.ok(custom.items.some(item=>item.id===cancelledId),'inclusive start uses the real cancellation event');assert.ok(custom.items.every(item=>item.id!==duplicateId),'later metadata updates cannot move yesterday\'s closure into today');
    assert.deepEqual(custom.group_counts,{completed:custom.items.filter(item=>item.closure.kind==='COMPLETED').length,dismissed:custom.items.filter(item=>item.closure.kind==='DISMISSED').length});
    await pool.query("UPDATE pilot_ticket.closure_record SET ended_at=$2::timestamp+interval '1 day' WHERE ticket_id=$1::uuid AND restored_at IS NULL",[cancelledId,day.start]);
    const upper=await read('/api/workbench/board?column=handled&range=custom&handled_from='+day.today+'&handled_to='+day.today);assert.ok(upper.items.every(item=>item.id!==cancelledId),'exclusive upper day boundary');

    const completedList=await read('/api/workbench/search?column=handled&range=all&closure_kind=completed');
    assert.equal(completedList.criteria.closure_kind,'completed');assert.ok(completedList.items.length>0);assert.ok(completedList.items.every(item=>item.column==='handled'&&item.closure.kind==='COMPLETED'));
    const dismissedList=await read('/api/workbench/search?column=handled&range=all&closure_kind=dismissed');
    assert.equal(dismissedList.criteria.closure_kind,'dismissed');assert.ok(dismissedList.items.length>0);assert.ok(dismissedList.items.every(item=>item.closure.kind==='DISMISSED'));
    assert.deepEqual(new Set(dismissedList.items.map(item=>item.kind+':'+item.id)),new Set(all.items.filter(item=>item.closure.kind==='DISMISSED').map(item=>item.kind+':'+item.id)));
    const mixed=await read('/api/workbench/search?column=all&range=all&closure_kind=dismissed');assert.ok(mixed.items.some(item=>item.column!=='handled'));assert.ok(mixed.items.every(item=>item.column!=='handled'||item.closure.kind==='DISMISSED'),'the filter affects terminal statuses only');
    const selected=await read('/api/workbench/search?column=handled&range=all&closure_kind=dismissed&statuses=DISMISSED');assert.deepEqual(new Set(selected.items.map(item=>item.kind+':'+item.id)),new Set(dismissedList.items.map(item=>item.kind+':'+item.id)));
    const first=await read('/api/workbench/search?column=handled&range=all&closure_kind=dismissed&limit=1');assert.ok(first.next_cursor);
    assert.equal((await get('/api/workbench/search?column=handled&range=all&closure_kind=completed&limit=1&cursor='+encodeURIComponent(first.next_cursor))).status,400,'a cursor cannot be reused for a different closure kind');
    const next=await read('/api/workbench/search?column=handled&range=all&closure_kind=dismissed&limit=1&cursor='+encodeURIComponent(first.next_cursor));assert.equal(next.items.length,1);assert.notEqual(next.items[0].id,first.items[0].id);
    const denied=await read('/api/workbench/search?column=handled&range=all&closure_kind=dismissed',1);assert.deepEqual(denied.items,[]);assert.equal(denied.next_cursor,null);assert.equal(JSON.stringify(denied).includes(cancelledId),false);
    for(const value of ['','invalid','COMPLETED','completed&closure_kind=dismissed'])assert.equal((await get('/api/workbench/search?closure_kind='+value)).status,400,value);
    const originalQuery=pool.query;let waitingBoundary=false;
    pool.query=async function(sql,values){
      const result=await originalQuery.call(this,sql,values);
      if(!waitingBoundary&&typeof sql==='string'&&sql.includes('SELECT * FROM projected_sources')){
        waitingBoundary=true;
        // contact_journey_time_check needs retention_until > reported_at at second precision; a Journey reported in the
        // current second cannot expire yet, so wait (bounded) for the next second instead of moving any other fact.
        for(const until=Date.now()+3000;;){
          const ready=(await originalQuery.call(this,`SELECT platform.local_from_epoch_ms(platform.physical_epoch_ms()-1)>j.reported_at AS ready
            FROM intake.contact_journey j WHERE j.id=(SELECT journey_id FROM intake.manual_review_item WHERE id=$1::uuid)`,[manual.review.id])).rows[0]?.ready;
          if(ready===true)break;assert.ok(Date.now()<until,'JOURNEY_EXPIRY_INSTANT_NOT_REACHED');await new Promise(resolve=>setTimeout(resolve,50));
        }
        await originalQuery.call(this,`WITH expiry AS (SELECT platform.physical_epoch_ms()-1 AS epoch)
          UPDATE intake.contact_journey SET retention_until_epoch_ms=expiry.epoch,retention_until=platform.local_from_epoch_ms(expiry.epoch)
          FROM expiry WHERE id=(SELECT journey_id FROM intake.manual_review_item WHERE id=$1::uuid)`,[manual.review.id]);
      }
      return result;
    };
    try{
      const stale=await get('/api/workbench/board?column=handled');assert.equal(waitingBoundary,true);
      assert.equal(stale.status,200,'retained closure records no longer depend on expired Journey evidence');const current=await stale.json();assert.ok(current.items.some(item=>item.id===manual.intake.intakeId));assert.deepEqual(current.group_counts,{completed:current.items.filter(item=>item.closure.kind==='COMPLETED').length,dismissed:current.items.filter(item=>item.closure.kind==='DISMISSED').length});
    }finally{pool.query=originalQuery;}
    const expired=(await read('/api/workbench/items/intake/'+manual.intake.intakeId)).item;
    assert.deepEqual(expired.closure,manualCard.closure,'the new retained closure is independent of the original Journey and decision timestamps');
    const recent=await read('/api/workbench/board?column=handled');assert.ok(recent.items.some(item=>item.id===manual.intake.intakeId));assert.ok(recent.items.some(item=>item.id===retired.intake.intakeId),'automatic closures now have a real date-window timestamp');
    assert.deepEqual(recent.group_counts,{completed:recent.items.filter(item=>item.closure.kind==='COMPLETED').length,dismissed:recent.items.filter(item=>item.closure.kind==='DISMISSED').length});
    const completedEvent=(await pool.query("SELECT payload FROM intake.service_intake_event WHERE intake_id=$1::uuid AND event_type='intake.rule_decision_applied' ORDER BY aggregate_version DESC,event_ordinal DESC LIMIT 1",[completed.intake.intakeId])).rows[0];assert.ok(completedEvent);
    await pool.query("UPDATE intake.service_intake_event SET payload=jsonb_set(payload,'{decision_id}',to_jsonb($2::text)) WHERE intake_id=$1::uuid AND event_type='intake.rule_decision_applied'",[completed.intake.intakeId,'缺少旧关闭证据标识（合成）']);
    const unknownDecision=(await read('/api/workbench/items/intake/'+completed.intake.intakeId)).item;
    assert.equal(unknownDecision.closure.source,null);assert.equal(unknownDecision.closure.ended_at,null);assert.equal(unknownDecision.closure.ended_by_display_name,null,'malformed legacy text must remain an unknown proof rather than a UUID cast error');
    await pool.query("UPDATE intake.service_intake_event SET payload=$2::jsonb WHERE intake_id=$1::uuid AND event_type='intake.rule_decision_applied'",[completed.intake.intakeId,JSON.stringify(completedEvent.payload)]);
    assert.deepEqual((await read('/api/workbench/items/intake/'+completed.intake.intakeId)).item.closure,completedCard.closure);
    const originalCancellation=(await read('/api/workbench/items/ticket/'+cancelledId)).item.closure;
    await pool.query("UPDATE pilot_ticket.ticket_event SET operator_id=$2 WHERE ticket_id=$1::uuid AND event_type='ticket.dismissed'",[cancelledId,'旧操作人未解析（合成）']);
    const unknownActor=(await read('/api/workbench/items/ticket/'+cancelledId)).item.closure;
    assert.deepEqual(unknownActor,originalCancellation,'event text cannot override the actor in the new closure record');
    await pool.query("UPDATE pilot_ticket.ticket_event SET operator_id=$2 WHERE ticket_id=$1::uuid AND event_type='ticket.dismissed'",[cancelledId,principals[0].id]);
    assert.deepEqual((await read('/api/workbench/items/ticket/'+cancelledId)).item.closure,originalCancellation);
    await pool.query('DELETE FROM pilot_ticket.closure_record WHERE ticket_id=$1::uuid',[cancelledId]);assert.equal((await get('/api/workbench/items/ticket/'+cancelledId)).status,503,'a missing closure record is a data error, never a legacy fallback');
    console.log('CARD27A_SYNTHETIC '+JSON.stringify({states:6,manual_intake:manualCard.status,automatic_intake:automaticCard.status,cancelled_reason_note_visible:true,duplicate_original_available:false,dismissed_restore:true,retained_closure_time:true,post_wait_record_stable:true,all_group_counts:counted,pages:Math.ceil(paged.length/2)}));
  },{workbenchManualReviewEnabled:true,workbenchSearchEnabled:true,precisionV212:true});
});


test('Card 27A review rejects a newly matching prefix or sentinel after a real follow commit',async()=>{
  for(const scenario of ['before','after','empty'])await withWeb01Fixture(async f=>{
    const get=async path=>{const r=await fetch(f.origin+path,{headers:{cookie:f.cookies[0]}});assert.equal(r.status,200,await r.clone().text());return r.json();};
    const a=f.tickets[scenario==='before'?11:9].ticket.id,b=f.tickets[scenario==='before'?9:11].ticket.id;
    await f.pool.query("UPDATE pilot_ticket.ticket SET assignee_id=$1::uuid WHERE status IN ('RESOLVED','COMPLETED','DISMISSED')",[f.principals[2].id]);
    if(scenario!=='empty')await f.pool.query('UPDATE pilot_ticket.ticket SET assignee_id=$1::uuid WHERE id=$2::uuid',[f.principals[0].id,a]);
    const path='/api/workbench/board?column=handled&range=all&scope=related&limit=1';
    const initial=await get(path);assert.deepEqual(initial.items.map(item=>item.id),scenario==='empty'?[]:[a]);assert.equal(initial.next_cursor,null);
    const bootstrap=await get('/api/lifecycle/bootstrap'),detail=await get('/api/workbench/items/ticket/'+b);
    const command={client_command_id:randomUUID(),canonical_item:{kind:'ticket',id:b},expected_follow_version:detail.item.attention.follow_version,following:true};
    const original=f.pool.query;let entered=false;
    f.pool.query=async function(sql,values){const result=await original.call(this,sql,values);
      if(!entered&&typeof sql==='string'&&sql.includes('SELECT * FROM projected_sources')){entered=true;
        const followed=await fetch(f.origin+'/api/workbench/items/ticket/'+b+'/follow',{method:'POST',headers:{cookie:f.cookies[0],origin:f.origin,'content-type':'application/json','x-csrf-token':bootstrap.csrf_token,'idempotency-key':command.client_command_id,'if-match':'"'+command.expected_follow_version+'"'},body:JSON.stringify(command)});
        assert.equal(followed.status,200,await followed.clone().text());
      }return result;
    };
    try{const stale=await fetch(f.origin+path,{headers:{cookie:f.cookies[0]}});assert.equal(entered,true);assert.equal(stale.status,409,scenario);const body=await stale.json();assert.equal(body.error.code,'P2_016_VERSION_CONFLICT');assert.equal(Object.hasOwn(body,'items'),false);assert.equal(Object.hasOwn(body,'group_counts'),false);}finally{f.pool.query=original;}
    const current=await get(path),expected=scenario==='empty'?[b]:scenario==='before'?[b,a]:[a,b];
    assert.deepEqual(current.group_counts,{completed:expected.length,dismissed:0});
    const items=[...current.items];let cursor=current.next_cursor;
    while(cursor){const next=await get(path+'&cursor='+encodeURIComponent(cursor));assert.deepEqual(next.group_counts,current.group_counts);items.push(...next.items);cursor=next.next_cursor;}
    assert.deepEqual(items.map(item=>item.id),expected,scenario+' current complete pagination');
  },{precisionV212:true,workbenchFollowEnabled:true});
});

test('Card 27A review normalizes valid legacy whitespace without changing stored internal facts',async()=>{
  await withWeb01Fixture(async f=>{
    const read=async path=>{const r=await fetch(f.origin+path,{headers:{cookie:f.cookies[0]}});assert.equal(r.status,200,await r.clone().text());return r.json();};
    const bootstrap=await read('/api/lifecycle/bootstrap'),id=f.tickets[0].ticket.id,commandId=randomUUID();
    await f.pool.query("UPDATE pilot_ticket.pilot_principal SET display_name=' ' WHERE id=$1::uuid",[f.principals[0].id]);
    const cancelled=await fetch(f.origin+'/api/tickets/'+id+'/dismiss',{method:'POST',headers:{cookie:f.cookies[0],origin:f.origin,'content-type':'application/json','x-csrf-token':bootstrap.csrf_token,'idempotency-key':commandId,'if-match':'"2"'},body:JSON.stringify({client_command_id:commandId,expected_version:2,reason_code:'FALSE_REPORT_OR_TEST',note:' '})});
    assert.equal(cancelled.status,200,await cancelled.clone().text());
    const detail=await read('/api/workbench/items/ticket/'+id);assert.equal(detail.item.closure.reason_note,null);assert.equal(detail.item.closure.ended_by_display_name,null);assert.equal(detail.item.closure.source,'MANUAL');
    assert.ok(detail.records.some(item=>item.type==='ticket.dismissed'&&item.text===null),'the new closure normalizes pure whitespace to null in its internal Event');
    await assertP2016Schema('web01_workbench_card',detail.item);
  },{precisionV212:true});
});

test('Card 27A review initial ignored closing time is its creation fact, not delayed input time',async()=>{
  await withWeb01Fixture(async f=>{
    const at=formatEpochMsToShanghaiLocal(String(Math.floor(Date.now()/1000)*1000-259200000)),expiry=String(Math.floor(Date.now()/1000)*1000+2592000000);
    const frame=adaptWeComSdkFrame({cmd:'aibot_msg_callback',headers:{req_id:'初始感谢（合成）-'+randomUUID()},body:{msgid:'初始感谢（合成）-'+randomUUID(),aibotid:'bot-test',chattype:'single',from:{userid:'thanks-synthetic-initial'},msgtype:'text',text:{content:'谢谢'}}},{receivedAt:at});assert.equal(frame.ok,true);
    const accepted=await createChannelMessageInbox({pool:f.pool}).accept({message:frame.message,traceId:'card27c-initial-thanks（合成）',privacyClass:'INTERNAL',retentionUntil:formatEpochMsToShanghaiLocal(expiry),retentionUntilEpochMs:expiry},createServiceIntakeProcessor());assert.equal(accepted.ok,true);
    const intake=accepted.result.intake;assert.equal(intake.status,'DISMISSED');
    const closed=(await f.pool.query("SELECT before_status,to_char(ended_at,'YYYY-MM-DD HH24:MI:SS') AS at FROM pilot_ticket.closure_record WHERE intake_id=$1::uuid",[intake.id])).rows[0];assert.equal(closed.before_status,'WAITING_DESCRIPTION');
    const response=await fetch(f.origin+'/api/workbench/items/intake/'+intake.id,{headers:{cookie:f.cookies[0]}});assert.equal(response.status,200);const body=await response.json();assert.equal(body.item.closure.source,'SYSTEM');assert.equal(body.item.closure.ended_at,closed.at);assert.ok(closed.at>at,'the closure transaction clock is independent of delayed input');
  },{precisionV212:true});
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
