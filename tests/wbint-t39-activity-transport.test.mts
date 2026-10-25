import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorkbenchRealtimeClient} from '../app/pc-admin/src/realtime/workbench-realtime-client.mjs';
import type {RealtimeTransport} from '../app/pc-admin/src/realtime/workbench-realtime-client.mjs';
import type {WorkbenchRealtimeStatus} from '../contracts/workbench_realtime_contracts.js';

test('a delayed or failed activity request cannot fail healthy authoritative reads or own their deadline',async t=>{
  for(const failure of ['pending','rejected'] as const)await t.test(failure,async t=>{
    const listeners=new Map<string,(event:{data?:unknown})=>void>(),timers=new Map<number,()=>void>();
    const activitySignals:AbortSignal[]=[],reports:{status:WorkbenchRealtimeStatus;lastReadAt:number|null}[]=[];
    let serial=0,reads=0,closed=false;
    const source:RealtimeTransport={state:()=>closed?2:1,listen:(name,listener)=>{listeners.set(name,listener);return()=>{listeners.delete(name);};},close(){closed=true;listeners.clear();}};
    const client=createWorkbenchRealtimeClient({
      capability:{realtime_sse_enabled:true,realtime_sse_available:true,sse_endpoint:'/api/realtime/events?scope=workbench',polling_interval_ms:5000,expires_epoch_ms:'1800000000000',authorization_revision:'a'.repeat(64)},
      connect:()=>source,refresh:async()=>{reads++;return {available:true};},
      activityTick:signal=>{activitySignals.push(signal);return failure==='rejected'?Promise.reject(new Error('ACTIVITY_ONLY_FAILED')):new Promise<void>((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('ACTIVITY_ABORTED')),{once:true}));},
      authorizationDenied:()=>false,report:value=>reports.push(value),now:()=>123,
      schedule:callback=>{const id=++serial;timers.set(id,callback);return id;},cancel:handle=>{timers.delete(handle as number);},
    });
    t.after(()=>client.dispose());
    listeners.get('open')?.({});await new Promise(resolve=>setImmediate(resolve));
    assert.equal(reads,1);assert.equal(activitySignals.length,1);
    assert.deepEqual(reports.at(-1),{status:'live',lastReadAt:123},'successful business REST is current before optional activity settles');
    assert.equal(reports.some(value=>value.status==='offline'),false);
    assert.equal(timers.size,1,'only the original business recovery cadence is retained');
    const next=[...timers.values()][0];assert.ok(next);timers.clear();next();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(reads,2);assert.equal(activitySignals.length,2,'the next healthy read is not blocked by the old activity request');
    if(failure==='pending')assert.equal(activitySignals[0]?.aborted,true,'the same cadence bounds the old optional request');
    assert.equal(reports.some(value=>value.status==='offline'),false);assert.equal(closed,false);
    client.dispose();assert.equal(timers.size,0);assert.equal(listeners.size,0);
    if(failure==='pending')assert.equal(activitySignals.at(-1)?.aborted,true);
  });
});
