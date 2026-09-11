import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {withYxxDatabase,businessDigest} from './helpers/p2-g2-yixiaoxiu-fixture.mjs';
import {createYxxBrowserFixture,yxxTab,pollYxx} from './helpers/p2-g2-yixiaoxiu-browser.mjs';
import {closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

async function navigate(browser,origin,path){
  const result=await browser.command('Page.navigate',{url:new URL(path,origin).href});assert.equal(result.errorText,undefined);
}

for(const [width,height] of [[1440,900],[390,844]])test('YXX-02 YXX-19 YXX-35 YXX-40 YXX-41 real Edge HTTPS member entry '+width+'x'+height,{timeout:90000},async()=>{
  await withYxxDatabase(async({pool,seed})=>{
    const a=await seed(),before=await businessDigest(pool);let fixture,browser,error;
    try{
      fixture=await createYxxBrowserFixture({pool});browser=await fixture.launch({width,height});
      const path='/wecom/yixiaoxiu/tickets/'+a.grant.public_ref;
      await browser.command('Page.navigate',{url:'about:blank'});await browser.waitFor("location.href==='about:blank'");
      await navigate(browser,fixture.origin,path);
      await browser.waitFor("document.querySelector('#ticket')?.hidden===false");
      assert.equal(await browser.evaluate('location.pathname'),path);assert.equal(await browser.evaluate('location.search+location.hash'),'');
      assert.equal(fixture.providerCalls,1);
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth>innerWidth'),false);
      assert.equal(await browser.evaluate('localStorage.length+sessionStorage.length'),0);
      assert.equal(await browser.evaluate('document.cookie'), '');
      const cookies=(await browser.command('Network.getCookies')).cookies;
      assert.ok(cookies.some(c=>c.name==='__Host-wecom_session'&&c.secure&&c.httpOnly&&c.sameSite==='Lax'));
      const visible=await browser.evaluate('document.body.textContent');assert.ok(visible.includes(a.ticket.ticket_no));
      assert.doesNotMatch(visible,/synthetic-private-note|synthetic-A|userid|corpId|binding_hash/u);assert.ok(!visible.includes(a.ticket.id));
      const times=await browser.evaluate("document.querySelector('#times').textContent");
      for(const zone of ['UTC','Asia/Tokyo','America/New_York']){
        await browser.setTimezone(zone);await browser.evaluate('location.reload()',{awaitPromise:false});
        await browser.waitFor("document.querySelector('#ticket')?.hidden===false");assert.equal(await browser.evaluate("document.querySelector('#times').textContent"),times);
      }
      assert.equal(fixture.providerCalls,1,'reload does not replay OAuth code');
      await browser.pressTab();assert.equal(await browser.evaluate("['refresh','logout','more'].includes(document.activeElement.id)"),true);
      await mkdir(new URL('../evidence/p2-g2-yxx-entry-screenshots/',import.meta.url),{recursive:true});
      await writeFile(new URL('../evidence/p2-g2-yxx-entry-screenshots/'+width+'.png',import.meta.url),Buffer.from(await browser.screenshot(),'base64'));
      assert.deepEqual(await businessDigest(pool),before);
    }catch(e){error=e;}finally{await closeBrowserTestResources([()=>browser?.close(),()=>fixture?.close()],error);}
  });
});

test('YXX-13 YXX-25 YXX-36 old fragment reaches canonical member page and failed Timeline retries without accepting ETag',{timeout:90000},async()=>{
  await withYxxDatabase(async({pool,seed})=>{
    const a=await seed(),before=await businessDigest(pool);let fixture,browser,error;
    try{
      fixture=await createYxxBrowserFixture({pool});browser=await fixture.launch();fixture.failNextTimeline();
      await navigate(browser,fixture.origin,'/reporter/open#grant='+a.grant.token);
      await browser.waitFor("document.querySelector('#status')?.textContent.includes('重试')");
      assert.equal(await browser.evaluate('location.pathname'),'/wecom/yixiaoxiu/tickets/'+a.grant.public_ref);
      assert.equal(await browser.evaluate('location.hash+location.search'),'');assert.equal(await browser.evaluate("document.querySelector('#ticket').hidden"),true);
      await browser.evaluate("document.querySelector('#refresh').click()");await browser.waitFor("document.querySelector('#ticket').hidden===false");
      assert.ok((await browser.evaluate('document.body.textContent')).includes(a.ticket.ticket_no));assert.equal(fixture.providerCalls,1);
      fixture.expireAuth();await browser.evaluate("document.querySelector('#refresh').click()");await browser.waitFor("document.querySelector('#status').textContent.includes('认证已失效')");
      assert.equal(await browser.evaluate("document.querySelector('#number').textContent"),'');await browser.evaluate("document.querySelector('#reauth').click()",{awaitPromise:false});
      await browser.waitFor("document.querySelector('#ticket')?.hidden===false");assert.equal(fixture.providerCalls,2);assert.deepEqual(await businessDigest(pool),before);
    }catch(e){error=e;}finally{await closeBrowserTestResources([()=>browser?.close(),()=>fixture?.close()],error);}
  });
});

test('YXX-15 simultaneous first-tab logins retain separate refs and same-context cookies in real Edge',{timeout:90000},async()=>{
  await withYxxDatabase(async({pool,seed})=>{
    const a=await seed(),b=await seed();let fixture,browser,tab,error;
    try{
      fixture=await createYxxBrowserFixture({pool});browser=await fixture.launch();fixture.holdLogins();
      const firstNavigation=navigate(browser,fixture.origin,'/wecom/yixiaoxiu/tickets/'+a.grant.public_ref).then(()=>null,error=>error);
      await pollYxx(()=>fixture.pendingLogins===1);
      tab=await yxxTab(browser,fixture.origin+'/wecom/yixiaoxiu/tickets/'+b.grant.public_ref);await pollYxx(()=>fixture.pendingLogins===2);
      fixture.releaseLogin();const navigationFailure=await firstNavigation;if(navigationFailure)throw navigationFailure;
      await pollYxx(()=>fixture.providerCalls===1);
      await browser.waitFor('location.pathname==='+JSON.stringify('/wecom/yixiaoxiu/tickets/'+a.grant.public_ref));
      fixture.releaseLogin();await pollYxx(()=>fixture.providerCalls===2);fixture.releaseLogins();
      await tab.command('Page.bringToFront');await tab.waitFor("document.querySelector('#ticket')?.hidden===false");
      assert.ok((await tab.evaluate("document.querySelector('#number').textContent")).includes(b.ticket.ticket_no));
      assert.ok(!(await tab.evaluate('document.body.textContent')).includes(a.ticket.ticket_no));
      await browser.command('Page.bringToFront');await browser.waitFor("document.querySelector('#ticket')?.hidden===false");
      assert.ok((await browser.evaluate("document.querySelector('#number').textContent")).includes(a.ticket.ticket_no));
      assert.ok(!(await browser.evaluate('document.body.textContent')).includes(b.ticket.ticket_no));
      assert.equal(fixture.providerCalls,2);
    }catch(e){error=e;}finally{await closeBrowserTestResources([()=>tab?.close(),()=>browser?.close(),()=>fixture?.close()],error);}
  });
});

test('YXX-22 YXX-23 YXX-24 late detail, logout, identity switch and browser history clear old data',{timeout:90000},async()=>{
  await withYxxDatabase(async({pool,seed})=>{
    const a=await seed(),b=await seed('synthetic-B');let fixture,browser,error;
    try{
      fixture=await createYxxBrowserFixture({pool});browser=await fixture.launch();
      const path='/wecom/yixiaoxiu/tickets/'+a.grant.public_ref;
      await navigate(browser,fixture.origin,path);await browser.waitFor("document.querySelector('#ticket')?.hidden===false");
      fixture.holdDetails();await browser.evaluate("document.querySelector('#refresh').click()");await pollYxx(()=>fixture.pendingDetails===1);
      await browser.evaluate("document.querySelector('#logout').click()");await browser.waitFor("document.querySelector('#status').textContent==='已退出访问。'");
      fixture.releaseDetails();assert.equal(await browser.evaluate("document.querySelector('#ticket').hidden"),true);
      assert.ok(!(await browser.evaluate('document.body.textContent')).includes(a.ticket.ticket_no));
      fixture.setMember('synthetic-B');await navigate(browser,fixture.origin,'/wecom/yixiaoxiu/tickets/'+b.grant.public_ref);
      await browser.waitFor("document.querySelector('#ticket')?.hidden===false");
      await browser.evaluate('history.back()',{awaitPromise:false});await browser.waitFor("document.querySelector('#status')?.textContent.includes('无权')");
      assert.equal(await browser.evaluate('location.pathname'),path);assert.ok(!(await browser.evaluate('document.body.textContent')).includes(a.ticket.ticket_no));
      // Exercise the persisted pageshow branch too, on browsers where no-store prevents actual BFCache.
      await browser.evaluate("window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))");
      await browser.waitFor("document.querySelector('#status')?.textContent.includes('无权')");assert.equal(await browser.evaluate("document.querySelector('#number').textContent"),'');
    }catch(e){error=e;}finally{await closeBrowserTestResources([()=>browser?.close(),()=>fixture?.close()],error);}
  });
});
