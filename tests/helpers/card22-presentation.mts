import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {Browser} from './wbint-t27-browser-fixture.mjs';

interface Rect {top:number;bottom:number;height:number;width:number}
export interface FilterMeasurement {width:number;search:Rect|null;chips:{active:boolean;rect:Rect;textCenters:number[];clearHeight:number|null;clearCenter:number|null}[]}
export async function card22Filters(browser:Browser,searchSelector:string|null):Promise<FilterMeasurement>{
  await browser.evaluate('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
  return await browser.evaluate(`(()=>{const search=${JSON.stringify(searchSelector)}?document.querySelector(${JSON.stringify(searchSelector)}):null;return {width:innerWidth,search:search?.getBoundingClientRect().toJSON()??null,chips:[...document.querySelectorAll('.ds-toolbar .ds-filter-chip')].map(n=>{const r=n.getBoundingClientRect(),center=(r.top+r.bottom)/2,clear=n.querySelector('button[aria-label^="清除"]'),c=clear?.getBoundingClientRect();return {active:n.dataset.filterActive==='true',rect:r.toJSON(),textCenters:[...n.querySelectorAll('[data-slot=select-trigger] .ds-board-filter-label,[data-slot=select-trigger] [data-slot=select-value]')].filter(n=>n.checkVisibility()).map(n=>{const r=n.getBoundingClientRect();return (r.top+r.bottom)/2-center;}),clearHeight:c?.height??null,clearCenter:c?(c.top+c.bottom)/2-center:null};})};})()`) as FilterMeasurement;
}
export function assertCard22Filters(sample:FilterMeasurement){
  assert.ok(sample.chips.length>0);
  if(sample.search)assert.equal(sample.search.height,32);
  for(const chip of sample.chips){
    assert.equal(chip.rect.height,32);assert.ok(chip.textCenters.length>0);assert.ok(chip.textCenters.every(delta=>Math.abs(delta)<=0.5),JSON.stringify(chip));
    if(sample.search){assert.ok(Math.abs(chip.rect.top-sample.search.top)<=1);assert.ok(Math.abs(chip.rect.bottom-sample.search.bottom)<=1);}
    if(chip.clearHeight!==null){assert.equal(chip.clearHeight,24);assert.ok(Math.abs(chip.clearCenter??Infinity)<=0.5);}
  }
}
export async function assertCard22Avatars(browser:Browser){
  const texts=await browser.evaluate("[...document.querySelectorAll('[data-slot=avatar-fallback]')].map(n=>n.textContent)") as string[];
  assert.ok(texts.length>0);assert.ok(texts.every(text=>!/[()（）]/u.test(text)),JSON.stringify(texts));return texts;
}
export async function captureCard22(browser:Browser,directory:string,name:string,selector?:string){
  if(!selector){const png=await browser.screenshot();assert.ok(typeof png==='string');await writeFile(join(directory,name+'.png'),Buffer.from(png,'base64'));return;}
  const clip=await browser.evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect();return {x:Math.max(0,r.x-8),y:Math.max(0,r.y-8),width:r.width+16,height:r.height+16,scale:2};})()`) as {x:number;y:number;width:number;height:number;scale:number};
  const screenshot=await browser.command('Page.captureScreenshot',{format:'png',clip,captureBeyondViewport:true}) as {data:string};
  await writeFile(join(directory,name+'.png'),Buffer.from(screenshot.data,'base64'));
}
