import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {withT42BoardBrowser,object} from './helpers/t42-board-browser-fixture.mjs';

test('T42 narrow long-content reduced-motion board has keyboard-equivalent actions and cancel keeps the original form input',{timeout:240000},async()=>{
  await withT42BoardBrowser(async(f,browser,card,get)=>{
    const first=f.tickets[0];assert.ok(first);
    const enter=async()=>{await browser.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});await browser.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});};
    assert.equal(await browser.evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches"),true);
    assert.ok(String(await browser.evaluate(`document.querySelector(${JSON.stringify(card+' h3')}).textContent`)).length>120);
    const title=object(await browser.evaluate(`(()=>{const bounds=document.querySelector(${JSON.stringify(card+' h3')}).getBoundingClientRect();return {x:bounds.x+8,y:bounds.y+8};})()`));assert.equal(typeof title.x,'number');assert.equal(typeof title.y,'number');
    await browser.command('Input.dispatchMouseEvent',{type:'mousePressed',x:title.x,y:title.y,button:'left',clickCount:1});
    await browser.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:Number(title.x)+90,y:title.y,button:'left',buttons:1});
    await browser.command('Input.dispatchMouseEvent',{type:'mouseReleased',x:Number(title.x)+90,y:title.y,button:'left',clickCount:1});
    assert.ok(Number(await browser.evaluate("getSelection()?.toString().length??0"))>0,'text selection must remain possible outside the explicit handle');
    await browser.command('Input.dispatchMouseEvent',{type:'mouseWheel',x:title.x,y:title.y,deltaX:0,deltaY:80});
    assert.equal(await browser.evaluate("Boolean(document.querySelector('.is-dragging'))"),false);
    await browser.evaluate(`document.querySelector(${JSON.stringify(card+' [data-action=board-action-menu]')}).focus()`);
    await enter();
    await browser.waitFor(`Boolean(document.querySelector(${JSON.stringify(card+' [data-board-action-target=active]')}))`);
    await browser.evaluate(`document.querySelector(${JSON.stringify(card+' [data-board-action-target=closed]')}).focus()`);
    for(const type of ['rawKeyDown','keyUp'])await browser.command('Input.dispatchKeyEvent',{type,key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    assert.equal(await browser.evaluate(`Boolean(document.querySelector(${JSON.stringify(card+' [data-board-action-target=closed]')}))`),false);
    assert.equal(await browser.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(card+' [data-action=board-action-menu]')})`),true);
    await enter();
    await browser.evaluate(`document.querySelector(${JSON.stringify(card+' [data-board-action-target=closed]')}).focus()`);
    await enter();
    await browser.waitFor("document.querySelector('[data-board-action-status]')?.textContent.includes('不能执行合法业务动作')");
    assert.equal(await browser.evaluate("Boolean(document.querySelector('.detail-dialog'))"),false);
    assert.deepEqual(await browser.evaluate('globalThis.__t42Writes'),[]);
    await browser.evaluate(`document.querySelector(${JSON.stringify(card+' [data-action=board-action-menu]')}).focus()`);
    await enter();
    await browser.evaluate(`document.querySelector(${JSON.stringify(card+' [data-board-action-target=active]')}).focus()`);
    await enter();
    await browser.waitFor("Boolean(document.querySelector('.detail-dialog [data-board-intent-panel]'))");
    await browser.waitFor("Boolean(document.querySelector('.detail-dialog textarea[aria-label=内部备注]'))");
    await browser.waitFor("document.querySelector('.detail-dialog textarea[aria-label=内部备注]')?.checkVisibility()===true");
    await browser.evaluate("document.querySelector('.detail-dialog textarea[aria-label=内部备注]').focus()");
    assert.equal(await browser.evaluate("document.activeElement===document.querySelector('.detail-dialog textarea[aria-label=内部备注]')"),true);await browser.command('Input.insertText',{text:'尚未提交的本页原输入；取消移动不能删除。'});
    const original=await browser.evaluate("document.querySelector('.detail-dialog textarea[aria-label=内部备注]').value");assert.equal(original,'尚未提交的本页原输入；取消移动不能删除。');
    await browser.evaluate("document.querySelector('[data-action=cancel-board-move]').click()");
    assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-board-intent-panel]'))"),false);
    assert.equal(await browser.evaluate("document.querySelector('.detail-dialog textarea[aria-label=内部备注]').value"),original);
    assert.equal(await browser.evaluate("Boolean(document.querySelector('.is-dragging'))"),false);
    assert.deepEqual(await browser.evaluate('globalThis.__t42Writes'),[]);
    assert.equal((await get('/api/tickets/'+first.ticket.id)).status,'QUEUED');
    assert.equal(await browser.evaluate("document.getAnimations().filter(animation=>animation.effect?.target instanceof Element&&animation.effect.target.closest('[data-board-drop-column]')).length"),0);
  },{width:600,reduceMotion:true,longTitle:true});
});

test('T42 cancel preserves a lost-ACK original command and explicit verification reuses its exact UUID and body',{timeout:240000},async()=>{
  await withT42BoardBrowser(async(f,browser,card,get)=>{
    const first=f.tickets[0];assert.ok(first);const path='/api/tickets/'+first.ticket.id;
    await browser.evaluate(`document.querySelector(${JSON.stringify(card+' [data-action=board-action-menu]')}).click()`);await browser.evaluate(`document.querySelector(${JSON.stringify(card+' [data-board-action-target=active]')}).click()`);
    await browser.waitFor("document.querySelector('[data-action=take-and-start]')?.disabled===false");await browser.evaluate("document.querySelector('[data-action=take-and-start]').click()");
    await browser.waitFor("document.querySelector('.ticket-handling-state')?.textContent.includes('结果未知')");
    const before=await browser.evaluate('globalThis.__t42Writes');assert.ok(Array.isArray(before));assert.equal(before.length,1);
    const committed=await get(path);assert.equal(committed.status,'IN_PROGRESS');
    await browser.evaluate("document.querySelector('[data-action=cancel-board-move]').click()");
    assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-action=check-self-handling]'))"),true);
    assert.deepEqual(await browser.evaluate('globalThis.__t42Writes'),before,'cancel must not automatically replay');
    f.restoreSelfHandlingResponses();await browser.evaluate("document.querySelector('[data-action=check-self-handling]').click()");
    await browser.waitFor("document.querySelector('.ticket-handling-state')?.textContent.includes('已核对')");
    const after=await browser.evaluate('globalThis.__t42Writes');assert.ok(Array.isArray(after));assert.equal(after.length,2);assert.deepEqual(after[1],after[0]);
    assert.equal((await get(path)).version,committed.version,'original replay must not create another cycle or state change');
  },{dropSelfHandlingResponses:true});
});

test('T42 real competing command produces conflict without losing the original command or moving by the requested target',{timeout:240000},async()=>{
  await withT42BoardBrowser(async(f,browser,card,get)=>{
    const first=f.tickets[0],cookie=f.cookies[0];assert.ok(first&&cookie);const path='/api/tickets/'+first.ticket.id,initial=await get(path);
    await browser.evaluate(`document.querySelector(${JSON.stringify(card+' [data-action=board-action-menu]')}).click()`);await browser.evaluate(`document.querySelector(${JSON.stringify(card+' [data-board-action-target=active]')}).click()`);
    await browser.waitFor("document.querySelector('[data-action=take-and-start]')?.disabled===false");
    await browser.waitFor("document.querySelector('[data-realtime-status]')?.getAttribute('data-realtime-status')==='live'");
    const originalWorkspace=await browser.evaluate('({href:location.href,timeOrigin:performance.timeOrigin})');
    // Hold only transport dispatch; both competing commands still use the real official HTTP/Core.
    await browser.evaluate(`(()=>{const original=globalThis.fetch;globalThis.__t42Held=null;globalThis.fetch=async(path,options)=>{if(options?.method==='POST'&&String(path).endsWith('/take-and-start')){globalThis.__t42Held={path:String(path),body:JSON.parse(options.body)};await new Promise(resolve=>{globalThis.__t42Release=resolve;});}return original(path,options);};})()`);
    await browser.evaluate("document.querySelector('[data-action=take-and-start]').click()");await browser.waitFor('globalThis.__t42Held!==null');
    const held=object(await browser.evaluate('globalThis.__t42Held')),bootstrap=await get('/api/lifecycle/bootstrap'),uuid=randomUUID();
    assert.equal(typeof bootstrap.csrf_token,'string');assert.equal(typeof initial.version,'number');
    const response=await fetch(f.origin+path+'/accept-for-later',{method:'POST',headers:{cookie,origin:f.origin,'content-type':'application/json','x-csrf-token':String(bootstrap.csrf_token),'idempotency-key':uuid,'if-match':'"'+String(initial.version)+'"'},body:JSON.stringify({client_command_id:uuid,expected_version:initial.version,reason_code:'WORKBENCH_SELF_HANDLING',resolver_team_id:initial.resolver_team_id})});
    assert.equal(response.status,200,await response.clone().text());const accepted=await get(path);assert.equal(accepted.status,'ACCEPTED');
    await browser.waitFor(`document.querySelector('.ticket-handling-version')?.textContent===${JSON.stringify('工单版本 ')}+${JSON.stringify(accepted.version)}`);
    assert.deepEqual(await browser.evaluate('({href:location.href,timeOrigin:performance.timeOrigin})'),originalWorkspace,'current refresh must not replace the held operation target or reload its workspace');
    await browser.evaluate('globalThis.__t42Release()');await browser.waitFor("Boolean(document.querySelector('[data-board-original-intent]'))");
    const original=JSON.parse(String(await browser.evaluate("document.querySelector('[data-board-original-intent] pre').textContent")));assert.deepEqual(object(original).command,held.body);
    assert.equal((await get(path)).version,accepted.version);assert.equal((await get(path)).status,'ACCEPTED');
    assert.equal(await browser.evaluate('globalThis.__t42Writes.length'),1);
    await browser.evaluate("document.querySelector('[data-action=cancel-board-move]').click()");
    assert.deepEqual(JSON.parse(String(await browser.evaluate("document.querySelector('[data-board-original-intent] pre').textContent"))),original);
  },{realtime:true});
});

test('T42 conversation conflict adoption clears the original recovery operation before a new explicit command',{timeout:240000},async()=>{
 await withT42BoardBrowser(async(f,browser,card,get)=>{
  const first=f.tickets[0],cookie=f.cookies[0];assert.ok(first&&cookie);const path='/api/tickets/'+first.ticket.id,initial=await get(path);
  await browser.evaluate(`document.querySelector(${JSON.stringify(card+' [data-action=board-action-menu]')}).click()`);await browser.evaluate(`document.querySelector(${JSON.stringify(card+' [data-board-action-target=active]')}).click()`);
  await browser.waitFor("document.querySelector('[data-action=take-and-start-with-conversations]')?.disabled===false");
  await browser.waitFor("document.querySelector('[data-realtime-status]')?.getAttribute('data-realtime-status')==='live'");
  await browser.evaluate(`(()=>{const original=fetch;globalThis.__t42ConversationHeld=null;let first=true;globalThis.fetch=async(path,options)=>{if(first&&options?.method==='POST'&&String(path).endsWith('/take-and-start-with-conversations')){first=false;globalThis.__t42ConversationHeld={path:String(path),body:JSON.parse(options.body)};await new Promise(resolve=>{globalThis.__t42ConversationRelease=resolve;});}return original(path,options);};})()`);
  await browser.evaluate("document.querySelector('[data-action=take-and-start-with-conversations]').click()");await browser.waitFor('globalThis.__t42ConversationHeld!==null');
  const held=object(await browser.evaluate('globalThis.__t42ConversationHeld')),original=object(held.body),bootstrap=await get('/api/lifecycle/bootstrap'),id=randomUUID();
  const competing=await fetch(f.origin+path+'/accept-for-later',{method:'POST',headers:{cookie,origin:f.origin,'content-type':'application/json','x-csrf-token':String(bootstrap.csrf_token),'idempotency-key':id,'if-match':'"'+String(initial.version)+'"'},body:JSON.stringify({client_command_id:id,expected_version:initial.version,reason_code:'WORKBENCH_SELF_HANDLING',resolver_team_id:initial.resolver_team_id})});assert.equal(competing.status,200,await competing.clone().text());
  await browser.evaluate('globalThis.__t42ConversationRelease()');await browser.waitFor("Boolean(document.querySelector('.detail-accept-dialog [data-board-original-intent]'))");
  assert.equal(await browser.evaluate('globalThis.__t42Writes.length'),1);
  await browser.evaluate("document.querySelector('.detail-accept-dialog [data-action=adopt-current-board-facts]').click()");
  await browser.waitFor("!document.querySelector('.detail-accept-dialog [data-board-original-intent]')&&document.querySelector('[data-action=confirm-conversation-handling]')?.disabled===false",{timeoutMs:10000});
  const operations=await browser.evaluate(`new Promise((resolve,reject)=>{const request=indexedDB.open('wecom-workbench-drafts-v1');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('operations'),rows=tx.objectStore('operations').getAll();tx.oncomplete=()=>{db.close();resolve(rows.result.filter(row=>row.kind==='ticket'&&row.id===${JSON.stringify(first.ticket.id)}&&row.purpose==='ticket-conversation-handling').map(row=>row.commandId));};tx.onerror=()=>{db.close();reject(tx.error);};};})`);assert.deepEqual(operations,[],'the old recovery UUID is durably cleared before a new intent');
  assert.equal(await browser.evaluate('globalThis.__t42Writes.length'),1,'adoption does not submit automatically');
  await browser.evaluate("document.querySelector('[data-action=confirm-conversation-handling]').click()");
  await browser.waitFor("document.querySelector('.conversation-handling-state')?.textContent.includes('已开始处理')");
  const posts=await browser.evaluate('globalThis.__t42Writes');assert.ok(Array.isArray(posts));assert.equal(posts.length,2);const next=object(object(posts[1]).body);assert.notEqual(next.client_command_id,original.client_command_id);assert.equal(next.communication_choice,original.communication_choice);assert.deepEqual(next.sessions,original.sessions);assert.equal((await get(path)).status,'IN_PROGRESS');
 },{conversationHandling:true,draftRecovery:true,realtime:true});
});
