import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {createWorkbenchActivity,activityBatchRequest} from '../app/server/src/workbench-activity.mjs';
import type {WorkbenchActivityTarget,WorkbenchActivityCommand,WorkbenchActivityField} from '../contracts/workbench_activity_contracts.js';
import {assertP2016Schema} from './helpers/p2-016-schema-assert.mjs';

// ADR-0057 card 30A: person field/order, batch view, global presence version and service-level A5 measurement.
interface Auth {principal_id:string;csrf_token:string;session_id:string;name:string}
function fixture(){
  let now=100000,calls=0;const denied=new Set<string>(),forbidden=new Set<string>();let hook:((principal:string,target:WorkbenchActivityTarget)=>void)|null=null;
  const service=createWorkbenchActivity({enabled:true,now:()=>now,authorize:async(auth,target)=>{
    calls++;
    if(!auth||typeof auth!=='object'||!('principal_id' in auth)||typeof auth.principal_id!=='string'||!('name' in auth)||typeof auth.name!=='string')throw Object.assign(new Error('denied'),{status:403});
    hook?.(auth.principal_id,target);
    if(forbidden.has(auth.principal_id))throw Object.assign(new Error('session revoked'),{status:403});
    if(denied.has(auth.principal_id+':'+target.id))throw Object.assign(new Error('denied'),{status:404});
    return {principal_id:auth.principal_id,display_name:auth.name,binding:auth.principal_id+':'+String('csrf_token' in auth?auth.csrf_token:'')};
  }});
  const person=(name:string):Auth=>({principal_id:randomUUID(),csrf_token:randomUUID(),session_id:randomUUID(),name});
  const target=():WorkbenchActivityTarget=>({kind:'ticket',id:randomUUID()});
  const renew=(item:WorkbenchActivityTarget,browser=randomUUID(),extra:{active?:boolean;mode?:'VIEWING'|'EDITING';field?:WorkbenchActivityField|null}={}):WorkbenchActivityCommand=>
    extra.mode==='EDITING'&&extra.field?{schema_version:1,browser_id:browser,action:'RENEW',target:item,visible:true,active:extra.active??true,mode:'EDITING',field:extra.field}
      :{schema_version:1,browser_id:browser,action:'RENEW',target:item,visible:true,active:extra.active??true,mode:'VIEWING',field:null};
  return {service,person,target,renew,denied,forbidden,onAuthorize:(next:typeof hook)=>{hook=next;},calls:()=>calls,resetCalls:()=>{calls=0;},advance:(ms:number)=>{now+=ms;}};
}
const batch=(targets:unknown[])=>({schema_version:1,targets});
const p95=(samples:number[])=>{const sorted=[...samples].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*0.95)-1)]??0;};

test('A1 people carry the most recently edited field, editors first then display name, in single and batch views',async t=>{
  const f=fixture();t.after(()=>f.service.close());
  const item=f.target(),viewer=f.person('观察者'),viewing=f.person('甲查看'),editing=f.person('沈然'),second=f.person('周宁');
  await f.service.perform({authContext:viewing,body:f.renew(item)});
  const first=randomUUID(),other=randomUUID();
  await f.service.perform({authContext:editing,body:f.renew(item,first,{mode:'EDITING',field:'internal-note'})});
  f.advance(1000);
  await f.service.perform({authContext:editing,body:f.renew(item,other,{mode:'EDITING',field:'ticket-completion'})});
  await f.service.perform({authContext:second,body:f.renew(item,randomUUID(),{mode:'EDITING',field:'manual-review'})});
  const single=await f.service.view(viewer,item);
  await assertP2016Schema('workbench_activity_view',single);
  assert.deepEqual(single.people.map(p=>[p.display_name,p.mode,p.field]),[
    ['沈然','EDITING','ticket-completion'],['周宁','EDITING','manual-review'],['甲查看','VIEWING',null]].sort((a,b)=>a[0]===b[0]?0:(a[1]===b[1]?String(a[0]).localeCompare(String(b[0])):a[1]==='EDITING'?-1:1)));
  assert.equal(single.people[2]?.display_name,'甲查看','viewers follow every editor');
  assert.deepEqual(Object.keys(single.people[0]??{}),['display_name','mode','field','expires_epoch_ms'],'no internal identifiers are exposed');
  const result=await f.service.batchView(viewer,batch([item]));
  await assertP2016Schema('workbench_activity_batch_view',result);
  assert.deepEqual(result,{schema_version:1,items:[{kind:'ticket',id:item.id,people:single.people}]},'batch and single views share one person structure');
  // Editing that idles beyond ten seconds degrades to VIEWING with a null field.
  f.advance(10000);
  assert.ok((await f.service.view(viewer,item)).people.every(p=>p.mode==='VIEWING'&&p.field===null));
});

test('A2 batch view validates 1..100 targets, collapses duplicates and skips empty targets without any authorization call',async t=>{
  const f=fixture();t.after(()=>f.service.close());
  const viewer=f.person('观察者'),actor=f.person('林舟'),occupied=f.target(),hidden=f.target(),empty=f.target();
  for(const body of [batch([]),batch(Array.from({length:101},()=>f.target())),{schema_version:2,targets:[occupied]},{schema_version:1,targets:[occupied],extra:true},
    batch([{kind:'board',id:randomUUID()}]),batch([{kind:'ticket',id:'not-a-uuid'}]),batch([{kind:'ticket',id:randomUUID(),principal_id:randomUUID()}]),{schema_version:1,targets:'all'}])
    await assert.rejects(f.service.batchView(viewer,body),{status:400});
  assert.equal(activityBatchRequest(batch(Array.from({length:100},()=>f.target()))).length,100,'exactly one hundred targets are accepted');
  assert.deepEqual(activityBatchRequest(batch([occupied,{kind:'ticket',id:occupied.id.toUpperCase()},occupied,empty])),[occupied,empty],'duplicates collapse in request order');
  assert.equal(f.calls(),0,'input validation needs no authorization');
  // All empty: zero authorization calls, empty result.
  assert.deepEqual(await f.service.batchView(viewer,batch([empty,f.target()])),{schema_version:1,items:[]});
  assert.equal(f.calls(),0);
  // Own leases only: still no authorization; the viewer never sees self.
  await f.service.perform({authContext:viewer,body:f.renew(empty)});f.resetCalls();
  assert.deepEqual(await f.service.batchView(viewer,batch([empty])),{schema_version:1,items:[]});
  assert.equal(f.calls(),0,'a target holding only the viewer\'s own lease is skipped before authorization');
  await f.service.perform({authContext:actor,body:f.renew(occupied)});
  await f.service.perform({authContext:actor,body:f.renew(hidden)});
  f.denied.add(viewer.principal_id+':'+hidden.id);f.resetCalls();
  const result=await f.service.batchView(viewer,batch([hidden,empty,occupied,occupied,f.target()]));
  assert.deepEqual(result.items.map(item=>[item.kind,item.id,item.people.map(p=>p.display_name)]),[['ticket',occupied.id,['林舟']]],'a denied target is skipped without failing the request; empty ones are omitted');
  // hidden: viewer authority denied once; occupied: viewer + colleague + fence = 3. Empty and unknown targets cost nothing.
  assert.equal(f.calls(),4);
  await assertP2016Schema('workbench_activity_batch_view',result);
  await assertP2016Schema('workbench_activity_batch_view_request',batch([occupied]));
  // A non-authority failure still fails closed for the whole request.
  const broken=createWorkbenchActivity({enabled:true,now:()=>100000,authorize:async auth=>{if(auth===viewer)throw new Error('storage');return {principal_id:actor.principal_id,display_name:'林舟',binding:'b'};}});
  await broken.perform({authContext:actor,body:f.renew(occupied)});
  await assert.rejects(broken.batchView(viewer,batch([occupied])),/storage/u);broken.close();
  const disabled=createWorkbenchActivity({enabled:false,authorize:async()=>{throw new Error('unused');}});
  await assert.rejects(disabled.batchView(viewer,batch([occupied])),{status:503});
});

test('A3 presence version changes every connection signature on any presence change, but not on a plain heartbeat',async t=>{
  const f=fixture();t.after(()=>f.service.close());
  const watcher=f.person('看板'),actor=f.person('林舟'),item=f.target(),browser=randomUUID();
  const signature=()=>f.service.signature(watcher);
  const steps:[string,()=>Promise<unknown>|unknown,boolean][]=[
    ['new lease on an object the watcher never opened',()=>f.service.perform({authContext:actor,body:f.renew(item,browser)}),true],
    ['plain heartbeat',()=>{f.advance(5000);return f.service.perform({authContext:actor,body:f.renew(item,browser,{active:false})});},false],
    ['viewing to editing',()=>f.service.perform({authContext:actor,body:f.renew(item,browser,{mode:'EDITING',field:'internal-note'})}),true],
    ['editing heartbeat within ten seconds',()=>{f.advance(1000);return f.service.perform({authContext:actor,body:f.renew(item,browser,{active:false,mode:'EDITING',field:'internal-note'})});},false],
    ['edited field changes',()=>f.service.perform({authContext:actor,body:f.renew(item,browser,{mode:'EDITING',field:'ticket-handling'})}),true],
    ['editing idles back to viewing',()=>{f.advance(10000);return f.service.perform({authContext:actor,body:f.renew(item,browser,{active:false,mode:'EDITING',field:'ticket-handling'})});},true],
    ['lease expiry is cleaned',()=>{f.advance(15000);},true],
    ['renewed again',()=>f.service.perform({authContext:actor,body:f.renew(item,browser)}),true],
    ['authentication release',()=>f.service.releaseAuthentication(actor),true],
  ];
  let previous=await signature();assert.match(previous??'',/^\d+#$/u,'the watcher has no own objects; only the version is signed');
  for(const [name,step,changes] of steps){
    await step();const next=await signature();
    if(changes)assert.notEqual(next,previous,name+' must change the signature');else assert.equal(next,previous,name+' must not change the signature');
    previous=next;
  }
});

test('A5 service worst case: 128 leases on 64 targets, a 100-target batch with 0 and 64 occupied targets',async t=>{
  const f=fixture();t.after(()=>f.service.close());
  const targets=Array.from({length:64},()=>f.target()),viewer=f.person('看板观察者');
  for(let principal=0;principal<16;principal++){
    const auth=f.person('同事'+String(principal).padStart(2,'0'));
    for(let browser=0;browser<4;browser++){
      const id=randomUUID();
      for(let object=0;object<2;object++){const index=principal*8+browser*2+object;const item=targets[index%64];assert.ok(item);await f.service.perform({authContext:auth,body:f.renew(item,id)});}
    }
  }
  const empty=batch(Array.from({length:100},()=>f.target())),mixed=batch([...targets,...Array.from({length:36},()=>f.target())]);
  const measure=async(body:unknown,rounds:number)=>{const samples:number[]=[];let calls=0,items=0;for(let i=0;i<rounds;i++){f.resetCalls();const started=performance.now();const result=await f.service.batchView(viewer,body);samples.push(performance.now()-started);calls=f.calls();items=result.items.length;}return {p95:p95(samples),calls,items};};
  await measure(mixed,5);// warm-up
  const zero=await measure(empty,200),full=await measure(mixed,50);
  t.diagnostic(`A5 service zero-occupied: p95=${zero.p95.toFixed(3)}ms authorize_calls=${zero.calls} items=${zero.items}`);
  t.diagnostic(`A5 service 64-occupied (in-memory authorize): p95=${full.p95.toFixed(3)}ms authorize_calls=${full.calls} items=${full.items}`);
  assert.equal(zero.calls,0);assert.equal(zero.items,0);assert.ok(zero.p95<5,'zero occupied p95 '+zero.p95);
  assert.equal(full.items,64);
  // Per occupied target: viewer authority + fence + one per colleague lease (2) = 4; 64 targets → 256,
  // plus the final batch fence for every returned item except the last-fenced one (63) → 319.
  assert.equal(full.calls,319);
  assert.ok(full.p95<100,'64 occupied in-memory p95 '+full.p95);
});

test('review P1: a revocation detected while a later target is authorized cannot return earlier projections',async t=>{
  const f=fixture();t.after(()=>f.service.close());
  const viewer=f.person('观察者'),actor=f.person('林舟'),first=f.target(),second=f.target(),third=f.target();
  for(const item of [first,second])await f.service.perform({authContext:actor,body:f.renew(item)});
  await f.service.perform({authContext:actor,body:f.renew(third)});
  // Session-wide revocation while the second target is being read: the whole batch fails closed.
  f.onAuthorize((principal,target)=>{if(principal===viewer.principal_id&&target.id===second.id)f.forbidden.add(viewer.principal_id);});
  await assert.rejects(f.service.batchView(viewer,batch([first,second,third])),{status:403});
  f.forbidden.clear();f.onAuthorize(null);
  // Item-level loss of READ on the first target while the second is read: first is dropped, second kept.
  f.onAuthorize((principal,target)=>{if(principal===viewer.principal_id&&target.id===second.id)f.denied.add(viewer.principal_id+':'+first.id);});
  const result=await f.service.batchView(viewer,batch([first,second]));
  assert.deepEqual(result.items.map(item=>item.id),[second.id]);
  f.onAuthorize(null);
});

test('review P2: a newer edit in another tab of the same person changes the version, a plain heartbeat does not',async t=>{
  const f=fixture();t.after(()=>f.service.close());
  const watcher=f.person('看板'),viewer=f.person('观察者'),actor=f.person('林舟'),item=f.target(),tabA=randomUUID(),tabB=randomUUID();
  await f.service.perform({authContext:actor,body:f.renew(item,tabA,{mode:'EDITING',field:'internal-note'})});
  f.advance(1000);
  await f.service.perform({authContext:actor,body:f.renew(item,tabB,{mode:'EDITING',field:'ticket-completion'})});
  assert.equal((await f.service.view(viewer,item)).people[0]?.field,'ticket-completion');
  const before=await f.service.signature(watcher);
  f.advance(1000);
  await f.service.perform({authContext:actor,body:f.renew(item,tabA,{mode:'EDITING',field:'internal-note'})});
  assert.equal((await f.service.view(viewer,item)).people[0]?.field,'internal-note','tab A is now the most recent edit');
  const after=await f.service.signature(watcher);
  assert.notEqual(after,before,'the merged field change must reach board-only watchers');
  f.advance(1000);
  await f.service.perform({authContext:actor,body:f.renew(item,tabB,{active:false,mode:'EDITING',field:'ticket-completion'})});
  assert.equal(await f.service.signature(watcher),after,'an inactive heartbeat neither changes the winner nor the version');
});

test('review P2b: editing that idles out without a renewal changes the version before the lease expires',async t=>{
  const f=fixture();t.after(()=>f.service.close());
  const watcher=f.person('看板'),viewer=f.person('观察者'),actor=f.person('林舟'),item=f.target();
  await f.service.perform({authContext:actor,body:f.renew(item,randomUUID(),{mode:'EDITING',field:'internal-note'})});
  const before=await f.service.signature(watcher);
  f.advance(9999);
  assert.equal(await f.service.signature(watcher),before,'still editing inside the ten-second window');
  f.advance(1);
  const after=await f.service.signature(watcher);
  assert.notEqual(after,before,'the idle transition reaches board-only watchers without any renewal');
  assert.deepEqual((await f.service.view(viewer,item)).people.map(p=>[p.mode,p.field]),[['VIEWING',null]],'the lease is still live and now shown as viewing');
  assert.equal(await f.service.signature(watcher),after,'the transition is counted once');
});
