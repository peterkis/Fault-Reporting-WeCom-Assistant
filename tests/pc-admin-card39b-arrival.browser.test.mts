import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {platform,release,tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import sharp from 'sharp';
import {createServer} from 'vite';
import {appendTicketEvent} from '../app/server/src/p1-006-ticket-state-actions.mjs';
import {insertClosureRecord,normalizeClosureInput} from '../app/server/src/service-closure-records.mjs';
import {waitForAnimationsSettled} from './helpers/browser-animations.mjs';
import {visualDiagnostics,type Sample,type VisualDiagnostics} from './helpers/card39b-visual-diagnostics.mjs';
import {escape as cdpEscape,hover,move,q} from './helpers/card37c-hover-browser.mjs';
import {chooseWorkbenchSelect,clickWorkbenchControl} from './helpers/heroui-workbench-controls.mjs';
import {assertMotion,assertNoTransformAnimations} from './helpers/motion-assert.mjs';
import {boardReady,query,refreshBoard,seedMotionTicket,ticketCard,ticketRow} from './helpers/motion-board-fixture.mjs';
import {createFilmstripCapture} from './helpers/motion-filmstrip.mjs';
import {closeBrowserTestResources,launchSystemBrowser} from './helpers/p2-006-browser-harness.mjs';
import type {T11Fixture} from './helpers/t11-completion-fixture.mjs';
import {object} from './helpers/t42-board-browser-fixture.mjs';
import {seedWeb01NoConversationIntake,withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';

type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
type Ticket=Parameters<typeof appendTicketEvent>[0]['ticket']&{assignee_id?:string|null;resolver_team_id?:string|null};
type Fixture=Omit<T11Fixture,'tickets'>&{tickets:{ticket:Ticket}[]};

const root=process.env.TS_MIGRATION_TEST_SOURCE_ROOT??process.cwd();
const timeout=220_000;
const appPath='/workbench/app/';
const intakeCard=(id:string)=>`.ticket-card[data-kind=intake][data-item-id="${id}"]`;
const active=(selector:string)=>'.board-column.active '+selector;
const pending=(selector:string)=>'.board-column.pending '+selector;
const handled=(selector:string)=>'.board-column.handled '+selector;
const frames='new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))';
const movingCards='.board .ticket-card[data-motion-flipping="true"]';
const slowSampleTimes=[0,1200,2400,4200,6000,7200] as const;
const slowFrameLabels=[0,240,480,840,1200,1440] as const;

const fixtureOptions={
  precisionV212:true,
  workbenchBoardActionsEnabled:true,
  workbenchInternalNotesEnabled:true,
  workbenchSearchEnabled:true,
  presencePeerSessions:true,
  ticketSelfHandlingEnabled:true,
  ticketSelfHandlingWebSource:true,
};

async function decodePng(b:Browser){
  const png=Buffer.from(await b.screenshot(),'base64');
  assert.equal(png.subarray(1,4).toString(),'PNG','browser screenshot must be a PNG');
  const {data,info}=await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  return {png,data,info};
}

function readPixel(data:Buffer,info:{width:number;height:number;channels:number},px:number,py:number):[number,number,number]{
  assert.ok(px>=0&&px<info.width&&py>=0&&py<info.height,`pixel (${px},${py}) outside ${info.width}x${info.height}`);
  const idx=(py*info.width+px)*info.channels;
  const r=data[idx],g=data[idx+1],b=data[idx+2];
  assert.ok(r!==undefined&&g!==undefined&&b!==undefined,'sampled pixel must contain all three RGB channels');
  return [r,g,b];
}

function sampleCardPixels(frame:Awaited<ReturnType<typeof decodePng>>,rect:Record<string,unknown>,edgeInset:number,diag:VisualDiagnostics){
  const sx=frame.info.width/Number(rect.vw),sy=frame.info.height/Number(rect.vh);
  const measure=(label:string,cssX:number,cssY:number)=>{
    const x=Math.floor(cssX*sx),y=Math.floor(cssY*sy);
    return {label,x,y,rgb:readPixel(frame.data,frame.info,x,y)};
  };
  const fill=measure('interior',Number(rect.left)+6,Number(rect.top)+6);
  const edge=measure('top edge',(Number(rect.left)+Number(rect.right))/2,Number(rect.top)+edgeInset);
  diag.sample(frame.png,[fill,edge]);
  return {fillRgb:fill.rgb,edgeRgb:edge.rgb,edge};
}

async function cardOwnersAtPixels(b:Browser,points:{x:number;y:number}[],image:{width:number;height:number}){
  return b.evaluate(`${JSON.stringify(points.map(p=>[p.x,p.y]))}.map(([x,y])=>
    document.elementFromPoint((x+.5)*innerWidth/${image.width},(y+.5)*innerHeight/${image.height})?.closest('.ticket-card')?.dataset.itemId??null)`);
}

function rgbDistance(a:readonly [number,number,number],b:readonly [number,number,number]):number{
  return Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
}

/** A wider dash reaches further inside the circle. Integrate antialiased ink over the
 * entire inner half-pixel band so the result does not depend on where a dash begins. */
function innerBandInk(frame:Awaited<ReturnType<typeof decodePng>>,rect:Record<string,unknown>,scale:number,fg:readonly number[],label:string){
  const cx=(Number(rect.left)+Number(rect.right))*scale/2,cy=(Number(rect.top)+Number(rect.bottom))*scale/2;
  const radius=Number(rect.width)*scale/2,bg=readPixel(frame.data,frame.info,Math.floor(cx),Math.floor(cy));
  const delta=bg.map((channel,i)=>channel-Number(fg[i]));
  const norm=delta.reduce((sum,c)=>sum+c*c,0);
  assert.ok(norm>0,label+' stroke and interior must be distinguishable');
  let ink=0;
  const points:Sample[]=[];
  const sampleInk=(x:number,y:number,region:string)=>{
    const rgb=readPixel(frame.data,frame.info,x,y);
    const coverage=rgb.reduce((sum,c,i)=>sum+(Number(bg[i])-c)*Number(delta[i]),0)/norm;
    points.push({label:label+' '+region,x,y,rgb});
    return Math.min(1,Math.max(0,coverage));
  };
  for(let y=Math.floor(cy-radius);y<Math.ceil(cy+radius);y++){
    for(let x=Math.floor(cx-radius);x<Math.ceil(cx+radius);x++){
      const depth=(radius-Math.hypot(x+.5-cx,y+.5-cy))/scale;
      if(depth<1||depth>=1.5)continue;
      ink+=sampleInk(x,y,'inner band');
    }
  }
  assert.ok(points.length>0,label+' must have physical pixel centres in the 1–1.5 CSS px band');
  const mean=ink/points.length;
  // Check continuity separately at the stroke centreline. Require consecutive samples
  // of clear background or strong ink; isolated antialiased pixels cannot count as a gap.
  const sectors=Array.from({length:72},(_,i)=>{
    const angle=i*2*Math.PI/72,r=radius-.75*scale;
    return sampleInk(Math.floor(cx+r*Math.cos(angle)),Math.floor(cy+r*Math.sin(angle)),'circumference');
  });
  const phases:string[]=[];
  for(const [i,v] of sectors.entries()){
    const next=Number(sectors[(i+1)%sectors.length]);
    if(v>=0.65&&next>=0.65)phases.push('ink');
    if(v<=0.15&&next<=0.15)phases.push('gap');
  }
  const gaps=phases.filter((p,i)=>p==='gap'&&phases[(i+phases.length-1)%phases.length]==='ink').length;
  return {mean,gaps,points,bg};
}

/** Freeze only the overlay under test. Neighbours and the FLIP lift shadow must reach their real end positions. */
async function holdVisibleOverlay(b:Browser,selector:string,time:number,center=false){
  await b.evaluate(`(()=>{
    const node=${query(selector)};
    const overlay=node?.getAnimations({subtree:true}).find(a=>a.effect.target===node&&a.effect.pseudoElement==='::after');
    if(!overlay)throw Error('missing target overlay on '+${JSON.stringify(selector)});
    overlay.pause();overlay.currentTime=${time};
    if(${center})node.scrollIntoView({block:'center',behavior:'instant'});
  })()`);
  await b.command('Animation.setPlaybackRate',{playbackRate:1});
  await waitForAnimationsSettled(b,'.board',9000);
}

async function assertPaintedCard(b:Browser,selector:string){
  const owner=await b.evaluate(`(()=>{
    const node=${query(selector)},r=node.getBoundingClientRect();
    return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('.ticket-card')===node;
  })()`);
  assert.equal(owner,true,selector+' must be the frontmost card in its filmstrip after entry');
}

async function assertFontsLoaded(b:Browser){
  await b.evaluate('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
  const report=await b.evaluate(`(()=>{
    const checks=[
      ['Inter Variable','14px "Inter Variable"','IT-0001'],
      ['Noto Sans SC Variable','14px "Noto Sans SC Variable"','未分类待受理'],
      ['JetBrains Mono Variable','12px "JetBrains Mono Variable"','IT-0001'],
    ];
    return checks.map(([family,font,sample])=>({
      family,
      check:document.fonts.check(font,sample),
      loaded:[...document.fonts].filter(f=>f.family.replaceAll('"','').replaceAll("'",'')===family&&f.status==='loaded').length,
      failed:[...document.fonts].filter(f=>f.family.replaceAll('"','').replaceAll("'",'')===family&&f.status==='error').length,
    }));
  })()`);
  assert.ok(Array.isArray(report),'font readiness probe must return each requested family');
  for(const raw of report){
    const item=object(raw);
    assert.equal(item.check,true,`font ${String(item.family)} must render sample glyphs`);
    assert.ok(Number(item.loaded)>0,`font ${String(item.family)} must have loaded faces`);
    assert.equal(item.failed,0,`font ${String(item.family)} must have zero failed faces`);
  }
}

async function claimAsColleague(f:Fixture,ticketId:string,cookieIndex=2){
  const cookie=f.cookies[cookieIndex];
  assert.ok(cookie,'claim requires a colleague session');
  const bootstrap=await fetch(f.origin+'/api/lifecycle/bootstrap',{headers:{cookie}});
  assert.equal(bootstrap.status,200,'colleague bootstrap must succeed');
  const {csrf_token}=object(await bootstrap.json());
  assert.equal(typeof csrf_token,'string','colleague bootstrap must supply CSRF');
  const detail=await fetch(`${f.origin}/api/tickets/${ticketId}`,{headers:{cookie}});
  assert.equal(detail.status,200,'colleague must be able to read the ticket before claiming');
  const ticket=object(await detail.json());
  const version=Number(ticket.version),resolverTeamId=String(ticket.resolver_team_id);
  const commandId=randomUUID();
  const res=await fetch(`${f.origin}/api/tickets/${ticketId}/take-and-start`,{
    method:'POST',
    headers:{
      cookie,
      origin:f.origin,
      'content-type':'application/json',
      'x-csrf-token':String(csrf_token),
      'idempotency-key':commandId,
      'if-match':`"${version}"`,
    },
    body:JSON.stringify({
      client_command_id:commandId,
      expected_version:version,
      reason_code:'LOOP_EXPLICIT_START',
      resolver_team_id:resolverTeamId,
    }),
  });
  assert.equal(res.status,200,await res.text());
  const confirmed=await fetch(`${f.origin}/api/tickets/${ticketId}`,{headers:{cookie}});
  assert.equal(confirmed.status,200,'claim must be independently readable');
  const after=object(await confirmed.json());
  assert.equal(after.status,'IN_PROGRESS','claim must transition to IN_PROGRESS');
  assert.equal(after.assignee_id,f.principals[cookieIndex]?.id,'claim must name the selected colleague as assignee');
}

async function finishFrozenMove(b:Browser,selector:string,tone:'active'|'done'){
  // A later column response can replace a destination node while playback is frozen.
  const observed=await b.evaluate(`(async()=>{
    const deadline=performance.now()+5000;
    let moved=false;
    while(performance.now()<deadline){
      const node=${query(selector)};
      const flight=node?.getAnimations().find(a=>a.effect.getKeyframes().some(k=>typeof k.transform==='string'&&k.transform.startsWith('translate(')));
      if(flight&&flight.playState!=='finished'){
        if(node.hasAttribute('data-highlight-tone'))throw Error('highlight overlapped the cross-column FLIP');
        moved=true;
        flight.finish();
      }else if(node?.dataset.highlightTone===${JSON.stringify(tone)})return moved;
      await new Promise(requestAnimationFrame);
    }
    throw Error('expected frozen FLIP followed by '+${JSON.stringify(tone)}+' highlight on '+${JSON.stringify(selector)});
  })()`);
  assert.equal(observed,true,'the peer must see a cross-column flight before its highlight');
}

async function beginPresence(f:Fixture,id:string,cookieIndex=2,mode:'VIEWING'|'EDITING'='VIEWING'){
  const cookie=f.cookies[cookieIndex];
  assert.ok(cookie,'presence requires a colleague session');
  const bootstrap=await fetch(f.origin+'/api/lifecycle/bootstrap',{headers:{cookie}});
  assert.equal(bootstrap.status,200,'presence peer bootstrap must succeed');
  const {csrf_token}=object(await bootstrap.json());
  assert.equal(typeof csrf_token,'string','presence peer bootstrap must supply CSRF');
  const controller=new AbortController(),browser_id=randomUUID();
  const renew=async()=>{
    const response=await fetch(f.origin+'/api/workbench/activity',{
      method:'POST',
      signal:controller.signal,
      headers:{cookie,origin:f.origin,'content-type':'application/json','x-csrf-token':String(csrf_token)},
      body:JSON.stringify({schema_version:1,browser_id,target:{kind:'ticket',id},action:'RENEW',visible:true,active:true,mode,field:mode==='EDITING'?'internal-note':null}),
    });
    assert.equal(response.status,200,await response.text());
  };
  let drained:Promise<void>|undefined,failure:unknown;
  try{
    const stream=await fetch(f.origin+'/api/realtime/events?scope=workbench',{signal:controller.signal,headers:{cookie,accept:'text/event-stream'}});
    assert.equal(stream.status,200,'presence peer SSE connection must open');
    assert.ok(stream.body,'presence peer SSE must have a readable body');
    const reader=stream.body.getReader();
    drained=(async()=>{
      try{
        while(!(await reader.read()).done){/* consume peer SSE frames until teardown */}
        if(!controller.signal.aborted)throw Error('Presence peer SSE stream ended early');
      }catch(error){
        if(!controller.signal.aborted)failure=error;
      }finally{
        reader.releaseLock();
      }
    })();
    await renew();
  }catch(error){
    controller.abort();
    await drained;
    throw error;
  }
  const timer=setInterval(()=>{void renew().catch(error=>{failure=error;});},4000);
  return async()=>{clearInterval(timer);controller.abort();await drained;if(failure)throw failure;};
}

// Presence needs a live SSE session. Keep ordinary arrival scenarios on explicit refresh so
// their observation is armed before a board reply can start an animation.
async function assertPresenceHighlight(palette:Record<string,unknown>,diag:VisualDiagnostics){
  await withWeb01Fixture(async(f:Fixture)=>{
    const presId=await seedMotionTicket(f.pool,'协作在场高亮冲突');
    const cookie=f.browserCookies[0];assert.ok(cookie,'presence observer requires its own fixture session');
    const b=await launchSystemBrowser({url:f.origin+appPath+'?range=all',width:1440,height:1600,cookies:[{...cookie,url:f.origin+'/'}]});
    assert.ok(b,'presence observer browser must start');
    let failure:unknown;
    diag.focus('.board','presence setup',b);
    try{
      await b.command('Page.bringToFront');
      await b.waitFor(`${boardReady}&&Boolean(document.querySelector('[data-realtime-status=live]'))`);
      await sortPendingNewest(b);
      await expandBoardGroup(b,'待接单');
      await expandRemainder(b,'pending');
      await expandRemainder(b,'active');
      await b.evaluate("window.scrollTo({top:0,behavior:'instant'})");
      await move(b,{x:1,y:1});
      await waitForAnimationsSettled(b);
      await b.command('Animation.enable');
      const stopPresence=await beginPresence(f,presId,2,'VIEWING');
      const presActiveSel=active(ticketCard(presId));
      diag.focus(presActiveSel,'presence hold',b);
      try{
        await b.waitFor(`${query(pending(ticketCard(presId)))}?.dataset.presence==='viewing'`);
        await b.command('Animation.setPlaybackRate',{playbackRate:0});
        await claimAsColleague(f,presId,2);
        await b.evaluate(refreshBoard);
        await finishFrozenMove(b,presActiveSel,'active');
        await b.waitFor(`Boolean(${query(presActiveSel)}?.dataset.highlightTone==='active'&&${query(presActiveSel)}?.dataset.presence==='viewing')`);
        await holdVisibleOverlay(b,presActiveSel,100,true);
        const presInfo=object(await b.evaluate(`(()=>{
          const node=${query(presActiveSel)},r=node.getBoundingClientRect();
          const cs=getComputedStyle(node),after=getComputedStyle(node,'::after');
          const probe=document.createElement('i');probe.style.boxShadow='var(--shadow-presence-viewing)';document.body.append(probe);
          const expectedShadow=getComputedStyle(probe).boxShadow;probe.remove();
          return {afterOpacity:Number(after.opacity),presence:node.dataset.presence,shadow:cs.boxShadow,expectedShadow,
            rect:{left:r.left,top:r.top,right:r.right,vw:innerWidth,vh:innerHeight}};
        })()`));
        diag.record({presInfo,palette});
        const prect=object(presInfo.rect);
        const png=await decodePng(b);
        const {fillRgb,edgeRgb,edge}=sampleCardPixels(png,prect,0.5,diag);
        const owners=await cardOwnersAtPixels(b,[edge],png.info);
        diag.record({owners});
        assert.equal(presInfo.presence,'viewing','the same active card must still project colleague viewing presence');
        assert.deepEqual(owners,[presId],'the sampled presence edge must belong to the destination card');
        assert.equal(presInfo.afterOpacity,1,'presence pixels must be measured at full highlight opacity');
        assert.equal(presInfo.shadow,presInfo.expectedShadow,'the FLIP lift must restore the viewing inset shadow during the hold');
        assert.ok(rgbDistance(edgeRgb,palette.brandRgb as [number,number,number])<=15,`presence 1.5px ring ${edgeRgb} must stay visible over highlight`);
        assert.ok(rgbDistance(fillRgb,palette.canvasBg as [number,number,number])<=10,`presence card fill ${fillRgb} must remain visible`);
      }catch(error){await diag.save(error);throw error;}finally{
        await b.command('Animation.setPlaybackRate',{playbackRate:1}).catch(()=>{});
        await stopPresence();
      }
    }catch(error){await diag.save(error);failure=error;}finally{
      await closeBrowserTestResources([async()=>{
        await b.close();
        assert.deepEqual(b.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0},'presence observer must release all owned browser resources');
      }],failure);
    }
  },{...fixtureOptions,workbenchRealtimeEnabled:true,workbenchActivityEnabled:true});
}

async function inspectAxSubtree(b:Browser,selector:string){
  const resolved=object(await b.command('Runtime.evaluate',{
    expression:`document.querySelector(${JSON.stringify(selector)})`,
    returnByValue:false,
  }));
  const remote=object(resolved.result);
  assert.equal(typeof remote.objectId,'string',`AX target missing for ${selector}`);
  const objectId=String(remote.objectId);
  const simplify=(node:Record<string,unknown>)=>{
    const roleObj=node.role&&typeof node.role==='object'?object(node.role):null;
    const nameObj=node.name&&typeof node.name==='object'?object(node.name):null;
    return {
      ignored:Boolean(node.ignored),
      role:roleObj?String(roleObj.value??''):'',
      name:nameObj?String(nameObj.value??''):'',
    };
  };
  try{
    // Ignored decorative nodes can disappear from the full tree. Ask for the root explicitly.
    const partial=object(await b.command('Accessibility.getPartialAXTree',{objectId,fetchRelatives:false}));
    assert.ok(Array.isArray(partial.nodes)&&partial.nodes.length===1,'partial AX query must return the requested root, including hidden icons');
    const root=simplify(object(partial.nodes[0]));
    const subtree=object(await b.command('DOM.describeNode',{objectId,depth:-1}));
    const ids=new Set<number>();
    const collect=(node:Record<string,unknown>)=>{
      if(typeof node.backendNodeId==='number')ids.add(node.backendNodeId);
      if(Array.isArray(node.children))for(const child of node.children)collect(object(child));
    };
    collect(object(subtree.node));
    const full=object(await b.command('Accessibility.getFullAXTree'));
    assert.ok(Array.isArray(full.nodes),'full AX query must return nodes for descendant checks');
    const nodes=full.nodes.map(n=>object(n)).filter(n=>typeof n.backendDOMNodeId==='number'&&ids.has(n.backendDOMNodeId)).map(simplify);
    return {root,nodes};
  }finally{
    await b.command('Runtime.releaseObject',{objectId});
  }
}

async function expandBoardGroup(b:Browser,label:string){
  const trigger=`.ds-board-group[data-board-group=${JSON.stringify(label)}] .ds-board-group-trigger`;
  const expanded=await b.evaluate(`${query(trigger)}?.getAttribute('aria-expanded')`);
  if(expanded==='false'){
    await clickWorkbenchControl(b,trigger);
    await waitForAnimationsSettled(b);
  }
}

async function sortPendingNewest(b:Browser){
  await clickWorkbenchControl(b,'.board-column.pending .ds-column-sort');
  await clickWorkbenchControl(b,'[role=menu] [data-key=newest]');
  await b.waitFor("document.querySelector('.board-column.pending .ds-column-sort').textContent.includes('最新到达')");
  await waitForAnimationsSettled(b);
}

async function expandRemainder(b:Browser,columnClass:string){
  const selector=`.board-column.${columnClass} [data-action=expand-column][aria-expanded=false]`;
  if(await b.evaluate(`Boolean(${query(selector)})`)){
    await clickWorkbenchControl(b,selector);
    await waitForAnimationsSettled(b);
  }
}

async function writePlaceholderComposite(outputFile:string,panels:readonly {label:string;buffer:Buffer}[]){
  const metaList=await Promise.all(panels.map(async panel=>({panel,meta:await sharp(panel.buffer).metadata()})));
  const maxWidth=Math.max(...metaList.map(entry=>entry.meta.width??0));
  const pad=16,gap=12;
  const totalWidth=maxWidth+pad*2;
  const totalHeight=pad*2+metaList.reduce((sum,entry)=>sum+(entry.meta.height??0),0)+gap*Math.max(0,metaList.length-1);
  let top=pad;
  const composites=metaList.map(entry=>{
    const item={input:entry.panel.buffer,left:pad,top};
    top+=(entry.meta.height??0)+gap;
    return item;
  });
  await sharp({create:{width:totalWidth,height:totalHeight,channels:4,background:{r:255,g:255,b:255,alpha:1}}}).composite(composites).png().toFile(outputFile);
}

async function cropElement(b:Browser,selector:string,padCss=8):Promise<Buffer>{
  const rect=object(await b.evaluate(`(()=>{
    const node=${query(selector)};if(!node)throw Error('crop target missing: '+${JSON.stringify(selector)});
    const r=node.getBoundingClientRect();
    return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,vw:innerWidth,vh:innerHeight};
  })()`));
  const {png,info}=await decodePng(b);
  const sx=info.width/Number(rect.vw),sy=info.height/Number(rect.vh);
  const left=Math.max(0,Math.floor((Number(rect.left)-padCss)*sx));
  const top=Math.max(0,Math.floor((Number(rect.top)-padCss)*sy));
  const right=Math.min(info.width,Math.ceil((Number(rect.right)+padCss)*sx));
  const bottom=Math.min(info.height,Math.ceil((Number(rect.bottom)+padCss)*sy));
  assert.ok(right>left&&bottom>top,`crop bounds empty for ${selector}`);
  return sharp(png).extract({left,top,width:right-left,height:bottom-top}).png().toBuffer();
}

test('Card 39B new card arrival highlight overlay, placeholders and reduced motion',{timeout},t=>withWeb01Fixture(async(f:Fixture)=>{
  const evidence=process.env.CARD39B_EVIDENCE_DIR?join(root,process.env.CARD39B_EVIDENCE_DIR):await mkdtemp(join(tmpdir(),'card39b-evidence-'));
  const cache=await mkdtemp(join(tmpdir(),'card39b-vite-'));
  const appRoot=join(root,'app/pc-admin');
  let app:Awaited<ReturnType<typeof createServer>>|undefined;
  let browser:Browser|undefined;
  let failure:unknown;
  const receipts:Record<string,unknown>={};

  try{
    await f.pool.query("UPDATE intake.service_intake SET summary=summary||'（合成）' WHERE summary IN ($1,$2)",[
      '尚待判断的合成材料，请协助确认。','位置尚不清楚，等待补充的全新合成报修。',
    ]);
    app=await createServer({
      configFile:false,
      root:appRoot,
      base:'/workbench/app/',
      cacheDir:cache,
      plugins:[react(),tailwind()],
      logLevel:'error',
      server:{
        host:'127.0.0.1',
        port:0,
        fs:{allow:[root]},
        proxy:{'/api':{target:f.origin,changeOrigin:true,headers:{origin:f.origin}}},
      },
    });
    await app.listen();
    const addr=app.httpServer?.address();
    assert.ok(addr&&typeof addr==='object','fixture server must expose a TCP address');
    const origin='http://127.0.0.1:'+addr.port;
    const actorCookie=f.browserCookies[0];
    assert.ok(actorCookie,'fixture must supply an observer session');

    const b=await launchSystemBrowser({url:origin+appPath+'?range=all&motion=slow',width:1440,height:1600,cookies:[{...actorCookie,url:origin}]});
    assert.ok(b,'observer browser must start');
    browser=b;
    await b.command('Emulation.setDeviceMetricsOverride',{width:1440,height:1600,deviceScaleFactor:1,mobile:false});
    await b.command('Page.bringToFront');
    await b.command('Accessibility.enable');

    const navigate=async(route:string)=>{
      await b.evaluate('window.__card39bPrev=true');
      await b.command('Page.navigate',{url:origin+route});
      await b.waitFor(`!window.__card39bPrev&&${boardReady}`);
      await assertFontsLoaded(b);
      await move(b,{x:1,y:1});
      await waitForAnimationsSettled(b);
    };

    const failedCases:string[]=[];
    const check=async(name:string,run:(diag:VisualDiagnostics)=>Promise<void>,diagnosticKey?:string)=>{
      const diag=visualDiagnostics(diagnosticKey,b);
      await t.test(name,async()=>{
        try{await run(diag);}
        catch(error){await diag.save(error);failedCases.push(name);throw error;}
      });
    };

    const captureFilmstrip=createFilmstripCapture(b,join(evidence,'filmstrip'));

    await check('39B A1/A2 intake arrival: slow filmstrip, same-frame shift+overlay, token timing, relative time and scope reset',async()=>{
      await navigate(appPath+'?range=all&motion=slow');
      await b.waitFor('document.documentElement.dataset.motion==="slow"');
      const resolvedTokens=object(await b.evaluate(`(()=>{
        const s=getComputedStyle(document.documentElement);
        return {hold:s.getPropertyValue('--dur-highlight-hold').trim(),dur:s.getPropertyValue('--dur-highlight').trim(),ease:s.getPropertyValue('--ease-ambient').trim()};
      })()`));
      assert.equal(resolvedTokens.hold,'1200ms','slow hold must be five times 240ms');
      assert.equal(resolvedTokens.dur,'6000ms','slow fade must be five times 1200ms');
      assert.equal(resolvedTokens.ease,'ease-in-out','hold must transition into the ambient ease-in-out fade');

      await expandBoardGroup(b,'待判断');
      await expandBoardGroup(b,'待接单');
      await expandRemainder(b,'active');
      await b.evaluate("window.scrollTo({top:0,behavior:'instant'})");
      await waitForAnimationsSettled(b);

      const existingTimeStyle=object(await b.evaluate(`(()=>{
        const t=document.querySelector('.board-column.pending .ticket-card .activity-time');
        if(!t)throw Error('existing activity-time missing');
        const cs=getComputedStyle(t);
        const fs=getComputedStyle(document.documentElement).getPropertyValue('--fs-xs').trim();
        return {fontSize:cs.fontSize,color:cs.color,fsToken:fs};
      })()`));
      assert.equal(existingTimeStyle.fontSize,existingTimeStyle.fsToken,'existing card time must use the xs font token');

      const newIntake=await seedWeb01NoConversationIntake({pool:f.pool,text:'门诊挂号屏无显示（合成）',location:'门诊一楼大厅（合成）',serviceCode:null});
      const selector=pending(intakeCard(newIntake.intakeId));
      const baseCardBg=String(await b.evaluate(`(()=>{const p=document.createElement('i');p.style.backgroundColor='var(--bg-canvas)';document.body.append(p);const c=getComputedStyle(p).backgroundColor;p.remove();return c;})()`));
      const sampleOpacities:number[]=[];
      let highlightMetrics:unknown;
      let entryMetrics:unknown;

      const file=await captureFilmstrip('arrival-intake',async()=>{
        // CDP freezes the animation timeline; record when the page actually issues both effects.
        await b.evaluate(`(()=>{
          const animate=Element.prototype.animate,starts={};
          window.__card39bStarts=starts;
          let frame=0;
          const tick=()=>{frame++;raf=requestAnimationFrame(tick);};
          let raf=requestAnimationFrame(tick);
          Element.prototype.animate=function(k,o){
            const a=animate.call(this,k,o);
            if(this.matches(${JSON.stringify(selector)})){
              const kind=o?.pseudoElement==='::after'?'overlay':Array.isArray(k)&&k.some(f=>'transform' in f&&'opacity' in f)?'entry':null;
              if(kind)starts[kind]={time:performance.now(),frame};
              if(starts.overlay&&starts.entry){Element.prototype.animate=animate;cancelAnimationFrame(raf);}
            }
            return a;
          };
        })()`);
        await b.evaluate(refreshBoard);
        await b.waitFor(`Boolean(${query(selector)}?.dataset.highlightTone==='intake')`);
        await b.evaluate(frames);
        const sameFrame=object(await b.evaluate(`(()=>{
          const node=${query(selector)};
          const anims=node.getAnimations({subtree:true}).filter(a=>a.effect?.target===node);
          const entry=anims.find(a=>!a.effect.pseudoElement&&a.effect.getKeyframes().some(k=>'transform' in k&&'opacity' in k));
          const hl=anims.find(a=>a.effect.pseudoElement==='::after');
          const entryKf=entry?.effect.getKeyframes()??[];
          const starts=window.__card39bStarts;
          return {
            hasEntry:Boolean(entry),
            hasHl:Boolean(hl),
            entryStartY:entryKf.length?new DOMMatrixReadOnly(entryKf[0].transform).m42:null,
            entryEndY:entryKf.length?new DOMMatrixReadOnly(entryKf.at(-1).transform).m42:null,
            shift:parseFloat(getComputedStyle(node).getPropertyValue('--shift-md')),
            entryStartOpacity:entryKf[0]?.opacity??null,
            entryEndOpacity:entryKf.at(-1)?.opacity??null,
            sameFrame:Boolean(starts.entry&&starts.overlay&&starts.entry.frame===starts.overlay.frame),
            startDeltaMs:starts.entry&&starts.overlay?Math.abs(starts.entry.time-starts.overlay.time):null,
            afterOpacity:getComputedStyle(node,'::after').opacity,
            hostOpacity:getComputedStyle(node).opacity,
          };
        })()`));
        assert.equal(sameFrame.hasEntry,true,'new intake must start host enterSlide animation in the same frame');
        assert.equal(sameFrame.hasHl,true,'new intake must start ::after highlight overlay in the same frame');
        assert.equal(sameFrame.entryStartOpacity,'0','entry host must start transparent');
        assert.equal(sameFrame.entryEndOpacity,'1','entry host must finish opaque');
        assert.equal(sameFrame.entryStartY,-Number(sameFrame.shift),'entry must start one negative shift token above its final position');
        assert.equal(sameFrame.entryEndY,0,'entry must end at zero displacement');
        assert.equal(sameFrame.afterOpacity,'1','overlay ::after must be opacity 1 at frame 0');
        assert.equal(sameFrame.sameFrame,true,'host entry and highlight must be issued in the same animation frame');
        assert.ok(typeof sameFrame.startDeltaMs==='number'&&sameFrame.startDeltaMs<=20,`shift and overlay must start together (delta=${sameFrame.startDeltaMs}ms)`);
        const entryCheck=await assertMotion(b,selector,'--dur-base','--ease-standard',{animationName:'WAAPI',pseudoElement:null});
        assert.deepEqual(entryCheck.map(a=>[...a.properties].sort()),[['opacity','transform']],'host entry must animate exactly opacity and transform');
        entryMetrics=entryCheck;
      },selector,{
        companionFlips:movingCards,
        sampleTimesMs:slowSampleTimes,
        frameLabels:slowFrameLabels,
        onSample:async(index,timeMs)=>{
          if(index>0)await assertPaintedCard(b,selector);
          const state=object(await b.evaluate(`(()=>{
            const node=${query(selector)};
            const after=getComputedStyle(node,'::after');
            return {
              tone:node.dataset.highlightTone??null,
              afterOpacity:Number(after.opacity),
              cardBg:getComputedStyle(node).backgroundColor,
              inlineBg:node.style.backgroundColor,
              timeText:node.querySelector('.activity-time')?.textContent?.trim()??null,
              timeFontSize:node.querySelector('.activity-time')?getComputedStyle(node.querySelector('.activity-time')).fontSize:null,
              timeColor:node.querySelector('.activity-time')?getComputedStyle(node.querySelector('.activity-time')).color:null,
            };
          })()`));
          assert.equal(state.cardBg,baseCardBg,`card own backgroundColor must stay ${baseCardBg} at t=${timeMs}ms`);
          assert.equal(state.inlineBg,'','highlight must never write inline backgroundColor');
          sampleOpacities.push(Number(state.afterOpacity));
          if(index===1){
            assert.equal(state.tone,'intake','new H5 report must have intake tone during hold');
            assert.equal(state.timeText,'刚刚','fresh intake timestamp must display 刚刚');
            assert.equal(state.timeFontSize,existingTimeStyle.fontSize,'new intake time font must match existing cards');
            assert.equal(state.timeColor,existingTimeStyle.color,'new intake time colour must match existing cards');
            const hl=await assertMotion(b,selector,'--dur-highlight','--ease-ambient',{animationName:'WAAPI',pseudoElement:'::after',delayToken:'--dur-highlight-hold'});
            assert.deepEqual(hl.map(a=>a.properties),[['opacity']],'intake overlay must animate opacity alone');
            highlightMetrics=hl;
          }
        },
      });
      await waitForAnimationsSettled(b);

      assert.equal(sampleOpacities[0],1,'frame 1 (0ms) overlay opacity must be 1');
      assert.equal(sampleOpacities[1],1,'frame 2 (240ms) overlay opacity must be 1');
      assert.ok(Number(sampleOpacities[2])<1&&Number(sampleOpacities[2])>0,'frame 3 (480ms) must be fading');
      assert.ok(Number(sampleOpacities[3])<Number(sampleOpacities[2])&&Number(sampleOpacities[3])>0,'frame 4 (840ms) must continue fading');
      assert.ok(Number(sampleOpacities[4])<Number(sampleOpacities[3])&&Number(sampleOpacities[4])>0,'frame 5 (1200ms) must continue fading');
      assert.equal(sampleOpacities[5],0,'frame 6 (1440ms) overlay opacity must be 0');

      // Med #5 regression: filtering resets motionScope and immediately cancels active highlight handles on still-visible cards.
      await sortPendingNewest(b);
      const scopedIntake=await seedWeb01NoConversationIntake({pool:f.pool,text:'筛选切换取消高亮（合成）',location:'收费处窗口（合成）',serviceCode:null});
      const scopedSel=pending(intakeCard(scopedIntake.intakeId));
      await b.evaluate(refreshBoard);
      await b.waitFor(`Boolean(${query(scopedSel)}?.dataset.highlightTone==='intake')`);
      await b.evaluate(`(()=>{
        const node=${query(scopedSel)};
        if(!node.checkVisibility()||!node.querySelector('[data-category="unclassified"]'))throw Error('expected a visible unclassified intake');
        const animation=node.getAnimations({subtree:true}).find(a=>a.effect?.target===node&&a.effect.pseudoElement==='::after');
        animation.pause();
        window.__card39bScope={node,animation};
      })()`);
      const category='[aria-label="筛选已加载事项"] [data-field-label="类别"]';
      await chooseWorkbenchSelect(b,category,'unclassified');
      await b.waitFor("Boolean(document.querySelector('[aria-label=清除类别筛选]'))");
      const afterScopeReset=object(await b.evaluate(`(()=>{
        const node=${query(scopedSel)};
        const anims=node?node.getAnimations({subtree:true}).filter(a=>a.effect?.target===node&&a.effect?.pseudoElement==='::after'):[];
        const prior=window.__card39bScope;delete window.__card39bScope;
        return {present:node===prior.node&&node.checkVisibility(),oldState:prior.animation.playState,tone:node?.dataset.highlightTone??null,hlCount:anims.length};
      })()`));
      assert.equal(afterScopeReset.present,true,'unclassified arrival stays visible when filtering to unclassified');
      assert.equal(afterScopeReset.tone,null,'scope change must cancel highlight attribute immediately');
      assert.equal(afterScopeReset.hlCount,0,'scope change must cancel ::after highlight animation immediately');
      assert.equal(afterScopeReset.oldState,'idle','the original paused animation must be cancelled');
      await clickWorkbenchControl(b,'[aria-label="清除类别筛选"]');
      await b.waitFor(`${query(category+' select')}?.value==='all'`);
      await waitForAnimationsSettled(b);

      receipts.intake={file,sampleOpacities,entryMetrics,highlightMetrics,relativeTime:existingTimeStyle,scopeResetCancelled:afterScopeReset};
    });

    await check('39B A1/A2 active arrival: real colleague claim FLIP into 处理中, slow filmstrip and ::after overlay',async()=>{
      await navigate(appPath+'?range=all&motion=slow');
      await b.waitFor('document.documentElement.dataset.motion==="slow"');
      await sortPendingNewest(b);
      await expandBoardGroup(b,'待接单');
      await expandRemainder(b,'pending');
      await expandRemainder(b,'active');
      const activeId=await seedMotionTicket(f.pool,'药房发药机卡纸');
      await b.evaluate(refreshBoard);
      await b.waitFor(`Boolean(${query(pending(ticketCard(activeId)))}?.checkVisibility())`);
      await waitForAnimationsSettled(b,undefined,9000);

      const selector=active(ticketCard(activeId));
      const baseCardBg=String(await b.evaluate(`(()=>{const p=document.createElement('i');p.style.backgroundColor='var(--bg-canvas)';document.body.append(p);const c=getComputedStyle(p).backgroundColor;p.remove();return c;})()`));
      const sampleOpacities:number[]=[];
      let highlightMetrics:unknown;

      const file=await captureFilmstrip('arrival-active',async()=>{
        await claimAsColleague(f,activeId,2);
        await b.evaluate(refreshBoard);
        await finishFrozenMove(b,selector,'active');
        // The highlight's time zero is after the longer (320ms) cross-column flight.
        await b.evaluate(`for(const n of document.querySelectorAll(${JSON.stringify(movingCards)}))for(const a of n.getAnimations())if(a.effect.getKeyframes().some(k=>k.transform?.startsWith('translate(')))a.finish()`);
        await b.evaluate(frames);
      },selector,{
        sampleTimesMs:slowSampleTimes,
        frameLabels:slowFrameLabels,
        onSample:async(index,timeMs)=>{
          await assertPaintedCard(b,selector);
          const state=object(await b.evaluate(`(()=>{
            const node=${query(selector)};
            const after=getComputedStyle(node,'::after');
            return {tone:node.dataset.highlightTone??null,afterOpacity:Number(after.opacity),cardBg:getComputedStyle(node).backgroundColor,inlineBg:node.style.backgroundColor};
          })()`));
          assert.equal(state.cardBg,baseCardBg,`active card backgroundColor must stay ${baseCardBg} at t=${timeMs}ms`);
          assert.equal(state.inlineBg,'','peer claim must not write inline card background');
          sampleOpacities.push(Number(state.afterOpacity));
          if(index===1){
            assert.equal(state.tone,'active','claimed ticket must have active tone during hold');
            const hl=await assertMotion(b,selector,'--dur-highlight','--ease-ambient',{animationName:'WAAPI',pseudoElement:'::after',delayToken:'--dur-highlight-hold'});
            assert.deepEqual(hl.map(a=>a.properties),[['opacity']],'active overlay must animate opacity alone');
            highlightMetrics=hl;
          }
        },
      });
      await waitForAnimationsSettled(b);

      assert.equal(sampleOpacities[0],1,'active frame 1 must be fully opaque');
      assert.equal(sampleOpacities[1],1,'active frame 2 must end the full-opacity hold');
      assert.ok(Number(sampleOpacities[2])<1&&Number(sampleOpacities[2])>0,'active frame 3 must begin fading');
      assert.ok(Number(sampleOpacities[3])<Number(sampleOpacities[2])&&Number(sampleOpacities[3])>0,'active frame 4 must continue fading above zero');
      assert.ok(Number(sampleOpacities[4])<Number(sampleOpacities[3])&&Number(sampleOpacities[4])>0,'active frame 5 must continue fading above zero');
      assert.equal(sampleOpacities[5],0,'active frame 6 must be fully transparent');
      receipts.active={file,moveObserved:true,sampleOpacities,highlightMetrics};
    });

    await check('39B narrow list: sticky first column highlight tint/ring, horizontal occlusion and relative time',async diag=>{
      diag.focus('.ds-work-table-wrap','narrow table setup');
      await b.command('Emulation.setDeviceMetricsOverride',{width:960,height:1200,deviceScaleFactor:1,mobile:false});
      try{
        await navigate(appPath+'?range=all&view=list&motion=slow');
        const listMore='#list-subgroup-ticket-more [data-action=expand-column][aria-expanded=false]';
        if(await b.evaluate(`Boolean(${query(listMore)})`)){
          await clickWorkbenchControl(b,listMore);
          await waitForAnimationsSettled(b);
        }
        const wrapCheck=object(await b.evaluate(`(()=>{
          const wrap=document.querySelector('.ds-work-table-wrap');
          wrap.scrollLeft=140;
          const th=wrap.querySelector('.ds-work-row>th');
          return {
            wrapWidth:Math.round(wrap.getBoundingClientRect().width),
            scrollLeft:wrap.scrollLeft,
            thPosition:th?getComputedStyle(th).position:null,
            thLeft:th?Math.round(th.getBoundingClientRect().left-wrap.getBoundingClientRect().left):null,
          };
        })()`));
        assert.ok(Number(wrapCheck.wrapWidth)<=1080,'table container must be in narrow <=1080px container query');
        assert.ok(Number(wrapCheck.scrollLeft)>0,'narrow table must have real horizontal scroll');
        assert.equal(wrapCheck.thPosition,'sticky','first column must be sticky before arrival');
        assert.ok(Math.abs(Number(wrapCheck.thLeft))<=2,'first column th must stay sticky on left edge after horizontal scroll');

        // Start wide and cross the sticky-column breakpoint during the same highlight.
        await b.command('Emulation.setDeviceMetricsOverride',{width:1920,height:1200,deviceScaleFactor:1,mobile:false});
        await b.waitFor("getComputedStyle(document.querySelector('.ds-work-row>th')).position!=='sticky'");
        const listTicketId=await seedMotionTicket(f.pool,'窄列表首列品牌高亮');
        const rowSel=ticketRow(listTicketId);
        diag.focus(rowSel,'crossing the sticky breakpoint during fade');
        await b.command('Animation.enable');
        try{
          await b.evaluate(refreshBoard);
          // Let the real clock start the fade. Freeze the page once, then resize without
          // seeking either overlay so a newly created or restarted first-cell effect is visible.
          await b.waitFor(`(()=>{const row=${query(rowSel)};
            if(row?.dataset.highlightTone!=='brand')return false;
            const opacity=Number(getComputedStyle(row,'::after').opacity);
            return opacity>0.25&&opacity<0.85;
          })()`);
          await b.command('Animation.setPlaybackRate',{playbackRate:0});
          const inspectFade=`(()=>{
            const row=${query(rowSel)},th=row.querySelector('th');
            return {sticky:getComputedStyle(th).position==='sticky',
              opacity:[row,th].map(n=>Number(getComputedStyle(n,'::after').opacity)),
              effects:[row,th].map(n=>n.getAnimations({subtree:true})
                .filter(a=>a.effect?.target===n&&a.effect.pseudoElement==='::after')
                .map(a=>({time:a.currentTime,start:a.startTime,state:a.playState})))};
          })()`;
          const wide=object(await b.evaluate(inspectFade));
          diag.record({wide});
          assert.equal(wide.sticky,false,'the fade must start before the first cell becomes sticky');
          await b.command('Emulation.setDeviceMetricsOverride',{width:960,height:1200,deviceScaleFactor:1,mobile:false});
          await b.evaluate(frames);
          const resized=object(await b.evaluate(inspectFade));
          diag.record({wide,resized});
          assert.equal(resized.sticky,true,'the first cell must be sticky after resizing');
          assert.ok(Array.isArray(wide.opacity)&&wide.opacity[0]>0&&wide.opacity[0]<1,'freeze must capture the row during its fade');
          assert.deepEqual(resized.opacity,[wide.opacity[0],wide.opacity[0]],'the first sticky paint must preserve the running row opacity before any seek');
          diag.focus(rowSel,'sticky row hold');
          await b.evaluate(`(async()=>{
            const wrap=document.querySelector('.ds-work-table-wrap');
            const row=${query(rowSel)};
            row.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
            // Expose half of the actual issue cell and scroll the other half behind the header.
            const issueWidth=row.querySelector('.ds-list-problem').getBoundingClientRect().width;
            const headerWidth=row.querySelector('th').getBoundingClientRect().width;
            wrap.scrollLeft=Math.floor(Math.min(issueWidth,headerWidth)/2);
            for(const a of row.getAnimations({subtree:true})){a.pause();a.currentTime=1200;}
          })()`);
          await waitForAnimationsSettled(b,rowSel);
          const meta=object(await b.evaluate(`(()=>{
            const row=${query(rowSel)};
            const th=row.querySelector('th');
            const td=row.querySelector('.ds-list-problem');
            const tr=th.getBoundingClientRect(),dr=td.getBoundingClientRect();
            const probe=document.createElement('i');
            probe.style.backgroundColor='var(--brand-subtle)';
            document.body.append(probe);
            const brandBg=getComputedStyle(probe).backgroundColor.match(/\\d+/g).slice(0,3).map(Number);
            probe.style.backgroundColor='var(--bg-canvas)';
            const canvasBg=getComputedStyle(probe).backgroundColor.match(/\\d+/g).slice(0,3).map(Number);
            probe.style.color='var(--highlight-ring-brand)';
            const ringParts=getComputedStyle(probe).color.match(/[\\d.]+/g).map(Number);
            probe.remove();
            const a=ringParts[3]??1;
            const expectedRing=[
              Math.round(ringParts[0]*a+brandBg[0]*(1-a)),
              Math.round(ringParts[1]*a+brandBg[1]*(1-a)),
              Math.round(ringParts[2]*a+brandBg[2]*(1-a)),
            ];
            const wrap=row.closest('.ds-work-table-wrap'),wr=wrap.getBoundingClientRect();
            const clipLeft=Math.max(0,wr.left+wrap.clientLeft);
            const clipRight=Math.min(innerWidth,wr.left+wrap.clientLeft+wrap.clientWidth);
            const overlapLeft=Math.max(tr.left,dr.left,clipLeft),overlapRight=Math.min(tr.right,dr.right,clipRight);
            const exposedLeft=Math.max(tr.right,dr.left,clipLeft),exposedRight=Math.min(dr.right,clipRight);
            const x=(overlapLeft+overlapRight)/2,exposedX=(exposedLeft+exposedRight)/2,y=tr.top+6;
            const stack=document.elementsFromPoint(x,y),exposedStack=document.elementsFromPoint(exposedX,y);
            const header=stack.indexOf(th),issue=stack.indexOf(td),link=row.querySelector('.row-link');
            return {
              vw:innerWidth,vh:innerHeight,scrollLeft:row.closest('.ds-work-table-wrap').scrollLeft,
              stickyPosition:getComputedStyle(th).position,
              stack:stack.map(el=>({tag:el.tagName,classes:el.className})),hit:{x,y},exposedX,
              overlapWidth:overlapRight-overlapLeft,exposedWidth:exposedRight-exposedLeft,
              exposedIssue:exposedStack.includes(td)&&!exposedStack.includes(th),
              coversScrolledCell:header>=0&&issue>header&&
                stack.slice(0,header).every(el=>el===link||th.contains(el)),
              timeText:row.querySelector('.activity-time')?.textContent?.trim()??null,
              thAfterOpacity:Number(getComputedStyle(th,'::after').opacity),
              thRect:{left:tr.left,top:tr.top,right:tr.right,bottom:tr.bottom,height:tr.height},
              tdRect:{left:dr.left,top:dr.top,right:dr.right},
              brandBg,canvasBg,expectedRing,
            };
          })()`));
          diag.record({meta,wrapCheck});
          assert.equal(meta.timeText,'刚刚','list row arrival must resample clock and display 刚刚');
          assert.equal(meta.thAfterOpacity,1,'sticky overlay must be fully opaque at the hold boundary');
          const thRect=object(meta.thRect),hit=object(meta.hit);
          assert.equal(meta.stickyPosition,'sticky','resized first column must still be sticky');
          assert.ok(Number(meta.scrollLeft)>0&&Number(meta.overlapWidth)>2,'the issue cell must overlap the sticky header with room for an interior pixel');
          assert.ok(Number(meta.exposedWidth)>2&&meta.exposedIssue===true,'the adjacent interior sample must belong to the exposed portion of the same issue cell');
          const {png,data,info}=await decodePng(b);
          const sx=info.width/Number(meta.vw),sy=info.height/Number(meta.vh);
          const brandBg=meta.brandBg as [number,number,number];
          const canvasBg=meta.canvasBg as [number,number,number];
          const expectedRing=meta.expectedRing as [number,number,number];
          const thBgPx=[Math.floor(Number(hit.x)*sx),Math.floor(Number(hit.y)*sy)] as const;
          const tdBgPx=[Math.floor(Number(meta.exposedX)*sx),Math.floor(Number(hit.y)*sy)] as const;
          const thLeftEdge=[Math.floor((Number(thRect.left)+0.5)*sx),Math.floor((Number(thRect.top)+Number(thRect.height)/2)*sy)] as const;
          const thHold=readPixel(data,info,thBgPx[0],thBgPx[1]);
          const tdHold=readPixel(data,info,tdBgPx[0],tdBgPx[1]);
          const ringHold=readPixel(data,info,thLeftEdge[0],thLeftEdge[1]);
          diag.sample(png,[{label:'fixed header fill',x:thBgPx[0],y:thBgPx[1],rgb:thHold},{label:'issue cell fill',x:tdBgPx[0],y:tdBgPx[1],rgb:tdHold},{label:'fixed header ring',x:thLeftEdge[0],y:thLeftEdge[1],rgb:ringHold}]);
          assert.equal(meta.coversScrolledCell,true,'sticky header must cover the underlying issue cell; its transparent full-row link may receive pointer hits');
          assert.ok(rgbDistance(thHold,brandBg)<=10,`sticky th interior ${thHold} must show --brand-subtle ${brandBg}`);
          assert.ok(rgbDistance(tdHold,brandBg)<=10,`adjacent td interior ${tdHold} must show --brand-subtle ${brandBg}`);
          assert.ok(rgbDistance(ringHold,expectedRing)<=12,`sticky th left edge ${ringHold} must show --highlight-ring-brand ${expectedRing}`);

          diag.focus(rowSel,'sticky row midpoint');
          const fade=await b.evaluate(`(async()=>{
            const row=${query(rowSel)},th=row.querySelector('th');
            for(const a of row.getAnimations({subtree:true})){
              if(a.effect.pseudoElement==='::after')a.currentTime=4200;
            }
            await ${frames};
            return [row,th].map(n=>Number(getComputedStyle(n,'::after').opacity));
          })()`);
          diag.record({meta,wide,resized,fade});
          const middle=await decodePng(b);
          const midpoint=(held:readonly [number,number,number]):[number,number,number]=>[
            (held[0]+canvasBg[0])/2,(held[1]+canvasBg[1])/2,(held[2]+canvasBg[2])/2,
          ];
          const midSamples=[
            {label:'sticky fill',px:thBgPx,held:brandBg},
            {label:'row fill',px:tdBgPx,held:brandBg},
            {label:'sticky left ring',px:thLeftEdge,held:expectedRing},
            {label:'row top ring',px:[tdBgPx[0],Math.floor((Number(thRect.top)+0.5)*sy)] as const,held:expectedRing},
          ].map(({label,px:[x,y],held})=>({label,x,y,rgb:readPixel(middle.data,middle.info,x,y),expected:midpoint(held)}));
          diag.sample(middle.png,midSamples);
          diag.record({midSamples});
          assert.deepEqual(fade,[0.5,0.5],'both overlays must be half faded at the midpoint after resizing');
          for(const p of midSamples)assert.ok(rgbDistance(p.rgb,p.expected)<=3,`${p.label} midpoint RGB ${p.rgb} must match half opacity over canvas ${p.expected}`);

          await b.evaluate(`(()=>{const row=${query(rowSel)};for(const a of row?.getAnimations({subtree:true})??[])a.finish();})()`);
          await b.command('Animation.setPlaybackRate',{playbackRate:1});
          await waitForAnimationsSettled(b,rowSel);
          const settledPng=await decodePng(b);
          const thSettled=readPixel(settledPng.data,settledPng.info,thBgPx[0],thBgPx[1]);
          const tdSettled=readPixel(settledPng.data,settledPng.info,tdBgPx[0],tdBgPx[1]);
          diag.sample(settledPng.png,[{label:'settled fixed header',x:thBgPx[0],y:thBgPx[1],rgb:thSettled},{label:'settled issue cell',x:tdBgPx[0],y:tdBgPx[1],rgb:tdSettled}]);
          assert.ok(rgbDistance(thSettled,canvasBg)<=10,`sticky th after fade ${thSettled} must return to --bg-canvas ${canvasBg}`);
          assert.ok(rgbDistance(tdSettled,canvasBg)<=10,`adjacent td after fade ${tdSettled} must return to --bg-canvas ${canvasBg}`);
          receipts.narrowStickyList={wrapCheck,wide,resized,scrollLeft:meta.scrollLeft,overlap:meta.overlapWidth,exposed:meta.exposedWidth,thBgPx,tdBgPx,thLeftEdge,thHold,tdHold,ringHold,midSamples,thSettled,tdSettled};
        }catch(error){await diag.save(error);throw error;}finally{
          await b.command('Animation.setPlaybackRate',{playbackRate:1}).catch(()=>{});
        }
      }catch(error){await diag.save(error);throw error;}finally{
        await b.command('Emulation.setDeviceMetricsOverride',{width:1440,height:1600,deviceScaleFactor:1,mobile:false});
      }
    },'narrow-sticky');

    await check('39B A4 intake column 4-edge pixel contrast during highlight',async diag=>{
      diag.focus('.board-column.pending','intake setup');
      await navigate(appPath+'?range=all&motion=slow');
      await expandBoardGroup(b,'待判断');
      await b.evaluate("window.scrollTo({top:0,behavior:'instant'})");
      await waitForAnimationsSettled(b);

      const intake4=await seedWeb01NoConversationIntake({pool:f.pool,text:'诊室叫号屏无信号（合成）',location:'门诊二楼分诊台（合成）',serviceCode:null});
      const selector=pending(intakeCard(intake4.intakeId));
      diag.focus(selector,'four intake edges');
      await b.command('Animation.enable');
      await b.command('Animation.setPlaybackRate',{playbackRate:0});
      try{
        await b.evaluate(refreshBoard);
        await b.waitFor(`Boolean(${query(selector)}?.dataset.highlightTone==='intake')`);
        await holdVisibleOverlay(b,selector,1200);
        const meta=object(await b.evaluate(`(()=>{
          const node=${query(selector)};
          const r=node.getBoundingClientRect();
          const probe=document.createElement('i');
          probe.style.backgroundColor='var(--lane-intake)';
          document.body.append(probe);
          const lane=getComputedStyle(probe).backgroundColor.match(/\\d+/g).slice(0,3).map(Number);
          probe.style.backgroundColor='var(--stage-intake-bg)';
          const bg=getComputedStyle(probe).backgroundColor.match(/\\d+/g).slice(0,3).map(Number);
          probe.style.color='var(--highlight-ring-intake)';
          const ringParts=getComputedStyle(probe).color.match(/[\\d.]+/g).map(Number);
          probe.remove();
          const a=ringParts[3]??1;
          const expectedRing=[
            Math.round(ringParts[0]*a+bg[0]*(1-a)),
            Math.round(ringParts[1]*a+bg[1]*(1-a)),
            Math.round(ringParts[2]*a+bg[2]*(1-a)),
          ];
          return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,vw:innerWidth,vh:innerHeight,lane,expectedRing,ring:node.dataset.ring??null,afterOpacity:Number(getComputedStyle(node,'::after').opacity)};
        })()`));
        diag.record({meta});
        const lane=meta.lane as [number,number,number];
        const expectedRing=meta.expectedRing as [number,number,number];
        const {png,data,info}=await decodePng(b);
        const sx=info.width/Number(meta.vw),sy=info.height/Number(meta.vh);
        const left=Number(meta.left),top=Number(meta.top),right=Number(meta.right),bottom=Number(meta.bottom);
        const midX=(left+right)/2,midY=(top+bottom)/2;
        const points:[string,number,number][]=[
          ['top',Math.floor(midX*sx),Math.floor((top+0.5)*sy)],
          ['bottom',Math.floor(midX*sx),Math.floor((bottom-0.5)*sy)],
          ['left',Math.floor((left+0.5)*sx),Math.floor(midY*sy)],
          ['right',Math.floor((right-0.5)*sx),Math.floor(midY*sy)],
        ];
        const sampled:Record<string,unknown>={};
        const samples=points.map(([label,x,y])=>({label,x,y,rgb:readPixel(data,info,x,y)}));
        diag.sample(png,samples);
        assert.equal(meta.afterOpacity,1,'all four intake samples must be taken during the full-opacity hold');
        const owners=await cardOwnersAtPixels(b,samples,info);
        diag.record({owners});
        assert.deepEqual(owners,points.map(()=>intake4.intakeId),'all four device pixel centres must belong to the new H5 intake');
        assert.equal(meta.ring,null,'ordinary new intake fixture must have no competing status outline');
        for(const {label:edge,rgb} of samples){
          const diffVsRing=rgbDistance(rgb,expectedRing);
          const diffVsLane=rgbDistance(rgb,lane);
          sampled[edge]={rgb,diffVsRing,diffVsLane};
          assert.ok(diffVsRing<=10,`${edge} edge rgb(${rgb.join(',')}) must match highlight ring rgb(${expectedRing.join(',')})`);
          assert.ok(diffVsLane>=80,`${edge} edge rgb(${rgb.join(',')}) must visibly contrast against --lane-intake rgb(${lane.join(',')})`);
        }
        receipts.edgeContrast={lane,expectedRing,sampled};
      }catch(error){await diag.save(error);throw error;}finally{
        await b.evaluate(`(()=>{const node=${query(selector)};for(const a of node?.getAnimations({subtree:true})??[])a.finish();})()`);
        await b.command('Animation.setPlaybackRate',{playbackRate:1});
        await waitForAnimationsSettled(b);
      }
    },'a4-intake');

    await check('39B A3 conflict: same-timebase <=100ms select, dismissed and presence hold visuals',async diag=>{
      diag.focus('.board','selection setup');
      await navigate(appPath+'?range=all');
      await sortPendingNewest(b);
      await expandBoardGroup(b,'待判断');
      await expandBoardGroup(b,'待接单');
      await expandRemainder(b,'active');
      await expandBoardGroup(b,'已关闭');
      await b.evaluate("window.scrollTo({top:0,behavior:'instant'})");
      await waitForAnimationsSettled(b);

      const palette=object(await b.evaluate(`(()=>{
        const probe=document.createElement('i');
        document.body.append(probe);
        const readRgb=(prop,val)=>{probe.style[prop]=val;return getComputedStyle(probe)[prop==='color'?'color':'backgroundColor'].match(/[\\d.]+/g).map(Number);};
        const selectedBg=readRgb('backgroundColor','var(--bg-selected)').slice(0,3);
        const brandRgb=readRgb('color','var(--brand)').slice(0,3);
        const intakeBg=readRgb('backgroundColor','var(--stage-intake-bg)').slice(0,3);
        const canvasBg=readRgb('backgroundColor','var(--bg-canvas)').slice(0,3);
        const subtleBg=readRgb('backgroundColor','var(--bg-subtle)').slice(0,3);
        const doneBg=readRgb('backgroundColor','var(--stage-done-bg)').slice(0,3);
        const ringDone=readRgb('color','var(--highlight-ring-done)');
        const rdA=ringDone[3]??1;
        const doneRingOverSubtle=[
          Math.round(ringDone[0]*rdA+subtleBg[0]*(1-rdA)),
          Math.round(ringDone[1]*rdA+subtleBg[1]*(1-rdA)),
          Math.round(ringDone[2]*rdA+subtleBg[2]*(1-rdA)),
        ];
        probe.style.outline='2px solid var(--brand)';
        probe.style.boxShadow='var(--shadow-dismissed)';
        const s=getComputedStyle(probe);
        const outlineColor=s.outlineColor,outlineWidth=s.outlineWidth,dismissedShadow=s.boxShadow;
        probe.remove();
        return {selectedBg,brandRgb,intakeBg,canvasBg,subtleBg,doneBg,doneRingOverSubtle,outlineColor,outlineWidth,dismissedShadow};
      })()`));

      // (a) Click to select within 100ms of highlight start using same in-page performance.now() timebase.
      const conflictIntake=await seedWeb01NoConversationIntake({pool:f.pool,text:'急诊分诊叫号异常（合成）',location:'急诊分诊台（合成）',serviceCode:null});
      const selCard=pending(intakeCard(conflictIntake.intakeId));
      diag.focus(selCard,'selection click');
      await b.evaluate(`(()=>{
        const orig=Element.prototype.animate;
        window.__card39bSelectWatch={startedAt:null,clickedAt:null,toneAtClick:null,afterActiveAtClick:false,restored:false};
        Element.prototype.animate=function(keyframes,options){
          const anim=orig.call(this,keyframes,options);
          const pseudo=options&&typeof options==='object'?options.pseudoElement:undefined;
          if(pseudo==='::after'&&this.dataset?.kind==='intake'&&this.dataset?.itemId===${JSON.stringify(conflictIntake.intakeId)}){
            const w=window.__card39bSelectWatch;
            w.startedAt=performance.now();
            // Hold this effect while the real drawer and its backdrop finish entering.
            anim.pause();anim.currentTime=100;
            Element.prototype.animate=orig;
            w.restored=true;
            const link=this.querySelector('.card-open');
            w.toneAtClick=this.dataset.highlightTone??null;
            w.afterActiveAtClick=getComputedStyle(this,'::after').opacity==='1';
            link.addEventListener('click',()=>{w.clickedAt=performance.now();},{capture:true,once:true});
            link.click();
          }
          return anim;
        };
      })()`);
      await b.evaluate(refreshBoard);
      await b.waitFor(`${query(selCard)}?.classList.contains('is-selected')`);
      const watch=object(await b.evaluate('window.__card39bSelectWatch'));
      assert.equal(watch.restored,true,'select watcher must restore the native animate method');
      assert.equal(watch.toneAtClick,'intake','click must land on the intake tone');
      assert.equal(watch.afterActiveAtClick,true,'overlay must still be fully opaque when clicked');
      assert.equal(typeof watch.clickedAt,'number','the target must receive a real click timestamp');
      const clickDelta=Number(watch.clickedAt)-Number(watch.startedAt);
      assert.ok(clickDelta>=0&&clickDelta<=100,`selection click delta ${clickDelta}ms from highlight onset must be <=100ms`);

      await b.command('Animation.enable');
      let duringSelect:Record<string,unknown>={};
      try{
        await b.waitFor("Boolean(document.querySelector('.ds-drawer-backdrop')&&document.querySelector('.detail-dialog'))");
        await waitForAnimationsSettled(b,'.ds-drawer-backdrop');
        await b.evaluate(`(()=>{
          const node=${query(selCard)};
          node.scrollIntoView({block:'center',behavior:'instant'});
        })()`);
        await waitForAnimationsSettled(b,selCard);
        duringSelect=object(await b.evaluate(`(()=>{
          const node=${query(selCard)},r=node.getBoundingClientRect();
          const backdrop=getComputedStyle(document.querySelector('.ds-drawer-backdrop'));
          const panel=document.querySelector('.detail-dialog').getBoundingClientRect();
          return {
            tone:node.dataset.highlightTone??null,
            selected:node.classList.contains('is-selected'),
            afterOpacity:Number(getComputedStyle(node,'::after').opacity),
            bg:getComputedStyle(node).backgroundColor,
            backdrop:backdrop.backgroundColor.match(/[0-9.]+/g).map(Number),
            backdropOpacity:Number(backdrop.opacity),panelLeft:panel.left,
            inlineBg:node.style.backgroundColor,
            rect:{left:r.left,top:r.top,right:r.right,vw:innerWidth,vh:innerHeight},
          };
        })()`));
        diag.record({duringSelect,palette,watch});
        assert.equal(duringSelect.selected,true,'clicked intake must be selected during hold');
        assert.equal(duringSelect.tone,'intake','selection must retain the running intake highlight');
        assert.equal(duringSelect.afterOpacity,1,'selected overlay must remain fully opaque at the sampled time');
        assert.equal(duringSelect.inlineBg,'','selection must leave the inline background empty');
        const rect=object(duringSelect.rect);
        assert.equal(duringSelect.bg,'rgb('+(palette.selectedBg as number[]).join(', ')+')','selected host must use the selected background during hold');
        assert.equal(duringSelect.backdropOpacity,1,'the drawer backdrop must be fully settled before taking pixels');
        assert.ok((Number(rect.left)+Number(rect.right))/2<Number(duringSelect.panelLeft),'selected-card samples must be outside the drawer panel');
        const veil=duringSelect.backdrop as [number,number,number,number];
        assert.equal(veil.length,4,'the composited backdrop colour must include alpha');
        const throughBackdrop=(rgb:unknown)=>(rgb as number[]).map((ch,i)=>Math.round(ch*(1-veil[3])+Number(veil[i])*veil[3])) as [number,number,number];
        const png=await decodePng(b);
        const {fillRgb,edgeRgb}=sampleCardPixels(png,rect,1,diag);
        assert.ok(rgbDistance(fillRgb,throughBackdrop(palette.selectedBg))<=10,`selected fill ${fillRgb} must match --bg-selected through the backdrop`);
        assert.ok(rgbDistance(fillRgb,throughBackdrop(palette.intakeBg))>=12,'selected fill must remain distinguishable from intake');
        assert.ok(rgbDistance(edgeRgb,throughBackdrop(palette.brandRgb))<=12,`selected ring ${edgeRgb} must stay --brand through the backdrop`);
      }catch(error){await diag.save(error);throw error;}finally{
        await b.evaluate(`(()=>{const node=${query(selCard)};for(const a of node?.getAnimations({subtree:true})??[])a.finish();})()`);
        await waitForAnimationsSettled(b,selCard);
      }

      diag.focus(selCard,'selection after fade');
      const afterSelect=object(await b.evaluate(`(()=>{
        const node=${query(selCard)},s=getComputedStyle(node);
        return {
          tone:node.dataset.highlightTone??null,
          selected:node.classList.contains('is-selected'),
          bg:s.backgroundColor,
          outlineColor:s.outlineColor,
          outlineWidth:s.outlineWidth,
          inlineBg:node.style.backgroundColor,
        };
      })()`));
      assert.equal(afterSelect.tone,null,'selection highlight attribute must clear after the fade');
      assert.equal(afterSelect.selected,true,'card must remain selected after fade');
      assert.equal(afterSelect.bg,'rgb('+(palette.selectedBg as number[]).join(', ')+')','selected background must survive highlight cleanup');
      assert.equal(afterSelect.outlineColor,palette.outlineColor,'selected outline colour must survive cleanup');
      assert.equal(afterSelect.outlineWidth,palette.outlineWidth,'selected outline width must survive cleanup');
      assert.equal(afterSelect.inlineBg,'','selection cleanup must leave the inline background empty');

      await cdpEscape(b);
      await b.waitFor("!document.querySelector('.ds-drawer-content')");
      await waitForAnimationsSettled(b);

      // (b) Dismissed card keeps closed background during hold and after fade.
      const victim=f.tickets[5]?.ticket;
      assert.ok(victim,'dismissal fixture must provide an active ticket');
      const dismissedRow=(await f.pool.query(
        "UPDATE pilot_ticket.ticket SET status='DISMISSED',title='已关闭高亮样式冲突测试（合成）',version=version+1,updated_at=platform.local_now(),terminal_at=platform.local_now(),terminal_epoch_ms=NULL WHERE id=$1::uuid RETURNING *",
        [victim.id],
      )).rows[0] as Ticket;
      const dismissEvent=await appendTicketEvent({
        transaction:f.pool,ticket:dismissedRow,eventType:'ticket.dismissed',
        actor:{type:'SYSTEM',id:null},oldStatus:victim.status,internalNote:null,externalNote:null,traceId:'card39b-dismissed-conflict',
      });
      await insertClosureRecord({
        transaction:f.pool,subjectType:'TICKET',subjectId:victim.id,
        beforeStatus:victim.status,beforeAssignee:victim.assignee_id??null,beforeTeam:victim.resolver_team_id??'PILOT_IT',
        beforeVersion:victim.version,beforeSnapshot:{},actor:null,source:'SYSTEM',
        input:normalizeClosureInput({reason_code:'OTHER',note:'卡 39B 已关闭高亮冲突验收（合成）'}),ticketEventId:dismissEvent.event_id,
      });

      const closedCard=handled(ticketCard(victim.id));
      diag.focus(closedCard,'dismissed hold');
      await b.command('Animation.setPlaybackRate',{playbackRate:0});
      let duringClosed:Record<string,unknown>={};
      try{
        await b.evaluate(refreshBoard);
        await finishFrozenMove(b,closedCard,'done');
        await holdVisibleOverlay(b,closedCard,100,true);
        duringClosed=object(await b.evaluate(`(()=>{
          const node=${query(closedCard)},r=node.getBoundingClientRect();
          return {
            inlineBg:node.style.backgroundColor,
            closureKind:node.dataset.closureKind,
            afterOpacity:Number(getComputedStyle(node,'::after').opacity),
            rect:{left:r.left,top:r.top,right:r.right,vw:innerWidth,vh:innerHeight},
          };
        })()`));
        diag.record({duringClosed,palette});
        assert.equal(duringClosed.closureKind,'DISMISSED','closed sample must be an actually dismissed ticket');
        assert.equal(duringClosed.afterOpacity,1,'dismissed card must be sampled during full hold');
        assert.equal(duringClosed.inlineBg,'','dismissed state must not have an inline background during hold');
        const rect=object(duringClosed.rect);
        const png=await decodePng(b);
        const {fillRgb,edgeRgb}=sampleCardPixels(png,rect,0.5,diag);
        assert.ok(rgbDistance(fillRgb,palette.subtleBg as [number,number,number])<=10,`dismissed fill ${fillRgb} must stay --bg-subtle during hold`);
        assert.ok(rgbDistance(fillRgb,palette.doneBg as [number,number,number])>=10,'dismissed fill must not be covered by --stage-done-bg');
        assert.ok(rgbDistance(edgeRgb,palette.doneRingOverSubtle as [number,number,number])<=12,`dismissed edge ${edgeRgb} must still receive highlight done ring`);
      }catch(error){await diag.save(error);throw error;}finally{
        await b.evaluate(`(()=>{const node=${query(closedCard)};for(const a of node?.getAnimations({subtree:true})??[])a.finish();})()`);
        await b.command('Animation.setPlaybackRate',{playbackRate:1});
        await waitForAnimationsSettled(b,closedCard);
      }

      diag.focus(closedCard,'dismissed after fade');
      const afterClosed=object(await b.evaluate(`(()=>{
        const node=${query(closedCard)},s=getComputedStyle(node);
        return {tone:node.dataset.highlightTone??null,bg:s.backgroundColor,boxShadow:s.boxShadow,inlineBg:node.style.backgroundColor};
      })()`));
      assert.equal(afterClosed.tone,null,'dismissed tone attribute must clear after the fade');
      assert.equal(afterClosed.bg,'rgb('+(palette.subtleBg as number[]).join(', ')+')','dismissed background must survive highlight cleanup');
      assert.equal(afterClosed.boxShadow,palette.dismissedShadow,'dismissed shadow must survive highlight cleanup');
      assert.equal(afterClosed.inlineBg,'','dismissed cleanup must leave the inline background empty');

      await assertPresenceHighlight(palette,diag);
      diag.focus('.board','return from live presence fixture');
      await b.command('Page.bringToFront');

      receipts.conflicts={clickDelta,duringSelect,afterSelect,duringClosed,afterClosed};
    },'a3-conflict');

    await check('39B A5 unclassified tile and unassigned placeholder across board, list and hover card (DPR + AX tree)',async diag=>{
      diag.focus('.board','placeholder setup');
      const targetId=await seedMotionTicket(f.pool,'急诊诊室读卡器未分类');
      const targetNoRow=(await f.pool.query('SELECT ticket_no FROM pilot_ticket.ticket WHERE id=$1::uuid',[targetId])).rows[0] as {ticket_no:string};
      const dupTicket=f.tickets[6]?.ticket;
      assert.ok(dupTicket&&targetNoRow?.ticket_no,'duplicate closure fixture requires a ticket and original number');
      const dupRow=(await f.pool.query(
        "UPDATE pilot_ticket.ticket SET status='DISMISSED',title='重复关联未分类原单（合成）',version=version+1,updated_at=platform.local_now(),terminal_at=platform.local_now(),terminal_epoch_ms=NULL WHERE id=$1::uuid RETURNING *",
        [dupTicket.id],
      )).rows[0] as Ticket;
      const dupEvent=await appendTicketEvent({
        transaction:f.pool,ticket:dupRow,eventType:'ticket.dismissed',
        actor:{type:'SYSTEM',id:null},oldStatus:dupTicket.status,internalNote:null,externalNote:null,traceId:'card39b-hover-dup',
      });
      await insertClosureRecord({
        transaction:f.pool,subjectType:'TICKET',subjectId:dupTicket.id,
        beforeStatus:dupTicket.status,beforeAssignee:dupTicket.assignee_id??null,beforeTeam:dupTicket.resolver_team_id??'PILOT_IT',
        beforeVersion:dupTicket.version,beforeSnapshot:{},actor:null,source:'SYSTEM',
        input:normalizeClosureInput({reason_code:'DUPLICATE',duplicate_of_ref:targetNoRow.ticket_no}),ticketEventId:dupEvent.event_id,
      });

      await navigate(appPath+'?range=all');
      await expandBoardGroup(b,'待接单');
      await expandRemainder(b,'pending');
      await expandBoardGroup(b,'已关闭');

      const boardSel=pending(ticketCard(targetId));
      diag.focus(boardSel,'board placeholders');
      await b.evaluate(`${query(boardSel)}.scrollIntoView({block:'center',behavior:'instant'})`);
      await move(b,{x:1,y:1});
      await waitForAnimationsSettled(b);

      const expectedTokens=object(await b.evaluate(`(()=>{
        const p=document.createElement('i');
        p.style.backgroundColor='var(--bg-canvas)';
        p.style.color='var(--text-secondary)';
        p.style.border='1px dashed var(--border-default)';
        p.style.outlineColor='var(--text-tertiary)';
        document.body.append(p);
        const s=getComputedStyle(p);
        const p15=document.createElement('i');
        p15.style.border='1.5px dashed var(--text-tertiary)';
        document.body.append(p15);
        const s15=getComputedStyle(p15);
        const out={tileBg:s.backgroundColor,tileFg:s.color,tileBorderColor:s.borderTopColor,tileBorderStyle:s.borderTopStyle,tileBorderWidth:s.borderTopWidth,avatarBorderColor:s.outlineColor,avatarBorderWidth:s15.borderTopWidth};
        p.remove();p15.remove();
        return out;
      })()`));

      const assertPlaceholders=async(scopeSelector:string,expectedTileSize:number)=>{
        diag.focus(scopeSelector,'placeholder style '+expectedTileSize+'px tile');
        const info=object(await b.evaluate(`(()=>{
          const root=${query(scopeSelector)};
          const tile=root.querySelector('.ds-ticket-category[data-category="unclassified"]');
          const avatar=root.querySelector('.ds-avatar.unassigned');
          if(!tile||!avatar)throw Error('missing placeholder in '+${JSON.stringify(scopeSelector)});
          const ts=getComputedStyle(tile),tr=tile.getBoundingClientRect();
          const as=getComputedStyle(avatar),ar=avatar.getBoundingClientRect();
          const declaredBorders=[];
          const readRules=rules=>{for(const rule of rules){
            if(rule.selectorText?.includes('.ds-avatar')&&avatar.matches(rule.selectorText)){
              const border=rule.style.getPropertyValue('border');
              if(border)declaredBorders.push(border.trim());
            }
            if(rule.cssRules)readRules(rule.cssRules);
          }};
          for(const sheet of document.styleSheets)readRules(sheet.cssRules);
          return {
            tile:{w:Math.round(tr.width),h:Math.round(tr.height),bg:ts.backgroundColor,fg:ts.color,bw:ts.borderTopWidth,bs:ts.borderTopStyle,bc:ts.borderTopColor},
            avatar:{w:Math.round(ar.width),h:Math.round(ar.height),bg:as.backgroundColor,bw:as.borderTopWidth,bs:as.borderTopStyle,bc:as.borderTopColor,text:avatar.textContent,children:avatar.children.length,title:avatar.getAttribute('title')},
            declaredBorders,
          };
        })()`));
        const tile=object(info.tile),avatar=object(info.avatar);
        diag.record({tile,avatar,expectedTokens,declaredBorders:info.declaredBorders});
        assert.deepEqual({w:tile.w,h:tile.h,bg:tile.bg,fg:tile.fg,bw:tile.bw,bs:tile.bs,bc:tile.bc},{
          w:expectedTileSize,h:expectedTileSize,bg:expectedTokens.tileBg,fg:expectedTokens.tileFg,
          bw:expectedTokens.tileBorderWidth,bs:expectedTokens.tileBorderStyle,bc:expectedTokens.tileBorderColor,
        },'unclassified tile must retain its dimensions, colours and dashed outline');
        assert.deepEqual({w:avatar.w,h:avatar.h,bg:avatar.bg,bw:avatar.bw,bs:avatar.bs,bc:avatar.bc,text:avatar.text,children:avatar.children,title:avatar.title},{
          w:20,h:20,bg:'rgba(0, 0, 0, 0)',bw:expectedTokens.avatarBorderWidth,bs:'dashed',bc:expectedTokens.avatarBorderColor,
          text:'',children:0,title:'未分配',
        },'unassigned avatar must stay 20px, hollow, dashed and named by tooltip');
        assert.ok(Array.isArray(info.declaredBorders)&&info.declaredBorders.includes('1.5px dashed var(--text-tertiary)'),
          'a matching avatar rule must declare the native 1.5px dashed tertiary border');
      };

      await assertPlaceholders(boardSel,28);
      // Exercise native border layout at 2x from the first paint. Keep the DPR 1 board
      // and its later AX/crop checks in their original browser.
      const avatarSel=boardSel+' .ds-avatar.unassigned';
      diag.focus(avatarSel,'opening DPR 2 observer');
      const hidpi=await launchSystemBrowser({url:origin+appPath+'?range=all',width:1440,height:1600,nativeDpr2:true,cookies:[{...actorCookie,url:origin}]});
      assert.ok(hidpi,'A5 requires a native DPR 2 observer');
      let highDpiFailure:unknown;
      try{
        diag.focus(avatarSel,'DPR 2 dashed circle',hidpi);
        await hidpi.command('Page.bringToFront');
        await hidpi.waitFor(boardReady);
        await assertFontsLoaded(hidpi);
        await expandBoardGroup(hidpi,'待接单');
        await expandRemainder(hidpi,'pending');
        await hidpi.waitFor(`Boolean(${query(avatarSel)}?.checkVisibility())`);
        await hidpi.evaluate(`${query(avatarSel)}.scrollIntoView({block:'center',behavior:'instant'})`);
        await move(hidpi,{x:1,y:1});
        await waitForAnimationsSettled(hidpi);
        const evidence=object(await hidpi.evaluate(`(()=>{
          const av=${query(avatarSel)},r=av.getBoundingClientRect(),p=document.createElement('i');
          p.id='card39b-thin-control';
          Object.assign(p.style,{position:'fixed',left:(r.left-32)+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px',
            boxSizing:'border-box',border:'1px dashed var(--text-tertiary)',borderRadius:'var(--radius-full)',
            background:'var(--bg-canvas)',zIndex:'var(--z-tooltip)',pointerEvents:'none'});
          document.body.append(p);
          const style=getComputedStyle(av);
          return {dpr:devicePixelRatio,vw:innerWidth,vh:innerHeight,avatar:r.toJSON(),control:p.getBoundingClientRect().toJSON(),
            stroke:style.borderTopColor.match(/[0-9.]+/g).slice(0,3).map(Number),colour:style.borderTopColor,dash:style.borderTopStyle,probeWidth:getComputedStyle(p).borderTopWidth};
        })()`));
        diag.record({evidence});
        await hidpi.evaluate(frames);
        const frame=await decodePng(hidpi),scale=frame.info.width/Number(evidence.vw);
        assert.equal(evidence.dpr,2,'A5 must compare the actual high-DPI avatar at DPR 2');
        assert.equal(scale,2,'A5 screenshot must contain two horizontal device pixels per CSS pixel');
        assert.equal(frame.info.height/Number(evidence.vh),2,'A5 screenshot must contain two vertical device pixels per CSS pixel');
        assert.equal(evidence.dash,'dashed','the painted high-DPI stroke must remain dashed');
        assert.equal(evidence.colour,expectedTokens.avatarBorderColor,'the native high-DPI border must resolve to --text-tertiary');
        assert.equal(evidence.probeWidth,'1px','the comparison circle must have an independent 1px border');
        const fg=evidence.stroke as number[];
        const thick=innerBandInk(frame,object(evidence.avatar),scale,fg,'avatar');
        const thin=innerBandInk(frame,object(evidence.control),scale,fg,'1px control');
        diag.record({avatarInk:thick.mean,controlInk:thin.mean,avatarGapRuns:thick.gaps,controlGapRuns:thin.gaps,bandCssPx:[1,1.5]});
        diag.sample(frame.png,[...thick.points,...thin.points]);
        assert.deepEqual(thick.bg,thin.bg,'both circles must have the same hollow background');
        assert.ok(thick.mean>=thin.mean+0.15,`DPR 2 avatar must visibly paint the third device pixel of a 1.5px dash (inner band ${thick.mean}, 1px control ${thin.mean})`);
        assert.ok(thick.gaps>=3,`DPR 2 avatar must show repeated ink segments separated by clear pixel gaps (observed ${thick.gaps})`);
        receipts.unassignedBorder={dpr:evidence.dpr,colour:evidence.colour,avatarInk:thick.mean,controlInk:thin.mean,avatarGapRuns:thick.gaps};
      }catch(error){await diag.save(error);highDpiFailure=error;}finally{
        await closeBrowserTestResources([async()=>{
          await hidpi.close();
          assert.deepEqual(hidpi.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0},'A5 native DPR 2 observer must release its owned resources');
        },()=>b.command('Page.bringToFront')],highDpiFailure);
      }
      diag.focus(boardSel,'board placeholder AX and crops');

      // Verify board AX tree exposes img "未分配" once.
      const boardAx=await inspectAxSubtree(b,boardSel+' .ds-ticket-owner .ds-avatar.unassigned');
      assert.equal(boardAx.root?.ignored,false,'icon-only board status must be exposed to assistive technology');
      assert.ok(boardAx.root?.role==='image'||boardAx.root?.role==='img',`board avatar AX role=${boardAx.root?.role}`);
      assert.equal(boardAx.root?.name,'未分配','board status image must be named 未分配');

      const boardTilePng=await cropElement(b,boardSel+' .ds-ticket-category[data-category="unclassified"]',10);
      const boardAvatarPng=await cropElement(b,boardSel+' .ds-ticket-owner',10);

      // Hover the duplicate closure original link to inspect the TicketHoverCard for targetId.
      const dupOriginalSel=`${handled(ticketCard(dupTicket.id))} .ds-closure-original`;
      diag.focus(dupOriginalSel,'opening duplicate original hover card');
      await hover(b,dupOriginalSel);
      const hoverSel='.ds-hover-card[data-hover-card="ticket"][data-hover-card-state="ready"]';
      await b.waitFor(`Boolean(${query(hoverSel)})`);
      await waitForAnimationsSettled(b,hoverSel);
      await assertPlaceholders(hoverSel,28);
      const hoverAvatarAx=await inspectAxSubtree(b,hoverSel+' .ds-ticket-hover-assignee .ds-avatar.unassigned');
      assert.equal(hoverAvatarAx.root?.ignored,true,'decorative hover avatar must be hidden from AT');
      const hoverWrapAx=await inspectAxSubtree(b,hoverSel+' .ds-ticket-hover-assignee');
      assert.equal(hoverWrapAx.nodes.filter(n=>!n.ignored&&n.name.includes('未分配')).length,0,'decorative hover avatar must add no duplicate status name');
      assert.equal(hoverWrapAx.nodes.filter(n=>!n.ignored&&n.role==='StaticText'&&n.name==='等待领取').length,1,'hover card must expose 等待领取 exactly once');
      const hoverTilePng=await cropElement(b,hoverSel+' .ds-ticket-hover-head',8);
      const hoverAvatarPng=await cropElement(b,hoverSel+' .ds-ticket-hover-status-row',8);
      await move(b,{x:1,y:1});
      await cdpEscape(b);

      // Switch to List view and verify row placeholders & AX tree.
      diag.focus('.ds-work-table-wrap','list placeholder setup');
      await navigate(appPath+'?range=all&view=list');
      const listMore='#list-subgroup-ticket-more [data-action=expand-column][aria-expanded=false]';
      if(await b.evaluate(`Boolean(${query(listMore)})`)){
        await clickWorkbenchControl(b,listMore);
        await waitForAnimationsSettled(b);
      }
      const rowSel=ticketRow(targetId);
      await b.evaluate(`${query(rowSel)}.scrollIntoView({block:'center',behavior:'instant'})`);
      await move(b,{x:1,y:1});
      await waitForAnimationsSettled(b);
      await assertPlaceholders(rowSel,24);
      const listAvatarAx=await inspectAxSubtree(b,rowSel+' .ds-list-owner.is-unassigned .ds-avatar.unassigned');
      assert.equal(listAvatarAx.root?.ignored,true,'decorative list avatar must be hidden from AT');
      const listWrapAx=await inspectAxSubtree(b,rowSel+' .ds-list-owner.is-unassigned');
      assert.equal(listWrapAx.nodes.filter(n=>!n.ignored&&n.name.includes('未分配')).length,0,'decorative list avatar must add no duplicate status name');
      assert.equal(listWrapAx.nodes.filter(n=>!n.ignored&&n.role==='StaticText'&&n.name==='未领取').length,1,'list must expose 未领取 exactly once');
      const listTilePng=await cropElement(b,rowSel+' .ds-list-identity',8);
      const listAvatarPng=await cropElement(b,rowSel+' .ds-list-owner-cell',8);

      await writePlaceholderComposite(join(evidence,'unclassified-tile.png'),[
        {label:'board',buffer:boardTilePng},
        {label:'list',buffer:listTilePng},
        {label:'hover',buffer:hoverTilePng},
      ]);
      await writePlaceholderComposite(join(evidence,'unassigned-placeholder.png'),[
        {label:'board',buffer:boardAvatarPng},
        {label:'list',buffer:listAvatarPng},
        {label:'hover',buffer:hoverAvatarPng},
      ]);
      receipts.placeholders={board:true,list:true,hover:true,ax:{board:boardAx.root,list:listAvatarAx.root,hover:hoverAvatarAx.root}};
    },'a5-placeholder');

    await check('39B A6 reduced motion: no shift, no fade, overlay removed on time',async()=>{
      await b.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
      try{
        await navigate(appPath+'?range=all');
        await b.waitFor("matchMedia('(prefers-reduced-motion: reduce)').matches&&document.documentElement.hasAttribute('data-motion-reduced')");
        await expandBoardGroup(b,'待判断');
        await b.evaluate("window.scrollTo({top:0,behavior:'instant'})");
        await waitForAnimationsSettled(b);

        const reducedIntake=await seedWeb01NoConversationIntake({pool:f.pool,text:'减少动态效果新报修（合成）',location:'住院部三楼（合成）',serviceCode:null});
        const selector=pending(intakeCard(reducedIntake.intakeId));

        const result=object(await b.evaluate(`(async()=>{
          const styles=getComputedStyle(document.documentElement);
          const parseTime=name=>{const raw=styles.getPropertyValue(name).trim();return Number.parseFloat(raw)*(raw.endsWith('ms')?1:1000);};
          const expectedDuration=parseTime('--dur-highlight-hold')+parseTime('--dur-highlight');
          let start=null,end=null,animationCount=0,afterOpacity=null,inlineBg='',clearedAfterContent=null;
          const deadline=performance.now()+5000;
          ${refreshBoard};
          while(performance.now()<deadline){
            await new Promise(r=>requestAnimationFrame(r));
            const node=${query(selector)},now=performance.now();
            if(node){
              animationCount+=node.getAnimations({subtree:true}).length;
              if(node.dataset.highlightTone){
                start??=now;
                const opacity=getComputedStyle(node,'::after').opacity;
                afterOpacity=afterOpacity===null||afterOpacity==='1'?opacity:afterOpacity;
                inlineBg||=node.style.backgroundColor;
              }else if(start!==null){
                end=now;
                clearedAfterContent=getComputedStyle(node,'::after').content;
                break;
              }
            }
          }
          return {expectedDuration,elapsed:start!==null&&end!==null?end-start:null,animationCount,afterOpacity,inlineBg,clearedAfterContent};
        })()`));
        assert.equal(result.expectedDuration,1440,'reduced static hold plus fade interval must total 1440ms');
        assert.equal(result.animationCount,0,'reduced motion must start no shift or fade animations');
        assert.equal(result.afterOpacity,'1','the reduced overlay must remain fully opaque on every sampled frame');
        assert.equal(result.inlineBg,'','reduced motion must not change the inline background');
        assert.equal(result.clearedAfterContent,'none','static overlay content must be removed at timeout');
        assert.equal(typeof result.elapsed,'number','reduced highlight must have observable start and end times');
        assert.ok(Math.abs(Number(result.elapsed)-Number(result.expectedDuration))<=80,`reduced-motion hold ${result.elapsed}ms should match 1440ms`);
        await assertNoTransformAnimations(b,'.board');
        await waitForAnimationsSettled(b);
        receipts.reduced=result;
      }finally{
        await b.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
      }
    });

    assert.deepEqual(failedCases,[],'39B cannot issue a PASS receipt until every acceptance case passes');
    await writeFile(join(evidence,'card39b-receipt.json'),JSON.stringify({
      status:'PASS',
      os:{platform:platform(),release:release()},
      browser:await b.command('Browser.getVersion').catch(()=>null),
      receipts,
    },null,2)+'\n');
  }catch(error){
    failure=error;
    throw error;
  }finally{
    await closeBrowserTestResources([
      async()=>{
        await browser?.close();
        if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0},'observer must release all owned browser resources');
      },
      async()=>{await app?.close();},
      ()=>rm(cache,{recursive:true,force:true}),
      async()=>{if(!process.env.CARD39B_EVIDENCE_DIR)await rm(evidence,{recursive:true,force:true});},
    ],failure);
  }
},fixtureOptions));
