import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initialStartup,transitionStartup} from './startup-state.mjs';
import type {StartupModel} from './startup-state.mjs';

const visibleStartup=()=>transitionStartup(transitionStartup(initialStartup(),{type:'navigation',generation:1}),{type:'active',active:true});
const prepared=(state:StartupModel,generation=state.generation)=>transitionStartup(state,{type:'scene',generation,scene:'prepared'});
const ended=(state:StartupModel)=>transitionStartup(transitionStartup(transitionStartup(state,{type:'video',signal:{version:1,type:'first-frame'}}),{type:'video',signal:{version:1,type:'playing'}}),{type:'video',signal:{version:1,type:'first-cycle-complete'}});

test('a prepared login still waits for the real first frame-cycle completion signal',()=>{
  let state=prepared(visibleStartup());
  for(const type of ['first-frame','playing','waiting','stalled','playing'] as const){
    state=transitionStartup(state,{type:'video',signal:{version:1,type}});
    assert.equal(state.firstPlaybackComplete,false);
    assert.equal(state.phase,'covering');
  }
  state=ended(state);
  assert.equal(state.firstPlaybackComplete,true);
  assert.equal(state.phase,'releasing');
});

test('first playback may finish before preparation and later loop readiness releases immediately',()=>{
  let state=ended(visibleStartup());
  assert.equal(state.phase,'covering');
  // Waiting and playing represent additional loops. No second cycle completion is needed.
  for(let loop=0;loop<3;loop++){
    state=transitionStartup(state,{type:'video',signal:{version:1,type:'waiting'}});
    state=transitionStartup(state,{type:'video',signal:{version:1,type:'playing'}});
    assert.equal(state.firstPlaybackComplete,true);
    assert.equal(state.phase,'covering');
  }
  assert.equal(prepared(state).phase,'releasing');
});

test('handoff is idempotent and subsequent QR refreshes and navigation never restart it',()=>{
  let state=ended(prepared(visibleStartup()));
  const released={type:'video',signal:{version:1,type:'released',generation:1}} as const;
  state=transitionStartup(state,released);
  assert.equal(state.phase,'released');
  for(const event of [released,{type:'scene',generation:1,scene:'prepared'},{type:'video',signal:{version:1,type:'first-cycle-complete'}},{type:'navigation',generation:2},{type:'scene',generation:2,scene:'prepared'}] as const){
    state=transitionStartup(state,event);
    assert.equal(state.phase,'released');
    assert.equal(state.firstPlaybackComplete,true);
  }
});

test('current navigation owns scene readiness and a stale release cannot finish a new handoff',()=>{
  let state=ended(prepared(visibleStartup()));
  assert.equal(state.phase,'releasing');
  state=transitionStartup(state,{type:'navigation',generation:2});
  assert.equal(state.phase,'covering');
  assert.equal(state.scene,'loading');
  assert.equal(state.firstPlaybackComplete,true,'a retry preserves completed playback');
  const current=state;
  for(const event of [{type:'navigation',generation:1},{type:'navigation',generation:2},{type:'scene',generation:1,scene:'prepared'},{type:'video',signal:{version:1,type:'released',generation:1}}] as const){
    state=transitionStartup(state,event);
    assert.deepEqual(state,current);
  }
  state=prepared(state);
  assert.equal(state.phase,'releasing');
  assert.equal(transitionStartup(state,{type:'video',signal:{version:1,type:'released',generation:2}}).phase,'released');
});

test('hidden, minimized, locked or suspended startup cannot hand off until active again',()=>{
  let state=transitionStartup(ended(visibleStartup()),{type:'active',active:false});
  state=prepared(state);
  assert.equal(state.phase,'covering');
  assert.equal(state.firstPlaybackComplete,true);
  state=transitionStartup(state,{type:'active',active:true});
  assert.equal(state.phase,'releasing');
});

test('unpainted and inactive cycle reports do not count as a viewed first playback',()=>{
  let state=prepared(visibleStartup());
  state=transitionStartup(state,{type:'video',signal:{version:1,type:'first-cycle-complete'}});
  assert.equal(state.firstPlaybackComplete,false);
  state=transitionStartup(state,{type:'video',signal:{version:1,type:'first-frame'}});
  state=transitionStartup(state,{type:'video',signal:{version:1,type:'playing'}});
  state=transitionStartup(state,{type:'active',active:false});
  state=transitionStartup(state,{type:'video',signal:{version:1,type:'first-cycle-complete'}});
  assert.equal(state.firstPlaybackComplete,false);
  assert.equal(state.phase,'covering');
});

test('draw progress never supplies a first frame, playback completion or handoff',()=>{
  let state=prepared(visibleStartup());
  for(const drawCount of [1,68,1_000_000_000]){
    const previous=state;state=transitionStartup(state,{type:'video',signal:{version:1,type:'progress',drawCount}});
    assert.deepEqual(state,previous,'progress is a diagnostic liveness signal, not readiness or playback authority');
  }
  state=transitionStartup(state,{type:'video',signal:{version:1,type:'first-frame'}});
  state=transitionStartup(state,{type:'video',signal:{version:1,type:'playing'}});
  state=transitionStartup(state,{type:'video',signal:{version:1,type:'progress',drawCount:136}});
  assert.equal(state.firstPlaybackComplete,false);assert.equal(state.phase,'covering','even two cycles worth of draw counts cannot replace the real completed-cycle signal');
});

test('hiding during a fade cancels the release until the window is active again',()=>{
  let state=ended(prepared(visibleStartup()));
  assert.equal(state.phase,'releasing');
  state=transitionStartup(state,{type:'active',active:false});
  assert.equal(state.phase,'covering');
  state=transitionStartup(state,{type:'video',signal:{version:1,type:'released',generation:1}});
  assert.equal(state.phase,'covering','a fade completion queued across hiding is ignored');
  state=transitionStartup(state,{type:'active',active:true});
  assert.equal(state.phase,'releasing');
  assert.equal(state.firstPlaybackComplete,true);
});

test('actionable scene errors and bounded compatibility still wait for normal first playback',()=>{
  for(const scene of ['error','compatibility','other'] as const){
    let state=transitionStartup(visibleStartup(),{type:'scene',generation:1,scene});
    assert.equal(state.phase,'covering');
    state=ended(state);
    assert.equal(state.phase,'releasing');
  }
});

test('media failures and reduced motion are explicit bypasses without fabricated playback completion',()=>{
  for(const reason of ['frame-load-failed','frame-decode-failed','canvas-unavailable','first-frame-timeout','playback-stalled','overlay-load-failed','overlay-crashed'] as const){
    const failed=transitionStartup(visibleStartup(),{type:'video',signal:{version:1,type:'failed',reason}});
    assert.equal(failed.video,'failed');
    assert.equal(failed.firstPlaybackComplete,false);
    assert.equal(failed.phase,'covering','video failure alone cannot expose an unprepared document');
    assert.equal(prepared(failed).phase,'releasing');
  }
  const reduced=transitionStartup(prepared(visibleStartup()),{type:'video',signal:{version:1,type:'reduced-motion'}});
  assert.equal(reduced.video,'reduced-motion');
  assert.equal(reduced.firstPlaybackComplete,false);
  assert.equal(reduced.phase,'releasing');
});

test('frame scheduler presents all 68 source frames and holds the last frame before completing',async()=>{
  const {createFramePlayback}=await import('./frame-playback.mjs');
  const drawn:number[]=[],signals:string[]=[];
  const playback=createFramePlayback({
    loadFrame:async(index:number)=>({index,close(){}}),
    drawFrame:(frame:{index:number;close():void},index:number)=>{assert.equal(frame.index,index);drawn.push(index);},
    onSignal:(signal:string)=>signals.push(signal),
  });
  const settle=async()=>{for(let turn=0;turn<12;turn++)await Promise.resolve();};
  try{
    await settle();playback.tick(0,true);
    assert.deepEqual(drawn,[0]);
    for(let index=1;index<68;index++){
      await settle();playback.tick(index*1000/30+.00001,true);
      assert.equal(playback.snapshot().firstCycleComplete,false,'displaying the final frame is not its complete dwell');
    }
    assert.deepEqual(drawn,Array.from({length:68},(_,index)=>index),'every original frame is drawn once and in source order');
    playback.tick(2250,true);
    assert.equal(playback.snapshot().firstCycleComplete,false,'the final frame still owes part of its 1/30 second dwell');
    await settle();playback.tick(2266.667,true);
    assert.equal(playback.snapshot().firstCycleComplete,true);
    assert.equal(playback.snapshot().cycleCount,1);
    assert.equal(signals.filter(signal=>signal==='first-cycle-complete').length,1);
    assert.ok((playback.snapshot().firstCycleActiveMs??0)>=2266.666,'a complete visible cycle cannot be shorter than 68/30 seconds');
  }finally{playback.dispose();}
});

test('inactive clocks and a long visible stall cannot skip source frames or accrue catch-up debt',async()=>{
  const {createFramePlayback}=await import('./frame-playback.mjs');
  const drawn:number[]=[];
  const playback=createFramePlayback({loadFrame:async(index:number)=>({index,close(){}}),drawFrame:(_frame,index)=>drawn.push(index)});
  const settle=async()=>{for(let turn=0;turn<12;turn++)await Promise.resolve();};
  try{
    await settle();playback.tick(0,true);playback.tick(10,true);
    playback.tick(10_000,false);playback.tick(20_000,true);
    assert.equal(playback.snapshot().currentFrame,0,'resume preserves the current frame and its unpaid dwell');
    assert.equal(playback.snapshot().activeMs,10,'background wall-clock time is not viewed playback');
    playback.tick(20_023.334,true);
    assert.deepEqual(drawn,[0,1]);
    await settle();playback.tick(3_600_000,true);
    assert.deepEqual(drawn,[0,1,2],'even a long visible main-thread stall advances only the next source frame');
    playback.tick(3_600_000,true);playback.tick(3_600_001,true);
    assert.deepEqual(drawn,[0,1,2],'the new frame owes a fresh dwell rather than inheriting a catch-up balance');
    assert.equal(playback.snapshot().firstCycleComplete,false);
    playback.pause();playback.tick(7_200_000,true);
    assert.equal(playback.snapshot().currentFrame,2,'an explicit pause also rejects wall-clock completion');
  }finally{playback.dispose();}
});

test('a late decode holds the current frame and starts the next dwell only when it is drawn',async()=>{
  const {createFramePlayback}=await import('./frame-playback.mjs');
  type Frame={index:number;close():void};
  const pending=new Map<number,(frame:Frame)=>void>(),drawn:number[]=[];
  const playback=createFramePlayback({loadFrame:(index:number)=>new Promise<Frame>(resolve=>{pending.set(index,resolve);}),drawFrame:(_frame,index)=>drawn.push(index)});
  const settle=async()=>{for(let turn=0;turn<12;turn++)await Promise.resolve();};
  const decode=async(index:number)=>{const resolve=pending.get(index);assert.ok(resolve,'only the next bounded decode is pending');pending.delete(index);resolve({index,close(){}});await settle();};
  try{
    await decode(0);playback.tick(0,true);playback.tick(1000,true);
    assert.deepEqual(drawn,[0]);assert.equal(playback.snapshot().waiting,true);
    await decode(1);playback.tick(1100,true);
    assert.deepEqual(drawn,[0,1]);
    await decode(2);playback.tick(1101,true);
    assert.deepEqual(drawn,[0,1],'waiting for frame 1 cannot pay the dwell of frame 2');
    assert.equal(playback.snapshot().firstCycleComplete,false);
  }finally{playback.dispose();}
});

test('the decoded-frame pool and decoder stay bounded across repeated cycles and release every bitmap',async()=>{
  const {createFramePlayback}=await import('./frame-playback.mjs');
  const frames:{index:number;closes:number;close():void}[]=[],drawn:number[]=[],signals:string[]=[];
  const playback=createFramePlayback({
    loadFrame:async(index:number)=>{const frame={index,closes:0,close(){this.closes++;}};frames.push(frame);return frame;},
    drawFrame:(_frame,index)=>drawn.push(index),onSignal:signal=>signals.push(signal),
  });
  try{
    for(let step=0;step<=204;step++){
      for(let turn=0;turn<12;turn++)await Promise.resolve();
      playback.tick(step*1000/30+.00001,true);
      const current=playback.snapshot();
      assert.ok(current.residentFrames.length+(current.inFlight===null?0:1)<=3,'current/next/decoder share at most three bitmap slots');
      assert.ok(current.maxResidentFrames<=3);assert.ok(current.maxInFlight<=1);
    }
    assert.equal(playback.snapshot().cycleCount,3);
    assert.equal(signals.filter(signal=>signal==='first-cycle-complete').length,1);
    assert.deepEqual(drawn,Array.from({length:205},(_,index)=>index%68),'loops preserve source order with the same scheduler');
  }finally{playback.dispose();}
  for(let turn=0;turn<12;turn++)await Promise.resolve();
  assert.ok(frames.length>=68);
  assert.ok(frames.every(frame=>frame.closes===1),'eviction and disposal each close owned decoded resources exactly once');
});

test('disposal releases a decode that resolves late without drawing or completing',async()=>{
  const {createFramePlayback}=await import('./frame-playback.mjs');
  let deliver:((frame:{close():void})=>void)|undefined,closes=0,draws=0;
  const signals:string[]=[];
  const playback=createFramePlayback({loadFrame:()=>new Promise<{close():void}>(resolve=>{deliver=resolve;}),drawFrame:()=>{draws++;},onSignal:signal=>signals.push(signal)});
  playback.dispose();playback.dispose();
  assert.ok(deliver);deliver({close(){closes++;}});
  for(let turn=0;turn<12;turn++)await Promise.resolve();
  playback.tick(9_000_000,true);
  assert.equal(closes,1);assert.equal(draws,0);assert.equal(playback.snapshot().disposed,true);
  assert.equal(signals.includes('first-cycle-complete'),false);
});

test('decode and draw failures stop completion and report the original failure once',async()=>{
  const {createFramePlayback}=await import('./frame-playback.mjs');
  for(const failure of ['decode','draw'] as const){
    const expected=Error('synthetic '+failure),errors:unknown[]=[],frames:{closes:number;close():void}[]=[];
    const playback=createFramePlayback({
      loadFrame:async()=>{if(failure==='decode')throw expected;const frame={closes:0,close(){this.closes++;}};frames.push(frame);return frame;},
      drawFrame:()=>{throw expected;},onError:error=>errors.push(error),
    });
    for(let turn=0;turn<12;turn++)await Promise.resolve();
    playback.tick(0,true);playback.tick(3_600_000,true);playback.dispose();
    assert.deepEqual(errors,[expected]);assert.equal(playback.snapshot().firstCycleComplete,false);
    assert.ok(frames.every(frame=>frame.closes===1));
  }
});

test('a quantized 60Hz pure clock keeps 30fps phase without repeated 50/16ms draw pairs',async()=>{
  const {createFramePlayback}=await import('./frame-playback.mjs');
  const draws:{index:number;at:number}[]=[];
  let now=0;
  const playback=createFramePlayback({loadFrame:async(index:number)=>({index,close(){}}),drawFrame:(frame,index)=>{assert.equal(frame.index,index);draws.push({index,at:now});}});
  try{
    // This deterministic module clock is not native rendering or performance acceptance.
    for(let tick=0;tick<=600;tick++){
      for(let turn=0;turn<12;turn++)await Promise.resolve();
      now=Math.round(tick*1000/60*10)/10;
      const count=draws.length;playback.tick(now,true);
      assert.ok(draws.length-count<=1,'timestamp tolerance cannot draw multiple source frames in one callback');
    }
    assert.equal(draws.length,301,'ten seconds plus the initial draw retain the intended source cadence');
    assert.deepEqual(draws.map(draw=>draw.index),Array.from({length:301},(_unused,index)=>index%68),'every original source frame remains in sequence');
    assert.ok((playback.snapshot().firstCycleActiveMs??0)>=68000/30,'the timestamp tolerance cannot shorten the complete first cycle');
    const intervals=draws.slice(1).map((draw,index)=>{
      const previous=draws[index];assert.ok(previous);
      const interval=draw.at-previous.at;
      if(previous.index===67)assert.ok(interval+0.000001>=1000/30,'the final frame keeps its strict visible dwell');
      return interval;
    }).sort((left,right)=>left-right);
    const p95=intervals[Math.ceil(intervals.length*.95)-1];
    assert.ok(typeof p95==='number'&&p95<=34,'the quantized module clock must avoid repeated 50/16ms pairs; native product gates are tested separately');
  }finally{playback.dispose();}
});
