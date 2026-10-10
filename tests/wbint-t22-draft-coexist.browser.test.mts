import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {withT22Fixture} from './helpers/wbint-t22-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

test('settling one real reply preserves another mounted purpose and permits its next authorized save',async()=>{
  await withT22Fixture(async({origin,browserCookie,pool,sessions,principals})=>{
    const session=sessions[0],principal=principals[0];assert.ok(session);assert.ok(principal);
    const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);let browser:Awaited<ReturnType<typeof launchSystemBrowser>>|undefined,failure:unknown;
    const noteScope=JSON.stringify([principal.id,'conversation',session.id,'conversation-note']);
    const snapshot=`new Promise((resolve,reject)=>{const request=indexedDB.open('wecom-workbench-drafts-v1',2);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction(['drafts','control'],'readonly'),record=tx.objectStore('drafts').get(${JSON.stringify(noteScope)}),epoch=tx.objectStore('control').get('epoch');tx.oncomplete=()=>{resolve({revision:record.result?.revision??null,epoch:epoch.result});db.close();};tx.onabort=()=>{db.close();reject(tx.error);};};})`;
    const input=(purpose:string,value:string)=>`(()=>{const input=document.querySelector('textarea[data-purpose="${purpose}"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`;
    try{
      browser=await launchSystemBrowser({url:origin+'/workbench/app/conversations/'+session.id,width:1920,height:1080,cookies:[{...browserCookie,url:origin+'/'}]});assert.ok(browser);
      await browser.waitFor("document.querySelectorAll('[data-conversation-draft]').length===2&&Array.from(document.querySelectorAll('[data-conversation-draft]')).every(e=>e.textContent.includes('草稿仅在当前浏览器'))");
      await browser.evaluate(input('messages','T22 independently settled reply'));
      await browser.waitFor("document.querySelector('[data-conversation-draft=messages]').textContent.includes('已保存恢复副本')");
      await browser.evaluate(input('internal-notes','T22 sibling note before reply'));
      await browser.waitFor("document.querySelector('[data-conversation-draft=internal-notes]').textContent.includes('已保存恢复副本')");
      const before=await browser.evaluate(snapshot) as {revision:string|null;epoch:string};assert.ok(before.revision);
      await browser.evaluate("document.querySelector('[data-action=send-conversation-reply]').click()");
      await browser.waitFor("document.querySelector('[data-reply-outcome]').textContent.includes('已受理发送')");
      const settled=await browser.evaluate(snapshot) as {revision:string|null;epoch:string};assert.notEqual(settled.epoch,before.epoch);assert.equal(settled.revision,before.revision);
      assert.equal(await browser.evaluate("document.querySelector('textarea[data-purpose=internal-notes]').value"),'T22 sibling note before reply');
      assert.equal(Number((await pool.query<{count:string}>("SELECT count(*)::text AS count FROM communication.message WHERE session_id=$1::uuid AND purpose='HUMAN_REPLY'",[session.id])).rows[0]?.count),1);
      await browser.evaluate(input('internal-notes','T22 sibling note after reply'));
      await browser.waitFor(`document.querySelector('[data-conversation-draft=internal-notes]').textContent.includes('恢复不可用')||(${snapshot}).then(v=>v.revision!==${JSON.stringify(before.revision)})`);
      const after=await browser.evaluate(snapshot) as {revision:string|null;epoch:string};
      const status=await browser.evaluate("document.querySelector('[data-conversation-draft=internal-notes]').textContent");
      console.log('T22_PURPOSE_COEXIST '+JSON.stringify({before,settled,after,status}));
      assert.notEqual(after.revision,before.revision);
      assert.equal(await browser.evaluate("document.querySelector('[data-conversation-draft=internal-notes]').textContent.includes('已保存恢复副本')"),true);
      assert.equal(await browser.evaluate("document.querySelector('textarea[data-purpose=internal-notes]').value"),'T22 sibling note after reply');
    }catch(error){failure=error;if(browser){await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText,url:location.href})')));}}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
  });
});

test('a previously empty note purpose can save its first input after another purpose settles',async()=>{
  await withT22Fixture(async({origin,browserCookie,sessions,principals})=>{
    const session=sessions[0],principal=principals[0];assert.ok(session);assert.ok(principal);
    const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);let browser:Awaited<ReturnType<typeof launchSystemBrowser>>|undefined,failure:unknown;
    const noteScope=JSON.stringify([principal.id,'conversation',session.id,'conversation-note']);
    const snapshot=`new Promise((resolve,reject)=>{const request=indexedDB.open('wecom-workbench-drafts-v1',2);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction(['drafts','control'],'readonly'),record=tx.objectStore('drafts').get(${JSON.stringify(noteScope)}),epoch=tx.objectStore('control').get('epoch');tx.oncomplete=()=>{resolve({revision:record.result?.revision??null,epoch:epoch.result});db.close();};};})`;
    const input=(purpose:string,value:string)=>`(()=>{const input=document.querySelector('textarea[data-purpose="${purpose}"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`;
    try{
      browser=await launchSystemBrowser({url:origin+'/workbench/app/conversations/'+session.id,width:1920,height:1080,cookies:[{...browserCookie,url:origin+'/'}]});assert.ok(browser);
      await browser.waitFor("document.querySelectorAll('[data-conversation-draft]').length===2&&Array.from(document.querySelectorAll('[data-conversation-draft]')).every(e=>e.textContent.includes('草稿仅在当前浏览器'))");
      const before=await browser.evaluate(snapshot) as {revision:string|null;epoch:string};assert.equal(before.revision,null);
      await browser.evaluate(input('messages','T22 reply while note is empty'));await browser.waitFor("document.querySelector('[data-conversation-draft=messages]').textContent.includes('已保存恢复副本')");
      await browser.evaluate("document.querySelector('[data-action=send-conversation-reply]').click()");await browser.waitFor("document.querySelector('[data-reply-outcome]').textContent.includes('已受理发送')");
      const settled=await browser.evaluate(snapshot) as {revision:string|null;epoch:string};assert.equal(settled.revision,null);assert.notEqual(settled.epoch,before.epoch);
      await browser.evaluate(input('internal-notes','T22 first note after settled reply'));
      await browser.waitFor(`document.querySelector('[data-conversation-draft=internal-notes]').textContent.includes('恢复不可用')||(${snapshot}).then(v=>v.revision!==null)`);
      const after=await browser.evaluate(snapshot) as {revision:string|null;epoch:string},status=await browser.evaluate("document.querySelector('[data-conversation-draft=internal-notes]').textContent");
      console.log('T22_EMPTY_PURPOSE '+JSON.stringify({before,settled,after,status}));
      assert.ok(after.revision);assert.equal(await browser.evaluate("document.querySelector('[data-conversation-draft=internal-notes]').textContent.includes('已保存恢复副本')"),true);
    }catch(error){failure=error;if(browser){await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText,url:location.href})')));}}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
  });
});
