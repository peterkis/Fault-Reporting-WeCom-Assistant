import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import {createP2016Runtime} from '../../app/server/src/p2-016-runtime.mjs';
import {migrateTicketStaffCompletion} from '../../app/server/scripts/ticket-staff-completion-migrate.mjs';
import {migrateTicketReopenRounds} from '../../app/server/scripts/ticket-reopen-rounds-migrate.mjs';
import {migrateBotReporterFeedback} from '../../app/server/scripts/bot-reporter-feedback-migrate.mjs';
import {migrateTicketUnassign} from '../../app/server/scripts/ticket-unassign-migrate.mjs';
import {migrateTicketReturnToDispatch} from '../../app/server/scripts/ticket-return-to-dispatch-migrate.mjs';
import {withWeb01Fixture} from './web01-workbench-fixture.mjs';
import {type T11Fixture, t11Http} from './t11-completion-fixture.mjs';
import {launchSystemBrowser, closeBrowserTestResources} from './p2-006-browser-harness.mjs';
import {boardReady, expandPendingBoard, query, seedMotionTicket, ticketCard} from './motion-board-fixture.mjs';
import {waitForAnimationsSettled} from './browser-animations.mjs';
import {createFilmstripCapture} from './motion-filmstrip.mjs';
import {assertNoTransformAnimations} from './motion-assert.mjs';
import {clickWorkbenchControl} from './heroui-workbench-controls.mjs';

export type Browser = NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
export interface Scene {
  f: T11Fixture;
  b: Browser;
  id: string;
  card: string;
  http: Awaited<ReturnType<typeof t11Http>>;
}
const root = process.env.TS_MIGRATION_TEST_SOURCE_ROOT ?? process.cwd();
export const evidence = process.env.CARD37A_EVIDENCE_DIR ?? join(root, '.build', 'card37a-evidence');
export const undo = '.workbench-toast[data-visible=true] [data-toast-action=undo]';
export const closeDialog = '.ds-closure-dialog';
export const confirmClose = closeDialog+' button[type=submit]';
export const closeReason = closeDialog+' input[value=FALSE_REPORT_OR_TEST]';
export const noteText = '撤销与恢复说明（合成）';
export const follow = '[data-action=toggle-item-follow]';
export const visible = (selector:string) => query(selector)+'?.checkVisibility()===true';
export const active = (card:string) => '.board-column.active '+card;
export const pending = (card:string) => '.board-column.pending '+card;
export const counts = `['pending','active'].map(column=>Number(document.querySelector('.board-column.'+column+' .column-heading').getAttribute('aria-label').match(/\\d+$/)[0]))`;
export const indexOf = (card:string) => `[...document.querySelectorAll('.board-column.pending .ticket-card')].indexOf(${query(card)})`;

export const options={timeout:120000};
export const claimPath='/take-and-start';
export const toast=(source:string)=>'.workbench-toast[data-visible=true]:has([data-toast-source="'+source+'"])';
export const heading=(source:string)=>query(toast(source)+' .workbench-toast-purpose')+'?.textContent';
export const claimToast=toast('ticket-self-handling');
export const badge=(card:string)=>card+' [data-optimistic-badge]';
export const moving=(selector:string)=>query(selector)+`?.getAnimations().some(a=>a.effect.getKeyframes()
  .some(f=>typeof f.transform==='string'&&f.transform.startsWith('translate(')))`;

export async function withScene(run:(s:Scene)=>Promise<void>, options:{keyboard?:boolean;followEnabled?:boolean;canReturn?:boolean; motion?:'reduce'|'off'; conversationClaim?:boolean;draftRecovery?:boolean;remindersEnabled?:boolean;takeover?:boolean}={}) {
  await withWeb01Fixture(async (base:T11Fixture)=>{
    await base.runtime.stop();
    const [actor,peer]=base.principals;assert.ok(actor&&peer);
    const runtime=createP2016Runtime({
      pool:base.pool, publicOrigin:base.origin, listenPort:Number(new URL(base.origin).port),
      flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true}, externalSendEnabled:false,
      principalIds:[actor.id,base.outsider.id,peer.id],
      ticketSelfHandlingEnabled:true, ticketReturnToDispatchEnabled:options.canReturn!==false,
      ticketTakeoverEnabled:options.takeover===true,
      ticketConversationSelfHandlingEnabled:options.conversationClaim===true,
      workbenchDraftRecoveryEnabled:options.draftRecovery===true,
      ticketWaitingActionsEnabled:true, workbenchInternalNotesEnabled:true,
      ticketAssignmentEnabled:options.keyboard===true, ticketStaffCompletionEnabled:options.keyboard===true,
      workbenchConversationsEnabled:options.keyboard===true, notificationExceptionsEnabled:options.keyboard===true,
      workbenchSearchEnabled:options.keyboard===true, workbenchManualReportsEnabled:options.keyboard===true,
      workbenchBoardActionsEnabled:true, workbenchFollowEnabled:options.followEnabled!==false,
      workbenchRemindersEnabled:options.remindersEnabled===true,
    });
    let b:Browser|undefined, dev:Awaited<ReturnType<typeof createServer>>|undefined, cache:string|undefined, failure:unknown;
    try {
      const {cookies}=await runtime.start();
      assert.ok(cookies?.[0]);
      const f={...base,runtime,browserCookies:cookies,cookies:cookies.map(c=>c.name+'='+c.value)};
      const id=await seedMotionTicket(f.pool,'待领取的打印机故障');
      let origin=f.origin;
      if(options.motion==='off'){
        cache=await mkdtemp(join(tmpdir(),'card37a-vite-'));
        dev=await createServer({configFile:false,root:join(root,'app/pc-admin'),base:'/workbench/app/',
          cacheDir:cache,plugins:[react(),tailwind()],logLevel:'error',server:{host:'127.0.0.1',port:0,
            fs:{allow:[root]},proxy:{'/api':{target:f.origin,changeOrigin:true,headers:{origin:f.origin}}}}});
        await dev.listen();
        const address=dev.httpServer?.address();assert.ok(address&&typeof address==='object');
        origin='http://127.0.0.1:'+address.port;
      }
      b=await launchSystemBrowser({url:origin+'/workbench/app/?range=all'+(options.motion==='off'?'&motion=off':''),
        width:1920,height:1440,cookies:[{...cookies[0],url:origin+'/'}]});
      assert.ok(b);
      await b.command('Page.bringToFront');
      await b.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:options.motion==='reduce'?'reduce':'no-preference'}]});
      await b.waitFor(boardReady);
      await b.evaluate('document.fonts.ready.then(()=>true)');
      await expandPendingBoard(b);
      await b.evaluate("document.querySelector('.board-column.active [data-action=expand-column][aria-expanded=false]')?.click()");
      const card=ticketCard(id);
      await b.waitFor(visible(pending(card)));
      await waitForAnimationsSettled(b);
      await run({f,b,id,card,http:await t11Http(f,0,{closeConnections:true})});
    } catch(error){failure=error;}
    finally{await closeBrowserTestResources([()=>b?.close(),()=>dev?.close(),()=>cache&&rm(cache,{recursive:true,force:true}),()=>runtime.stop()],failure);}
  },{ticketSelfHandlingEnabled:true,workbenchFollowEnabled:true,precisionV212:true,partialSchemaOnly:true,beforeClosureMigration:async({databaseUrl})=>{
    if(options.keyboard){
      await migrateTicketStaffCompletion({databaseUrl,mode:'apply'});
      await migrateTicketReopenRounds({databaseUrl,mode:'apply'});
      await migrateBotReporterFeedback({databaseUrl,mode:'apply'});
    }
    await migrateTicketUnassign({databaseUrl,mode:'apply'});
    await migrateTicketReturnToDispatch({databaseUrl,mode:'apply'});
  }});
}

// Like the board harness, intercept the browser's fetch. A held write has no server side effect
// until released. Numeric delays gate the real HTTP response, measured from dispatch.
export async function routeWrite(b:Browser,suffix:string,mode:'hold'|'hang'|'reject'|number){
  await b.evaluate(`(()=>{
    const original=window.fetch.bind(window), suffix=${JSON.stringify(suffix)}, mode=${JSON.stringify(mode)};
    let release;const gate=new Promise(resolve=>{release=resolve});
    const state=window.card37Route={started:0,ack:0,status:null,release,body:null,used:false};
    window.fetch=async(input,init)=>{
      if(state.used||init?.method!=='POST'||!new URL(input,location.href).pathname.endsWith(suffix))return original(input,init);
      state.used=true;state.started=performance.now();state.body=JSON.parse(init.body);
      if(mode==='hang')return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));
      let response;
      if(typeof mode==='number'){
        [response]=await Promise.all([original(input,init),new Promise(resolve=>setTimeout(resolve,mode))]);
      }else{
        await gate;
        response=mode==='reject'?new Response(JSON.stringify({error:{code:'P2_016_VERSION_CONFLICT'}}),{status:409,headers:{'Content-Type':'application/json'}}):await original(input,init);
      }
      state.status=response.status;state.ack=performance.now();return response;
    };
  })()`);
}

export async function prepareClaim(b:Browser,card:string){
  await b.evaluate(query(card+' .card-open')+'.focus({preventScroll:true})');
  const button=card+' [data-board-claim-action]';
  await b.waitFor(query(button)+'?.disabled===false');
  return button;
}
export async function claim(b:Browser,card:string){await clickWorkbenchControl(b,await prepareClaim(b,card));}
export async function openDetail(s:Scene){
  await clickWorkbenchControl(s.b,s.card+' .card-open');
  await s.b.waitFor(visible('#detail-title'));
}
export async function fillClose(s:Scene,reason:'REPORTER_WITHDREW'|'FALSE_REPORT_OR_TEST'='FALSE_REPORT_OR_TEST'){
  await openDetail(s);
  // The loading skeleton already has a detail title. The disclosure helper
  // needs the actual action to find and open its enclosing menu.
  const closeAction='.ds-drawer-more [data-action=cancel]';
  await s.b.waitFor(query(closeAction)+'?.disabled===false');
  await clickWorkbenchControl(s.b,closeAction);
  await s.b.waitFor(visible(closeDialog));
  await clickWorkbenchControl(s.b,closeDialog+' input[value="'+reason+'"]');
  await s.b.evaluate(query(closeDialog+' textarea')+'.focus()');
  await s.b.command('Input.insertText',{text:noteText});
  await s.b.waitFor(query(confirmClose)+'?.disabled===false');
}
export async function settleBoardAndDrawer(b:Browser){
  await waitForAnimationsSettled(b,'.board');
  await waitForAnimationsSettled(b,'.workbench-drawer-backdrop');
  // The collapsed-column flight clone and some toast hosts live outside both subtrees.
  await waitForAnimationsSettled(b);
  await b.waitFor('!document.querySelector("[data-motion-flight],[data-motion-flipping=true]")');
}

type StillName='undo-claim-toast'|'undo-dismiss-toast'|'undo-done-toast'|'claim-conflict-rollback'|'card-pending-badge';
export async function screenshot(b:Browser,name:StillName,ready:string,toastSelector?:string){
  if(toastSelector){
    await b.waitFor(visible(toastSelector));
    await waitForAnimationsSettled(b,toastSelector);
    const point=await b.evaluate(`(()=>{const r=${query(toastSelector)}.getBoundingClientRect();
      return {x:r.left+r.width/2,y:r.top+r.height/2};})()`) as {x:number;y:number};
    await b.command('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
    await b.waitFor(query(toastSelector)+'?.matches(":hover")');
  }
  // The pending badge is evidence of the still-outstanding request. All other stills require handoff.
  const projection=name==='card-pending-badge'?'true':'!document.querySelector("[data-optimistic-state]")';
  const state=`(${boardReady})&&(${ready})&&(${projection})`+(toastSelector?'&&'+visible(toastSelector):'');
  await b.waitFor(state);
  await settleBoardAndDrawer(b);
  assert.equal(await b.evaluate(state),true,name+' capture state changed while settling');
  assert.equal(await b.evaluate(`[...document.querySelectorAll('.board .ds-number-roll-old[data-value]')]
    .some(digit=>Number(getComputedStyle(digit).opacity)>0)`),false,name+' still shows outgoing count digits');
  const png=await b.screenshot();
  await mkdir(evidence,{recursive:true});
  await writeFile(join(evidence,name+'.png'),Buffer.from(png,'base64'));
}
export async function ctrlZ(b:Browser,nativeEdit=false){
  // CDP's editing command supplies the Windows Control+Z editing binding on a macOS Chrome host.
  const key={key:'z',code:'KeyZ',modifiers:2,windowsVirtualKeyCode:90};
  await b.command('Input.dispatchKeyEvent',{type:'rawKeyDown',...key,...(nativeEdit?{commands:['Undo']}:{})});
  await b.command('Input.dispatchKeyEvent',{type:'keyUp',...key});
}

export async function startTrace(b:Browser,card:string,watchRollback=false){
  await b.evaluate(`(()=>{
    const card=${JSON.stringify(card)}, node=()=>document.querySelector(card);
    const trace=window.card37Trace={clicked:null,moved:null,counts:null,badge:false,rollback:false,
      unknownAt:null,badgeAt:null,moveTimes:[],transforms:[],flashStarts:[],stop:null};
    const seen=new WeakSet();
    const probe=document.createElement('span');probe.style.color='var(--tone-danger-dot)';
    document.body.append(probe);const danger=getComputedStyle(probe).color;probe.remove();
    const nativeAnimate=Element.prototype.animate,flashes=new Map();
    function flashPosition(el){
      const rect=el.getBoundingClientRect(),x=rect.left+rect.width/2;
      const columns=[...document.querySelectorAll('.board-column')];
      const visual=columns.find(col=>{const r=col.getBoundingClientRect();return x>=r.left&&x<r.right;});
      const stage=col=>['pending','active','handled'].find(name=>col?.classList.contains(name))??null;
      const pending=document.querySelector('.board-column.pending').getBoundingClientRect();
      const active=document.querySelector('.board-column.active').getBoundingClientRect();
      const between=x>=pending.right&&x<active.left||x>=active.right&&x<pending.left;
      return {dom:stage(el.closest('.board-column')),visual:stage(visual)??(between?'returning':'outside'),
        index:[...document.querySelectorAll('.board-column.pending .ticket-card')].indexOf(el),x};
    }
    if(${watchRollback}){
      Element.prototype.animate=function(...args){
        const animation=nativeAnimate.apply(this,args);
        if(this.matches(card)&&animation.effect.getKeyframes().some(f=>f.boxShadow?.includes('1.5px')&&f.boxShadow.includes(danger))){
          const observation={start:animation.effect.getTiming().delay>0?null:flashPosition(this),firstFrame:null,inActive:null,finished:false,
            reminder:this.closest('.reminder-location')!==null};
          void animation.finished.then(()=>{observation.finished=true;},()=>{});
          trace.flashStarts.push(observation);
          flashes.set(animation,{el:this,observation});
        }
        return animation;
      };
    }
    function sampleFlashes(){
      for(const [animation,{el,observation}] of flashes){
        if(!el.isConnected||['finished','idle'].includes(animation.playState)){flashes.delete(animation);continue;}
        if(animation.effect.getComputedTiming().progress===null||!getComputedStyle(el).boxShadow.includes(danger))continue;
        // FLIP can install its transform later in the same React commit as the outline.
        // Its DOM parent alone cannot tell us where Chrome is painting this frame.
        const here=flashPosition(el);
        observation.start??=here;
        observation.firstFrame??=here;
        if(here.dom==='active'||here.visual==='active')observation.inActive??=here;
      }
    }
    function sample(){
      const c=node(),now=performance.now();
      if(c?.closest('.board-column.active')&&trace.moved===null&&trace.clicked!==null){trace.moved=now;trace.counts=${counts};}
      if(c?.querySelector('[data-optimistic-badge]')){trace.badge=true;trace.badgeAt??=now;}
      if(c?.dataset.optimisticState==='unknown'&&document.querySelector('[data-action=check-self-handling]'))trace.unknownAt??=now;
      for(const a of c?.getAnimations()??[]){
        if(seen.has(a))continue;seen.add(a);
        const frames=a.effect.getKeyframes();
        if(frames.some(f=>typeof f.transform==='string'&&f.transform.startsWith('translate')))trace.moveTimes.push(now);
        if(frames.some(f=>['transform','translate','scale','rotate'].some(k=>k in f)))trace.transforms.push(now);
        if(c.dataset.optimisticRollback==='true'&&frames.some(f=>f.boxShadow?.includes('1.5px')&&f.boxShadow.includes(danger)))trace.rollback=true;
      }
    }
    const obs=new MutationObserver(records=>{
      for(const r of records)for(const n of r.addedNodes)if(n.nodeType===1&&(n.matches('[data-optimistic-badge]')||n.querySelector('[data-optimistic-badge]'))){
        if(n.closest(card)||n.matches(card)||n.querySelector(card))trace.badge=true;
      }
      sample();
    });
    obs.observe(document.body,{childList:true,attributes:true,subtree:true});
    let raf;const frame=()=>{sample();sampleFlashes();raf=requestAnimationFrame(frame);};raf=requestAnimationFrame(frame);
    const click=e=>{if(e.target.closest(card+' [data-board-claim-action]'))trace.clicked??=performance.now();};
    document.addEventListener('click',click,true);
    trace.stop=()=>{sample();obs.disconnect();cancelAnimationFrame(raf);document.removeEventListener('click',click,true);
      if(${watchRollback})Element.prototype.animate=nativeAnimate;};
  })()`);
}

interface FlashPosition {dom:string|null;visual:string|null;index:number;x:number}
interface FlashStart {start:FlashPosition|null;firstFrame:FlashPosition|null;inActive:FlashPosition|null}

export async function conflict(s:Scene,mode:'normal'|'film'|'reduce'='normal'){
  const {b,f,id,card}=s;
  const index=await b.evaluate(indexOf(card));assert.ok(Number(index)>=0);
  const originalCounts=await b.evaluate(counts);
  await routeWrite(b,claimPath,'hold');
  await startTrace(b,card,mode!=='reduce');
  await claim(b,card);
  await b.waitFor(visible(active(card)));
  await waitForAnimationsSettled(b);
  // Hold only the board refetch, so rollback to the previous projection is observable
  // before the newly committed colleague's claim legitimately moves the card again.
  await b.evaluate(`(()=>{const fetch=window.fetch,gate=new Promise(r=>{window.release37Board=r});
    window.fetch=async(p,o)=>{if(new URL(p,location.href).pathname==='/api/workbench/board')await gate;return fetch(p,o);};})()`);
  try{
    const peer=await t11Http(f,2,{closeConnections:true});
    await peer.start(id);
    const name='陈悦（合成）';
    const trigger=async()=>{
      await b.evaluate('card37Route.release()');
      await b.waitFor(visible(pending(card)));
      if(mode==='film')await b.waitFor(moving(pending(card)));
    };
    if(mode==='reduce')await assertNoTransformAnimations(b,active(card));
    if(mode==='film'){
      await settleBoardAndDrawer(b);
      await createFilmstripCapture(b,evidence)('rollback',trigger,card,{finishAtLastFrame:true});
    }else await trigger();
    if(mode==='reduce')await b.waitFor(query(pending(card)+'[data-optimistic-rollback]')+'!=null');
    if(mode==='reduce')await assertNoTransformAnimations(b,pending(card));
    await b.waitFor(visible(claimToast+' [data-toast-action=view]'));
    assert.match(String(await b.evaluate(query(claimToast)+'.innerText')),new RegExp(name,'u'));
    assert.equal(await b.evaluate(query(claimToast+' [data-toast-action=view]')+'.textContent.trim()'),'查看');
    assert.equal(await b.evaluate(indexOf(card)),index);
    assert.equal(await b.evaluate('document.querySelectorAll("[data-optimistic-state]").length'),0);
    if(mode==='reduce')assert.deepEqual(await b.evaluate('card37Trace.transforms'),[]);
    assert.equal(await b.evaluate('card37Route.status'),409);
    if(mode!=='reduce'){
      // Keep the rejected board read gated until the still and positional evidence are complete.
      // Capture first so a failing flash assertion leaves its PNG and filmstrip for review.
      if(mode==='normal')await screenshot(b,'claim-conflict-rollback',
        visible(pending(card))+'&&'+indexOf(card)+'==='+index+'&&'+visible(claimToast+' [data-toast-action=view]')+
        `&&JSON.stringify(${counts})===JSON.stringify(${JSON.stringify(originalCounts)})`,claimToast);
      await b.waitFor('card37Trace.flashStarts.some(f=>f.firstFrame!==null)');
      await settleBoardAndDrawer(b);
      assert.equal(await b.evaluate('card37Trace.rollback'),true,'original card had the danger outline animation');
      const starts=await b.evaluate('card37Trace.flashStarts') as FlashStart[];
      assert.ok(starts.length>0);
      for(const flash of starts){
        if(!flash.start)continue; // A delayed effect can be cancelled before its active interval.
        const context='rollback outline on the returned card: '+JSON.stringify(flash);
        assert.equal(flash.start.dom,'pending',context);
        assert.equal(flash.start.index,index,context);
        assert.equal(flash.start.visual,'pending',context);
        if(flash.firstFrame){
          assert.equal(flash.firstFrame.dom,'pending',context);
          assert.equal(flash.firstFrame.index,index,context);
          assert.equal(flash.firstFrame.visual,'pending',context);
        }
        assert.equal(flash.inActive,null,context);
      }
    }
  }finally{await b.evaluate('release37Board();card37Trace.stop()');}
}
export async function closeUndo(s:Scene,capture=false){
  const {b,http,id,card}=s;
  const status=(await http.detail(id)).status;
  await fillClose(s,'REPORTER_WITHDREW');
  await clickWorkbenchControl(b,confirmClose);
  const button=toast('ticket-waiting-cancel')+' [data-toast-action=undo]';
  await b.waitFor(visible(button));assert.equal((await http.detail(id)).status,'DISMISSED');
  if(capture){
    const bar='.detail-dialog [data-readonly-reason=dismissed]';
    const header='.detail-dialog .ds-detail-state [data-closure-state=dismissed]';
    await screenshot(b,'undo-dismiss-toast',visible(button)+'&&'+visible(bar)+'&&'+
      query(bar)+'?.textContent.includes("已关闭")&&'+visible(header)+'&&'+query(header)+'?.textContent.trim()==="已关闭"',
      toast('ticket-waiting-cancel'));
  }
  await clickWorkbenchControl(b,button);
  await b.waitFor(heading('closure-restore')+'==="已撤销"');
  assert.equal((await http.detail(id)).status,status);
  if(await b.evaluate(visible('[aria-label=关闭详情]')))await clickWorkbenchControl(b,'[aria-label=关闭详情]');
  await b.waitFor(visible(pending(card)));
}
export async function followUndo(s:Scene){
  const {b}=s;
  await openDetail(s);
  await b.waitFor(query(follow)+'?.disabled===false');
  assert.equal(await b.evaluate(query(follow)+'.getAttribute("aria-pressed")'),'false');
  await clickWorkbenchControl(b,follow);
  const button=toast('item-follow')+' [data-toast-action=undo]';
  await b.waitFor(visible(button));await b.waitFor(query(follow)+'.getAttribute("aria-pressed")==="true"');
  await clickWorkbenchControl(b,button);
  await b.waitFor(heading('item-follow')+'==="已撤销"');
  await b.waitFor(query(follow)+'.getAttribute("aria-pressed")==="false"&&'+query(follow)+'.dataset.following==="false"');
}
