import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorkbenchRealtimeClient,decodeWorkbenchRealtimeHint,WORKBENCH_REALTIME_EVENT_TYPES} from '../src/workbench-realtime-client.mjs';
import {REALTIME_EVENT_TYPES} from '../src/p2-003-realtime-event-log.mjs';
import type {RealtimeTransport} from '../src/workbench-realtime-client.mjs';
import type {WorkbenchRealtimeStatus} from '../contracts/workbench_realtime_contracts.js';
const capability={realtime_sse_enabled:true,realtime_sse_available:true,sse_endpoint:'/api/realtime/events?scope=workbench' as const,polling_interval_ms:5000,expires_epoch_ms:'1800000000000',authorization_revision:'a'.repeat(64)};
function transport(){
  const listeners=new Map<string,(event:{data?:unknown;lastEventId?:string})=>void>();let closed=false;
  const source:RealtimeTransport={state:()=>closed?2:1,listen:(name,listener)=>{listeners.set(name,listener);return()=>{listeners.delete(name);};},close(){closed=true;listeners.clear();}};
  return {source,emit:(name:string,data?:unknown)=>listeners.get(name)?.({data}),closed:()=>closed,listeners:()=>listeners.size};
}
const hint=JSON.stringify({event_id:'9007199254740993',event_type:'ticket.updated',aggregate_type:'TICKET',aggregate_id:'synthetic-ticket',aggregate_version:'3',visibility_scope:'WORKBENCH',payload:{status:'FABRICATED'},occurred_at:'2026-10-08 12:00:00',created_at:'2026-10-08 12:00:00'});
test('authorized SSE hints coalesce into authoritative reads and disposal closes the owned transport',async()=>{
  const stream=transport(),reads:AbortSignal[]=[],reports:WorkbenchRealtimeStatus[]=[],timers=new Set<unknown>();
  let finish:(value:{available:boolean})=>void=()=>{};
  const client=createWorkbenchRealtimeClient({capability,connect:()=>stream.source,refresh:signal=>{reads.push(signal);return new Promise(resolve=>{finish=resolve;});},authorizationDenied:()=>false,report:state=>reports.push(state.status),now:()=>123,schedule:callback=>{timers.add(callback);return callback;},cancel:timer=>{timers.delete(timer);}});
  stream.emit('open');for(let i=0;i<100;i++)stream.emit('ticket.updated',hint);
  await Promise.resolve();assert.equal(reads.length,1,'the hint must cause a GET cycle, not install its payload');
  finish({available:true});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(reads.length,2,'one pending refresh is retained for the bounded burst');
  client.dispose();assert.equal(stream.closed(),true);assert.equal(stream.listeners(),0);assert.equal(timers.size,0);assert.equal(reads[1]?.aborted,true);assert.ok(reports.includes('live'));
});
test('public hints preserve BIGINT and discard payload authority, while malformed input stays bounded',()=>{
  assert.deepEqual(WORKBENCH_REALTIME_EVENT_TYPES,REALTIME_EVENT_TYPES);
  assert.deepEqual(decodeWorkbenchRealtimeHint(hint,'ticket.updated'),{event_id:'9007199254740993',event_type:'ticket.updated'});
  for(const invalid of ['{',hint.replace('9007199254740993','09007199254740993'),hint.replace('9007199254740993','9223372036854775808'),hint.replace('FABRICATED','x'.repeat(4097)),JSON.stringify({...JSON.parse(hint),event_ordinal:1}),JSON.stringify({...JSON.parse(hint),payload:{items:Array(101).fill(0)}})])assert.equal(decodeWorkbenchRealtimeHint(invalid,'ticket.updated'),null);
  assert.equal(decodeWorkbenchRealtimeHint(hint,'fabricated.changed'),null);
});
test('native CONNECTING retains its source; terminal CLOSED is replaced only after successful GET and stale callbacks are fenced',async()=>{
  const streams=[transport(),transport()],timers=new Map<number,()=>void>();let timerId=0,index=0,reads=0,state=1;
  const first=streams[0],second=streams[1];assert.ok(first&&second);first.source.state=()=>state;
  const reports:WorkbenchRealtimeStatus[]=[];
  const client=createWorkbenchRealtimeClient({capability,connect:()=>{const stream=streams[index++];assert.ok(stream);return stream.source;},refresh:async()=>{reads++;return {available:true};},authorizationDenied:()=>false,report:value=>reports.push(value.status),now:()=>123,schedule:callback=>{const id=++timerId;timers.set(id,callback);return id;},cancel:handle=>{timers.delete(handle as number);}});
  state=0;first.emit('error');await new Promise(resolve=>setImmediate(resolve));assert.equal(index,1);assert.ok(reports.includes('reconnecting'));
  state=2;first.emit('error');await new Promise(resolve=>setImmediate(resolve));assert.equal(index,1);assert.ok(reports.includes('polling'));
  const recovery=[...timers.values()][0];assert.ok(recovery);timers.clear();recovery();await new Promise(resolve=>setImmediate(resolve));assert.equal(index,2);assert.equal(first.closed(),true);assert.ok(reads>=3);
  client.setEnvironment(false,true);assert.equal(second.closed(),true);assert.equal(timers.size,0);const before=reads;first.emit('ticket.updated',hint);second.emit('ticket.updated',hint);await Promise.resolve();assert.equal(reads,before);
  client.dispose();assert.equal(timers.size,0);
});
test('disabled capability allocates no transport/timer and credible denial stops recovery without clearing facts on ordinary failures',async()=>{
  let connects=0;const timers=new Set<unknown>(),stream=transport(),reports:WorkbenchRealtimeStatus[]=[];let denied=false;
  const options={capability,connect:()=>{connects++;return stream.source;},refresh:async()=>{throw new Error(denied?'AUTH':'OFFLINE');},authorizationDenied:(error:unknown)=>error instanceof Error&&error.message==='AUTH',report:(value:{status:WorkbenchRealtimeStatus})=>{reports.push(value.status);},now:()=>123,schedule:(callback:()=>void)=>{timers.add(callback);return callback;},cancel:(handle:unknown)=>{timers.delete(handle);}};
  const disabled=createWorkbenchRealtimeClient({...options,capability:{...capability,realtime_sse_enabled:false,realtime_sse_available:false,sse_endpoint:null}});disabled.dispose();assert.equal(connects,0);assert.equal(timers.size,0);
  const client=createWorkbenchRealtimeClient(options);stream.emit('error');await new Promise(resolve=>setImmediate(resolve));assert.ok(reports.includes('offline'));assert.equal(stream.closed(),false);assert.equal(timers.size,1);
  denied=true;stream.emit('error');await new Promise(resolve=>setImmediate(resolve));assert.ok(reports.includes('auth-blocked'));assert.equal(stream.closed(),true);assert.equal(timers.size,0);client.dispose();
});
test('a stalled authoritative GET cannot indefinitely block authorization recovery; its late completion has no effect',async t=>{
  const stream=transport(),timers=new Map<number,{callback:()=>void;delay:number}>(),signals:AbortSignal[]=[],reports:{status:WorkbenchRealtimeStatus;lastReadAt:number|null}[]=[];let serial=0;
  let late:(value:{available:boolean})=>void=()=>{};
  const client=createWorkbenchRealtimeClient({capability,connect:()=>stream.source,refresh:signal=>{signals.push(signal);if(signals.length===1)return new Promise(resolve=>{late=resolve;});return Promise.resolve({available:true});},authorizationDenied:()=>false,report:value=>reports.push(value),now:()=>123,schedule:(callback,delay)=>{const id=++serial;timers.set(id,{callback,delay});return id;},cancel:handle=>{timers.delete(handle as number);}});
  t.after(()=>client.dispose());
  stream.emit('ticket.updated',hint);await Promise.resolve();
  assert.equal(timers.size,1,'a running read must retain its single bounded recovery deadline');
  const first=[...timers.values()][0];assert.ok(first);assert.equal(first.delay,5000);timers.clear();first.callback();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(signals[0]?.aborted,true);assert.equal(timers.size,1);
  const recovery=[...timers.values()][0];assert.ok(recovery);timers.clear();recovery.callback();await new Promise(resolve=>setImmediate(resolve));assert.equal(signals.length,2);
  const before=reports.length;late({available:false});await new Promise(resolve=>setImmediate(resolve));assert.equal(reports.length,before,'old callback must not change current transport status or fact-read time');
  client.dispose();assert.equal(timers.size,0);
});
test('terminal stream unavailability cannot create an immediate reconnect loop while authorized REST stays available',async t=>{
  const streams:ReturnType<typeof transport>[]=[],timers=new Map<number,{callback:()=>void;delay:number}>();let serial=0,reads=0;
  const client=createWorkbenchRealtimeClient({capability,connect:()=>{const stream=transport();stream.source.state=()=>2;streams.push(stream);return stream.source;},refresh:async()=>{reads++;return {available:true};},authorizationDenied:()=>false,report:()=>{},now:()=>123,schedule:(callback,delay)=>{const id=++serial;timers.set(id,{callback,delay});return id;},cancel:handle=>{timers.delete(handle as number);}});
  t.after(()=>client.dispose());
  for(let i=0;i<10;i++){streams.at(-1)?.emit('error');await new Promise(resolve=>setImmediate(resolve));}
  assert.equal(streams.length,1,'a terminal capacity/gap response must wait for the single bounded recovery cadence');
  assert.ok(reads>0,'REST authorization and current facts remain usable');assert.equal(timers.size,1);
  const recovery=[...timers.values()][0];assert.ok(recovery);assert.equal(recovery.delay,5000);timers.clear();recovery.callback();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(streams.length,2);client.dispose();assert.equal(timers.size,0);assert.ok(streams.every(stream=>stream.closed()));
});
