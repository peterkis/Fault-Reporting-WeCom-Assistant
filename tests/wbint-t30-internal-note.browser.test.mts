import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {t30Http,text} from './helpers/t30-internal-note-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import type {Browser} from './helpers/wbint-t27-browser-fixture.mjs';
test('T30 production Incident detail saves an independently recovered internal input through real HTTP',async()=>{
  await t30Http({purpose:'t30browser',recovery:true},async({origin,cookies,confirm,get})=>{
    const incident=await confirm(),cookie=cookies[0];assert.ok(cookie);const directory=join(tmpdir(),'t30-browser-'+randomUUID());await mkdir(directory);let browser:Browser|undefined,error:unknown;const screenshots:{file:string;width:number;height:number;sha256:string}[]=[];
    const capture=async()=>{assert.ok(browser);const png=await browser.screenshot();assert.equal(typeof png,'string');if(typeof png!=='string')throw Error('T30_PNG_REQUIRED');const bytes=Buffer.from(png,'base64'),file=join(directory,'internal-'+bytes.readUInt32BE(16)+'.png');await writeFile(file,bytes);const saved={file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')};screenshots.push(saved);console.log('T30_BROWSER_PNG '+JSON.stringify(saved));};
    try{
      browser=await launchSystemBrowser({url:origin+'/workbench/app/incidents/'+incident,width:900,height:1080,cookies:[{name:text(cookie.name),value:text(cookie.value),url:text(cookie.url)}]});assert.ok(browser);await browser.waitFor(`Boolean(document.querySelector('[data-incident-id="${incident}"]'))`);
      assert.equal(await browser.evaluate('Boolean(document.querySelector("textarea[aria-label=内部处置记录]"))'),true,'production detail must expose the separately authorized internal input');
      const body='合成内部排查 <script>不可执行</script>，仅内部。';
      await browser.evaluate(`(()=>{const field=document.querySelector('textarea[aria-label="内部处置记录"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,${JSON.stringify(body)});field.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await browser.waitFor('document.querySelector("[data-internal-note-draft]")?.textContent.includes("已保存恢复副本")');await browser.command('Page.reload');await browser.waitFor(`document.querySelector('textarea[aria-label="内部处置记录"]')?.value===${JSON.stringify(body)}`);
      await browser.waitFor('document.querySelector("[data-action=submit-internal-note]")?.disabled===false');await browser.evaluate('document.querySelector("[data-action=submit-internal-note]").click()');
      await browser.waitFor('document.querySelector("[data-internal-note-outcome]")?.textContent.includes("已提交")');
      const page=(await get('/api/incidents/'+incident+'/internal-notes')).body;assert.ok(Array.isArray(page.items));assert.equal(page.items.length,1);assert.equal(await browser.evaluate(`document.querySelector('[aria-label="内部处置历史"]')?.textContent.includes(${JSON.stringify(body)})`),true);assert.equal(await browser.evaluate('Boolean(document.querySelector("[aria-label=内部处置历史] script"))'),false);
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth>innerWidth'),false);await capture();await browser.command('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});await capture();
    }catch(failure){error=failure;if(browser)try{await capture();await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({url:location.href,text:document.body.innerText})')));}catch(savedError){error=new AggregateError([failure,savedError]);}}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
    console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',purpose:'t30browser',screenshots}));
  });
});
