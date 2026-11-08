import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {createWorkbenchActivity,WORKBENCH_ONLINE_MAX_PEOPLE} from '../app/server/src/workbench-activity.mjs';
import type {WorkbenchActivityTarget} from '../contracts/workbench_activity_contracts.js';
import {assertP2016Schema} from './helpers/p2-016-schema-assert.mjs';

// Card 31 S2/S4: the online read is O(online accounts + leases), makes no per-item authorization call, never names a ticket.
function fixture(){
  let clock=100000,authorizations=0;const names=new Map<string,string>();
  const activity=createWorkbenchActivity({enabled:true,now:()=>clock,authorize:async auth=>{
    authorizations++;assert.ok(auth&&typeof auth==='object'&&'principal_id'in auth&&typeof auth.principal_id==='string');
    return {principal_id:auth.principal_id,display_name:names.get(auth.principal_id)??'同事',binding:auth.principal_id};
  }});
  return {activity,names,authorizations:()=>authorizations,advance:(ms:number)=>{clock+=ms;}};
}
const auth=(principal_id:string)=>({principal_id,csrf_token:randomUUID(),session_id:randomUUID()});
const target=():WorkbenchActivityTarget=>({kind:'ticket',id:randomUUID()});

test('Card 31 online read: 64 online accounts and 128 leases, no per-item authorization, p95 under 10ms, status priority and order',async t=>{
  const {activity,names,authorizations}=fixture();t.after(()=>activity.close());
  const self=randomUUID(),people=Array.from({length:64},(_,index)=>({principal_id:randomUUID(),display_name:'同事'+String(index).padStart(2,'0')+'（合成）'}));
  for(const person of people)names.set(person.principal_id,person.display_name);
  const online=people.map(person=>person.principal_id).concat(self);
  // 16 accounts hold 8 leases each (4 browsers × 2 objects) = 128 leases.
  for(const person of people.slice(0,16)){
    const context=auth(person.principal_id);
    for(let tab=0;tab<4;tab++){const browser=randomUUID();for(let object=0;object<2;object++)await activity.perform({authContext:context,body:{schema_version:1,browser_id:browser,action:'RENEW',target:target(),visible:true,active:true,mode:'VIEWING',field:null}});}
  }
  let resolves=0;
  activity.setOnline({principals:()=>online,resolve:async(_context,ids)=>{resolves++;return {self,visible:ids.filter(id=>id!==self).map(id=>({principal_id:id,display_name:names.get(id)??''}))};}});
  const before=authorizations(),samples:number[]=[];let view=await activity.online(auth(self));
  for(let index=0;index<200;index++){const start=performance.now();view=await activity.online(auth(self));samples.push(performance.now()-start);}
  samples.sort((a,b)=>a-b);const p95=samples[Math.floor(samples.length*0.95)]??Infinity;
  console.log('CARD31_ONLINE_PERF '+JSON.stringify({online:online.length,leases:128,p95_ms:Number(p95.toFixed(3)),max_ms:Number((samples.at(-1)??0).toFixed(3)),authorizations:authorizations()-before,resolves}));
  assert.equal(authorizations()-before,0,'the online read never authorizes per item');assert.ok(p95<10,'p95 '+p95);
  await assertP2016Schema('workbench_online_view',view);
  assert.equal(view.total,64);assert.equal(view.people.length,WORKBENCH_ONLINE_MAX_PEOPLE);assert.ok(view.people.every(person=>Object.keys(person).join()==='display_name,status'));
  assert.ok(view.people.slice(0,16).every(person=>person.status==='VIEWING'),'viewers before plain online');assert.ok(view.people.slice(16).every(person=>person.status==='ONLINE'));
  assert.ok(!JSON.stringify(view).includes(self),'never the requester or any identifier');
});

test('Card 31 status: editing beats viewing beats online; the requester is excluded; an online-set change bumps the presence version',async t=>{
  const {activity,names}=fixture();t.after(()=>activity.close());
  const self=randomUUID(),editor=randomUUID(),viewer=randomUUID(),idle=randomUUID();
  names.set(editor,'周宁');names.set(viewer,'沈然');names.set(idle,'陈悦');names.set(self,'林舟');
  for(const [id,mode] of [[editor,'VIEWING'],[editor,'EDITING'],[viewer,'VIEWING']] as const)
    await activity.perform({authContext:auth(id),body:{schema_version:1,browser_id:randomUUID(),action:'RENEW',target:target(),visible:true,active:true,mode,field:mode==='EDITING'?'internal-note':null}});
  let online=[self,editor,viewer];
  activity.setOnline({principals:()=>online,resolve:async(_context,ids)=>({self,visible:ids.map(id=>({principal_id:id,display_name:names.get(id)??''}))})});
  assert.deepEqual((await activity.online(auth(self))).people,[{display_name:'周宁',status:'EDITING'},{display_name:'沈然',status:'VIEWING'}]);
  const signature=await activity.signature(auth(self));
  online=[self,editor,viewer,idle];activity.onlineChanged();
  const next=await activity.signature(auth(self));assert.notEqual(next,signature,'joining bumps the version');
  assert.deepEqual((await activity.online(auth(self))).people.at(-1),{display_name:'陈悦',status:'ONLINE'});
  assert.equal(await activity.signature(auth(self)),next,'an unchanged online set does not bump again');
  online=[self,editor,viewer];assert.notEqual(await activity.signature(auth(self)),next,'leaving (after grace) is noticed on the next read without a timer');
});

test('Card 31 total counts accounts within the grace period beyond the stream limit, and stays schema-valid',async t=>{
  const {activity}=fixture();t.after(()=>activity.close());
  const self=randomUUID(),ids=Array.from({length:70},()=>randomUUID());
  activity.setOnline({principals:()=>[self,...ids],resolve:async()=>({self,visible:ids.map((principal_id,index)=>({principal_id,display_name:'同事'+index+'（合成）'}))})});
  const view=await activity.online(auth(self));
  assert.equal(view.total,70);assert.equal(view.people.length,WORKBENCH_ONLINE_MAX_PEOPLE);
  await assertP2016Schema('workbench_online_view',view);
});
