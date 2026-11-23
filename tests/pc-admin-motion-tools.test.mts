import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {runInNewContext} from 'node:vm';
import sharp from 'sharp';
import {resolve,dirname} from 'node:path';
import {transpileModule,ModuleKind,ScriptTarget} from 'typescript';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';

const root=process.env.TS_MIGRATION_TEST_SOURCE_ROOT??process.cwd(),modules=new Map<string,Promise<string>>();
async function motionModule(name:string):Promise<string>{
  const file=resolve(root,'app/pc-admin/src/design/motion',name);
  let pending=modules.get(file);if(pending)return pending;
  pending=(async()=>{
    const output=transpileModule(await readFile(file,'utf8'),{compilerOptions:{module:ModuleKind.ESNext,target:ScriptTarget.ES2022,jsx:4,verbatimModuleSyntax:true}}).outputText.replace(/import ['"][^'"]+\.css['"];?/g,'');
    let code=output;
    for(const match of [...output.matchAll(/from\s*(['"])([^'"]+)\1/g)]){
      const target=match[2];if(!target)continue;
      const url=target.startsWith('.')?await motionModule(resolve(dirname(file),target+'.ts')):import.meta.resolve(target);
      code=code.replace(match[0],'from '+JSON.stringify(url));
    }
    return 'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
  })();modules.set(file,pending);return pending;
}
type Frames=Record<string,string|number>[];
class FakeAnimation {
  playState='running';currentTime:number|null=0;
  finished:Promise<void>;resolve:()=>void=()=>{};reject:()=>void=()=>{};
  effect:{frames:Frames;timing:{duration:number;easing?:string}};
  constructor(effect:{frames:Frames;timing:{duration:number;easing?:string}}){this.effect=effect;this.finished=new Promise<void>((yes,no)=>{this.resolve=yes;this.reject=()=>no(new Error('cancelled'));});void this.finished.catch(()=>{});}
  finish(){this.playState='finished';this.resolve();}
  cancel(){this.playState='idle';this.currentTime=null;this.reject();}
}
class FakeElement {
  style={backgroundColor:'',boxShadow:'',zIndex:''};left=0;top=0;
  translation={left:0,top:0};
  animations:FakeAnimation[]=[];
  getBoundingClientRect(){const moving=this.animations.some(animation=>animation.playState==='running');return {left:this.left+(moving?this.translation.left:0),top:this.top+(moving?this.translation.top:0)};}
  animate(frames:Frames,timing:{duration:number;easing?:string}){const animation=new FakeAnimation({frames,timing});this.animations.push(animation);return animation;}
}
const values=new Map([['--dur-base','180ms'],['--dur-highlight','1200ms'],['--dur-move','320ms'],['--ease-standard','cubic-bezier(.2, 0, 0, 1)'],['--stage-intake-bg','yellow'],['--stage-active-bg','blue'],['--stage-done-bg','green'],['--brand-subtle','brand']]);
const mediaListeners=new Set<()=>void>(),visibilityListeners=new Set<()=>void>();
const preference={matches:false,addEventListener:(_name:string,fn:()=>void)=>mediaListeners.add(fn)},documentStub={hidden:false,timeline:{},documentElement:{toggleAttribute:()=>{}},addEventListener:(_name:string,fn:()=>void)=>visibilityListeners.add(fn)};
const globals=['window','document','getComputedStyle','Animation','KeyframeEffect'] as const;
const originals=new Map(globals.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
Object.defineProperties(globalThis,{
  window:{configurable:true,value:{matchMedia:()=>preference}},document:{configurable:true,value:documentStub},
  getComputedStyle:{configurable:true,value:()=>({backgroundColor:'white',getPropertyValue:(name:string)=>values.get(name)??''})},
  KeyframeEffect:{configurable:true,value:class {target:unknown;frames:Frames;timing:{duration:number;easing?:string};constructor(target:unknown,frames:Frames,timing:{duration:number;easing?:string}){this.target=target;this.frames=frames;this.timing=timing;}}},
  Animation:{configurable:true,value:FakeAnimation},
});

test('Card36A settle waits for delayed CSS transition creation after the entering frame',async()=>{
  const {waitForAnimationsSettled}:{waitForAnimationsSettled:(browser:{evaluate:(expression:string)=>Promise<unknown>},selector:string)=>Promise<void>}=await import(await motionModule(resolve(root,'tests/helpers/browser-animations.mts')));
  let frame=0,finish:()=>void=()=>{};
  const animation={playState:'running',pending:false,effect:{getComputedTiming:()=>({iterations:1})},finished:new Promise<void>(resolve=>{finish=resolve;})};
  const node={matches:()=>frame<2,querySelector:()=>null,getAnimations:()=>{if(frame>=3&&animation.playState==='running'){setImmediate(()=>{animation.playState='finished';finish();});return [animation];}return [];}};
  const browser={evaluate:async(expression:string)=>runInNewContext(expression,{document:{querySelector:()=>node},performance,setTimeout,clearTimeout,requestAnimationFrame:(callback:()=>void)=>setImmediate(()=>{frame++;if(frame===5){animation.playState='finished';finish();}callback();})})};
  await waitForAnimationsSettled(browser,'.panel');assert.ok(frame>=6,'must recheck after the entering attribute clears and the delayed transition finishes');
});

test('Card36A settle preserves the 500ms frame grace and accepts an expired but quiet page',async()=>{
  const {waitForAnimationsSettled}:{waitForAnimationsSettled:(browser:{evaluate:(expression:string)=>Promise<unknown>},selector:string,timeoutMs:number)=>Promise<void>}=await import(await motionModule(resolve(root,'tests/helpers/browser-animations.mts')));
  for(const rendering of [true,false]){
    let now=0,next=0,done=false,failure:unknown;const delays:number[]=[],tasks=new Map<number,{at:number;run:()=>void}>();
    const schedule=(run:()=>void,delay:number)=>{const id=++next;tasks.set(id,{at:now+delay,run});return id;};
    const node={matches:()=>false,querySelector:()=>null,getAnimations:()=>[]};
    const browser={evaluate:async(expression:string)=>runInNewContext(expression,{document:{querySelector:()=>node},performance:{now:()=>now},setTimeout:(run:()=>void,delay:number)=>{delays.push(delay);return schedule(run,delay);},clearTimeout:(id:number)=>tasks.delete(id),requestAnimationFrame:(run:()=>void)=>rendering?schedule(run,80):0})};
    const pending=waitForAnimationsSettled(browser,'.panel',100).then(()=>{done=true;},error=>{failure=error;done=true;});
    for(let count=0;count<20&&!done;count++){
      await new Promise<void>(resolve=>setImmediate(resolve));if(done)break;
      const task=[...tasks].sort((a,b)=>a[1].at-b[1].at)[0];assert.ok(task,'bounded frame/timer task must exist');tasks.delete(task[0]);now=task[1].at;task[1].run();
    }
    await pending;assert.ifError(failure);assert.equal(done,true);assert.equal(delays[0],600,'original deadline plus the existing 500ms frame grace');
  }
});

test('Card36A filmstrip freezes before triggering, crops real frames and restores playback after success or failure',async()=>{
  const {createFilmstripCapture}:{createFilmstripCapture:(browser:{command:(method:string,params?:Record<string,unknown>)=>Promise<unknown>;evaluate:(expression:string)=>Promise<unknown>;screenshot:()=>Promise<string>},directory:string)=>(name:string,trigger:()=>Promise<unknown>,selector:string,options?:{finishAtLastFrame:boolean})=>Promise<string>}=await import(await motionModule(resolve(root,'tests/helpers/motion-filmstrip.mts')));
  const directory=await mkdtemp(resolve(tmpdir(),'card36a-filmstrip-unit-'));let rate=1,paused=false,finished=false,time=0;const times:number[]=[];
  const animation={effect:{getComputedTiming:()=>({duration:80})},pause:()=>{paused=true;},finish:()=>{finished=true;},get currentTime(){return time;},set currentTime(value:number){time=value;times.push(value);}};
  let effects=true;
  const node={id:'press',matches:()=>false,getAttribute:()=>null,getAnimations:()=>effects?[animation]:[],getBoundingClientRect:()=>({left:40,top:30,right:100,bottom:60,width:60,height:30})};
  const png=await sharp({create:{width:200,height:160,channels:4,background:'#fff'}}).png().toBuffer();
  const browser={command:async(method:string,params?:Record<string,unknown>)=>{if(method==='Animation.setPlaybackRate')rate=Number(params?.playbackRate);return {};},evaluate:async(expression:string)=>runInNewContext(expression,{document:{querySelectorAll:()=>[node]},window:{},innerWidth:200,innerHeight:160,requestAnimationFrame:(fn:()=>void)=>setImmediate(fn)}),screenshot:async()=>png.toString('base64')};
  // Keep the evaluated browser realm between calls, as a real page does.
  const realm={document:{querySelectorAll:()=>[node],getAnimations:()=>effects?[animation]:[],documentElement:{attributes:[]}},window:{},innerWidth:200,innerHeight:160,getComputedStyle:()=>({transform:'none',transitionProperty:'transform',transitionDuration:'0.08s'}),matchMedia:()=>({matches:false}),requestAnimationFrame:(fn:()=>void)=>setImmediate(fn)};
  browser.evaluate=async expression=>runInNewContext(expression,realm);
  try{
    const capture=createFilmstripCapture(browser,directory);
    const file=await capture('press',async()=>{assert.equal(rate,0,'freeze must precede even an 80ms trigger');},'.button');
    const metadata=await sharp(file).metadata();assert.ok(metadata.width&&metadata.width<1000,'five cropped frames, not five full viewports');assert.ok(metadata.height&&metadata.height<160);
    assert.equal(paused,true);assert.equal(finished,true);assert.equal(rate,1);for(const value of [0,20,40,60,80])assert.ok(times.includes(value));
    finished=false;const capturedFinished:boolean[]=[];
    browser.screenshot=async()=>{capturedFinished.push(finished);return png.toString('base64');};
    await capture('rollback',async()=>{},'.button',{finishAtLastFrame:true});
    assert.deepEqual(capturedFinished,[false,false,false,false,true]);
    await assert.rejects(capture('failure',async()=>{throw Error('trigger failed');},'.button'),/trigger failed/);assert.equal(rate,1,'finally restores the page even when the trigger fails');
    effects=false;
    await assert.rejects(capture('no-effects',async()=>{},'.button'),error=>{
      assert.ok(error instanceof Error);for(const field of ['documentAnimations','selectorNodeCount','transform','transitionProperty','transitionDuration','active','dataPressed','motionAttributes','reducedMotion'])assert.ok(error.message.includes(field),field+' diagnostic is required');return true;
    });assert.equal(rate,1);
    const diagnostic:unknown=JSON.parse(await readFile(resolve(directory,'no-effects-failure.json'),'utf8'));assert.ok(diagnostic&&typeof diagnostic==='object'&&'documentAnimations' in diagnostic&&'selectorNodeCount' in diagnostic);assert.equal(diagnostic.documentAnimations,0);assert.equal(diagnostic.selectorNodeCount,1);
  }finally{await rm(directory,{recursive:true,force:true});}
});
interface Motion {
  motionToken:(name:string)=>number|string;prefersReducedMotion:()=>boolean;invalidateMotionTokens:()=>void;
}
const tokens:Motion=await import(await motionModule('tokens.ts'));
const {flip,afterFlip}:{afterFlip:(el:FakeElement,onSettled:()=>void)=>()=>void;flip:(el:FakeElement,from:{left:number;top:number},to:{left:number;top:number},options?:{lift?:boolean})=>FakeAnimation}=await import(await motionModule('flip.ts'));
const {highlight}:{highlight:(el:FakeElement,options:{tone:'intake'|'active'|'done'|'brand'})=>{cancel:()=>void;finished:Promise<void>}}=await import(await motionModule('highlight.ts'));
test('Card36A tools enforce cached CSS timing, reduced/hidden end states, continuation, cap and highlight restart',{concurrency:false},async t=>{
  try{
    await t.test('tokens convert seconds, invalidate cache on matchMedia, and reject invalid/missing numeric tokens',()=>{
      assert.equal(tokens.motionToken('--dur-base'),180);values.set('--dur-base','0.6s');assert.equal(tokens.motionToken('--dur-base'),180);
      for(const listener of mediaListeners)listener();assert.equal(tokens.motionToken('--dur-base'),600);
      values.set('--dur-base','180ms');tokens.invalidateMotionTokens();assert.equal(tokens.motionToken('--dur-base'),180);
      assert.throws(()=>tokens.motionToken('--dur-missing'),/MOTION_TOKEN_INVALID/);
    });
    await t.test('flip samples visual position, animates transform only, restores lift, and releases the six-slot limit',async()=>{
      const el=new FakeElement();el.left=100;el.top=100;const first=flip(el,{left:10,top:20},{left:100,top:100},{lift:true});
      assert.deepEqual(first.effect.frames,[{transform:'translate(-90px, -80px)'},{transform:'translate(0, 0)'}]);assert.equal(el.style.boxShadow,'var(--shadow-3)');
      el.translation={left:-25,top:-20};el.left=200;el.top=200;const second=flip(el,{left:0,top:0},{left:200,top:200});
      assert.equal(first.playState,'idle');assert.equal(second.effect.frames[0]?.transform,'translate(-125px, -120px)');assert.equal(el.style.boxShadow,'');
      const active=[second];for(let index=0;index<5;index++)active.push(flip(new FakeElement(),{left:0,top:0},{left:10,top:10}));
      const seventh=new FakeElement();assert.equal(flip(seventh,{left:0,top:0},{left:10,top:10}).playState,'finished');assert.equal(seventh.animations.length,0);
      for(const animation of active)animation.finish();await Promise.resolve();
      const available=flip(new FakeElement(),{left:0,top:0},{left:10,top:10});assert.equal(available.playState,'running');available.finish();await Promise.resolve();
    });
    await t.test('rollback waits for a later layout effect and replacement FLIP, and cancels on unmount',async()=>{
      const el=new FakeElement(),origin={left:0,top:0},destination={left:80,top:20};
      const shadows:string[]=[];
      afterFlip(el,()=>shadows.push(el.style.boxShadow));
      const first=flip(el,origin,destination,{lift:true});
      await Promise.resolve();assert.equal(shadows.length,0);
      const second=flip(el,destination,origin,{lift:true});
      await Promise.resolve();assert.equal(first.playState,'idle');assert.equal(shadows.length,0);
      const cancel=afterFlip(el,()=>shadows.push('unmounted'));
      await Promise.resolve();cancel();second.finish();await Promise.resolve();
      assert.deepEqual(shadows,[''],'the lift style is restored before the cue');
      preference.matches=true;for(const listener of mediaListeners)listener();
      afterFlip(el,()=>shadows.push('static'));flip(el,origin,destination);
      await Promise.resolve();assert.deepEqual(shadows,['','static']);
      preference.matches=false;for(const listener of mediaListeners)listener();
    });
    await t.test('all highlight tones use one token and repeated updates restart without a stale cleanup',async()=>{
      const el=new FakeElement();el.style.backgroundColor='original';
      for(const [tone,color] of [['intake','yellow'],['active','blue'],['done','green'],['brand','brand']] as const){
        const handle=highlight(el,{tone}),first=el.animations.at(-1);assert.ok(first);assert.equal(first.effect.timing.duration,1200);assert.deepEqual(first.effect.frames,[{backgroundColor:color},{backgroundColor:'white'}]);
        const next=highlight(el,{tone}),animation=el.animations.at(-1);assert.ok(animation);await handle.finished;assert.equal(first.playState,'idle');assert.equal(animation.playState,'running');animation.finish();await next.finished;assert.equal(el.style.backgroundColor,'original');
      }
    });
    await t.test('reduced highlight holds then restores; hidden/reduced flip starts no effect and visibility finishes active effects',async()=>{
      preference.matches=true;for(const listener of mediaListeners)listener();assert.equal(tokens.prefersReducedMotion(),true);
      const el=new FakeElement();assert.equal(flip(el,{left:0,top:0},{left:10,top:10}).playState,'finished');assert.equal(el.animations.length,0);
      values.set('--dur-highlight','10ms');tokens.invalidateMotionTokens();const hold=highlight(el,{tone:'active'});await Promise.resolve();assert.equal(el.style.backgroundColor,'blue');hold.cancel();await hold.finished;assert.equal(el.style.backgroundColor,'');
      await highlight(el,{tone:'done'}).finished;assert.equal(el.style.backgroundColor,'');
      preference.matches=false;for(const listener of mediaListeners)listener();const animation=flip(el,{left:0,top:0},{left:10,top:10});documentStub.hidden=true;for(const listener of visibilityListeners)listener();assert.equal(animation.playState,'finished');
      const hidden=new FakeElement();flip(hidden,{left:0,top:0},{left:10,top:10});highlight(hidden,{tone:'done'});assert.equal(hidden.animations.length,0);documentStub.hidden=false;tokens.invalidateMotionTokens();
    });
    await t.test('NumberRoll exposes only final accessible text and reserves the numeric presentation',async()=>{
      const {NumberRoll}:{NumberRoll:(props:{value:number;animate?:boolean})=>ReturnType<typeof createElement>}=await import(await motionModule('number-roll.tsx'));
      const markup=renderToStaticMarkup(createElement(NumberRoll,{value:123,animate:false}));assert.match(markup,/aria-live="off"/);assert.match(markup,/class="sr-only">123/);assert.match(markup,/<span(?=[^>]*\baria-hidden="true")(?=[^>]*\bdata-value="123")[^>]*>/);
    });
    await t.test('empty segmented controls keep an empty DOM so the original :empty rule still applies',async()=>{
      const {SegmentedControl}:{SegmentedControl:(props:{children?:null})=>ReturnType<typeof createElement>}=await import(await motionModule(resolve(root,'app/pc-admin/src/design/components/SegmentedControl/SegmentedControl.tsx')));
      const markup=renderToStaticMarkup(createElement(SegmentedControl,{children:null}));assert.match(markup,/<div[^>]*><\/div>$/);assert.ok(!markup.includes('ds-segmented-slider'));
    });
  }finally{for(const key of globals){const descriptor=originals.get(key);if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}}
});
