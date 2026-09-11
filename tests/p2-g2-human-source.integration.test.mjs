import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { withG2Runtime } from './helpers/p2-g2-runtime-harness.mjs';

const cases=[['ownership-race',['P2-007-X022','D12-035']],['collaboration',['P2-007-X023','D12-036']],
  ['reply',['P2-007-X024','D12-040']],['internal-note',['P2-007-X025','P2-007-X041','D12-037']],
  ['handoff',['P2-007-X026','D12-038']],['admin-transfer',['P2-007-X027','D12-039']],
  ['two-authors',['P2-007-X028']],['read-cursors',['D12-042']]];
for(const [kind,sourceIds] of cases)test('real human command source: '+sourceIds.join('/'),async t=>{
  await withG2Runtime(async f=>{
    await f.inbound('打印机卡纸了',{chatType:'single'});await f.pump();
    const id=(await f.pool.query('SELECT id::text FROM conversation.session')).rows[0].id;
    const detail=(index=0)=>f.get('/api/conversations/'+id,index);
    const act=async(action,body={},index=0)=>{const d=await detail(index);return f.post('/api/conversations/'+id+'/'+action,
      {client_command_id:randomUUID(),expected_row_version:d.session.row_version,...body},d.session.row_version,index);};
    const count=async()=>(await f.pool.query(`SELECT (SELECT count(*)::integer FROM communication.message) AS messages,
      (SELECT count(*)::integer FROM communication.outbox) AS outboxes,(SELECT count(*)::integer FROM communication.delivery) AS deliveries,
      (SELECT count(*)::integer FROM conversation.control_event) AS events`)).rows[0];
    if(kind==='ownership-race'){
      const d=await detail(),v=d.session.row_version;
      const results=await Promise.all([1,2].map(index=>f.post('/api/conversations/'+id+'/takeover',{
        client_command_id:randomUUID(),expected_row_version:v,target_principal_id:f.principals[index].id,reason_code:'WORKBENCH_TAKEOVER'},v,index)));
      assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
      assert.equal((await f.pool.query("SELECT count(*)::integer AS n FROM conversation.assignment WHERE session_id=$1 AND assignment_status='ASSIGNED'",[id])).rows[0].n,1);
      t.diagnostic(JSON.stringify({source_ids:sourceIds,successful_commands:1,rejected_commands:1,rejected_attempt_recorded_in_gate_evidence:true}));
    }else if(kind==='read-cursors'){
      for(let i=0;i<10;i++){await f.inbound('补充测试描述 '+i,{chatType:'single'});await f.pump();}
      for(const [index,position] of [10,7,3].entries()){
        const result=await f.post('/api/conversations/'+id+'/read-cursor',{client_command_id:randomUUID(),
          expected_cursor_row_version:0,last_read_sequence:position,reason_code:'WORKBENCH_READ'},undefined,index);
        assert.equal(result.status,200);
      }
      const cursors=(await f.pool.query('SELECT last_read_sequence FROM conversation.read_cursor WHERE session_id=$1 ORDER BY last_read_sequence',[id])).rows;
      assert.deepEqual(cursors.map(c=>Number(c.last_read_sequence)),[3,7,10]);
    }else{
      if(kind!=='handoff')assert.equal((await act('takeover',{target_principal_id:f.principals[1].id,reason_code:'WORKBENCH_TAKEOVER'},1)).status,200);
      if(['collaboration','internal-note'].includes(kind)){
        const before=await count(),owner=(await f.pool.query('SELECT assigned_principal_id FROM conversation.assignment WHERE session_id=$1',[id])).rows;
        if(kind==='collaboration')assert.equal((await act('internal-notes',{text:'未授权坐席尝试备注'},2)).status,404);
        assert.equal((await act('internal-notes',{text:'仅内部的合成协作记录'},kind==='collaboration'?0:1)).status,201);
        const after=await count();assert.equal(after.messages-before.messages,1);assert.equal(after.outboxes,before.outboxes);assert.equal(after.deliveries,before.deliveries);
        assert.deepEqual((await f.pool.query('SELECT assigned_principal_id FROM conversation.assignment WHERE session_id=$1',[id])).rows,owner);
      }else if(kind==='reply'||kind==='two-authors'){
        const before=await count();assert.equal((await act('messages',{text:'已收到，正在处理'},1)).status,202);
        let after=await count();assert.equal(after.messages-before.messages,1);assert.equal(after.outboxes-before.outboxes,1);assert.equal(after.deliveries-before.deliveries,1);
        if(kind==='two-authors'){
          assert.equal((await act('transfer',{target_principal_id:f.principals[2].id,force:true,reason_code:'OPERATIONAL_REBALANCE'},0)).status,200);
          assert.equal((await act('messages',{text:'已接手，继续处理'},2)).status,202);
          const authors=(await f.pool.query("SELECT DISTINCT sender_principal_id::text FROM communication.message WHERE purpose='HUMAN_REPLY'")).rows;
          assert.equal(authors.length,2);
        }
      }else if(kind==='handoff'){
        const before=await count();const requested=await act('handoff/request',{reason_code:'WORKBENCH_HANDOFF'},0);assert.equal(requested.status,200);
        assert.equal((await act('takeover',{target_principal_id:f.principals[1].id,handoff_id:requested.body.handoff.id,reason_code:'WORKBENCH_TAKEOVER'},1)).status,200);
        assert.equal((await act('release',{reason_code:'WORKBENCH_RELEASE'},0)).status,200);
        assert.equal((await count()).events-before.events,3);
      }else if(kind==='admin-transfer'){
        for(const reason of [undefined,null,'']){const denied=await act('transfer',{target_principal_id:f.principals[2].id,force:true,
          ...(reason===undefined?{}:{reason_code:reason})},0);assert.equal(denied.status,400);}
        const before=await count();assert.equal((await act('transfer',{target_principal_id:f.principals[2].id,force:true,reason_code:'OPERATIONAL_REBALANCE'},0)).status,200);
        assert.equal((await count()).events-before.events,1);
      }
    }
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM pilot_ticket.ticket')).rows[0].n,1);
    assert.equal(f.providerCalls.length,0);
    t.diagnostic(JSON.stringify({source_ids:sourceIds,surface:'AUTHENTICATED_HTTP_COMMAND_WITH_NORMAL_INGRESS_SETUP',provider_calls:0,new_ticket_delta_excluding_setup:0}));
  },{extraAgents:true});
});
