import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {withT42BoardBrowser,object} from './helpers/t42-board-browser-fixture.mjs';
import {withT11Fixture,t11Http} from './helpers/t11-completion-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';

test('T42 full-page expansion preserves the original completion intent through a real version conflict',{timeout:240000},async()=>{
  await withT11Fixture(async f=>{
    const ticket=f.tickets[0],cookie=f.browserCookies[0];assert.ok(ticket&&cookie&&typeof cookie.url==='string');
    const http=await t11Http(f),started=await http.start(ticket.ticket.id),directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);
    let browser:Awaited<ReturnType<typeof launchSystemBrowser>>|undefined=undefined,error:unknown;const screenshots:{file:string;width:number;height:number;sha256:string}[]=[];
    try{
      browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:1920,height:1080,cookies:[{...cookie,url:cookie.url}]});assert.ok(browser);
      const card='[data-kind="ticket"][data-item-id="'+ticket.ticket.id+'"]';await browser.waitFor(`Boolean(document.querySelector(${JSON.stringify(card)}))`);
      await browser.evaluate(`document.querySelector(${JSON.stringify(card+' [data-action=board-action-menu]')}).click()`);await browser.evaluate(`document.querySelector(${JSON.stringify(card+' [data-board-action-target=closed]')}).click()`);
      await browser.waitFor("Boolean(document.querySelector('.detail-dialog[open] [data-board-intent-panel]'))");
      await browser.evaluate("document.querySelector('.detail-dialog a[aria-label=展开完整页面]').click()");
      await browser.waitFor("Boolean(document.querySelector('.detail-page #completion-process'))");
      await browser.evaluate("document.querySelector('#completion-process').focus()");await browser.command('Input.insertText',{text:'T42原独立内部过程：展开完整页后仍保留原操作。'});
      await browser.evaluate("document.querySelector('#completion-summary').focus()");await browser.command('Input.insertText',{text:'合成设备已恢复。'});await browser.evaluate("document.querySelector('#completion-confirmed').click()");
      await browser.waitFor("document.querySelector('[data-action=complete-ticket]')?.disabled===false");
      await browser.evaluate("(()=>{const original=globalThis.fetch;globalThis.__t42Completion=null;globalThis.__t42CompletionPosts=0;globalThis.fetch=async(path,options)=>{if(options?.method==='POST'&&String(path).endsWith('/complete')){globalThis.__t42CompletionPosts++;globalThis.__t42Completion=JSON.parse(options.body);await new Promise(resolve=>{globalThis.__t42ReleaseCompletion=resolve;});}return original(path,options);};})()");
      await browser.evaluate("document.querySelector('[data-action=complete-ticket]').click()");await browser.waitFor('globalThis.__t42Completion!==null');
      const original=await browser.evaluate('globalThis.__t42Completion'),note=await http.post(ticket.ticket.id,'internal-notes',{client_command_id:randomUUID(),expected_version:started.version,reason_code:'WORKBENCH_INTERNAL_NOTE',note:'T42真实竞争版本的内部备注',external_visible:false});assert.equal(note.status,200,await note.clone().text());
      const current=await http.detail(ticket.ticket.id);assert.equal(current.status,'IN_PROGRESS');assert.ok(current.version>started.version);
      await browser.evaluate('globalThis.__t42ReleaseCompletion()');await browser.waitFor("document.querySelector('.ticket-completion-state')?.textContent.includes('冲突')");
      assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-board-original-intent]'))"),true,'expansion cannot drop the original board-mode conflict protection');
      assert.deepEqual(JSON.parse(String(await browser.evaluate("document.querySelector('[data-board-original-intent] pre').textContent"))),original);
      assert.equal(await browser.evaluate("document.querySelector('#completion-process').value"),'T42原独立内部过程：展开完整页后仍保留原操作。');
      assert.equal(await browser.evaluate("document.querySelector('#completion-summary').value"),'合成设备已恢复。');assert.equal(await browser.evaluate('globalThis.__t42CompletionPosts'),1);
      assert.equal((await http.detail(ticket.ticket.id)).version,current.version,'conflict has no completion fact or automatic new command');
    }catch(failure){error=failure;}
    if(browser){const pixels=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,'new-detail-1920.png');await writeFile(file,pixels);screenshots.push({file,width:pixels.readUInt32BE(16),height:pixels.readUInt32BE(20),sha256:createHash('sha256').update(pixels).digest('hex')});}
    console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',t42_full_page_intent:true,screenshots}));
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{boardActionsEnabled:true,recoveryEnabled:false});
});

test('T42 preflight real object404 after official assignment clears cached facts while the same actor and business permissions remain current',{timeout:240000},async()=>{
  await withT42BoardBrowser(async(f,browser,card,get)=>{
    const first=f.tickets[0],actor=f.principals[1],admin=f.cookies[0],actorCookie=f.cookies[2];assert.ok(first&&actor&&admin&&actorCookie);const path='/api/tickets/'+first.ticket.id;
    const before=await get('/api/lifecycle/bootstrap');assert.equal(before.realtime_sse_enabled,false);assert.deepEqual(before.roles,['HANDLER']);
    await browser.evaluate(`document.querySelector(${JSON.stringify(card+' [data-action=board-action-menu]')}).click()`);await browser.evaluate(`document.querySelector(${JSON.stringify(card+' [data-board-action-target=active]')}).click()`);
    await browser.waitFor("Boolean(document.querySelector('.detail-dialog[open]'))");await browser.evaluate("document.querySelector('[aria-label=关闭详情]').click()");await browser.waitFor("!document.querySelector('.detail-dialog[open]')");
    await f.pool.query("INSERT INTO pilot_ticket.resolver_team(team_id,display_name) VALUES('T42_OTHER','T42其他合法团队')");
    const target=await createPilotAccessService({pool:f.pool}).upsertPrincipal({wecomUserId:'t42-read-loss-'+randomUUID(),displayName:'T42接单同事',roles:['HANDLER'],resolverTeamIds:['T42_OTHER']});
    const bootstrap=await fetch(f.origin+'/api/lifecycle/bootstrap',{headers:{cookie:admin}});assert.equal(bootstrap.status,200);const csrf=object(await bootstrap.json()).csrf_token,current=await get(path),command={client_command_id:randomUUID(),expected_version:current.version,reason_code:'WORKBENCH_ASSIGN',target_principal_id:target.id,resolver_team_id:'T42_OTHER',communication_choice:'RETAIN_CURRENT',sessions:[]};
    const assigned=await fetch(f.origin+path+'/assign',{method:'POST',headers:{cookie:admin,origin:f.origin,'content-type':'application/json','x-csrf-token':String(csrf),'idempotency-key':command.client_command_id,'if-match':'"'+String(current.version)+'"'},body:JSON.stringify(command)});assert.equal(assigned.status,200,await assigned.clone().text());
    const denied=await fetch(f.origin+'/api/workbench/items/ticket/'+first.ticket.id,{headers:{cookie:actorCookie}});assert.equal(denied.status,404);await denied.arrayBuffer();
    const after=await get('/api/lifecycle/bootstrap');assert.equal(after.principal_id,before.principal_id);assert.deepEqual(after.roles,before.roles);assert.equal(after.authorization_revision,before.authorization_revision);assert.equal(after.ticket_self_handling_enabled,true);
    assert.equal(await browser.evaluate(`Boolean(document.querySelector(${JSON.stringify(card)}))`),true,'T38 off leaves the previously confirmed cached card until this explicit preflight');
    await browser.evaluate("(()=>{const original=globalThis.fetch;globalThis.__t42ObjectDenied=0;globalThis.fetch=async(path,options)=>{const response=await original(path,options);if(String(path).startsWith('/api/workbench/items/')&&response.status===404)globalThis.__t42ObjectDenied++;return response;};})()");
    await browser.evaluate(`document.querySelector(${JSON.stringify(card+' [data-action=board-action-menu]')}).click()`);await browser.evaluate(`document.querySelector(${JSON.stringify(card+' [data-board-action-target=active]')}).click()`);
    await browser.waitFor(`globalThis.__t42ObjectDenied>0&&!document.querySelector(${JSON.stringify(card)})`);
    assert.equal(await browser.evaluate("Boolean(document.querySelector('.detail-dialog[open]'))"),false);assert.equal(await browser.evaluate("Boolean(document.querySelector('.workspace'))"),true,'object loss must preserve the valid session and other current work');
    assert.deepEqual(await browser.evaluate('globalThis.__t42Writes'),[]);
  },{principalIndex:2,assignment:true});
});

test('T42 preflight real401 clears the session view rather than retain the cached board',{timeout:240000},async()=>{
  await withT42BoardBrowser(async(f,browser,card)=>{
    const cookie=f.browserCookies[0];assert.ok(cookie);
    await browser.evaluate("(()=>{const original=globalThis.fetch;globalThis.__t42SessionDenied=0;globalThis.fetch=async(path,options)=>{const response=await original(path,options);if(String(path)==='/api/lifecycle/bootstrap'&&response.status===401)globalThis.__t42SessionDenied++;return response;};})()");
    await browser.command('Network.deleteCookies',{name:cookie.name,url:f.origin+'/'});
    await browser.evaluate(`document.querySelector(${JSON.stringify(card+' [data-action=board-action-menu]')}).click()`);await browser.evaluate(`document.querySelector(${JSON.stringify(card+' [data-board-action-target=active]')}).click()`);
    await browser.waitFor("globalThis.__t42SessionDenied>0&&!document.querySelector('.workspace')");
    assert.deepEqual(await browser.evaluate('globalThis.__t42Writes'),[]);
  });
});
