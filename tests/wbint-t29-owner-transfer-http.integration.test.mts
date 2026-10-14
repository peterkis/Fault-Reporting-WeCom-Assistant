import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import type {IncidentOwnerTransferHttpBody} from '../contracts/workbench_incident_owner_transfer_contracts.js';
import {ownerTransferHttp,record,text} from './helpers/t29-owner-transfer-http-fixture.mjs';

// Frozen SOURCE / NOT_RUN: this public HTTP first precedes any new production behavior.
// The historical browser first stays byte-identical and owns the later formal UI proof.
test('T29 real HTTP transfers a currently readable valid Incident target once without changing personal Ticket or notifications',{timeout:240000},async()=>{
  await ownerTransferHttp(async({f,get,post,confirm,posts})=>{
    const id=await confirm(),path='/api/incidents/'+id;
    const before=await get(path);assert.equal(before.status,200);
    const oldOwner=text(record(f.handler).id),targetId=text(record(f.dispatcher).id),actor=text(record(f.admin).id);
    assert.equal(before.body.owner_principal_id,oldOwner);assert.equal(before.body.owner_team_id,null);assert.equal(before.body.row_version,'1');
    // This target really READs this precise Incident before the bounded new query.
    assert.equal((await get(path,1)).status,200);
    const personal=await Promise.all(f.reports.map(async report=>{
      const ticketPath='/api/tickets/'+text(record(report).ticketId);
      return {path:ticketPath,detail:await get(ticketPath),events:await get(ticketPath+'/events?limit=200'),responsibility:await get(ticketPath+'/responsibility')};
    }));
    for(const original of personal){assert.equal(original.detail.status,200);assert.equal(original.events.status,200);assert.equal(original.responsibility.status,200);}
    const notifications=await get(path+'/notifications?limit=100');assert.equal(notifications.status,200);
    const targets=await get(path+'/owner-transfer-targets?limit=30');
    assert.equal(targets.status,200,JSON.stringify(targets.body));
    assert.deepEqual(Object.keys(targets.body).sort(),['items','next_cursor']);assert.ok(Array.isArray(targets.body.items));assert.ok(targets.body.items.length<=30);
    const candidates=targets.body.items.map(record),selected=candidates.find(item=>item.id===targetId);assert.ok(selected);
    assert.deepEqual(Object.keys(selected).sort(),['display_name','id','teams','teams_truncated']);assert.ok(Array.isArray(selected.teams));
    assert.ok(selected.teams.length<=20);assert.ok(selected.teams.map(record).some(team=>team.team_id==='PILOT_IT'));
    assert.equal(candidates.some(item=>item.id===text(record(f.outsider).id)),false);
    const body:IncidentOwnerTransferHttpBody={client_command_id:randomUUID(),reason_code:'OPERATOR_REVIEWED',expected_row_version:'1',owner_principal_id:targetId,owner_team_id:'PILOT_IT'};
    const result=await post(path+'/transfer-owner',body);assert.equal(result.status,200,JSON.stringify(result.body));
    assert.deepEqual(Object.keys(result.body).sort(),['ok','replayed','result_event_id','result_ref_id','result_ref_type','result_row_version']);
    assert.equal(result.body.ok,true);assert.equal(result.body.replayed,false);assert.equal(result.body.result_ref_type,'INCIDENT');assert.equal(result.body.result_ref_id,id);assert.equal(result.body.result_row_version,'2');
    const after=await get(path);assert.equal(after.status,200);assert.equal(after.body.owner_principal_id,targetId);assert.equal(after.body.owner_team_id,'PILOT_IT');assert.equal(after.body.row_version,'2');
    assert.equal(after.body.status,before.body.status);assert.equal(after.body.confirmed_scope,before.body.confirmed_scope);
    const history=await get(path+'/events?limit=200');assert.equal(history.status,200);assert.ok(Array.isArray(history.body.items));
    const events=history.body.items.map(record).filter(event=>event.event_type==='incident.owner.transferred');assert.equal(events.length,1);
    const event=events[0];assert.ok(event);assert.equal(event.id,result.body.result_event_id);assert.equal(event.actor_principal_id,actor);
    assert.match(text(event.occurred_at),/^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$/u);
    assert.deepEqual(event.owner_transfer,{previous:{owner_principal_id:oldOwner,owner_team_id:null},next:{owner_principal_id:targetId,owner_team_id:'PILOT_IT'}});
    assert.equal(posts.filter(request=>request.path===path+'/transfer-owner').length,1);
    for(const original of personal){assert.deepEqual(await get(original.path),original.detail);assert.deepEqual(await get(original.path+'/events?limit=200'),original.events);assert.deepEqual(await get(original.path+'/responsibility'),original.responsibility);}
    assert.deepEqual(await get(path+'/notifications?limit=100'),notifications);
  });
});
