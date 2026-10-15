import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createWorkbenchActivity,activityCommand,WORKBENCH_ACTIVITY_LIMITS} from '../src/workbench-activity.mjs';
import type {WorkbenchActivityTarget,WorkbenchActivityCommand,WorkbenchActivityField} from '../contracts/workbench_activity_contracts.js';
function fixture(){
  let now=100000;const denied=new Set<string>(),editingDenied=new Set<string>();
  const actor={principal_id:randomUUID(),csrf_token:'actor',session_id:randomUUID()},viewer={principal_id:randomUUID(),csrf_token:'viewer',session_id:randomUUID()};
  const service=createWorkbenchActivity({enabled:true,now:()=>now,authorize:async(auth,target,field)=>{
    if(!auth||typeof auth!=='object'||!('principal_id' in auth)||typeof auth.principal_id!=='string')throw Object.assign(new Error('denied'),{status:403});
    if(denied.has(auth.principal_id+':'+target.id)||field&&editingDenied.has(auth.principal_id))throw Object.assign(new Error('denied'),{status:404});
    return {principal_id:auth.principal_id,display_name:auth.principal_id===actor.principal_id?'林舟':'周衡',binding:auth.principal_id};
  }});
  const target:WorkbenchActivityTarget={kind:'ticket',id:randomUUID()},browser=randomUUID();
  const renew=(extra:Partial<{active:boolean;mode:'VIEWING'|'EDITING';field:WorkbenchActivityField|null}>={}):WorkbenchActivityCommand=>activityCommand({schema_version:1,browser_id:browser,action:'RENEW',target,visible:true,active:true,mode:'VIEWING',field:null,...extra});
  return {actor,viewer,target,browser,service,renew,denied,editingDenied,advance:(value:number)=>{now+=value;}};
}
test('activity expires after fifteen seconds and a heartbeat cannot reset sixty-second real activity',async()=>{
  const f=fixture();const receipt=await f.service.perform({authContext:f.actor,body:f.renew()});
  assert.equal(receipt.expires_epoch_ms,'115000');
  assert.equal((await f.service.view(f.viewer,f.target)).people.length,1);
  f.advance(15000);assert.deepEqual(await f.service.view(f.viewer,f.target),{schema_version:1,people:[]});
  await f.service.perform({authContext:f.actor,body:f.renew()});
  for(let i=0;i<11;i++){f.advance(5000);await f.service.perform({authContext:f.actor,body:f.renew({active:false})});}
  assert.equal((await f.service.view(f.viewer,f.target)).people.length,1);
  f.advance(5000);assert.equal((await f.service.perform({authContext:f.actor,body:f.renew({active:false})})).expires_epoch_ms,null);
  assert.deepEqual(await f.service.view(f.viewer,f.target),{schema_version:1,people:[]});f.service.close();
});
test('editing expires to viewing without trusted input and current reader/colleague denial removes disclosure',async()=>{
  const f=fixture();await f.service.perform({authContext:f.actor,body:f.renew({mode:'EDITING',field:'internal-note'})});
  assert.equal((await f.service.view(f.viewer,f.target)).people[0]?.mode,'EDITING');
  assert.deepEqual(await f.service.view(f.actor,f.target),{schema_version:1,people:[]});
  f.advance(10000);await f.service.perform({authContext:f.actor,body:f.renew({active:false,mode:'EDITING',field:'internal-note'})});
  assert.equal((await f.service.view(f.viewer,f.target)).people[0]?.mode,'VIEWING');
  f.denied.add(f.actor.principal_id+':'+f.target.id);assert.deepEqual(await f.service.view(f.viewer,f.target),{schema_version:1,people:[]});
  f.denied.add(f.viewer.principal_id+':'+f.target.id);await assert.rejects(f.service.view(f.viewer,f.target));f.service.close();
});
test('a browser owns at most two objects, four browser identities per principal, releases cannot erase another authentication',async()=>{
  const f=fixture();const targets=[f.target,{kind:'ticket' as const,id:randomUUID()},{kind:'ticket' as const,id:randomUUID()}];
  assert.ok(targets[2]);
  for(const target of targets.slice(0,2))await f.service.perform({authContext:f.actor,body:{...f.renew(),target}});
  await assert.rejects(f.service.perform({authContext:f.actor,body:{...f.renew(),target:targets[2]}}));
  for(let i=0;i<3;i++)await f.service.perform({authContext:f.actor,body:{...f.renew(),browser_id:randomUUID()}});
  await assert.rejects(f.service.perform({authContext:f.actor,body:{...f.renew(),browser_id:randomUUID()}}));
  await f.service.perform({authContext:f.viewer,body:{schema_version:1,browser_id:f.browser,action:'RELEASE_BROWSER'}});
  assert.equal((await f.service.view(f.viewer,f.target)).people.length,1);
  f.service.releaseAuthentication(f.actor);assert.deepEqual(await f.service.view(f.viewer,f.target),{schema_version:1,people:[]});f.service.close();
});
test('closed activity commands reject invented identity, hidden renewal, unlisted fields and noncanonical data',()=>{
  const f=fixture();assert.equal(WORKBENCH_ACTIVITY_LIMITS.max_browsers,64);assert.equal(WORKBENCH_ACTIVITY_LIMITS.max_leases,128);assert.equal(WORKBENCH_ACTIVITY_LIMITS.max_leases_per_object,16);
  for(const extra of [{principal_id:randomUUID()},{visible:false},{mode:'EDITING',field:'external-reply'},{mode:'VIEWING',field:'internal-note'},{active:'true'}])assert.throws(()=>activityCommand({...f.renew(),...extra}));
  f.service.close();
});
