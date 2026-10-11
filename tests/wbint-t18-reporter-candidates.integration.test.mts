import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import type {ManualReporterDirectoryOptions} from '../contracts/workbench_reporter_candidates_contracts.js';

interface Fixture {origin:string;cookies:string[];principals:{id:string}[]}

test('authorized staff can search a bounded reporter candidate in the configured application and object scope',async()=>{
  let authorizedPrincipalId:string|null=null;
  const directory:ManualReporterDirectoryOptions={
    application:{sourceCorpScope:'wbint-t18-synthetic-corp',sourceAppScope:'wbint-t18-synthetic-app'},
    directorySourceScope:'WBINT_T18_SYNTHETIC_DIRECTORY',
    port:{
      async searchAuthorizedCandidates(input){
        assert.deepEqual(input.application,{sourceCorpScope:'wbint-t18-synthetic-corp',sourceAppScope:'wbint-t18-synthetic-app'});
        assert.equal(input.directory_source_scope,'WBINT_T18_SYNTHETIC_DIRECTORY');
        assert.ok(authorizedPrincipalId);assert.equal(input.principal_id,authorizedPrincipalId);
        assert.equal(input.query,'合成');assert.equal(input.limit,2);assert.equal(input.cursor,null);
        input.signal.throwIfAborted();
        // This external authority's fixture contains only the allowed application/object page.
        // Same-name users in other scopes do not become equivalent bindings.
        return {schema_version:1,candidates:[{
          candidate_ref:'t18_synthetic_allowed_candidate_01',
          candidate_version:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          display_name:'合成成员甲',departments:['合成门诊'],profile_source:'THIRD_PARTY_STAFF_DIRECTORY',
          binding_verified:true,message_reachability:'REACHABLE',
        }],next_cursor:null,manual_fallback_available:true};
      },
      async verifyAuthorizedCandidate(){throw new Error('selection is outside this first GET slice');},
    },
  };
  await withWeb01Fixture(async({origin,cookies,principals}:Fixture)=>{
    assert.ok(principals[0]);authorizedPrincipalId=principals[0].id;
    assert.equal(typeof cookies[0],'string');assert.ok(cookies[0]);
    const bootstrap=await fetch(origin+'/api/lifecycle/bootstrap',{headers:{cookie:cookies[0]}});
    assert.equal(bootstrap.status,200);
    const response=await fetch(origin+'/api/workbench/reporter-candidates?q='+encodeURIComponent('合成')+'&limit=2',{headers:{cookie:cookies[0]}});
    assert.equal(response.status,200);
    const result:unknown=await response.json();
    assert.deepEqual(result,{schema_version:1,candidates:[{
      candidate_ref:'t18_synthetic_allowed_candidate_01',
      candidate_version:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      display_name:'合成成员甲',departments:['合成门诊'],profile_source:'THIRD_PARTY_STAFF_DIRECTORY',
      binding_verified:true,message_reachability:'REACHABLE',
    }],next_cursor:null,manual_fallback_available:true});
  },{workbenchManualReportsEnabled:true,workbenchReporterCandidatesEnabled:true,manualReporterDirectory:directory});
});
