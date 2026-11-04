import assert from 'node:assert/strict';
import {test} from 'node:test';
import {decodeNotificationExceptionItem as item,decodeNotificationExceptionPage as page} from '../app/pc-admin/src/contracts/workbench-notification-exception-browser-contracts.mjs';
const parent='11111111-1111-4111-8111-111111111111',delivery='22222222-2222-4222-8222-222222222222';
const fact={domain:'TICKET',parent_id:parent,delivery_id:delivery,source_kind:'TICKET_NOTIFICATION',route_kind:'BOT_DIRECT',destination_type:'PERSON',status:'DEAD_LETTER',side_effect_state:'NOT_ATTEMPTED',attempt_count:1,last_attempt:{attempt_no:1,outcome:'REJECTED_NOT_APPLIED',side_effect_state:'NOT_ATTEMPTED',started_at:'2026-10-14T12:34:56.123456',finished_at:'2026-10-14T12:34:56.123456'},safe_summary:'工单通知',ticket_no:'IT-20261014-0001',ticket_title:'打印设备连接异常（合成）',reporter_name:null,error_code:'FAILURE_RECORDED',created_at:'2026-10-14T12:34:56.123456',updated_at:'2026-10-14T12:34:56.123456',sent_at:null,allowed_actions:['RETRY'],parent_link:'/workbench/app/items/ticket/'+parent};
test('T32 closed browser contract rejects private fields, wrong identities and fabricated control',()=>{
 assert.equal(item(fact).delivery_id,delivery);
 for(const bad of [{...fact,target_id:'PRIVATE'},{...fact,parent_link:'https://outside.test'},{...fact,domain:'SESSION'},{...fact,route_kind:'GROUP'},{...fact,status:'RECONCILIATION_REQUIRED'},{...fact,side_effect_state:'UNKNOWN'},{...fact,attempt_count:-1},{...fact,last_attempt:{...fact.last_attempt,raw_response:'PRIVATE'}},{...fact,domain:'INCIDENT',source_kind:'INCIDENT_LIFECYCLE',parent_link:'/workbench/app/incidents/'+parent}])assert.throws(()=>item(bad),TypeError);
 assert.throws(()=>item(fact,{domain:'TICKET',parent_id:delivery,delivery_id:delivery}),TypeError);
 assert.throws(()=>item(fact,{domain:'TICKET',parent_id:parent,delivery_id:parent}),TypeError);
});
test('N3 source display is closed by domain and accepts an unavailable Session profile without inventing a name',()=>{
 const session={...fact,domain:'SESSION',source_kind:'SESSION_MESSAGE',ticket_no:null,ticket_title:null,parent_link:'/workbench/app/conversations/'+parent};
 assert.equal(item(session).reporter_name,null);assert.equal(item({...session,reporter_name:'欧阳慧敏（合成）'}).reporter_name,'欧阳慧敏（合成）');
 const incident={...session,domain:'INCIDENT',source_kind:'INCIDENT_LIFECYCLE',allowed_actions:[],parent_link:'/workbench/app/incidents/'+parent};assert.equal(item(incident).ticket_no,null);
 for(const bad of [{...fact,ticket_no:null},{...fact,ticket_no:'查看工单'},{...fact,ticket_title:null},{...fact,ticket_title:'题'.repeat(201)},{...fact,reporter_name:'PRIVATE'}, {...session,ticket_no:fact.ticket_no},{...session,ticket_title:fact.ticket_title},{...session,reporter_name:''},{...session,reporter_name:'名'.repeat(129)},{...incident,reporter_name:'PRIVATE'}])assert.throws(()=>item(bad),TypeError);
 for(const key of ['ticket_no','ticket_title','reporter_name']){const missing:Record<string,unknown>={...fact};delete missing[key];assert.throws(()=>item(missing),TypeError);}
});
test('T32 closed page enforces genuine ordering, filter, bounded continuation and calendar times',()=>{
 assert.equal(page({items:[fact],has_more:false,next_cursor:null}).items.length,1);
 for(const date of ['2026-02-29T12:00:00','2026-10-14T24:00:00','2026-10-14T12:60:00','2026-10-14T12:00:00Z'])assert.throws(()=>item({...fact,created_at:date}),TypeError);
 assert.equal(item({...fact,created_at:'2024-02-29T12:00:00'}).created_at,'2024-02-29T12:00:00');
 for(const bad of [{items:[fact,fact],has_more:false,next_cursor:null},{items:[],has_more:true,next_cursor:'opaque'},{items:[fact],has_more:false,next_cursor:'opaque'},{items:[fact],has_more:false,next_cursor:null,total:999},{items:Array.from({length:51},()=>fact),has_more:false,next_cursor:null}])assert.throws(()=>page(bad),TypeError);
 assert.throws(()=>page({items:[fact],has_more:false,next_cursor:null},{domain:'SESSION'}),TypeError);
 assert.throws(()=>page({items:[fact],has_more:false,next_cursor:null},{state:'UNKNOWN'}),TypeError);
});
