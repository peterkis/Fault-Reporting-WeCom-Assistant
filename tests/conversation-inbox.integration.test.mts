import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {IncomingMessage} from 'node:http';
import {Socket} from 'node:net';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {withT22Fixture} from './helpers/wbint-t22-fixture.mjs';
import {addInboxSession,attachInboxJourney,conversationPost,freshCommand,INBOX_IDENTITY_KEY} from './helpers/conversation-inbox-fixture.mjs';
import {assertP2016Schema} from './helpers/p2-016-schema-assert.mjs';
import {createCommunicationDeliveryWorker} from '../app/server/src/p2-004-communication-delivery-worker.mjs';
import {createConversationInbox} from '../app/server/src/workbench-conversation-inbox.mjs';
import {createPilotWorkbenchAuthorizationAdapter} from '../app/server/src/p2-006-workbench-authorization.mjs';
import type {PostgresPool} from '../app/server/src/platform/postgres-pool.mjs';
import type {ConversationInboxPage,ConversationRelatedPage,ConversationChatEntry,ConversationChatDeliveryPage,ConversationChatItemPage} from '../contracts/workbench_conversation_inbox_contracts.js';
import type {ConversationMessageResult} from '../contracts/workbench_conversation_workspace_contracts.js';

test('default-off preserves the original workspace and rejects the new read views',async()=>{
  await withT22Fixture(async({origin,cookie,sessions})=>{
    const get=(path:string)=>fetch(origin+path,{headers:{cookie}}),id=sessions[0]?.id;assert.ok(id);
    assert.equal((await get('/api/workbench/conversation-inbox')).status,503);assert.equal((await get('/api/workbench/conversations/'+id+'?view=chat')).status,503);
    assert.equal((await get('/api/workbench/conversations')).status,200);const old=await (await get('/api/workbench/conversations/'+id)).json() as Record<string,unknown>;assert.equal(Object.hasOwn(old,'contact_ref'),false);
  });
});
test('same-name people remain separate while a reliable group/direct Journey counts once and scopes every related Session',async()=>{
  await withT22Fixture(async({origin,cookie,outsiderCookie,pool})=>{
    const group=await addInboxSession(pool,{reporter:'ci-private-a',group:'ci-private-g',text:'CI printer'}),journey=await attachInboxJourney(pool,group);
    const direct=await addInboxSession(pool,{reporter:group.reporter,group:null,text:'CI private supplement'});await attachInboxJourney(pool,direct,{journeyId:journey});
    const other=await addInboxSession(pool,{reporter:'ci-private-b',group:'ci-private-g',text:'CI another person'});await attachInboxJourney(pool,other);
    const bot=await addInboxSession(pool,{reporter:group.reporter,group:'ci-private-g',bot:'ci-another-bot',text:'CI another bot'});await attachInboxJourney(pool,bot);
    const get=async(path:string,auth=cookie)=>{const r=await fetch(origin+path,{headers:{cookie:auth}});assert.equal(r.status,200);return r.json();};
    const page=await get('/api/workbench/conversation-inbox?q=CI') as ConversationInboxPage;await assertP2016Schema('workbench_conversation_inbox_page',page);assert.equal(page.items.length,3);assert.equal(new Set(page.items.map(r=>r.contact_ref)).size,3);
    assert.equal((await get('/api/workbench/conversation-inbox?q='+encodeURIComponent('服务受理')) as ConversationInboxPage).items.length,0,'virtual item labels are outside the documented name/topic/Ticket-number search');
    const own=page.items.find(r=>r.anchor_session_id===direct.id||r.anchor_session_id===group.id);assert.ok(own);assert.equal(own.matching_topic_count,1);assert.equal(own.participant_label,'同名报修人');assert.equal(own.unread_count,2);
    const related=await get('/api/workbench/conversations/'+group.id+'/related-sessions') as ConversationRelatedPage;await assertP2016Schema('workbench_conversation_related_page',related);assert.deepEqual(new Set(related.items.map(r=>r.session.session_id)),new Set([group.id,direct.id]));assert.equal(new Set(related.items.map(r=>r.topic_ref)).size,1);assert.ok(related.items.every(r=>r.original_source.kind==='group'));
    const one=await get('/api/workbench/conversations/'+group.id+'/related-sessions?limit=1') as ConversationRelatedPage;assert.ok(one.next_cursor);const two=await get('/api/workbench/conversations/'+group.id+'/related-sessions?limit=1&cursor='+encodeURIComponent(one.next_cursor)) as ConversationRelatedPage;assert.equal(new Set([...one.items,...two.items].map(row=>row.session.session_id)).size,2);
    // Synthetic retained media metadata exercises the new projection's closed
    // output; it is deliberately not a saved asset or a live Provider fetch.
    await pool.query(`UPDATE conversation.item SET safe_content='{"msg_type":"image","has_media":true,"provider_url":"synthetic-provider-canary"}'::jsonb WHERE session_id=$1::uuid AND sequence_no=1`,[direct.id]);
    const media=await get('/api/workbench/conversations/'+direct.id+'/items?view=chat') as ConversationChatItemPage;assert.equal(media.items[0]?.media_availability,'UNAVAILABLE');assert.equal(JSON.stringify(media).includes('synthetic-provider-canary'),false);
    assert.equal((await fetch(origin+'/api/workbench/conversations/'+group.id+'/related-sessions',{headers:{cookie:outsiderCookie}})).status,404);
    for(const canary of ['ci-private-a','ci-private-b','ci-private-g','ci-another-bot','participant_key','channel_account_id','reporter_identity_hash'])assert.equal(JSON.stringify([page,related]).includes(canary),false);
    await pool.query("UPDATE intake.service_intake SET retention_until=platform.local_now()-interval '1 day',retention_until_epoch_ms=platform.physical_epoch_ms()-86400000 WHERE id=$1::uuid",[direct.intakeId]);
    const trimmed=await get('/api/workbench/conversations/'+group.id+'/related-sessions') as ConversationRelatedPage;assert.deepEqual(trimmed.items.map(r=>r.session.session_id),[group.id]);
  },{inbox:true});
});
test('server grouping precedes pagination even when one reporter has over 200 Sessions; cursors are signed and filter bound',async()=>{
  await withT22Fixture(async({origin,cookie,outsiderCookie,pool,runtime})=>{
    for(let i=0;i<205;i++)await addInboxSession(pool,{reporter:'ci-many-sessions',group:'ci-many-'+i,text:'PAGING many topics'});
    for(let i=0;i<34;i++)await addInboxSession(pool,{reporter:'ci-page-person-'+i,group:'ci-page-group',text:'PAGING separate person'});
    const get=(q:string,auth=cookie)=>fetch(origin+'/api/workbench/conversation-inbox?'+q,{headers:{cookie:auth}});
    const first=await get('q=PAGING');assert.equal(first.status,200);const a=await first.json() as ConversationInboxPage;assert.equal(a.items.length,30);assert.ok(a.next_cursor);assert.equal(Buffer.from(a.next_cursor.split('.')[0]??'','base64url').toString().includes('ci-'),false);
    const second=await get('q=PAGING&cursor='+encodeURIComponent(a.next_cursor));assert.equal(second.status,200);const b=await second.json() as ConversationInboxPage;
    const all=[...a.items,...b.items];assert.equal(all.length,35);assert.equal(new Set(all.map(r=>r.contact_ref)).size,35);assert.ok(all.some(r=>r.matching_topic_count===205));assert.equal(b.next_cursor,null);
    assert.equal((await get('q=changed&cursor='+encodeURIComponent(a.next_cursor))).status,400);assert.equal((await get('q=PAGING&cursor='+encodeURIComponent(a.next_cursor),outsiderCookie)).status,400);
    assert.equal((await get('q=PAGING&cursor='+encodeURIComponent(a.next_cursor.slice(0,-1)+'!'))).status,400);
    const cursorAnchor=JSON.parse(Buffer.from(a.next_cursor.split('.')[0]??'','base64url').toString()) as {anchor:string};
    await pool.query("UPDATE conversation.session SET last_activity_at=last_activity_at+interval '1 second' WHERE id=$1::uuid",[cursorAnchor.anchor]);
    assert.equal((await get('q=PAGING&cursor='+encodeURIComponent(a.next_cursor))).status,400,'a changed ordering anchor must reset the cursor');
    console.log('CONVERSATION_INBOX_PAGING '+JSON.stringify({sessions:239,contacts:35,page_sizes:[a.items.length,b.items.length]}));
    const captured:{sql:string;values:unknown[]}[]=[];
    let beforeMaterial:(()=>Promise<void>)|null=null,releaseMaterial:()=>void=()=>{};
    const observed:PostgresPool=new Proxy(pool,{get(target,prop){if(prop==='connect')return async()=>{const client=await target.connect();return new Proxy(client,{get(c,field){if(field==='query')return (sql:string,values:unknown[]=[])=>{if(sql.includes(' AS scope_valid,')){captured.push({sql,values});if(beforeMaterial)return beforeMaterial().then(()=>c.query(sql,values));}return c.query(sql,values);};const value:unknown=Reflect.get(c,field);return typeof value==='function'?value.bind(c):value;}});};const value:unknown=Reflect.get(target,prop);return typeof value==='function'?value.bind(target):value;}});
    const request=new IncomingMessage(new Socket());request.headers.cookie=cookie;
    try{const auth=await runtime.authenticate.authenticate(request);assert.ok(auth);const service=createConversationInbox({pool:observed,authorization:createPilotWorkbenchAuthorizationAdapter({pool:observed}),enabled:true,identityHmacKey:INBOX_IDENTITY_KEY});
      await service.inbox(auth,new URL(origin+'/api/workbench/conversation-inbox?q=PAGING'));assert.equal(captured.length,1,'one bounded batch reads all page material');
      const actual=captured[0];assert.ok(actual);const plan=await pool.query('EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) '+actual.sql,actual.values);
      const value=plan.rows[0]?.['QUERY PLAN'] as { 'Execution Time':number;'Planning Time':number }[];assert.ok(value[0]);
      const directory=process.env.CONVERSATION_INBOX_EVIDENCE_DIR;if(directory)await writeFile(join(directory,'inbox-explain.json'),JSON.stringify(plan.rows,null,2));
      console.log('CONVERSATION_INBOX_EXPLAIN '+JSON.stringify({sessions:239,execution_ms:value[0]['Execution Time'],planning_ms:value[0]['Planning Time'],material_batches:captured.length}));
      let materialEntered:()=>void=()=>{};const entered=new Promise<void>(resolve=>{materialEntered=resolve;}),gate=new Promise<void>(resolve=>{releaseMaterial=resolve;});beforeMaterial=()=>{materialEntered();return gate;};
      const waiting=service.inbox(auth,new URL(origin+'/api/workbench/conversation-inbox?q=PAGING'));await entered;
      await pool.query("UPDATE pilot_ticket.pilot_principal_role SET role='HANDLER' WHERE principal_id=$1::uuid AND role='ADMIN'",[auth.principal_id]);
      releaseMaterial();await assert.rejects(waiting,{code:'WORKBENCH_CURSOR_INVALID'},'current scope must be proved again after the material wait');
    }finally{releaseMaterial();request.socket.destroy();}
  },{inbox:true});
});
test('assignment-derived scope changes invalidate inbox and related cursors while their anchors remain readable',async()=>{
  await withT22Fixture(async({origin,handlerCookie,pool,principals})=>{
    const handler=principals[1];assert.ok(handler);
    const anchor=await addInboxSession(pool,{reporter:'scope-person-a',group:'scope-group',text:'AUTH_SCOPE anchor'});
    const older=await addInboxSession(pool,{reporter:anchor.reporter,group:'scope-older',text:'AUTH_SCOPE older'});
    const other=await addInboxSession(pool,{reporter:'scope-person-b',group:'scope-group',text:'AUTH_SCOPE other'});
    const newlyReadable=await addInboxSession(pool,{reporter:'scope-new-person',group:'scope-group',text:'AUTH_SCOPE newly readable'});
    const newRelated=await addInboxSession(pool,{reporter:anchor.reporter,group:'scope-new-related',text:'AUTH_SCOPE new related'});
    for(const [index,session] of [other,older,anchor,newRelated,newlyReadable].entries())await pool.query("UPDATE conversation.session SET last_activity_at=timestamp '2026-10-16 10:00:00'+($2::integer*interval '1 second') WHERE id=$1::uuid",[session.id,index]);
    const grant=async(id:string)=>{await pool.query("INSERT INTO conversation.assignment(session_id,assignment_status,assigned_principal_id,assigned_by_principal_id,assigned_at) VALUES($1::uuid,'ASSIGNED',$2::uuid,$2::uuid,platform.local_now())",[id,handler.id]);};
    for(const session of [anchor,older,other])await grant(session.id);
    const inbox='/api/workbench/conversation-inbox?q=AUTH_SCOPE&limit=1',related='/api/workbench/conversations/'+anchor.id+'/related-sessions?limit=1';
    const get=(path:string,cursor?:string)=>fetch(origin+path+(cursor?'&cursor='+encodeURIComponent(cursor):''),{headers:{cookie:handlerCookie}});
    const first=await (await get(inbox)).json() as ConversationInboxPage;assert.equal(first.items[0]?.anchor_session_id,anchor.id);assert.ok(first.next_cursor);
    await grant(newlyReadable.id);
    const gained=await get(inbox,first.next_cursor);assert.equal(gained.status,400,'a newly authorized contact before an unchanged boundary must reset pagination');assert.equal((await gained.json() as {error:{code:string}}).error.code,'WORKBENCH_CURSOR_INVALID');
    const reset=await (await get(inbox)).json() as ConversationInboxPage;assert.equal(reset.items[0]?.anchor_session_id,newlyReadable.id);assert.ok(reset.next_cursor);
    await pool.query('DELETE FROM conversation.assignment WHERE session_id=$1::uuid',[other.id]);
    assert.equal((await get(inbox,reset.next_cursor)).status,400,'revoking a non-anchor Session must reset pagination');
    const beforeRelated=await (await get(related)).json() as ConversationRelatedPage;assert.equal(beforeRelated.items[0]?.session.session_id,anchor.id);assert.ok(beforeRelated.next_cursor);
    await grant(newRelated.id);assert.equal((await get(related,beforeRelated.next_cursor)).status,400,'a newly readable related window must reset pagination');
    const afterRelated=await (await get(related)).json() as ConversationRelatedPage;assert.equal(afterRelated.items[0]?.session.session_id,newRelated.id);assert.ok(afterRelated.next_cursor);
    await pool.query('DELETE FROM conversation.assignment WHERE session_id=$1::uuid',[older.id]);assert.equal((await get(related,afterRelated.next_cursor)).status,400);
    assert.equal((await fetch(origin+'/api/workbench/conversations/'+anchor.id+'?view=chat',{headers:{cookie:handlerCookie}})).status,200,'the route anchor remains readable throughout');
  },{inbox:true});
});
test('explicit control conflict, exact historical delivery, same-UUID replay and internal notes keep separate facts',async()=>{
  await withT22Fixture(async({origin,cookie,handlerCookie,pool,sessions})=>{
    const session=sessions[0];assert.ok(session);const path='/api/workbench/conversations/'+session.id;
    await pool.query("UPDATE pilot_ticket.ticket SET resolver_team_id='PILOT_IT' WHERE id=$1::uuid",[session.ticketId]);
    const pair=await Promise.all([conversationPost(origin,cookie,session.id,'takeover',freshCommand()),conversationPost(origin,handlerCookie,session.id,'takeover',freshCommand())]);assert.deepEqual(pair.map(r=>r.status).sort(),[200,409]);
    const owner=pair[0]?.status===200?cookie:handlerCookie;
    const current=await (await fetch(origin+path+'?view=chat',{headers:{cookie:owner}})).json() as ConversationChatEntry;
    const command={...freshCommand(current.session.row_version),text:'CI exact original reply'},accepted=await conversationPost(origin,owner,session.id,'messages',command);assert.equal(accepted.status,202);const message=await accepted.json() as ConversationMessageResult;
    assert.equal((await conversationPost(origin,owner,session.id,'messages',command)).status,202);
    const replay=await (await fetch(origin+path+'/messages/commands/'+command.client_command_id,{headers:{cookie:owner}})).json() as {state:string;result:ConversationMessageResult};assert.equal(replay.state,'COMMITTED');assert.equal(replay.result.message_id,message.message_id);
    const note=await conversationPost(origin,owner,session.id,'internal-notes',{...freshCommand(current.session.row_version),text:'CI internal only'});assert.equal(note.status,201);const noted=await note.json() as ConversationMessageResult;assert.equal(noted.outbox_id,null);assert.deepEqual(noted.delivery_ids,[]);
    const worker=createCommunicationDeliveryWorker({pool,enabled:true,sender:{send:async()=>({outcome:'ACKNOWLEDGED',provider_message_id:null,error_code:null,retryable:false})}});await worker.runOnce();
    const deliveries=await (await fetch(origin+path+'/deliveries?view=chat&message_ids='+message.message_id,{headers:{cookie:owner}})).json() as ConversationChatDeliveryPage;await assertP2016Schema('workbench_conversation_chat_delivery_page',deliveries);assert.equal(deliveries.items.length,1);assert.equal(deliveries.items[0]?.message_id,message.message_id);assert.equal(deliveries.items[0]?.status,'SENT');
    const items=await (await fetch(origin+path+'/items?view=chat',{headers:{cookie:owner}})).json() as ConversationChatItemPage;await assertP2016Schema('workbench_conversation_chat_item_page',items);
    assert.equal((await pool.query<{count:number}>('SELECT count(*)::integer AS count FROM communication.message WHERE client_command_id=$1::uuid',[command.client_command_id])).rows[0]?.count,1);
    const version=(await pool.query<{version:number}>('SELECT row_version::integer AS version FROM conversation.session WHERE id=$1::uuid',[session.id])).rows[0]?.version;assert.ok(version);
    const release=await conversationPost(origin,owner,session.id,'release',freshCommand(version));assert.equal(release.status,200);assert.equal((await pool.query<{control_mode:string}>('SELECT control_mode FROM conversation.session WHERE id=$1::uuid',[session.id])).rows[0]?.control_mode,'HUMAN');
  },{inbox:true});
});

test('chat reads a historical Message beyond the old 100-Delivery window and keeps its sender after transfer',async()=>{
  await withT22Fixture(async({origin,cookie,handlerCookie,pool,sessions,principals,runtime})=>{
    const session=sessions[0],handler=principals[1];assert.ok(session&&handler);const path='/api/workbench/conversations/'+session.id;
    assert.equal((await conversationPost(origin,cookie,session.id,'takeover',freshCommand())).status,200);
    const version=async()=>{const value=(await pool.query<{value:number}>('SELECT row_version::integer AS value FROM conversation.session WHERE id=$1::uuid',[session.id])).rows[0]?.value;assert.ok(value);return value;};
    const first=await conversationPost(origin,cookie,session.id,'messages',{...freshCommand(await version()),text:'HISTORY precise original'});assert.equal(first.status,202);const receipt=await first.json() as ConversationMessageResult;const deliveryId=receipt.delivery_ids[0];assert.ok(deliveryId);
    await createCommunicationDeliveryWorker({pool,enabled:true,sender:{send:async()=>({outcome:'ACKNOWLEDGED',provider_message_id:'history-synthetic',error_code:null,retryable:false})}}).deliver({deliveryId});
    for(let index=0;index<101;index++)assert.equal((await conversationPost(origin,cookie,session.id,'messages',{...freshCommand(await version()),text:'HISTORY later '+index})).status,202);
    const old=await (await fetch(origin+path+'/deliveries',{headers:{cookie}})).json() as {items:{message_id:string}[]};assert.equal(old.items.length,100);assert.equal(old.items.some(row=>row.message_id===receipt.message_id),false);
    const exact=await (await fetch(origin+path+'/deliveries?view=chat&message_ids='+receipt.message_id,{headers:{cookie}})).json() as ConversationChatDeliveryPage;assert.equal(exact.items.length,1);assert.equal(exact.items[0]?.status,'SENT');
    assert.equal((await conversationPost(origin,cookie,session.id,'transfer',{...freshCommand(await version()),target_principal_id:handler.id})).status,200);
    for(let i=0;i<12;i++){await runtime.coordinator.runOnce();if((await pool.query('SELECT 1 FROM conversation.item WHERE source_type=\'COMMUNICATION_MESSAGE\' AND source_id=$1',[receipt.message_id])).rowCount)break;}
    const items=await (await fetch(origin+path+'/items?view=chat&after_sequence=0&limit=200',{headers:{cookie:handlerCookie}})).json() as ConversationChatItemPage;
    const projected=items.items.filter(item=>item.communication_message_id===receipt.message_id);assert.equal(projected.length,1);assert.equal(projected[0]?.sender_label,'林舟');assert.equal(projected[0]?.sender_category,'HUMAN');
    const ended=sessions[2];assert.ok(ended);const historic=await (await fetch(origin+'/api/workbench/conversations/'+ended.id+'?view=chat',{headers:{cookie}})).json() as ConversationChatEntry;assert.deepEqual(historic.capabilities,[]);
  },{inbox:true});
});
