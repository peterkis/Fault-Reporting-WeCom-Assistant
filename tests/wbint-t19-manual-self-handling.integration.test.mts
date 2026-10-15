import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import type {ManualReportSelfHandlingCommand} from '../contracts/workbench_manual_report_self_handling_contracts.js';

interface Fixture {origin:string;cookies:string[];principals:{id:string}[]}
function object(value:unknown):Record<string,unknown>{
  assert.ok(value!==null&&typeof value==='object'&&!Array.isArray(value));
  return value as Record<string,unknown>;
}
function text(value:unknown):string{assert.equal(typeof value,'string');assert.ok(value);return value as string;}
function objects(value:unknown):Record<string,unknown>[] {assert.ok(Array.isArray(value));return value.map(object);}

test('staff records a telephone fault and atomically starts one native Ticket as themselves while the actual reporter remains unverified',async()=>{
  await withWeb01Fixture(async({origin,cookies,principals}:Fixture)=>{
    const cookie=text(cookies[0]);
    const get=async(path:string)=>{const response=await fetch(origin+path,{headers:{cookie}});assert.equal(response.status,200);return object(await response.json());};
    const bootstrap=await get('/api/lifecycle/bootstrap'),csrf=text(bootstrap.csrf_token),actor=text(bootstrap.principal_id);
    assert.equal(actor,principals[0]?.id);
    const command:ManualReportSelfHandlingCommand={schema_version:1,client_command_id:randomUUID(),source:'PHONE',
      description:'合成电话报修：打印机无法打印',location:{text:null,unknown:true},
      reporter:{verification:'UNVERIFIED',name:'合成实际报修人',contact:'内线1234',department:'合成科室'},resolver_team_id:'PILOT_IT'};
    const post=()=>fetch(origin+'/api/workbench/reports/take-and-start',{method:'POST',headers:{cookie,origin,
      'content-type':'application/json','idempotency-key':command.client_command_id,'x-csrf-token':csrf},body:JSON.stringify(command)});
    const response=await post();
    assert.equal(response.status,202,'one public command must commit admission, the native Ticket, actual self acceptance and start together');
    const result=object(await response.json()),ticket=object(result.ticket),ticketId=text(ticket.id),intakeId=text(result.intake_id);
    assert.equal(result.client_command_id,command.client_command_id);assert.equal(result.replayed,false);
    assert.equal(result.source,'PHONE');assert.equal(result.reporter_verification,'UNVERIFIED');
    assert.equal(result.manual_contact_required,true);assert.equal(result.external_notification,false);
    assert.equal(result.review,null);assert.equal(ticket.status,'IN_PROGRESS');
    const detail=await get('/api/tickets/'+ticketId);
    assert.equal(detail.status,'IN_PROGRESS');assert.equal(detail.assignee_id,actor);assert.equal(detail.resolver_team_id,'PILOT_IT');
    assert.equal(detail.intake_id,intakeId);assert.equal(detail.version,3);
    const cycle=object(detail.handling_cycle);assert.equal(cycle.cycle_no,1);text(cycle.first_responsibility_event_id);
    const events=objects((await get('/api/tickets/'+ticketId+'/events')).items);
    assert.deepEqual(events.map(event=>event.event_type),['ticket.created','ticket.accepted','ticket.started']);
    const responsibility=await get('/api/tickets/'+ticketId+'/responsibility');
    assert.equal(responsibility.ticket_assignee_id,actor);assert.deepEqual(responsibility.conversations,[]);
    const item=object((await get('/api/workbench/items/ticket/'+ticketId)).item);
    assert.equal(item.intake_id,intakeId);assert.equal(item.source,'MANUAL');assert.equal(item.source_label,'电话代录');
    assert.equal(item.reporter_name,'合成实际报修人（身份未核实）');assert.equal(item.assignee_name,'林舟');
    const replay=await post();assert.equal(replay.status,200);assert.deepEqual(await replay.json(),{...result,replayed:true});
    assert.deepEqual(await get('/api/tickets/'+ticketId+'/events'),{items:events,next_cursor:null});
    const cards=objects((await get('/api/workbench/board?column=active&limit=100')).items);
    assert.equal(cards.filter(card=>card.intake_id===intakeId).length,1);
  },{workbenchManualReportsEnabled:true,ticketSelfHandlingEnabled:true,manualProjection:true});
});
