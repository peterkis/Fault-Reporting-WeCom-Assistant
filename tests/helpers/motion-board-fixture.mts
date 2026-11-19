import assert from 'node:assert/strict';
import {createPilotTicketCore} from '../../app/server/src/p1-005-pilot-ticket-core.mjs';
import {assertLocalDateTime} from '../../app/server/src/platform/time-contract.mjs';
import type {PostgresPool} from '../../app/server/src/platform/postgres-pool.mjs';
import {seedWeb01NoConversationIntake} from './web01-workbench-fixture.mjs';
import {waitForAnimationsSettled} from './browser-animations.mjs';
import type {MotionBrowser} from './motion-assert.mjs';

interface BoardBrowser extends MotionBrowser {waitFor(expression:string):Promise<unknown>}
export const refreshBoard="document.querySelector('.ds-page-header button[aria-label=刷新]').click()";
export const boardReady="document.querySelectorAll('.ds-stage-count,.ds-list-stage-count').length===3&&[...document.querySelectorAll('.ds-stage-count,.ds-list-stage-count')].every(node=>/^\\d+$/.test(node.textContent.trim()))";
export const ticketCard=(id:string)=>`.ticket-card[data-kind=ticket][data-item-id="${id}"]`;
export const ticketRow=(id:string)=>`.ds-work-row[data-kind=ticket][data-item-id="${id}"]`;
export const query=(selector:string)=>`document.querySelector(${JSON.stringify(selector)})`;

export async function seedMotionTicket(pool:PostgresPool,label:string){
  const intake=await seedWeb01NoConversationIntake({pool,text:`${label}（合成）`,location:'卡三十六测试门诊（合成）'});
  const {ticket}=await createPilotTicketCore({pool}).createForIntake({intakeId:intake.intakeId,occurredAt:assertLocalDateTime(intake.receivedAt),traceId:'card36b-synthetic'});
  assert.ok(ticket);
  return ticket.id;
}

export async function expandPendingBoard(browser:BoardBrowser){
  await browser.waitFor(boardReady);
  await browser.evaluate("document.querySelector('.board-column.pending [data-action=expand-column][aria-expanded=false]')?.click()");
  await waitForAnimationsSettled(browser);
}

export async function scrollPastMotionItem(browser:BoardBrowser,selector:string){
  await waitForAnimationsSettled(browser);
  await browser.waitFor(`Boolean(${query(selector)}?.checkVisibility())`);
  await browser.evaluate(`window.scrollTo({top:scrollY+${query(selector)}.getBoundingClientRect().bottom+innerHeight/3,behavior:'instant'})`);
  await browser.waitFor(`${query(selector)}.getBoundingClientRect().bottom<0`);
}

export async function captureMotionReadingPosition(browser:BoardBrowser,selector:string,listViewport?:string){
  const items=`[...document.querySelectorAll(${JSON.stringify(selector)})].filter(node=>node.checkVisibility())`;
  const prior=await browser.evaluate(`(()=>{
    window.motionScrollCalls=[];
    for(const target of [window,Element.prototype]){
      for(const method of ['scroll','scrollTo','scrollBy','scrollIntoView']){
        const original=target[method];
        if(typeof original!=='function')continue;
        target[method]=function(...args){
          window.motionScrollCalls.push({method,id:this.dataset?.itemId,behavior:args[0]?.behavior});
          return original.apply(this,args);
        };
      }
    }
    const viewport=${listViewport?`${query(listViewport)}.getBoundingClientRect()`:'null'};
    const header=${listViewport?`${query(listViewport+' thead')}.getBoundingClientRect()`:'null'};
    const top=Math.max(0,viewport?.top??0,header?.bottom??0),bottom=Math.min(innerHeight,viewport?.bottom??innerHeight);
    return ${items}.flatMap(node=>{
      const rect=node.getBoundingClientRect();
      return rect.bottom>top&&rect.top<bottom?[{id:node.dataset.itemId,top:rect.top}]:[];
    });
  })()`);
  assert.ok(Array.isArray(prior)&&prior.length>0,'reading position must include visible items before arrival');
  const scrollCalls=():Promise<unknown>=>browser.evaluate('window.motionScrollCalls');
  return {scrollCalls,async assertUnchanged(){
    const positions=await browser.evaluate(`Object.fromEntries(${items}.map(node=>[node.dataset.itemId,node.getBoundingClientRect().top]))`);
    assert.ok(positions&&typeof positions==='object');
    for(const {id,top} of prior){
      const actual=Reflect.get(positions,id);
      assert.ok(typeof actual==='number'&&Math.abs(actual-top)<=1,`${id}: reading position changed from ${top}px to ${actual}px`);
    }
    assert.deepEqual(await scrollCalls(),[],'arrival must not programmatically scroll before chip activation');
  }};
}
