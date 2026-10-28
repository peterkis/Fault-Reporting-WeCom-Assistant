import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {readFile,mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import type {T11Fixture} from './helpers/t11-completion-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

function gate(){let release=()=>{};const promise=new Promise<void>(resolve=>{release=resolve;});return {promise,release};}
async function observed(check:()=>boolean){const until=Date.now()+8000;while(!check()&&Date.now()<until)await delay(20);assert.ok(check(),'expected startup request did not arrive');}

test('cold startup paints before JavaScript and overlaps session validation with workbench loading',{timeout:90_000},async()=>{
  const manifest:unknown=JSON.parse(await readFile(new URL('../web/admin-workbench/.vite/manifest.json',import.meta.url),'utf8'));
  assert.ok(manifest&&typeof manifest==='object');
  const assets=Object.entries(manifest).filter((entry):entry is [string,{file:string}]=>Boolean(entry[1]&&typeof entry[1]==='object'&&typeof entry[1].file==='string'));
  const entry=assets.find(([key])=>key==='index.html')?.[1].file;
  const workbench=assets.find(([key])=>key.endsWith('/Workbench.tsx'))?.[1].file;
  assert.ok(entry&&workbench,'the session entry must be independent of the heavier workbench module');
  await withWeb01Fixture(async(f:T11Fixture)=>{
    const cookie=f.browserCookies[0];assert.ok(cookie?.url);
    const entryGate=gate(),uiGate=gate(),sessionGate=gate(),boardGate=gate();
    const original=f.runtime.server.listeners('request');let sessionRequests=0,uiRequests=0,posts=0,rejectUi=false;
    const boardColumns=new Set<string>();
    f.runtime.server.removeAllListeners('request');
    f.runtime.server.on('request',(request:IncomingMessage,response:ServerResponse)=>{
      const url=new URL(request.url??'/',f.origin);
      if(rejectUi&&url.pathname==='/workbench/app/'+workbench){response.writeHead(503);response.end();return;}
      if(request.method==='POST')posts++;
      let hold:Promise<void>|undefined;
      if(url.pathname==='/workbench/app/'+entry)hold=entryGate.promise;
      if(url.pathname==='/workbench/app/'+workbench){uiRequests++;hold=uiGate.promise;}
      if(url.pathname==='/api/lifecycle/bootstrap'){sessionRequests++;hold=sessionGate.promise;}
      if(url.pathname==='/api/workbench/board'){boardColumns.add(url.searchParams.get('column')??'');hold=boardGate.promise;}
      const dispatch=()=>{for(const listener of original)Reflect.apply(listener,f.runtime.server,[request,response]);};
      if(hold)void hold.then(dispatch);else dispatch();
    });
    let browser:NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>|undefined,failure:unknown;
    const directory=await mkdtemp(join(tmpdir(),'workbench-startup-'));
    try{
      browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:1440,height:960,cookies:[{...cookie,url:cookie.url}]});assert.ok(browser);
      await browser.waitFor('document.querySelector("[data-startup]")?.checkVisibility()===true');
      assert.equal(sessionRequests,0,'the first loading surface does not need JavaScript');
      assert.equal(await browser.evaluate('document.querySelectorAll(".startup-card").length'),3);
      const snapshot=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,'startup-before-javascript.png');await writeFile(file,snapshot);
      entryGate.release();
      await observed(()=>sessionRequests===1&&uiRequests===1);
      assert.equal(await browser.evaluate('document.querySelector("[data-startup]")?.checkVisibility()'),true);
      assert.equal(boardColumns.size,0,'no business read starts before the session is authorized');
      uiGate.release();
      await browser.waitFor('document.querySelectorAll("[data-startup] .skeleton").length===9');
      assert.equal(sessionRequests,1,'session loading stays deduplicated across the UI boundary');
      sessionGate.release();
      await observed(()=>boardColumns.size===3);
      assert.deepEqual([...boardColumns].sort(),['active','closed','pending'],'all three independent reads start without waiting for another column');
      await browser.waitFor('document.querySelectorAll(".board .skeleton").length===9');
      await browser.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
      assert.equal(await browser.evaluate('getComputedStyle(document.querySelector(".board .skeleton")).animationName'),'none');
      boardGate.release();
      await browser.waitFor('document.querySelectorAll(".ticket-card").length>0&&!document.querySelector("[data-startup]")');
      assert.equal(posts,0,'startup performs no business mutations');
      console.log('WORKBENCH_STARTUP '+JSON.stringify({html_before_script:true,session_during_ui_download:true,session_requests:sessionRequests,parallel_columns:boardColumns.size,posts,screenshot:{file,sha256:createHash('sha256').update(snapshot).digest('hex')}}));
      rejectUi=true;
      await browser.command('Network.setCacheDisabled',{cacheDisabled:true});
      await browser.command('Page.navigate',{url:f.origin+'/workbench/app/?load-failure=1'});
      await browser.waitFor('document.body.innerText.includes("工作台界面加载未完成")&&!document.querySelector("[data-startup]")');
      assert.equal(posts,0,'a failed UI download does not retry business commands');
    }catch(error){failure=error;}
    finally{entryGate.release();uiGate.release();sessionGate.release();boardGate.release();}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
  });
});
