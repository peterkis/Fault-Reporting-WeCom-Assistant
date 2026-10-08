import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {withT22Fixture,appendT22Item} from './helpers/wbint-t22-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

test('the production workspace reads real scoped topics, keeps input and selection during new material, and labels 202 as pending delivery',async()=>{
  await withT22Fixture(async({origin,browserCookie,pool,sessions})=>{
    const session=sessions[0],other=sessions[1];assert.ok(session);assert.ok(other);
    const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);let browser:Awaited<ReturnType<typeof launchSystemBrowser>>|undefined,failure:unknown;
    try{
      browser=await launchSystemBrowser({url:origin+'/workbench/app/',width:1920,height:1080,cookies:[{...browserCookie,url:origin+'/'}]});assert.ok(browser);
      await browser.waitFor("document.querySelectorAll('.ticket-card').length>0");
      assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-action=open-conversations]'))"),true);
      await browser.evaluate("document.querySelector('[data-action=open-conversations]').click()");
      await browser.waitFor(`Boolean(document.querySelector('[data-conversation-id="${session.id}"]')&&document.querySelector('[data-conversation-id="${other.id}"]'))`);
      assert.equal(await browser.evaluate(`Boolean(document.querySelector('[data-conversation-id="${sessions[2]?.id}"]'))`),false);
      const topics=await browser.evaluate(`[document.querySelector('[data-conversation-id="${session.id}"] p').textContent,document.querySelector('[data-conversation-id="${other.id}"] p').textContent]`) as string[];
      assert.ok(topics[0]);assert.ok(topics[1]);assert.notEqual(topics[0],topics[1]);
      await browser.evaluate(`document.querySelector('[data-conversation-id="${session.id}"] a').click()`);
      await browser.waitFor("document.querySelector('[data-conversation-ready]')&&document.querySelector('[data-conversation-draft]')?.textContent.includes('草稿仅在当前浏览器')");
      assert.equal(await browser.evaluate("document.querySelector('[data-conversation-timeline]').textContent.includes('参与者甲的打印机主题')"),true);
      assert.equal(await browser.evaluate("document.querySelector('[data-conversation-timeline]').textContent.includes('参与者乙的护理主题')"),false);
      await browser.evaluate("(()=>{const input=document.querySelector('textarea[data-purpose=messages]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'T22 browser preserved reply');input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();input.setSelectionRange(4,11);})()");
      await browser.waitFor("document.querySelector('[data-conversation-draft=messages]').textContent.includes('已保存恢复副本')");
      await appendT22Item(pool,session.id,2,'T22 arrived while writing',10);await pool.query('UPDATE conversation.session SET row_version=row_version+1,generation_version=generation_version+1 WHERE id=$1::uuid',[session.id]);
      await browser.waitFor("document.querySelector('[data-conversation-timeline]').textContent.includes('T22 arrived while writing')");
      assert.deepEqual(await browser.evaluate("(()=>{const input=document.querySelector('textarea[data-purpose=messages]');return {value:input.value,start:input.selectionStart,end:input.selectionEnd,focused:document.activeElement===input};})()"),{value:'T22 browser preserved reply',start:4,end:11,focused:true});
      await browser.evaluate("document.querySelector('[data-action=send-conversation-reply]').click()");
      await browser.waitFor("document.querySelector('[data-reply-outcome]').textContent.includes('已受理发送')");
      assert.equal(await browser.evaluate("document.querySelector('[data-reply-outcome]').textContent.includes('发送成功')"),false);
      await browser.waitFor("document.querySelector('[data-conversation-deliveries]').textContent.includes('待发送')");
      const bytes=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,'new-detail-page-1920.png');await writeFile(file,bytes);
      console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',conversation_workspace:true,screenshots:[{file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')}]}));
    }catch(error){failure=error;if(browser){await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText,url:location.href})')));}}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
  });
});
