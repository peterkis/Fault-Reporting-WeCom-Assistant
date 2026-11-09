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
  for(let list=active();list.length;list=active()){
   const left=deadline-performance.now();
   if(left<=0)return {settled:false,pending:list.map(a=>({name:a.animationName??a.transitionProperty??a.id??'animation',state:a.playState,pending:a.pending,time:a.currentTime}))};
   await Promise.race([Promise.all(list.map(a=>a.finished.catch(()=>null))),new Promise(resolve=>setTimeout(resolve,left))]);
  }
  const frames=await Promise.race([new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true)))),new Promise(resolve=>setTimeout(()=>resolve(false),Math.max(0,deadline-performance.now())+500))]);
  return frames?{settled:true}:{settled:false,pending:[{name:'requestAnimationFrame',state:'not-rendering'}]};
 })()`) as {settled:boolean;pending?:unknown[]};
 if(!result?.settled)throw new Error('ANIMATIONS_NOT_SETTLED '+JSON.stringify(result?.pending??null));
}
