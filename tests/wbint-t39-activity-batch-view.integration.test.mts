import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {assertP2016Schema} from './helpers/p2-016-schema-assert.mjs';
import type {WorkbenchActivityBatchView,WorkbenchActivityCommand} from '../contracts/workbench_activity_contracts.js';

// ADR-0057 card 30A through the real staff HTTP boundary, real PostgreSQL authorization and the shared SSE stream.
interface Fixture {origin:string;cookies:string[];tickets:{ticket:{id:string}}[]}
const target=(id:string)=>({kind:'ticket' as const,id});
const renew=(id:string,browser:string):WorkbenchActivityCommand=>({schema_version:1,browser_id:browser,action:'RENEW',target:target(id),visible:true,active:true,mode:'VIEWING',field:null});
const p95=(samples:number[])=>{const sorted=[...samples].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*0.95)-1)]??0;};
async function http(f:Fixture){
  const actor=f.cookies[0],hidden=f.cookies[1],viewer=f.cookies[2];assert.ok(actor&&hidden&&viewer);
  const get=(path:string,cookie:string)=>fetch(f.origin+path,{headers:{cookie}});
  const csrf=async(cookie:string)=>{const response=await get('/api/lifecycle/bootstrap',cookie);assert.equal(response.status,200);return (await response.json() as {csrf_token:string}).csrf_token;};
  const tokens=new Map<string,string>();for(const cookie of [actor,hidden,viewer])tokens.set(cookie,await csrf(cookie));
  const post=(path:string,body:unknown,cookie:string,{token=tokens.get(cookie)??'',origin=f.origin}:{token?:string;origin?:string}={})=>fetch(f.origin+path,{method:'POST',headers:{cookie,origin,'content-type':'application/json','x-csrf-token':token},body:JSON.stringify(body)});
  return {actor,hidden,viewer,get,post};
}

test('batch view over real HTTP: closed input, CSRF, mutual READ, omits empty targets, and measured latency',async t=>{
  await withWeb01Fixture(async(f:Fixture)=>{
    const h=await http(f),batch='/api/workbench/activity/batch-view';
    const readable:string[]=[];
    for(const {ticket} of f.tickets){
      const [a,v]=await Promise.all([h.get('/api/workbench/items/ticket/'+ticket.id,h.actor),h.get('/api/workbench/items/ticket/'+ticket.id,h.viewer)]);
      await a.arrayBuffer();await v.arrayBuffer();if(a.status===200&&v.status===200)readable.push(ticket.id);
    }
    // One principal owns at most 4 browsers × 2 objects = 8 leases (WORKBENCH_ACTIVITY_LIMITS).
    const occupied=readable.slice(0,8);assert.ok(occupied.length>=2,'fixture provides mutually readable tickets');
    for(let i=0;i<occupied.length;i+=2){const browser=randomUUID();for(const id of occupied.slice(i,i+2)){const response=await h.post('/api/workbench/activity',renew(id,browser),h.actor);assert.equal(response.status,200);await response.arrayBuffer();}}
    const body=(ids:string[])=>({schema_version:1,targets:ids.map(target)});
    const empty=Array.from({length:100},()=>randomUUID()),mixed=[...occupied,...Array.from({length:100-occupied.length},()=>randomUUID())];
    for(const [response,status] of [
      [await h.post(batch,body(mixed),h.viewer,{token:'wrong'}),403],[await h.post(batch,body(mixed),h.viewer,{origin:'https://foreign.invalid'}),403],
      [await h.post(batch+'?all=1',body(mixed),h.viewer),400],[await h.post(batch,body([]),h.viewer),400],[await h.post(batch,body([...mixed,randomUUID()]),h.viewer),400],
      [await h.post(batch,{...body(mixed),principal_id:randomUUID()},h.viewer),400],[await h.get(batch,h.viewer),404]] as const){assert.equal(response.status,status);await response.arrayBuffer();}
    const read=async(cookie:string,ids:string[])=>{const response=await h.post(batch,body(ids),cookie);assert.equal(response.status,200);return await response.json() as WorkbenchActivityBatchView;};
    const projection=await read(h.viewer,[occupied[0]??'',...mixed.slice(0,99)]);
    await assertP2016Schema('workbench_activity_batch_view',projection);
    assert.deepEqual(projection.items.map(item=>item.id),occupied,'duplicates collapse, empty targets are omitted, request order is kept');
    assert.ok(projection.items.every(item=>item.kind==='ticket'&&item.people.length===1&&item.people[0]?.display_name==='林舟'&&item.people[0].mode==='VIEWING'&&item.people[0].field===null));
    assert.deepEqual(await read(h.actor,mixed),{schema_version:1,items:[]},'the actor never sees self');
    const hiddenView=await read(h.hidden,mixed);
    for(const item of hiddenView.items){const detail=await h.get('/api/workbench/items/ticket/'+item.id,h.hidden);assert.equal(detail.status,200,'only mutually readable targets are returned');await detail.arrayBuffer();}
    const single=await h.get('/api/workbench/items/ticket/'+occupied[0]+'/activity',h.viewer);assert.equal(single.status,200);
    assert.deepEqual((await single.json() as {people:unknown[]}).people,projection.items[0]?.people,'single and batch views share one person structure');
    // A5 real measurement on the local PostgreSQL fixture (sequential, after warm-up).
    const measure=async(ids:string[],rounds:number)=>{const samples:number[]=[];for(let i=0;i<rounds;i++){const started=performance.now();const response=await h.post(batch,body(ids),h.viewer);await response.arrayBuffer();samples.push(performance.now()-started);assert.equal(response.status,200);}return p95(samples);};
    await measure(mixed,3);
    const zero=await measure(empty,40),some=await measure(mixed,40);
    const perTarget=Math.max(0,some-zero)/occupied.length;
    t.diagnostic(`A5 HTTP+PG zero-occupied (100 targets): p95=${zero.toFixed(2)}ms (includes cookie session authentication at the HTTP boundary)`);
    t.diagnostic(`A5 HTTP+PG ${occupied.length}-occupied (100 targets, 1 colleague lease each): p95=${some.toFixed(2)}ms, ≈${perTarget.toFixed(2)}ms per occupied target`);
    t.diagnostic(`A5 extrapolated 64 occupied × 2 colleague leases: ≈${(zero+perTarget*64*1.33).toFixed(0)}ms (4 instead of 3 authorizations per target)`);
  },{workbenchRealtimeEnabled:true,workbenchActivityEnabled:true,manualProjection:true});
});

test('a colleague lease on a ticket the watcher never opened hints the watcher board connection',async()=>{
  await withWeb01Fixture(async(f:Fixture)=>{
    const h=await http(f),ticket=f.tickets[0]?.ticket;assert.ok(ticket);
    const abort=new AbortController();let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
    try{
      const stream=await fetch(f.origin+'/api/realtime/events?scope=workbench',{headers:{cookie:h.viewer},signal:abort.signal});assert.equal(stream.status,200);assert.ok(stream.body);reader=stream.body.getReader();
      // Give the connection its first (priming) pass; the watcher holds no lease of its own.
      await new Promise(resolve=>setTimeout(resolve,300));
      const accepted=await h.post('/api/workbench/activity',renew(ticket.id,randomUUID()),h.actor);assert.equal(accepted.status,200);await accepted.arrayBuffer();
      const timer=setTimeout(()=>abort.abort(),10000);let pending='',frame='';
      try{
        while(!frame){const next=await reader.read();assert.equal(next.done,false);pending+=new TextDecoder().decode(next.value);pending=pending.replaceAll('\r\n','\n');
          let end:number;while((end=pending.indexOf('\n\n'))>=0){const block=pending.slice(0,end);pending=pending.slice(end+2);if(block.split('\n').includes('event: workbench.activity.changed')){frame=block;break;}}}
      }finally{clearTimeout(timer);}
      assert.deepEqual(frame.split('\n'),['event: workbench.activity.changed','data: {"schema_version":1}'],'the hint carries no person, object or field');
    }finally{await reader?.cancel();abort.abort();}
  },{workbenchRealtimeEnabled:true,workbenchActivityEnabled:true,manualProjection:true});
});
