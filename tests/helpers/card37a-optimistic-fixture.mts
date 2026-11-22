import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import {createP2016Runtime} from '../../app/server/src/p2-016-runtime.mjs';
import {migrateTicketUnassign} from '../../app/server/scripts/ticket-unassign-migrate.mjs';
import {migrateTicketReturnToDispatch} from '../../app/server/scripts/ticket-return-to-dispatch-migrate.mjs';
import {withWeb01Fixture} from './web01-workbench-fixture.mjs';
import {type T11Fixture, t11Http} from './t11-completion-fixture.mjs';
import {launchSystemBrowser, closeBrowserTestResources} from './p2-006-browser-harness.mjs';
import {boardReady, expandPendingBoard, query, seedMotionTicket, ticketCard} from './motion-board-fixture.mjs';
import {waitForAnimationsSettled} from './browser-animations.mjs';
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

export async function withScene(run:(s:Scene)=>Promise<void>, options:{canReturn?:boolean; motion?:'reduce'|'off'; conversationClaim?:boolean;remindersEnabled?:boolean}={}) {
  await withWeb01Fixture(async (base:T11Fixture)=>{
    await base.runtime.stop();
    const [actor,peer]=base.principals;assert.ok(actor&&peer);
    const runtime=createP2016Runtime({
      pool:base.pool, publicOrigin:base.origin, listenPort:Number(new URL(base.origin).port),
      flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true}, externalSendEnabled:false,
      principalIds:[actor.id,base.outsider.id,peer.id],
      ticketSelfHandlingEnabled:true, ticketReturnToDispatchEnabled:options.canReturn!==false,
      ticketConversationSelfHandlingEnabled:options.conversationClaim===true,
      ticketWaitingActionsEnabled:true, workbenchInternalNotesEnabled:true,
      workbenchBoardActionsEnabled:true, workbenchFollowEnabled:true,
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
  },{ticketSelfHandlingEnabled:true,workbenchFollowEnabled:true,precisionV212:true,beforeClosureMigration:async({databaseUrl})=>{
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
  await clickWorkbenchControl(s.b,'.ds-drawer-more [data-action=cancel]');
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
