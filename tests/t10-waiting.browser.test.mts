import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import type {P2016RequestInformationResult,P2016TicketEventPage,P2016WaitingActionCommand} from '../contracts/p2_016_contracts.js';
import {withT10Fixture} from './helpers/t10-waiting-fixture.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';
import type {T11Fixture} from './helpers/t11-completion-fixture.mjs';
import {closeBrowserTestResources,launchSystemBrowser} from './helpers/p2-006-browser-harness.mjs';

type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
type Post={path:string;body:P2016WaitingActionCommand;ifMatch:string|null;idempotencyKey:string|null;status:number|null;result:unknown};
const form='form[aria-label="等待报修人"]';
const input=form+' textarea[aria-label="等待原因"]';
const submit=form+' button[type="submit"]';
const reason='INTERNAL_T10_FORM_CANARY：请报修人补充故障发生时间与现象。';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

async function waitingBrowser(context:T11Fixture,run:(browser:Browser,capture:(name:string)=>Promise<void>)=>Promise<void>){
  const target=context.tickets[0],cookie=context.browserCookies[2];assert.ok(target);assert.ok(cookie);
  const cookieUrl=cookie.url;assert.ok(cookieUrl);
  const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);
  const screenshots:{file:string;width:number;height:number;sha256:string}[]=[];
  let browser:Browser|undefined,error:unknown;
  try{
    browser=await launchSystemBrowser({url:context.origin+'/workbench/app/items/ticket/'+target.ticket.id,width:1920,height:1080,cookies:[{...cookie,url:cookieUrl}]});assert.ok(browser);
    await browser.command('Page.enable');await browser.waitFor("Boolean(document.querySelector('#detail-title'))");
    const active=browser,capture=async(name:string)=>{
      const pixels=Buffer.from(await active.screenshot(),'base64'),file=join(directory,name);await writeFile(file,pixels);
      screenshots.push({file,width:pixels.readUInt32BE(16),height:pixels.readUInt32BE(20),sha256:createHash('sha256').update(pixels).digest('hex')});
    };
    await run(browser,capture);
  }catch(failure){
    error=failure;
    if(browser)try{
      await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));
      await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText,commands:globalThis.__t10Commands,reads:globalThis.__t10Reads})')));
    }catch(captureFailure){error=new AggregateError([failure,captureFailure],'T10_BROWSER_AND_CAPTURE_FAILED');}
  }
  await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',purpose:'T10_WAITING_REPORTER_REAL_VERSION_CONFLICT',screenshots}));
}

// Hold only the first prepared waiting POST at the transport boundary. Every
// response comes from the original fetch and the actual server; no domain mock.
function instrument(path:string){return `(()=>{
  const original=globalThis.fetch;let held=false,waitingCommitted=false;
  globalThis.__t10Commands=[];globalThis.__t10Reads=[];
  globalThis.fetch=async(url,options)=>{
    const route=String(url),method=options?.method??'GET';
    if(method!=='POST'){globalThis.__t10Reads.push({path:route,afterWaitingSuccess:waitingCommitted});return original(url,options);}
    const headers=new Headers(options.headers),entry={path:route,body:JSON.parse(options.body),ifMatch:headers.get('if-match'),idempotencyKey:headers.get('idempotency-key'),status:null,result:null};
    globalThis.__t10Commands.push(entry);
    if(route===${JSON.stringify(path)}&&!held){held=true;await new Promise(resolve=>{globalThis.__t10ReleaseWaiting=resolve;});}
    const response=await original(url,options);entry.status=response.status;entry.result=await response.clone().json().catch(()=>null);
    if(route===${JSON.stringify(path)}&&response.status===200)waitingCommitted=true;
    return response;
  };
})()`;}

function assertOriginalContract(post:Post,path:string,version:number){
  assert.equal(post.path,path);
  assert.deepEqual(Object.keys(post.body).sort(),['client_command_id','expected_version','external_visible','note','reason_code']);
  assert.match(post.body.client_command_id,uuid);assert.equal(post.body.expected_version,version);
  assert.equal(post.body.reason_code,'WAITING_REPORTER');assert.equal(post.body.note,reason);assert.equal(post.body.external_visible,false);
  assert.equal(post.ifMatch,'"'+version+'"');assert.equal(post.idempotencyKey,post.body.client_command_id);
}

test('production waiting Reporter form preserves its reason on a real version conflict and explicitly commits the original Action without changing current responsibility or cycle',async()=>{
  await withT10Fixture(async context=>{
    const target=context.tickets[0],handler=context.principals[1];assert.ok(target);assert.ok(handler);
    const http=await t11Http(context,2),id=target.ticket.id,path='/api/tickets/'+id+'/request-information';
    const bootstrap=await (await http.get('/api/lifecycle/bootstrap')).json() as {principal_id:string;roles:string[]};
    assert.equal(bootstrap.principal_id,handler.id);assert.ok(bootstrap.roles.includes('HANDLER'));
    const current=await http.start(id),cycle=current.handling_cycle;assert.ok(cycle);
    assert.equal(current.status,'IN_PROGRESS');assert.equal(current.assignee_id,handler.id);assert.ok(current.allowed_actions.includes('request-information'));
    const read=async(route:string)=>{const response=await http.get('/api/tickets/'+id+route);assert.equal(response.status,200);return response.json() as Promise<unknown>;};
    const events=async()=>{const page=await read('/events?limit=200') as P2016TicketEventPage;assert.equal(page.next_cursor,null);return page.items;};
    const responsibility=await read('/responsibility'),deliveries=await read('/deliveries'),beforeEvents=await events();
    assert.equal(beforeEvents.filter(event=>event.event_type==='ticket.waiting_requester').length,0);
    await waitingBrowser(context,async(browser,capture)=>{
      await browser.waitFor(`document.querySelector('.ticket-command-version')?.textContent===${JSON.stringify('工单版本 '+current.version)}`);
      assert.equal(await browser.evaluate("Array.from(document.scripts).some(script=>script.type==='module'&&new URL(script.src,location.href).pathname.startsWith('/workbench/app/assets/'))"),true,'the page must load the actual production bundle');
      assert.equal(await browser.evaluate("Boolean(document.querySelector('button[data-action=request-information]'))"),true,'current authorized handling must expose the waiting Reporter menu action');
      assert.equal(await browser.evaluate("document.querySelector('button[data-action=request-information]').textContent.includes('等待报修人')"),true);
      await browser.evaluate("document.querySelector('button[data-action=request-information]').click()");
      await browser.waitFor(`Boolean(document.querySelector(${JSON.stringify(input)}))`);
      await browser.evaluate(`(()=>{const area=document.querySelector(${JSON.stringify(input)});Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(area,${JSON.stringify('  '+reason+'  ')});area.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(submit)}).textContent.includes('确认等待')`),true);
      await browser.waitFor(`document.querySelector(${JSON.stringify(submit)})?.disabled===false`);
      await browser.evaluate(instrument(path));
      await browser.evaluate(`document.querySelector(${JSON.stringify(submit)}).click()`);
      await browser.waitFor('typeof globalThis.__t10ReleaseWaiting===\'function\'');
      const prepared=await browser.evaluate('globalThis.__t10Commands') as Post[];assert.equal(prepared.length,1);
      const first=prepared[0];assert.ok(first);assertOriginalContract(first,path,current.version);assert.equal(first.status,null);
      const concurrent=await http.post(id,'internal-notes',{client_command_id:randomUUID(),expected_version:current.version,reason_code:'T10_CONCURRENT_NOTE',note:'INTERNAL_T10_CONCURRENT：另一公开命令已更新工单版本。',external_visible:false});
      assert.equal(concurrent.status,200);await concurrent.json();
      await browser.evaluate('globalThis.__t10ReleaseWaiting();delete globalThis.__t10ReleaseWaiting');
      await browser.waitFor("globalThis.__t10Commands[0]?.status===409&&document.querySelector('.ticket-waiting-state')?.textContent.includes('冲突')");
      await browser.waitFor(`document.querySelector('.ticket-command-version')?.textContent===${JSON.stringify('工单版本 '+(current.version+1))}`);
      assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(input)}).value`),'  '+reason+'  ');
      assert.equal(await browser.evaluate("document.querySelector('.properties')?.innerText.includes('等待补充')||document.querySelector('.ticket-waiting-state')?.textContent.includes('已等待')"),false,'a real 409 cannot appear as waiting success');
      assert.equal(await browser.evaluate('globalThis.__t10Commands.length'),1,'a conflict cannot automatically create another command');
      const afterConflict=await http.detail(id);assert.equal(afterConflict.status,'IN_PROGRESS');assert.equal(afterConflict.version,current.version+1);
      assert.equal(afterConflict.assignee_id,current.assignee_id);assert.equal(afterConflict.resolver_team_id,current.resolver_team_id);assert.deepEqual(afterConflict.handling_cycle,cycle);
      assert.deepEqual(await read('/responsibility'),responsibility);assert.deepEqual(await read('/deliveries'),deliveries);
      const conflictEvents=await events();assert.equal(conflictEvents.length,beforeEvents.length+1);assert.equal(conflictEvents.filter(event=>event.event_type==='ticket.waiting_requester').length,0);
      await capture('new-detail-1920.png');
      await browser.waitFor(`document.querySelector(${JSON.stringify(submit)})?.disabled===false`);
      await browser.evaluate(`document.querySelector(${JSON.stringify(submit)}).click()`);
      await browser.waitFor("globalThis.__t10Commands.length===2&&globalThis.__t10Commands[1]?.status===200&&document.querySelector('.properties')?.innerText.includes('等待补充')");
      await browser.waitFor(`document.querySelector('.ticket-command-version')?.textContent===${JSON.stringify('工单版本 '+(current.version+2))}`);
      const posts=await browser.evaluate('globalThis.__t10Commands') as Post[];assert.equal(posts.length,2);
      const failed=posts[0],committed=posts[1];assert.ok(failed);assert.ok(committed);
      assertOriginalContract(failed,path,current.version);assertOriginalContract(committed,path,current.version+1);
      assert.equal(failed.status,409);assert.equal(committed.status,200);assert.notEqual(committed.body.client_command_id,failed.body.client_command_id);
      assert.deepEqual(failed.result,{ok:false,error:{code:'TICKET_VERSION_CONFLICT',retryable:false},replayed:false});
      assert.ok(committed.result&&typeof committed.result==='object');const result=committed.result as P2016RequestInformationResult;
      assert.equal(result.ok,true);assert.equal(result.ticket_id,id);assert.equal(result.ticket_version,current.version+2);
      assert.match(result.ticket_event_id,uuid);assert.equal(result.control_event_id,null);assert.equal(result.replayed,false);assert.equal(result.handling_cycle_id,cycle.id);
      assert.equal(JSON.stringify(result).includes(reason),false);
      assert.equal(await browser.evaluate(`globalThis.__t10Reads.some(read=>read.path==='/api/tickets/${id}'&&read.afterWaitingSuccess)`),true,'success must refresh current public Ticket facts');
      const after=await http.detail(id);assert.equal(after.status,'WAITING_REQUESTER');assert.equal(after.version,current.version+2);
      assert.equal(after.assignee_id,current.assignee_id);assert.equal(after.resolver_team_id,current.resolver_team_id);assert.deepEqual(after.handling_cycle,cycle);assert.equal(after.allowed_actions.includes('request-information'),false);
      assert.deepEqual(await read('/responsibility'),responsibility);const finalDeliveries=await read('/deliveries');assert.deepEqual(finalDeliveries,deliveries,'the default notification policy must not add waiting deliveries');
      const finalEvents=await events();assert.equal(finalEvents.length,beforeEvents.length+2);
      const waiting=finalEvents.filter(event=>event.event_type==='ticket.waiting_requester');assert.equal(waiting.length,1);
      assert.deepEqual(waiting.map(event=>({id:event.event_id,old:event.old_status,next:event.new_status,version:event.aggregate_version,cycle:event.handling_cycle_id,internal:event.has_internal_note,external:event.has_external_note})),[{id:result.ticket_event_id,old:'IN_PROGRESS',next:'WAITING_REQUESTER',version:after.version,cycle:cycle.id,internal:true,external:false}]);
      assert.equal(JSON.stringify(finalEvents).includes(reason),false);assert.equal(JSON.stringify(finalDeliveries).includes(reason),false);
      await capture('new-detail-page-1920.png');
    });
  });
});
