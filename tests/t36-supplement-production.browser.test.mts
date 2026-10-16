// SOURCE-only production-bundle tracer; selectors below are PROPOSED_NOT_MOUNTED.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {withT36WebFixture} from './helpers/t36-supplement-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
async function capture(browser:Browser,directory:string,name:string){
 const file=join(directory,name),bytes=Buffer.from(await browser.screenshot(),'base64');await writeFile(file,bytes);
 console.log('WEB01_BROWSER '+JSON.stringify({screenshots:[{file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')}]}));
}

test('T36 real production viewing reads a WEB supplement without clearing it; explicit exact follow-up and later revision stay separate',{timeout:240000},()=>withT36WebFixture(async f=>{
 const text='T36正式前端看到仍待明确跟进的补充',r2=await f.supplement('1',text);
 const pending=await f.page();assert.equal(pending.has_pending_supplements,true);
 assert.equal(pending.items.find(item=>item.source_ref===r2.source_ref)?.follow_up_state,'PENDING');
 const conversations=await f.read<{items:unknown[]}>(f.itemPath+'/conversations');assert.deepEqual(conversations.items,[],'real WEB report has no fabricated Conversation');
 const before=await f.facts('staff'),directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);
 let browser:Browser|undefined,primaryError:unknown;
 const row=(sourceRef:string,revision:string)=>`[data-supplement-source-ref="${sourceRef}"][data-supplement-revision="${revision}"]`;
 try{
  browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:1920,height:1080,cookies:[f.browserCookie]});assert.ok(browser);
  await browser.command('Emulation.setFocusEmulationEnabled',{enabled:true});await browser.command('Page.enable');
  // Observe actual fetches only; every request/response still uses the real App. No success mock.
  await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
   globalThis.__t36Visible=false;globalThis.__t36FollowGets=[];globalThis.__t36FollowPosts=[];globalThis.__t36ReadAcks=[];
   Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>globalThis.__t36Visible?'visible':'hidden'});
   const original=fetch;globalThis.fetch=(input,options)=>{
    const url=new URL(input instanceof Request?input.url:String(input),location.href),method=options?.method??(input instanceof Request?input.method:'GET');
    const follow=url.origin===location.origin&&url.pathname===${JSON.stringify(f.followPath)};
    if(follow&&method==='POST'){const body=JSON.parse(options.body);globalThis.__t36FollowPosts.push({client_command_id:body.client_command_id,source_ref:body.source_ref,revision:body.revision,mark_followed_up:body.mark_followed_up});}
    return original(input,options).then(async response=>{
     if(follow&&method==='GET'&&response.status===200){const page=await response.clone().json();globalThis.__t36FollowGets.push({status:response.status,has_pending_supplements:page.has_pending_supplements,items:page.items.map(item=>({source_ref:item.source_ref,revision:item.revision,follow_up_state:item.follow_up_state}))});}
     if(url.origin===location.origin&&url.pathname===${JSON.stringify(f.itemPath+'/read-position')}&&method==='POST'&&response.status===200){const ack=await response.clone().json();globalThis.__t36ReadAcks.push({source_kind:ack.source_kind,last_read_position:ack.last_read_position});}
     return response;
    });
   };
  })()`});
  await browser.command('Page.navigate',{url:f.origin+'/workbench/app/items/ticket/'+f.ticketId+'?detail=page'});
  await browser.waitFor('Boolean(document.querySelector("#detail-title"))');await capture(browser,directory,'new-detail-1920.png');
  await browser.waitFor(`globalThis.__t36FollowGets.some(page=>page.items.some(item=>item.source_ref===${JSON.stringify(r2.source_ref)}&&item.revision==='2'&&item.follow_up_state==='PENDING'))`);
  assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(row(r2.source_ref,'2'))})?.getAttribute('data-follow-up-state')`),'PENDING','actual coordinated pending row, not a static legend');
  await browser.evaluate(`(()=>{const body=[...document.querySelectorAll('.activity-list p[data-personal-read-ref]')].find(p=>p.textContent===${JSON.stringify(text)});if(!body)throw Error('ACTUAL_SUPPLEMENT_BODY_REQUIRED');body.scrollIntoView({block:'center'});globalThis.__t36Visible=true;document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'));})()`);
  await browser.waitFor("globalThis.__t36ReadAcks.some(ack=>ack.source_kind==='WEB'&&ack.last_read_position==='2')");
  assert.deepEqual(await f.page(),pending,'actual personal read acknowledgment is separate from team follow-up');
  assert.equal(await browser.evaluate('globalThis.__t36FollowPosts.length'),0,'independent visible reading must not submit a disposition');
  assert.equal(await browser.evaluate(`Boolean(document.querySelector(${JSON.stringify(row(r2.source_ref,'2'))})?.querySelector('[data-action="reply-supplement"]'))`),false,'no Session means no bound reply action or fabricated Conversation');
  const note='T36内部明确记录并跟进，不能自动外发';
  await browser.evaluate(`(()=>{const area=document.querySelector(${JSON.stringify(row(r2.source_ref,'2'))}),field=area?.querySelector('textarea[name="disposition_note"]');if(!field)throw Error('EXPLICIT_DISPOSITION_INPUT_REQUIRED');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,${JSON.stringify(note)});field.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await browser.waitFor(`Boolean(document.querySelector(${JSON.stringify(row(r2.source_ref,'2'))})?.querySelector('[data-action="record-supplement-disposition"]:not(:disabled)'))`);
  await browser.evaluate(`document.querySelector(${JSON.stringify(row(r2.source_ref,'2'))}).querySelector('[data-action="record-supplement-disposition"]').click()`);
  await browser.waitFor(`document.querySelector(${JSON.stringify(row(r2.source_ref,'2'))})?.getAttribute('data-follow-up-state')==='FOLLOWED_UP'`);
  const handled=await f.page();assert.equal(handled.has_pending_supplements,false);assert.equal(handled.items.find(item=>item.source_ref===r2.source_ref)?.follow_up_state,'FOLLOWED_UP');
  const posts=await browser.evaluate('globalThis.__t36FollowPosts') as {client_command_id:string;source_ref:string;revision:string;mark_followed_up:boolean}[];
  assert.equal(posts.length,1);assert.equal(posts[0]?.source_ref,r2.source_ref);assert.equal(posts[0]?.revision,'2');assert.equal(posts[0]?.mark_followed_up,true);
  const after=await f.facts('staff');assert.deepEqual(after.ticket,before.ticket);assert.deepEqual(after.responsibility,before.responsibility);assert.deepEqual(after.events,before.events);assert.deepEqual(after.materialResponsibility,before.materialResponsibility);
  // Personal read may legitimately advance through the real visibility seam; do not freeze it at0.
  const r3=await f.supplement('2','T36明确处置之后新补充仍待跟进');await browser.command('Page.reload');
  await browser.waitFor(`globalThis.__t36FollowGets.some(page=>page.items.some(item=>item.source_ref===${JSON.stringify(r3.source_ref)}&&item.revision==='3'&&item.follow_up_state==='PENDING'))`);
  assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(row(r2.source_ref,'2'))})?.getAttribute('data-follow-up-state')`),'FOLLOWED_UP');
  assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(row(r3.source_ref,'3'))})?.getAttribute('data-follow-up-state')`),'PENDING');
  const current=await f.page();assert.equal(current.has_pending_supplements,true);assert.equal(current.items.find(item=>item.source_ref===r3.source_ref)?.follow_up_state,'PENDING');
  assert.deepEqual((await f.read<{items:unknown[]}>(f.itemPath+'/conversations')).items,[]);await capture(browser,directory,'new-detail-page-1920.png');
 }catch(error){primaryError=error;}
 finally{await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],primaryError);}
}));
