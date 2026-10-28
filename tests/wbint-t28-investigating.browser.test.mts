import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {candidateBrowser,record,text} from './helpers/wbint-t27-browser-fixture.mjs';

test('T28 an authorized operator starts investigation from the production Incident detail with an exact parent version and leaves personal Tickets independent',async()=>{
  await candidateBrowser({purpose:'t28invest',reporters:3},async({browser,f,candidateId,origin})=>{
    const get=async(path:string)=>{
      const response=record(await browser.evaluate(`fetch(${JSON.stringify(path)},{credentials:'same-origin',cache:'no-store'}).then(async response=>({status:response.status,body:await response.json()}))`));
      assert.equal(response.status,200,JSON.stringify(response.body));return record(response.body);
    };
    const bootstrap=await get('/api/lifecycle/bootstrap'),csrf=text(bootstrap.csrf_token);
    const post=async(path:string,body:Record<string,unknown>)=>{
      const response=record(await browser.evaluate(`fetch(${JSON.stringify(path)},{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','x-csrf-token':${JSON.stringify(csrf)},'idempotency-key':${JSON.stringify(body.client_command_id)},'if-match':${JSON.stringify('"'+String(body.expected_candidate_version??body.expected_row_version)+'"')}},body:${JSON.stringify(JSON.stringify(body))}}).then(async response=>({status:response.status,body:await response.json()}))`));
      assert.equal(response.status,200,JSON.stringify(response.body));const result=record(response.body);assert.equal(result.ok,true);return result;
    };
    // Setup uses the same authenticated public HTTP commands as the user.
    await post('/api/incident-candidates/'+candidateId+'/start-review',{client_command_id:randomUUID(),reason_code:'OPERATOR_REVIEWED',expected_row_version:'1'});
    const current=await get('/api/incident-candidates/'+candidateId);
    const confirmation=await post('/api/incident-candidates/'+candidateId+'/confirm',{
      client_command_id:randomUUID(),reason_code:'CONFIRMED_SHARED_FAULT',expected_candidate_version:text(current.row_version),
      expected_material_basis:text(current.material_basis),confirmed_scope:'LOCAL',owner_principal_id:text(record(f.handler).id),
      owner_team_id:null,selected_report_refs:f.reports.map(report=>text(record(report).decisionId)),primary_ticket_id:null,
    });
    assert.equal(confirmation.result_ref_type,'INCIDENT');assert.equal(confirmation.result_row_version,'1');
    const incidentId=text(confirmation.result_ref_id),path='/api/incidents/'+incidentId;
    const personal=await Promise.all(f.reports.map(async report=>{
      const ticketId=text(record(report).ticketId);
      return {ticketId,detail:await get('/api/tickets/'+ticketId),events:await get('/api/tickets/'+ticketId+'/events?limit=200'),responsibility:await get('/api/tickets/'+ticketId+'/responsibility')};
    }));
    await browser.command('Page.navigate',{url:origin+'/workbench/app/incidents/'+incidentId});
    await browser.waitFor(`Boolean(document.querySelector('[data-incident-id="${incidentId}"]'))`);
    assert.equal(await browser.evaluate(`document.querySelector('[data-incident-id="${incidentId}"]').innerText.includes('CONFIRMED_LOCAL')`),true);
    // This is the first genuine missing user behavior. Source inspection is
    // not RED; preserve this assertion before the first product change.
    assert.equal(await browser.evaluate('Boolean(document.querySelector(\'.workbench-select[data-field-label="公共故障操作"] select\'))'),true,'production Incident detail must offer the currently authorized follow-up action');
    for(const [label,value] of [['公共故障操作','START_INVESTIGATING'],['决定原因','OPERATOR_REVIEWED']]){
      await browser.evaluate(`(()=>{const select=document.querySelector(${JSON.stringify('.workbench-select[data-field-label="'+label+'"] select')});if(!select)throw Error('T28_MISSING_ACTION_INPUT');select.value=${JSON.stringify(value)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    }
    assert.equal(await browser.evaluate('document.querySelector("[data-action=submit-incident]")?.disabled'),false);
    await browser.evaluate('document.querySelector("[data-action=submit-incident]").click()');
    await browser.waitFor(`document.querySelector('[data-incident-id="${incidentId}"]')?.innerText.includes('INVESTIGATING')===true`);
    const after=await get(path);assert.equal(after.status,'INVESTIGATING');assert.equal(after.row_version,'2');
    const eventPage=await get(path+'/events?limit=200');assert.ok(Array.isArray(eventPage.items));
    const investigation=eventPage.items.map(record).filter(event=>event.event_type==='incident.investigating');
    assert.equal(investigation.length,1);assert.equal(investigation[0]?.old_status,'CONFIRMED_LOCAL');assert.equal(investigation[0]?.new_status,'INVESTIGATING');
    const posts=await browser.evaluate('globalThis.__t27Posts');assert.ok(Array.isArray(posts));
    const investigationPosts=posts.map(record).filter(post=>post.path===path+'/start-investigating');assert.equal(investigationPosts.length,1);
    const command=record(JSON.parse(text(investigationPosts[0]?.body)));assert.equal(command.expected_row_version,'1');assert.equal(command.reason_code,'OPERATOR_REVIEWED');
    assert.deepEqual(Object.keys(command).sort(),['client_command_id','expected_row_version','reason_code']);
    for(const before of personal){assert.deepEqual(await get('/api/tickets/'+before.ticketId),before.detail);assert.deepEqual(await get('/api/tickets/'+before.ticketId+'/events?limit=200'),before.events);assert.deepEqual(await get('/api/tickets/'+before.ticketId+'/responsibility'),before.responsibility);}
    await browser.command('Page.reload');await browser.waitFor(`document.querySelector('[data-incident-id="${incidentId}"]')?.innerText.includes('INVESTIGATING')===true`);
    assert.equal((await get(path)).row_version,'2');
  });
});
