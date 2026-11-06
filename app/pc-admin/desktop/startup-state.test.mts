import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initialStartup,transitionStartup} from './startup-state.mjs';
import type {StartupModel} from './startup-state.mjs';

const visibleStartup=()=>transitionStartup(transitionStartup(initialStartup(),{type:'navigation',generation:1}),{type:'active',active:true});
const prepared=(state:StartupModel,generation=state.generation)=>transitionStartup(state,{type:'scene',generation,scene:'prepared'});
const ended=(state:StartupModel)=>transitionStartup(transitionStartup(transitionStartup(state,{type:'video',signal:{version:1,type:'first-frame'}}),{type:'video',signal:{version:1,type:'playing'}}),{type:'video',signal:{version:1,type:'first-ended'}});

test('a prepared login still waits for the real first ended signal',()=>{
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
  // Waiting and playing represent additional loops. No second ended is needed.
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
  for(const event of [released,{type:'scene',generation:1,scene:'prepared'},{type:'video',signal:{version:1,type:'first-ended'}},{type:'navigation',generation:2},{type:'scene',generation:2,scene:'prepared'}] as const){
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

test('unpainted and inactive ended reports do not count as a viewed first playback',()=>{
  let state=prepared(visibleStartup());
  state=transitionStartup(state,{type:'video',signal:{version:1,type:'first-ended'}});
  assert.equal(state.firstPlaybackComplete,false);
  state=transitionStartup(state,{type:'video',signal:{version:1,type:'first-frame'}});
  state=transitionStartup(state,{type:'video',signal:{version:1,type:'playing'}});
  state=transitionStartup(state,{type:'active',active:false});
  state=transitionStartup(state,{type:'video',signal:{version:1,type:'first-ended'}});
  assert.equal(state.firstPlaybackComplete,false);
  assert.equal(state.phase,'covering');
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
  for(const reason of ['media-error','play-rejected','first-frame-timeout','playback-stalled','overlay-load-failed','overlay-crashed'] as const){
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
