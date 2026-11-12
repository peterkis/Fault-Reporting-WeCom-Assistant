import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';
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
 if(rule&&rule[1]==='slow'){delete globalThis.__toastMode[rule[0]];await new Promise(resolve=>setTimeout(resolve,2500));return original.call(this,input,options);}
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
// Card 33: every visible notice is a full-height colour block with a centred icon, a centred title and description, and a centred
// close button (none while loading). The tone token each block must show is resolved in the page itself.
const TONE_TOKENS={success:'--tone-success-bg',info:'--tone-brand-bg',warning:'--tone-warning-bg',danger:'--tone-danger-bg',loading:'--tone-neutral-bg'} as const;
const TONE_ICONS={success:'CircleCheck',info:'Info',warning:'TriangleAlert',danger:'CircleX',loading:'LoaderCircle'} as const;
interface Anatomy {tone:keyof typeof TONE_TOKENS;icon:string;svg:string;bg:string;expectedBg:string;height:number;toneHeight:number;toneWidth:number;iconSize:number;iconDx:number;iconDy:number;closeDy:number|null;close:boolean;space:boolean;lines:number;single:boolean;source:string;text:string}
const anatomy=(scope='document')=>`(()=>{const probe=token=>{const e=document.createElement('i');e.style.background='var('+token+')';document.body.append(e);const c=getComputedStyle(e).backgroundColor;e.remove();return c;};
 const tokens=${JSON.stringify(TONE_TOKENS)};return [...${scope}.querySelectorAll('.workbench-toast[data-visible=true]')].map(node=>{const r=node.getBoundingClientRect(),block=node.querySelector(':scope>.workbench-toast-tone'),b=block.getBoundingClientRect(),
 svg=block.querySelector('svg'),i=svg.getBoundingClientRect(),close=node.querySelector(':scope>.workbench-toast-close'),c=close?.getBoundingClientRect(),content=node.querySelector('.workbench-toast-content'),description=content.querySelector(':scope>span');
 return {tone:node.dataset.tone,icon:block.querySelector('[data-icon]')?.dataset.icon??'',svg:String(svg.getAttribute('class')),bg:getComputedStyle(block).backgroundColor,expectedBg:probe(tokens[node.dataset.tone]),height:r.height,toneHeight:b.height,toneWidth:b.width,iconSize:parseFloat(getComputedStyle(svg).width),
  iconDx:Math.abs(i.left+i.width/2-(b.left+b.width/2)),iconDy:Math.abs(i.top+i.height/2-(b.top+b.height/2)),closeDy:c?Math.abs(c.top+c.height/2-(r.top+r.height/2)):null,close:Boolean(close),space:Boolean(node.querySelector(':scope>.workbench-toast-close-space')),
  lines:description?Math.round(description.getBoundingClientRect().height/20):0,single:content.classList.contains('is-single'),source:content.dataset.toastSource,text:node.innerText.replace(/\\s+/g,' ').slice(0,60)};});})()`;
const viewportStyle="[...document.querySelectorAll('.workbench-toast-viewport')].filter(v=>v.checkVisibility()).map(v=>{const s=getComputedStyle(v);return {overflowY:s.overflowY,padding:s.padding,background:s.backgroundColor,shadow:s.boxShadow,border:s.borderTopWidth,pointer:s.pointerEvents};})";
function assertAnatomy(items:Anatomy[],label:string,iconSize=20,toneWidth=52){
 for(const item of items){
  const where=label+' '+item.tone+' '+JSON.stringify(item.text);
  assert.ok(Math.abs(item.toneHeight-item.height)<=0.5,where+': the colour block is as tall as the notice '+item.toneHeight+'/'+item.height);
  assert.ok(item.height>=64-0.5,where+': at least 64 high');assert.ok(Math.abs(item.toneWidth-toneWidth)<=0.5,where+': block width '+item.toneWidth);
  assert.ok(Math.abs(item.iconSize-iconSize)<=0.5,where+': icon size '+item.iconSize);
  assert.ok(item.iconDx<=0.5&&item.iconDy<=0.5,where+': the icon is centred in its block '+item.iconDx+'/'+item.iconDy);
  assert.equal(item.bg,item.expectedBg,where+': block colour is its tone token');assert.equal(item.icon,TONE_ICONS[item.tone],where+': tone icon');
  if(item.tone==='loading'){assert.equal(item.close,false,where+': no close button while loading');assert.equal(item.space,true,where+': keeps the 42px space');}
  else{assert.equal(item.close,true,where+': has a close button');assert.ok(item.closeDy!==null&&item.closeDy<=0.5,where+': the close button is vertically centred '+item.closeDy);}
 }
}
function assertViewports(styles:Record<string,string>[],label:string){
 assert.ok(styles.length>=1,label+': a visible viewport');
 // The stack scrolls when it is taller than its limit; the scroll box keeps a transparent gutter covering the shadow's reach
 // (0 8px 24px: 16 above, 24 at the sides, 32 below), paints nothing itself and passes the pointer through.
 for(const style of styles)assert.deepEqual(style,{overflowY:'auto',padding:'16px 24px 32px',background:'rgba(0, 0, 0, 0)',shadow:'none',border:'0px',pointer:'none'},label+': the viewport scrolls inside a shadow gutter and never paints');
}
/** Minimal PNG reader (8-bit RGB/RGBA, not interlaced) for the shadow sampling; returns per-pixel luminance. */
function luminance(png:Buffer):{width:number;height:number;at:(x:number,y:number)=>number}{
 const width=png.readUInt32BE(16),height=png.readUInt32BE(20),depth=png[24],type=png[25],channels=type===6?4:3;assert.equal(depth,8);assert.ok(type===2||type===6);
 const chunks:Buffer[]=[];for(let offset=8;offset<png.length;){const length=png.readUInt32BE(offset),kind=png.toString('ascii',offset+4,offset+8);if(kind==='IDAT')chunks.push(png.subarray(offset+8,offset+8+length));offset+=12+length;}
 const raw=inflateSync(Buffer.concat(chunks)),stride=width*channels,out=Buffer.alloc(height*stride);
 for(let y=0;y<height;y++){const filter=raw[y*(stride+1)],line=raw.subarray(y*(stride+1)+1,(y+1)*(stride+1));
  for(let x=0;x<stride;x++){const a=x>=channels?out[y*stride+x-channels]??0:0,b=y?out[(y-1)*stride+x]??0:0,c=x>=channels&&y?out[(y-1)*stride+x-channels]??0:0,p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);
   out[y*stride+x]=((line[x]??0)+(filter===1?a:filter===2?b:filter===3?(a+b)>>1:filter===4?(pa<=pb&&pa<=pc?a:pb<=pc?b:c):0))&255;}}
 return {width,height,at:(x,y)=>{const i=y*stride+x*channels;return 0.2126*(out[i]??0)+0.7152*(out[i+1]??0)+0.0722*(out[i+2]??0);}};
}
/**
 * Card 33 shadow sampling. One clip 8px beyond the viewport on every side is captured with the notices shown and again with the
 * viewport hidden for that one capture; the difference is the shadow alone, with whatever lies behind cancelled out. In the bands
 * above, between, below, left and right of the notices the shadow must (a) reach past the notices (it is not clipped to their
 * boxes) and (b) fade smoothly: no step over 3 luminance levels between neighbouring pixels, as a clip edge would leave.
 */
async function assertUnclippedShadow(b:Browser,label:string,directory?:string){
 const box=await b.evaluate("(()=>{const v=[...document.querySelectorAll('.workbench-toast-viewport')].find(v=>v.checkVisibility()),r=v.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,toasts:[...v.querySelectorAll('.workbench-toast[data-visible=true]')].map(n=>{const t=n.getBoundingClientRect();return {x:t.x,y:t.y,width:t.width,height:t.height};})};})()") as Rect&{toasts:Rect[]};
 const clip={x:Math.max(0,Math.floor(box.x)-8),y:Math.max(0,Math.floor(box.y)-8),width:Math.ceil(box.width)+16,height:Math.ceil(box.height)+16,scale:1};
 const capture=async()=>Buffer.from((await b.command('Page.captureScreenshot',{format:'png',clip}) as {data:string}).data,'base64');
 const shown=await capture();
 await b.evaluate("[...document.querySelectorAll('.workbench-toast-viewport')].find(v=>v.checkVisibility()).style.visibility='hidden'");
 let hidden:Buffer;try{hidden=await capture();}finally{await b.evaluate("document.querySelectorAll('.workbench-toast-viewport').forEach(v=>{v.style.visibility='';})");}
 if(directory)await writeFile(join(directory,'shadow-sample-'+label.replace(/\W+/gu,'-')+'.png'),shown);
 // The shadow's opacity at each pixel, in 0–255 steps: on = off·(1−a) + 15·a for the shadow colour rgb(15,15,15). Pixels whose
 // background is darker than 60 (text, icons) say little about the opacity and are skipped.
 const on=luminance(shown),off=luminance(hidden),shade=(x:number,y:number):number|null=>{const base=off.at(x,y);return base<60?null:Math.max(0,(base-on.at(x,y))/(base-15)*255);};
 // The notice and its own 1px ring (with anti-aliasing) are excluded: 2px around each box.
 const inside=(x:number,y:number)=>box.toasts.some(item=>x>=Math.floor(item.x-clip.x)-2&&x<=Math.ceil(item.x+item.width-clip.x)+1&&y>=Math.floor(item.y-clip.y)-2&&y<=Math.ceil(item.y+item.height-clip.y)+1);
 // A clip edge is a straight line: the opacity steps by more than 3 along (nearly) the whole of one row or column. Text and
 // controls behind the notices cause only scattered steps, so each neighbouring row and column pair may step at no more than
 // half of the positions where both pixels are sampled.
 let outside=0,strongest=0;const lines:{line:string;share:number;valid:number}[]=[];
 for(let y=0;y<on.height;y++)for(let x=0;x<on.width;x++){const here=shade(x,y);if(!inside(x,y)&&here!==null){outside++;strongest=Math.max(strongest,here);}}
 const line=(name:string,length:number,pair:(k:number)=>[number,number,number,number])=>{let valid=0,hard=0;for(let k=0;k<length;k++){const [x0,y0,x1,y1]=pair(k);if(inside(x0,y0)||inside(x1,y1))continue;const a=shade(x0,y0),c=shade(x1,y1);if(a===null||c===null)continue;valid++;if(Math.abs(a-c)>3)hard++;}
  if(valid>=20)lines.push({line:name,share:hard/valid,valid});};
 for(let y=1;y<on.height;y++)line('row '+y,on.width,k=>[k,y-1,k,y]);
 for(let x=1;x<on.width;x++)line('column '+x,on.height,k=>[x-1,k,x,k]);
 const worst=lines.reduce((a,c)=>c.share>a.share?c:a,{line:'none',share:0,valid:0});
 assert.ok(outside>1000&&lines.length>=16,label+': sampled the bands around the notices '+outside+'/'+lines.length);
 assert.ok(strongest>=2,label+': the shadow reaches past the notices; strongest '+strongest);
 assert.ok(worst.share<=0.5,label+': no straight hard edge in the shadow; worst '+JSON.stringify(worst));
 return {clip,pixels:outside,lines:lines.length,strongest:Math.round(strongest*100)/100,worst:{line:worst.line,share:Math.round(worst.share*1000)/1000}};
}
const intersects=(a:Rect,b:Rect)=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;

test('Card 32D-T toasts stay clear of detail controls in the drawer, the full page and the closing dialog at four widths',{timeout:600000},()=>withT43Fixture(async f=>{
 const directory=process.env.CARD32D_EVIDENCE_DIR??join(tmpdir(),'card32d-'+randomUUID());await mkdir(directory,{recursive:true});
 const screenshots:{file:string;width:number;height:number;sha256:string}[]=[],table:{scenario:string;width:number;control:string;hit:boolean;clear:boolean}[]=[],shadows:Record<string,unknown>[]=[];
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
   assertAnatomy(await b.evaluate(anatomy()) as Anatomy[],scenario+' '+width,width<=640?18:20,width<=640?44:52);assertViewports(await b.evaluate(viewportStyle) as Record<string,string>[],scenario+' '+width);
   // A stack taller than its limit scrolls inside the viewport; only the part inside the viewport can cover a control.
   const stack=await b.evaluate("(()=>{const r=[...document.querySelectorAll('.workbench-toast-viewport')].find(v=>v.checkVisibility()).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()") as Rect;
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
   for(const width of WIDTHS){await measure(scenario,width,{...detailControls,...extra});if(width===1440)shadows.push({scenario,...await assertUnclippedShadow(b,scenario+' 1440',directory)});
    if(scenario==='drawer'&&(width===1440||width===900))await shot('toast-drawer-'+width+'.png');if(scenario==='fullpage'&&width===1280)await shot('toast-fullpage-1280.png');}
   // Short windows: at 1440×560 (32D-T) the three notices fit between the toolbar and the composer; at 1440×440 they do not, so
   // the stack stops below the toolbar (data-toast-avoid="top") and scrolls inside its shadow gutter (card 33), and the
   // navigation, copy, follow, more and close controls and the composer stay reachable. The scrolling body between them has no
   // free space at these heights and is not part of this check.
   const {'下一步主操作':_body,...bars}=detailControls;await measure(scenario+'-short',1440,{...bars,...extra},560);
   await measure(scenario+'-shorter',1440,{...bars,...extra},440);
   const overflowing=await b.evaluate("(()=>{const v=[...document.querySelectorAll('.workbench-toast-viewport')].find(v=>v.checkVisibility());return v.scrollHeight>v.clientHeight;})()");
   assert.equal(overflowing,true,scenario+' shorter window: the three notices overflow their limit');
   // The overflowing stack stays scrollable: every notice, the oldest included, can be scrolled into view and closed.
   const reachable=await b.evaluate(`[...document.querySelectorAll('.workbench-toast[data-visible=true]')].map(node=>{const close=node.querySelector('.workbench-toast-close');close.scrollIntoView({block:'nearest'});
    const r=close.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return Boolean(hit&&(hit===close||close.contains(hit)));})`) as boolean[];
   assert.deepEqual(reachable,reachable.map(()=>true),scenario+' shorter window: every close button can be scrolled into view and hit');
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
  for(const width of WIDTHS){await measure('dialog',width,dialogControls);if(width===1440)shadows.push({scenario:'dialog',...await assertUnclippedShadow(b,'dialog 1440',directory)});if(width===1440)await shot('toast-dialog-1440.png');}

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
  await writeFile(join(directory,'receipt-32d-toast.json'),JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',platform:process.platform,table,shadows,screenshots},null,2));
  await close(browser,error);
 }
}));

// Card 33: the five tones and the single-line notice, each produced by a real control against the real service. A notice that
// closes on its own leaves room for the next one, so the tones are checked as each appears; for the side-by-side evidence each
// rendered notice is copied as it is (its own DOM and the production stylesheet) into one static row of the page.
test('Card 33 toasts show five tones and a single-line notice with a full-height colour block and centred icon and close',{timeout:600000},()=>withT43Fixture(async f=>{
 const directory=process.env.CARD33_EVIDENCE_DIR??join(tmpdir(),'card33-'+randomUUID());await mkdir(directory,{recursive:true});
 const screenshots:{file:string;width:number;height:number;sha256:string}[]=[],seen:Anatomy[]=[],copies:string[]=[];
 const report=await start(f,await f.manualReport('卡33 合成：打印机卡纸（合成）')),id=text(report.id);
 let browser:Browser|undefined,error:unknown;
 try{
  browser=await launch(f,'/workbench/app/');const b=browser;
  await b.command('Page.enable');await b.command('Page.addScriptToEvaluateOnNewDocument',{source:interceptor});
  const size=async(width:number,height=1000)=>{await b.command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});};
  const shot=async(name:string)=>{await waitForAnimationsSettled(b);const bytes=Buffer.from(await b.screenshot(),'base64');await writeFile(join(directory,name),bytes);screenshots.push({file:name,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')});};
  const open=async(path:string)=>{await b.command('Page.navigate',{url:f.origin+path});await b.waitFor("Boolean(document.querySelector('#detail-title'))&&document.querySelector('[data-action=toggle-item-follow]')?.disabled===false");await waitForAnimationsSettled(b);};
  const tone=(name:string,extra='')=>`[...document.querySelectorAll('.workbench-toast[data-visible=true][data-tone=${name}]')].some(n=>n.checkVisibility()${extra})`;
  // Records one notice of the tone (checked live) and keeps a copy of its rendered DOM for the evidence row.
  const captured:string[]=[];
  const take=async(name:string,label:string,select=`.workbench-toast[data-visible=true][data-tone=${name}]`)=>{
   try{await b.waitFor(`${tone(name)}&&Boolean(document.querySelector(${JSON.stringify(select)}))`);}catch(cause){throw Error('CARD33_TONE_TIMEOUT '+label+' '+JSON.stringify(await b.evaluate("[...document.querySelectorAll('.workbench-toast')].map(n=>[n.dataset.tone,n.dataset.visible,n.className,n.innerText.replace(/\\s+/g,' ').slice(0,80)])")),{cause});}
   await waitForAnimationsSettled(b,'.workbench-toast');
   const items=(await b.evaluate(anatomy()) as Anatomy[]).filter(item=>item.tone===name);assert.ok(items.length>=1,label+': visible');assertAnatomy(items,label);seen.push(...items);
   copies.push(await b.evaluate(`document.querySelector(${JSON.stringify(select)}).outerHTML`) as string);captured.push(name);
   return items;
  };
  await size(1440);await open('/workbench/app/items/ticket/'+id);
  const follow=async()=>{await b.waitFor("document.querySelector('[data-action=toggle-item-follow]')?.disabled===false");await b.evaluate("document.querySelector('[data-action=toggle-item-follow]').click()");};
  // Loading: the follow request is held for 2.5s, so its in-progress notice shows (after its 200ms delay) without a close button.
  await b.evaluate("globalThis.__toastMode['/follow']='slow'");await follow();await take('loading','loading');
  // Success: the same follow request completes.
  await take('success','success');
  // Danger and warning: a note save answered with a conflict (danger, a two-line description at 400px), and the draft guard
  // reporting that the original operation must be checked (warning).
  await b.evaluate("globalThis.__toastMode['/internal-notes']='conflict'");
  const area='.ds-detail-footer textarea';await clickWorkbenchControl(b,area);await b.command('Input.insertText',{text:'卡33 合成冲突备注（合成）'});
  await b.waitFor("[...document.querySelectorAll('.ds-detail-footer button')].some(button=>button.textContent.includes('保存')&&!button.disabled)");
  await b.evaluate("[...document.querySelectorAll('.ds-detail-footer button')].find(button=>button.textContent.includes('保存')&&!button.disabled).click()");
  const danger=await take('danger','danger');await take('warning','warning');
  assert.ok(danger.some(item=>item.lines>=2),'the conflict description wraps to two lines and stays centred: '+JSON.stringify(danger.map(item=>item.lines)));
  await assertUnclippedShadow(b,'tones drawer 1440',directory);
  // Narrow (≤640): a 44px block with an 18px icon.
  await size(600,900);await waitForAnimationsSettled(b,'.workbench-toast');
  assertAnatomy(await b.evaluate(anatomy()) as Anatomy[],'narrow 600',18,44);await shot('toast-narrow-600.png');await size(1440);
  // Info: the note draft kept in this browser is restored after a reload.
  await open('/workbench/app/items/ticket/'+id);await take('info','info',".workbench-toast[data-visible=true][data-tone=info]:has([data-toast-source=draft])");
  // Single line: the only notice without a purpose label or title is the restore dialog's own outcome, which this fixture cannot
  // reach (draft recovery is unavailable here, so the dialog withholds the command). The heading rule is covered by
  // pc-admin-toast-policy; here the success notice's DOM gets the component's single-line form (the message as the only
  // `.workbench-toast-purpose`, `.is-single` on the content) and is laid out by the production stylesheet like the others.
  const base=copies[captured.indexOf('success')];assert.ok(base,'a success notice to copy');
  copies.push(await b.evaluate(`(()=>{const host=document.createElement('div');host.innerHTML=${JSON.stringify(base)};const content=host.querySelector('.workbench-toast-content'),title=content.querySelector('.workbench-toast-purpose');
   title.textContent='已复制编号 IT-20261109-0002（合成）';content.querySelector(':scope>span').remove();content.classList.add('is-single');content.dataset.toastSource='closure-restore';return host.innerHTML;})()`) as string);
  // Evidence row: the six rendered notices side by side, in the production stylesheet.
  const tones=['success','info','warning','danger','loading'];assert.deepEqual([...new Set(seen.map(item=>item.tone))].sort(),[...tones].sort(),'all five tones were seen');
  const single=copies.at(-1)??'',row=[...tones.map(name=>copies[captured.indexOf(name)]??''),single];
  await b.command('Page.navigate',{url:f.origin+'/workbench/app/'});await b.waitFor("Boolean(document.querySelector('.ds-board, .ds-work-table, main'))");await waitForAnimationsSettled(b);
  await b.evaluate(`(()=>{const row=document.createElement('div');row.setAttribute('data-card33-evidence','');row.style.cssText='position:fixed;inset:0;z-index:2147483647;display:grid;grid-template-columns:repeat(3,400px);gap:28px 32px;align-content:center;justify-content:center;background:var(--bg-subtle);pointer-events:none';
   row.innerHTML=${JSON.stringify(row.join(''))};row.querySelectorAll('*').forEach(n=>{n.removeAttribute('id');});row.querySelectorAll('.workbench-toast').forEach(n=>{n.style.animation='none';});document.body.append(row);})()`);
  assertAnatomy(await b.evaluate(anatomy("document.querySelector('[data-card33-evidence]')")) as Anatomy[],'evidence row');
  assert.equal(await b.evaluate("getComputedStyle(document.querySelector('[data-card33-evidence] .workbench-toast-content.is-single .workbench-toast-purpose')).fontWeight"),'400','the single line uses the regular weight');
  assert.equal(await b.evaluate("getComputedStyle(document.querySelector('[data-card33-evidence] .workbench-toast-content.is-single .workbench-toast-purpose')).color"),await b.evaluate("(()=>{const e=document.createElement('i');e.style.color='var(--text-primary)';document.body.append(e);const c=getComputedStyle(e).color;e.remove();return c;})()"),'in the primary text colour');
  await shot('toast-tones-1440.png');
 }catch(caught){error=caught;}
 finally{
  await writeFile(join(directory,'receipt-33-toast.json'),JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',platform:process.platform,tones:seen,screenshots},null,2));
  await close(browser,error);
 }
}));
