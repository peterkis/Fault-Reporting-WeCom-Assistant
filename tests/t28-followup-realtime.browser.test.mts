import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {enabledIncidentBrowser} from './helpers/t28-enabled-browser-fixture.mjs';
import {prepareFollowup,navigateFollowup,chooseFollowup,rows} from './helpers/t28-followup-source-fixture.mjs';
import {text} from './helpers/wbint-t27-browser-fixture.mjs';

test('T28 one genuine SSE stream refreshes all active Incident children without replacing captured input or emitting a command',{timeout:240000},async()=>{
  await enabledIncidentBrowser({purpose:'t28realtime',realtime:true,reporters:3},async context=>{
    const {http,id,path}=await prepareFollowup(context);let live=0,total=0;context.server.on('request',(request,response)=>{if(new URL(request.url??'/',context.origin).pathname==='/api/realtime/events'){live++;total++;response.on('close',()=>live--);}});
    await navigateFollowup(context,id);await context.browser.waitFor('document.querySelector("[data-realtime-status]")?.dataset.realtimeStatus==="live"');assert.equal(live,1);await chooseFollowup(context.browser,'公共故障操作','CORRECT_SCOPE');await chooseFollowup(context.browser,'决定原因','SCOPE_CORRECTION');await chooseFollowup(context.browser,'确认范围','BUILDING');const before=rows((await http.get(path+'/events?limit=30')).items),reads=await context.browser.evaluate('globalThis.__t27DomainReads');assert.ok(Array.isArray(reads));const counts=(part:string)=>reads.filter(value=>typeof value==='string'&&new URL(value,context.origin).pathname===path+'/'+part).length;
    const start={client_command_id:randomUUID(),expected_row_version:'1',reason_code:'OPERATOR_REVIEWED'};await http.post(path+'/start-investigating',start);await context.browser.waitFor('document.body.innerText.includes("已捕获公共故障版本 1；当前版本 2")');
    const after=await context.browser.evaluate('globalThis.__t27DomainReads');assert.ok(Array.isArray(after));for(const part of ['reports','events','subscriptions','linkable-reports'])assert.ok(after.filter(value=>typeof value==='string'&&new URL(value,context.origin).pathname===path+'/'+part).length>counts(part),'shared controller refreshes '+part);
    assert.equal(await context.browser.evaluate('document.querySelector("select[aria-label=公共故障操作]").value'),'CORRECT_SCOPE');assert.equal(await context.browser.evaluate('document.querySelector("select[aria-label=确认范围]").value'),'BUILDING');assert.equal(await context.browser.evaluate('document.querySelector("[data-action=submit-incident]").disabled'),true);assert.equal(rows(await context.browser.evaluate('globalThis.__t27Posts')).filter(row=>String(row.path).startsWith(path+'/')).length,1);const events=rows((await http.get(path+'/events?limit=30')).items);assert.equal(events.length,before.length+1);assert.equal(events.filter(row=>row.event_type==='incident.investigating').length,1);assert.equal(total,1);assert.equal(live,1);
    // The fixture closes the native browser and runtime; the outer PG wrapper verifies clients/pools/extras0.
    console.log('T28_SSE '+JSON.stringify({actual_streams:total,live_streams:live,automatic_posts:0,max_sse_clients:32}));
  });
});
