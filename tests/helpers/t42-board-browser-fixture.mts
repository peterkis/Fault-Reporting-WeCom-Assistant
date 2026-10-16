import assert from 'node:assert/strict';
import {mkdir,writeFile,rmdir} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {withWeb01Fixture} from './web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './p2-006-browser-harness.mjs';
import type {P2016EnabledRuntime} from '../../src/p2-016-runtime.mjs';
import type {PostgresPool} from '../../src/platform/postgres-pool.mjs';
type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
export interface T42Fixture {pool:PostgresPool;origin:string;cookies:string[];browserCookies:{name:string;value:string;url:string}[];tickets:{ticket:{id:string}}[];principals:{id:string}[];runtime:P2016EnabledRuntime;restoreSelfHandlingResponses:()=>void}
export function object(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
export async function withT42BoardBrowser(run:(f:T42Fixture,browser:Browser,card:string,get:(path:string)=>Promise<Record<string,unknown>>)=>Promise<void>,options:{width?:number;reduceMotion?:boolean;longTitle?:boolean;dropSelfHandlingResponses?:boolean;realtime?:boolean;principalIndex?:number;assignment?:boolean}={}){
  const fixtureOptions={ticketSelfHandlingEnabled:true,ticketSelfHandlingWebSource:true,workbenchBoardActionsEnabled:true,workbenchInternalNotesEnabled:true,workbenchRealtimeEnabled:options.realtime===true,dropSelfHandlingResponses:options.dropSelfHandlingResponses===true,ticketAssignmentEnabled:options.assignment===true};
  await withWeb01Fixture(async(f:T42Fixture)=>{
    const index=options.principalIndex??0,first=f.tickets[0],cookie=f.cookies[index],browserCookie=f.browserCookies[index];assert.ok(first&&cookie&&browserCookie);
    // Synthetic fixture-only material; no application transition, migration or new SQL file.
    if(options.longTitle)await f.pool.query('UPDATE pilot_ticket.ticket SET title=$2 WHERE id=$1::uuid',[first.ticket.id,'窄屏长内容：'+'当前获权的合成故障材料和位置说明。'.repeat(9)]);
    const initial=await f.runtime.coordinator.backlog(),bound=Math.ceil(initial.total/f.runtime.coordinator.batchSize)+3;let settled=false;
    for(let step=0;step<bound;step++){const inbound=await f.runtime.coordinator.runOnce(),projected=await f.runtime.realtimeProjector.runOnce({limit:100}),left=await f.runtime.coordinator.backlog();assert.ok(inbound.streams.every(stream=>!stream.failures.length));if(!inbound.processed&&!projected.processed&&!left.total){settled=true;break;}}assert.equal(settled,true);
    const get=async(path:string)=>{const r=await fetch(f.origin+path,{headers:{cookie}});assert.equal(r.status,200,await r.clone().text());return object(await r.json());};
    const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);const screenshots:{file:string;width:number;height:number;sha256:string}[]=[];let browser:Browser|undefined,error:unknown;
    const capture=async()=>{assert.ok(browser);const bytes=Buffer.from(await browser.screenshot(),'base64'),width=bytes.readUInt32BE(16),file=join(directory,width===600?'new-detail-600.png':'new-detail-1920.png');await writeFile(file,bytes);screenshots.push({file,width,height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')});};
    try{
      browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:options.width??1920,height:1080,cookies:[{...browserCookie,url:f.origin+'/'}]});assert.ok(browser);
      if(options.reduceMotion)await browser.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
      const card='[data-kind="ticket"][data-item-id="'+first.ticket.id+'"]';await browser.waitFor("Boolean(document.querySelector('.board-column.pending .column-cards'))");
      await browser.evaluate(`(()=>{if(!document.querySelector('.board-column.pending '+${JSON.stringify(card)}))document.querySelector('.board-column.pending [data-action=expand-column]')?.click();})()`);await browser.waitFor(`Boolean(document.querySelector(${JSON.stringify(card)}))`);
      assert.equal(await browser.evaluate("Array.from(document.querySelectorAll('script[type=module][src]')).some(script=>new URL(script.src).pathname.startsWith('/workbench/app/assets/'))"),true);
      await browser.evaluate(`(()=>{const original=globalThis.fetch;globalThis.__t42Writes=[];globalThis.__t42Responses=[];globalThis.fetch=async(path,options)=>{if(options?.method==='POST')globalThis.__t42Writes.push({path:String(path),body:JSON.parse(options.body)});const response=await original(path,options);if(options?.method==='POST')globalThis.__t42Responses.push({path:String(path),status:response.status});return response;};})()`);
      await run(f,browser,card,get);await capture();
    }catch(failure){error=failure;if(browser)await capture().catch(captureError=>{error=new AggregateError([failure,captureError],'T42_BOUNDARY_AND_CAPTURE_FAILED');});}
    console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',board_boundaries:true,screenshots}));
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{if(!screenshots.length)await rmdir(directory);}],error);
  },fixtureOptions);
}
