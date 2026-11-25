import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import sharp from 'sharp';
import type {MotionBrowser} from './motion-assert.mjs';

type Browser=Pick<MotionBrowser,'evaluate'>&{screenshot():Promise<string>};
interface Rect {left:number;top:number;right:number;bottom:number}
interface Scene {viewport:{width:number;height:number;dpr:number};rect:Rect|null;elements:unknown[];hits:unknown[];positions:{label:string;x:number;y:number}[]}
export interface Sample {label:string;x:number;y:number;rgb:readonly number[]}

/** Keep the failing frame and viewport coordinates together, including across the live presence fixture. */
export function visualDiagnostics(key:string|undefined,initialBrowser:Browser){
  const directory=key&&process.env.CARD39B_DIAG_DIR;
  let browser=initialBrowser,selector='main, .workspace',stage='setup',saved=false;
  let facts:Record<string,unknown>={},points:Sample[]=[],frame:Buffer|undefined;
  return {
    focus(next:string,phase:string,source=initialBrowser){
      browser=source;selector=next;stage=phase;facts={};points=[];frame=undefined;
    },
    record(values:Record<string,unknown>){if(directory)Object.assign(facts,values);},
    sample(png:Buffer,samples:Sample[]){if(directory){frame=png;points=samples;}},
    async save(error:unknown){
      if(!directory||saved)return;
      try{
        await mkdir(directory,{recursive:true});
        const dest=await mkdtemp(join(directory,key+'-'));
        const png=frame??Buffer.from(await browser.screenshot(),'base64');
        const {width,height}=await sharp(png).metadata();
        const scene=await browser.evaluate(`(()=>{
          const target=document.querySelector(${JSON.stringify(selector)}),vw=innerWidth,vh=innerHeight;
          const root=target??document.querySelector('.ds-work-table-wrap,.board,.workspace');
          const props=['backgroundColor','boxShadow','outlineColor','outlineWidth','outlineOffset','borderTopWidth','borderTopStyle','borderTopColor','borderRadius','position','zIndex','inset','opacity','transform','content','pointerEvents'];
          const style=(el,pseudo)=>{const s=getComputedStyle(el,pseudo);return Object.fromEntries(props.map(k=>[k,s[k]]));};
          const describe=el=>({tag:el.tagName,classes:el.className,item:el.closest('[data-item-id]')?.dataset.itemId??null,
            rect:el.getBoundingClientRect().toJSON(),attributes:{...el.dataset},style:style(el),after:style(el,'::after'),before:style(el,'::before')});
          const nodes=root?[root,root.closest('.ticket-card,.ds-work-row'),...['th','td','.row-link','.ds-ticket-category','.ds-avatar.unassigned'].map(s=>root.querySelector(s)),document.getElementById('card39b-thin-control')].filter(Boolean):[];
          const positions=${JSON.stringify(points.map(({label,x,y})=>({label,x,y})))};
          const r=root?.getBoundingClientRect();
          if(!positions.length){
            const x=Math.max(0,Math.min(vw-1,r?r.left+r.width/2:vw/2)),y=Math.max(0,Math.min(vh-1,r?r.top+r.height/2:vh/2));
            positions.push({label:'diagnostic centre before acceptance samples',x:Math.floor(x*${width}/vw),y:Math.floor(y*${height}/vh)});
          }
          const hits=positions.map(p=>({...p,
            stack:document.elementsFromPoint((p.x+.5)*vw/${width},(p.y+.5)*vh/${height}).slice(0,8).map(el=>({tag:el.tagName,classes:el.className,item:el.closest('[data-item-id]')?.dataset.itemId??null}))}));
          return {viewport:{width:vw,height:vh,dpr:devicePixelRatio},targetFound:Boolean(target),rect:r?.toJSON()??null,elements:[...new Set(nodes)].map(describe),hits,positions};
        })()`) as Scene;
        const sx=width/scene.viewport.width,sy=height/scene.viewport.height,r=scene.rect;
        const {data,info}=await sharp(png).removeAlpha().raw().toBuffer({resolveWithObject:true});
        const samples=scene.positions.map(({label,x,y})=>{
          const i=(y*width+x)*info.channels;
          return {label,x,y,rgb:[...data.subarray(i,i+3)]};
        });
        const xs=samples.map(p=>p.x),ys=samples.map(p=>p.y);
        if(r){xs.push(r.left*sx,r.right*sx);ys.push(r.top*sy,r.bottom*sy);}
        const clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v));
        const left=clamp(Math.floor(Math.min(...xs)-12*sx),0,width-1),top=clamp(Math.floor(Math.min(...ys)-12*sy),0,height-1);
        const right=clamp(Math.ceil(Math.max(...xs)+12*sx),left+1,width),bottom=clamp(Math.ceil(Math.max(...ys)+12*sy),top+1,height);
        let crop={left,top,width:right-left,height:bottom-top};
        // A setup/selector failure can precede the first acceptance pixel. Keep the visible
        // part of the fallback panel around its diagnostic point rather than an entire page.
        const centre=samples[0];
        if(!points.length&&centre){
          const w=Math.min(width,Math.max(30,Math.min(crop.width,800*sx)));
          const h=Math.min(height,Math.max(30,Math.min(crop.height,500*sy)));
          crop={left:clamp(Math.floor(centre.x-w/2),0,width-Math.ceil(w)),top:clamp(Math.floor(centre.y-h/2),0,height-Math.ceil(h)),width:Math.ceil(w),height:Math.ceil(h)};
        }
        await sharp(png).extract(crop).png().toFile(join(dest,'region.png'));
        await writeFile(join(dest,'samples.json'),JSON.stringify({key,stage,selector,error:error instanceof Error?error.message:String(error),image:{width,height,crop},points:samples,facts,scene},null,2)+'\n');
        saved=true;
        console.info('39B failure diagnostics',dest);
      }catch(captureError){console.warn('39B diagnostic capture failed',stage,String(captureError));}
    },
  };
}
export type VisualDiagnostics=ReturnType<typeof visualDiagnostics>;
