import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createYxxBrowserFixture} from './helpers/p2-g2-yixiaoxiu-browser.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {withT20FeedbackFixture} from './helpers/t20-feedback-fixture.mjs';
import {createYxxProfile} from '../src/p2-g2-yixiaoxiu-profile.mjs';
import type {WeComOAuth} from '../src/p2-g2-wecom-web-oauth.mjs';
import {mapping} from './helpers/yxx-ss-009-http-fixture.mjs';
type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
function errorFacts(value:unknown):unknown{return value instanceof Error?{name:value.name,message:value.message,stack:value.stack,...(value instanceof AggregateError?{errors:value.errors.map(errorFacts)}:{})}:value===null?null:String(value);}

test('production H5 offers its lawful original Reporter an explicit same-Ticket unresolved-feedback command',async()=>{
 await withT20FeedbackFixture(async f=>{
  await f.app.stop();const identityMapping=await mapping(),directory=join(tmpdir(),'t20-feedback-browser-'+randomUUID());await mkdir(directory);
  let fixture:Awaited<ReturnType<typeof createYxxBrowserFixture>>|undefined,tab:Browser|undefined,app:ReturnType<typeof createYxxProfile>|undefined,error:unknown;
  try{
   fixture=await createYxxBrowserFixture({pool:f.context.pool,createApp:({oauth,origin:publicOrigin}:{oauth:WeComOAuth;origin:string})=>{
    const runtime=createYxxProfile({...f.options,identityMapping,profile:'MEMBER_SELF_SERVICE',oauth,publicOrigin,yxxSelfService:{featureFlags:f.options.featureFlags,pollMilliseconds:100,reporterFeedbackEnabled:true}});app=runtime;return runtime.server;
   }});
   assert.ok(fixture);fixture.setMember('open-a');tab=await fixture.launch({path:'/synthetic-start',width:390,height:844});assert.ok(tab);
   await tab.evaluate("location.assign('/wecom/yixiaoxiu/')",{awaitPromise:false});await tab.waitFor("document.querySelector('#home-view')?.hidden===false");
   await tab.evaluate('location.assign('+JSON.stringify('/wecom/yixiaoxiu/reports/'+f.requestRef)+')',{awaitPromise:false});
   await tab.waitFor("document.querySelector('#detail-view')?.hidden===false&&document.querySelector('#detail-status')?.textContent.includes('关闭')");
   assert.equal(await tab.evaluate("Boolean(document.querySelector('[data-action=submit-feedback]'))"),true,'production original-Reporter detail must expose its lawful explicit feedback control');
   await tab.evaluate("(()=>{const original=globalThis.fetch;globalThis.__t20Posts=[];globalThis.__t20Reads=[];globalThis.fetch=(path,options)=>{if(options?.method==='POST')globalThis.__t20Posts.push({path:String(path),body:JSON.parse(options.body)});else globalThis.__t20Reads.push(String(path));return original(path,options);};})()");
   const before=Buffer.from(await tab.screenshot(),'base64');await writeFile(join(directory,'lawful-feedback-390.png'),before);
   await tab.evaluate("document.querySelector('[data-action=submit-feedback]').click()");
   await tab.waitFor("document.querySelector('[data-feedback-state]')?.textContent.includes('已重开')&&document.querySelector('#detail-status')?.textContent.includes('重新')");
   const posts=await tab.evaluate('globalThis.__t20Posts') as {path:string;body:{client_command_id:string;feedback:string;expected_ticket_version:number}}[];
   assert.equal(posts.length,1);assert.equal(posts[0]?.path,f.path+'/feedback');assert.equal(posts[0]?.body.feedback,'STILL_UNRESOLVED');assert.equal(posts[0]?.body.expected_ticket_version,f.completed.version);
   assert.equal(await tab.evaluate(`globalThis.__t20Reads.some(path=>path===${JSON.stringify(f.path)})`),true);
   assert.equal(await tab.evaluate('document.documentElement.scrollWidth>innerWidth'),false);
   const after=Buffer.from(await tab.screenshot(),'base64');await writeFile(join(directory,'same-ticket-reopened-390.png'),after);
   const fact=(await f.context.pool.query<{ticket_no:string;status:string;assignee_id:string|null;cycle_no:number}>('SELECT t.ticket_no,t.status,t.assignee_id::text,c.cycle_no FROM pilot_ticket.ticket t JOIN pilot_ticket.ticket_handling_cycle c ON c.id=t.current_handling_cycle_id WHERE t.id=$1::uuid',[f.ticketId])).rows[0];
   assert.deepEqual(fact,{ticket_no:f.completed.ticket_no,status:'REOPENED',assignee_id:null,cycle_no:(f.completed.handling_cycle?.cycle_no??0)+1});
   assert.equal((await tab.evaluate('JSON.stringify({local:{...localStorage},session:{...sessionStorage}})') as string).includes(posts[0]?.body.client_command_id??'INVALID'),false,'independent raw recovery default false stores no feedback operation');
   console.log('T20_H5_FIRST '+JSON.stringify({directory,real_http_pg:true,production_asset:true,simulated_oauth:true,external_calls:0,png:[{file:join(directory,'lawful-feedback-390.png'),sha256:createHash('sha256').update(before).digest('hex')},{file:join(directory,'same-ticket-reopened-390.png'),sha256:createHash('sha256').update(after).digest('hex')}]}));
  }catch(failure){error=failure;await writeFile(join(directory,'primary-error.json'),JSON.stringify(errorFacts(failure)));if(tab){try{await writeFile(join(directory,'failure.png'),Buffer.from(await tab.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await tab.evaluate('({text:document.body.innerText,path:location.pathname})')));}catch(observation){await writeFile(join(directory,'observer-error.json'),JSON.stringify(errorFacts(observation)));error=new AggregateError([failure,observation],'T20_H5_FAILURE_OBSERVATION_FAILED');}}}
  try{await closeBrowserTestResources([async()=>{await tab?.close();if(tab)assert.deepEqual(tab.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{await fixture?.close();if(fixture)assert.deepEqual(fixture.ownedResourceState(),{listeners:0,sockets:0,tlsDirectories:0});},async()=>{await app?.stop();}],error);}
  catch(failure){await writeFile(join(directory,'terminal-error-and-cleanup.json'),JSON.stringify({primary:errorFacts(error??null),terminal:errorFacts(failure),browser:tab?.ownedResourceState()??null,fixture:fixture?.ownedResourceState()??null}));console.error('T20_H5_FAILURE_POINTER '+directory);throw failure;}
 });
});
