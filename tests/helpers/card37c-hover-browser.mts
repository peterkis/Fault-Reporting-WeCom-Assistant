import assert from 'node:assert/strict';
import {waitForAnimationsSettled} from './browser-animations.mjs';
import type {launchSystemBrowser} from './p2-006-browser-harness.mjs';
export type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
export const card='[data-hover-card]';
export const person='[data-hover-card="person"]';
export const ticket='[data-hover-card="ticket"]';
export const q=(s:string)=>'document.querySelector('+JSON.stringify(s)+')';

export const exists=(selector:string)=>'Boolean('+q(selector)+')';

export async function point(b:Browser,selector:string){
  await b.waitFor(exists(selector));
  await b.evaluate(q(selector)+".scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})");
  await waitForAnimationsSettled(b);
  const xy=await b.evaluate(`(()=>{const n=${q(selector)},r=n.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
    if(!n.contains(document.elementFromPoint(x,y)))throw Error('obscured trigger '+n.outerHTML.slice(0,180));return [x,y];})()`);
  assert.ok(Array.isArray(xy)&&xy.length===2&&xy.every(x=>typeof x==='number'));
  return {x:Number(xy[0]),y:Number(xy[1])};
}
export async function move(b:Browser,xy:{x:number;y:number}){
  await b.command('Input.dispatchMouseEvent',{type:'mouseMoved',...xy});
}
export async function hover(b:Browser,selector:string){await move(b,await point(b,selector));}
export async function escape(b:Browser){
  for(const type of ['rawKeyDown','keyUp'])await b.command('Input.dispatchKeyEvent',{type,key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
}
export async function navigate(b:Browser,url:string,ready:string){
  await move(b,{x:2,y:2});await b.evaluate('window.leaving37=true');
  await b.command('Page.navigate',{url});
  await b.waitFor('Boolean(!window.leaving37&&window.probe37&&('+ready+'))');
}
export async function observe(b:Browser){
  // Install before page code. Date displacement exercises TanStack freshness, while monotonic
  // pointer/DOM times and provider response gates stay on the real clock.
  await b.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
    const params=new URLSearchParams(location.search),r=window.probe37={requests:[],mounts:[],exits:[],skeletons:[],entries:[],leaves:[],pages:{},offset:0};
    const clock=Date.now.bind(Date);Date.now=()=>clock()+r.offset;
    const now=()=>performance.now();
    document.addEventListener('pointerover',e=>{const t=e.target.closest?.('[data-hover-card-trigger]');if(t&&!t.contains(e.relatedTarget))r.entries.push({id:t.id,at:now()});},true);
    document.addEventListener('pointerout',e=>{const t=e.target.closest?.('[data-hover-card]');if(t&&!t.contains(e.relatedTarget))r.leaves.push(now());},true);
    new MutationObserver(records=>{
      for(const m of records){
        if(m.type==='attributes'&&m.target.matches('[data-hover-card][data-exiting]'))r.exits.push(now());
        for(const node of m.addedNodes){
          if(node.nodeType!==1)continue;
          for(const popup of [...(node.matches('[data-hover-card]')?[node]:[]),...node.querySelectorAll('[data-hover-card]')]){
            r.mounts.push({at:now(),kind:popup.dataset.hoverCard,id:popup.id});
          }
          if((node.matches('[data-skeleton]')||node.querySelector('[data-skeleton]'))&&node.closest('[data-hover-card=ticket]'))r.skeletons.push(now());
        }
      }
    }).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['data-exiting']});
    const real=window.fetch.bind(window);
    window.fetch=async(input,init)=>{
      const url=new URL(input instanceof Request?input.url:input,location.href),path=url.pathname;
      if(path==='/api/workbench/people/profile'||path==='/api/workbench/search'||/^\\/api\\/workbench\\/items\\/(ticket|intake|review)\\/[^/]+$/.test(path)){
        r.requests.push({path,body:init?.body??null,at:now(),open:Boolean(document.querySelector('[data-hover-card]:not([data-exiting])'))});
      }
      const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
      if(path==='/api/workbench/people/profile')return params.get('department')==='unavailable'
        ?json({error:{code:'P2_016_PROVIDER_UNAVAILABLE'}},503)
        :json({name:JSON.parse(init.body).display_name,department:'信息科（合成）'});
      if(path.endsWith('/'+params.get('ticket'))&&params.has('fault')){
        const fault=params.get('fault');
        if(fault==='hold')await new Promise(resolve=>{r.releaseDetail=resolve;});
        else return json({error:{code:fault==='403'?'P2_016_FORBIDDEN':'P2_016_NOT_FOUND'}},Number(fault));
      }
      const response=await real(input,init);
      if(path==='/api/lifecycle/bootstrap'&&response.ok)return json({...await response.json(),current_profile_available:true});
      if(path==='/api/workbench/profile')return json({name:'林舟（合成）',department:'设备科（合成）'});
      if(path==='/api/workbench/board'&&response.ok){
        const page=await response.clone().json();
        r.pages[url.searchParams.get('column')]=page.items;
      }
      return response;
    };
  })()`});
}
