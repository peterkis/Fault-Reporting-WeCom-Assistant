import assert from 'node:assert/strict';
import {waitForAnimationsSettled} from './browser-animations.mjs';

export interface MotionBrowser {evaluate(expression:string):Promise<unknown>;command(method:string,params?:Record<string,unknown>):Promise<unknown>}
export interface MotionMeasurement {duration:number;easing:string;properties:string[];name:string}
const frameMetadata=new Set(['offset','computedOffset','easing','composite']);
/** Includes CSS transitions. Each explicit CSS exception must be named at its call site. */
export async function assertMotion(browser:MotionBrowser,selector:string,durationToken:string,easingToken:string,{subtree=false,cssExceptions=[]}:{subtree?:boolean;cssExceptions?:string[]}={}):Promise<MotionMeasurement[]>{
  const observed=await browser.evaluate(`(()=>{
    const node=document.querySelector(${JSON.stringify(selector)});if(!node)throw Error('MOTION_TARGET_MISSING');
    const root=getComputedStyle(document.documentElement),raw=root.getPropertyValue(${JSON.stringify(durationToken)}).trim();
    const duration=parseFloat(raw)*(raw.endsWith('ms')?1:1000),easing=root.getPropertyValue(${JSON.stringify(easingToken)}).trim();
    // CSSOM canonicalises whitespace/numbers in curves; use the browser's parser for both sides.
    const canonical=new KeyframeEffect(null,[],{easing}).getTiming().easing;
    const animations=node.getAnimations({subtree:${subtree}}).map(animation=>({
      duration:animation.effect.getTiming().duration,easing:animation.effect.getTiming().easing,
      properties:[...new Set(animation.effect.getKeyframes().flatMap(frame=>Object.keys(frame)))],
      name:animation.transitionProperty??animation.animationName??'WAAPI',
    }));return {duration,easing:canonical,animations};
  })()`);
  assert.ok(observed&&typeof observed==='object'&&'duration' in observed&&'easing' in observed&&'animations' in observed&&Array.isArray(observed.animations));
  assert.ok(observed.animations.length>0,selector+' must produce an observable animation');
  const allowed=new Set(['transform','opacity','backgroundColor','background-color',...cssExceptions]),measurements:MotionMeasurement[]=[];
  for(const animation of observed.animations){
    assert.ok(animation&&typeof animation==='object'&&'duration' in animation&&typeof animation.duration==='number'&&'easing' in animation&&typeof animation.easing==='string'&&'properties' in animation&&Array.isArray(animation.properties)&&'name' in animation&&typeof animation.name==='string');
    assert.equal(animation.duration,observed.duration,selector+' '+animation.name+' duration');assert.equal(animation.easing,observed.easing,selector+' '+animation.name+' easing');
    const properties:string[]=[];for(const property of animation.properties){assert.equal(typeof property,'string');if(typeof property!=='string'||frameMetadata.has(property))continue;assert.ok(allowed.has(property),selector+' unexpected animated property '+property);properties.push(property);}
    measurements.push({duration:animation.duration,easing:animation.easing,properties,name:animation.name});
  }
  return measurements;
}
export async function assertNoTransformAnimations(browser:MotionBrowser,selector:string){
  const result=await browser.evaluate(`(()=>{const root=document.querySelector(${JSON.stringify(selector)});if(!root)throw Error('MOTION_TARGET_MISSING');return root.getAnimations({subtree:true}).flatMap(animation=>animation.effect.getKeyframes()).some(frame=>['transform','translate','scale','rotate'].some(key=>key in frame));})()`);
  assert.equal(result,false,selector+' has no transform animation under reduced motion');
}
/** Capture the first element below the expanding block on ten consecutive frames, including endpoints. */
export async function assertMonotonicCollapse(browser:MotionBrowser,trigger:string,below:string,direction:'expand'|'collapse'){
  await waitForAnimationsSettled(browser);
  const observed=await browser.evaluate(`(async()=>{
    const node=document.querySelector(${JSON.stringify(below)}),trigger=document.querySelector(${JSON.stringify(trigger)});
    if(!node||!trigger)throw Error('COLLAPSE_TARGET_MISSING');const points=[node.getBoundingClientRect().top];trigger.click();
    for(let i=0;i<10;i++){await new Promise(resolve=>requestAnimationFrame(resolve));points.push(node.getBoundingClientRect().top);}return points;
  })()`);
  assert.ok(Array.isArray(observed)&&observed.every(point=>typeof point==='number'));
  const points=observed.filter((point):point is number=>typeof point==='number');
  for(let index=1;index<points.length;index++){const previous=points[index-1],current=points[index];assert.ok(previous!==undefined&&current!==undefined);assert.ok(direction==='expand'?current>=previous:current<=previous,'collapse top must be monotonic: '+JSON.stringify(points));}
  assert.ok(points[0]!==points.at(-1),'sample must observe actual movement');
  await waitForAnimationsSettled(browser);return points;
}
