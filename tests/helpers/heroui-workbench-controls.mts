import assert from 'node:assert/strict';
import type {launchSystemBrowser} from './p2-006-browser-harness.mjs';

type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;

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
