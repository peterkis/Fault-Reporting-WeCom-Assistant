import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {object,text,rows,version} from './t43-full-service-fixture.mjs';
import type {T43Fixture,HttpClient,Intake} from './t43-full-service-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './p2-006-browser-harness.mjs';
export type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
export interface Screenshot {file:string;width:number;height:number;sha256:string}

export async function get(http:HttpClient,path:string):Promise<Record<string,unknown>>{const response=await http.get(path);assert.equal(response.status,200,response.raw);return response.body;}
export async function post(http:HttpClient,path:string,body:Record<string,unknown>):Promise<Record<string,unknown>>{const response=await http.post(path,body);assert.equal(response.status,200,response.raw);return response.body;}
export async function startCommand(f:T43Fixture,report:Intake){
 const admin=f.staff[0];assert.ok(admin);const current=await f.intake(report.intakeId);
 if(current.reviewId){const path='/api/manual-reviews/'+current.reviewId,review=await get(admin,path),context=await get(admin,path+'/resolve-and-start-context');assert.equal(context.allowed,true);assert.equal(object(review.material_basis).stale,false);
  const ticket=context.expected_ticket===null?null:object(context.expected_ticket);
  const sessions=ticket?rows((await get(admin,'/api/tickets/'+text(ticket.ticket_id)+'/related-conversations')).items).filter(s=>s.take_allowed===true).map(s=>({session_id:text(s.session_id),expected_row_version:version(Number(text(s.session_row_version)))})):[];
  return {path:path+'/resolve-and-start',body:{client_command_id:randomUUID(),expected_row_version:text(review.row_version),expected_material_basis:text(object(review.material_basis).current_hash),resolution_code:'CONFIRM_TICKET_ELIGIBLE',resolution_reason_code:'CLEAR_FAULT_HUMAN_CONFIRMED',expected_ticket:ticket===null?null:{ticket_id:text(ticket.ticket_id),expected_version:version(ticket.expected_version)},resolver_team_id:context.resolver_team_id===null?'PILOT_IT':text(context.resolver_team_id),communication_choice:sessions.length?'TAKE_SELECTED':'RETAIN_CURRENT',sessions}};
 }
 assert.ok(current.ticketId);const ticket=await get(admin,'/api/tickets/'+current.ticketId);
 return {path:'/api/tickets/'+current.ticketId+'/take-and-start',body:{client_command_id:randomUUID(),expected_version:version(ticket.version),reason_code:'T43_EXPLICIT_START',resolver_team_id:text(ticket.resolver_team_id)}};
}
export async function start(f:T43Fixture,report:Intake){const admin=f.staff[0];assert.ok(admin);const command=await startCommand(f,report),receipt=await post(admin,command.path,command.body);const id=text(receipt.ticket_id);const ticket=await get(admin,'/api/tickets/'+id);assert.equal(ticket.status,'IN_PROGRESS');assert.equal(ticket.assignee_id,f.principals[0]);return ticket;}
export async function complete(http:HttpClient,ticket:Record<string,unknown>,canary:string){const path='/api/tickets/'+text(ticket.id),body={client_command_id:randomUUID(),expected_version:version(ticket.version),reason_code:'STAFF_COMPLETED',handling_cycle_id:text(object(ticket.handling_cycle).id),internal_process:canary,external_summary:'合成设备已恢复，请重新尝试。',external_summary_confirmed:true};await post(http,path+'/complete',body);const completed=await get(http,path);assert.equal(completed.status,'CLOSED');return completed;}
/** Original round consumer, public Ticket Delivery query/control, and recording Sender; no SDK receipt is implied. */
export async function consumeRound(f:T43Fixture,id:string,sourceIndex:number,cycle:number,node:'FIRST_RESPONSIBILITY'|'STAFF_COMPLETED',privateCanary:string){
 const admin=f.staff[0];assert.ok(admin);const path='/api/tickets/'+id,originalTicket=await get(admin,path);await f.runtime.roundNotifications.runOnce();
 const page=rows((await get(admin,path+'/deliveries')).items),routes=page.filter(row=>row.cycle_no===cycle&&row.node===node),expected=sourceIndex===3?0:sourceIndex===0?2:1;assert.equal(routes.length,expected,JSON.stringify({sourceIndex,cycle,node,page}));
 if(sourceIndex===3){assert.deepEqual(page,[],'UNVERIFIED manual contact cannot become a personal App/Bot target');assert.equal((await f.pool.query('SELECT id FROM communication.ticket_notification_binding WHERE ticket_id=$1::uuid',[id])).rowCount,0);return {node,cycle,legal_skip:'UNVERIFIED_MANUAL_NO_PERSONAL_BINDING',routes:[]};}
 const targets=[];
 for(let index=0;index<routes.length;index++){
  const route=routes[index];assert.ok(route);const deliveryId=text(route.delivery_id),target=(await f.pool.query<{provider:string;target_type:string;target_id:string}>('SELECT provider,target_type,target_id FROM communication.delivery WHERE id=$1::uuid',[deliveryId])).rows[0];assert.ok(target);assert.equal(target.provider,sourceIndex===2?'WECOM_APP':'WECOM_AIBOT');assert.equal(target.target_type,route.destination_type);assert.equal(target.target_id,target.target_type==='GROUP'?'t43-synthetic-origin-group':sourceIndex===1?'synthetic-B':'synthetic-A');
  const unknown=node==='STAFF_COMPLETED'&&index===0;f.setSenderOutcome(unknown?'UNKNOWN':'ACKNOWLEDGED');await f.deliver(deliveryId);
  if(unknown){const before=f.senderCalls.length;assert.equal(await f.deliver(deliveryId),null,'UNKNOWN cannot automatically send again');assert.equal(f.senderCalls.length,before);const current:Record<string,unknown>|undefined=rows((await get(admin,path+'/deliveries')).items).find(row=>row.delivery_id===deliveryId);assert.equal(current?.status,'RECONCILIATION_REQUIRED');assert.equal(current?.side_effect_state,'UNKNOWN');const command={client_command_id:randomUUID(),reason_code:'T43_SYNTHETIC_OPERATOR_CONFIRMED',resolution:'CONFIRMED_SENT'};const reconciled=await post(admin,path+'/deliveries/'+deliveryId+'/reconcile',command);assert.equal(reconciled.status,'SENT');const replay=await post(admin,path+'/deliveries/'+deliveryId+'/reconcile',command);assert.equal(replay.replayed,true);assert.equal(f.senderCalls.length,before,'explicit synthetic reconciliation records a decision without another send');}
  const after:Record<string,unknown>|undefined=rows((await get(admin,path+'/deliveries')).items).find(row=>row.delivery_id===deliveryId);assert.ok(after);assert.equal(after.status,'SENT');assert.equal(f.senderCalls.filter(call=>call.delivery_id===deliveryId).length,1);targets.push({delivery_id:deliveryId,provider:target.provider,target_type:target.target_type,status:after.status,unknown_reconciled:unknown});
 }
 for(const call of f.senderCalls)assert.ok(!JSON.stringify(call.message.content).includes(privateCanary));assert.deepEqual(await get(admin,path),originalTicket);
 return {node,cycle,local_recording_sender_only:true,routes:targets};
}
export async function launch(f:T43Fixture,path='/workbench/app/'):Promise<Browser>{const cookie=f.browserCookies[0];assert.ok(cookie);const browser=await launchSystemBrowser({url:f.origin+path,width:1280,height:900,cookies:[cookie],certificateSpki:f.certificateSpki});assert.ok(browser);try{await browser.waitFor('Boolean(document.querySelector("[data-realtime-status=live]"))');return browser;}catch(error){await browser.close();throw error;}}
export async function observe(browser:Browser,f:T43Fixture,id:string,number:string,status:string){await browser.command('Page.enable');await browser.command('Page.navigate',{url:f.origin+'/workbench/app/items/ticket/'+id});await browser.waitFor('Boolean(document.querySelector(".detail-body"))&&document.querySelector(".detail-heading")?.textContent.includes('+JSON.stringify(number)+')');await browser.waitFor('document.querySelector(".detail-body")?.textContent.includes('+JSON.stringify(status)+')');}
export async function screenshot(browser:Browser,name:'new-detail-1280.png'|'new-detail-page-1280.png'|'new-board-1280.png'|'new-board-900.png'):Promise<Screenshot>{const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);const bytes=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,name);await writeFile(file,bytes);return {file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')};}
export async function close(browser:Browser|undefined,error:unknown){await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);}
