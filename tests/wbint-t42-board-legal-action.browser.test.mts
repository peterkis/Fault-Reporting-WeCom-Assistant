import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import type {P2016EnabledRuntime} from '../src/p2-016-runtime.mjs';
import type {P2016SelfHandlingCommand} from '../contracts/p2_016_contracts.js';

type Browser=Awaited<ReturnType<typeof launchSystemBrowser>>;
interface Fixture {
  origin:string;cookies:string[];browserCookies:{name:string;value:string;url:string}[];
  principals:{id:string}[];tickets:{ticket:{id:string}}[];runtime:P2016EnabledRuntime;
}
function object(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function text(value:unknown):string{assert.equal(typeof value,'string');return value as string;}
function integer(value:unknown):number{assert.ok(typeof value==='number'&&Number.isSafeInteger(value)&&value>0);return value;}
async function projectFixtureMaterial(runtime:P2016EnabledRuntime){
  const initial=await runtime.coordinator.backlog(),bound=Math.ceil(initial.total/runtime.coordinator.batchSize)+3;
  for(let step=0;step<bound;step++){
    const inbound=await runtime.coordinator.runOnce(),material=await runtime.realtimeProjector.runOnce({limit:100});
    assert.ok(inbound.streams.every(stream=>stream.failures.length===0));
    const remaining=await runtime.coordinator.backlog();
    if(inbound.processed===0&&material.processed===0&&remaining.total===0)return;
  }
  assert.fail('the finite synthetic source material did not finish projection');
}
const instrument=`(()=>{
  const original=globalThis.fetch;globalThis.__t42Writes=[];globalThis.__t42Responses=[];
  globalThis.fetch=async(path,options)=>{
    const method=String(options?.method??'GET').toUpperCase(),url=String(path);
    if(method==='POST'){const headers=new Headers(options?.headers);globalThis.__t42Writes.push({path:url,body:JSON.parse(options.body),ifMatch:headers.get('if-match'),idempotency:headers.get('idempotency-key')});}
    const response=await original(path,options);
    if(method==='POST')globalThis.__t42Responses.push({path:url,status:response.status});
    return response;
  };
})()`;
// SOURCE baseline: the proposed true option is intentionally not mounted/passed through yet.
// A future WHOLE must run these exact bytes on the recorded unimplemented baseline first.
const options={ticketSelfHandlingEnabled:true,ticketSelfHandlingWebSource:true,workbenchBoardActionsEnabled:true};

test('T42 production board drag opens the legal handling form and moves only after one explicit command and current official query',{timeout:240000},async()=>{
  await withWeb01Fixture(async(fixture:Fixture)=>{
    await projectFixtureMaterial(fixture.runtime);
    const actor=fixture.principals[0],known=fixture.tickets[0],browserCookie=fixture.browserCookies[0],cookie=fixture.cookies[0];
    assert.ok(actor&&known&&browserCookie&&cookie);
    const get=async(path:string)=>{const response=await fetch(fixture.origin+path,{headers:{cookie}});assert.equal(response.status,200,await response.clone().text());return object(await response.json());};
    const path='/api/tickets/'+known.ticket.id,initial=await get(path);
    assert.equal(initial.status,'QUEUED');assert.ok(Array.isArray(initial.allowed_actions)&&initial.allowed_actions.includes('take-and-start'));
    const originalVersion=integer(initial.version),team=text(initial.resolver_team_id);
    const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);
    const screenshots:{file:string;width:number;height:number;sha256:string}[]=[];
    let browser:Browser|undefined,error:unknown;
    const capture=async()=>{assert.ok(browser);await browser.command('Emulation.setDeviceMetricsOverride',{width:900,height:1080,deviceScaleFactor:1,mobile:false});const bytes=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,'new-detail-900.png');await writeFile(file,bytes);screenshots.push({file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')});};
    try{
      browser=await launchSystemBrowser({url:fixture.origin+'/workbench/app/',width:1920,height:1080,cookies:[{...browserCookie,url:fixture.origin+'/'}]});assert.ok(browser);
      const card=`[data-kind="ticket"][data-item-id="${known.ticket.id}"]`;
      await browser.waitFor("Boolean(document.querySelector('.board-column.pending .column-cards'))");
      await browser.evaluate(`(()=>{if(!document.querySelector('.board-column.pending '+${JSON.stringify(card)}))document.querySelector('.board-column.pending [data-action="expand-column"]')?.click();})()`);
      await browser.waitFor(`Boolean(document.querySelector('.board-column.pending '+${JSON.stringify(card)}))`);
      assert.equal(await browser.evaluate("Array.from(document.querySelectorAll('script[type=module][src]')).some(script=>new URL(script.src).pathname.startsWith('/workbench/app/assets/'))"),true,'use the formal production bundle');
      await browser.evaluate(instrument);
      assert.equal(await browser.evaluate(`Boolean(document.querySelector(${JSON.stringify(card+' [data-action="board-drag-handle"]')}))`),true,'the production board must expose an explicit drag handle, separate from text and the detail link');
      const geometry=object(await browser.evaluate(`(()=>{
        const source=document.querySelector(${JSON.stringify(card+' [data-action="board-drag-handle"]')}).getBoundingClientRect(),target=document.querySelector('.board-column.active').getBoundingClientRect();
        return {x:source.x+source.width/2,y:source.y+source.height/2,toX:target.x+target.width/2,toY:target.y+Math.min(100,target.height/2)};
      })()`));
      for(const key of ['x','y','toX','toY'])assert.equal(typeof geometry[key],'number');
      await browser.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:geometry.x,y:geometry.y});
      await browser.command('Input.dispatchMouseEvent',{type:'mousePressed',x:geometry.x,y:geometry.y,button:'left',clickCount:1});
      await browser.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:geometry.toX,y:geometry.toY,button:'left',buttons:1});
      await browser.command('Input.dispatchMouseEvent',{type:'mouseReleased',x:geometry.toX,y:geometry.toY,button:'left',clickCount:1});
      await browser.waitFor(`Boolean(document.querySelector('.detail-dialog[open] [data-action="take-and-start"]:not(:disabled)'))`);
      assert.deepEqual(await browser.evaluate('globalThis.__t42Writes'),[],'dropping only opens the current legal form; it must not submit or guess responsibility');
      assert.equal(await browser.evaluate(`Boolean(document.querySelector('.board-column.pending '+${JSON.stringify(card)}))`),true,'opening the form must preserve the official position');
      await browser.evaluate("document.querySelector('.detail-dialog[open] [data-action=take-and-start]').click()");
      await browser.waitFor(`globalThis.__t42Responses.some(value=>new URL(value.path,location.origin).pathname===${JSON.stringify(path+'/take-and-start')}&&value.status===200)`);
      await browser.waitFor(`Boolean(document.querySelector('.board-column.active '+${JSON.stringify(card)}))&&!document.querySelector('.board-column.pending '+${JSON.stringify(card)})`);
      const writes=await browser.evaluate('globalThis.__t42Writes');assert.ok(Array.isArray(writes));assert.equal(writes.length,1);const sent=object(writes[0]),body=object(sent.body),commandId=text(body.client_command_id);
      assert.match(commandId,/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu);
      const expected:P2016SelfHandlingCommand={client_command_id:commandId,expected_version:originalVersion,reason_code:'WORKBENCH_SELF_HANDLING',resolver_team_id:team};
      assert.equal(new URL(text(sent.path),fixture.origin).pathname,path+'/take-and-start');assert.deepEqual(body,expected);assert.equal(sent.ifMatch,'"'+originalVersion+'"');assert.equal(sent.idempotency,commandId);
      const current=await get(path);assert.equal(current.status,'IN_PROGRESS');assert.equal(current.assignee_id,actor.id);assert.equal(current.resolver_team_id,team);assert.ok(integer(current.version)>originalVersion);
      const pending=await get('/api/workbench/board?column=pending'),active=await get('/api/workbench/board?column=active');
      assert.ok(Array.isArray(pending.items)&&!pending.items.some(value=>object(value).id===known.ticket.id));assert.ok(Array.isArray(active.items)&&active.items.filter(value=>object(value).id===known.ticket.id).length===1);
      await capture();
    }catch(failure){error=failure;if(browser)await capture().catch(captureError=>{error=new AggregateError([failure,captureError],'T42_BROWSER_AND_CAPTURE_FAILED');});}
    console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',board_legal_action:true,screenshots}));
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{if(!screenshots.length)await rmdir(directory);}],error);
  },options);
});
