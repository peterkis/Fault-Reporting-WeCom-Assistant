import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {candidateBrowser,record,text} from './helpers/wbint-t27-browser-fixture.mjs';
import {prepareFollowup,personalSnapshots,navigateFollowup,rows} from './helpers/t28-followup-source-fixture.mjs';

// SOURCE_READY / NOT_RUN: a single public W HTTP transfer; no production implementation.
test('T29 an authorized Incident owner transfer selects an already-readable valid target and appends one responsibility history without changing personal Tickets',{timeout:240000},async()=>{
  await candidateBrowser({purpose:'t29owner',reporters:3},async context=>{
    const {http,id,path}=await prepareFollowup(context);
    const before=await http.get(path),oldOwner=text(record(context.f.handler).id),targetId=text(record(context.f.dispatcher).id),actor=text(record(context.f.admin).id);
    assert.equal(before.row_version,'1');assert.equal(before.owner_principal_id,oldOwner);assert.equal(before.owner_team_id,null);
    const personal=await personalSnapshots(http,context.f.reports),notifications=await http.get(path+'/notifications?limit=100');
    // The first missing public behavior must be observed on a future owned native
    // window. Source absence is not RED; no stub response can satisfy this read.
    const targets=await http.get(path+'/owner-transfer-targets?limit=30');
    const selected=rows(targets.items).find(item=>item.id===targetId);assert.ok(selected,'current eligible target must already READ this exact Incident');
    assert.ok(rows(selected.teams).some(team=>team.team_id==='PILOT_IT'),'explicit effective team must contain the target');
    assert.equal(rows(targets.items).some(item=>item.id===text(record(context.f.outsider).id)),false,'ownership must not manufacture READ for an out-of-scope worker');
    const command={client_command_id:randomUUID(),reason_code:'OPERATOR_REVIEWED',expected_row_version:'1',owner_principal_id:targetId,owner_team_id:'PILOT_IT'};
    const response=await http.post(path+'/transfer-owner',command),ack=response.body;
    assert.deepEqual(Object.keys(ack).sort(),['ok','replayed','result_event_id','result_ref_id','result_ref_type','result_row_version']);
    assert.equal(ack.ok,true);assert.equal(ack.result_ref_type,'INCIDENT');assert.equal(ack.result_ref_id,id);assert.equal(ack.result_row_version,'2');assert.equal(ack.replayed,false);
    const after=await http.get(path);
    assert.equal(after.owner_principal_id,targetId);assert.equal(after.owner_team_id,'PILOT_IT');assert.equal(after.row_version,'2');
    assert.equal(after.status,before.status);assert.equal(after.confirmed_scope,before.confirmed_scope);
    const history=rows((await http.get(path+'/events?limit=200')).items).filter(event=>event.event_type==='incident.owner.transferred');
    assert.equal(history.length,1);const event=history[0];assert.ok(event);
    assert.equal(event.id,ack.result_event_id);assert.equal(event.actor_principal_id,actor);
    assert.match(text(event.occurred_at),/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u);
    assert.deepEqual(event.owner_transfer,{previous:{owner_principal_id:oldOwner,owner_team_id:null},next:{owner_principal_id:targetId,owner_team_id:'PILOT_IT'}});
    const sent=rows(await context.browser.evaluate('globalThis.__t27Posts')).filter(post=>post.path===path+'/transfer-owner');
    assert.equal(sent.length,1);assert.deepEqual(JSON.parse(text(sent[0]?.body)),command);
    for(const original of personal){assert.deepEqual(await http.get('/api/tickets/'+original.ticketId),original.detail);assert.deepEqual(await http.get('/api/tickets/'+original.ticketId+'/events?limit=200'),original.events);assert.deepEqual(await http.get('/api/tickets/'+original.ticketId+'/responsibility'),original.responsibility);}
    assert.deepEqual(await http.get(path+'/notifications?limit=100'),notifications,'internal owner transfer creates no external notice intent');
    await navigateFollowup(context,id);
    const displayed=`(()=>{const root=document.querySelector('[data-incident-id="${id}"]');const value=label=>[...(root?.querySelectorAll('dt')??[])].find(item=>item.textContent===label)?.nextElementSibling?.textContent;return value('故障负责人')==='合成调度员'&&value('责任组')==='PILOT_IT'&&value('公共故障版本')==='2';})()`;
    await context.browser.waitFor(displayed);await context.browser.command('Page.reload');await context.browser.waitFor(displayed);
    assert.equal((await http.get(path)).row_version,'2');
  });
});
