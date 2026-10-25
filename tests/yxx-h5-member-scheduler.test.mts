import assert from 'node:assert/strict';
import {AsyncLocalStorage} from 'node:async_hooks';
import {test} from 'node:test';
import {createApplicationMemberVerifier,type ApplicationMemberVerificationEvent,type ApplicationMemberVerificationPurpose} from '../app/server/src/wecom-application-member.mjs';

function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes;});return {promise,resolve};}
function eventTape(){
  const events:ApplicationMemberVerificationEvent[]=[],waiting:{after:number;predicate:(event:ApplicationMemberVerificationEvent)=>boolean;resolve:(event:ApplicationMemberVerificationEvent)=>void}[]=[];
  return {events,observe(event:ApplicationMemberVerificationEvent){events.push(event);for(let index=waiting.length-1;index>=0;index--){const waiter=waiting[index];if(waiter&&events.length-1>=waiter.after&&waiter.predicate(event)){waiting.splice(index,1);waiter.resolve(event);}}},
    wait(predicate:(event:ApplicationMemberVerificationEvent)=>boolean,after=0){const found=events.slice(after).find(predicate);if(found)return Promise.resolve(found);return new Promise<ApplicationMemberVerificationEvent>(resolve=>waiting.push({after,predicate,resolve}));}};
}
function fixture(enabled?:boolean,options:{context?:AsyncLocalStorage<string>;observe?:(event:ApplicationMemberVerificationEvent)=>void}={}){
  const tape=eventTape(),calls:{id:string;signal:AbortSignal;context:string|undefined;reply:(response:Response)=>void}[]=[],callWaiters:{count:number;resolve:()=>void}[]=[],controllers:AbortController[]=[],promises:Promise<unknown>[]=[];
  let active=0,maxActive=0,automatic=false,tokens=0;
  const response=(id:string)=>new Response(JSON.stringify({errcode:0,userid:id,status:1,enable:1,name:'Synthetic member'}));
  const fetchImpl:typeof fetch=async(input,init)=>{
    const url=new URL(String(input)),id=url.searchParams.get('userid'),signal=init?.signal;assert.ok(id&&signal);assert.equal(url.pathname,'/cgi-bin/user/get');assert.equal(init?.method,'GET');assert.equal(init?.redirect,'error');
    const gate=deferred<Response>();calls.push({id,signal,context:options.context?.getStore(),reply:gate.resolve});active++;maxActive=Math.max(maxActive,active);
    for(let index=callWaiters.length-1;index>=0;index--){const waiter=callWaiters[index];if(waiter&&calls.length>=waiter.count){callWaiters.splice(index,1);waiter.resolve();}}
    try{return await (automatic?Promise.resolve(response(id)):gate.promise);}finally{active--;}
  };
  const verify=createApplicationMemberVerifier({accessTokenProvider:async()=>{tokens++;return 'synthetic-token-never-in-observation';},fetchImpl,...(enabled===undefined?{}:{h5EntryReadEnabled:enabled}),observe(event){tape.observe(event);options.observe?.(event);}});
  return {verify,tape,calls,get active(){return active;},get maxActive(){return maxActive;},get tokens(){return tokens;},
    invoke(purpose:ApplicationMemberVerificationPurpose,id='open-A'){
      const controller=new AbortController();controllers.push(controller);const promise=(purpose==='BASE'?verify:verify.h5EntryRead)(id,controller.signal);void promise.catch(()=>undefined);promises.push(promise);return {promise,controller};
    },
    waitCalls(count:number){if(calls.length>=count)return Promise.resolve();return new Promise<void>(resolve=>callWaiters.push({count,resolve}));},
    reply(index:number){const call=calls[index];assert.ok(call);call.reply(response(call.id));},
    async close(){for(const controller of controllers)controller.abort();automatic=true;for(const call of calls)call.reply(response(call.id));await Promise.allSettled(promises);if((tape.events.at(-1)?.pending??0)>0)await tape.wait(event=>event.phase==='SETTLED'&&event.pending===0,tape.events.length);assert.equal(active,0);},
  };
}

test('default purpose stays one actual operation with one identical BASE/H5 callable and FIFO',async()=>{
  const f=fixture();try{
    assert.equal(f.verify.h5EntryRead,f.verify);assert.equal(Object.getOwnPropertyDescriptor(f.verify,'h5EntryRead')?.writable,false);
    const first=f.invoke('BASE','open-first'),second=f.invoke('H5_ENTRY','open-second'),third=f.invoke('BASE','open-third');
    await f.waitCalls(1);assert.equal(f.calls.length,1);f.reply(0);assert.equal((await first.promise)?.openUserId,'open-first');
    await f.waitCalls(2);assert.equal(f.calls[1]?.id,'open-second');f.reply(1);await second.promise;
    await f.waitCalls(3);assert.equal(f.calls[2]?.id,'open-third');f.reply(2);await third.promise;
    assert.equal(f.maxActive,1);assert.ok(f.tape.events.every(event=>event.purpose==='BASE'&&event.active<=1&&event.base_active<=1));
  }finally{await f.close();}
});

test('enabled purposes share two actual slots, keep BASE at one and skip only a blocked BASE head',async()=>{
  const f=fixture(true);try{
    const base1=f.invoke('BASE','base-first'),base2=f.invoke('BASE','base-second'),h51=f.invoke('H5_ENTRY','h5-first'),h52=f.invoke('H5_ENTRY','h5-second');
    await f.waitCalls(2);assert.deepEqual(f.calls.map(call=>call.id),['base-first','h5-first']);
    f.reply(1);await h51.promise;await f.waitCalls(3);assert.equal(f.calls[2]?.id,'h5-second');
    f.reply(0);await base1.promise;await f.waitCalls(4);assert.equal(f.calls[3]?.id,'base-second');
    f.reply(2);f.reply(3);await Promise.all([base2.promise,h52.promise]);assert.equal(f.maxActive,2);
    assert.ok(f.tape.events.every(event=>event.active<=2&&event.base_active<=1&&event.pending<=32));
  }finally{await f.close();}
});

test('two current H5 requests for the same identity each perform their own Provider lookup',async()=>{
  const f=fixture(true);try{
    const first=f.invoke('H5_ENTRY'),second=f.invoke('H5_ENTRY');await f.waitCalls(2);assert.equal(f.active,2);assert.equal(f.tokens,2);assert.deepEqual(f.calls.map(call=>call.id),['open-A','open-A']);
    const queued=f.tape.events.filter(event=>event.phase==='QUEUED');assert.equal(new Set(queued.map(event=>event.operation_id)).size,2);
    f.reply(0);f.reply(1);const results=await Promise.all([first.promise,second.promise]);assert.ok(results.every(result=>result?.openUserId==='open-A'));assert.equal(f.calls.length,2);
  }finally{await f.close();}
});

test('BASE and H5 share a single thirty-two-item capacity and queued cancellation returns one item',async()=>{
  const f=fixture(true);try{
    const admitted=Array.from({length:32},(_,index)=>f.invoke(index%2?'H5_ENTRY':'BASE','open-'+index));await f.waitCalls(2);
    await assert.rejects(f.invoke('H5_ENTRY','overflow').promise,{name:'ApplicationMemberUnavailableError'});assert.equal(f.calls.length,2);assert.equal(f.tape.events.filter(event=>event.phase==='QUEUED').length,32);
    const queued=admitted[2];assert.ok(queued);queued.controller.abort();await assert.rejects(queued.promise,{name:'ApplicationMemberUnavailableError'});
    const cancelled=f.tape.events.find(event=>event.phase==='SETTLED');assert.ok(cancelled&&cancelled.phase==='SETTLED');assert.equal(cancelled.started_at_ms,null);assert.equal(cancelled.pending,31);
    f.invoke('BASE','replacement');await assert.rejects(f.invoke('BASE','overflow-again').promise,{name:'ApplicationMemberUnavailableError'});assert.equal(f.tape.events.filter(event=>event.phase==='QUEUED').length,33);assert.equal(f.calls.length,2);
  }finally{await f.close();}
});

test('queued cancellation does not fetch and cancelling one active lookup cannot cancel another or free its slot',async()=>{
  const f=fixture(true);try{
    const first=f.invoke('H5_ENTRY','cancel-active'),second=f.invoke('H5_ENTRY','keep-active'),queued=f.invoke('H5_ENTRY','cancel-queued');await f.waitCalls(2);
    queued.controller.abort();await assert.rejects(queued.promise,{name:'ApplicationMemberUnavailableError'});assert.equal(f.calls.some(call=>call.id==='cancel-queued'),false);
    first.controller.abort();await assert.rejects(first.promise,{name:'ApplicationMemberUnavailableError'});assert.equal(f.active,2);assert.equal(f.calls[1]?.signal.aborted,false);
    const replacement=f.invoke('H5_ENTRY','next-active');assert.equal(f.calls.length,2);f.reply(1);assert.equal((await second.promise)?.openUserId,'keep-active');await f.waitCalls(3);assert.equal(f.calls[2]?.id,'next-active');
    assert.equal(f.active,2);f.reply(2);await replacement.promise;assert.equal(f.active,1);assert.equal(f.maxActive,2);
    const firstId=f.tape.events.find(event=>event.phase==='QUEUED')?.operation_id;assert.ok(firstId);assert.equal(f.tape.events.some(event=>event.phase==='SETTLED'&&event.operation_id===firstId),false);
    f.reply(0);const settled=await f.tape.wait(event=>event.phase==='SETTLED'&&event.operation_id===firstId);assert.equal(settled.phase,'SETTLED');assert.equal(settled.pending,0);
  }finally{await f.close();}
});

test('the five-second deadline starts at admission and is not reset when a queued BASE request starts',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=fixture();
  try{
    const first=f.invoke('BASE','slow-first'),second=f.invoke('BASE','queued-second');await f.waitCalls(1);t.mock.timers.tick(4900);
    f.reply(0);await first.promise;await f.waitCalls(2);assert.equal(f.calls[1]?.signal.aborted,false);
    t.mock.timers.tick(100);await assert.rejects(second.promise,{name:'ApplicationMemberUnavailableError'});assert.equal(f.calls[1]?.signal.aborted,true);assert.equal(f.active,1);
    const third=f.invoke('BASE','queued-third');assert.equal(f.calls.length,2);f.reply(1);await f.waitCalls(3);f.reply(2);await third.promise;
  }finally{await f.close();t.mock.timers.reset();}
});

test('timed-out non-cooperative H5 operations retain both actual slots and their shared pending entries',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=fixture(true);
  try{
    const original=Array.from({length:32},(_,index)=>f.invoke('H5_ENTRY','expired-'+index));await f.waitCalls(2);t.mock.timers.tick(5000);
    const expired=await Promise.allSettled(original.map(item=>item.promise));assert.ok(expired.every(item=>item.status==='rejected'));assert.equal(f.calls.length,2);assert.equal(f.active,2);
    const last=f.tape.events.at(-1);assert.ok(last);assert.equal(last.pending,2);assert.equal(last.active,2);
    for(let index=0;index<30;index++)f.invoke('H5_ENTRY','new-'+index);
    await assert.rejects(f.invoke('BASE','still-overflow').promise,{name:'ApplicationMemberUnavailableError'});assert.equal(f.calls.length,2);
    f.reply(0);await f.waitCalls(3);assert.equal(f.calls[2]?.id,'new-0');assert.equal(f.active,2);assert.equal(f.maxActive,2);
  }finally{await f.close();t.mock.timers.reset();}
});

test('opaque observation is immutable, exception-isolated and preserves each queued caller async context',async()=>{
  const contexts=new AsyncLocalStorage<string>(),observerContexts:(string|undefined)[]=[],f=fixture(false,{context:contexts,observe(){observerContexts.push(contexts.getStore());throw new Error('SYNTHETIC_OBSERVER_FAILURE');}});
  try{
    const first=contexts.run('http-A',()=>f.invoke('BASE','sensitive-open-A')),second=contexts.run('http-B',()=>f.invoke('BASE','sensitive-open-B'));await f.waitCalls(1);
    assert.equal(f.calls[0]?.context,'http-A');f.reply(0);assert.equal((await first.promise)?.openUserId,'sensitive-open-A');await f.waitCalls(2);assert.equal(f.calls[1]?.context,'http-B');f.reply(1);await second.promise;
    const queued=f.tape.events.filter(event=>event.phase==='QUEUED');assert.equal(queued.length,2);assert.equal(new Set(queued.map(event=>event.operation_id)).size,2);
    for(const event of f.tape.events){
      assert.equal(Object.isFrozen(event),true);assert.match(event.operation_id,/^[a-f0-9-]{36}$/u);assert.ok(event.at_ms>=event.queued_at_ms);assert.equal(Object.hasOwn(event,'started_at_ms'),event.phase!=='QUEUED');assert.equal(Object.hasOwn(event,'outcome'),event.phase==='SETTLED');
      const common=['operation_id','purpose','at_ms','queued_at_ms','active','base_active','pending','phase'],keys=event.phase==='QUEUED'?common:event.phase==='STARTED'?[...common,'started_at_ms']:[...common,'started_at_ms','outcome'];assert.deepEqual(Object.keys(event).sort(),keys.sort());
      if(event.phase==='SETTLED'){assert.equal(event.outcome,'FULFILLED');assert.ok(typeof event.started_at_ms==='number');}
    }
    const encoded=JSON.stringify(f.tape.events);for(const secret of ['sensitive-open-A','sensitive-open-B','synthetic-token','access_token','userid','Cookie','http-A','http-B'])assert.equal(encoded.includes(secret),false);
    assert.ok(observerContexts.every(context=>context==='http-A'||context==='http-B'));assert.equal(f.tape.events.at(-1)?.pending,0);
  }finally{await f.close();}
});
