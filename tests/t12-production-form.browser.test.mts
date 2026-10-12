import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {withT12Profile} from './helpers/t12-profile-fixture.mjs';
import {acceptedSetup,object,text,version} from './helpers/t07-public-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
type RequestFact={order:number;method:string;path:string;status:number|null;body:unknown;idempotency:unknown;if_match:unknown;csrf:boolean;origin:boolean};
async function textarea(browser:Browser,selector:string,value:string){await browser.evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);}

test('formal production detail requires explicit SELF group, separate blank public summary and preview confirmation before one atomic takeover-completion POST',async()=>{
 await withT12Profile(async f=>{
  const s=await acceptedSetup(f);assert.equal((await s.a.post(s.path+'/start',{client_command_id:randomUUID(),expected_version:version(s.before.version),reason_code:'T12_BROWSER_START'})).status,200);
  const current=(await s.b.get(s.path)).value,cycle=object(current.handling_cycle),cookie=f.browserCookies[2];assert.ok(cookie);assert.equal(typeof cookie.url,'string');
  const capability=(await s.b.get('/api/lifecycle/bootstrap')).value;assert.equal(capability.ticket_takeover_completion_enabled,true);assert.equal(capability.ticket_takeover_completion_draft_recovery_enabled,false);
  const requests:RequestFact[]=[],observe=(request:IncomingMessage,response:ServerResponse)=>{
   if(!request.headers.cookie?.includes(cookie.name+'='+cookie.value))return;const path=new URL(request.url??'/',f.origin).pathname;if(!path.startsWith('/api/'))return;
   const fact:RequestFact={order:requests.length,method:request.method??'',path,status:null,body:null,idempotency:request.headers['idempotency-key'],if_match:request.headers['if-match'],csrf:typeof request.headers['x-csrf-token']==='string',origin:request.headers.origin===f.origin};requests.push(fact);response.once('finish',()=>{fact.status=response.statusCode;});
   if(fact.method==='POST'){const chunks:Buffer[]=[];request.on('data',(chunk:unknown)=>{if(Buffer.isBuffer(chunk))chunks.push(chunk);});request.once('end',()=>{try{fact.body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fact.body=null;}});}
  };
  const directory=join(tmpdir(),'t12-ui-'+randomUUID());await mkdir(directory);const screenshots:{file:string;width:number;height:number;sha256:string}[]=[];let browser:Browser|undefined,primary:unknown;
  f.runtime.server.on('request',observe);
  const capture=async(name:string)=>{assert.ok(browser);await browser.evaluate("document.querySelector('.ticket-takeover-completion')?.scrollIntoView({block:'center'})");const bytes=Buffer.from(text(await browser.screenshot()),'base64'),file=join(directory,name);await writeFile(file,bytes);screenshots.push({file:file.replaceAll('\\','/'),width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')});};
  try{
   browser=await launchSystemBrowser({url:f.origin+'/workbench/app/items/ticket/'+s.first.ticket.id,width:1280,height:900,cookies:[{...cookie,url:text(cookie.url)}]});assert.ok(browser);
   await browser.waitFor("Boolean(document.querySelector('#detail-title'))");assert.equal(await browser.evaluate("Math.round(document.querySelector('.detail-dialog').getBoundingClientRect().width)"),600);
   assert.equal(await browser.evaluate("Boolean(document.querySelector('.ticket-takeover-completion'))"),true,'the formal production bundle must expose the independent composite form');
   await browser.waitFor("document.querySelector('.ticket-takeover-completion select')?.options.length>2&&document.querySelector('.ticket-takeover-completion select').disabled===false");
   assert.equal(await browser.evaluate("document.querySelector('.ticket-takeover-completion select').value"),'');assert.equal(await browser.evaluate("document.querySelector('.ticket-takeover-completion input[value=TAKE_SELECTED]').checked"),true);
   assert.equal(await browser.evaluate("document.querySelectorAll('.ticket-takeover-completion [data-session-choice]:checked').length"),0);
   await textarea(browser,'#takeover-completion-process','T12_FORM_INTERNAL_CANARY：独立排查过程');assert.equal(await browser.evaluate("document.querySelector('#takeover-completion-summary').value"),'');
   await browser.evaluate("(()=>{const input=document.querySelector('.ticket-takeover-completion select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(input,'T07_NETWORK');input.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('.ticket-takeover-completion input[value=RETAIN_CURRENT]').click();})()");
   await textarea(browser,'#takeover-completion-summary','合成服务已恢复。');assert.equal(await browser.evaluate("document.querySelector('[data-action=takeover-and-complete]').disabled"),true);
   assert.equal(await browser.evaluate("document.querySelector('[data-takeover-completion-preview]').textContent"),'合成服务已恢复。');await browser.evaluate("document.querySelector('#takeover-completion-confirmed').click()");
   await textarea(browser,'#takeover-completion-summary','合成服务已恢复，请重新尝试。');assert.equal(await browser.evaluate("document.querySelector('#takeover-completion-confirmed').checked"),false);
   await browser.evaluate("document.querySelector('#takeover-completion-confirmed').click()");await browser.waitFor("document.querySelector('[data-action=takeover-and-complete]').disabled===false");assert.equal(requests.filter(row=>row.method==='POST').length,0);await capture('independent-preview-600px.png');
   await browser.evaluate("document.querySelector('[data-action=takeover-and-complete]').click()");await browser.waitFor("document.querySelector('.ticket-takeover-completion')?.innerText.includes('已接管并完工')&&document.querySelector('.properties')?.innerText.includes('已关闭')");
   const posts=requests.filter(row=>row.method==='POST');assert.equal(posts.length,1);const post=posts[0];assert.ok(post);const body=object(post.body),id=text(body.client_command_id);assert.equal(post.status,200);assert.equal(post.path,s.path+'/takeover-and-complete');assert.equal(post.idempotency,id);assert.equal(post.if_match,'"'+version(current.version)+'"');assert.equal(post.csrf,true);assert.equal(post.origin,true);
   assert.deepEqual(body,{client_command_id:id,expected_version:version(current.version),reason_code:'STAFF_COMPLETED',resolver_team_id:'T07_NETWORK',handling_cycle_id:text(cycle.id),communication_choice:'RETAIN_CURRENT',sessions:[],internal_process:'T12_FORM_INTERNAL_CANARY：独立排查过程',external_summary:'合成服务已恢复，请重新尝试。',external_summary_confirmed:true});
   assert.ok(requests.some(row=>row.order>post.order&&row.method==='GET'&&[s.path,'/api/workbench/items/ticket/'+s.first.ticket.id].includes(row.path)&&row.status===200));const after=(await s.b.get(s.path)).value;assert.equal(after.status,'CLOSED');assert.equal(after.assignee_id,s.actor.id);assert.equal(after.version,version(current.version)+2);assert.equal(object(after.handling_cycle).id,cycle.id);await capture('committed-current-facts-600px.png');
   await browser.command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});assert.ok(await browser.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'));await capture('committed-narrow-390px.png');
  }catch(error){primary=error;if(browser){await capture('failure.png');await writeFile(join(directory,'failure.json'),JSON.stringify({requests,page:await browser.evaluate('({text:document.body.innerText,path:location.pathname})')}));}}
  await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{f.runtime.server.removeListener('request',observe);assert.equal((await f.runtime.observability.metrics()).sse_clients,0);},async()=>{const diagnostic=join(directory,'receipt.json');await writeFile(diagnostic,JSON.stringify({formal_production_bundle:true,real_http_pg:true,requests,screenshots,primary_failure:primary instanceof Error?primary.message:null}));console.log('T12_BROWSER_DIAGNOSTIC '+JSON.stringify({file:diagnostic.replaceAll('\\','/'),screenshots}));}],primary);
 },{recoveryEnabled:false});
});
