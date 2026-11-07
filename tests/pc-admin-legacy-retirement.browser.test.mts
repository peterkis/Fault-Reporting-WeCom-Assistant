import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {createWorkbenchStaticHandler} from '../app/server/src/p2-006-workbench-static.mjs';
import {withT32Fixture,seedT32SessionExceptions} from './helpers/t32-notification-exception-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {clickWorkbenchControl} from './helpers/heroui-workbench-controls.mjs';
import {testRoots} from './helpers/migration-roots.mjs';

const portals={
 '/workbench':'/workbench/app/','/workbench/':'/workbench/app/',
 '/workbench/lifecycle':'/workbench/app/','/workbench/incidents':'/workbench/app/incidents/candidates',
};
const resources=['workbench.css','workbench.js','workbench-state.mjs','time-display.mjs','lifecycle.css','lifecycle.js','incidents.js'];

test('a bare G1 static port cannot render the retired UI or redirect to an unmounted PC frontend',async()=>{
 const staticHandler=createWorkbenchStaticHandler({enabled:true});
 const server=createServer((request,response)=>{void(async()=>{if(await staticHandler(new URL(request.url??'/', 'http://127.0.0.1').pathname,response))return;response.writeHead(404,{'cache-control':'no-store'});response.end();})().catch(()=>{response.writeHead(500);response.end();});});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
 try{for(const path of [...Object.keys(portals),...resources.map(name=>'/static/workbench/'+name)]){const response=await fetch('http://127.0.0.1:'+address.port+path,{redirect:'manual'});assert.equal(response.status,404,path);assert.equal(response.headers.get('location'),null);}}
 finally{await new Promise<void>((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();});assert.equal(server.listening,false);}
});

test('formal PC aliases redirect without old assets and the current bundle keeps safe text and readonly exception navigation',{timeout:240000},async()=>{
 await withT32Fixture(async f=>{
  const seed=await seedT32SessionExceptions(f,1),calls=seed.senderCalls(),cookie=f.browserCookies[0];assert.ok(cookie);const headers={cookie:f.cookies[0]??''};
  for(const [oldPath,destination] of Object.entries(portals)){
   const response=await fetch(f.origin+oldPath,{headers,redirect:'manual'});assert.equal(response.status,302,oldPath);assert.equal(response.headers.get('location'),destination);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(await response.text(),'');
   const target=await fetch(f.origin+destination,{headers});assert.equal(target.status,200,destination);assert.match(target.headers.get('content-type')??'',/text\/html/u);assert.match(await target.text(),/workbench\/app\/assets\//u);
  }
  for(const asset of resources){const response=await fetch(f.origin+'/static/workbench/'+asset,{headers,redirect:'manual'});assert.equal(response.status,404,asset);assert.equal(response.headers.get('location'),null);}
  const payload='<img src=x onerror="globalThis.__retiredUiXss=true">（合成）',ticket=f.tickets[0];assert.ok(ticket);await f.pool.query('UPDATE pilot_ticket.ticket SET title=$2 WHERE id=$1::uuid',[ticket.ticket.id,payload]);
  let browser:Awaited<ReturnType<typeof launchSystemBrowser>>|undefined,failure:unknown;const requests:string[]=[],posts:string[]=[];const observe=(request:import('node:http').IncomingMessage)=>{const path=new URL(request.url??'/',f.origin).pathname;requests.push(path);if(request.method==='POST')posts.push(path);};f.runtime.server.on('request',observe);
  const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory,{recursive:true});
  try{
   browser=await launchSystemBrowser({url:f.origin+'/workbench/lifecycle',redirectPaths:['/workbench/app/'],width:1280,height:1080,cookies:[{...cookie,url:f.origin+'/'}]});assert.ok(browser);
   await browser.waitFor("Boolean(document.querySelector('.ds-board-page-header'))");assert.equal(await browser.evaluate('location.pathname'),'/workbench/app/');
   await browser.waitFor("[...document.querySelectorAll('.ticket-card h3')].some(n=>n.textContent==="+JSON.stringify(payload)+')');
   assert.equal(await browser.evaluate("Boolean(document.querySelector('.ticket-card img[src=x]'))||globalThis.__retiredUiXss===true"),false,'the current PC renders an untrusted title as text, not retired native DOM markup');
   await browser.command('Page.navigate',{url:f.origin+'/workbench/incidents'});await browser.waitFor("location.pathname==='/workbench/app/incidents/candidates'&&Boolean(document.querySelector('.ds-page'))");assert.equal(await browser.evaluate("Boolean(document.querySelector('.service-header'))"),false);
   await browser.command('Page.navigate',{url:f.origin+'/workbench/app/notification-exceptions'});await browser.waitFor("document.querySelectorAll('[data-exception-row]').length===1");await clickWorkbenchControl(browser,'[data-action=open-exception]');await browser.waitFor("Boolean(document.querySelector('[data-exception-detail][data-delivery-id]'))");
   await browser.waitFor("Boolean(document.querySelector('[data-exception-detail] a'))");
   assert.equal(await browser.evaluate("/前往核验处置|可前往来源/.test(document.querySelector('[data-exception-detail]').textContent)"),false);
   const links=await browser.evaluate("[...document.querySelectorAll('[data-exception-detail] a')].map(n=>n.getAttribute('href'))");assert.ok(Array.isArray(links)&&links.length>0&&links.every(value=>typeof value==='string'&&value.startsWith('/workbench/app/')));
   assert.equal(requests.some(path=>path.startsWith('/static/workbench/')),false);assert.deepEqual(posts,[]);assert.equal(seed.senderCalls(),calls);
   const file=join(directory,'new-detail-1280.png'),bytes=Buffer.from(await browser.screenshot(),'base64');await writeFile(file,bytes);console.log('WEB01_BROWSER '+JSON.stringify({surface:'CURRENT_PC_NO_LEGACY_UI',screenshots:[{file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')}]}));
   const {sourceRoot}=testRoots();const resourceManifest=JSON.parse(await readFile(join(sourceRoot,'tools/ts-migration/resources.json'),'utf8')) as {files:string[]};assert.equal(resourceManifest.files.some(path=>path.startsWith('web/p2-workbench/')),false);
  }catch(error){failure=error;if(browser)await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));}
  finally{f.runtime.server.off('request',observe);await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);}
 });
});
