/**
 * Card 32C-T: wait until finite CSS/Web animations settle before geometry or style assertions and evidence screenshots.
 * Entry animations (drawer slide-in, modal zoom) and transitions move or recolour their subtree; measuring mid-flight reads a transient value.
 */
interface Evaluating {evaluate(expression:string):Promise<unknown>}

/**
 * Waits for every finite, running or pending animation in the subtree of `selector` (the whole document when omitted)
 * to finish, repeats while new ones start, then waits two frames so layout and paint reflect the final state.
 * Bounded by `timeoutMs`: an animation that never finishes fails loudly with its name and state instead of hanging the test.
 */
export async function waitForAnimationsSettled(browser:Evaluating,selector?:string,timeoutMs=5000):Promise<void>{
 const root=selector?`document.querySelector(${JSON.stringify(selector)})`:'document';
 const result=await browser.evaluate(`(async()=>{
  const deadline=performance.now()+${Math.max(100,Math.floor(timeoutMs))};
  const finite=a=>(a.playState==='running'||a.pending)&&a.effect?.getComputedTiming().iterations!==Infinity;
  const active=()=>{const node=${root};return node?(node===document?document.getAnimations():node.getAnimations({subtree:true})).filter(finite):[];};
  const entering=()=>{const node=${root};return Boolean(node?.matches?.('[data-entering]')||node?.querySelector?.('[data-entering]'));};
  const state=()=>{const pending=active().map(a=>({name:a.animationName??a.transitionProperty??a.id??'animation',state:a.playState,pending:a.pending,time:a.currentTime})).concat(entering()?[{name:'data-entering',state:'entering'}]:[]);return {settled:pending.length===0,pending};};
  // Preserve the original final-paint grace, including when the animation deadline just elapsed.
  const frames=()=>new Promise(resolve=>{const timer=setTimeout(()=>resolve(false),Math.max(0,deadline-performance.now())+500);requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(timer);resolve(true);}));});
  for(;;){
   // An empty list before the entering style is removed is not a settled panel.
   // React commits and CSS transition creation can each take another frame.
   if(!await frames())return state();
   let list=active();
   if(!list.length&&!entering()){
    if(!await frames())return state();
    list=active();if(!list.length&&!entering())return {settled:true};
   }
   const left=deadline-performance.now();
   if(left<=0)return state();
   if(list.length)await new Promise(resolve=>{const timer=setTimeout(resolve,left);Promise.all(list.map(a=>a.finished.catch(()=>null))).then(()=>{clearTimeout(timer);resolve();});});
  }
 })()`) as {settled:boolean;pending?:unknown[]};
 if(!result?.settled)throw new Error('ANIMATIONS_NOT_SETTLED '+JSON.stringify(result?.pending??null));
}
