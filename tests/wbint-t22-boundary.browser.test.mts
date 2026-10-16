import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withT22Fixture} from './helpers/wbint-t22-fixture.mjs';
import {seedWeb01NoConversationIntake} from './helpers/web01-workbench-fixture.mjs';
import {migrateP2012} from '../scripts/p2-012-migrate.mjs';
import {migrateYxxSelfService} from '../scripts/yxx-self-service-migrate.mjs';
import {assertLocalDateTime} from '../src/platform/time-contract.mjs';
import {createPilotTicketCore} from '../src/p1-005-pilot-ticket-core.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

test('raw recovery false creates no recovery storage and a real Web Store Port Ticket has no fabricated conversation editor',async()=>{
 await withT22Fixture(async({origin,browserCookie,pool,databaseUrl,sessions})=>{
  const session=sessions[0];assert.ok(session);let browser:Awaited<ReturnType<typeof launchSystemBrowser>>|undefined,failure:unknown;
  try{
   const migrationInput={databaseUrl,mode:'apply'};await migrateP2012(migrationInput);await migrateYxxSelfService(migrationInput);const intake=await seedWeb01NoConversationIntake({pool,text:'T22 real synthetic Web-only report'}),ticket=(await createPilotTicketCore({pool}).createForIntake({intakeId:intake.intakeId,occurredAt:assertLocalDateTime(intake.receivedAt),traceId:'T22_WEB_NO_SESSION'})).ticket;assert.ok(ticket);
   browser=await launchSystemBrowser({url:origin+'/workbench/app/conversations/'+session.id,width:900,height:900,cookies:[{...browserCookie,url:origin+'/'}]});assert.ok(browser);await browser.waitFor("document.querySelectorAll('textarea[data-purpose]').length===2");
   const bootstrap=await browser.evaluate("fetch('/api/lifecycle/bootstrap').then(r=>r.json())") as Record<string,unknown>;assert.equal(bootstrap.conversation_workspace_enabled,true);assert.equal(bootstrap.conversation_draft_recovery_enabled,false);assert.equal(bootstrap.draft_recovery_enabled,false);assert.equal(await browser.evaluate("document.querySelectorAll('[data-conversation-draft]').length"),0);
   await browser.evaluate("(()=>{const input=document.querySelector('textarea[data-purpose=messages]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'T22 memory-only input');input.dispatchEvent(new Event('input',{bubbles:true}));})()");
   await browser.command('Page.navigate',{url:origin+'/workbench/app/items/ticket/'+ticket.id+'?detail=page'});await browser.waitFor("document.querySelector('[aria-label=关联服务会话]')?.textContent.includes('没有可读取的服务会话')");assert.equal(await browser.evaluate("document.querySelectorAll('[data-conversation-ready],textarea[data-purpose]').length"),0);assert.equal(await browser.evaluate("indexedDB.databases().then(rows=>rows.some(v=>v.name==='wecom-workbench-drafts-v1'))"),false);
   assert.equal(Number((await pool.query<{count:string}>('SELECT count(*)::text AS count FROM conversation.session WHERE service_intake_id=$1::uuid',[intake.intakeId])).rows[0]?.count),0);
   assert.deepEqual(await browser.evaluate(`fetch('/api/workbench/items/ticket/${ticket.id}/conversations').then(r=>r.json())`),{items:[]});
  }catch(error){failure=error;try{console.log('T22_WEB_RECOVERY_DISABLED '+JSON.stringify(browser?await browser.evaluate('({text:document.body.innerText})'):{}));}catch(diagnosticFailure){failure=new AggregateError([failure,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
  await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
 },{recovery:false});
});

test('the new workspace remains disabled by default while the retained legacy conversation profile is readable',async()=>{
 await withT22Fixture(async({origin,cookie,sessions})=>{
  const session=sessions[0];assert.ok(session);assert.equal((await fetch(origin+'/api/workbench/conversations',{headers:{cookie}})).status,503);assert.equal((await fetch(origin+'/workbench/app/conversations/'+session.id,{headers:{cookie}})).status,404);assert.equal((await fetch(origin+'/api/conversations/'+session.id,{headers:{cookie}})).status,200);
  const bootstrap=await (await fetch(origin+'/api/lifecycle/bootstrap',{headers:{cookie}})).json() as Record<string,unknown>;assert.equal(bootstrap.conversation_workspace_enabled,false);assert.equal(bootstrap.conversation_draft_recovery_enabled,false);
 },{enabled:false});
});

