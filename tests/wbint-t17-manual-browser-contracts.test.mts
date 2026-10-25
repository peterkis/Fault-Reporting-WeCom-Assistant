import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {ManualReportContractError,emptyManualReportInput,manualReportCommandFromInput,decodeManualReportCommand,encodeManualReportDraft,decodeManualReportDraft,decodeManualReportReceipt} from '../app/pc-admin/src/contracts/workbench-manual-report-browser-contracts.mjs';
import type {ManualReportResult} from '../contracts/workbench_manual_report_contracts.js';

test('the recoverable pending manual command contains the original business intent once and never accepts an operator or credential override',()=>{
  const input={...emptyManualReportInput(),name:'合成报修人',contact:'人工内线1000',description:'打印机无法打印。'+'字'.repeat(3500),unknown:true};
  const command=manualReportCommandFromInput(input,randomUUID()),encoded=encodeManualReportDraft(input,command),restored=decodeManualReportDraft(encoded);
  assert.ok(Buffer.byteLength(encoded,'utf8')<16384);assert.deepEqual(restored.pending,command);
  assert.equal(restored.value.description,input.description);assert.equal(encoded.split(input.description).length,2,'pending description is retained exactly once');
  assert.ok(!Object.hasOwn(JSON.parse(encoded),'csrf_token'));assert.ok(!Object.hasOwn(command,'actor_principal_id'));
  for(const extra of [{actor_principal_id:randomUUID()},{csrf_token:'synthetic-not-a-stored-credential'},{wecom_user_id:'unverified-name-is-not-an-identity'}])assert.throws(()=>decodeManualReportCommand({...command,...extra}),ManualReportContractError);
});

test('manual browser decoding rejects another operation and private or contradictory receipt data rather than presenting it as success',()=>{
  const id=randomUUID(),result={ok:true,client_command_id:id,intake_id:randomUUID(),intake_no:'INT-20261009-0001',source:'PHONE',reporter_verification:'UNVERIFIED',manual_contact_required:true,external_notification:false,result_code:'NEEDS_DESCRIPTION',ticket:null,review:{id:randomUUID(),status:'PENDING'},replayed:true} satisfies ManualReportResult;
  assert.deepEqual(decodeManualReportReceipt({client_command_id:id,state:'COMMITTED',result},id),{client_command_id:id,state:'COMMITTED',result});
  assert.throws(()=>decodeManualReportReceipt({client_command_id:randomUUID(),state:'COMMITTED',result},id),ManualReportContractError);
  for(const mutation of [{...result,contact:'private synthetic contact'},{...result,external_notification:true},{...result,reporter_verification:'VERIFIED'},{...result,replayed:false}])assert.throws(()=>decodeManualReportReceipt({client_command_id:id,state:'COMMITTED',result:mutation},id),ManualReportContractError);
  assert.throws(()=>decodeManualReportReceipt({client_command_id:id,state:'UNKNOWN',result},id),ManualReportContractError);
});

test('manual browser input uses the server Unicode limits and preserves an explicit unknown location without a member identity',()=>{
  const value={...emptyManualReportInput(),name:'𠮷'.repeat(100),contact:'内线',description:'字'.repeat(4000),unknown:true,location:'先前输入的未确认位置'};
  const command=manualReportCommandFromInput(value,randomUUID());assert.equal(Array.from(command.reporter.name).length,100);assert.equal(Array.from(command.description).length,4000);assert.deepEqual(command.location,{text:null,unknown:true});
  assert.throws(()=>manualReportCommandFromInput({...value,name:value.name+'字'},randomUUID()),ManualReportContractError);
  assert.throws(()=>manualReportCommandFromInput({...value,description:value.description+'字'},randomUUID()),ManualReportContractError);
  assert.throws(()=>manualReportCommandFromInput({...value,contact:'内线\n另一身份'},randomUUID()),ManualReportContractError);
});
