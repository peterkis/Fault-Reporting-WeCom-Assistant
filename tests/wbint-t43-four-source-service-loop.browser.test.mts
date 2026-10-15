import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withT43Fixture,object,text,rows,version} from './helpers/t43-full-service-fixture.mjs';
import {start,get,post,complete,launch,observe,screenshot,close} from './helpers/t43-service-actions.mjs';
import type {Browser,Screenshot} from './helpers/t43-service-actions.mjs';

test('T43 four normal origins traverse the same current Core, explicit human responsibility, waiting, completion and legitimate next round with the production React artifact',{timeout:240000},()=>withT43Fixture(async f=>{
 const admin=f.staff[0],handler=f.staff[1];assert.ok(admin&&handler);
 const reports=[await f.inbound('group','合成门诊群打印机打印不了。'),await f.inbound('single','合成门诊单聊打印机打印不了。','synthetic-B'),await f.webReport('合成门诊网页打印机打印不了。'),await f.manualReport('合成门诊电话打印机打印不了。')];
 let browser:Browser|undefined,error:unknown;const screenshots:Screenshot[]=[],journeys:Record<string,unknown>[]=[];
 try{
  browser=await launch(f);
  for(let index=0;index<reports.length;index++){
   const source=reports[index];assert.ok(source);const active=await start(f,source),id=text(active.id),number=text(active.ticket_no),path='/api/tickets/'+id,canary='T43_PRIVATE_ONLY_'+index+'_'+randomUUID();
   await observe(browser,f,id,number,'处理中');
   // Assignment and communication choices remain explicit and independent.
   const beforeCommunication:unknown=(await get(admin,path+'/responsibility')).conversations;
   await post(admin,path+'/transfer-assignment',{client_command_id:randomUUID(),expected_version:version(active.version),reason_code:'WORKBENCH_ASSIGN',target_principal_id:text(f.principals[1]),resolver_team_id:'PILOT_IT',communication_choice:'RETAIN_CURRENT',sessions:[]});
   let current=await get(handler,path);assert.equal(current.assignee_id,f.principals[1]);assert.deepEqual((await get(admin,path+'/responsibility')).conversations,beforeCommunication);
   await post(handler,path+'/request-information',{client_command_id:randomUUID(),expected_version:version(current.version),reason_code:'WORKBENCH_REQUEST_INFORMATION',note:canary,external_visible:false});
   current=await get(handler,path);assert.equal(current.status,'WAITING_REQUESTER');await observe(browser,f,id,number,'等待补充');
   if(source.requestRef){const detail=await get(f.member,'/api/yixiaoxiu/requests/'+source.requestRef);await f.member.get('/api/yixiaoxiu/bootstrap');const response=await f.member.post('/api/yixiaoxiu/requests/'+source.requestRef+'/supplements',{schema_version:1,client_command_id:randomUUID(),expected_input_revision:text(detail.input_revision),text:'合成报修人补充：已重新连接，仍需继续检查。'});assert.equal(response.status,202,response.raw);await f.pump();assert.equal((await get(handler,path)).status,'WAITING_REQUESTER','new input cannot silently resume a Ticket');}
   else if(index<2){const reporter=index===0?'synthetic-A':'synthetic-B';const refs=await f.pool.query<{public_ref:string}>('SELECT public_ref FROM pilot_ticket.reporter_public_ref WHERE ticket_id=$1::uuid',[id]);const ref=refs.rows[0];assert.ok(ref,'the original notification projector must create its source-bound public reference');const supplement=await f.inbound('single','续接工单 '+ref.public_ref+'：已重新连接，仍需检查。',reporter);assert.equal(supplement.ticketId,id);assert.equal((await get(handler,path)).status,'WAITING_REQUESTER');}
   current=await get(handler,path);await post(handler,path+'/resume',{client_command_id:randomUUID(),expected_version:version(current.version),reason_code:'WORKBENCH_RESUME',note:'人工核对补充后明确恢复。',external_visible:false});current=await get(handler,path);assert.equal(current.status,'IN_PROGRESS');
   const closed=await complete(handler,current,canary),oldCycle=object(closed.handling_cycle);await observe(browser,f,id,number,'已关闭');
   if(source.requestRef){await f.member.get('/api/yixiaoxiu/bootstrap');const detail=await get(f.member,'/api/yixiaoxiu/requests/'+source.requestRef),context=object(detail.feedback_context);assert.equal(context.can_feedback,true);assert.ok(!JSON.stringify(detail).includes(canary));const body={schema_version:1,client_command_id:randomUUID(),feedback:'STILL_UNRESOLVED',completed_round_ref:text(context.completed_round_ref),expected_ticket_version:version(context.ticket_version)};await post(f.member,'/api/yixiaoxiu/requests/'+source.requestRef+'/feedback',body);}
   else if(index<2){const owner=f.members[index];assert.ok(owner);const ref=(await f.pool.query<{public_ref:string}>('SELECT public_ref FROM pilot_ticket.reporter_public_ref WHERE ticket_id=$1::uuid',[id])).rows[0];assert.ok(ref);const publicPath='/api/reporter/tickets/'+ref.public_ref;const detail=await get(owner,publicPath),context=object(detail.feedback_context);assert.equal(context.can_feedback,true);assert.ok(!JSON.stringify(detail).includes(canary));await owner.get('/api/reporter/feedback/bootstrap');const body={schema_version:1,client_command_id:randomUUID(),feedback:'STILL_UNRESOLVED',completed_round_ref:text(context.completed_round_ref),expected_ticket_version:version(context.ticket_version)};await post(owner,publicPath+'/feedback',body);const other=f.members[index===0?1:0];assert.ok(other);assert.equal((await other.get(publicPath)).status,404,'a known opaque reference does not grant another reporter access');}
   else await post(admin,path+'/reopen',{client_command_id:randomUUID(),expected_version:version(closed.version),reason_code:'STAFF_REOPEN',note:'未核验电话来源由工作人员核实后明确重新处理，不伪造报修人身份。'});
   const reopened=await get(admin,path);assert.equal(reopened.status,'REOPENED');assert.equal(reopened.assignee_id,null);assert.equal(reopened.ticket_no,number);assert.equal(object(reopened.handling_cycle).cycle_no,version(oldCycle.cycle_no)+1);assert.equal(object(reopened.handling_cycle).first_responsibility_event_id,null);await observe(browser,f,id,number,'重新报障');
   await post(handler,path+'/take-and-start',{client_command_id:randomUUID(),expected_version:version(reopened.version),reason_code:'T43_REACCEPT',resolver_team_id:'PILOT_IT'});const next=await get(handler,path);assert.equal(next.status,'IN_PROGRESS');assert.equal(next.assignee_id,f.principals[1]);assert.equal(object(next.handling_cycle).id,object(reopened.handling_cycle).id);await observe(browser,f,id,number,'处理中');
   const events=rows((await get(admin,path+'/events?limit=200')).items);assert.ok(events.some(e=>e.event_type==='ticket.reopened'));assert.ok(events.some(e=>e.event_type==='ticket.assignment_transferred'));journeys.push({source:source.source,intake_id:source.intakeId,ticket_id:id,ticket_no:number,old_cycle:oldCycle.id,new_cycle:object(next.handling_cycle).id,events:events.map(e=>e.event_type),reporter_feedback:index<3,manual_unverified_no_external_identity:index===3});
  }
  screenshots.push(await screenshot(browser,'new-detail-1280.png'));assert.equal(f.directoryCalls(),0);assert.equal(f.senderCalls.length,0);
  console.log('T43_FOUR_SOURCE_SERVICE_LOOP '+JSON.stringify({same_app:true,seeded_tickets:false,ai_provider_calls:0,external_calls:0,journeys}));
 }catch(failure){error=failure;if(browser)console.log('T43_LOOP_DIAGNOSTIC '+JSON.stringify(await browser.evaluate('({text:document.body.innerText,url:location.href})')));}
 await close(browser,error);console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',purpose:'t43-four-source-complete-loop',screenshots}));
}));
