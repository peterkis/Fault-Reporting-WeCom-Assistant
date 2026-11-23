import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {platform,release} from 'node:os';
import {join} from 'node:path';
import {waitForAnimationsSettled} from './browser-animations.mjs';
import {type Browser,type Scene,visible} from './card37a-optimistic-fixture.mjs';
import {boardReady,expandPendingBoard,query,ticketCard,ticketRow} from './motion-board-fixture.mjs';

export const help='[data-shortcuts-dialog=true]';
export const hint='[data-shortcut-hint=true]';
export const chip='[data-goto-chip=true]';
export const menu='[role=menu].board-action-options';
export const palette='.efficiency-panel';
export const current='[data-keyboard-current=true]';
export type Surface='board'|'list'|'drawer';
export const frame='new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))';

export async function key(b:Browser,value:string,modifiers=0){
  const special:Record<string,[string,number]>={Escape:['Escape',27],Enter:['Enter',13],'/':['Slash',191],'?':['Slash',191]};
  const [code,virtual]=special[value]??[/^\d$/u.test(value)?'Digit'+value:'Key'+value.toUpperCase(),value.toUpperCase().charCodeAt(0)];
  for(const type of ['keyDown','keyUp'])await b.command('Input.dispatchKeyEvent',{
    type,key:value,code,windowsVirtualKeyCode:virtual,modifiers:value==='?'?8:modifiers,
  });
}

export async function navigate(s:Scene,path:string,ready:string){
  const {b,f}=s,old=await b.evaluate('performance.timeOrigin');
  await b.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:2,y:2});
  await b.command('Page.navigate',{url:f.origin+'/workbench/app/'+path});
  await b.waitFor('performance.timeOrigin!== '+Number(old)+'&&('+ready+')');
  await b.evaluate('document.fonts.ready.then(()=>true)');
}
export async function board(s:Scene,view:'board'|'list'){
  await navigate(s,'?range=all&view='+view,boardReady);
  if(view==='board')await expandPendingBoard(s.b);
  await s.b.evaluate(`[...document.querySelectorAll('.ds-board-group-trigger[aria-expanded=false]')].filter(n=>n.checkVisibility()&&!n.disabled).forEach(n=>n.click())`);
  await waitForAnimationsSettled(s.b);
  await s.b.evaluate(`[...document.querySelectorAll('[data-action=expand-column][aria-expanded=false]')].filter(n=>n.checkVisibility()).forEach(n=>n.click())`);
  await waitForAnimationsSettled(s.b);
}

export async function select(b:Browser,id:string,view:'board'|'list'){
  const owner=view==='list'?ticketRow(id):ticketCard(id);
  await b.waitFor(visible(owner+' .card-open'));
  // Drive a real navigation key into this item. The neighbour is chosen from the
  // same rendered column (or the whole list) so the test works at either edge.
  const direction=await b.evaluate(`(()=>{
    const link=${query(owner+' .card-open')},group=link.closest('.board-column,.ds-work-table');
    const links=[...group.querySelectorAll('a.card-open[href]')].filter(a=>a.checkVisibility()&&!a.closest('[inert],[aria-hidden=true]')&&
      !a.closest('.ds-collapse-inner')?.parentElement?.matches('[aria-hidden=true]'));
    const i=links.indexOf(link);if(i<0)throw Error('target not navigable');
    const previous=links[i-1],next=links[i+1];
    (previous??next??link).focus({preventScroll:true});return previous?'j':next?'k':'j';
  })()`);
  assert.ok(direction==='j'||direction==='k');
  await key(b,direction);
  await b.waitFor(visible(owner+current)+'&&'+query(owner)+'.contains(document.activeElement)');
  return owner;
}
const seenDetailFollow=visible('.detail-dialog [data-action=toggle-item-follow]');
export async function target(s:Scene,view:Surface,id=s.id){
  const {b}=s;
  if(view==='drawer'){
    await navigate(s,'items/ticket/'+id+'?range=all',seenDetailFollow);
    await b.waitFor(query('.detail-dialog [aria-label=复制编号]')+'?.disabled===false');
    await waitForAnimationsSettled(b,'.detail-dialog');
    await b.evaluate(query('.detail-dialog [aria-label=复制编号]')+'.focus()');
    return '.detail-dialog';
  }
  await board(s,view);
  return select(b,id,view);
}

// Arm at capture-phase keydown and follow both reads and writes. The application
// fetches via fetch; include XHR as well so an alternative transport cannot pass.
export async function record(b:Browser){
  await b.evaluate(`(()=>{
    const log=window.b5log={calls:[],at:null};
    document.addEventListener('keydown',()=>{log.at=performance.now()},{capture:true,once:true});
    const original=window.fetch;
    window.fetch=function(input,init){
      if(log.at!==null)log.calls.push([init?.method??(input instanceof Request?input.method:'GET'),new URL(input.url??input,location.href).pathname]);
      return original.apply(this,arguments);
    };
    const open=XMLHttpRequest.prototype.open,send=XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open=function(method,url){this.b5call=[method,new URL(url,location.href).pathname];return open.apply(this,arguments)};
    XMLHttpRequest.prototype.send=function(){if(log.at!==null)log.calls.push(this.b5call);return send.apply(this,arguments)};
  })()`);
}

export async function caps(b:Browser,selector:string){
  await b.waitFor('Boolean('+query(selector)+')');
  return b.evaluate(`[...${query(selector)}.querySelectorAll('kbd')].map(k=>k.textContent)`);
}

export async function capture(b:Browser,name:string,selector:string){
  const node=query(selector);
  if(selector===chip||selector===hint){
    // 36A clears the entering marker before its scale/opacity transition finishes.
    await b.waitFor(node+'?.matches(":not([data-entering],[data-exiting])")===true');
  }
  // The PNG includes the whole viewport. Modal containers and backdrops animate
  // above the dialog node, and a tooltip can have an independently animating host.
  await waitForAnimationsSettled(b);
  const ready=visible(selector)+'&&!'+node+'.closest("[inert],[aria-hidden=true],[data-entering],[data-exiting]")';
  const opaque=selector===help||selector===palette||selector===chip||selector===hint;
  const painted=opaque?ready+'&&(()=>{for(let n='+node+';n;n=n.parentElement)if(getComputedStyle(n).opacity!=="1")return false;return true})()':ready;
  assert.equal(await b.evaluate(painted),true,name+' is fully painted before capture');
  const png=Buffer.from(await b.screenshot(),'base64');
  assert.equal(await b.evaluate(painted),true,name+' remained visible during capture');
  assert.equal(png.subarray(1,4).toString(),'PNG');
  const dir=join(process.env.TS_MIGRATION_TEST_SOURCE_ROOT??process.cwd(),'docs/ui/evidence/v230-card37');
  await mkdir(dir,{recursive:true});
  const version:unknown=await b.command('Browser.getVersion');
  assert.ok(version&&typeof version==='object'&&'product' in version&&typeof version.product==='string');
  const readme=join(dir,'README.md'),before=await readFile(readme,'utf8');
  const prefix='| `'+name+'.png` |';
  assert.equal(before.split('\n').filter(line=>line.startsWith(prefix)).length,1);
  await writeFile(join(dir,name+'.png'),png);
  const line=prefix+' '+platform()+' '+release()+' | '+version.product+' |';
  await writeFile(readme,before.split('\n').map(old=>old.startsWith(prefix)?line:old).join('\n'));
}

// Use the DOM clock for lifetime, independent of CDP polling or screenshot I/O.
// The end is removal (includes the 36A exit transition).
export async function timeCapsule(b:Browser,selector:string){
  await b.evaluate(`(()=>{
    window.b5life={first:null,last:null};
    const watch=new MutationObserver(()=>{
      const node=${query(selector)},life=b5life;
      if(node&&life.first===null)life.first=performance.now();
      if(!node&&life.first!==null){life.last=performance.now();watch.disconnect();}
    });
    watch.observe(document.body,{subtree:true,childList:true});
  })()`);
}
export async function assertLifetime(b:Browser,duration:number){
  await b.waitFor('b5life.last!==null',{timeoutMs:duration+1800});
  const elapsed=Number(await b.evaluate('b5life.last-b5life.first'));
  // Allow two slow paints on entrance and the 36A exit + throttled CI frames.
  assert.ok(elapsed>=duration-150&&elapsed<=duration+650,'capsule mounted '+elapsed+'ms for '+duration+'ms timer');
}
