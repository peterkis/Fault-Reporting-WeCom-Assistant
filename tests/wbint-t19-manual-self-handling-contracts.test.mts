import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {decodeManualSelfHandlingCommand,decodeManualSelfHandlingContext,decodeManualSelfHandlingResult,manualSelfHandlingCommand,encodeManualSelfHandlingDraft,decodeManualSelfHandlingDraft} from '../app/pc-admin/src/contracts/workbench-manual-self-handling-browser-contracts.mjs';
import {emptyManualReportInput} from '../app/pc-admin/src/contracts/workbench-manual-report-browser-contracts.mjs';
test('T19 the original captured self handling command round trips a full Unicode intent without losing its UUID or selected group',()=>{
  const value={...emptyManualReportInput(),name:'合成报修人',contact:'合成内线19',description:'字'.repeat(4000),unknown:true},id=randomUUID(),command=manualSelfHandlingCommand(value,id,'PILOT_IT');
  const encoded=encodeManualSelfHandlingDraft({value,team:'PILOT_IT',pending:command});assert.ok(Buffer.byteLength(encoded)<16384);assert.deepEqual(decodeManualSelfHandlingDraft(encoded),{value,team:'PILOT_IT',pending:command});assert.equal(command.client_command_id,id);assert.equal(command.description.length,4000);
});
test('T19 its closed command and recovery decoder reject actor injection, directory-selection substitution and changed or incomplete envelopes',()=>{
  const value={...emptyManualReportInput(),name:'合成',contact:'内线',description:'打印机无法打印',unknown:true},command=manualSelfHandlingCommand(value,randomUUID(),'PILOT_IT');
  for(const input of [{...command,actor_principal_id:randomUUID()},{...command,resolver_team_id:''},{...command,reporter:{verification:'VERIFIED_SELECTION',candidate_ref:'a'.repeat(32),candidate_version:'b'.repeat(64)}},{...command,client_command_id:'not-a-uuid'}])assert.throws(()=>decodeManualSelfHandlingCommand(input));
  assert.throws(()=>decodeManualSelfHandlingDraft(JSON.stringify({schema:1,pending:command,value})));
  assert.throws(()=>decodeManualSelfHandlingDraft(JSON.stringify({schema:1,value})));
});
test('T19 current-context decoder rejects false eligibility, duplicate or oversized group pages and extra authority fields',()=>{
  const context={can_take_and_start:true,resolver_teams:[{id:'PILOT_IT',name:'合成组'}],manual_contact_required:true,external_notification:false,draft_recovery_enabled:true};assert.deepEqual(decodeManualSelfHandlingContext(context),context);
  for(const input of [{...context,can_take_and_start:false},{...context,actor_principal_id:randomUUID()},{...context,resolver_teams:[...context.resolver_teams,...context.resolver_teams]},{...context,resolver_teams:Array.from({length:101},(_,n)=>({id:'TEAM_'+n,name:'合成组'}))}])assert.throws(()=>decodeManualSelfHandlingContext(input));
});
test('T19 never decodes a queued or Review-only admission as successful immediate handling',()=>{
  const id=randomUUID(),result={ok:true,client_command_id:id,intake_id:randomUUID(),intake_no:'INT-20261015-0019',source:'PHONE',reporter_verification:'UNVERIFIED',manual_contact_required:true,external_notification:false,result_code:'TICKET_ELIGIBLE',ticket:{id:randomUUID(),number:'IT-20261015-0019',status:'IN_PROGRESS'},review:null,replayed:false};assert.deepEqual(decodeManualSelfHandlingResult(result,id),result);
  assert.throws(()=>decodeManualSelfHandlingResult({...result,ticket:{...result.ticket,status:'QUEUED'}},id));assert.throws(()=>decodeManualSelfHandlingResult({...result,ticket:null,review:{id:randomUUID(),status:'PENDING'}},id));assert.throws(()=>decodeManualSelfHandlingResult(result,randomUUID()));
});
