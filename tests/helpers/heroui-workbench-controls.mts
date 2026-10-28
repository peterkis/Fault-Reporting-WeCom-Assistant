import assert from 'node:assert/strict';
import type {launchSystemBrowser} from './p2-006-browser-harness.mjs';

type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;

/** Click the actual visible control, including HeroUI's checkbox/radio label. */
export async function clickWorkbenchControl(browser:Browser,selector:string){
  const target=`(()=>{const root=document.querySelector(${JSON.stringify(selector)});return root?.matches('[data-slot=checkbox],[data-slot=radio]')?root.querySelector('label'):root?.matches('input[type=checkbox],input[type=radio]')?root.closest('label'):root;})()`;
  await browser.waitFor(`(()=>{const node=${target};return node?.checkVisibility()===true&&node.disabled!==true&&!node.closest('[data-disabled=true]');})()`);
  await browser.evaluate(`(()=>{const node=${target};node.scrollIntoView({block:'nearest',inline:'nearest'});})()`);
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
