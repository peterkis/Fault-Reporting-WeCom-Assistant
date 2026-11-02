import assert from 'node:assert/strict';
import type {launchSystemBrowser} from './p2-006-browser-harness.mjs';

type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;

/** Open the current presentation of a purpose, retaining its original form and guards. */
export async function openWorkbenchStep(browser:Pick<Browser,'evaluate'|'waitFor'>,selector:string){
  await browser.waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  await browser.waitFor(`(()=>{const workflow=document.querySelector(${JSON.stringify(selector)})?.closest('.ds-step-workflow[hidden]');return !workflow||[...document.querySelectorAll('[aria-controls]')].some(node=>node.getAttribute('aria-controls')===workflow.id);})()`);
  await browser.evaluate(`(()=>{const workflow=document.querySelector(${JSON.stringify(selector)})?.closest('.ds-step-workflow[hidden]');if(!workflow)return;const trigger=[...document.querySelectorAll('[aria-controls]')].find(node=>node.getAttribute('aria-controls')===workflow.id);if(!trigger)throw Error('STEP_ENTRY_REQUIRED');const more=trigger.closest('details.ds-drawer-more');if(more&&!more.open)more.querySelector('summary').click();trigger.click();})()`);
  await browser.waitFor(`document.querySelector(${JSON.stringify(selector)})?.checkVisibility()===true`);
}

export async function openWorkbenchUserMenu(browser:Browser){
  // A real account-menu interaction first activates its tab; background rAF is suspended.
  await browser.command('Page.bringToFront');
  if(await browser.evaluate('document.querySelector("[role=menu][aria-label=用户操作]")?.checkVisibility()===true'))return;
  await browser.waitFor('[...document.querySelectorAll("[data-action=open-user-menu]")].some(node=>node.checkVisibility())');
  const location=await browser.evaluate('[...document.querySelectorAll("[data-action=open-user-menu]")].find(node=>node.checkVisibility())?.dataset.menuLocation');
  assert.ok(location==='sidebar'||location==='compact');
  await clickWorkbenchControl(browser,'[data-action="open-user-menu"][data-menu-location="'+location+'"]');
  await browser.waitFor('document.querySelector("[role=menu][aria-label=用户操作]")?.checkVisibility()===true');
}
export async function openWorkbenchSettings(browser:Browser){
  await openWorkbenchUserMenu(browser);await clickWorkbenchControl(browser,'[data-action="open-settings"]');
  await browser.waitFor('document.querySelector(".workbench-settings")?.checkVisibility()===true');
}

/** Authentication/privacy boundary tests may revoke their current session while
 * a protected business modal is open. This preserves their original virtual
 * logout activation; pointer/keyboard menu reachability is tested separately.
 */
export async function openWorkbenchLogoutBoundary(browser:Pick<Browser,'evaluate'|'waitFor'>){
  await browser.waitFor('[...document.querySelectorAll("[data-action=open-user-menu]")].some(node=>node.checkVisibility())');
  await browser.evaluate('[...document.querySelectorAll("[data-action=open-user-menu]")].find(node=>node.checkVisibility()).click()');
  await browser.waitFor('Boolean(document.querySelector("[data-action=logout-workbench]"))');
}

/** Click the actual visible control, including HeroUI's checkbox/radio label. */
export async function clickWorkbenchControl(browser:Browser,selector:string){
  const tab=await browser.evaluate(`document.querySelector(${JSON.stringify(selector)})?.closest('[role=tabpanel][hidden]')?.getAttribute('aria-labelledby')??null`);
  if(typeof tab==='string')await clickWorkbenchControl(browser,'#'+tab);
  // v2 filters retain their controls in a native disclosure; use its real trigger first.
  if(await browser.evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)}),panel=node?.closest('details.ds-toolbar-filters');return Boolean(panel&&!panel.open&&!node?.matches('summary'));})()`))await clickWorkbenchControl(browser,'.ds-toolbar-filters>summary');
  const moreLabel=await browser.evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)}),panel=node?.closest('details.ds-drawer-more');return panel&&!panel.open&&!node?.matches('summary')?panel.querySelector('summary')?.getAttribute('aria-label'):null;})()`);
  if(typeof moreLabel==='string')await clickWorkbenchControl(browser,'details.ds-drawer-more>summary[aria-label='+JSON.stringify(moreLabel)+']');
  const workflow=await browser.evaluate(`document.querySelector(${JSON.stringify(selector)})?.closest('.ds-step-workflow[hidden]')?.id??null`);
  if(typeof workflow==='string')await clickWorkbenchControl(browser,'[aria-controls='+JSON.stringify(workflow)+']');
  const target=`(()=>{const root=document.querySelector(${JSON.stringify(selector)});return root?.matches('[data-slot=checkbox],[data-slot=radio]')?root.querySelector('label'):root?.matches('input[type=checkbox],input[type=radio]')?root.closest('label'):root;})()`;
  await browser.waitFor(`(()=>{const node=${target};return node?.checkVisibility()===true&&node.disabled!==true&&!node.closest('[data-disabled=true]');})()`);
  await browser.evaluate(`(()=>{const node=${target};node.scrollIntoView({block:'nearest',inline:'nearest'});})()`);
  await browser.waitFor(`(async()=>{const node=${target};if(!node?.checkVisibility()||node.disabled===true||node.closest('[data-disabled=true]'))return false;const before=node.getBoundingClientRect();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));if(!node.isConnected)return false;const after=node.getBoundingClientRect();if(['x','y','width','height'].some(key=>before[key]!==after[key]))return false;const hit=document.elementFromPoint(after.x+after.width/2,after.y+after.height/2);return hit!==null&&(hit===node||node.contains(hit));})()`);
  const point:unknown=await browser.evaluate(`(()=>{const node=${target},r=node.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  assert.ok(point&&typeof point==='object'&&'x' in point&&'y' in point&&typeof point.x==='number'&&typeof point.y==='number');
  await browser.command('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:point.x,y:point.y});
  await browser.command('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:point.x,y:point.y});
}

export async function chooseWorkbenchSelect(browser:Browser,selector:string,value:string){
  await clickWorkbenchControl(browser,selector+' [data-slot=select-trigger]');
  await clickWorkbenchControl(browser,'[role=option][data-key='+JSON.stringify(value)+']');
  await browser.waitFor(`document.querySelector(${JSON.stringify(selector+' select')})?.value===${JSON.stringify(value)}`);
}

export async function openWorkbenchDialog(browser:Pick<Browser,'evaluate'|'waitFor'>,selector:string,trigger:string){
  if(!await browser.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)){
    await browser.waitFor(`document.querySelector(${JSON.stringify(trigger)})?.disabled===false`);
    await browser.evaluate(`document.querySelector(${JSON.stringify(trigger)}).click()`);
  }
  await browser.waitFor(`document.querySelector(${JSON.stringify(selector)})?.checkVisibility()===true`);
}

export async function typeWorkbenchDates(browser:Browser,start:string,end:string){
  if(await browser.evaluate("Boolean(document.querySelector('.processed-date-picker')?.closest('details.ds-toolbar-filters:not([open])'))"))await clickWorkbenchControl(browser,'.ds-toolbar-filters>summary');
  for(const [index,date] of [start,end].entries()){
    const pieces=date.split('-');assert.equal(pieces.length,3);
    for(const [part,value] of [['year',pieces[0]],['month',pieces[1]],['day',pieces[2]]]){
      assert.ok(value);
      await browser.evaluate(`document.querySelectorAll('.processed-date-picker [data-slot=date-input-group-input]')[${index}].querySelector('[data-type=${part}]').focus()`);
      await browser.command('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',modifiers:2});
      await browser.command('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',modifiers:2});
      for(const character of String(Number(value))){await browser.command('Input.dispatchKeyEvent',{type:'keyDown',key:character,text:character});await browser.command('Input.dispatchKeyEvent',{type:'keyUp',key:character});}
    }
    await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const actual=await browser.evaluate(`(()=>{const input=document.querySelectorAll('.processed-date-picker [data-slot=date-input-group-input]')[${index}];return ['year','month','day'].map(part=>Number(input.querySelector('[data-type='+part+']').getAttribute('aria-valuenow')));})()`);
    assert.deepEqual(actual,pieces.map(Number),'keyboard entry must reach the requested calendar date');
  }
}

/** Page, drawer and modal each own at most one primary action; nested regions count separately. */
export async function assertWorkbenchPrimaryActions(browser:Browser){
  const regions:unknown=await browser.evaluate(`(()=>{const roots=[...document.querySelectorAll('.ds-page,.ds-detail,[role=dialog]')].filter(node=>node.checkVisibility());return roots.map(root=>({region:root.getAttribute('aria-label')??root.className,count:[...root.querySelectorAll('[data-tone=primary]')].filter(button=>button.checkVisibility()&&button.closest('.ds-page,.ds-detail,[role=dialog]')===root).length}));})()`);
  assert.ok(Array.isArray(regions));
  for(const region of regions){assert.ok(region&&typeof region==='object'&&'count' in region&&typeof region.count==='number');assert.ok(region.count<=1,'one primary action per visible region: '+JSON.stringify(region));}
}

/** Media cards retain their preview frame instead of ordinary button dimensions. */
export async function assertWorkbenchMediaPreviewGeometry(browser:Browser,width:number){
  const cards:unknown=await browser.evaluate(`(()=>{const close=(a,b)=>Math.abs(a-b)<=1;return [...document.querySelectorAll('.detail-media-card')].filter(n=>n.checkVisibility()).map(n=>{const r=n.getBoundingClientRect(),c=getComputedStyle(n),label=n.querySelector('.ds-button-label'),l=label?.getBoundingClientRect(),image=n.querySelector('img'),i=image?.getBoundingClientRect();return {height:r.height,unpadded:c.padding==='0px',labelFills:Boolean(l&&close(l.width,n.clientWidth)&&close(l.height,n.clientHeight)),imageFills:!image||Boolean(i&&l&&close(i.width,l.width)&&close(i.height,l.height)&&getComputedStyle(image).objectFit==='cover')};});})()`);
  assert.ok(Array.isArray(cards));assert.ok(cards.length>0,'media geometry must observe actual preview cards');
  for(const card of cards){assert.ok(card&&typeof card==='object'&&'height' in card&&'unpadded' in card&&'labelFills' in card&&'imageFills' in card);assert.equal(card.height,width<=640?145:170);assert.equal(card.unpadded,true);assert.equal(card.labelFills,true);assert.equal(card.imageFills,true);}
}

/** Observe an enabled primary action after its normal CSS transition, never a disabled placeholder. */
export async function assertWorkbenchPrimaryLabelContrast(browser:Browser,selector:string){
  await browser.waitFor(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});return n?.checkVisibility()&&!n.disabled&&n.getAttribute('aria-disabled')!=='true'&&n.dataset.disabled!=='true'&&n.dataset.tone==='primary'&&['rgb(37, 99, 201)','rgb(29, 79, 163)'].includes(getComputedStyle(n).backgroundColor);})()`);
  const colors:unknown=await browser.evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)}),label=n.querySelector('.ds-button-label'),foreground=getComputedStyle(n).color,text=getComputedStyle(label).color,background=getComputedStyle(n).backgroundColor,lum=color=>color.match(/[\\d.]+/g).slice(0,3).map(x=>{const v=Number(x)/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0),a=lum(text),b=lum(background);return {foreground,text,background,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};})()`);
  assert.ok(colors&&typeof colors==='object'&&'foreground' in colors&&'text' in colors&&'ratio' in colors&&typeof colors.ratio==='number');
  assert.equal(colors.foreground,'rgb(255, 255, 255)');assert.equal(colors.text,colors.foreground,'primary label inherits the button foreground');assert.ok(colors.ratio>=4.5,'enabled primary text contrast is at least 4.5:1');
}
