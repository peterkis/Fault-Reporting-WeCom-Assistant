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

test('real browser startup waits for its initial document before allowing relative navigation',{timeout:60000},async()=>{
  let responseTimer;
  const server=http.createServer((request,response)=>{
    if(request.url==='/before'){
      // Keep the initial HTTP response pending while DevTools advertises its URL.
      responseTimer=setTimeout(()=>{response.writeHead(200,{'content-type':'text/html'});response.end('<p id="ready">initial document</p>');},3000);
    }else{response.writeHead(200,{'content-type':'text/html'});response.end('<p id="next">next document</p>');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;let browser,primaryError=null;
  try{
    browser=await launchSystemBrowser({url:origin+'/before',width:600,height:400});
    assert.equal(await browser.evaluate('location.href'),origin+'/before');
    await browser.evaluate("location.assign('/after')",{awaitPromise:false});
    await browser.waitFor("location.pathname==='/after'&&document.querySelector('#next')!==null");
  }catch(error){primaryError=error;}finally{
    clearTimeout(responseTimer);
    await closeBrowserTestResources([()=>browser?.close(),()=>new Promise((resolve,reject)=>{
      server.closeAllConnections?.();server.close(error=>error?reject(error):resolve());
    })],primaryError);
  }
});

test('real browser close waits for the owned DevTools socket to finish closing',{timeout:60000},async()=>{
  const NativeWebSocket=globalThis.WebSocket;let closeTimer,nativeClosed=false;
  // Retain the real Chrome/CDP transport; delay its CLOSED observation to expose
  // the same asynchronous close window reported by the SS-009 cleanup observer.
  class DelayedCloseWebSocket extends NativeWebSocket{
    closeObserved=false;
    constructor(...args){super(...args);this.addEventListener('close',()=>{
      nativeClosed=true;closeTimer=setTimeout(()=>{this.closeObserved=true;},1000);
    });}
    get readyState(){const state=super.readyState;return state===NativeWebSocket.CLOSED&&!this.closeObserved?NativeWebSocket.CLOSING:state;}
  }
  const server=http.createServer((_,response)=>{response.writeHead(200,{'content-type':'text/html'});response.end('<p>owned close regression</p>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser,primaryError=null;
  try{
    globalThis.WebSocket=DelayedCloseWebSocket;
    browser=await launchSystemBrowser({url:'http://127.0.0.1:'+server.address().port+'/',width:600,height:400});
    await browser.close();
    assert.equal(nativeClosed,true);
    assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});
  }catch(error){primaryError=error;}finally{
    await closeBrowserTestResources([()=>browser?.close(),()=>{
      clearTimeout(closeTimer);globalThis.WebSocket=NativeWebSocket;
    },()=>new Promise((resolve,reject)=>{server.closeAllConnections?.();server.close(error=>error?reject(error):resolve());})],primaryError);
  }
});
