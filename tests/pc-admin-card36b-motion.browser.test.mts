import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {platform,release,tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import {withT42BoardBrowser,object} from './helpers/t42-board-browser-fixture.mjs';
import type {T42Fixture} from './helpers/t42-board-browser-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {chooseWorkbenchSelect,clickWorkbenchControl} from './helpers/heroui-workbench-controls.mjs';
import {waitForAnimationsSettled} from './helpers/browser-animations.mjs';
import {boardColumnsReady} from './helpers/workbench-board-readiness.mjs';
import {assertMotion,assertNoTransformAnimations} from './helpers/motion-assert.mjs';
import {createFilmstripCapture} from './helpers/motion-filmstrip.mjs';
import {calibrateCard36bCpu} from './helpers/motion-cpu-calibration-36b.mjs';
import {boardReady,captureMotionReadingPosition,expandPendingBoard,query,refreshBoard,scrollPastMotionItem,seedMotionTicket,ticketCard,ticketRow} from './helpers/motion-board-fixture.mjs';

type Browser=Parameters<Parameters<typeof withT42BoardBrowser>[0]>[1];
const root=process.env.TS_MIGRATION_TEST_SOURCE_ROOT??process.cwd();
const evidence=process.env.CARD36B_EVIDENCE_DIR??join(root,'.build','card36b-evidence');
const timeout=240000,base='/workbench/app/?range=all';
// The Web01 fixture issues sessions in this order: actor, unauthorized outsider, teammate.
const teammateSession=2;
const chip='[data-new-items-chip]:not([data-exiting])';
const active=(selector:string)=>'.board-column.active '+selector;
const pending=(selector:string)=>'.board-column.pending '+selector;
const activeRemainder='.board-column.active [data-action=expand-column][aria-expanded=false]';
const listWrap='.ds-work-table-wrap';
const pendingRowsMore='#list-subgroup-ticket-more [data-action=expand-column][aria-expanded=false]';
const visible=(selector:string)=>`Boolean(${query(selector)}?.checkVisibility())`;
const frames='new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))';
const backgroundFrame="animation.effect.getKeyframes().some(frame=>'backgroundColor' in frame)";
const moveFrame="animation.effect.getKeyframes().some(frame=>typeof frame.transform==='string'&&frame.transform.startsWith('translate('))";
const relevantAnimations=`document.getAnimations().filter(animation=>{const target=animation.effect?.target;return target?.closest('.ds-number-roll')||((target?.matches('.ticket-card,.ds-work-row'))&&animation.effect.getKeyframes().some(frame=>typeof frame.transform==='string'&&frame.transform.startsWith('translate')));})`;
const probe=`(()=>{
  window.motionCalls=[];
  const original=Element.prototype.animate;
  Element.prototype.animate=function(keyframes,options){
    const animation=original.call(this,keyframes,options);
    if(this.matches('.ticket-card,.ds-work-row')&&this.dataset.itemId){
      const kind=keyframes.some(frame=>'backgroundColor' in frame)?'highlight':keyframes.some(frame=>frame.transform?.startsWith('translate('))?'move':'entry';
      const event={id:this.dataset.itemId,kind,at:performance.now(),finished:null};
      window.motionCalls.push(event);
      animation.finished.then(()=>{event.finished=performance.now();},()=>{});
    }
    return animation;
  };
})()`;

async function ready(browser:Browser){
  await browser.command('Page.bringToFront');
  await browser.waitFor(boardReady);
  await browser.evaluate('document.fonts.ready.then(()=>true)');
  await waitForAnimationsSettled(browser);
}
async function navigate(browser:Browser,origin:string,route=base){
  const url=origin+route;
  const previous=await browser.evaluate('performance.timeOrigin');
  await browser.command('Page.navigate',{url});
  await browser.waitFor(`location.href===${JSON.stringify(url)}&&performance.timeOrigin!==${JSON.stringify(previous)}`);
  await ready(browser);
}
async function expandActiveBoard(browser:Browser){
  await browser.evaluate(`${query(activeRemainder)}?.click()`);
  await waitForAnimationsSettled(browser);
}
async function waitEffect(browser:Browser,selector:string,condition:string){
  await browser.waitFor(`${query(selector)}?.getAnimations().some(animation=>${condition})===true`);
}
async function frozen(browser:Browser,run:()=>Promise<void>){
  await browser.command('Animation.enable');
  await browser.command('Animation.setPlaybackRate',{playbackRate:0});
  try{await run();}finally{await browser.command('Animation.setPlaybackRate',{playbackRate:1});}
}
async function claim(browser:Browser,selector:string){
  await browser.evaluate(`${query(selector+' .card-open')}.focus({preventScroll:true})`);
  await browser.waitFor(`${query(selector+' [data-board-claim-action]')}?.disabled===false`);
  await clickWorkbenchControl(browser,selector+' [data-board-claim-action]');
}
async function position(browser:Browser,selector:string){
  return object(await browser.evaluate(`(()=>{const node=${query(selector)},rect=node.getBoundingClientRect();return {left:rect.left,top:rect.top};})()`));
}
function within(actual:Record<string,unknown>,expected:Record<string,unknown>,px:number,message:string){
  for(const axis of ['left','top'])assert.ok(Math.abs(Number(actual[axis])-Number(expected[axis]))<=px,`${message}: ${JSON.stringify({actual,expected,px})}`);
}
async function assertHighlightTone(browser:Browser,selector:string,token:string){
  assert.equal(await browser.evaluate(`(()=>{
    const animation=${query(selector)}.getAnimations().find(animation=>${backgroundFrame});
    const css=document.createElement('span');document.body.append(css);
    css.style.backgroundColor='var(${token})';const expected=getComputedStyle(css).backgroundColor;
    css.style.backgroundColor=animation.effect.getKeyframes()[0].backgroundColor;
    const actual=getComputedStyle(css).backgroundColor;css.remove();return actual===expected;
  })()`),true,`${selector} first highlight frame resolves to ${token}`);
}
async function seedMany(fixture:T42Fixture,count:number,label:string){
  const ids:string[]=[];
  for(let index=0;index<count;index++)ids.push(await seedMotionTicket(fixture.pool,`${label} ${index+1}`));
  return ids;
}
async function stageFixture(fixture:T42Fixture,ids:string[],stage:'IN_PROGRESS'|'QUEUED'){
  const principal=fixture.principals[0];assert.ok(principal);
  const result=await fixture.pool.query("UPDATE pilot_ticket.ticket SET status=$2,assignee_id=$3::uuid,version=version+1,updated_at=platform.local_now() WHERE id=ANY($1::uuid[])",[ids,stage,stage==='IN_PROGRESS'?principal.id:null]);
  assert.equal(result.rowCount,ids.length);
}
async function writeEvidence(name:string,value:unknown){
  await mkdir(evidence,{recursive:true});
  await writeFile(join(evidence,name),JSON.stringify(value,null,2)+'\n');
}

test('36B B5.1–3 board claim: move, make-room, endpoints and actor-specific highlight',{timeout},()=>withT42BoardBrowser(async(fixture,actor,card,get)=>{
  const peerCookie=fixture.browserCookies[teammateSession],principal=fixture.principals[0];assert.ok(peerCookie&&principal);
  assert.notEqual(principal.id,fixture.principals[1]?.id);
  const neighbor=await seedMotionTicket(fixture.pool,'换列后填补空位');
  const peer=await launchSystemBrowser({url:fixture.origin+base,width:1920,height:1440,cookies:[{...peerCookie,url:fixture.origin+'/'}]});
  assert.ok(peer);
  let failure:unknown;
  try{
    await actor.command('Emulation.setDeviceMetricsOverride',{width:1920,height:1440,deviceScaleFactor:1,mobile:false});
    await navigate(actor,fixture.origin);await ready(peer);
    for(const browser of [actor,peer]){
      await browser.waitFor(boardColumnsReady);
      await expandPendingBoard(browser);await expandActiveBoard(browser);
    }
    await peer.waitFor(visible(pending(card)));
    await actor.evaluate(probe);await peer.evaluate(probe);
    await actor.evaluate(`${query(card+' .card-open')}.focus({preventScroll:true})`);
    await waitForAnimationsSettled(actor);
    const old=await position(actor,pending(card));
    const originalBackground=await actor.evaluate(`getComputedStyle(${query(pending(card))}).backgroundColor`);
    const makeup=pending(ticketCard(neighbor)),measurements:Record<string,unknown>={};
    assert.ok(Number((await position(actor,makeup)).top)>Number(old.top),'fixture card must follow the moving card');
    let layout:Record<string,unknown>={};
    await frozen(actor,async()=>{
      // Sample the first active card on its first rendering opportunity. A later
      // column response can remount the same ticket while CDP's motion clock is frozen.
      await actor.evaluate(`(() => {
        const observer = new MutationObserver(() => {
          const node = ${query(active(card))};
          if (!node) return;
          observer.disconnect();
          requestAnimationFrame(() => {
            const rect = node.getBoundingClientRect();
            const matrix = new DOMMatrixReadOnly(getComputedStyle(node).transform);
            window.claimFirstFrame = {
              current: ${query(active(card))} === node,
              visual: {left: rect.left, top: rect.top},
              layout: {left: rect.left - matrix.m41, top: rect.top - matrix.m42},
            };
          });
        });
        observer.observe(document.querySelector('.board'), {childList:true, subtree:true});
      })()`);
      await claim(actor,card);
      await waitEffect(actor,active(card),moveFrame);
      await actor.evaluate(frames);
      const move=await assertMotion(actor,active(card),'--dur-move','--ease-soft',{animationName:'WAAPI'});
      assert.deepEqual(move.map(animation=>animation.properties),[['transform']]);
      measurements.move=move;
      // E6 CSS exception: lifting to --shadow-3 also runs the existing card shadow transition.
      const shadow=await assertMotion(actor,active(card),'--dur-fast','--ease-standard',{animationName:'box-shadow',cssExceptions:['boxShadow']});
      assert.deepEqual(shadow.map(animation=>animation.properties),[['boxShadow']]);
      measurements.e6LiftShadow=shadow;
      measurements.makeRoom=await assertMotion(actor,makeup,'--dur-base','--ease-standard');
      measurements.numberRoll=await assertMotion(actor,'.board-column.active .ds-stage-count','--dur-base','--ease-standard',{subtree:true});
      await actor.waitFor('Boolean(window.claimFirstFrame)');
      const firstFrame=object(await actor.evaluate('window.claimFirstFrame'));
      assert.equal(firstFrame.current,true,'the moving card is still mounted on its first frame');
      within(object(firstFrame.visual),old,1,'first rendered frame');
      layout=object(firstFrame.layout);
    });
    await waitForAnimationsSettled(actor);
    assert.equal(await actor.evaluate(`getComputedStyle(${query(active(card))}).transform`),'none');
    within(await position(actor,active(card)),layout,1,'settled layout rect');
    assert.equal(await actor.evaluate(`getComputedStyle(${query(active(card))}).backgroundColor`),originalBackground,'claim has no tinted hold');
    const id=fixture.tickets[0]?.ticket.id;assert.ok(id);
    const result=await get('/api/tickets/'+id);assert.equal(result.status,'IN_PROGRESS');assert.equal(result.assignee_id,principal.id);
    const loggedHighlights=`motionCalls.filter(event=>event.id===${JSON.stringify(id)}&&event.kind==='highlight')`;
    assert.deepEqual(await actor.evaluate(loggedHighlights),[]);
    await frozen(peer,async()=>{
      await peer.evaluate(refreshBoard);await waitEffect(peer,active(card),moveFrame);
      assert.deepEqual(await peer.evaluate(loggedHighlights),[],'peer highlight must wait for the move');
      await peer.evaluate(`${query(active(card))}.getAnimations().find(animation=>${moveFrame}).finish()`);
      await waitEffect(peer,active(card),backgroundFrame);
      measurements.highlight=await assertMotion(peer,active(card),'--dur-highlight','--ease-standard',{animationName:'WAAPI'});
      await assertHighlightTone(peer,active(card),'--stage-active-bg');
    });
    await waitForAnimationsSettled(peer);
    await writeEvidence('motion-spec-36b.json',{os:{platform:platform(),release:release()},browser:await peer.command('Browser.getVersion'),measurements});
  }catch(error){failure=error;}finally{await closeBrowserTestResources([()=>peer.close()],failure);}
}));

test('36B B5.4 initial load, view, filter, search, disclosure and resize do not animate data',{timeout},()=>withT42BoardBrowser(async(fixture,browser)=>{
  const source=`(()=>{const entries=[];window.dataEffects=entries;const sample=()=>{for(const animation of ${relevantAnimations})if(!entries.includes(animation))entries.push(animation);requestAnimationFrame(sample);};requestAnimationFrame(sample);})()`;
  await browser.command('Page.addScriptToEvaluateOnNewDocument',{source});
  await navigate(browser,fixture.origin);
  const noMotion=async(label:string)=>{
    await browser.evaluate(frames);
    assert.equal(await browser.evaluate(`${relevantAnimations}.length+dataEffects.length`),0,label);
    await waitForAnimationsSettled(browser);
    assert.equal(await browser.evaluate('dataEffects.length'),0,label+' through settlement');
  };
  const switchTo=async(label:string,selector:string)=>{
    await browser.evaluate(`[...document.querySelectorAll('.view-tabs button')].find(node=>node.textContent.trim()===${JSON.stringify(label)}).click()`);
    await browser.waitFor(visible(selector));await noMotion(label);
  };
  await noMotion('initial load');
  await switchTo('列表','.ds-work-table');await switchTo('看板','.board');
  const handler='[data-field-label=处理人]';
  const before=await browser.evaluate("document.querySelector('.board-column.active .ds-stage-count').textContent");
  await chooseWorkbenchSelect(browser,handler,'unassigned');
  await browser.waitFor(`document.querySelector('.board-column.active .ds-stage-count').textContent!==${JSON.stringify(before)}`);
  await noMotion('filter changes real counts');
  await chooseWorkbenchSelect(browser,handler,'all');await noMotion('clear filter');
  const group='.board-column.pending .ds-board-group-trigger';
  for(const direction of ['false','true']){
    const trigger=query(group);const old=await browser.evaluate(`${trigger}.getAttribute('aria-expanded')`);
    if(old===direction)await browser.evaluate(`${trigger}.click()`);
    await browser.evaluate(`${trigger}.click()`);
    await browser.waitFor(`${trigger}.getAttribute('aria-expanded')===${JSON.stringify(direction)}`);
    await noMotion(direction==='true'?'expand':'collapse');
  }
  await browser.command('Emulation.setDeviceMetricsOverride',{width:1450,height:950,deviceScaleFactor:1,mobile:false});
  await browser.waitFor('innerWidth===1450');await noMotion('resize');
  await clickWorkbenchControl(browser,'.workbench-search input[name=q]');
  await browser.command('Input.insertText',{text:'没有匹配的卡三十六（合成）'});
  await browser.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13});
  await browser.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await browser.waitFor("new URLSearchParams(location.search).get('q')==='没有匹配的卡三十六（合成）'&&document.querySelector('.workbench-search').getAttribute('aria-busy')==='false'&&!document.querySelector('.ticket-card')");
  await noMotion('search replaces results');
},{search:true}));

test('36B B5.5 slow-mode cross-column interruption continues from the mid-flight visual position',{timeout},()=>withT42BoardBrowser(async(fixture,browser,card)=>{
  const id=fixture.tickets[0]?.ticket.id;assert.ok(id);
  const cache=await mkdtemp(join(tmpdir(),'card36b-vite-'));
  let server:Awaited<ReturnType<typeof createServer>>|undefined,failure:unknown;
  try{
    server=await createServer({configFile:false,root:join(root,'app/pc-admin'),base:'/workbench/app/',cacheDir:cache,plugins:[react(),tailwind()],server:{host:'127.0.0.1',port:0,fs:{allow:[root]},proxy:{'/api':fixture.origin}},logLevel:'error'});
    await server.listen();const address=server.httpServer?.address();assert.ok(address&&typeof address==='object');
    await navigate(browser,'http://127.0.0.1:'+address.port,base+'&motion=slow');
    await browser.waitFor('document.documentElement.dataset.motion==="slow"');
    assert.equal(await browser.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--dur-move').trim()"),'1600ms');
    await expandPendingBoard(browser);await expandActiveBoard(browser);
    const start=await position(browser,pending(card));
    await stageFixture(fixture,[id],'IN_PROGRESS');
    await frozen(browser,async()=>{
      await browser.evaluate(refreshBoard);await waitEffect(browser,active(card),moveFrame);
      const first=`${query(active(card))}.getAnimations().find(animation=>${moveFrame})`;
      await browser.evaluate(`${first}.currentTime=640`);await browser.evaluate(frames);
      const middle=await position(browser,active(card));
      assert.ok(Math.abs(Number(start.left)-Number(middle.left))>2,'the first flight actually progressed');
      await stageFixture(fixture,[id],'QUEUED');
      await browser.evaluate(refreshBoard);await waitEffect(browser,pending(card),moveFrame);
      await browser.evaluate(frames);
      within(await position(browser,pending(card)),middle,2,'second flight starts at the live pose, not either layout slot');
    });
    await waitForAnimationsSettled(browser,undefined,9000);
  }catch(error){failure=error;}finally{await closeBrowserTestResources([()=>server?.close(),()=>rm(cache,{recursive:true,force:true})],failure);}
}));

test('36B B5.6 twenty confirmed moves share six slots and record i3-calibrated long frames',{timeout},t=>withT42BoardBrowser(async(fixture,browser)=>{
  const ids=await seedMany(fixture,20,'批量换列');
  await browser.command('Emulation.setDeviceMetricsOverride',{width:1800,height:3200,deviceScaleFactor:1,mobile:false});
  await navigate(browser,fixture.origin);await expandPendingBoard(browser);await expandActiveBoard(browser);
  await browser.waitFor(`${JSON.stringify(ids)}.every(id=>document.querySelector('.board-column.pending .ticket-card[data-item-id="'+id+'"]')?.checkVisibility())`);
  const calibration=await calibrateCard36bCpu(browser);
  t.diagnostic(`B5.6 CPU calibration ${JSON.stringify(calibration)}`);
  await browser.evaluate(frames);
  await stageFixture(fixture,ids,'IN_PROGRESS');
  await browser.command('Emulation.setCPUThrottlingRate',{rate:calibration.rate});
  try{
    const refreshStartedAtMs=await browser.evaluate(`(()=>{
      if(!PerformanceObserver.supportedEntryTypes.includes('long-animation-frame'))throw Error('long-animation-frame unsupported');
      const longFrames=[],moveIds=new Set(),live=new Set();let peak=0,snapped=null;
      const collect=entries=>{
        for(const entry of entries){
          if(entry.startTime<refreshStartedAtMs)continue;
          const scripts=entry.scripts.map(({invoker,invokerType,sourceURL,sourceFunctionName,duration,forcedStyleAndLayoutDuration})=>({
            invoker,invokerType,sourceURL,sourceFunctionName,duration,forcedStyleAndLayoutDuration,
          }));
          longFrames.push({...entry.toJSON(),scripts});
        }
      };
      const ids=${JSON.stringify(ids)},observer=new PerformanceObserver(list=>collect(list.getEntries()));
      observer.observe({type:'long-animation-frame',buffered:true});
      const original=Element.prototype.animate;
      Element.prototype.animate=function(keyframes,options){const animation=original.call(this,keyframes,options);
        if(this.matches('.ticket-card')&&keyframes.some(frame=>frame.transform?.startsWith('translate('))){
          for(const candidate of live)if(candidate.playState==='finished'||candidate.playState==='idle')live.delete(candidate);
          if(ids.includes(this.dataset.itemId))moveIds.add(this.dataset.itemId);
          live.add(animation);peak=Math.max(peak,live.size);
        }return animation;};
      const sample=()=>{
        const nodes=[...document.querySelectorAll('.board-column.active .ticket-card')].filter(node=>ids.includes(node.dataset.itemId));
        if(nodes.length===ids.length){snapped=nodes.filter(node=>!moveIds.has(node.dataset.itemId)).map(node=>{const {left,top}=node.getBoundingClientRect();return {id:node.dataset.itemId,transform:getComputedStyle(node).transform,left,top};});return;}
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      window.batchState=()=>snapped===null?null:{peak,moved:[...moveIds],snapped};
      window.finishLoaf=()=>{collect(observer.takeRecords());observer.disconnect();return longFrames;};
      const refreshStartedAtMs=performance.now();
      ${refreshBoard};
      return refreshStartedAtMs;
    })()`);
    assert.equal(typeof refreshStartedAtMs,'number');
    await browser.waitFor('batchState()!==null');
    await waitForAnimationsSettled(browser,undefined,9000);
    await browser.evaluate(frames);
    const batch=object(await browser.evaluate('batchState()'));
    const records:unknown=await browser.evaluate('finishLoaf()');assert.ok(Array.isArray(records));
    const maxDurationMs=Math.max(0,...records.map(entry=>Number(object(entry).duration)));
    await writeEvidence('long-animation-frames-36b.json',{...calibration,cpuRate:calibration.rate,requestedMoves:ids.length,refreshStartedAtMs,batch,count:records.length,maxDurationMs,records});
    assert.ok(Array.isArray(batch.moved)&&Array.isArray(batch.snapped));
    assert.ok(Number(batch.peak)>0&&Number(batch.peak)<=6,`expected 1–6 concurrent moves: ${JSON.stringify(batch)}`);
    assert.ok(batch.moved.length>0&&batch.moved.length<=6,'only six cards may animate their column move');
    assert.deepEqual([...batch.moved,...batch.snapped.map(entry=>object(entry).id)].sort(),[...ids].sort());
    assert.ok(batch.snapped.every(entry=>object(entry).transform==='none'),'remaining cards are at layout on the first committed frame');
    for(const entry of batch.snapped){const rect=object(entry);within(await position(browser,active(ticketCard(String(rect.id)))),rect,1,'snapped card stays in its final layout slot');}
    assert.ok(maxDurationMs<=200,`i3-calibrated CPU (rate ${calibration.rate.toFixed(2)}×) long frame ${maxDurationMs}ms exceeded 200ms`);
  }finally{await browser.command('Emulation.setCPUThrottlingRate',{rate:1});}
}));

async function assertChip(browser:Browser,anchor:string,count:number,direction:'up'|'down'){
  const selector=anchor+' '+chip,text=`${direction==='up'?'↑':'↓'} ${count} 条新工单`;
  await browser.waitFor(`${query(selector)}?.textContent.trim()===${JSON.stringify(text)}`);
  assert.deepEqual(await browser.evaluate(`(()=>{
    const node=${query(selector)};return {count:document.querySelectorAll(${JSON.stringify(anchor+' [data-new-items-chip]')}).length,
      role:node.closest('[data-new-items-chip-region]')?.getAttribute('role'),tag:node.tagName,direction:node.dataset.direction,tabIndex:node.tabIndex};
  })()`),{count:1,role:'status',tag:'BUTTON',direction,tabIndex:0});
  return selector;
}
async function waitHighlights(browser:Browser,ids:string[],amount=1){
  const count=(id:string)=>`motionCalls.filter(event=>event.id===${JSON.stringify(id)}&&event.kind==='highlight').length`;
  for(const id of ids)await browser.waitFor(`${count(id)}>=${amount}`);
  await waitForAnimationsSettled(browser);
  for(const id of ids)assert.equal(await browser.evaluate(count(id)),amount,`${id}: highlights exactly ${amount} time(s)`);
}

for(const view of ['board','list'] as const)test(`36B B5.7 ${view} chip merges off-screen arrivals, supports Enter and dismisses on scroll`,{timeout},()=>withT42BoardBrowser(async(fixture,browser)=>{
  await seedMany(fixture,16,'阅读位置填充');const first=fixture.tickets[0]?.ticket.id;assert.ok(first);
  if(view==='list')await browser.command('Emulation.setDeviceMetricsOverride',{width:1920,height:800,deviceScaleFactor:1,mobile:false});
  await navigate(browser,fixture.origin,base+(view==='list'?'&view=list':''));
  if(view==='board')await expandPendingBoard(browser);
  else{
    await browser.waitFor(visible(pendingRowsMore));
    await browser.evaluate(`${query(pendingRowsMore)}.click()`);
    await browser.waitFor(visible(ticketRow(first)));
  }
  const select=view==='board'?ticketCard:ticketRow;
  const direction=view==='board'?'up':'down';
  const anchor=view==='board'?'.board-column.pending .ds-column-chip-anchor':'.ds-table-chip-anchor';
  const scrollPosition=view==='board'?'scrollY':`${query(listWrap)}.scrollTop`;
  const readAway=async()=>{
    if(view==='board')await scrollPastMotionItem(browser,select(first));
    else await browser.evaluate(`${query(listWrap)}.scrollTo({top:0,behavior:'instant'})`);
    await browser.evaluate(frames);
  };
  const arrive=async(label:string,age:number)=>{
    const id=await seedMotionTicket(fixture.pool,label);
    if(view==='list'){
      // List order uses updated_at descending. Keep the late-sorting ticket's timestamps consistent.
      const result=await fixture.pool.query(`WITH fixture_time AS (SELECT platform.local_now()-($2::integer*interval '1 day') AS at)
        UPDATE pilot_ticket.ticket SET created_at=fixture_time.at,updated_at=fixture_time.at FROM fixture_time WHERE id=$1::uuid`,[id,age]);
      assert.equal(result.rowCount,1);
    }
    return id;
  };
  await readAway();await browser.evaluate(probe);
  const reading=await captureMotionReadingPosition(browser,view==='board'?'.board .ticket-card':`${listWrap} .ds-work-row[data-item-id]`,view==='list'?listWrap:undefined);
  const firstArrival=await arrive('胶囊首条',60);
  let timing:unknown;
  await frozen(browser,async()=>{
    await browser.evaluate(refreshBoard);
    const selector=await assertChip(browser,anchor,1,direction);
    await browser.evaluate(frames);
    timing=await assertMotion(browser,selector,'--dur-fast','--ease-standard');
  });
  await waitForAnimationsSettled(browser);
  await reading.assertUnchanged();
  const secondArrival=await arrive('胶囊合并',61);
  await browser.evaluate(refreshBoard);
  const button=await assertChip(browser,anchor,2,direction);
  await waitForAnimationsSettled(browser);
  for(const id of [firstArrival,secondArrival]){
    assert.equal(await browser.evaluate(`${query(select(id))}?.checkVisibility()`),true,'new item is already in its real DOM position');
    assert.equal(await browser.evaluate(`(()=>{const rect=${query(select(id))}.getBoundingClientRect();return ${direction==='up'?'rect.bottom<=0':`rect.top>=Math.min(innerHeight,${query(listWrap)}.getBoundingClientRect().bottom)`};})()`),true,'arrival really landed outside the viewport');
  }
  await reading.assertUnchanged();
  const beforeActivation=await browser.evaluate(scrollPosition);
  if(view==='list'){
    const geometry=object(await browser.evaluate(`(()=>{const chip=${query(button)}.getBoundingClientRect(),header=document.querySelector('.ds-work-table thead').getBoundingClientRect();return {top:chip.top,headerBottom:header.bottom};})()`));
    assert.ok(Number(geometry.top)>=Number(geometry.headerBottom),'chip is below the list column headers');
  }else{
    const geometry=object(await browser.evaluate(`(()=>{
      const node=${query(button)},column=node.closest('.board-column'),chip=node.getBoundingClientRect();
      const lane=column.getBoundingClientRect(),header=column.querySelector('.column-heading').getBoundingClientRect();
      return {centerOffset:(chip.left+chip.right-lane.left-lane.right)/2,top:chip.top,bottom:chip.bottom,
        viewportBottom:innerHeight,headerBottom:header.bottom,headerVisible:header.bottom>0&&header.top<innerHeight};
    })()`));
    assert.ok(Math.abs(Number(geometry.centerOffset))<=1,'chip is horizontally centered in its column');
    if(geometry.headerVisible)assert.ok(Number(geometry.top)>=Number(geometry.headerBottom),'chip is below the visible column header');
    else assert.ok(Number(geometry.top)>=0&&Number(geometry.bottom)<=Number(geometry.viewportBottom),'chip stays inside the viewport after the header scrolls away');
  }
  await browser.evaluate(`${query(button)}.focus({preventScroll:true})`);
  assert.equal(await browser.evaluate(`document.activeElement===${query(button)}`),true);
  for(const type of ['keyDown','keyUp'])await browser.command('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
  await browser.waitFor(`!${query(anchor+' [data-new-items-chip]')}`);
  await waitHighlights(browser,[firstArrival,secondArrival]);
  const calls=await reading.scrollCalls();assert.ok(Array.isArray(calls));
  assert.ok(calls.some(entry=>{const {method,id,behavior}=object(entry);return method==='scrollIntoView'&&id===firstArrival&&behavior==='smooth';}),'Enter smoothly reveals the earliest arrival');
  assert.notEqual(await browser.evaluate(scrollPosition),beforeActivation,'activation actually scrolls');
  if(view==='board')await scrollPastMotionItem(browser,select(firstArrival));
  else await readAway();
  const third=await arrive('自行滚入视区',62);
  await browser.evaluate(refreshBoard);await assertChip(browser,anchor,1,direction);
  await browser.evaluate(`${query(select(third))}.scrollIntoView({block:'center',behavior:'instant'})`);
  await browser.waitFor(`!${query(anchor+' [data-new-items-chip]')}`);
  await waitHighlights(browser,[third]);
  await writeEvidence(`chip-motion-36b-${view}.json`,{os:{platform:platform(),release:release()},browser:await browser.command('Browser.getVersion'),timing});
}));

test('36B B5.8 list row group changes and arrivals highlight brand only for other principals',{timeout},()=>withT42BoardBrowser(async(fixture,actor)=>{
  const id=fixture.tickets[0]?.ticket.id,peerCookie=fixture.browserCookies[teammateSession];assert.ok(id&&peerCookie);
  const row=ticketRow(id),route=base+'&view=list';
  const peer=await launchSystemBrowser({url:fixture.origin+route,width:1920,height:1440,cookies:[{...peerCookie,url:fixture.origin+'/'}]});
  assert.ok(peer);
  let failure:unknown;
  try{
    await actor.command('Emulation.setDeviceMetricsOverride',{width:1920,height:1440,deviceScaleFactor:1,mobile:false});
    await navigate(actor,fixture.origin,route);await ready(peer);
    for(const browser of [actor,peer]){
      await browser.waitFor(visible(row));
      assert.equal(await browser.evaluate(`${query(row)}.getAttribute('data-column')`),'pending');
      await browser.evaluate(probe);
    }
    await claim(actor,row);
    await actor.waitFor(`${query(row)}?.dataset.column==='active'`);
    await waitForAnimationsSettled(actor);
    assert.deepEqual(await actor.evaluate(`motionCalls.filter(event=>event.id===${JSON.stringify(id)})`),[],'self moves to its group without row effects');
    await assertNoTransformAnimations(actor,row);
    await frozen(peer,async()=>{
      await peer.evaluate(refreshBoard);await peer.waitFor(`${query(row)}?.dataset.column==='active'`);
      await waitEffect(peer,row,backgroundFrame);
      await assertNoTransformAnimations(peer,row);await assertHighlightTone(peer,row,'--brand-subtle');
    });
    await waitForAnimationsSettled(peer);
    const arrival=ticketRow(await seedMotionTicket(fixture.pool,'列表新增行'));
    await frozen(peer,async()=>{
      await peer.evaluate(refreshBoard);await waitEffect(peer,arrival,backgroundFrame);
      await assertNoTransformAnimations(peer,arrival);await assertHighlightTone(peer,arrival,'--brand-subtle');
    });
    await waitForAnimationsSettled(peer);
    assert.equal(await peer.evaluate("motionCalls.every(event=>event.kind==='highlight')"),true,'list never uses WAAPI entry/translation');
  }catch(error){failure=error;}finally{await closeBrowserTestResources([()=>peer.close()],failure);}
}));

async function assertReducedHighlight(browser:Browser,selector:string,token:string){
  const result=object(await browser.evaluate(`(async()=>{
    const root=document.documentElement,styles=getComputedStyle(root),raw=styles.getPropertyValue('--dur-highlight').trim(),duration=Number.parseFloat(raw)*(raw.endsWith('ms')?1:1000);
    const color=document.createElement('span');document.body.append(color);color.style.backgroundColor='var(${token})';const expected=getComputedStyle(color).backgroundColor;color.remove();
    let start=null,end=null,effects=0,backgroundEffects=0,mismatch=false;
    const deadline=performance.now()+5000;
    ${refreshBoard};
    while(performance.now()<deadline){
      await new Promise(resolve=>requestAnimationFrame(resolve));
      const node=${query(selector)},current=performance.now();
      effects+=${relevantAnimations}.length;
      backgroundEffects+=node?.getAnimations().filter(animation=>${backgroundFrame}).length??0;
      if(node?.style.backgroundColor){start??=current;mismatch||=getComputedStyle(node).backgroundColor!==expected;}
      else if(start!==null){end=current;break;}
    }
    return {duration,start,end,elapsed:start!==null&&end!==null?end-start:null,effects,backgroundEffects,mismatch};
  })()`));
  assert.deepEqual({effects:result.effects,backgroundEffects:result.backgroundEffects,mismatch:result.mismatch},{effects:0,backgroundEffects:0,mismatch:false});
  assert.equal(result.duration,1200);
  assert.equal(typeof result.elapsed,'number',`expected a sampled, finite color hold: ${JSON.stringify(result)}`);
  assert.ok(Math.abs(Number(result.elapsed)-Number(result.duration))<=50,`color hold differs from token by more than three nominal frames: ${JSON.stringify(result)}`);
  await assertNoTransformAnimations(browser,'.board');
  await waitForAnimationsSettled(browser);
}

test('36B B5.9 reduced-motion arrivals and moves hold stage colors without transitions or number roll',{timeout},()=>withT42BoardBrowser(async(fixture,browser,card)=>{
  await browser.command('Emulation.setDeviceMetricsOverride',{width:1920,height:1440,deviceScaleFactor:1,mobile:false});
  await navigate(browser,fixture.origin);await browser.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await browser.waitFor("matchMedia('(prefers-reduced-motion: reduce)').matches");
  await expandPendingBoard(browser);await expandActiveBoard(browser);
  const arrival=ticketCard(await seedMotionTicket(fixture.pool,'减少动态效果'));
  await assertReducedHighlight(browser,pending(arrival),'--stage-intake-bg');
  const id=fixture.tickets[0]?.ticket.id;assert.ok(id);
  await stageFixture(fixture,[id],'IN_PROGRESS');
  await assertReducedHighlight(browser,active(card),'--stage-active-bg');
}));

for(const name of ['board-move','board-arrival','board-chip','list-row-highlight','count-roll'] as const)test(`36B B5.10 filmstrip ${name}`,{timeout},()=>withT42BoardBrowser(async(fixture,browser,card)=>{
  const list=name==='list-row-highlight';
  if(name==='board-chip')await seedMany(fixture,12,'胶片填充');
  await navigate(browser,fixture.origin,base+(list?'&view=list':''));
  if(!list){await expandPendingBoard(browser);await expandActiveBoard(browser);}
  const captureFilmstrip=createFilmstripCapture(browser,join(evidence,'filmstrip'));
  let selector:string,committed:string;
  if(name==='board-move'){
    const id=fixture.tickets[0]?.ticket.id;assert.ok(id);
    await stageFixture(fixture,[id],'IN_PROGRESS');selector=card;committed=visible(active(card));
  }else{
    if(name==='board-chip')await scrollPastMotionItem(browser,card);
    const id=await seedMotionTicket(fixture.pool,'胶片新工单');
    const item=list?ticketRow(id):ticketCard(id);
    selector=name==='board-chip'?pending(chip):name==='count-roll'?pending('.ds-stage-count'):item;
    committed=visible(item);
  }
  const output=await captureFilmstrip(name,async()=>{
    await browser.evaluate(refreshBoard);await browser.waitFor(`${committed}&&!document.querySelector('[data-refreshing=true]')`);
    if(name==='board-chip')await browser.waitFor(visible(selector));
  },selector);
  await writeEvidence('filmstrip/'+name+'-environment.json',{os:{platform:platform(),release:release()},browser:await browser.command('Browser.getVersion'),output});
}));
