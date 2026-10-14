import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {withT40ReminderFirstFixture,object,text} from './helpers/t40-reminder-first-fixture.mjs';

/** Frozen SOURCE_ONLY original tracer. No execution, RED or PASS is claimed here. */
type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
interface ImageReceipt {file:string;width:number;height:number;sha256:string;phase:string}
const settings='button[aria-label="提醒偏好"]';
const observer=`(()=>{
  globalThis.__t40Platform={audio:0,desktopPermission:0,desktopCreate:0,posts:0};
  for(const [owner,name] of [
    [globalThis.AudioContext?.prototype,'resume'],
    [globalThis.AudioScheduledSourceNode?.prototype,'start'],
    [globalThis.HTMLMediaElement?.prototype,'play'],
    [globalThis.Notification,'requestPermission'],
  ]) {
    const original=owner?.[name];if(typeof original!=='function')continue;
    owner[name]=function(...args){
      if(name==='requestPermission')globalThis.__t40Platform.desktopPermission++;
      else globalThis.__t40Platform.audio++;
      return Reflect.apply(original,this,args);
    };
  }
  if(typeof globalThis.Notification==='function')globalThis.Notification=new Proxy(globalThis.Notification,{
    construct(target,args,newTarget){
      globalThis.__t40Platform.desktopCreate++;
      return Reflect.construct(target,args,newTarget);
    },
  });
  const originalFetch=globalThis.fetch;
  globalThis.fetch=function(input,options){
    const url=new URL(input instanceof Request?input.url:String(input),location.href);
    const method=(options?.method??(input instanceof Request?input.method:'GET')).toUpperCase();
    if(url.origin===location.origin&&url.pathname.startsWith('/api/')&&method==='POST')
      globalThis.__t40Platform.posts++;
    return originalFetch(input,options);
  };
})()`;
function page(value:Record<string,unknown>) {
  assert.deepEqual(Object.keys(value).sort(),['schema_version','items','as_of_event_id','next_cursor','reset_required','baseline_token'].sort());
  assert.equal(value.schema_version,1);assert.ok(Array.isArray(value.items)&&value.items.length<=50);
  const watermark=text(value.as_of_event_id);assert.match(watermark,/^(0|[1-9][0-9]{0,18})$/u);
  assert.ok(BigInt(watermark)<=9223372036854775807n);
  assert.ok(value.next_cursor===null||typeof value.next_cursor==='string');
  assert.equal(typeof value.reset_required,'boolean');
  const baselineToken=text(value.baseline_token);assert.ok(baselineToken.length<=512);
  assert.match(baselineToken,/^[A-Za-z0-9_.-]+$/u);
  return {items:value.items.map(object),watermark,baselineToken,nextCursor:value.next_cursor,reset:value.reset_required};
}

test('T40 a genuinely assigned due Ticket yields a muted locatable production notice without opening or disposing the item',
  {timeout:240_000},async()=>{
  await withT40ReminderFirstFixture(async fixture=>{
    assert.ok(process.platform!=='win32'||/^[dD]:[\\/]/u.test(tmpdir()),'T40 owned Windows temp must remain on D');
    const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);
    const screenshots:ImageReceipt[]=[];
    let browser:Browser|undefined,primary:unknown;
    const snapshot=async(phase:string)=>{
      assert.ok(browser);
      const bytes=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,phase+'-1280.png');
      await writeFile(file,bytes);
      screenshots.push({file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),
        sha256:createHash('sha256').update(bytes).digest('hex'),phase});
    };
    try {
      // Same-origin genuine API navigation precedes every application script and platform invocation.
      browser=await launchSystemBrowser({url:fixture.origin+'/api/lifecycle/bootstrap',width:1280,height:900,cookies:[fixture.browserCookie]});
      assert.ok(browser);
      await browser.command('Page.enable');
      await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:observer});
      await browser.command('Page.navigate',{url:fixture.origin+'/workbench/app/'});
      await browser.waitFor("document.querySelectorAll('article.ticket-card').length>0");
      assert.equal((await fixture.runtime.observability.metrics()).sse_clients,1,'production bundle must own the real authorized stream');
      const beforeUrl=await browser.evaluate('location.href'),beforeFacts=await fixture.currentFacts();
      assert.equal(await browser.evaluate('Boolean(document.querySelector("dialog.detail-dialog[open]"))'),false);
      // First product assertion only after actual assignment, due SET, authorized GET, mounted bundle and SSE.
      assert.equal(await browser.evaluate('Boolean(document.querySelector('+JSON.stringify(settings)+'))'),true,
        'T40_PRODUCTION_REMINDER_SETTINGS_REQUIRED');
      await browser.evaluate('document.querySelector('+JSON.stringify(settings)+').click()');
      await browser.waitFor('Boolean(document.querySelector(\'[role="dialog"][aria-label="本浏览器提醒偏好"]\'))');
      assert.equal(await browser.evaluate('document.querySelector(\'input[aria-label="开启声音提醒"]\')?.checked'),false);
      assert.equal(await browser.evaluate('document.querySelector(\'input[aria-label="开启桌面通知"]\')?.checked'),false);
      await browser.evaluate('document.querySelector(\'[role="dialog"][aria-label="本浏览器提醒偏好"] button[aria-label="关闭提醒偏好"]\').click()');
      const baselineResponse=await fixture.http.get('/api/workbench/reminders?limit=50');
      assert.equal(baselineResponse.status,200,JSON.stringify(baselineResponse.value));
      const baseline=page(baselineResponse.value);
      assert.deepEqual(baseline.items,[],'fresh baseline cannot manufacture old visual or sound history');
      assert.equal(baseline.reset,false);
      const due=await fixture.runtime.runFollowUpDueBatch({limit:20});
      assert.deepEqual(due,{scanned:1,emitted:1,skipped:0},'original due Port must persist a genuine signal');
      const response=await fixture.http.get('/api/workbench/reminders?after_event_id='+baseline.watermark+'&limit=50&baseline_token='+encodeURIComponent(baseline.baselineToken));
      assert.equal(response.status,200,JSON.stringify(response.value));
      const current=page(response.value),notice=current.items.find(item=>item.reason==='RELATED_FOLLOW_UP_DUE'&&object(item.canonical_item).id===fixture.ticketId);
      assert.ok(notice,'actual current READ plus handling relation must qualify the original due fact');
      assert.equal(object(notice.canonical_item).kind,'ticket');
      const reminderId=text(notice.reminder_id),eventId=text(notice.event_id);
      assert.match(reminderId,/^[a-f0-9]{64}$/u);assert.ok(BigInt(eventId)>BigInt(baseline.watermark));
      assert.equal(notice.source_revision,'1');assert.match(text(notice.source_key),/^[a-f0-9]{64}$/u);
      const shown='[data-reminder-id="'+reminderId+'"]';
      await browser.waitFor('Boolean(document.querySelector('+JSON.stringify(shown)+'))');
      assert.equal(await browser.evaluate('location.href'),beforeUrl,'fresh events cannot navigate the operator');
      assert.equal(await browser.evaluate('Boolean(document.querySelector("dialog.detail-dialog[open]"))'),false);
      assert.equal(await browser.evaluate('document.querySelectorAll('+JSON.stringify(shown)+').length'),1);
      assert.deepEqual(await browser.evaluate('globalThis.__t40Platform'),{audio:0,desktopPermission:0,desktopCreate:0,posts:0},
        'default mute performs no audio attempt, desktop permission request/construction or business POST');
      await snapshot('reminder-muted');
      await browser.evaluate('document.querySelector('+JSON.stringify(shown+' button[aria-label="定位事项"]')+').click()');
      await browser.waitFor('document.querySelector(\'article.ticket-card[data-item-id="'+fixture.ticketId+'"]\')?.dataset.reminderLocated==="true"');
      assert.equal(await browser.evaluate('Boolean(document.querySelector("dialog.detail-dialog[open]"))'),false,'locating is not opening details');
      assert.deepEqual(await fixture.currentFacts(),beforeFacts,'visual/locate is not read advancement, follow, disposition, assignment or a Ticket action');
      assert.deepEqual(await fixture.runtime.runFollowUpDueBatch({limit:20}),{scanned:0,emitted:0,skipped:0});
      const repeated=await fixture.http.get('/api/workbench/reminders?after_event_id='+baseline.watermark+'&limit=50&baseline_token='+encodeURIComponent(baseline.baselineToken));
      assert.equal(repeated.status,200);
      assert.deepEqual(page(repeated.value).items,current.items,'repeat reads preserve original event/fact identifiers');
      assert.deepEqual(await browser.evaluate('globalThis.__t40Platform'),{audio:0,desktopPermission:0,desktopCreate:0,posts:0});
      await snapshot('reminder-located');
      console.log('WBINT_T40_FIRST '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG_PRODUCTION_BUNDLE',
        source:'ORIGINAL_FOLLOW_UP_DUE_SIGNAL',setup_command_ids:fixture.setupCommandIds,event_id:eventId,
        source_revision:'1',reminder_id:reminderId,default_mute:true,automatic_posts:0,opened_details:false,
        platform_api_observer_only:true,physical_speaker_or_desktop_delivery:'NOT_PROVEN'}));
    } catch(error) {
      primary=error;
      if(browser)try{
        await snapshot('failure');
        await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate(
          '({text:document.body.innerText,url:location.href,platform:globalThis.__t40Platform??null})')));
      }catch{console.log('WBINT_T40_FIRST_FAILURE_OBSERVER_INCOMPLETE');}
    } finally {
      console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG_PRODUCTION_BUNDLE',screenshots}));
      await closeBrowserTestResources([
        async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},
      ],primary);
    }
  });
});
