import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { selectBrowserTarget,launchSystemBrowser,closeBrowserTestResources } from './helpers/p2-006-browser-harness.mjs';

test('browser target selection accepts only explicit same-origin redirect paths and rejects ambiguous pages',()=>{
  const page=url=>({type:'page',url,webSocketDebuggerUrl:'ws://127.0.0.1:12345/devtools/page/owned'});
  const options={url:'http://127.0.0.1:1234/reporter/open#grant=synthetic',redirectPaths:['/reporter/']};
  const target=page('http://127.0.0.1:1234/reporter/');
  assert.equal(selectBrowserTarget([page('https://foreign.invalid/reporter/'),page('http://127.0.0.1:1234/unrelated'),target],options),target);
  assert.equal(selectBrowserTarget([target],{url:options.url}),null);
  assert.throws(()=>selectBrowserTarget([target,target],options),/TARGET_AMBIGUOUS/u);
  assert.throws(()=>selectBrowserTarget([],{...options,redirectPaths:['//foreign.invalid/']}));
});

test('browser cleanup errors cannot skip a second browser or leave the HTTP listener, and preserve the original assertion',async()=>{
  const server=http.createServer((_,res)=>res.end('synthetic'));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const primary=new Error('ORIGINAL_ASSERTION'),cleanup=new Error('PROFILE_CLEANUP_FAILED');let secondClosed=false;
  await assert.rejects(closeBrowserTestResources([
    async()=>{throw cleanup;},async()=>{secondClosed=true;},
    ()=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve())),
  ],primary),error=>error instanceof AggregateError&&error.errors[0]===primary&&error.errors[1]===cleanup);
  assert.equal(secondClosed,true);assert.equal(server.listening,false);
});

test('real browser startup follows an immediate declared redirect and cancellation cleans an unreturned owned profile',{timeout:60000},async()=>{
  const server=http.createServer((_,res)=>{res.writeHead(200,{'content-type':'text/html'});res.end('<script>history.replaceState(null,"","/after")</script><p id="ready">synthetic</p>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port+'/before';let browser,primaryError=null;
  try{
    browser=await launchSystemBrowser({url,width:600,height:400,redirectPaths:['/after']});
    await browser.waitFor("location.pathname==='/after'&&document.querySelector('#ready')!==null");
    await browser.close();browser=null;
    const profiles=async()=>new Set((await readdir(tmpdir())).filter(n=>n.startsWith('p2-006-browser-')));
    const before=await profiles(),controller=new AbortController();controller.abort(new Error('OWNED_STARTUP_CANCELLED'));
    await assert.rejects(launchSystemBrowser({url,width:600,height:400,signal:controller.signal}),/OWNED_STARTUP_CANCELLED/u);
    assert.deepEqual(await profiles(),before);
  }catch(error){primaryError=error;}finally{
    await closeBrowserTestResources([()=>browser?.close(),()=>new Promise((resolve,reject)=>{
      server.closeAllConnections?.();server.close(error=>error?reject(error):resolve());
    })],primaryError);
  }
});
