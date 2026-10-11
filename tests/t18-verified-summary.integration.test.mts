import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {createT18Directory,applyT18ForwardCheck} from './helpers/t18-verified-fixture.mjs';
interface Fixture {origin:string;backendOrigin:string;cookies:string[];principals:{id:string}[];pool:PostgresPool}
function object(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function string(value:unknown):string{assert.equal(typeof value,'string');return value as string;}

test('authorized board and detail use the real retained reporter verification while a distinct hand-entered report remains unverified',async()=>{
  const source=createT18Directory();
  await withWeb01Fixture(async(fixture:Fixture)=>{
    const actor=fixture.principals[0];assert.ok(actor);source.setPrincipal(actor.id);await applyT18ForwardCheck(fixture.pool);
    const cookie=fixture.cookies[0];assert.ok(cookie);
    const read=async(path:string)=>{const response=await fetch(fixture.backendOrigin+path,{headers:{cookie}});assert.equal(response.status,200);return object(await response.json());};
    const token=string((await read('/api/lifecycle/bootstrap')).csrf_token);
    async function admit(verified:boolean){
      const command={schema_version:1,client_command_id:randomUUID(),source:'ON_SITE',description:'合成报修：情况暂不清楚',location:{text:null,unknown:true},
        reporter:verified?{verification:'VERIFIED_SELECTION',candidate_ref:source.candidate.candidate_ref,candidate_version:source.candidate.candidate_version}:{verification:'UNVERIFIED',name:'合成手填成员',contact:'合成内线100',department:null}};
      const response=await fetch(fixture.backendOrigin+'/api/workbench/reports',{method:'POST',headers:{cookie,origin:fixture.origin,'content-type':'application/json','x-csrf-token':token,'idempotency-key':command.client_command_id},body:JSON.stringify(command)});
      assert.equal(response.status,202);const result=object(await response.json());assert.equal(result.reporter_verification,verified?'VERIFIED':'UNVERIFIED');return string(object(result.review).id);
    }
    const verifiedId=await admit(true),manualId=await admit(false);
    const board=await read('/api/workbench/board?column=pending&limit=100');assert.ok(Array.isArray(board.items));
    const verifiedCard=object(board.items.find(value=>object(value).id===verifiedId)),manualCard=object(board.items.find(value=>object(value).id===manualId));
    assert.equal(verifiedCard.reporter_name,source.candidate.display_name+'（本次已核实）','verified admission must not be labeled as an unverified reporter');
    assert.equal(manualCard.reporter_name,'合成手填成员（身份未核实）');
    const verifiedDetail=await read('/api/workbench/items/review/'+verifiedId),manualDetail=await read('/api/workbench/items/review/'+manualId);
    assert.equal(object(verifiedDetail.item).reporter_name,verifiedCard.reporter_name);assert.equal(object(manualDetail.item).reporter_name,manualCard.reporter_name);
    assert.equal(object((await read('/api/manual-reviews/'+verifiedId)).manual_report).identity_source,'VERIFIED_DIRECTORY_SELECTION');
    assert.equal(source.calls.verify,1,'rendering summaries does not ask current Directory to replace the retained observation');
  },{workbenchManualReportsEnabled:true,workbenchReporterCandidatesEnabled:true,manualReporterDirectory:source.directory,workbenchManualReviewEnabled:true});
});
