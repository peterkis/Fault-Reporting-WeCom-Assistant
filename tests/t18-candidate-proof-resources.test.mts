// SOURCE_NOT_RUN. Public configured Directory Port and verification fences only;
// no database, network, browser, private limiter state or response replacement.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {createWorkbenchReporterCandidates} from '../app/server/src/workbench-reporter-candidates.mjs';
import {WorkbenchError} from '../app/server/src/p2-006-workbench-query.mjs';
import {formatEpochMsToShanghaiLocal} from '../app/server/src/platform/time-contract.mjs';
import {createT18Directory} from './helpers/t18-verified-fixture.mjs';
import type {ManualReporterDirectoryOptions,ManualReporterSelection,ManualReporterSearch,WorkbenchReporterCandidate} from '../contracts/workbench_reporter_candidates_contracts.js';

function isObject(value:unknown):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function object(value:unknown):Record<string,unknown>{if(!isObject(value))assert.fail('object required');return value;}
const failure=(status:number,code:string)=>(error:unknown)=>error instanceof WorkbenchError&&error.status===status&&error.code===code;
const unavailable=failure(503,'P2_016_ACTION_FAILED'),conflict=failure(409,'P2_016_VERSION_CONFLICT');
const principal=randomUUID(),otherPrincipal=randomUUID(),query=()=>new URLSearchParams({q:'合成',limit:'2'});
function selection(candidate:WorkbenchReporterCandidate):ManualReporterSelection{return {verification:'VERIFIED_SELECTION',candidate_ref:candidate.candidate_ref,candidate_version:candidate.candidate_version};}
function emptyPage(){return {schema_version:1,candidates:[],next_cursor:null,manual_fallback_available:true};}
function searchService(search:ManualReporterDirectoryOptions['port']['searchAuthorizedCandidates']){
  const fixture=createT18Directory();return createWorkbenchReporterCandidates({enabled:true,directory:{...fixture.directory,port:{...fixture.directory.port,searchAuthorizedCandidates:search}}});
}
function proofService(directory:ManualReporterDirectoryOptions,raw:unknown){
  return createWorkbenchReporterCandidates({enabled:true,directory:{...directory,port:{...directory.port,verifyAuthorizedCandidate:async()=>raw}}});
}
function clockFields(value:Record<string,unknown>,name:string,milliseconds:number){value[name]=formatEpochMsToShanghaiLocal(String(milliseconds));value[name+'_epoch_ms']=String(milliseconds);}

// Each response mutation is an untrusted Port result, not a replacement authority
// implementation. Fresh public instances keep rate exhaustion from masking fences.
test('verification binds the configured application, current actor, explicit selection and pinned mapped identity',async()=>{
  const fixture=createT18Directory();fixture.setPrincipal(principal);const selected=selection(fixture.candidate),service=createWorkbenchReporterCandidates({enabled:true,directory:fixture.directory});
  const approved=await service.verify(principal,selected,null);assert.equal(approved.purpose,'ADMISSION');assert.ok(approved.purpose==='ADMISSION');
  assert.equal(service.fence(principal,selected,approved,null).actor_principal_id,principal);
  const cases:{name:string;change:(value:Record<string,unknown>)=>void;expected?:(error:unknown)=>boolean}[]=[
    {name:'other application',change:value=>{object(value.application).sourceAppScope='another-app';}},
    {name:'other directory scope',change:value=>{value.directory_source_scope='ANOTHER_DIRECTORY';}},
    {name:'other actor',change:value=>{value.actor_principal_id=otherPrincipal;}},
    {name:'another candidate reference',change:value=>{object(value.selection).candidate_ref='other_synthetic_candidate_ref_00001';}},
    {name:'another selected version',change:value=>{object(value.selection).candidate_version='d'.repeat(64);}},
    {name:'mapping configuration changed',change:value=>{object(value.proof).mapping_config_hash='e'.repeat(64);}},
    {name:'mapping proof pin changed',change:value=>{object(object(value.proof).scope).proofRef='ANOTHER_MAPPING_PROOF';}},
    {name:'mapped target crosses application',change:value=>{object(object(value.proof).scope).sourceCorpScope='another-corp';}},
    {name:'reachability refers to another identity',change:value=>{object(object(value.proof).reachability).target_scope_hash='f'.repeat(64);}},
    {name:'producer proof kind differs from configuration',change:value=>{object(value.proof).proof_kind='LIVE';}},
    {name:'inactive member binding',change:value=>{object(value.proof).account_status='INACTIVE';},expected:conflict},
    {name:'unverified member binding',change:value=>{object(value.proof).binding_state='UNVERIFIED';},expected:conflict},
    {name:'changed original profile without selected version',change:value=>{object(object(value.proof).profile_at_report).display_name='目录后续改名';},expected:conflict},
    {name:'object not allowed',change:value=>{value.object_access='DENIED';}},
    {name:'private extra envelope field',change:value=>{value.raw_member_id='must-not-enter-public-proof';}},
  ];
  for(const scenario of cases){const raw=object(structuredClone(approved));scenario.change(raw);
    await assert.rejects(proofService(fixture.directory,raw).verify(principal,selected,null),scenario.expected??unavailable,scenario.name);}
  const pin=fixture.directory.verificationAuthority;assert.ok(pin);
  await assert.rejects(proofService({...fixture.directory,verificationAuthority:{...pin,mappingConfigHash:'b'.repeat(64)}},approved).verify(principal,selected,null),unavailable,'new configuration cannot approve an old proof');
  await assert.rejects(proofService({...fixture.directory,verificationAuthority:{...pin,validationProfile:'DEPLOYMENT'}},approved).verify(principal,selected,null),unavailable,'synthetic authority must not become deployment authority');
  assert.throws(()=>service.fence(otherPrincipal,selected,approved,null),unavailable,'fence must repeat current actor authorization');
});

test('proof time fences and READ_COMMITTED require a fresh authorization for the retained original target',async context=>{
  const now=1_790_000_000_000;context.mock.timers.enable({apis:['Date'],now});
  try{
    const fixture=createT18Directory();fixture.setPrincipal(principal);const selected=selection(fixture.candidate),service=createWorkbenchReporterCandidates({enabled:true,directory:fixture.directory});
    const approved=await service.verify(principal,selected,null);assert.ok(approved.purpose==='ADMISSION');
    const clocks:{name:string;change:(value:Record<string,unknown>)=>void}[]=[
      {name:'future authorization',change:value=>clockFields(value,'authorized_at',now+1)},
      {name:'expired authorization',change:value=>clockFields(value,'valid_until',now)},
      {name:'more than five minutes of validity',change:value=>clockFields(value,'valid_until',now+300_001)},
      {name:'Shanghai label disagrees with physical epoch',change:value=>{value.authorized_at='2000-01-01 00:00:00';}},
      {name:'verification time differs from authorization',change:value=>clockFields(object(value.proof),'verified_at',now-1)},
      {name:'stale reachability observation',change:value=>clockFields(object(object(value.proof).reachability),'checked_at',now-300_001)},
    ];
    for(const scenario of clocks){const raw=object(structuredClone(approved));scenario.change(raw);await assert.rejects(proofService(fixture.directory,raw).verify(principal,selected,null),unavailable,scenario.name);}
    const target=approved.proof.scope,{proof:_proof,...base}=approved,read={...base,purpose:'READ_COMMITTED',target_scope:target};
    const readable=await proofService(fixture.directory,read).verify(principal,selected,target);assert.equal(readable.purpose,'READ_COMMITTED');
    assert.equal(service.fence(principal,selected,readable,target).purpose,'READ_COMMITTED');
    const wrongTarget={...read,target_scope:{...target,scopeHash:'a'.repeat(64)}};
    await assert.rejects(proofService(fixture.directory,wrongTarget).verify(principal,selected,target),unavailable,'read proof cannot replace the retained target');
    await assert.rejects(proofService(fixture.directory,approved).verify(principal,selected,target),unavailable,'new admission proof is not retained-object read authorization');
    context.mock.timers.setTime(now+300_000);
    assert.throws(()=>service.fence(principal,selected,approved,null),unavailable,'proof accepted earlier must expire before commit fence');
    assert.throws(()=>service.fence(principal,selected,readable,target),unavailable,'retained-object read authority also expires');
  }finally{context.mock.timers.reset();}
});

test('candidate search preserves authorized cursor delegation and rejects unbounded query or unsafe pages',async()=>{
  const fixture=createT18Directory(),candidate=fixture.candidate,seen:ManualReporterSearch[]=[];
  const cursor='T18_OPAQUE_AUTHORIZED_PAGE_2';
  const paged=searchService(async input=>{
    seen.push(input);assert.equal(input.application.sourceAppScope,fixture.directory.application.sourceAppScope);assert.equal(input.directory_source_scope,fixture.directory.directorySourceScope);
    // Cursor scope belongs to this configured external Port. This checks the host
    // forwards the binding and preserves refusal, not a new production cursor codec.
    if(input.principal_id!==principal||input.query!=='合成'||input.limit!==2)throw new WorkbenchError('P2_016_FORBIDDEN',403);
    if(input.cursor!==null&&input.cursor!==cursor)throw new WorkbenchError('P2_016_CURSOR_INVALID',400);
    return {schema_version:1,candidates:[{...candidate,display_name:input.cursor?'合成成员乙':candidate.display_name}],next_cursor:input.cursor?null:cursor,manual_fallback_available:true};
  });
  const first=await paged.search(principal,new URLSearchParams({q:' 合成 ',limit:'2'}));assert.equal(first.next_cursor,cursor);assert.equal(first.candidates[0]?.display_name,'合成成员甲');
  const second=await paged.search(principal,new URLSearchParams({q:'合成',limit:'2',cursor}));assert.equal(second.next_cursor,null);assert.equal(second.candidates[0]?.display_name,'合成成员乙');
  assert.deepEqual(seen.slice(0,2).map(input=>({principal:input.principal_id,query:input.query,limit:input.limit,cursor:input.cursor})),[
    {principal,query:'合成',limit:2,cursor:null},{principal,query:'合成',limit:2,cursor}]);
  await assert.rejects(paged.search(otherPrincipal,new URLSearchParams({q:'合成',limit:'2',cursor})),failure(403,'P2_016_FORBIDDEN'));
  await assert.rejects(paged.search(principal,new URLSearchParams({q:'回访',limit:'2',cursor})),failure(403,'P2_016_FORBIDDEN'));
  await assert.rejects(paged.search(principal,new URLSearchParams({q:'合成',limit:'2',cursor:'OTHER_CURSOR'})),failure(400,'P2_016_CURSOR_INVALID'));
  const beforeInvalid=seen.length;
  for(const input of ['q=x','q=a%00b','q=%E5%90%88%E6%88%90&q=other','q=ab&actor=other','q=ab&limit=0','q=ab&limit=21','q=ab&cursor=%2F']){
    await assert.rejects(paged.search(principal,new URLSearchParams(input)),error=>error instanceof WorkbenchError&&error.status===400,input);
  }
  assert.equal(seen.length,beforeInvalid,'invalid query must not consume Directory work');
  const candidates=Array.from({length:20},(_,index)=>({...candidate,candidate_ref:candidate.candidate_ref+'_'+index,display_name:'合成成员'+index}));
  const maximum=await searchService(async()=>({schema_version:1,candidates,next_cursor:null,manual_fallback_available:true})).search(principal,new URLSearchParams({q:'合成',limit:'20'}));assert.equal(maximum.candidates.length,20);
  const large=candidates.slice(0,4).map(row=>({...row,departments:Array.from({length:20},(_,index)=>String(index)+'科'.repeat(90))}));
  const oversized={schema_version:1,candidates:large,next_cursor:null,manual_fallback_available:true};assert.ok(Buffer.byteLength(JSON.stringify(oversized),'utf8')>16_384);
  const badPages:[string,unknown][]=[
    ['more candidates than requested',{schema_version:1,candidates:[candidate,candidate,candidate],next_cursor:null,manual_fallback_available:true}],
    ['private fields',{schema_version:1,candidates:[{...candidate,raw_member_id:'PRIVATE'}],next_cursor:null,manual_fallback_available:true}],
    ['unverified binding',{schema_version:1,candidates:[{...candidate,binding_verified:false}],next_cursor:null,manual_fallback_available:true}],
    ['duplicate department labels',{schema_version:1,candidates:[{...candidate,departments:['科室','科室']}],next_cursor:null,manual_fallback_available:true}],
    ['16 KiB page budget',oversized],
  ];
  for(const [name,page] of badPages){const limit=name==='16 KiB page budget'?'20':'2';await assert.rejects(searchService(async()=>page).search(principal,new URLSearchParams({q:'合成',limit})),unavailable,name);}
});

test('two-second deadline aborts a slow Directory operation and retains single-flight fencing until an ignored abort actually settles',{timeout:15000},async()=>{
  const observed:{finish?:(value:unknown)=>void;entered?:()=>void;signal?:AbortSignal}={};let calls=0;
  const pending=new Promise<unknown>(resolve=>{observed.finish=resolve;}),started=new Promise<void>(resolve=>{observed.entered=resolve;});
  const service=searchService(input=>{calls++;if(calls!==1)return Promise.resolve(emptyPage());observed.signal=input.signal;observed.entered?.();return pending;});
  const begin=performance.now(),rejected=assert.rejects(service.search(principal,query()),unavailable);
  try{
    await started;await assert.rejects(service.search(otherPrincipal,query()),unavailable);assert.equal(calls,1);
    await rejected;const elapsed=performance.now()-begin;assert.ok(elapsed>=1800&&elapsed<10000,'actual two-second deadline must release the caller within a bounded margin');
    assert.ok(observed.signal);assert.equal(observed.signal.aborted,true);
    await assert.rejects(service.search(otherPrincipal,query()),unavailable);assert.equal(calls,1,'ignoring abort must not open another external operation');
    observed.finish?.(emptyPage());await pending;await new Promise<void>(resolve=>setImmediate(resolve));
    assert.equal((await service.search(otherPrincipal,query())).candidates.length,0);assert.equal(calls,2,'a settled adapter must release the single-flight slot');
  }finally{observed.finish?.(emptyPage());await pending;await rejected;}
});

test('public search limits each principal to ten attempts per minute and bounds active rate buckets to 128 principals',async context=>{
  const now=1_790_000_000_000;context.mock.timers.enable({apis:['Date'],now});
  try{
    let calls=0;const service=searchService(async()=>{calls++;return emptyPage();});
    for(let attempt=0;attempt<10;attempt++)await service.search(principal,query());
    await assert.rejects(service.search(principal,query()),unavailable);assert.equal(calls,10);
    context.mock.timers.setTime(now+59_999);await assert.rejects(service.search(principal,query()),unavailable);assert.equal(calls,10);
    context.mock.timers.setTime(now+60_000);await service.search(principal,query());assert.equal(calls,11);
    let boundedCalls=0;const bounded=searchService(async()=>{boundedCalls++;return emptyPage();});
    const identities=Array.from({length:129},()=>randomUUID());for(const id of identities.slice(0,128))await bounded.search(id,query());
    const last=identities[128];assert.ok(last);await assert.rejects(bounded.search(last,query()),unavailable);assert.equal(boundedCalls,128);
    context.mock.timers.setTime(now+120_000);await bounded.search(last,query());assert.equal(boundedCalls,129,'expired buckets must release bounded capacity');
  }finally{context.mock.timers.reset();}
});
