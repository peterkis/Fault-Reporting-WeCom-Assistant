import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {waitForAnimationsSettled} from './helpers/browser-animations.mjs';
import {withT35Fixture} from './helpers/t35-read-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

test('T35 an old visible scope cannot write for a switched account while fresh identity delivery is delayed',{timeout:120_000},()=>withT35Fixture(async f=>{
  const selected=f.tickets[1];assert.ok(selected);const path='/api/workbench/items/ticket/'+selected.ticket.id+'/read-position';
  assert.ok('messageId' in selected.intake && typeof selected.intake.messageId==='string');
  assert.match(selected.intake.messageId,/^[1-9]\d*$/u);
  const sourceRef='channel:'+selected.intake.messageId;
  const materialSelector=`.activity-list .record-text[data-personal-read-ref="${sourceRef}"][data-personal-read-revision="1"]`;
  const material=`document.querySelector(${JSON.stringify(materialSelector)})`;
  const position=async(reader:0|1)=>(await (await f.get(path,reader)).json() as {sources:{last_read_position:string}[]}).sources[0]?.last_read_position;
  assert.equal(await position(0),'0');assert.equal(await position(1),'0');
  const directory=join(tmpdir(),'t35-account-switch-'+randomUUID());await mkdir(directory);let browser:Awaited<ReturnType<typeof launchSystemBrowser>>|undefined,failure:unknown;
  try{
    browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:1280,height:1000,cookies:[{...f.browserCookie,url:f.origin+'/'}]});assert.ok(browser);
    await browser.command('Emulation.setFocusEmulationEnabled',{enabled:true});await browser.command('Page.enable');
    await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
      globalThis.__t35Visible=false;
      globalThis.__t35HoldIdentity=false;
      globalThis.__t35HeldIdentity=0;
      globalThis.__t35Reads=[];
      globalThis.__t35Posts=[];
      globalThis.__t35Responses=[];
      globalThis.__t35Release=[];
      Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>globalThis.__t35Visible?'visible':'hidden'});
      const original=fetch;
      globalThis.fetch=async(path,options)=>{
        const value=String(path),write=options?.method==='POST'&&value.endsWith('/read-position');
        if(write)globalThis.__t35Posts.push(JSON.parse(options.body));
        if(value===${JSON.stringify(path)}&&options?.method!=='POST'){
          const read={status:'pending'};
          globalThis.__t35Reads.push(read);
          try{
            const response=await original(path,options);
            read.status=response.status;
            return response;
          }catch(error){read.status='failed';throw error;}
        }
        const response=await original(path,options);
        if(write)globalThis.__t35Responses.push({status:response.status,body:await response.clone().json()});
        if(value==='/api/lifecycle/bootstrap'&&globalThis.__t35HoldIdentity){
          globalThis.__t35FreshIdentity=(await response.clone().json()).principal_id;
          globalThis.__t35HeldIdentity++;
          return new Promise(resolve=>globalThis.__t35Release.push(()=>resolve(response)));
        }
        return response;
      };
    })()`});
    await browser.command('Page.navigate',{url:f.origin+'/workbench/app/items/ticket/'+selected.ticket.id+'?detail=page'});
    await browser.waitFor(`${material}&&document.body.innerText.includes('林舟')`);
    // A collapsed timeline entry may ellipsize text. Use its real disclosure before scrolling.
    await browser.evaluate(`(()=>{
      const node=${material};
      if(node.scrollWidth>node.clientWidth+1||node.scrollHeight>node.clientHeight+1)node.closest('.record-content[aria-expanded="false"]')?.click();
    })()`);
    await waitForAnimationsSettled(browser,'.detail-page');
    assert.deepEqual(await browser.evaluate('globalThis.__t35Posts'),[]);
    await browser.evaluate('globalThis.__t35HoldIdentity=true');
    const separator=f.secondCookie.indexOf('=');assert.ok(separator>0);
    await browser.command('Network.deleteCookies',{name:f.browserCookie.name,url:f.origin+'/'});
    const cookieResult=await browser.command('Network.setCookie',{name:f.secondCookie.slice(0,separator),value:f.secondCookie.slice(separator+1),url:f.origin+'/',httpOnly:true,sameSite:'Strict'}) as {success:boolean};assert.equal(cookieResult.success,true);
    // The app disables focus refetch; request a genuine identity response at the transport boundary.
    await browser.evaluate("void fetch('/api/lifecycle/bootstrap')");
    await browser.waitFor('globalThis.__t35HeldIdentity>0');
    assert.equal(await browser.evaluate('globalThis.__t35FreshIdentity'),f.principals[1]?.id,'the delayed public identity response must actually belong to B');
    assert.deepEqual(await browser.evaluate('globalThis.__t35Reads'),[],'the hidden material must not start a read');
    // Reveal once, with the actual BOT text fully in view and the old identity still on screen.
    await browser.waitFor(`(()=>{
      const node=${material};
      if(!node?.checkVisibility({opacityProperty:true})||!document.hasFocus()||!document.body.innerText.includes('林舟'))return false;
      node.scrollIntoView({block:'center',behavior:'instant'});
      if(node.scrollWidth>node.clientWidth+1||node.scrollHeight>node.clientHeight+1)return false;
      const box=node.getBoundingClientRect(),x=box.left+box.width/2;
      if(box.width<=0||box.height<=0||![box.top+1,box.bottom-1].every(y=>node.contains(document.elementFromPoint(x,y))))return false;
      globalThis.__t35Visible=true;
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
      return true;
    })()`);
    await browser.waitFor("globalThis.__t35Reads.length>0&&globalThis.__t35Reads.every(read=>read.status!=='pending')");
    assert.equal(await browser.evaluate('globalThis.__t35Reads.every(read=>read.status===200)'),true,'the selected ticket read-position GET must succeed under B');
    await browser.waitFor('globalThis.__t35Responses.length>0');
    const responses=await browser.evaluate('globalThis.__t35Responses') as {status:number;body:unknown}[];
    assert.ok(responses.every(response=>response.status===403),'an old A command must not commit for cookie B');
    for(const response of responses)assert.partialDeepStrictEqual(response.body,{error:{code:'WORKBENCH_CSRF_INVALID'}});
    assert.deepEqual(await browser.evaluate('globalThis.__t35Posts.map(({source_ref,revision})=>[source_ref,revision])'),responses.map(()=>[sourceRef,'1']));
    assert.equal(await position(0),'0');assert.equal(await position(1),'0');
    console.log('T35_ACCOUNT_REJECTED '+JSON.stringify({responses,A:'0',B:'0',old_identity_visible:await browser.evaluate("document.body.innerText.includes('林舟')")}));
    await browser.waitFor("!document.body.innerText.includes('林舟')");
    await browser.evaluate('(()=>{globalThis.__t35HoldIdentity=false;for(const release of globalThis.__t35Release.splice(0))release();})()');
    await browser.waitFor("!document.body.innerText.includes('林舟')");
    await writeFile(join(directory,'switched-current-scope-1280.png'),Buffer.from(await browser.screenshot(),'base64'));console.log('T35_ACCOUNT_SWITCH '+JSON.stringify({directory,held_identity_delivery:true,rejected_responses:responses.length}));
  }catch(error){
    failure=error;
    try{
      if(browser){
        const diagnostics=await browser.evaluate(`({
          text:document.body.innerText,visible:globalThis.__t35Visible,focused:document.hasFocus(),
          held_identity:globalThis.__t35HeldIdentity,reads:globalThis.__t35Reads,
          posts:globalThis.__t35Posts,responses:globalThis.__t35Responses,
          materials:Array.from(document.querySelectorAll('.activity-list .record-text'),node=>({
            ref:node.dataset.personalReadRef,revision:node.dataset.personalReadRevision,
            box:node.getBoundingClientRect().toJSON(),clientWidth:node.clientWidth,scrollWidth:node.scrollWidth
          }))
        })`);
        await writeFile(join(directory,'failure.json'),JSON.stringify(diagnostics));
        await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));
      }
    }catch(diagnosticFailure){failure=new AggregateError([failure,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}
  }
  await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
}));
