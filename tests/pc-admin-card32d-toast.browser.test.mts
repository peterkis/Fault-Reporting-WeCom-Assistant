import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {withT43Fixture,text} from './helpers/t43-full-service-fixture.mjs';
import {start,launch,close} from './helpers/t43-service-actions.mjs';
import type {Browser} from './helpers/t43-service-actions.mjs';
import {clickWorkbenchControl} from './helpers/heroui-workbench-controls.mjs';
import {waitForAnimationsSettled} from './helpers/browser-animations.mjs';

// A disabled HeroUI button takes no pointer events, so the hit falls through to its own ancestor; that still proves nothing covers it.
// Card 32D-T: notices dock bottom-right of the open detail container above its bottom input area, never over the detail
// toolbar, the composer, the next-step action or a dialog's own actions. Every toast here is real feedback from a real control;
// the page interceptor only turns a chosen request into a conflict (error) or a lost response (unknown).
const WIDTHS=[1920,1440,1280,900] as const;
const interceptor=`(()=>{const original=globalThis.fetch;globalThis.__toastMode={};globalThis.fetch=async function(input,options){
 const url=new URL(input instanceof Request?input.url:String(input),location.href),method=(options?.method??'GET').toUpperCase();
 const rule=method==='POST'?Object.entries(globalThis.__toastMode).find(([suffix])=>url.pathname.endsWith(suffix)):undefined;
 if(rule&&rule[1]==='conflict'){delete globalThis.__toastMode[rule[0]];return new Response(JSON.stringify({ok:false,error:{code:'P2_016_VERSION_CONFLICT',retryable:false}}),{status:409,headers:{'content-type':'application/json'}});}
 if(rule&&rule[1]==='lost'){delete globalThis.__toastMode[rule[0]];await original.call(this,input,options);throw new TypeError('Failed to fetch');}
 return original.call(this,input,options);};})()`;

type Rect={x:number;y:number;width:number;height:number};
interface Control {name:string;rect:Rect;hit:boolean}
const controls=(names:Readonly<Record<string,string>>)=>`(()=>{const out=[];for(const [name,selector] of Object.entries(${JSON.stringify(names)})){
 const node=[...document.querySelectorAll(selector)].find(element=>element.checkVisibility());if(!node){out.push({name,missing:true});continue;}
 const r=node.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
 out.push({name,rect:{x:r.x,y:r.y,width:r.width,height:r.height},hit:Boolean(hit&&(hit===node||node.contains(hit)||(getComputedStyle(node).pointerEvents==='none'&&hit.contains(node)&&!hit.closest('.workbench-toast')))),inert:getComputedStyle(node).pointerEvents==='none',at:hit?(hit.tagName+'.'+String(hit.className).slice(0,60)+'|'+(hit.closest('.workbench-toast')?'TOAST':'')):null});}
 return out;})()`;
// The notice kind is its toaster class: success, error, or is-warning for an unknown outcome.
const toastRects=`[...document.querySelectorAll('.workbench-toast[data-visible=true]')].map(node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,kind:node.classList.contains('success')?'success':node.classList.contains('error')?'error':node.classList.contains('is-warning')?'unknown':'other',text:node.innerText.replace(/\\s+/g,' ').slice(0,60)};})`;
const kindCount=(kind:'success'|'error'|'is-warning')=>`document.querySelectorAll('.workbench-toast[data-visible=true].${kind}').length`;
const intersects=(a:Rect,b:Rect)=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;

test('Card 32D-T toasts stay clear of detail controls in the drawer, the full page and the closing dialog at four widths',{timeout:600000},()=>withT43Fixture(async f=>{
 const directory=process.env.CARD32D_EVIDENCE_DIR??join(tmpdir(),'card32d-'+randomUUID());await mkdir(directory,{recursive:true});
 const screenshots:{file:string;width:number;height:number;sha256:string}[]=[],table:{scenario:string;width:number;control:string;hit:boolean;clear:boolean}[]=[];
 const active=await start(f,await f.manualReport('卡32D 合成：打印机无法打印（合成）')),id=text(active.id);
 // A separate ticket for the dialog, so no draft or pending check from the other scenarios applies to it.
 const dialogTicket=await start(f,await f.manualReport('卡32D 合成：扫码枪无响应（合成）')),dialogId=text(dialogTicket.id);
 const timingTicket=await start(f,await f.manualReport('卡32D 合成：显示器闪烁（合成）')),timingId=text(timingTicket.id);
 let browser:Browser|undefined,error:unknown;
 try{
  browser=await launch(f,'/workbench/app/');const b=browser;
  await b.command('Page.enable');if(!process.env.CARD32D_NO_INTERCEPT)await b.command('Page.addScriptToEvaluateOnNewDocument',{source:interceptor});
  const size=async(width:number,height=width===900?820:1000)=>{await b.command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});};
  const shot=async(name:string)=>{await waitForAnimationsSettled(b);const bytes=Buffer.from(await b.screenshot(),'base64');await writeFile(join(directory,name),bytes);screenshots.push({file:name,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')});};
  const open=async(path:string)=>{await size(1440);await b.command('Page.navigate',{url:f.origin+path});await b.waitFor("Boolean(document.querySelector('#detail-title'))&&document.querySelector('[data-action=toggle-item-follow]')?.disabled===false");await waitForAnimationsSettled(b);};
  // Success: a real follow toggle. Error and unknown: a note save answered with a conflict keeps the text and reports the conflict
  // (error), and the draft guard reports that the original operation must be checked (unknown); both stay until closed.
  // The follow toggle re-reads its state after each command and after a resize; press it only once it is enabled again.
  const success=async()=>{await b.waitFor("document.querySelector('[data-action=toggle-item-follow]')?.disabled===false&&!document.querySelector('[data-action=toggle-item-follow]').closest('[aria-busy=true]')");
   const before=await b.evaluate("document.querySelector('[data-action=toggle-item-follow]').getAttribute('aria-pressed')");
   await b.evaluate("document.querySelector('[data-action=toggle-item-follow]').click()");
   try{await b.waitFor(`document.querySelector('[data-action=toggle-item-follow]').getAttribute('aria-pressed')!==${JSON.stringify(before)}&&${kindCount('success')}>=1`);}
   catch(error){const state=await b.evaluate(`(()=>{const f=document.querySelector('[data-action=toggle-item-follow]');return {before:${JSON.stringify(before)},pressed:f?.getAttribute('aria-pressed'),disabled:f?.disabled,
    size:[innerWidth,innerHeight],toasts:[...document.querySelectorAll('.workbench-toast')].map(n=>n.className+'|'+n.dataset.visible+'|'+n.textContent.slice(0,40))};})()`);
    throw Error('CARD32D_SUCCESS_TOAST_TIMEOUT '+JSON.stringify(state),{cause:error});}};
  const note=async(mode:'conflict',text:string)=>{
   await b.evaluate(`globalThis.__toastMode['/internal-notes']=${JSON.stringify(mode)}`);
   const area='.ds-detail-footer textarea';await clickWorkbenchControl(b,area);await b.command('Input.insertText',{text});
   await b.waitFor("[...document.querySelectorAll('.ds-detail-footer button')].some(button=>button.textContent.includes('保存')&&!button.disabled)");
   await b.evaluate("[...document.querySelectorAll('.ds-detail-footer button')].find(button=>button.textContent.includes('保存')&&!button.disabled).click()");
  };
  const measure=async(scenario:string,width:number,names:Record<string,string>,height?:number)=>{
   // Resize and settle first; the 4s success notice is refreshed only then, so it is measured while visible.
   await size(width,height);await waitForAnimationsSettled(b);await success();await waitForAnimationsSettled(b,'.workbench-toast');
   const found=await b.evaluate(controls(names)) as (Control&{missing?:boolean})[],toasts=await b.evaluate(toastRects) as (Rect&{kind:string;text:string})[];
   // A stack taller than its limit scrolls inside the viewport; only the part inside the viewport can cover a control.
   const stack=await b.evaluate("(()=>{const r=document.querySelector('.workbench-toast-viewport').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()") as Rect;
   const visible=toasts.map(item=>{const x=Math.max(item.x,stack.x),y=Math.max(item.y,stack.y);return {...item,x,y,width:Math.max(0,Math.min(item.x+item.width,stack.x+stack.width)-x),height:Math.max(0,Math.min(item.y+item.height,stack.y+stack.height)-y)};});
   assert.deepEqual(toasts.map(t=>t.kind).sort(),['error','success','unknown'],scenario+' '+width+': one success, one error and one unknown notice '+JSON.stringify(toasts));
   for(const control of found){
    assert.ok(!control.missing,scenario+' '+width+': '+control.name+' is rendered');
    const clear=visible.every(t=>!intersects(t,control.rect));table.push({scenario,width,control:control.name,hit:control.hit,clear});
    assert.equal(control.hit,true,scenario+' '+width+': '+control.name+' is the hit target at its centre; found '+JSON.stringify((control as {at?:unknown}).at)+' rect '+JSON.stringify(control.rect)+' toasts '+JSON.stringify(toasts));assert.equal(clear,true,scenario+' '+width+': no notice overlaps '+control.name);
   }
  };
  const detailControls={'关闭详情':'button[aria-label=关闭详情]','复制编号':'[aria-label=复制编号],[aria-label=已复制编号]','关注':'[data-action=toggle-item-follow]','⋯':'.ds-drawer-more>summary',
   '保存内部备注':'.ds-detail-footer button','下一步主操作':'.ds-next-step-actions button'};

  // Drawer and full page: the error and unknown notices stay until closed; the success is refreshed per width (4s each).
  for(const [scenario,path,extra] of [['drawer','/workbench/app/items/ticket/'+id,{'上一项':'button[aria-label=上一项]','下一项':'button[aria-label=下一项]'}],['fullpage','/workbench/app/items/ticket/'+id+'?detail=page',{}]] as const){
   await open(path);
   await note('conflict','卡32D 合成冲突备注（合成）');await b.waitFor(`${kindCount('error')}===1&&${kindCount('is-warning')}===1`);
   for(const width of WIDTHS){await measure(scenario,width,{...detailControls,...extra});
    if(scenario==='drawer'&&(width===1440||width===900))await shot('toast-drawer-'+width+'.png');if(scenario==='fullpage'&&width===1280)await shot('toast-fullpage-1280.png');}
   // A short window cannot fit the three notices between the toolbar and the composer: the stack stops below the toolbar
   // (data-toast-avoid="top") and scrolls, so the navigation, copy, follow, more and close controls and the composer stay
   // reachable. The scrolling body between them has no free space at this height and is not part of this check.
   const {'下一步主操作':_body,...bars}=detailControls;await measure(scenario+'-short',1440,{...bars,...extra},560);
   // The overflowing stack stays scrollable: every notice, the oldest included, can be scrolled into view and closed.
   const reachable=await b.evaluate(`[...document.querySelectorAll('.workbench-toast[data-visible=true]')].map(node=>{const close=node.querySelector('.workbench-toast-close');close.scrollIntoView({block:'nearest'});
    const r=close.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return Boolean(hit&&(hit===close||close.contains(hit)));})`) as boolean[];
   const overflowing=await b.evaluate("(()=>{const v=document.querySelector('.workbench-toast-viewport');return v.scrollHeight>v.clientHeight;})()");
   assert.equal(overflowing,true,scenario+' short window: the three notices overflow their limit');
   assert.deepEqual(reachable,reachable.map(()=>true),scenario+' short window: every close button can be scrolled into view and hit');
  }
  // Closing dialog: the notices move into the dialog and dock above its own action bar. The follow button behind the modal is
  // the same real control, pressed programmatically because the modal keeps the pointer from reaching it.
  await open('/workbench/app/items/ticket/'+dialogId);
  await clickWorkbenchControl(b,'.ds-drawer-more>summary');await clickWorkbenchControl(b,'.ds-drawer-more [data-action=cancel]');
  await b.waitFor("document.querySelector('.ds-closure-dialog')?.checkVisibility()===true&&Boolean(document.querySelector('.ds-closure-dialog .workbench-toast-viewport'))");
  // The same note conflict as above, typed into the real composer behind the modal (the modal traps focus, so the value is set
  // through the native setter that React listens to) and saved with its real button.
  await b.evaluate("globalThis.__toastMode['/internal-notes']='conflict'");
  await b.evaluate(`(()=>{const area=document.querySelector('.ds-detail-footer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(area,${JSON.stringify('卡32D 合成弹窗冲突备注（合成）')});area.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await b.waitFor("[...document.querySelectorAll('.ds-detail-footer button')].some(button=>button.textContent.includes('保存')&&!button.disabled)");
  await b.evaluate("[...document.querySelectorAll('.ds-detail-footer button')].find(button=>button.textContent.includes('保存')&&!button.disabled).click()");
  await b.waitFor(`${kindCount('error')}===1&&${kindCount('is-warning')}===1&&document.querySelector('.ds-closure-dialog')?.checkVisibility()===true`);
  const dialogControls={'确认关闭':'.ds-closure-dialog .ds-closure-actions button[type=submit]','取消':'.ds-closure-dialog .ds-closure-actions button[type=button]'};
  for(const width of WIDTHS){await measure('dialog',width,dialogControls);if(width===1440)await shot('toast-dialog-1440.png');}

  // Hover and timing (T1): a hovered success notice waits; once the pointer leaves it closes after 4s. An error notice waits for
  // its close button, however long it stays on screen.
  // The draft guard may still show its own persistent notice from the operations above; the checks below select notices by kind.
  await open('/workbench/app/items/ticket/'+timingId);await b.waitFor(`${kindCount('success')}===0&&${kindCount('error')}===0`);
  const centre=async(selector:string)=>await b.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`) as {x:number;y:number};
  const move=async(point:{x:number;y:number})=>{await b.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:Math.round(point.x),y:Math.round(point.y)});};
  await success();const successToast='.workbench-toast.success[data-visible=true]';
  await move(await centre(successToast));await new Promise(resolve=>setTimeout(resolve,6000));
  assert.equal(await b.evaluate(`Boolean(document.querySelector(${JSON.stringify(successToast)}))`),true,'a hovered success notice does not close');
  await move({x:8,y:8});const left=Date.now();
  await new Promise(resolve=>setTimeout(resolve,3000));assert.equal(await b.evaluate(`Boolean(document.querySelector(${JSON.stringify(successToast)}))`),true,'it keeps its remaining time after the pointer leaves');
  await b.waitFor(`!document.querySelector(${JSON.stringify(successToast)})`,{timeoutMs:4000});const closedAfter=Date.now()-left;
  assert.ok(closedAfter>=3000&&closedAfter<=6500,'closes about 4s after the pointer leaves: '+closedAfter);
  await note('conflict','卡32D 合成计时冲突（合成）');await b.waitFor(`${kindCount('error')}===1`);
  await new Promise(resolve=>setTimeout(resolve,20000));
  assert.equal(await b.evaluate(`${kindCount('error')}`),1,'an error notice is still visible after 20s');
  await clickWorkbenchControl(b,'.workbench-toast.error[data-visible=true] button[aria-label=关闭提示]');
  await b.waitFor(`${kindCount('error')}===0`);
 }catch(caught){error=caught;}
 finally{
  await writeFile(join(directory,'receipt-32d-toast.json'),JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',platform:process.platform,table,screenshots},null,2));
  await close(browser,error);
 }
}));
