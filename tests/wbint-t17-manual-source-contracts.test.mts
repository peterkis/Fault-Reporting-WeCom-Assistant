import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodeManualReportProjection,ManualReportContractError} from '../src/workbench-manual-report-browser-contracts.mjs';
test('a manual source read preserves its unverified at-report facts and rejects identity, recipient and contact-policy substitutions',()=>{
  const source={source_kind:'MANUAL_REPORT',source:'ON_SITE',description:'原始合成现场描述',location:{text:null,unknown:true},reporter:{verification:'UNVERIFIED',name:'手填报修人',contact:'人工联系2233',department:null},identity_source:'HAND_ENTERED',actor_principal_id:'00000000-0000-4000-8000-000000000001',manual_contact_required:true,external_notification:false};
  assert.deepEqual(decodeManualReportProjection(source),source);
  for(const value of [{...source,reporter:{...source.reporter,verification:'VERIFIED'}},{...source,identity_source:'DIRECTORY'},{...source,external_notification:true},{...source,manual_contact_required:false},
    {...source,wecom_userid:'invented-recipient'},{...source,reporter:{...source.reporter,person_id:'00000000-0000-4000-8000-000000000072'}},{...source,actor_principal_id:'invented-wecom-operator'},
    {...source,description:'字'.repeat(4001)},{...source,reporter:{...source.reporter,contact:'一行\n另一行'}},{...source,location:{unknown:true,text:'不应恢复为明确位置'}}])assert.throws(()=>decodeManualReportProjection(value),ManualReportContractError);
});
