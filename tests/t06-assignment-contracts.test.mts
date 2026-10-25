import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {normalizeTicketAssignmentCommand,assignmentActions} from '../app/server/src/workbench-ticket-assignment.mjs';
import {assertP2016Schema} from './helpers/p2-016-schema-assert.mjs';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import type {P2016TicketRow} from '../app/server/src/p2-016-ticket-query.mjs';
import type {WorkbenchPrincipal} from '../app/server/src/p2-006-workbench-authorization.mjs';
test('the real enabled public Ticket detail remains covered by the closed published schema',async()=>{
 await withWeb01Fixture(async(context:{origin:string;cookies:string[];tickets:{ticket:{id:string}}[]})=>{const first=context.tickets[0],cookie=context.cookies[0];assert.ok(first&&cookie);const response=await fetch(context.origin+'/api/tickets/'+first.ticket.id,{headers:{cookie}});assert.equal(response.status,200);const value:unknown=await response.json();await assertP2016Schema('p2_016_ticket_detail',value);},{ticketAssignmentEnabled:true,ticketSelfHandlingWebSource:false});
});
test('closed assignment normalization preserves explicit intent and enforces exact versions and bounded unique selections',()=>{
 const input={action:'assign',ticket_id:randomUUID(),client_command_id:randomUUID(),expected_version:2,reason_code:'WORKBENCH_ASSIGN',target_principal_id:randomUUID(),resolver_team_id:'PILOT_IT',communication_choice:'TRANSFER_SELECTED',sessions:[{session_id:randomUUID(),expected_row_version:1}]};
 const normalized=normalizeTicketAssignmentCommand(input);assert.deepEqual(normalized,input);const original=input.sessions[0];assert.ok(original);original.expected_row_version=9;assert.equal(normalized.sessions[0]?.expected_row_version,1);assert.equal(Object.isFrozen(normalized.sessions[0]),true);
 for(const invalid of [{...input,external_visible:true},{...input,expected_version:'2'},{...input,expected_version:0},{...input,communication_choice:'RETAIN_CURRENT'},{...input,sessions:[]},{...input,sessions:[normalized.sessions[0],normalized.sessions[0]]},{...input,sessions:Array.from({length:9},()=>({session_id:randomUUID(),expected_row_version:1}))}])assert.throws(()=>normalizeTicketAssignmentCommand(invalid),{code:'P2_016_INPUT_INVALID'});
});
test('assignment policy advertises lawful ownership actions without implying acceptance or granting nonworker roles',()=>{
 const worker:WorkbenchPrincipal={principal_id:randomUUID(),display_name:'Synthetic worker',is_active:true,roles:['HANDLER'],team_ids:['PILOT_IT']};const ticket:P2016TicketRow={id:randomUUID(),ticket_no:'SYNTHETIC',request_type:'INCIDENT',status:'QUEUED',priority:'NORMAL',resolver_team_id:'PILOT_IT',assignee_id:null,version:2,created_at:'2026-10-09 12:00:00',updated_at:'2026-10-09 12:00:00',intake_id:randomUUID()};
 assert.deepEqual(assignmentActions(worker,ticket),['assign']);for(const status of ['QUEUED','ACCEPTED','IN_PROGRESS','WAITING_REQUESTER','WAITING_VENDOR'] as const)assert.deepEqual(assignmentActions(worker,{...ticket,status,assignee_id:randomUUID()}),['transfer-assignment']);for(const status of ['NEW','REOPENED','RESOLVED','CLOSED','CANCELLED','DUPLICATE_LINKED'] as const)assert.deepEqual(assignmentActions(worker,{...ticket,status,assignee_id:randomUUID()}),[]);assert.deepEqual(assignmentActions({...worker,is_active:false},ticket),[]);assert.deepEqual(assignmentActions({...worker,roles:['REPORTER']},ticket),[]);
});
