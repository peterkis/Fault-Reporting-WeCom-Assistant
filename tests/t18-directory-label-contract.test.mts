// SOURCE_NOT_RUN. Directory labels are retained observations: the public server
// accepts nonempty labels with boundary spaces, so browser readers must preserve them.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createWorkbenchReporterCandidates} from '../app/server/src/workbench-reporter-candidates.mjs';
import {decodeReporterCandidates,decodeManualReportProjection} from '../app/pc-admin/src/contracts/workbench-manual-report-browser-contracts.mjs';
import {createT18Directory} from './helpers/t18-verified-fixture.mjs';

const name=' 合成成员甲 ',department=' 合成门诊 ';
test('the browser reads legal original Directory labels from the actual public candidate Port without trimming them',async()=>{
  const principal=randomUUID(),fixture=createT18Directory();fixture.setPrincipal(principal);
  const candidate={...fixture.candidate,display_name:name,departments:[department]};
  const service=createWorkbenchReporterCandidates({enabled:true,directory:{...fixture.directory,port:{...fixture.directory.port,
    async searchAuthorizedCandidates(input){assert.equal(input.principal_id,principal);input.signal.throwIfAborted();
      return {schema_version:1,candidates:[candidate],next_cursor:null,manual_fallback_available:true};}}}});
  const page=await service.search(principal,new URLSearchParams({q:'合成',limit:'2'}));
  assert.equal(page.candidates[0]?.display_name,name);assert.deepEqual(page.candidates[0]?.departments,[department]);
  const decoded=decodeReporterCandidates(page);assert.equal(decoded.candidates[0]?.display_name,name);assert.deepEqual(decoded.candidates[0]?.departments,[department]);
});

test('the browser preserves legal original Directory label spacing in the retained VERIFIED safe projection',()=>{
  const original={source_kind:'MANUAL_REPORT',source:'ON_SITE',description:'合成现场原始报修',location:{text:null,unknown:true},
    reporter:{verification:'VERIFIED',name,departments:[department]},identity_source:'VERIFIED_DIRECTORY_SELECTION',actor_principal_id:randomUUID(),
    manual_contact_required:false,external_notification:false,notification_eligibility:'ELIGIBLE'};
  const decoded=decodeManualReportProjection(original);assert.ok(decoded.reporter.verification==='VERIFIED');
  assert.equal(decoded.reporter.name,name);assert.deepEqual(decoded.reporter.departments,[department]);
  assert.equal(decoded.identity_source,'VERIFIED_DIRECTORY_SELECTION');assert.equal(decoded.external_notification,false);
});
