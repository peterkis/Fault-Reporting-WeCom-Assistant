import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {withT40LocateFixture,object,text} from './helpers/t40-reminder-locate-fixture.mjs';

type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
interface ImageReceipt {file:string;width:number;height:number;sha256:string;phase:string}
function observe(target:string,failLocateOnce=false):string{return `(()=>{
  globalThis.__t40Locate={posts:0,reminderReads:0,itemReads:0,transportFailures:0};
  let fail=${JSON.stringify(failLocateOnce)};const original=globalThis.fetch;
  globalThis.fetch=async function(input,options){
    const url=new URL(input instanceof Request?input.url:String(input),location.href);
    const method=(options?.method??(input instanceof Request?input.method:'GET')).toUpperCase();
    if(url.origin===location.origin&&url.pathname.startsWith('/api/')&&method==='POST')globalThis.__t40Locate.posts++;
    if(url.origin===location.origin&&url.pathname===${JSON.stringify('/api/workbench/items/ticket/'+target)}&&method==='GET'){
      globalThis.__t40Locate.itemReads++;
      if(fail&&new URLSearchParams(location.search).get('locate')==='1'){
        fail=false;globalThis.__t40Locate.transportFailures++;throw new TypeError('T40_CONTROLLED_CLIENT_TRANSPORT_FAILURE');
      }
    }
    const response=await original(input,options);
    if(url.origin===location.origin&&url.pathname==='/api/workbench/reminders'&&response.ok)globalThis.__t40Locate.reminderReads++;
    return response;
  };
})()`;}

test('T40 a real reminder locates a card beyond the first server page, preserves a failed read intent and clears actual revoked READ',
  {timeout:240_000},async()=>{
  await withT40LocateFixture(async fixture=>{
    assert.ok(process.platform!=='win32'||/^[dD]:[\\/]/u.test(tmpdir()));
    const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);
    const screenshots:ImageReceipt[]=[];let browser:Browser|undefined,primary:unknown;
    const card='article.ticket-card[data-item-id="'+fixture.ticketId+'"]';
    const snapshot=async(phase:string)=>{assert.ok(browser);const bytes=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,phase+'-1280.png');await writeFile(file,bytes);
      screenshots.push({file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex'),phase});};
    try{
      browser=await launchSystemBrowser({url:fixture.origin+'/api/lifecycle/bootstrap',width:1280,height:900,cookies:[fixture.browserCookie]});assert.ok(browser);
      await browser.command('Page.enable');
      const installed=object(await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:observe(fixture.ticketId)}));
      await browser.command('Page.navigate',{url:fixture.origin+'/workbench/app/?range=all'});
      await browser.waitFor('document.querySelectorAll("article.ticket-card").length>0&&document.querySelector(\'[data-realtime-status="live"]\')&&document.querySelector(\'[data-reminders-ready="true"]\')');
      assert.equal((await fixture.runtime.observability.metrics()).sse_clients,1);
      assert.equal(await browser.evaluate('Boolean(document.querySelector('+JSON.stringify(card)+'))'),false,'genuine first server page and folded DOM omit the target');
      const facts=await fixture.currentFacts();assert.deepEqual(await fixture.runtime.runFollowUpDueBatch({limit:20}),{scanned:1,emitted:1,skipped:0});
      const notice='[data-reminder-id] button[aria-label="定位事项"]';await browser.waitFor('Boolean(document.querySelector('+JSON.stringify(notice)+'))');
      assert.equal(await browser.evaluate('Boolean(document.querySelector('+JSON.stringify(card)+'))'),false,'reminder receipt does not fetch all board pages or auto-open the target');
      await browser.evaluate('document.querySelector('+JSON.stringify(notice)+').click()');
      await browser.waitFor('document.querySelector('+JSON.stringify(card)+')?.dataset.reminderLocated==="true"');
      const locatedUrl=text(await browser.evaluate('location.href'));assert.equal(new URL(locatedUrl).pathname,'/workbench/app/items/ticket/'+fixture.ticketId);assert.equal(new URL(locatedUrl).searchParams.get('locate'),'1');
      assert.equal(await browser.evaluate('document.querySelectorAll('+JSON.stringify(card)+').length'),1,'canonical locate is not a second card fact');
      assert.equal(await browser.evaluate('Boolean(document.querySelector("dialog.detail-dialog[open]"))'),false);
      const explicitLink=text(await browser.evaluate('document.querySelector('+JSON.stringify(card+' a.card-open')+').href'));assert.equal(new URL(explicitLink).searchParams.has('locate'),false,'only an explicit detail link opens the ordinary detail route');
      assert.deepEqual(await fixture.currentFacts(),facts,'locate is not a command, read-position advancement or follow/disposition');
      assert.equal(await browser.evaluate('globalThis.__t40Locate.posts'),0);await snapshot('new-board');

      // The failed request has no fabricated HTTP response. Retry must cross the same genuine GET seam.
      await browser.command('Page.removeScriptToEvaluateOnNewDocument',{identifier:text(installed.identifier)});
      await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:observe(fixture.ticketId,true)});
      await browser.command('Page.reload');
      await browser.waitFor('document.body.innerText.includes("本次定位未完成，原定位目标已保留。")');
      assert.equal(await browser.evaluate('location.href'),locatedUrl);assert.equal(await browser.evaluate('Boolean(document.querySelector('+JSON.stringify(card)+'))'),false);
      assert.equal(await browser.evaluate('globalThis.__t40Locate.transportFailures'),1);
      await browser.evaluate('document.querySelector(\'[aria-label="已定位事项"] .state-message button\').click()');
      await browser.waitFor('document.querySelector('+JSON.stringify(card)+')?.dataset.reminderLocated==="true"');
      assert.equal(await browser.evaluate('location.href'),locatedUrl);assert.equal(await browser.evaluate('globalThis.__t40Locate.posts'),0);

      await fixture.revokeTargetRead();
      await browser.waitFor('document.body.innerText.includes("该事项当前不可读取，旧定位资料已清除。")');
      assert.equal(await browser.evaluate('Boolean(document.querySelector('+JSON.stringify(card)+'))'),false);
      assert.equal(await browser.evaluate('document.body.innerText.includes('+JSON.stringify(fixture.targetTitle)+')'),false);
      assert.equal(await browser.evaluate('Boolean(document.querySelector("dialog.detail-dialog[open]"))'),false);
      assert.equal(await browser.evaluate('globalThis.__t40Locate.posts'),0);await snapshot('new-detail');
      console.log('WBINT_T40_LOCATE '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG_PRODUCTION_BUNDLE',original_first_unchanged:true,
        first_page_limit:50,target_beyond_first_page:true,canonical_ticket:fixture.ticketId,automatic_posts:0,auto_opened:false,
        failure_injection:'ONE_CLIENT_TRANSPORT_REJECTION_NO_HTTP_REPLY_MOCK',retry:'ORIGINAL_AUTHORIZED_ITEM_GET',revocation:'REAL_ASSIGNMENT_TRANSFER_AND_TEAM_WITHDRAWAL',
        physical_audio_or_desktop_delivery:'NOT_RUN_NOT_PROVEN'}));
    }catch(error){primary=error;if(browser)try{await snapshot('failure');}catch{console.log('WBINT_T40_LOCATE_FAILURE_OBSERVER_INCOMPLETE');}}
    finally{console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG_PRODUCTION_BUNDLE',screenshots}));
      await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],primary);}
  });
});
