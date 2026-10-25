// Registered Session cursor delivery-fault scenarios with exact visible bounds.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {appendT22Item,withT22Fixture} from './helpers/wbint-t22-fixture.mjs';
import {createP2016Runtime} from '../app/server/src/p2-016-runtime.mjs';
import {migrateP2012} from '../app/server/scripts/p2-012-migrate.mjs';
import {migrateYxxSelfService} from '../app/server/scripts/yxx-self-service-migrate.mjs';
import {migrateWorkbenchManualReports} from '../app/server/scripts/workbench-manual-reports-migrate.mjs';
import {migrateWorkbenchPersonalRead} from '../app/server/scripts/workbench-personal-read-migrate.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

async function sessionCursorObservation(firstOnly:boolean){await withT22Fixture(async f=>{
  const session=f.sessions[0],other=f.sessions[1];assert.ok(session);assert.ok(other);
  await f.runtime.stop();const input={databaseUrl:f.databaseUrl,mode:'apply' as const};await migrateP2012(input);await migrateYxxSelfService(input);await migrateWorkbenchManualReports(input);await migrateWorkbenchPersonalRead(input);
  if(!firstOnly){
    const second=await f.pool.query('SELECT 1 FROM conversation.item WHERE session_id=$1::uuid AND sequence_no=2',[session.id]);
    if(!second.rowCount)await appendT22Item(f.pool,session.id,2,'参与者甲的第二条独立服务材料');
    const third=await f.pool.query('SELECT 1 FROM conversation.item WHERE session_id=$1::uuid AND sequence_no=3',[session.id]);
    if(!third.rowCount)await appendT22Item(f.pool,session.id,3,'独立第三条服务材料，不应在本次两条可见范围内');
  }
  const runtime=createP2016Runtime({pool:f.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:f.origin,listenPort:Number(new URL(f.origin).port),principalIds:[f.principals[0]?.id??'',f.principals[1]?.id??''],externalSendEnabled:false,workbenchConversationsEnabled:true,workbenchManualReviewEnabled:true,workbenchPersonalReadEnabled:true});
  let browser:Awaited<ReturnType<typeof launchSystemBrowser>>|undefined,failure:unknown;const directory=join(tmpdir(),'t35-session-unknown-'+randomUUID());await mkdir(directory);
  try{
    const {cookies}=await runtime.start();assert.ok(cookies);const a=cookies[0],b=cookies[1];assert.ok(a);assert.ok(b);
    const get=(path:string,second=false)=>fetch(f.origin+path,{headers:{cookie:(second?b:a).name+'='+(second?b:a).value}}),path='/api/conversations/'+session.id;
    const cursor=async(id:string,second=false)=>(await (await get('/api/conversations/'+id,second)).json() as {read_cursor:{last_read_sequence:string}}).read_cursor;
    const sourcePath='/api/workbench/items/ticket/'+session.ticketId+'/read-position',source=await (await get(sourcePath)).json();
    assert.equal((await cursor(session.id)).last_read_sequence,'0');
    browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:1280,height:firstOnly?160:240,cookies:[{...a,url:f.origin+'/'}]});assert.ok(browser);
    await browser.command('Emulation.setFocusEmulationEnabled',{enabled:true});await browser.command('Page.enable');
    await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{globalThis.__t35Visible=false;globalThis.__t35Posts=[];globalThis.__t35Commits=[];globalThis.__t35CurrentChecks=[];globalThis.__t35LoseAck=true;Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>globalThis.__t35Visible?'visible':'hidden'});const original=fetch;globalThis.fetch=(path,options)=>{const value=String(path),write=options?.method==='POST'&&value.endsWith('/read-cursor');if(write)globalThis.__t35Posts.push({path:value,body:JSON.parse(options.body)});return original(path,options).then(async response=>{if(write&&response.status===200&&globalThis.__t35LoseAck){globalThis.__t35LoseAck=false;globalThis.__t35Commits.push(await response.clone().json());throw new TypeError('T35 authentic Session ACK delivery lost after COMMIT');}if(value===${JSON.stringify(path)}&&options?.method!=='POST'&&globalThis.__t35Commits.length)globalThis.__t35CurrentChecks.push({status:response.status,body:await response.clone().json()});return response;});};})()`});
    await browser.command('Page.navigate',{url:f.origin+'/workbench/app/conversations/'+session.id});await browser.waitFor("Boolean(document.querySelector('p[data-session-read-sequence=\"1\"]'))");
    if(!firstOnly)await browser.waitFor("Boolean(document.querySelector('p[data-session-read-sequence=\"2\"]'))");
    if(!firstOnly)await browser.waitFor("Boolean(document.querySelector('p[data-session-read-sequence=\"3\"]'))");
    await browser.evaluate('document.fonts.ready.then(()=>true)');assert.deepEqual(await browser.evaluate('globalThis.__t35Posts'),[]);
    // Both scenarios bound all visible bodies, including later projections.
    const show=`(()=>{const first=document.querySelector('p[data-session-read-sequence="1"]');first.scrollIntoView({block:'center'});const a=first.getBoundingClientRect(),b=document.querySelector('p[data-session-read-sequence="2"]')?.getBoundingClientRect();if(!(a.top>=0&&a.bottom<=innerHeight))throw Error('T35_FIRST_BODY_NOT_VISIBLE');if(${firstOnly}&&b&&b.bottom<=innerHeight+1)throw Error('T35_SECOND_BODY_ALREADY_COMPLETE');if(!${firstOnly}&&(!b||b.top<0||b.bottom>innerHeight))throw Error('T35_BOTH_BODIES_NOT_VISIBLE');globalThis.__t35Visible=true;document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'));})()`;
    const boundedShow=show.replace('globalThis.__t35Visible=true;',`const visible=[...document.querySelectorAll('p[data-session-read-sequence]')].filter(node=>{const box=node.getBoundingClientRect();return box.top>=0&&box.bottom<=innerHeight;}).map(node=>Number(node.dataset.sessionReadSequence));if(Math.max(...visible)!==${firstOnly?1:2})throw Error('T35_VISIBLE_BODY_UPPER_BOUND_INVALID');globalThis.__t35Visible=true;`);
    await browser.evaluate(boundedShow);await browser.waitFor('globalThis.__t35Commits.length===1');
    const original=await browser.evaluate('globalThis.__t35Posts') as {path:string;body:{client_command_id:string;last_read_sequence:number}}[];assert.equal(original.length,1);
    if(firstOnly)assert.equal(original[0]?.body.last_read_sequence,1);else assert.equal(original[0]?.body.last_read_sequence,2);
    const expected=firstOnly?'1':'2';assert.equal((await cursor(session.id)).last_read_sequence,expected);console.log('T35_SESSION_UNKNOWN_COMMIT '+JSON.stringify({delivery_failed:true,actual_cursor:expected,original_uuid:original[0]?.body.client_command_id}));
    await browser.evaluate("globalThis.__t35Visible=false;document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('blur'))");await browser.evaluate(boundedShow);
    await browser.waitFor(`globalThis.__t35CurrentChecks.some(response=>response.status===200&&response.body.read_cursor.last_read_sequence==='${expected}')`);
    const after=await browser.evaluate('globalThis.__t35Posts') as typeof original;
    assert.deepEqual(after.filter(row=>row.body.last_read_sequence===Number(expected)),original,'current cursor confirmation must not repeat the unknown original coordinate');
    if(after.length>1){
      assert.ok(after.slice(1).every(row=>row.body.last_read_sequence===2),'only the independently visible second body is another intent');
      assert.equal(await browser.evaluate("(()=>{const node=document.querySelector('p[data-session-read-sequence=\"2\"]'),box=node?.getBoundingClientRect();return node?.textContent==='仅供内部的合成处理记录'&&document.visibilityState==='visible'&&document.hasFocus()&&box.top>=0&&box.bottom<=innerHeight;})()"),true);
    }
    assert.equal((await cursor(session.id,true)).last_read_sequence,'0');assert.equal((await cursor(other.id)).last_read_sequence,'0');assert.deepEqual(await (await get(sourcePath)).json(),source);
    await writeFile(join(directory,'session-original-cursor-check-1280.png'),Buffer.from(await browser.screenshot(),'base64'));console.log('T35_SESSION_UNKNOWN_CHECKED '+JSON.stringify({directory,own_current_cursor:true,original_coordinate_posts:1,actual_posts:after.length,no_new_receipt_route:true}));
  }catch(error){failure=error;try{if(browser){await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText,posts:globalThis.__t35Posts,commits:globalThis.__t35Commits,current_checks:globalThis.__t35CurrentChecks})')));}}catch(diagnosticFailure){failure=new AggregateError([failure,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
  await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{await runtime.stop();assert.equal(runtime.server.listening,false);}],failure);
});}

test('T35 a lost Session cursor ACK is checked through its current own cursor on the next real foreground observation',{timeout:120_000},()=>sessionCursorObservation(true));
test('T35 two fully visible Session bodies legitimately advance to sequence2 and retain GET-only UNKNOWN recovery',{timeout:120_000},()=>sessionCursorObservation(false));
