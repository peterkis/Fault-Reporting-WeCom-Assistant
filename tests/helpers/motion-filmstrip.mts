import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import sharp from 'sharp';
import type {MotionBrowser} from './motion-assert.mjs';

interface ScreenshotBrowser extends MotionBrowser {screenshot():Promise<string>}
/** Bind once. Prepare scrolling/hover before capture; trigger only starts the desired effect. */
export function createFilmstripCapture(browser:ScreenshotBrowser,directory:string){
  return async function captureFilmstrip(name:string,trigger:()=>Promise<unknown>,selector:string,{finishAtLastFrame=false,initialFrame}:{finishAtLastFrame?:boolean;initialFrame?:string}={}){
    assert.match(name,/^[a-z0-9-]+$/);await mkdir(directory,{recursive:true});
    const key='__motionFilmstrip_'+name.replaceAll('-','_');
    await browser.command('Animation.enable');
    try{
      const bounds:number[][]=[];
      const measureBounds=async()=>{
        const result=await browser.evaluate(`(()=>{const rects=[...document.querySelectorAll(${JSON.stringify(selector)})].map(node=>node.getBoundingClientRect()).filter(r=>r.width>0&&r.height>0);const local=rects.filter(r=>r.width<innerWidth||r.height<innerHeight),regions=local.length?local:rects;return [Math.min(...regions.map(r=>r.left)),Math.min(...regions.map(r=>r.top)),Math.max(...regions.map(r=>r.right)),Math.max(...regions.map(r=>r.bottom)),innerWidth,innerHeight];})()`);
        assert.ok(Array.isArray(result)&&result.length===6&&result.every(value=>typeof value==='number'&&Number.isFinite(value)),'filmstrip target must have visible bounds');bounds.push(result);
      };
      // A departing overlay can unmount before the incoming animation starts.
      // Keep its actual pixels and bounds for the same crop as the later frames.
      let initialScreenshot:string|undefined;
      if(initialFrame){await measureBounds();initialScreenshot=await browser.screenshot();}
      // Freeze before the input round-trip. rAF still runs and creates CSS transitions at rate zero.
      await browser.command('Animation.setPlaybackRate',{playbackRate:0});await trigger();
      const observation=await browser.evaluate(`(async()=>{
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const nodes=[...document.querySelectorAll(${JSON.stringify(selector)})];
        const all=[...new Set(nodes.flatMap(node=>node.getAnimations({subtree:true})))],animations=all.filter(animation=>Number.isFinite(animation.effect?.getComputedTiming().duration));
        for(const animation of animations)animation.pause();window[${JSON.stringify(key)}]=animations;
        return {count:animations.length,documentAnimations:document.getAnimations().length,selectorNodeCount:nodes.length,nodeAnimations:all.length,
          targets:nodes.map(node=>{const style=getComputedStyle(node);return {id:node.id,transform:style.transform,transitionProperty:style.transitionProperty,transitionDuration:style.transitionDuration,active:node.matches(':active'),dataPressed:node.getAttribute('data-pressed')};}),
          motionAttributes:Object.fromEntries([...document.documentElement.attributes].filter(attribute=>attribute.name.startsWith('data-motion')).map(attribute=>[attribute.name,attribute.value])),
          reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches};
      })()`);
      assert.ok(observation&&typeof observation==='object'&&'count' in observation&&typeof observation.count==='number','filmstrip observation missing');
      const count=observation.count;
      if(!count)await writeFile(join(directory,name+'-failure.json'),JSON.stringify(observation,null,2)+'\n');
      assert.ok(count>0,'filmstrip must pause real animations: '+name+' '+JSON.stringify(observation));
      const seek=async(fraction:number)=>browser.evaluate(`(async()=>{for(const animation of window[${JSON.stringify(key)}])animation.currentTime=Number(animation.effect.getComputedTiming().duration)*${fraction};await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));})()`);
      // Use the union over all samples, so the expanding E3 container never changes crop mid-strip.
      for(const fraction of [0,.25,.5,.75,1]){
        await seek(fraction);
        await measureBounds();
      }
      const viewport=bounds[0];assert.ok(viewport);const viewportWidth=viewport[4],viewportHeight=viewport[5];assert.ok(viewportWidth&&viewportHeight);
      const margin=16,left=Math.max(0,Math.floor(Math.min(...bounds.map(rect=>rect[0]??0))-margin)),top=Math.max(0,Math.floor(Math.min(...bounds.map(rect=>rect[1]??0))-margin));
      const right=Math.min(viewportWidth,Math.ceil(Math.max(...bounds.map(rect=>rect[2]??0))+margin)),bottom=Math.min(viewportHeight,Math.ceil(Math.max(...bounds.map(rect=>rect[3]??0))+margin));
      assert.ok(right>left&&bottom>top,'filmstrip region must intersect the viewport');
      const frames:Buffer[]=[];
      const appendFrame=async(base64:string)=>{
        const screenshot=Buffer.from(base64,'base64'),metadata=await sharp(screenshot).metadata();assert.ok(metadata.width&&metadata.height);
        const sx=metadata.width/viewportWidth,sy=metadata.height/viewportHeight,x=Math.floor(left*sx),y=Math.floor(top*sy);
        frames.push(await sharp(screenshot).extract({left:x,top:y,width:Math.min(metadata.width-x,Math.ceil((right-left)*sx)),height:Math.min(metadata.height-y,Math.ceil((bottom-top)*sy))}).png().toBuffer());
      };
      if(initialScreenshot)await appendFrame(initialScreenshot);
      for(const fraction of [0,.25,.5,.75,1]){
        await seek(fraction);
        if(fraction===1&&finishAtLastFrame){
          // Seeking a paused FLIP to 100% can leave its finished promise pending. Capture the chained cue at onset.
          await browser.evaluate(`(async()=>{for(const animation of window[${JSON.stringify(key)}])animation.finish();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));})()`);
        }
        await appendFrame(await browser.screenshot());
      }
      const metadata=await sharp(frames[0]).metadata();assert.ok(metadata.width&&metadata.height);
      const width=metadata.width,height=metadata.height;
      const file=join(directory,name+'.png');
      await sharp({create:{width:width*frames.length,height,channels:4,background:{r:255,g:255,b:255,alpha:1}}}).composite(frames.map((input,index)=>({input,left:index*width,top:0}))).png().toFile(file);
      const samples=[0,25,50,75,100];
      await writeFile(join(directory,name+'.json'),JSON.stringify({selector,frames:initialFrame?[initialFrame,...samples]:samples,animations:count,clip:{left,top,right,bottom},width:width*frames.length,height},null,2)+'\n');
      return file;
    }finally{
      try{await browser.evaluate(`(()=>{for(const animation of window[${JSON.stringify(key)}]??[])try{animation.finish();}catch{}delete window[${JSON.stringify(key)}];})()`);}
      finally{await browser.command('Animation.setPlaybackRate',{playbackRate:1});}
    }
  };
}
