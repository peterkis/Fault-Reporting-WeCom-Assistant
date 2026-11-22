import assert from 'node:assert/strict';
import {test} from 'node:test';
import {query} from './helpers/motion-board-fixture.mjs';
import {waitForAnimationsSettled} from './helpers/browser-animations.mjs';
import {createFilmstripCapture} from './helpers/motion-filmstrip.mjs';
import {assertNoTransformAnimations} from './helpers/motion-assert.mjs';
import {clickWorkbenchControl} from './helpers/heroui-workbench-controls.mjs';
import {
  type Scene, options, withScene, claimPath, claim, prepareClaim, routeWrite, startTrace, conflict,
  closeUndo, followUndo, screenshot, fillClose, evidence, settleBoardAndDrawer, heading, undo,
  closeDialog, closeReason, confirmClose, noteText, follow, visible, active, pending, badge, moving,
} from './helpers/card37a-optimistic-fixture.mjs';

async function countdown(s:Scene,mode:'plain'|'hover'|'focus'){
  const {b,card}=s;
  let expected=mode==='focus'?10000:5000;
  // Observe the first and last DOM commits in the same clock domain, outside polling latency.
  await b.evaluate(`(()=>{
    const state=window.card37Timer={start:null,end:null,enter:null,leave:null},button=()=>document.querySelector(${JSON.stringify(undo)});
    const observer=new MutationObserver(()=>{
      const now=performance.now();
      if(state.start===null&&button())state.start=now;
      if(state.start!==null&&!button()){state.end=now;observer.disconnect();}
    });
    observer.observe(document.body,{subtree:true,childList:true,attributes:true});
  })()`);
  await claim(b,card);await b.waitFor(visible(undo));
  if(mode==='hover'){
    await waitForAnimationsSettled(b);
    const point=await b.evaluate(`(()=>{
      const button=${query(undo)},toast=button.closest('.workbench-toast');
      toast.addEventListener('pointerenter',()=>{card37Timer.enter=performance.now();},{once:true});
      toast.addEventListener('pointerleave',()=>{card37Timer.leave=performance.now();},{once:true});
      const r=button.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};
    })()`) as {x:number;y:number};
    await b.command('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
    await b.waitFor(query(undo)+'.matches(":hover")');
    await b.waitFor('card37Timer.enter!==null&&performance.now()-card37Timer.enter>=3000',{intervalMs:10});
    await b.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});
    await b.waitFor('card37Timer.leave!==null');
    const pausedMs=Number(await b.evaluate('card37Timer.leave-card37Timer.enter'));
    assert.ok(pausedMs>=3000,`hover lasted ${pausedMs} ms`);
    expected+=pausedMs;
  } else if(mode==='focus'){
    await b.evaluate(query(undo)+'.focus()');
    await b.waitFor('performance.now()-card37Timer.start>=5500');
    assert.equal(await b.evaluate('document.activeElement==='+query(undo)),true);
  }
  await b.waitFor('card37Timer.end!==null',{timeoutMs:11000});
  const ms=Number(await b.evaluate('card37Timer.end-card37Timer.start'));
  // A DOM commit is visible on a frame; allow two 60Hz frames for mounting/expiry.
  assert.ok(ms>=expected-34&&ms<=expected+34,`${mode}: ${ms} ms (target ${expected})`);
  assert.equal(await b.evaluate(visible(undo)),false);
}
test('37A A5.7 countdown expires at five seconds, pauses for hover/focus and caps at ten',options,async t=>{
  for(const mode of ['plain','hover','focus'] as const)await t.test(mode,()=>withScene(s=>countdown(s,mode)));
});

test('37A A5.9 close dialog disappears on submit and restores the reason and note on rejection',options,()=>withScene(async s=>{
  const {b}=s;
  await fillClose(s);await routeWrite(b,'/dismiss','reject');
  // A close that waits for the submit-time authorization read or the write
  // must fail even when the local server could answer both within one frame.
  await b.evaluate(`document.addEventListener('click',e=>{
    if(!e.target.closest('${confirmClose}'))return;
    const original=window.fetch;
    const gate=new Promise(resolve=>{window.releaseCloseRead=()=>{window.fetch=original;resolve();};});
    window.fetch=async(input,init)=>{
      if(new URL(input instanceof Request?input.url:input,location.href).pathname==='/api/lifecycle/bootstrap'){
        window.closeReadHeld=true;await gate;
      }
      return original(input,init);
    };
    window.closeHiddenFrame=new Promise(resolve=>{
      let frames=0;
      const sample=()=>{
        frames++;
        const d=document.querySelector('${closeDialog}');
        if(!d||!d.checkVisibility()||d.closest('[data-exiting]'))resolve(frames);
        else if(frames===2)resolve(null);
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
  },{capture:true,once:true})`);
  try{
    await clickWorkbenchControl(b,confirmClose);
    const frame=await b.evaluate('window.closeHiddenFrame');
    assert.ok(frame===1||frame===2,'dialog must leave within two animation frames of submit');
    await b.waitFor('window.closeReadHeld===true');
    assert.equal(await b.evaluate('card37Route.started'),0,'dialog must leave before preflight completes');
  }finally{await b.evaluate('window.releaseCloseRead?.()');}
  await b.waitFor('card37Route.started>0');
  // HeroUI may keep the exiting dialog in the DOM for its transition.
  assert.ok(await b.evaluate('!'+query(closeDialog)+'||'+query(closeDialog)+'.closest("[data-exiting]")!==null||!'+query(closeDialog)+'.checkVisibility()'));
  assert.equal(await b.evaluate('card37Route.ack'),0);
  await b.evaluate('card37Route.release()');
  await b.waitFor('card37Route.status===409&&'+visible(closeDialog)+'&&!'+query(closeDialog)+'.closest("[data-exiting]")');
  assert.ok(await b.evaluate(query(closeReason)+'.checked'));
  assert.equal(await b.evaluate(query(closeDialog+' textarea')+'.value'),noteText);
}));

test('37A A5.10 CDP reduced motion and development motion=off preserve actions without moving cards', {timeout:240000},async t=>{
  for(const motion of ['reduce','off'] as const){
    await t.test(motion+' conflict rollback',()=>withScene(s=>conflict(s,'reduce'),{motion}));
    for(const action of ['claim','close','follow'] as const)await t.test(motion+' '+action,()=>withScene(async s=>{
      const {b,card}=s;
      assert.ok(await b.evaluate(motion==='off'?'document.documentElement.dataset.motion==="off"':'matchMedia("(prefers-reduced-motion: reduce)").matches'));
      await startTrace(b,card);
      if(action==='claim'){
        await routeWrite(b,claimPath,'hold');await claim(b,card);await b.waitFor(visible(active(card)));
        await assertNoTransformAnimations(b,active(card));
        await b.evaluate('card37Route.release()');
        await b.waitFor(visible(undo));await clickWorkbenchControl(b,undo);
        await b.waitFor(heading('ticket-return-to-dispatch')+'==="已撤销"');
        await b.waitFor(visible(pending(card)));await assertNoTransformAnimations(b,pending(card));
      }else if(action==='close'){await closeUndo(s);await assertNoTransformAnimations(b,card);}
      else{await followUndo(s);await assertNoTransformAnimations(b,follow);}
      assert.deepEqual(await b.evaluate('card37Trace.stop();card37Trace.transforms'),[]);
    },{motion}));
  }
});

test('37A A5.11 capture optimistic-claim and rollback filmstrips',options,async t=>{
  await t.test('optimistic-claim',()=>withScene(async({b,card})=>{
    await routeWrite(b,claimPath,'hold');
    const button=await prepareClaim(b,card);
    await settleBoardAndDrawer(b);
    try{
      await createFilmstripCapture(b,evidence)('optimistic-claim',async()=>{
        await b.evaluate(query(button)+'.click()');await b.waitFor(moving(active(card)));
      },card);
      await screenshot(b,'card-pending-badge',visible(badge(active(card)))+'&&'+
        query(active(card))+'?.dataset.optimisticState==="pending"&&card37Route.started>0&&card37Route.ack===0');
    }finally{await b.evaluate('card37Route.release()');}
  }));
  await t.test('rollback',()=>withScene(s=>conflict(s,'film')));
});
