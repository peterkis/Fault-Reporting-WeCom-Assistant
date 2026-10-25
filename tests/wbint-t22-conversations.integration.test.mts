import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createCommunicationDeliveryWorker} from '../app/server/src/p2-004-communication-delivery-worker.mjs';
import {withT22Fixture,appendT22Item} from './helpers/wbint-t22-fixture.mjs';
import type {ConversationMessageResult,ConversationCommandReceipt} from '../contracts/workbench_conversation_workspace_contracts.js';

test('the authorized conversation workspace keeps same-group participants and topics separate and exposes only real canonical links',async()=>{
  await withT22Fixture(async({origin,cookie,outsiderCookie,sessions})=>{
    const response=await fetch(origin+'/api/workbench/conversations',{headers:{cookie}});assert.equal(response.status,200);
    const body=await response.json() as {items:{session:{session_id:string};participant_label:string;topic:string;canonical_item:{kind:string;id:string}|null}[]};
    assert.equal(body.items.length,2);for(const session of sessions.slice(0,2)){const entry=body.items.find(item=>item.session.session_id===session.id);assert.ok(entry);assert.equal(entry.canonical_item?.kind,'ticket');assert.equal(entry.canonical_item.id,session.ticketId);assert.ok(entry.topic);assert.ok(entry.participant_label);}
    const text=JSON.stringify(body);for(const canary of ['t22-private-group-id','t22-reporter-a','t22-reporter-b','t22-synthetic-bot','participant_key','thread_id'])assert.equal(text.includes(canary),false);
    assert.equal((await fetch(origin+'/api/workbench/conversations',{headers:{cookie:outsiderCookie}})).status,200);
    const hidden=await fetch(origin+'/api/workbench/conversations/'+sessions[0]?.id,{headers:{cookie:outsiderCookie}});assert.equal(hidden.status,404);
  });
});

test('sequence pagination retains delayed material without dropping lower sequences and expires sensitive items',async()=>{
  await withT22Fixture(async({origin,cookie,pool,sessions})=>{
    const session=sessions[0];assert.ok(session);await appendT22Item(pool,session.id,2,'T22 delayed older timestamp',10);await appendT22Item(pool,session.id,3,'T22 current timestamp');
    let after='0';const sequences:string[]=[];
    for(let page=0;page<4;page++){
      const response=await fetch(origin+'/api/workbench/conversations/'+session.id+'/items?'+new URLSearchParams({after_sequence:after,limit:'1'}),{headers:{cookie}});assert.equal(response.status,200);
      const data=await response.json() as {items:{sequence_no:string}[];after_sequence:string|null;has_more:boolean};sequences.push(...data.items.map(item=>item.sequence_no));if(!data.has_more)break;assert.ok(data.after_sequence);after=data.after_sequence;
    }
    assert.deepEqual(sequences,['1','2','3']);
    await pool.query("UPDATE conversation.item SET retention_until=platform.local_now()-interval '1 day' WHERE session_id=$1::uuid AND sequence_no=2",[session.id]);
    const page=await (await fetch(origin+'/api/workbench/conversations/'+session.id+'/items',{headers:{cookie}})).json() as {items:{sequence_no:string;text:string}[]};assert.deepEqual(page.items.map(item=>item.sequence_no),['1','3']);assert.equal(JSON.stringify(page).includes('T22 delayed older timestamp'),false);
  });
});

test('the enabled reporter-private policy forbids quote context from another participant session even through the retained legacy endpoint',async()=>{
  await withT22Fixture(async({origin,cookie,pool,sessions})=>{
    const session=sessions[0],other=sessions[1];assert.ok(session);assert.ok(other);
    const quote=await appendT22Item(pool,other.id,2,'T22 other participant private quote');
    const bootstrap=await (await fetch(origin+'/api/workbench/bootstrap',{headers:{cookie}})).json() as {csrf_token:string};
    const command={client_command_id:randomUUID(),expected_row_version:session.rowVersion,text:'T22 synthetic context check',reply_to_item_id:quote};
    const response=await fetch(origin+'/api/conversations/'+session.id+'/messages',{method:'POST',headers:{cookie,origin,'x-csrf-token':bootstrap.csrf_token,'content-type':'application/json','idempotency-key':command.client_command_id,'if-match':'"'+command.expected_row_version+'"'},body:JSON.stringify(command)});assert.equal(response.status,400);
    assert.equal((await pool.query<{count:number}>('SELECT count(*)::integer AS count FROM communication.message WHERE client_command_id=$1::uuid',[command.client_command_id])).rows[0]?.count,0);
  });
});

test('the concentrated workspace offers lawful communication controls, notes without deliveries, and authorized real item links',async()=>{
  await withT22Fixture(async({origin,cookie,handlerCookie,pool,sessions,tickets,principals})=>{
    const session=sessions[0],other=sessions[1],unbound=tickets[5];assert.ok(session);assert.ok(other);assert.ok(unbound);
    const path='/api/workbench/conversations/'+session.id,get=(part='',auth=cookie)=>fetch(origin+path+part,{headers:{cookie:auth}});
    const initial=await get();assert.equal(initial.status,200);
    const bootstrap=await (await fetch(origin+'/api/workbench/bootstrap',{headers:{cookie}})).json() as {csrf_token:string};
    const post=(action:string,body:Record<string,unknown>,auth=cookie,csrf=bootstrap.csrf_token)=>fetch(origin+path+'/'+action,{method:'POST',headers:{cookie:auth,origin,'x-csrf-token':csrf,'content-type':'application/json','idempotency-key':String(body.client_command_id),'if-match':'"'+String(body.expected_row_version)+'"'},body:JSON.stringify(body)});
    const beforeTicket=(await pool.query<{assignee_id:string|null;version:number}>('SELECT assignee_id::text,version FROM pilot_ticket.ticket WHERE id=$1::uuid',[session.ticketId])).rows[0];
    const takeover=await post('takeover',{client_command_id:randomUUID(),expected_row_version:session.rowVersion});assert.equal(takeover.status,200);
    const controlled=await (await get()).json() as {session:{row_version:number};assignment:{assigned_to_me:boolean};capabilities:string[]};assert.equal(controlled.assignment.assigned_to_me,true);assert.equal(controlled.capabilities.includes('TAKEOVER'),false);
    const note=await post('internal-notes',{client_command_id:randomUUID(),expected_row_version:controlled.session.row_version,text:'T22 private internal note'});assert.equal(note.status,201);const result=await note.json() as ConversationMessageResult;assert.equal(result.outbox_id,null);assert.deepEqual(result.delivery_ids,[]);
    const own=await (await get('/items')).json() as {items:{text:string|null}[]};assert.ok(own.items.some(item=>item.text==='参与者甲的打印机主题'));assert.equal(own.items.some(item=>item.text==='参与者乙的护理主题'),false);
    const links=await fetch(origin+'/api/workbench/items/ticket/'+session.ticketId+'/conversations',{headers:{cookie}});assert.equal(links.status,200);assert.deepEqual((await links.json() as {items:{session:{session_id:string}}[]}).items.map(item=>item.session.session_id),[session.id]);
    const empty=await fetch(origin+'/api/workbench/items/ticket/'+unbound.ticket.id+'/conversations',{headers:{cookie}});assert.equal(empty.status,200);assert.deepEqual((await empty.json() as {items:unknown[]}).items,[]);
    assert.equal((await post('messages',{client_command_id:randomUUID(),expected_row_version:controlled.session.row_version,text:'quote must not cross sessions',reply_to_item_id:await appendT22Item(pool,other.id,2,'other-participant canary')})).status,400);
    const transfer=await post('transfer',{client_command_id:randomUUID(),expected_row_version:controlled.session.row_version,target_principal_id:principals[1]?.id});assert.equal(transfer.status,200);
    const handlerBootstrap=await (await fetch(origin+'/api/workbench/bootstrap',{headers:{cookie:handlerCookie}})).json() as {csrf_token:string};
    const latest=await (await get('',handlerCookie)).json() as {session:{row_version:number};assignment:{assigned_to_me:boolean};capabilities:string[]};assert.equal(latest.assignment.assigned_to_me,true);assert.equal(latest.capabilities.includes('TRANSFER'),true);
    const release=await post('release',{client_command_id:randomUUID(),expected_row_version:latest.session.row_version},handlerCookie,handlerBootstrap.csrf_token);assert.equal(release.status,200);
    assert.deepEqual((await pool.query('SELECT assignee_id::text,version FROM pilot_ticket.ticket WHERE id=$1::uuid',[session.ticketId])).rows[0],beforeTicket);
    assert.equal((await pool.query<{count:number}>('SELECT count(*)::integer AS count FROM communication.outbox WHERE message_id=$1::uuid',[result.message_id])).rows[0]?.count,0);
  });
});

test('a group human reply reaches only its persisted reporter and its original commit remains recoverable after new material',async()=>{
  await withT22Fixture(async({origin,cookie,pool,sessions,handlerCookie})=>{
    const session=sessions[0];assert.ok(session);
    const bootstrap=await (await fetch(origin+'/api/workbench/bootstrap',{headers:{cookie}})).json() as {csrf_token:string};
    const command={client_command_id:randomUUID(),expected_row_version:session.rowVersion,text:'T22 synthetic reply'};
    const post=(body=command)=>fetch(origin+'/api/conversations/'+session.id+'/messages',{method:'POST',headers:{cookie,origin,'content-type':'application/json','idempotency-key':body.client_command_id,'if-match':'"'+body.expected_row_version+'"','x-csrf-token':bootstrap.csrf_token},body:JSON.stringify(body)});
    const accepted=await post();assert.equal(accepted.status,202);const result=await accepted.json() as ConversationMessageResult;assert.equal(result.delivery_ids.length,1);
    const pending=await (await fetch(origin+'/api/conversations/'+session.id+'/deliveries',{headers:{cookie}})).json() as {items:{delivery_id:string;status:string}[]};assert.equal(pending.items.find(d=>d.delivery_id===result.delivery_ids[0])?.status,'PENDING');
    const destinations:{target_type:string;target_id:string}[]=[];
    const worker=createCommunicationDeliveryWorker({pool,enabled:true,sender:{send:async request=>{destinations.push({target_type:request.target_type,target_id:request.target_id});return {outcome:'ACKNOWLEDGED',provider_message_id:'t22-synthetic-sent',error_code:null,retryable:false};}}});
    await worker.deliver({deliveryId:result.delivery_ids[0]??''});assert.deepEqual(destinations,[{target_type:'PERSON',target_id:session.reporter}]);
    // Synthetic source arrival advances the current material fence; it cannot rewrite the committed command's captured fence.
    await pool.query('UPDATE conversation.session SET row_version=row_version+1,generation_version=generation_version+1 WHERE id=$1::uuid',[session.id]);
    const replay=await post();assert.equal(replay.status,202);const repeated=await replay.json() as ConversationMessageResult;assert.equal(repeated.message_id,result.message_id);assert.deepEqual(repeated.delivery_ids,result.delivery_ids);assert.equal(repeated.replayed,true);assert.equal(destinations.length,1);
    const stale=await post({...command,client_command_id:randomUUID()});assert.equal(stale.status,409);
    const receiptPath='/api/workbench/conversations/'+session.id+'/messages/commands/'+command.client_command_id;
    const read=await fetch(origin+receiptPath,{headers:{cookie}});assert.equal(read.status,200);const receipt=await read.json() as ConversationCommandReceipt;assert.equal(receipt.state,'COMMITTED');if(receipt.state==='COMMITTED')assert.equal(receipt.result.message_id,result.message_id);
    const other=await fetch(origin+receiptPath,{headers:{cookie:handlerCookie}});assert.equal(other.status,200);assert.equal((await other.json() as ConversationCommandReceipt).state,'UNKNOWN');
    const wrongPurpose=await fetch(origin+receiptPath.replace('/messages/','/internal-notes/'),{headers:{cookie}});assert.equal(wrongPurpose.status,200);assert.equal((await wrongPurpose.json() as ConversationCommandReceipt).state,'UNKNOWN');
    const deliveries=await fetch(origin+'/api/workbench/conversations/'+session.id+'/deliveries',{headers:{cookie}});assert.equal(deliveries.status,200);const exact=await deliveries.json() as {items:{message_id:string;delivery_id:string;status:string}[]};assert.equal(exact.items.find(d=>d.message_id===result.message_id&&d.delivery_id===result.delivery_ids[0])?.status,'SENT');
    assert.equal(JSON.stringify(receipt).includes(command.text),false);
  });
});
