import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import type {Server,IncomingMessage,ServerResponse} from 'node:http';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
import type {P2016EnabledRuntime} from '../src/p2-016-runtime.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
type Fixture={pool:PostgresPool;runtime:P2016EnabledRuntime;origin:string;cookies:string[];browserCookies:{name:string;value:string;url:string}[];tickets:{ticket:{id:string}}[];principals:{id:string;display_name:string}[]};
function object(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function rows(value:unknown):Record<string,unknown>[]{assert.ok(Array.isArray(value));return value.map(object);}
function string(value:unknown):string{assert.equal(typeof value,'string');return value as string;}
function failure(value:unknown):unknown{return value instanceof Error?{name:value.name,message:value.message,stack:value.stack}:String(value);}
function select(label:string){return `Array.from(document.querySelectorAll('.ticket-assignment select')).find(input=>Array.from(input.labels??[]).some(label=>label.textContent?.includes(${JSON.stringify(label)})))`;}
async function choose(browser:Browser,label:string,value:string){const expression=select(label);await browser.waitFor(`Boolean((${expression})&&Array.from((${expression}).options).some(option=>option.value===${JSON.stringify(value)}))`);await browser.evaluate(`(()=>{const input=${expression};Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('change',{bubbles:true}));})()`);}

test('production HANDLER explicitly selects canonical communication for one atomic transfer and reads the current facts',async()=>{
 await withWeb01Fixture(async(context:Fixture)=>{
  const first=context.tickets[0],oldOwner=context.principals[2],actor=context.principals[1],admin=context.cookies[0],cookie=context.cookies[2],browserCookie=context.browserCookies[2];assert.ok(first&&oldOwner&&actor&&admin&&cookie&&browserCookie);
  const path='/api/tickets/'+first.ticket.id;
  await context.pool.query("INSERT INTO pilot_ticket.resolver_team(team_id,display_name) VALUES('T06_BROWSER_SECOND','T06 合成第二组')");
  const target=await createPilotAccessService({pool:context.pool}).upsertPrincipal({wecomUserId:'t06-selected-browser-'+randomUUID(),displayName:'T06 明确沟通承接者',roles:['HANDLER'],resolverTeamIds:['PILOT_IT','T06_BROWSER_SECOND']});
  const get=async(url:string,current=cookie)=>{const response=await fetch(context.origin+url,{headers:{cookie:current}});return {status:response.status,value:object(await response.json())};};
  const workerBootstrap=(await get('/api/lifecycle/bootstrap')).value;assert.equal(workerBootstrap.ticket_assignment_enabled,true);assert.equal(workerBootstrap.ticket_conversation_self_handling_enabled,false);
  const post=async(url:string,command:Record<string,unknown>,current=cookie)=>{const csrf=(await get('/api/lifecycle/bootstrap',current)).value.csrf_token;const response=await fetch(context.origin+url,{method:'POST',headers:{cookie:current,origin:context.origin,'content-type':'application/json','x-csrf-token':string(csrf),'idempotency-key':string(command.client_command_id),'if-match':'"'+(command.expected_version??command.expected_row_version)+'"'},body:JSON.stringify(command)});return {status:response.status,value:object(await response.json())};};
  assert.equal((await post(path+'/assign',{client_command_id:randomUUID(),expected_version:2,reason_code:'WORKBENCH_ASSIGN',target_principal_id:oldOwner.id,resolver_team_id:'PILOT_IT',communication_choice:'RETAIN_CURRENT',sessions:[]},admin)).status,200);
  await context.runtime.coordinator.runOnce();const before=(await get(path)).value;assert.equal(before.status,'QUEUED');assert.equal(before.version,3);
  const related=rows((await get(path+'/related-conversations?limit=20')).value.items);assert.equal(related.length,1);const source=related[0];assert.ok(source);const sessionId=string(source.session_id);
  assert.equal((await post('/api/conversations/'+sessionId+'/takeover',{client_command_id:randomUUID(),expected_row_version:Number(source.session_row_version),reason_code:'T06_BROWSER_COMMUNICATOR'})).status,200);
  const current=rows((await get(path+'/related-conversations?limit=20')).value.items)[0];assert.ok(current);assert.equal(current.conversation_principal_id,actor.id);assert.equal(current.take_allowed,true);
  const requests:{method:string;path:string;status:number|null;body:unknown;uuid:unknown;match:unknown;csrf:boolean;origin:boolean}[]=[];
  const observe=(request:IncomingMessage,response:ServerResponse)=>{if(!request.headers.cookie?.includes(browserCookie.name+'='+browserCookie.value))return;const url=new URL(request.url??'/',context.origin);if(!url.pathname.startsWith('/api/'))return;const fact={method:request.method??'',path:url.pathname,status:null as number|null,body:null as unknown,uuid:request.headers['idempotency-key'],match:request.headers['if-match'],csrf:typeof request.headers['x-csrf-token']==='string',origin:request.headers.origin===context.origin};requests.push(fact);response.once('finish',()=>{fact.status=response.statusCode;});if(fact.method==='POST'){request.pause();const chunks:Buffer[]=[];request.on('data',(chunk:unknown)=>{if(Buffer.isBuffer(chunk))chunks.push(chunk);});request.once('end',()=>{try{fact.body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fact.body=null;}});}};
  context.runtime.server.on('request',observe);const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);const screenshots:{file:string;width:number;height:number;sha256:string}[]=[];let browser:Browser|undefined,primary:unknown;
  try{
   browser=await launchSystemBrowser({url:context.origin+'/workbench/app/items/ticket/'+first.ticket.id,width:1280,height:900,cookies:[browserCookie]});assert.ok(browser);const active=browser;
   const capture=async(name:string)=>{const bytes=Buffer.from(string(await active.screenshot()),'base64'),file=join(directory,name);await writeFile(file,bytes);screenshots.push({file:file.replaceAll('\\','/'),width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')});};
   await browser.waitFor("Boolean(document.querySelector('.ticket-assignment'))&&document.querySelector('[data-realtime-status]')?.dataset.realtimeStatus==='live'");
   assert.equal(await browser.evaluate(`(${select('处理组')}).value`),'');await choose(browser,'处理组','PILOT_IT');await choose(browser,'处理人',target.id);
   assert.equal(await browser.evaluate("Boolean(document.querySelector('.ticket-assignment input[value=TRANSFER_SELECTED]'))"),true,'the production form must offer an explicit selected-communication option');
   await browser.evaluate("document.querySelector('.ticket-assignment input[value=TRANSFER_SELECTED]').click()");
   await browser.waitFor(`Boolean(document.querySelector('.ticket-assignment [data-session-choice="${sessionId}"]'))`);
   assert.equal(await browser.evaluate(`document.querySelector('.ticket-assignment [data-session-choice="${sessionId}"]').checked`),false,'no canonical Session may be guessed or selected automatically');
   assert.equal(await browser.evaluate("document.querySelector('.ticket-assignment [data-action=transfer-assignment]').disabled"),true);
   await browser.evaluate(`document.querySelector('.ticket-assignment [data-session-choice="${sessionId}"]').click()`);await browser.waitFor("document.querySelector('.ticket-assignment [data-action=transfer-assignment]').disabled===false");
   assert.equal(requests.filter(row=>row.method==='POST').length,0);await capture('new-detail-1280.png');await browser.evaluate("document.querySelector('.ticket-assignment [data-action=transfer-assignment]').click()");
   await browser.waitFor("document.querySelector('.ticket-assignment')?.innerText.includes('责任已交接')");
   const posts=requests.filter(row=>row.method==='POST');assert.equal(posts.length,1);const actual=posts[0];assert.ok(actual);assert.equal(actual.status,200);assert.equal(actual.path,path+'/transfer-assignment');assert.equal(actual.csrf,true);assert.equal(actual.origin,true);assert.equal(actual.match,'"3"');
   const command=object(actual.body),uuid=string(command.client_command_id);assert.equal(actual.uuid,uuid);assert.deepEqual(command,{client_command_id:uuid,expected_version:3,reason_code:'WORKBENCH_TRANSFER',target_principal_id:target.id,resolver_team_id:'PILOT_IT',communication_choice:'TRANSFER_SELECTED',sessions:[{session_id:sessionId,expected_row_version:Number(current.session_row_version)}]});
   await browser.waitFor(`document.querySelector('.properties')?.innerText.includes(${JSON.stringify(target.display_name)})`);assert.ok(requests.some(row=>row.method==='GET'&&row.status===200&&[path,'/api/workbench/items/ticket/'+first.ticket.id].includes(row.path)));
   const after=(await get(path)).value;assert.equal(after.status,'QUEUED');assert.equal(after.assignee_id,target.id);assert.equal(after.resolver_team_id,'PILOT_IT');assert.equal(after.version,4);assert.deepEqual(after.handling_cycle,before.handling_cycle);assert.equal(after.intake_id,before.intake_id);
   const communication=rows((await get(path+'/responsibility')).value.conversations);assert.equal(communication.length,1);assert.equal(communication[0]?.session_id,sessionId);assert.equal(communication[0]?.conversation_principal_id,target.id);assert.equal(Number(communication[0]?.session_row_version),Number(current.session_row_version)+1);
   const events=rows((await get(path+'/events')).value.items);assert.equal(events.at(-1)?.event_type,'ticket.assignment_transferred');assert.equal(events.some(row=>['ticket.accepted','ticket.started'].includes(String(row.event_type))),false);await capture('new-detail-page-1280.png');
   const diagnostic=join(tmpdir(),'t06-selected-browser-diagnostic-'+randomUUID()+'.json');await writeFile(diagnostic,JSON.stringify({requests,screenshots},null,2));console.log('T06_BROWSER_DIAGNOSTIC '+JSON.stringify({file:diagnostic.replaceAll('\\','/')}));console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',staff_handler:true,explicit_selected_communication:true,one_command:true,same_cycle:true,screenshots}));
  }catch(error){primary=error;console.error('T06_BROWSER_PRIMARY '+JSON.stringify(failure(error)));}
  await closeBrowserTestResources([
   async()=>{if(primary&&browser){await writeFile(join(directory,'failure.png'),Buffer.from(string(await browser.screenshot()),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify({primary:failure(primary),requests,page:await browser.evaluate('({text:document.body.innerText,url:location.pathname})')}));}},
   async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},
   async()=>{context.runtime.server.removeListener('request',observe);assert.equal((await context.runtime.observability.metrics()).sse_clients,0);},
  ],primary);
 },{ticketAssignmentEnabled:true,ticketSelfHandlingWebSource:false,workbenchRealtimeEnabled:true});
});
