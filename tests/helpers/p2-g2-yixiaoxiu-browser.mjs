import assert from 'node:assert/strict';
import {createServer as httpsServer} from 'node:https';
import {request as httpRequest} from 'node:http';
import {createHash,createPublicKey,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {createWeComWebOAuth} from '../../src/p2-g2-wecom-web-oauth.mjs';
import {createWeComOAuthCodeResolver} from '../../src/p2-g2-wecom-oauth-provider.mjs';
import {createYxxReadonlyServer} from '../../src/p2-g2-yixiaoxiu-server.mjs';
import {entryConfig,entryKey,listenYxx,stopYxx} from './p2-g2-yixiaoxiu-fixture.mjs';
import {launchSystemBrowser} from './p2-006-browser-harness.mjs';

export async function createYxxBrowserFixture({pool,createApp=null}){
  const directory=await mkdtemp(join(tmpdir(),'p2-g2-yxx-tls-'));
  const openssl=['D:/Program Files/Git/usr/bin/openssl.exe','C:/Program Files/Git/usr/bin/openssl.exe'].find(existsSync);
  if(!openssl)throw new Error('YXX_TEST_OPENSSL_REQUIRED');
  let proxy,app,origin,base,oauth,currentMember='synthetic-A',providerCalls=0,hold=false,authClock=Date.now();
  const codes=new Map(),held=[],sockets=new Set();
  let failTimeline=false,holdDetail=false;const heldDetail=[];
  try{
    execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(directory,'key.pem'),'-out',join(directory,'cert.pem'),
      '-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore',windowsHide:true});
    const key=await readFile(join(directory,'key.pem')),cert=await readFile(join(directory,'cert.pem'));
    const certificateSpki=createHash('sha256').update(createPublicKey(cert).export({type:'spki',format:'der'})).digest('base64');
    proxy=httpsServer({key,cert},async(request,response)=>{
      const url=new URL(request.url,origin);
      if(url.pathname==='/synthetic-start'){response.writeHead(200,{'content-type':'text/html'});response.end('<!doctype html><title>合成入口测试</title>');return;}
      if(url.pathname==='/synthetic-provider'){
        const send=()=>{const code=randomUUID();codes.set(code,currentMember);response.writeHead(303,{location:origin+'/wecom/yixiaoxiu/callback?code='+code+'&state='+url.searchParams.get('state')});response.end();};
        if(hold)held.push(send);else send();return;
      }
      if(failTimeline&&url.pathname.endsWith('/timeline')){failTimeline=false;response.writeHead(503,{'content-type':'application/json'});response.end('{"error":{"code":"YXX_ENTRY_UNAVAILABLE"}}');return;}
      const outgoing=httpRequest(base+request.url,{method:request.method,headers:{...request.headers,host:new URL(origin).host}},incoming=>{
        const chunks=[];incoming.on('data',chunk=>chunks.push(chunk));incoming.on('end',()=>{
          const send=()=>{const headers={...incoming.headers};
            if(headers.location?.startsWith('https://open.weixin.qq.com/')){
              const state=new URL(headers.location).searchParams.get('state');headers.location=origin+'/synthetic-provider?state='+state;
            }
            response.writeHead(incoming.statusCode,headers);response.end(Buffer.concat(chunks));
          };
          if(holdDetail&&/^\/api\/reporter\/tickets\/[A-Za-z0-9_-]{32}$/u.test(url.pathname))heldDetail.push(send);else send();
        });
      });outgoing.on('error',()=>{if(!response.headersSent){response.writeHead(503);response.end();}});request.pipe(outgoing);
    });
    proxy.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
    await new Promise(r=>proxy.listen(0,'127.0.0.1',r));origin='https://127.0.0.1:'+proxy.address().port;
    const resolveCode=createWeComOAuthCodeResolver({accessTokenProvider:async()=> 'synthetic-only-token',fetchImpl:async url=>{
      assert.equal(url.origin,'https://qyapi.weixin.qq.com');providerCalls++;
      const userid=codes.get(url.searchParams.get('code'));codes.delete(url.searchParams.get('code'));
      return new Response(JSON.stringify(userid?{errcode:0,userid}:{errcode:40029}));
    }});
    function newApp(){oauth=createWeComWebOAuth({enabled:true,publicOrigin:origin,corpId:entryConfig.corpId,agentId:entryConfig.agentId,resolveCode,now:()=>authClock});
      app=createApp?createApp({oauth,origin}):createYxxReadonlyServer({pool,oauth,publicOrigin:origin,reporterHmacSecret:entryKey,reporterMemberEntry:entryConfig});}
    newApp();base=await listenYxx(app);
    return {origin,certificateSpki,
      ownedResourceState:()=>({listeners:Number(proxy.listening)+Number(app.listening),sockets:sockets.size,tlsDirectories:existsSync(directory)?1:0}),
      get providerCalls(){return providerCalls;},get pendingLogins(){return held.length;},get pendingDetails(){return heldDetail.length;},
      setMember:value=>{currentMember=value;},expireAuth:()=>{authClock+=900001;},holdLogins:()=>{hold=true;},releaseLogin:()=>{held.shift()?.();},
      releaseLogins:()=>{hold=false;for(const send of held.splice(0))send();},
      failNextTimeline:()=>{failTimeline=true;},holdDetails:()=>{holdDetail=true;},releaseDetails:()=>{holdDetail=false;for(const send of heldDetail.splice(0))send();},
      launch:({width=1440,height=900,path='/synthetic-start'}={})=>launchSystemBrowser({url:origin+path,width,height,certificateSpki}),
      async restart(){await stopYxx(app);newApp();base=await listenYxx(app);},
      async close(){oauth.close();for(const socket of sockets)socket.destroy();await stopYxx(proxy);await stopYxx(app);await cleanup();},
    };
  }catch(error){oauth?.close();for(const socket of sockets)socket.destroy();if(proxy?.listening)await stopYxx(proxy);if(app?.listening)await stopYxx(app);await cleanup();throw error;}
  async function cleanup(){const owned=relative(resolve(tmpdir()),resolve(directory));assert.ok(!isAbsolute(owned)&&/^p2-g2-yxx-tls-[A-Za-z0-9]+$/u.test(owned));await rm(directory,{recursive:true,force:true});}
}
export async function yxxTab(browser,url){
  const {targetId}=await browser.command('Target.createTarget',{url});
  const {sessionId}=await browser.command('Target.attachToTarget',{targetId,flatten:true});
  const command=(method,params={})=>browser.command(method,params,sessionId);
  await command('Runtime.enable');
  return {command,async evaluate(expression){const r=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error('YXX_TAB_EVALUATION_FAILED');return r.result.value;},
    async waitFor(expression){await pollYxx(()=>this.evaluate(expression));},close:()=>browser.command('Target.closeTarget',{targetId})};
}
export async function pollYxx(fn){const deadline=Date.now()+20000;while(Date.now()<deadline){if(await fn())return;await new Promise(r=>setTimeout(r,40));}throw new Error('YXX_TEST_WAIT_TIMEOUT');}
