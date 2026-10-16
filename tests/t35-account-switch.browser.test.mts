import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {withT35Fixture} from './helpers/t35-read-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

test('T35 an old visible scope cannot write for a switched account while fresh identity delivery is delayed',{timeout:120_000},()=>withT35Fixture(async f=>{
  const selected=f.tickets[1];assert.ok(selected);const path='/api/workbench/items/ticket/'+selected.ticket.id+'/read-position';
  const position=async(reader:0|1)=>(await (await f.get(path,reader)).json() as {sources:{last_read_position:string}[]}).sources[0]?.last_read_position;
  assert.equal(await position(0),'0');assert.equal(await position(1),'0');
  const directory=join(tmpdir(),'t35-account-switch-'+randomUUID());await mkdir(directory);let browser:Awaited<ReturnType<typeof launchSystemBrowser>>|undefined,failure:unknown;
  try{
    browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:1280,height:1000,cookies:[{...f.browserCookie,url:f.origin+'/'}]});assert.ok(browser);
    await browser.command('Emulation.setFocusEmulationEnabled',{enabled:true});await browser.command('Page.enable');
    await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{globalThis.__t35Visible=false;globalThis.__t35HoldIdentity=false;globalThis.__t35HeldIdentity=0;globalThis.__t35OtherReads=0;globalThis.__t35Posts=[];globalThis.__t35Responses=[];globalThis.__t35Release=[];Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>globalThis.__t35Visible?'visible':'hidden'});const original=fetch;globalThis.fetch=(path,options)=>{const value=String(path),identity=value==='/api/lifecycle/bootstrap';if(options?.method==='POST'&&value.endsWith('/read-position'))globalThis.__t35Posts.push(JSON.parse(options.body));if(value.endsWith('/read-position')&&options?.method!=='POST')globalThis.__t35OtherReads++;return original(path,options).then(async response=>{if(value.endsWith('/read-position')&&options?.method==='POST')globalThis.__t35Responses.push({status:response.status,body:await response.clone().json()});if(value.endsWith('/read-position')&&options?.method!=='POST'){await response.clone().json();globalThis.__t35OtherReads--;}if(identity&&globalThis.__t35HoldIdentity){globalThis.__t35FreshIdentity=(await response.clone().json()).principal_id;globalThis.__t35HeldIdentity++;return new Promise(resolve=>globalThis.__t35Release.push(()=>resolve(response)));}return response;});};})()`});
    await browser.command('Page.navigate',{url:f.origin+'/workbench/app/items/ticket/'+selected.ticket.id+'?detail=page'});
    await browser.waitFor("document.querySelector('.activity-list p')&&document.body.innerText.includes('林舟')");
    assert.deepEqual(await browser.evaluate('globalThis.__t35Posts'),[]);
    await browser.evaluate('globalThis.__t35HoldIdentity=true');
    const separator=f.secondCookie.indexOf('=');assert.ok(separator>0);
    await browser.command('Network.deleteCookies',{name:f.browserCookie.name,url:f.origin+'/'});
    const cookieResult=await browser.command('Network.setCookie',{name:f.secondCookie.slice(0,separator),value:f.secondCookie.slice(separator+1),url:f.origin+'/',httpOnly:true,sameSite:'Strict'}) as {success:boolean};assert.equal(cookieResult.success,true);
    // The app disables focus refetch; request a genuine identity response at the transport boundary.
    await browser.evaluate("void fetch('/api/lifecycle/bootstrap')");
    await browser.evaluate("(()=>{document.querySelector('.activity-list p').scrollIntoView({block:'center'});globalThis.__t35Visible=true;document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'));})()");
    await browser.waitFor('globalThis.__t35HeldIdentity>0&&globalThis.__t35OtherReads===0');
    assert.equal(await browser.evaluate('globalThis.__t35FreshIdentity'),f.principals[1]?.id,'the delayed public identity response must actually belong to B');
    await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await browser.waitFor('globalThis.__t35Responses.length>0');
    const responses=await browser.evaluate('globalThis.__t35Responses') as {status:number;body:unknown}[];
    assert.ok(responses.every(response=>response.status===403),'an old A command must not commit for cookie B');
    assert.equal(await position(0),'0');assert.equal(await position(1),'0');
    console.log('T35_ACCOUNT_REJECTED '+JSON.stringify({responses,A:'0',B:'0',old_identity_visible:await browser.evaluate("document.body.innerText.includes('林舟')")}));
    await browser.waitFor("!document.body.innerText.includes('林舟')");
    await browser.evaluate('(()=>{globalThis.__t35HoldIdentity=false;for(const release of globalThis.__t35Release.splice(0))release();})()');
    await browser.waitFor("!document.body.innerText.includes('林舟')");
    await writeFile(join(directory,'switched-current-scope-1280.png'),Buffer.from(await browser.screenshot(),'base64'));console.log('T35_ACCOUNT_SWITCH '+JSON.stringify({directory,held_identity_delivery:true,rejected_responses:responses.length}));
  }catch(error){failure=error;try{if(browser){await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText,posts:globalThis.__t35Posts,responses:globalThis.__t35Responses,held_identity:globalThis.__t35HeldIdentity,other_reads:globalThis.__t35OtherReads})')));}}catch(diagnosticFailure){failure=new AggregateError([failure,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
  await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
}));
