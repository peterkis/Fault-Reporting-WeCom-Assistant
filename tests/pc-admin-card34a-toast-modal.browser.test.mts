import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {withT43Fixture,text,version} from './helpers/t43-full-service-fixture.mjs';
import {start,launch,close,get,post} from './helpers/t43-service-actions.mjs';
import type {Browser} from './helpers/t43-service-actions.mjs';
import {clickWorkbenchControl} from './helpers/heroui-workbench-controls.mjs';
import {waitForAnimationsSettled} from './helpers/browser-animations.mjs';
import {Readable} from 'node:stream';
import {withDetailRestructureFixture} from './helpers/detail-restructure-fixture.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';
import {launchSystemBrowser} from './helpers/p2-006-browser-harness.mjs';
import {createYxxH5Media} from '../app/server/src/yxx-h5-media.mjs';
import {createYxxH5MediaPrivateStore} from '../app/server/src/yxx-h5-media-store.mjs';
import {transactionP2016} from '../app/server/src/p2-016-domain-contracts.mjs';
import type {YxxMemberScope} from '../app/server/src/yxx-self-service-authorization.mjs';

// Card 34A: while a modal is open, page notices stay in the window's bottom-right corner and never enter the modal; with no room
// beside the modal they collapse into a chip whose list opens above it (beside the modal when that room is at least 272 wide, as a
// popover otherwise). Every notice here is real feedback from a real control; the page interceptor only turns a chosen request
// into a conflict.
const WIDTHS=[1920,1440,1280,900] as const;
const CONTROLS='button, input, textarea, select, [role=radio], [role=checkbox], [role=combobox], a[href]';
const interceptor=`(()=>{const original=globalThis.fetch;globalThis.__toastMode={};globalThis.fetch=async function(input,options){
 const url=new URL(input instanceof Request?input.url:String(input),location.href),method=(options?.method??'GET').toUpperCase();
 const rule=method==='POST'?Object.entries(globalThis.__toastMode).find(([suffix])=>url.pathname.endsWith(suffix)):undefined;
 if(rule&&rule[1]==='conflict'){delete globalThis.__toastMode[rule[0]];return new Response(JSON.stringify({ok:false,error:{code:'P2_016_VERSION_CONFLICT',retryable:false}}),{status:409,headers:{'content-type':'application/json'}});}
 return original.call(this,input,options);};})()`;

type Rect={x:number;y:number;width:number;height:number};
interface Layout {dialog:Rect;mode:string;popover:string;hidden:boolean;toasts:Rect[];chip:Rect|null;expanded:string|null;controls:{name:string;hit:boolean;at:string}[]}
const intersects=(a:Rect,b:Rect)=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
/** The open modal, the notices' layout, and for every interactive element of the modal whether its centre hits it. */
const layout=(dialog:string)=>`(()=>{const d=document.querySelector(${JSON.stringify(dialog)}),box=r=>({x:r.x,y:r.y,width:r.width,height:r.height}),v=document.querySelector('.workbench-toast-viewport');
 const toast=n=>n.closest('.workbench-toast-viewport,.workbench-toast-chip-anchor');
 const controls=[...d.querySelectorAll(${JSON.stringify(CONTROLS)})].filter(n=>!toast(n)&&n.checkVisibility()).map(control=>{const n=control.matches('input[type=radio],input[type=checkbox]')?control.closest('label')??control:control;n.scrollIntoView({block:'center',inline:'nearest'});const r=n.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);
  // A visually hidden native radio or checkbox is measured through its label (as a user presses it). A disabled HeroUI button takes
  // no pointer events, so the hit lands on its ancestor; that still proves nothing covers it. A hit on any notice, the chip or its
  // list fails.
  return {name:(control.getAttribute('aria-label')||n.textContent||control.getAttribute('name')||n.tagName).trim().slice(0,24),hit:Boolean(hit&&!toast(hit)&&(hit===n||n.contains(hit)||hit.contains(n))),at:hit?hit.tagName+'.'+String(hit.className).slice(0,40):'none'};});
 const chip=document.querySelector('.workbench-toast-chip-anchor');
 return {dialog:box(d.getBoundingClientRect()),mode:v.dataset.toastMode,popover:v.dataset.toastPopover,hidden:v.hidden,toasts:[...v.querySelectorAll('.workbench-toast[data-visible=true]')].map(n=>box(n.getBoundingClientRect())).filter(r=>r.width>0),
  chip:chip?box(chip.getBoundingClientRect()):null,expanded:chip?chip.querySelector('button').getAttribute('aria-expanded'):null,controls};})()`;

type Table={dialog:string;width:number;mode:string;popover:string|null;controls:number;toasts:number;chip:boolean}[];
type Shots={file:string;width:number;height:number;sha256:string}[];
/** The checks shared by every modal: three persistent notices behind it, four widths, and the chip from the keyboard. */
function modalHarness(b:Browser,directory:string,screenshots:Shots,table:Table,{sources='note+follow'}:{sources?:'note+follow'|'note'|'follow'}={}){
 const minimum=sources==='note+follow'?3:1;
 const size=async(width:number)=>{await b.command('Emulation.setDeviceMetricsOverride',{width,height:width===900?820:1000,deviceScaleFactor:1,mobile:false});};
 const shot=async(name:string)=>{await waitForAnimationsSettled(b);const bytes=Buffer.from(await b.screenshot(),'base64');await writeFile(join(directory,name),bytes);screenshots.push({file:name,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')});};
 const key=async(name:'Enter'|'Escape')=>{const code=name==='Enter'?13:27;await b.command('Input.dispatchKeyEvent',{type:'keyDown',key:name,code:name,windowsVirtualKeyCode:code,...(name==='Enter'?{text:'\r'}:{})});await b.command('Input.dispatchKeyEvent',{type:'keyUp',key:name,code:name,windowsVirtualKeyCode:code});};
 const persistent="document.querySelectorAll('.workbench-toast[data-visible=true]:is(.error,.is-warning)').length";
 // Three notices that wait to be closed: an internal-note conflict (error) with its draft guard (unknown) and a follow conflict
 // (error); without the follow feature only the note conflict. They come from the real composer and follow button behind the open modal: the modal traps focus, so the note is set
 // through the native setter React listens to, and both buttons are pressed programmatically.
 const note=async()=>{
  await b.evaluate("globalThis.__toastMode['/internal-notes']='conflict'");
  await b.evaluate(`(()=>{const area=document.querySelector('.ds-detail-footer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(area,${JSON.stringify('卡34A 合成冲突备注（合成）')});area.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await b.waitFor("[...document.querySelectorAll('.ds-detail-footer button')].some(button=>button.textContent.includes('保存')&&!button.disabled)");
  await b.evaluate("[...document.querySelectorAll('.ds-detail-footer button')].find(button=>button.textContent.includes('保存')&&!button.disabled).click()");
 };
 const follow=async()=>{await b.evaluate("globalThis.__toastMode['/follow']='conflict'");await b.evaluate("document.querySelector('[data-action=toggle-item-follow]').click()");};
 const notices=async()=>{
  if(sources==='follow'){await follow();await b.waitFor("document.querySelectorAll('.workbench-toast[data-visible=true].error').length===1");return;}
  await note();
  if(sources==='note'){await b.waitFor(persistent+'===1');return;}
  await b.waitFor(persistent+'===2');await follow();await b.waitFor(persistent+'===3');
 };
 const measure=async(name:string,dialog:string,width:number)=>{
  await size(width);await waitForAnimationsSettled(b);await b.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const label=name+' '+width,state=await b.evaluate(layout(dialog)) as Layout,shown=await b.evaluate("document.querySelectorAll('.workbench-toast[data-visible=true]').length") as number;
  assert.ok(shown>=minimum&&await b.evaluate(persistent) as number>=minimum,label+': the persistent notices are on screen');
  assert.ok(state.controls.length>=2,label+': the modal has interactive elements '+JSON.stringify(state.controls));
  assert.deepEqual(state.controls.filter(control=>!control.hit),[],label+': every interactive element of the modal is hit at its centre');
  const room=innerRoom(state,width);
  if(room>=Math.min(400,width-32)+32){
   assert.equal(state.mode,'window',label+': beside the modal');assert.equal(state.toasts.length,shown,label+': every notice is shown');assert.equal(state.chip,null,label+': no chip');
   for(const item of state.toasts)assert.ok(!intersects(item,state.dialog),label+': no notice intersects the modal '+JSON.stringify({item,dialog:state.dialog}));
  }else{
   assert.equal(state.mode,'chip',label+': collapsed into a chip');assert.equal(state.hidden,true,label+': the list is hidden');assert.ok(state.chip,label+': the chip is shown');
   assert.ok(state.chip&&!intersects(state.chip,state.dialog),label+': the chip does not intersect the modal '+JSON.stringify(state.chip));
   assert.ok(state.chip&&Math.abs(state.chip.height-32)<=0.5,label+': the chip is 32 high');
   assert.equal(await b.evaluate("document.querySelector('.workbench-toast-chip').textContent.trim()"),shown+' 条提示',label+': the chip counts the notices');
  }
  table.push({dialog:name,width,mode:state.mode,popover:state.mode==='chip'?state.popover:null,controls:state.controls.length,toasts:state.toasts.length,chip:Boolean(state.chip)});
  return state;
 };
 // The chip opens and closes from the keyboard; Esc closes only the list, never the modal.
 const chipKeyboard=async(name:string,dialog:string,width:number,evidence?:string)=>{
  await b.evaluate("document.querySelector('.workbench-toast-chip').focus()");await key('Enter');
  await b.waitFor("document.querySelector('.workbench-toast-chip')?.getAttribute('aria-expanded')==='true'&&!document.querySelector('.workbench-toast-viewport').hidden");
  await waitForAnimationsSettled(b);
  const state=await b.evaluate(layout(dialog)) as Layout,label=name+' '+width+' open';
  assert.equal(state.toasts.length,await b.evaluate("document.querySelectorAll('.workbench-toast[data-visible=true]').length"),label+': the list shows every notice');
  const room=state.dialog.x+state.dialog.width,side=width-20-(room+16);
  if(side>=272){assert.equal(state.popover,'false',label+': the list opens beside the modal');for(const item of state.toasts)assert.ok(!intersects(item,state.dialog),label+': no listed notice intersects the modal');assert.deepEqual(state.controls.filter(control=>!control.hit),[],label+': every interactive element of the modal is still hit');}
  else assert.equal(state.popover,'true',label+': too little room beside the modal, so the list is a popover');
  for(const item of state.toasts)assert.ok(state.chip&&item.y+item.height<=state.chip.y,label+': the list opens above the chip');
  if(evidence)await shot(evidence);
  // Codex review: with the list open, focus can go back into the modal; Esc pressed there still closes only the list.
  await b.evaluate(`document.querySelector(${JSON.stringify(dialog)}).querySelector('button,[href],input,textarea,select,[tabindex]:not([tabindex="-1"])').focus()`);
  assert.equal(await b.evaluate(`document.querySelector(${JSON.stringify(dialog)}).contains(document.activeElement)`),true,label+': focus is back inside the modal');
  await key('Escape');
  await b.waitFor("document.querySelector('.workbench-toast-chip')?.getAttribute('aria-expanded')==='false'&&document.querySelector('.workbench-toast-viewport').hidden");
  assert.equal(await b.evaluate(`document.querySelector(${JSON.stringify(dialog)})?.checkVisibility()===true`),true,label+': Esc closed the list, not the modal');
  assert.equal(await b.evaluate("document.activeElement===document.querySelector('.workbench-toast-chip')"),true,label+': focus returns to the chip');
 };
 const scenario=async(name:string,dialog:string,evidence?:{wide:string;chip:string;chipOpen:string})=>{
  for(const width of WIDTHS){
   const state=await measure(name,dialog,width);
   if(evidence&&width===1440)await shot(evidence.wide);
   if(state.mode==='chip'){if(evidence&&width===900)await shot(evidence.chip);await chipKeyboard(name,dialog,width,evidence&&width===900?evidence.chipOpen:undefined);}
  }
  await size(1440);
 };

 return {size,shot,notices,scenario,persistent};
}

test('Card 34A page notices stay outside every open modal at four widths, collapsing to a keyboard chip when there is no room',{timeout:900000},()=>withT43Fixture(async f=>{
 const directory=process.env.CARD34_EVIDENCE_DIR??join(tmpdir(),'card34a-'+randomUUID());await mkdir(directory,{recursive:true});
 const screenshots:Shots=[],table:Table=[];
 const closingTicket=await start(f,await f.manualReport('卡34A 合成：打印机卡纸（合成）')),closingId=text(closingTicket.id);
 const settingsTicket=await start(f,await f.manualReport('卡34A 合成：网络时断时续（合成）')),settingsId=text(settingsTicket.id);
 const closedTicket=await start(f,await f.manualReport('卡34A 合成：键盘按键失灵（合成）')),closedId=text(closedTicket.id),admin=f.staff[0];assert.ok(admin);
 await post(admin,'/api/tickets/'+closedId+'/dismiss',{client_command_id:randomUUID(),expected_version:version((await get(admin,'/api/tickets/'+closedId)).version),reason_code:'OTHER',note:'卡34A 恢复弹窗（合成）'});await f.project();
 let browser:Browser|undefined,error:unknown;
 try{
  browser=await launch(f,'/workbench/app/');const b=browser;
  await b.command('Page.enable');await b.command('Page.addScriptToEvaluateOnNewDocument',{source:interceptor});
  const {size,notices,scenario}=modalHarness(b,directory,screenshots,table),restoreChecks=modalHarness(b,directory,screenshots,table,{sources:'follow'});
  const open=async(id:string,page=false)=>{await size(1440);await b.command('Page.navigate',{url:f.origin+'/workbench/app/items/ticket/'+id+(page?'?detail=page':'')});await b.waitFor("Boolean(document.querySelector('#detail-title'))&&document.querySelector('[data-action=toggle-item-follow]')?.disabled===false");await waitForAnimationsSettled(b);};
  // 关闭事项: from the drawer's ⋯ menu.
  await open(closingId);
  await clickWorkbenchControl(b,'.ds-drawer-more>summary');await clickWorkbenchControl(b,'.ds-drawer-more [data-action=cancel]');
  await b.waitFor("document.querySelector('.ds-closure-dialog')?.checkVisibility()===true");await notices();
  await scenario('closing','.detail-cancel-dialog',{wide:'toast-dialog-1440.png',chip:'toast-dialog-900-chip.png',chipOpen:'toast-dialog-900-chip-open.png'});
  // Closing the modal brings back the 32D-T docking inside the detail.
  await clickWorkbenchControl(b,'.ds-closure-dialog .ds-closure-actions button[type=button]');await b.waitFor("!document.querySelector('.ds-closure-dialog')");await waitForAnimationsSettled(b);
  assert.deepEqual(await b.evaluate("(()=>{const v=document.querySelector('.workbench-toast-viewport');return [v.dataset.toastMode,v.dataset.toastHosted,v.hidden,Boolean(document.querySelector('.workbench-toast-chip-anchor')),v.querySelectorAll('.workbench-toast[data-visible=true]').length];})()"),['docked','true',false,false,3],'after the modal closes the notices dock inside the detail again');

  // 设置: from the user menu, over the full-page detail.
  await open(settingsId,true);
  await clickWorkbenchControl(b,'[data-action=open-user-menu]');await b.waitFor("document.querySelector('[role=menu][aria-label=用户操作]')?.checkVisibility()===true");
  await clickWorkbenchControl(b,'[data-action=open-settings]');await b.waitFor("document.querySelector('.workbench-settings')?.checkVisibility()===true");await notices();
  await scenario('settings','.workbench-settings');
  await clickWorkbenchControl(b,'.workbench-settings button[aria-label=关闭设置]');await b.waitFor("!document.querySelector('.workbench-settings')");

  // 恢复确认: from the next-step card of a closed ticket. A closed ticket has no composer; besides the draft notices its page already
  // shows, the notice it can raise is a follow conflict, raised behind the open modal.
  await open(closedId);
  await b.waitFor("document.querySelector('.ds-next-step [data-action=restore-dismissed]')?.disabled===false");await clickWorkbenchControl(b,'.ds-next-step [data-action=restore-dismissed]');
  await b.waitFor("document.querySelector('.ds-restore-dialog')?.checkVisibility()===true&&Boolean(document.querySelector('[data-restore-confirmation]'))");
  await restoreChecks.notices();await restoreChecks.scenario('restore','.ds-restore-dialog');
 }catch(caught){error=caught;}
 finally{
  await writeFile(join(directory,'receipt-34a-toast-modal.json'),JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',platform:process.platform,table,screenshots},null,2));
  await close(browser,error);
 }
}));

/** The room right of the modal, as the placement measures it. */
function innerRoom(state:Layout,width:number):number{return width-(state.dialog.x+state.dialog.width);}

const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==','base64');
test('Card 34A page notices stay outside the media preview modal at four widths',{timeout:900000},()=>withDetailRestructureFixture(async f=>{
 const directory=process.env.CARD34_EVIDENCE_DIR??join(tmpdir(),'card34a-'+randomUUID());await mkdir(directory,{recursive:true});
 const screenshots:Shots=[],table:Table=[],first=f.tickets[0],cookie=f.browserCookies[0];assert.ok(first&&cookie?.url);
 const http=await t11Http(f);await http.start(first.ticket.id);
 // One synthetic image on the ticket's own web intake, through the real media reservation, upload and claim path.
 const row=(await f.pool.query<{scope_hash:string;corp:string;app:string;submission_id:string;request_ref:string;retention:string}>(`SELECT b.canonical_reporter_binding AS scope_hash,b.source_corp_scope AS corp,b.source_app_scope AS app,i.primary_web_submission_id::text AS submission_id,b.request_ref,b.retention_until_epoch_ms::text AS retention FROM intake.web_request_binding b JOIN intake.service_intake i ON i.id=b.intake_id WHERE b.intake_id=$1::uuid`,[first.intake.intakeId])).rows[0];assert.ok(row);
 const scope:YxxMemberScope={scopeHash:row.scope_hash as YxxMemberScope['scopeHash'],sourceCorpScope:row.corp,sourceAppScope:row.app,proofRef:'synthetic-card34a-media'};
 const store=createYxxH5MediaPrivateStore({root:f.privateRoot,key:f.key}),media=createYxxH5Media({pool:f.pool,store,enabled:true,compressionEnabled:false});
 try{const allow=async()=>{},reserved=await media.reserve({scope,input:{schema_version:1,client_command_id:randomUUID(),kind:'IMAGE',mime_type:'image/png',byte_size:PNG.length,duration_ms:null},verifyCurrentWrite:allow});
  await media.upload({scope,ref:reserved.media_ref,body:Readable.from([PNG]),verifyCurrentWrite:allow});
  await transactionP2016(f.pool,transaction=>media.claimInTransaction({transaction,scope,refs:[reserved.media_ref],intakeId:first.intake.intakeId,submissionId:row.submission_id,requestRef:row.request_ref,retentionUntilEpochMs:row.retention}));}
 finally{await media.close();}
 let browser:Browser|undefined,error:unknown;
 try{
  browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:1440,height:1000,cookies:[{...cookie,url:cookie.url}]});assert.ok(browser);const b=browser;
  await b.command('Page.enable');await b.command('Page.addScriptToEvaluateOnNewDocument',{source:interceptor});
  // This fixture has neither the follow feature nor the draft guard, so the media modal is checked with the one persistent notice
  // it can raise (the internal-note conflict); the placement does not depend on the count.
  const {size,notices,scenario}=modalHarness(b,directory,screenshots,table,{sources:'note'});
  await size(1440);await b.command('Page.navigate',{url:f.origin+'/workbench/app/items/ticket/'+first.ticket.id+'?detail=page'});
  await b.waitFor("Boolean(document.querySelector('#detail-title'))&&Boolean(document.querySelector('.ds-detail-footer textarea'))");
  await waitForAnimationsSettled(b);
  await clickWorkbenchControl(b,'#detail-tab-trigger-attachments');await b.waitFor("document.querySelector('.detail-media-card img')?.naturalWidth>0");await clickWorkbenchControl(b,'.detail-media-card');
  await b.waitFor("document.querySelector('.detail-media-dialog')?.checkVisibility()===true");await waitForAnimationsSettled(b);await notices();
  await scenario('media','.detail-media-dialog');
  // Codex review: a preview filling the largest modal in a short window leaves too little margin for the full chip; the chip
  // then goes compact into a margin that holds it, or the modals give up height so the compact chip fits below. It never covers
  // the modal.
  // The page's CSP blocks a <style> element; the element's own style (CSSOM) is allowed. The modal's max-height still caps it.
  await b.evaluate("(()=>{const dialog=document.querySelector('.detail-media-dialog');dialog.style.setProperty('width','720px','important');dialog.style.setProperty('height','2000px','important');})()");
  for(const [width,height,expected] of [[900,600,'margin'],[760,600,'reserve']] as const){
   await b.command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
   await b.waitFor("document.querySelector('.workbench-toast-viewport')?.dataset.toastMode==='chip'");await waitForAnimationsSettled(b);await waitForAnimationsSettled(b);
   const state=await b.evaluate(layout('.detail-media-dialog')) as Layout,label='tall media '+width+'x'+height;
   const extra=await b.evaluate("({compact:document.querySelector('.workbench-toast-chip-anchor')?.dataset.compact,reserve:document.documentElement.style.getPropertyValue('--workbench-toast-reserve')})") as {compact:string;reserve:string};
   assert.ok(state.chip,label+': the chip is shown');
   assert.ok(state.chip&&!intersects(state.chip,state.dialog),label+': the collapsed chip does not intersect the modal '+JSON.stringify({chip:state.chip,dialog:state.dialog,extra}));
   assert.ok(state.chip&&state.chip.x>=0&&state.chip.y>=0&&state.chip.x+state.chip.width<=width&&state.chip.y+state.chip.height<=height,label+': the chip stays in the window');
   // Once the modals give up height, the room below may hold the full chip again; only the margin case must be compact.
   if(expected==='margin')assert.equal(extra.compact,'true',label+': no margin holds the full chip, so it is compact '+JSON.stringify({chip:state.chip,dialog:state.dialog,extra}));
   assert.equal(Boolean(extra.reserve),expected==='reserve',label+': the modals give up height only when no margin holds even the compact chip');
   table.push({dialog:'media-tall',width,mode:state.mode,popover:null,controls:state.controls.length,toasts:state.toasts.length,chip:true});
  }
  await b.evaluate("(()=>{const dialog=document.querySelector('.detail-media-dialog');dialog.style.removeProperty('width');dialog.style.removeProperty('height');})()");await b.command('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await waitForAnimationsSettled(b);await waitForAnimationsSettled(b);
  assert.equal(await b.evaluate("document.documentElement.style.getPropertyValue('--workbench-toast-reserve')"),'','back at 1440 the modals no longer give up height');
  const restored=await b.evaluate(layout('.detail-media-dialog')) as Layout;
  assert.ok(restored.chip&&!intersects(restored.chip,restored.dialog),'back at 1440 the chip is clear of the modal');
 }catch(caught){error=caught;}
 finally{
  await writeFile(join(directory,'receipt-34a-toast-media.json'),JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',platform:process.platform,table,screenshots},null,2));
  await close(browser,error);
 }
}));
