import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {platform,release,tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import {createServer} from 'vite';
import {createPilotAccessService} from '../app/server/src/p1-009-pilot-access-workbench.mjs';
import {waitForAnimationsSettled} from './helpers/browser-animations.mjs';
import {card,escape,exists,hover,move,navigate,observe,person,point,q,ticket,type Browser} from './helpers/card37c-hover-browser.mjs';
import {clickWorkbenchControl} from './helpers/heroui-workbench-controls.mjs';
import {boardReady,seedMotionTicket} from './helpers/motion-board-fixture.mjs';
import {createFilmstripCapture} from './helpers/motion-filmstrip.mjs';
import {closeBrowserTestResources,launchSystemBrowser} from './helpers/p2-006-browser-harness.mjs';
import {object} from './helpers/t42-board-browser-fixture.mjs';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import type {T11Fixture} from './helpers/t11-completion-fixture.mjs';

const root=process.env.TS_MIGRATION_TEST_SOURCE_ROOT??process.cwd();
const delay=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const away={x:2,y:2};

async function waitForChecks(b:Browser,step:string,checks:Record<string,string>,options?:Parameters<Browser['waitFor']>[1]){
  const entries=Object.entries(checks);
  const expression=entries.map(([,check])=>'('+check+')').join('&&');
  try{
    return await b.waitFor(expression,options);
  }catch(cause){
    // Evaluate each predicate separately so an absent element cannot hide the other results.
    const conditions=Object.fromEntries(await Promise.all(entries.map(async([name,check])=>[
      name,await b.evaluate(check).then(Boolean).catch((error:Error)=>error.message),
    ])));
    const state=await b.evaluate(`({
      path:location.pathname,visibility:document.visibilityState,tabFocused:document.hasFocus(),
      realtime:${q('.app')}?.dataset.realtimeStatus,sidebarCollapsed:!!${q('.app.sidebar-collapsed')},
      onlineCount:${q('.ds-online-count,.ds-online-none,.ds-online-badge')}?.textContent??null,
      activeElement:document.activeElement?.className,expanded:document.activeElement?.getAttribute('aria-expanded'),
      hoverCards:[...document.querySelectorAll('[data-hover-card]')].map(el=>[el.dataset.hoverCard,el.hasAttribute('data-exiting')]),
      boardPages:Object.keys(window.probe37?.pages??{}),columnCounts:[...document.querySelectorAll('.ds-stage-count,.ds-list-stage-count')].map(el=>el.textContent)
    })`).catch(()=>null);
    throw new Error(step+' failed: '+JSON.stringify({conditions,state}),{cause});
  }
}

async function beginPresence(f:T11Fixture,id:string,cookieIndex:number,mode:'VIEWING'|'EDITING'){
  const cookie=f.cookies[cookieIndex];
  assert.ok(cookie);
  const bootstrap=await fetch(f.origin+'/api/lifecycle/bootstrap',{headers:{cookie}});
  assert.equal(bootstrap.status,200);
  const {csrf_token}=object(await bootstrap.json());
  assert.ok(typeof csrf_token==='string');
  const controller=new AbortController(),browser_id=randomUUID();
  const renew=async()=>{
    const response=await fetch(f.origin+'/api/workbench/activity',{
      method:'POST',
      signal:controller.signal,
      headers:{cookie,origin:f.origin,'content-type':'application/json','x-csrf-token':csrf_token},
      body:JSON.stringify({schema_version:1,browser_id,target:{kind:'ticket',id},action:'RENEW',visible:true,active:true,mode,field:mode==='EDITING'?'internal-note':null}),
    });
    assert.equal(response.status,200,await response.text());
  };
  let drained:Promise<void>|undefined,failure:unknown;
  try{
    const stream=await fetch(f.origin+'/api/realtime/events?scope=workbench',{signal:controller.signal,headers:{cookie,accept:'text/event-stream'}});
    assert.equal(stream.status,200);
    assert.ok(stream.body);
    // An unread fetch response can be garbage-collected, removing this peer from the online roster.
    const reader=stream.body.getReader();
    drained=(async()=>{
      try{
        while(!(await reader.read()).done){/* consume peer SSE frames until teardown */}
        if(!controller.signal.aborted)throw Error('Presence peer '+cookieIndex+' SSE stream ended early');
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

test('39C C1 owner truncation and C2 follow-ups in Chrome',{timeout:220000},t=>withWeb01Fixture(async(f:T11Fixture)=>{
  const actor=f.browserCookies[0];
  assert.ok(actor);
  const access=createPilotAccessService({pool:f.pool});
  const owner2=await access.upsertPrincipal({wecomUserId:'card39c-owner-2',displayName:'林舟',roles:['HANDLER'],resolverTeamIds:['PILOT_IT']});
  const owner3=await access.upsertPrincipal({wecomUserId:'card39c-owner-3',displayName:'陈明远',roles:['HANDLER'],resolverTeamIds:['PILOT_IT']});
  const owner4=await access.upsertPrincipal({wecomUserId:'card39c-owner-4',displayName:'欧阳明远',roles:['HANDLER'],resolverTeamIds:['PILOT_IT']});
  const owner5=await access.upsertPrincipal({wecomUserId:'card39c-owner-5',displayName:'欧阳明远华',roles:['HANDLER'],resolverTeamIds:['PILOT_IT']});

  const ticket2=await seedMotionTicket(f.pool,'Card39C 二字处理人');
  const ticket3=await seedMotionTicket(f.pool,'Card39C 三字处理人');
  const ticket4=await seedMotionTicket(f.pool,'Card39C 四字处理人');
  const ticket5=await seedMotionTicket(f.pool,'Card39C 五字处理人');
  const ticketManyTags=await seedMotionTicket(f.pool,'Card39C 多标签挤压测试');
  const ticketManyTagsFollowUp=await seedMotionTicket(f.pool,'Card39C 多标签含跟进预约');
  const ticketSelf=await seedMotionTicket(f.pool,'Card39C 本人姓名隐藏');
  const nestedOwnerTicket=await seedMotionTicket(f.pool,'Card39C 嵌套悬停处理人');
  const presenceCrowd=f.tickets[6]?.ticket.id;
  const presenceTwo=f.tickets[5]?.ticket.id;
  const selfPrincipal=f.principals[0]?.id;
  const zhouPrincipal=f.principals[2]?.id;
  assert.ok(presenceCrowd&&presenceTwo&&selfPrincipal&&zhouPrincipal);

  for(const [ticketId,principalId,status,location] of [
    [ticket2,owner2.id,'IN_PROGRESS','门诊一楼（合成）'],
    [ticket3,owner3.id,'IN_PROGRESS','门诊二楼（合成）'],
    [ticket4,owner4.id,'IN_PROGRESS','门诊三楼（合成）'],
    [ticket5,owner5.id,'IN_PROGRESS','门诊四楼（合成）'],
    [ticketManyTags,owner4.id,'WAITING_VENDOR',null],
    [ticketManyTagsFollowUp,owner4.id,'WAITING_VENDOR',null],
    [ticketSelf,selfPrincipal,'IN_PROGRESS','门诊五楼（合成）'],
    [nestedOwnerTicket,zhouPrincipal,'IN_PROGRESS','门诊六楼（合成）'],
  ] as const){
    await f.pool.query(
      'UPDATE pilot_ticket.ticket SET status=$2,assignee_id=$3,reported_location_text=$4,updated_at=platform.local_now(),terminal_at=NULL,terminal_epoch_ms=NULL WHERE id=$1::uuid',
      [ticketId,status,principalId,location],
    );
  }

  // Project reporter_name (for the sr-only self-name rule) and multi-tag fields via the board/search HTTP response hook,
  // matching how the production board query projects contact_journey/web-report/review metadata without inventing SQL columns.
  const projectCard39c=(request:IncomingMessage,response:ServerResponse)=>{
    if(request.method!=='GET'||!/^\/api\/workbench\/(?:board|search)\?/u.test(request.url??''))return;
    const end=response.end;
    const wrappedEnd:ServerResponse['end']=(...args:unknown[]):ServerResponse=>{
      if(response.statusCode===200&&typeof args[0]==='string'){
        const page=JSON.parse(args[0]) as {items?:Record<string,unknown>[]};
        if(Array.isArray(page.items)){
          page.items=page.items.map(item=>{
            if(item.id===ticketSelf)return {...item,reporter_name:'林舟（合成）'};
            if(item.id===ticketManyTags){
              return {...item,web_report_urge:{active:true,count:2,last_urged_at:item.updated_at},review_reason:'人工复核材料（合成）'};
            }
            if(item.id===ticketManyTagsFollowUp){
              const dueAt='2026-11-25 14:00:00';
              return {
                ...item,
                web_report_urge:{active:true,count:2,last_urged_at:item.updated_at},
                review_reason:'人工复核材料（合成）',
                follow_up_schedule:{
                  schedule_version:'1',
                  due_at:dueAt,
                  due_epoch_ms:String(Date.parse(dueAt.replace(' ','T')+'+08:00')),
                  is_due:false,
                },
              };
            }
            return item;
          });
          return Reflect.apply(end,response,[JSON.stringify(page),...args.slice(1)]) as ServerResponse;
        }
      }
      return Reflect.apply(end,response,args) as ServerResponse;
    };
    response.end=wrappedEnd;
  };
  f.runtime.server.on('request',projectCard39c);

  const closers:(() => Promise<void> | void)[]=[
    ()=>{f.runtime.server.off('request',projectCard39c);},
  ];
  let browser:Browser|undefined,dev:Awaited<ReturnType<typeof createServer>>|undefined,viteCacheDir:string|undefined,failed:unknown;

  try{
    viteCacheDir=await mkdtemp(join(tmpdir(),'card39c-vite-'));
    closers.push(()=>viteCacheDir?rm(viteCacheDir,{recursive:true,force:true}):undefined);
    dev=await createServer({
      configFile:false,
      root:join(root,'app/pc-admin'),
      base:'/workbench/app/',
      cacheDir:viteCacheDir,
      plugins:[react(),tailwind()],
      logLevel:'error',
      server:{
        host:'127.0.0.1',
        port:0,
        fs:{allow:[root]},
        proxy:{'/api':{target:f.origin,changeOrigin:true,headers:{origin:f.origin}}},
      },
    });
    closers.push(async()=>{await dev?.close();});
    await dev.listen();
    const devAddress=dev.httpServer?.address();
    assert.ok(devAddress&&typeof devAddress==='object');
    const devOrigin='http://127.0.0.1:'+devAddress.port;

    browser=await launchSystemBrowser({
      url:f.origin+'/workbench/app/?range=all',
      width:1600,
      height:1000,
      // Both servers use 127.0.0.1. The fixture cookie applies to that host across ports.
      cookies:[{...actor,url:f.origin+'/'}],
    });
    assert.ok(browser);
    closers.push(async()=>{await browser?.close();});
    const rawBrowser=browser;
    const wait=(step:string,checks:Record<string,string>)=>waitForChecks(rawBrowser,step,checks);
    // Shared navigation, pointer and workbench helpers also use this browser's waitFor.
    const b:Browser={...rawBrowser,waitFor:(expression,options)=>waitForChecks(rawBrowser,'Browser wait',{[expression]:expression},options)};
    await b.command('Page.bringToFront');
    const evidence=process.env.CARD39C_EVIDENCE_DIR||await mkdtemp(join(tmpdir(),'card39c-evidence-'));
    await mkdir(evidence,{recursive:true});
    const system=platform()+' '+release()+' / '+String((await b.command('Browser.getVersion')).product);
    const stripName='presence-card-to-aggregate';
    const descriptions:Record<string,string>={
      ...Object.fromEntries([260,300,360].map(width=>[`owner-${width}.png`,`${width} px board cards with two- through five-character names and crowded tags`])),
      'owner-hover-5char.png':'Full five-character name on hover at 260 px',
      'presence-aggregate-after-card.png':'Aggregate tooltip over +N after the person card exited',
      [`filmstrip/${stripName}.png`]:'Open person card, then 0%, 25%, 50%, 75% and 100% of the aggregate tooltip fade after exit',
      [`filmstrip/${stripName}.json`]:'Filmstrip frame order, animation count and crop',
    };
    const saved=new Set<string>();
    closers.push(async()=>{
      await writeFile(join(evidence,'card39c-owner.md'),[
        '# Card 39C owner and presence evidence','','| File | Capture | OS and browser |','| --- | --- | --- |',
        ...Object.entries(descriptions).map(([file,description])=>saved.has(file)
          ?`| [${file}](${file}) | ${description} | ${system} |`
          :`| ${file} | Missing in this run | ${system} |`),'',
      ].join('\n'));
      console.log('Card 39C evidence: '+evidence);
    });
    const cardSelector=(id:string)=>`.board-column.active .ticket-card[data-item-id="${id}"]`;
    const ownerCards=[ticket2,ticket3,ticket4,ticket5,ticketManyTags].map(cardSelector);
    const shot=async(file:string,selectors:string[],beyondViewport=false)=>{
      await waitForAnimationsSettled(b);
      const clip=object(await b.evaluate(`(()=>{
        const rects=${JSON.stringify(selectors)}.map(selector=>{
          const rect=document.querySelector(selector)?.getBoundingClientRect();
          if(!rect?.width||!rect.height)throw Error('Missing capture target '+selector);
          return rect;
        });
        const x=Math.max(${beyondViewport?'0':'scrollX'},Math.floor(Math.min(...rects.map(r=>r.left))+scrollX)-12);
        const y=Math.max(${beyondViewport?'0':'scrollY'},Math.floor(Math.min(...rects.map(r=>r.top))+scrollY)-12);
        const right=Math.min(${beyondViewport?'document.documentElement.scrollWidth':'scrollX+innerWidth'},Math.ceil(Math.max(...rects.map(r=>r.right))+scrollX)+12);
        const bottom=Math.min(${beyondViewport?'document.documentElement.scrollHeight':'scrollY+innerHeight'},Math.ceil(Math.max(...rects.map(r=>r.bottom))+scrollY)+12);
        return {x,y,width:right-x,height:bottom-y,scale:1};
      })()`));
      const result=await b.command('Page.captureScreenshot',{format:'png',clip,captureBeyondViewport:beyondViewport});
      assert.equal(typeof result.data,'string');
      await writeFile(join(evidence,file),Buffer.from(result.data,'base64'));
      saved.add(file);
    };
    await observe(b);
    await b.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
      window.__hoverBridgeProbe={comparisons:0,calls:0,publishes:0,onItemsCompare(count){this.calls+=1;this.comparisons+=count;},onPublish(){this.publishes+=1;}};
    })()`});

    const openAllBoard=async()=>{
      await navigate(b,f.origin+'/workbench/app/?range=all',boardReady+'&&Object.keys(probe37.pages).length===3');
      await b.evaluate("document.querySelectorAll('[data-action=expand-column][aria-expanded=false]').forEach(el=>el.click())");
      await waitForAnimationsSettled(b,'.board');
    };

    await t.test('C1 owner name fits 2-4 CJK chars across 260/300/360px, ellipsises 5-char name with hover, and folds crowded tags first',async()=>{
      await openAllBoard();
      await b.waitFor(exists(`.ticket-card[data-item-id="${ticketSelf}"] .ds-ticket-owner-link`));
      await b.evaluate('document.fonts.ready.then(()=>true)');
      // The production CSP blocks inline stylesheets. Size the active grid track
      // through CSSOM, leaving the card and its footer under their normal rules.
      const columnInset=Number(await b.evaluate(`(()=>{
        const column=document.querySelector('.board-column.active');
        const card=column.querySelector('.ticket-card[data-item-id="${ticket2}"]');
        return column.getBoundingClientRect().width-card.getBoundingClientRect().width;
      })()`));
      const expectedCrowdedTags=['已催单','待复核','等待中','待补位置'] as const;
      const titlesFor=async(id:string)=>{
        const urgedAt=await b.evaluate(`probe37.pages.active.find(item=>item.id===${JSON.stringify(id)})?.web_report_urge?.last_urged_at`);
        assert.ok(typeof urgedAt==='string'&&urgedAt.length>0,'crowded-card fixture must supply last_urged_at');
        return ['本轮已催单 · 2 次；最近催单：'+urgedAt+'（北京时间）','待复核','等待厂商','待补位置'];
      };
      const crowdedTitles=await titlesFor(ticketManyTags),followUpTitles=await titlesFor(ticketManyTagsFollowUp);
      const foldedByWidth=new Map<number,number>();
      const sizeCard=async(width:number)=>{
        await b.evaluate(`document.querySelector('.board').style.gridTemplateColumns='minmax(0,1fr) ${width+columnInset}px minmax(0,1fr)'`);
        await waitForAnimationsSettled(b,'.board-column.active');
        await b.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      };
      try{
        for(const width of [260,300,360]){
          await sizeCard(width);
          for(const [id,name] of [[ticket2,'林舟'],[ticket3,'陈明远'],[ticket4,'欧阳明远']] as const){
            const metrics=object(await b.evaluate(`(()=>{
              const cardEl=document.querySelector('.ticket-card[data-item-id="${id}"]');
              const ownerWrap=cardEl.querySelector('.ds-ticket-card-footer .ds-ticket-owner');
              const nameEl=ownerWrap.querySelector('.owner-name');
              const tagsEl=cardEl.querySelector('.card-tags');
              const ow=getComputedStyle(ownerWrap),nm=getComputedStyle(nameEl);
              return {
                cardWidth:Math.round(cardEl.getBoundingClientRect().width),
                text:nameEl.textContent,
                flexShrink:ow.flexShrink,
                maxWidth:ow.maxWidth,
                scrollWidth:nameEl.scrollWidth,
                clientWidth:nameEl.clientWidth,
                textOverflow:nm.textOverflow,
                tagsRight:tagsEl.getBoundingClientRect().right,
                ownerLeft:ownerWrap.getBoundingClientRect().left,
              };
            })()`));
            assert.equal(metrics.cardWidth,width,`rendered card width must equal ${width}`);
            assert.equal(metrics.text,name);
            assert.equal(metrics.flexShrink,'0');
            assert.equal(metrics.maxWidth,'none');
            assert.ok(Number(metrics.clientWidth)>0&&Number(metrics.scrollWidth)<=Number(metrics.clientWidth),`width=${width} name=${name}: ${JSON.stringify(metrics)}`);
            assert.ok(Number(metrics.tagsRight)<=Number(metrics.ownerLeft)+1,`width=${width} tags collide with owner: ${JSON.stringify(metrics)}`);
          }

          const longMetrics=object(await b.evaluate(`(()=>{
            const cardEl=document.querySelector('.ticket-card[data-item-id="${ticket5}"]');
            const ownerWrap=cardEl.querySelector('.ds-ticket-card-footer .ds-ticket-owner');
            const linkEl=ownerWrap.querySelector('.ds-ticket-owner-link');
            const nameEl=ownerWrap.querySelector('.owner-name');
            return {
              cardWidth:Math.round(cardEl.getBoundingClientRect().width),
              text:nameEl.textContent,
              title:linkEl.getAttribute('title'),
              scrollWidth:nameEl.scrollWidth,
              clientWidth:nameEl.clientWidth,
              textOverflow:getComputedStyle(nameEl).textOverflow,
            };
          })()`));
          assert.equal(longMetrics.cardWidth,width);
          assert.equal(longMetrics.text,'欧阳明远华');
          assert.equal(longMetrics.title,'欧阳明远华');
          assert.equal(longMetrics.textOverflow,'ellipsis');
          assert.ok(Number(longMetrics.scrollWidth)>Number(longMetrics.clientWidth),`width=${width} 5-char name must ellipsis: ${JSON.stringify(longMetrics)}`);

          if(width===260)await b.evaluate(`${q(cardSelector(ticket5))}.scrollIntoView({block:'center',behavior:'instant'})`);
          await hover(b,`.ticket-card[data-item-id="${ticket5}"] .ds-ticket-owner-link`);
          await b.waitFor(exists(person));
          await waitForAnimationsSettled(b,person);
          assert.equal(await b.evaluate(q('.ds-person-hover-name')+'.textContent'),'欧阳明远华');
          if(width===260)await shot('owner-hover-5char.png',[cardSelector(ticket5),person]);
          await escape(b);
          await b.waitFor('!'+q(card));
          await move(b,away);

          const manyTags=object(await b.evaluate(`(()=>{
            const cardEl=document.querySelector('.ticket-card[data-item-id="${ticketManyTags}"]');
            const tagsEl=cardEl.querySelector('.card-tags');
            const shownTags=[...tagsEl.querySelectorAll('.ds-tag:not([data-card-tag-overflow])')].map(tag=>{
              const content=tag.querySelector('.ds-tag-content')??tag;
              return {
                label:content.textContent??'',
                scrollWidth:content.scrollWidth,
                clientWidth:content.clientWidth,
                textOverflow:getComputedStyle(content).textOverflow,
              };
            });
            const overflowEl=tagsEl.querySelector('[data-card-tag-overflow="true"]');
            const overflowContent=overflowEl?.querySelector('.ds-tag-content')??overflowEl;
            const ownerWrap=cardEl.querySelector('.ds-ticket-card-footer .ds-ticket-owner');
            const nameEl=ownerWrap.querySelector('.owner-name');
            return {
              cardWidth:Math.round(cardEl.getBoundingClientRect().width),
              ownerScroll:nameEl.scrollWidth,
              ownerClient:nameEl.clientWidth,
              foldedCount:Number(tagsEl.getAttribute('data-folded-tag-count')??'0'),
              singleTag:tagsEl.getAttribute('data-single-tag')==='true',
              shownTags,
              overflow:overflowEl?{
                text:overflowEl.textContent??'',
                ariaLabel:overflowEl.getAttribute('aria-label')??'',
                title:overflowEl.getAttribute('title')??'',
                scrollWidth:overflowContent.scrollWidth,
                clientWidth:overflowContent.clientWidth,
                right:overflowEl.getBoundingClientRect().right,
              }:null,
              tagsRight:tagsEl.getBoundingClientRect().right,
              ownerLeft:ownerWrap.getBoundingClientRect().left,
            };
          })()`));
          assert.equal(manyTags.cardWidth,width);
          assert.ok(Number(manyTags.ownerScroll)<=Number(manyTags.ownerClient),`width=${width} 4-char owner must stay complete beside crowded tags: ${JSON.stringify(manyTags)}`);
          assert.ok(Number(manyTags.tagsRight)<=Number(manyTags.ownerLeft)+1,`width=${width} crowded tags overlap owner: ${JSON.stringify(manyTags)}`);
          const foldedCount=Number(manyTags.foldedCount);
          const singleTag=manyTags.singleTag===true;
          assert.ok(Array.isArray(manyTags.shownTags)&&manyTags.shownTags.length>=1,`width=${width} must keep at least one shown tag`);
          const shownTags=manyTags.shownTags.map(entry=>{
            const tag=object(entry);
            return {
              label:String(tag.label),
              scrollWidth:Number(tag.scrollWidth),
              clientWidth:Number(tag.clientWidth),
              textOverflow:String(tag.textOverflow),
            };
          });
          assert.equal(shownTags.length+foldedCount,expectedCrowdedTags.length,`width=${width} shown + folded must equal total tags`);
          assert.deepEqual(shownTags.map(tag=>tag.label),expectedCrowdedTags.slice(0,shownTags.length),`width=${width} must fold lowest-priority tags first`);
          for(const tag of shownTags){
            if(shownTags.length>1||!singleTag){
              assert.ok(tag.clientWidth>0&&tag.scrollWidth<=tag.clientWidth,`width=${width} visible tag ${tag.label} must not be squeezed: ${JSON.stringify(tag)}`);
            }else{
              assert.ok(tag.clientWidth>0&&(tag.scrollWidth<=tag.clientWidth||tag.textOverflow==='ellipsis'),`width=${width} single remaining tag must keep min width or ellipsis: ${JSON.stringify(tag)}`);
            }
          }
          if(foldedCount>0){
            const overflow=object(manyTags.overflow);
            assert.equal(overflow.text,'+'+foldedCount);
            const hiddenLabels=expectedCrowdedTags.slice(shownTags.length);
            assert.equal(overflow.ariaLabel,'另有 '+foldedCount+' 项：'+hiddenLabels.join('、'));
            assert.equal(overflow.title,crowdedTitles.slice(shownTags.length).join('；'));
            assert.ok(Number(overflow.scrollWidth)<=Number(overflow.clientWidth),`width=${width} +N tag must not overflow: ${JSON.stringify(overflow)}`);
            assert.ok(Number(overflow.right)<=Number(manyTags.tagsRight)+1,`width=${width} tag row clips +N: ${JSON.stringify(manyTags)}`);
          }else{
            assert.equal(manyTags.overflow,null,`width=${width} unexpected +N tag when foldedCount=0`);
          }
          if(width<=300)assert.ok(foldedCount>0,`width=${width} crowded tags must fold into +N instead of slivers: ${JSON.stringify(manyTags)}`);
          foldedByWidth.set(width,foldedCount);

          if(width===260){
            const crowdedFollowUp=object(await b.evaluate(`(()=>{
              const cardEl=document.querySelector('.ticket-card[data-item-id="${ticketManyTagsFollowUp}"]');
              const tagsEl=cardEl.querySelector('.card-tags');
              const shownTags=[...tagsEl.querySelectorAll('.ds-tag:not([data-card-tag-overflow])')].map(tag=>{
                const content=tag.querySelector('.ds-tag-content')??tag;
                const labelSpan=content.querySelector('span');
                return {
                  label:content.textContent??'',
                  scrollWidth:content.scrollWidth,
                  clientWidth:content.clientWidth,
                  labelWidth:labelSpan?labelSpan.getBoundingClientRect().width:content.getBoundingClientRect().width,
                  textOverflow:getComputedStyle(content).textOverflow,
                };
              });
              const overflowEl=tagsEl.querySelector('[data-card-tag-overflow="true"]');
              const overflowContent=overflowEl?.querySelector('.ds-tag-content')??overflowEl;
              const followUpEl=tagsEl.querySelector('.shared-follow-up-summary');
              const ownerWrap=cardEl.querySelector('.ds-ticket-card-footer .ds-ticket-owner');
              const nameEl=ownerWrap.querySelector('.owner-name');
              return {
                cardWidth:Math.round(cardEl.getBoundingClientRect().width),
                ownerScroll:nameEl.scrollWidth,
                ownerClient:nameEl.clientWidth,
                foldedCount:Number(tagsEl.getAttribute('data-folded-tag-count')??'0'),
                singleTag:tagsEl.getAttribute('data-single-tag')==='true',
                shownTags,
                overflow:overflowEl?{
                  text:overflowEl.textContent??'',
                  ariaLabel:overflowEl.getAttribute('aria-label')??'',
                  title:overflowEl.getAttribute('title')??'',
                  scrollWidth:overflowContent.scrollWidth,
                  clientWidth:overflowContent.clientWidth,
                  right:overflowEl.getBoundingClientRect().right,
                }:null,
                followUp:followUpEl?{
                  width:followUpEl.getBoundingClientRect().width,
                  right:followUpEl.getBoundingClientRect().right,
                }:null,
                tagsRight:tagsEl.getBoundingClientRect().right,
                ownerLeft:ownerWrap.getBoundingClientRect().left,
              };
            })()`));
            assert.equal(crowdedFollowUp.cardWidth,260);
            assert.ok(Number(crowdedFollowUp.ownerScroll)<=Number(crowdedFollowUp.ownerClient),`follow-up 260px 4-char owner must stay complete: ${JSON.stringify(crowdedFollowUp)}`);
            assert.ok(Number(crowdedFollowUp.tagsRight)<=Number(crowdedFollowUp.ownerLeft)+1,`follow-up 260px tags overlap owner: ${JSON.stringify(crowdedFollowUp)}`);
            const followUpRect=object(crowdedFollowUp.followUp);
            assert.ok(Number(followUpRect.width)>0&&Number(followUpRect.right)<=Number(crowdedFollowUp.tagsRight)+1,`follow-up must remain visible without overflowing: ${JSON.stringify(crowdedFollowUp)}`);
            const followUpFolded=Number(crowdedFollowUp.foldedCount);
            const followUpSingle=crowdedFollowUp.singleTag===true;
            assert.ok(followUpFolded>0,`follow-up 260px crowded card must fold tags: ${JSON.stringify(crowdedFollowUp)}`);
            assert.ok(Array.isArray(crowdedFollowUp.shownTags));
            const followUpShown=crowdedFollowUp.shownTags.map(entry=>{
              const tag=object(entry);
              return {
                label:String(tag.label),
                scrollWidth:Number(tag.scrollWidth),
                clientWidth:Number(tag.clientWidth),
                labelWidth:Number(tag.labelWidth),
                textOverflow:String(tag.textOverflow),
              };
            });
            assert.equal(followUpShown.length+followUpFolded,expectedCrowdedTags.length);
            assert.deepEqual(followUpShown.map(tag=>tag.label),expectedCrowdedTags.slice(0,followUpShown.length));
            for(const tag of followUpShown){
              assert.ok(tag.clientWidth>0&&tag.labelWidth>0,`260px follow-up card must never render a zero-width tag label: ${JSON.stringify(tag)}`);
              if(followUpShown.length>1||!followUpSingle){
                assert.ok(tag.scrollWidth<=tag.clientWidth,`260px follow-up tag ${tag.label} must not be squeezed: ${JSON.stringify(tag)}`);
              }else{
                assert.ok(tag.scrollWidth<=tag.clientWidth||tag.textOverflow==='ellipsis',`260px follow-up single tag must ellipsise cleanly: ${JSON.stringify(tag)}`);
              }
            }
            const followUpOverflow=object(crowdedFollowUp.overflow);
            assert.equal(followUpOverflow.text,'+'+followUpFolded);
            const hiddenLabels=expectedCrowdedTags.slice(followUpShown.length);
            assert.equal(followUpOverflow.ariaLabel,'另有 '+followUpFolded+' 项：'+hiddenLabels.join('、'));
            assert.equal(followUpOverflow.title,followUpTitles.slice(followUpShown.length).join('；'));
            assert.ok(Number(followUpOverflow.scrollWidth)<=Number(followUpOverflow.clientWidth));
            assert.ok(Number(followUpOverflow.right)<=Number(crowdedFollowUp.tagsRight)+1);
          }

          await b.evaluate("window.scrollTo({top:0,behavior:'instant'})");
          await shot(`owner-${width}.png`,ownerCards,true);
        }
        assert.ok((foldedByWidth.get(360)??99)<=(foldedByWidth.get(300)??99));
        assert.ok((foldedByWidth.get(300)??99)<=(foldedByWidth.get(260)??99));

        // A permanently folded row also satisfies the monotonic checks above.
        // Make room for every tag on the same mounted card and check the actual labels.
        await sizeCard(600);
        const crowdedRow=q(cardSelector(ticketManyTags)+' .card-tags');
        assert.deepEqual(await b.evaluate(`Array.from(${crowdedRow}.querySelectorAll('.ds-tag-content'),tag=>tag.textContent)`),expectedCrowdedTags,'widening the card to 600px must restore all four tags');
        const followUpCrowdedRow=q(cardSelector(ticketManyTagsFollowUp)+' .card-tags');
        assert.deepEqual(await b.evaluate(`Array.from(${followUpCrowdedRow}.querySelectorAll('.ds-tag-content'),tag=>tag.textContent)`),expectedCrowdedTags,'widening the follow-up card to 600px must restore all four tags');
        assert.ok(Number(await b.evaluate(`${followUpCrowdedRow}.querySelector('.shared-follow-up-summary')?.getBoundingClientRect().width??0`))>0);

        const selfHidden=await b.evaluate(`Boolean(document.querySelector('.ticket-card[data-item-id="${ticketSelf}"] .ds-ticket-card-footer .owner-name.sr-only'))`);
        assert.equal(selfHidden,true,'self-name sr-only rule remains intact');
      }finally{
        await b.evaluate("document.querySelector('.board').style.removeProperty('grid-template-columns')");
      }
    });

    await t.test('C2.1 search mode 10 consecutive detail switches via Next/Previous keep hover-bridge comparisons constant',async()=>{
      // Mount before searching. A direct search URL in Vite's StrictMode can start
      // two initial requests while the server permits one search at a time.
      await navigate(b,devOrigin+'/workbench/app/?range=all',boardReady+'&&Object.keys(probe37.pages).length===3');
      const formSelector='form[aria-label="搜索全部获权事项"]';
      const searchTerm='Card39C';
      // The compact toolbar clips its submit button. Use the controlled input
      // and the form's native submit event, as in the T41 search browser suite.
      await b.evaluate(`(()=>{
        const input=document.querySelector(${JSON.stringify(formSelector+' input[name=q]')});
        if(!input||input.matches(':disabled'))throw Error('C2.1 search input unavailable');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(searchTerm)});
        input.dispatchEvent(new Event('input',{bubbles:true}));
      })()`);
      await b.evaluate(`(()=>{
        const form=${q(formSelector)},submit=form.querySelector('button[type=submit]');
        if(!submit||submit.matches(':disabled'))throw Error('C2.1 search submit unavailable');
        form.requestSubmit(submit);
      })()`);
      const searchChecks=`({
        searchMode:new URLSearchParams(location.search).get('search')==='1',
        queryCommitted:new URLSearchParams(location.search).get('q')===${JSON.stringify(searchTerm)},
        leaveControl:!!document.querySelector('.workbench-search [data-action=leave-workbench-search]'),
        requestObserved:window.probe37?.requests.some(r=>r.path==='/api/workbench/search')===true,
        formIdle:${q(formSelector)}?.getAttribute('aria-busy')==='false',
        numericColumnCounts:(${boardReady}),
        ticketRendered:!!document.querySelector('.board .ticket-card[data-kind="ticket"]')
      })`;
      const searchError="Boolean(document.querySelector('[data-search-state=error]'))";
      try{
        await b.waitFor(`${searchError}||Object.values(${searchChecks}).every(Boolean)`);
        assert.equal(await b.evaluate(searchError),false,'search returned an error');
      }catch(cause){
        const state=await b.evaluate(`({...(${searchChecks}),searchError:${searchError},
          columnCounts:[...document.querySelectorAll('.ds-stage-count')].map(n=>n.textContent.trim())})`);
        throw new Error('C2.1 search did not become ready: '+JSON.stringify(state),{cause});
      }
      await b.evaluate("document.querySelectorAll('[data-action=expand-column][aria-expanded=false]').forEach(el=>el.click())");
      await waitForAnimationsSettled(b,'.board');

      const probeInit=object(await b.evaluate('({publishes:window.__hoverBridgeProbe.publishes,calls:window.__hoverBridgeProbe.calls})'));
      assert.ok(Number(probeInit.publishes)>0&&Number(probeInit.calls)>0,'hover-bridge dev probe must be connected: '+JSON.stringify(probeInit));

      await clickWorkbenchControl(b,`.board-column.active .ticket-card[data-item-id="${ticket2}"] .card-open`);
      const detailReady="Boolean(document.querySelector('.detail-dialog .ds-detail-body-live .ds-detail-hero #detail-title'))";
      await wait('C2.1 open search result',{selectedTicket:`location.pathname.endsWith('/items/ticket/${ticket2}')`,detailReady});
      await waitForAnimationsSettled(b,'.detail-dialog');

      const before=Number(await b.evaluate('window.__hoverBridgeProbe.comparisons'));
      const visited=new Set<string>([String(await b.evaluate('location.pathname'))]);

      for(let i=0;i<10;i++){
        const currentPath=String(await b.evaluate('location.pathname'));
        // Next/Previous stay disabled until the previous switch fully commits (PR #202); wait for readiness, then assert as before.
        await b.waitFor("document.querySelector('.detail-next')?.disabled===false||document.querySelector('.detail-previous')?.disabled===false");
        const nextDisabled=Boolean(await b.evaluate("document.querySelector('.detail-next')?.disabled!==false"));
        const selector=nextDisabled?'.detail-previous':'.detail-next';
        assert.equal(await b.evaluate(`document.querySelector(${JSON.stringify(selector)})?.disabled`),false,`step ${i} requires enabled ${selector}`);
        await clickWorkbenchControl(b,selector);
        await wait('C2.1 detail switch '+i,{pathChanged:`location.pathname!==${JSON.stringify(currentPath)}`,detailReady});
        await waitForAnimationsSettled(b,'.detail-dialog');
        visited.add(String(await b.evaluate('location.pathname')));
      }
      assert.ok(visited.size>=2,'Next/Previous switches must navigate across multiple search items');
      const after=Number(await b.evaluate('window.__hoverBridgeProbe.comparisons'));
      assert.equal(after,before,'hover-bridge element comparisons must stay constant across 10 Next/Previous switches');
      await escape(b);
      await b.waitFor("!document.querySelector('.detail-dialog')");
    });

    await t.test('C2.2 open presence name tag to +N or midpoint gap shows warm aggregate tooltip only after exit completes',async subtest=>{
      for(const [id,cookieIndex,mode] of [
        [presenceCrowd,1,'VIEWING'],[presenceCrowd,2,'VIEWING'],[presenceCrowd,3,'VIEWING'],
        [presenceTwo,1,'VIEWING'],[presenceTwo,2,'EDITING'],
      ] as const){
        subtest.after(await beginPresence(f,id,cookieIndex,mode));
      }
      await openAllBoard();
      const crowdCard=`.ticket-card[data-item-id="${presenceCrowd}"]`;
      const crowdTags=crowdCard+' .ds-presence-tags';
      const crowdName=crowdTags+' .ds-presence-tag:not([data-mode="more"])';
      const twoTags=`.ticket-card[data-item-id="${presenceTwo}"] .ds-presence-tags`;
      await wait('C2.2 presence groups',{crowdReady:`document.querySelectorAll('${crowdTags} .ds-presence-tag').length===2`,twoReady:`document.querySelectorAll('${twoTags} .ds-presence-tag').length===2`});
      const aggregateOpen=(group:string)=>`${q(group)}?.dataset.tooltipOpen==='true'`;
      const personGone='!'+q(person);

      const watchGroup=async(groupSelector:string)=>{
        await b.evaluate(`(()=>{
          const group=document.querySelector(${JSON.stringify(groupSelector)});
          const state=window.__card39cOverlap={overlaps:0,sawExiting:false,running:true};
          const sample=()=>{
            if(!state.running)return;
            const popup=document.querySelector('[data-hover-card="person"]');
            if(popup?.hasAttribute('data-exiting'))state.sawExiting=true;
            if(popup&&group.dataset.tooltipOpen==='true')state.overlaps+=1;
            requestAnimationFrame(sample);
          };
          const observer=new MutationObserver(()=>{
            const popup=document.querySelector('[data-hover-card="person"]');
            if(popup?.hasAttribute('data-exiting'))state.sawExiting=true;
            if(popup&&group.dataset.tooltipOpen==='true')state.overlaps+=1;
          });
          observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['data-exiting','data-tooltip-open']});
          state.stop=()=>{state.running=false;observer.disconnect();return {overlaps:state.overlaps,sawExiting:state.sawExiting};};
          requestAnimationFrame(sample);
        })()`);
      };

      // Subcase A (cold -> +N)
      await b.evaluate(`document.querySelector(${JSON.stringify(crowdTags)}).scrollIntoView({block:'center'})`);
      await waitForAnimationsSettled(b,crowdTags);
      await hover(b,crowdName);
      await wait('C2.2 cold name hover',{nameExpanded:exists(crowdName+'[aria-expanded="true"]'),personMounted:exists(person)});
      await watchGroup(crowdTags);
      await move(b,await point(b,`${crowdTags} .ds-presence-tag[data-mode="more"]`));
      await wait('C2.2 cold aggregate after exit',{personGone,aggregateOpen:aggregateOpen(crowdTags)});
      const coldResult=object(await b.evaluate('window.__card39cOverlap.stop()'));
      assert.equal(coldResult.overlaps,0,'cold +N transition must never overlap exiting person card');
      assert.equal(coldResult.sawExiting,true,'watcher must observe the 80ms exit phase');
      const aggregate=crowdTags+' .ds-presence-tooltip';
      await shot('presence-aggregate-after-card.png',[`.ticket-card[data-item-id="${presenceCrowd}"]`,crowdTags,aggregate]);

      // Warm this group's tooltip at the gap. Focus opens the name immediately, then
      // blur while the pointer is on the name leaves the real pointer exit in control.
      await move(b,away);
      await b.pressTab();
      await b.evaluate('document.activeElement?.blur()');
      await b.evaluate(`document.querySelector(${JSON.stringify(twoTags)}).scrollIntoView({block:'center'})`);
      await waitForAnimationsSettled(b,twoTags);
      const firstName=twoTags+' .ds-presence-tag:not([data-mode="more"])';
      const namePoint=await point(b,firstName);
      const midpoint=object(await b.evaluate(`(()=>{
        const group=document.querySelector(${JSON.stringify(twoTags)});
        const tags=[...group.querySelectorAll('.ds-presence-tag:not([data-mode="more"])')];
        if(tags.length!==2)throw Error('Expected two name tags');
        const a=tags[0].getBoundingClientRect(),c=tags[1].getBoundingClientRect();
        if(c.left<=a.right)throw Error('Expected horizontal gap between tags');
        const x=(a.right+c.left)/2,y=(Math.max(a.top,c.top)+Math.min(a.bottom,c.bottom))/2;
        if(document.elementFromPoint(x,y)!==group)throw Error('Midpoint must hit group gap, not tag or padding');
        return {x,y};
      })()`));
      const gapPoint={x:Number(midpoint.x),y:Number(midpoint.y)};
      await move(b,gapPoint);
      await wait('C2.2 warm the gap',{personGone,aggregateOpen:aggregateOpen(twoTags)});
      await watchGroup(twoTags);
      await move(b,namePoint);
      await b.evaluate(`${q(firstName)}.focus({preventScroll:true})`);
      await wait('C2.2 warm name focus',{hovered:exists(firstName+':hover'),focused:exists(firstName+':focus'),expanded:exists(firstName+'[aria-expanded="true"]'),personMounted:exists(person)});
      await b.evaluate(`${q(firstName)}.blur()`);
      await move(b,gapPoint);
      await wait('C2.2 warm aggregate after exit',{personGone,aggregateOpen:aggregateOpen(twoTags)});
      const warmResult=object(await b.evaluate('window.__card39cOverlap.stop()'));
      assert.equal(warmResult.overlaps,0,'warm tooltip must stay suppressed through both 150ms leave and 80ms exit');
      assert.equal(warmResult.sawExiting,true,'warm watcher must observe the 80ms exit phase before tooltip opens');

      // HoverCard dismisses on scroll. Settle the scroll before using Shift+Tab from the
      // card link, the next tab stop after the presence name (+N is not focusable).
      await move(b,away);
      await b.evaluate(`${q(crowdName)}.scrollIntoView({block:'center',behavior:'instant'})`);
      await waitForAnimationsSettled(b,crowdTags);
      await b.evaluate(`${q(crowdCard+' .card-open')}.focus({preventScroll:true})`);
      for(const type of ['rawKeyDown','keyUp'] as const){
        await b.command('Input.dispatchKeyEvent',{type,key:'Tab',code:'Tab',modifiers:8,windowsVirtualKeyCode:9,nativeVirtualKeyCode:9});
      }
      await wait('C2.2 keyboard opens crowd name',{nameFocused:exists(crowdName+':focus'),nameExpanded:exists(crowdName+'[aria-expanded="true"]'),personMounted:exists(person)});
      await move(b,await point(b,`${crowdTags} .ds-presence-tag[data-mode="more"]`));
      await escape(b);
      await delay(500);
      assert.notEqual(await b.evaluate(`document.querySelector(${JSON.stringify(crowdTags)}).dataset.tooltipOpen`),'true');
      await b.evaluate('document.activeElement?.blur()');
      await wait('C2.2 aggregate after blur',{aggregateOpen:aggregateOpen(crowdTags)});
      await move(b,away);

      // Replay for evidence after the three real-time checks. Resolve coordinates
      // before freezing playback so the point helper can wait for settled layout.
      await b.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
      try{
        const morePoint=await point(b,crowdTags+' .ds-presence-tag[data-mode="more"]');
        await hover(b,crowdTags+' .ds-presence-tag:not([data-mode="more"])');
        await b.waitFor(exists(person));
        await waitForAnimationsSettled(b,person);
        const strip=createFilmstripCapture(b,join(evidence,'filmstrip'));
        await strip(stripName,async()=>{
          await move(b,morePoint);
          await wait('C2.2 filmstrip transition',{personGone,aggregateOpen:aggregateOpen(crowdTags),opacityTransition:`${q(aggregate)}?.getAnimations().some(a=>a.transitionProperty==='opacity')`});
        },[person,crowdTags,aggregate].join(','),{initialFrame:'person-card-open'});
      }finally{
        await b.command('Emulation.setEmulatedMedia',{features:[]});
      }
      saved.add(`filmstrip/${stripName}.png`);
      saved.add(`filmstrip/${stripName}.json`);
    });

    await t.test('C2.3 online-colleagues Escape handles unrelated parent+child stack and parent-focused child-first Escape',async subtest=>{
      // 周宁 owns the nested owner's presence link and must also be online for this subtest.
      subtest.after(await beginPresence(f,presenceTwo,2,'EDITING'));
      await openAllBoard();
      const onlineButton='[data-online-colleagues] button';
      const panelOpen=exists('.ds-online-panel'),panelClosed='!'+q('.ds-online-panel');
      const parentReady={personMounted:exists(person),presenceLink:exists('.ds-person-hover-presence-link')};
      await wait('C2.3 online roster',{realtimeLive:exists('.app[data-realtime-status="live"]'),rosterMounted:exists('[data-online-colleagues]'),sidebarExpanded:'!'+q('.app.sidebar-collapsed'),peerCountPositive:`Number(${q('.ds-online-count')}?.textContent)>0`,buttonReady:exists(onlineButton)});
      const openOnlinePanel=async()=>{
        await b.evaluate("document.querySelector('[data-online-colleagues] button').focus()");
        for(const type of ['keyDown','keyUp'] as const){
          await b.command('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',...(type==='keyDown'?{text:'\r'}:{})});
        }
        await wait('C2.3 panel entered',{panelOpen,entryCompleted:exists('.ds-online-panel:not([data-entering])')});
        await waitForAnimationsSettled(b,'.ds-online-panel');
      };

      // Subcase A: unrelated parent PersonHoverCard + nested TicketHoverCard while focus stays on online panel trigger.
      await openOnlinePanel();
      await hover(b,`.ticket-card[data-item-id="${nestedOwnerTicket}"] .ds-ticket-owner-link`);
      await wait('C2.3 unrelated parent',parentReady);
      await hover(b,'.ds-person-hover-presence-link');
      await b.waitFor(exists(ticket));
      await escape(b);
      await wait('C2.3 unrelated stack Escape',{panelClosed,hoverStackClosed:'!'+q(card)});
      assert.equal(await b.evaluate("document.activeElement===document.querySelector('[data-online-colleagues] button')"),true,'one Escape dismisses unrelated parent+child stack and online panel');

      // Subcase B: unrelated parent+child stack with focus inside the parent PersonHoverCard -> Escape closes child first, keeps parent & online panel open.
      await openOnlinePanel();
      await hover(b,`.ticket-card[data-item-id="${nestedOwnerTicket}"] .ds-ticket-owner-link`);
      await wait('C2.3 parent before focus',parentReady);
      const parentAction='[data-hover-card="person"] [data-action="filter-person-tickets"]';
      await b.evaluate(`${q(parentAction)}.focus({preventScroll:true})`);
      await hover(b,'.ds-person-hover-presence-link');
      await b.waitFor(exists(ticket));
      assert.equal(await b.evaluate(`document.activeElement===${q(parentAction)}`),true,'parent action must hold focus when Escape is pressed');
      await escape(b);
      await wait('C2.3 parent-focused Escape',{childGone:'!'+q(ticket),parentOpen:exists(person),panelOpen});
      assert.equal(await b.evaluate("document.activeElement===document.querySelector('.ds-person-hover-presence-link')"),true,'child-first Escape restores focus to nested trigger inside parent');
      await escape(b);
      await b.waitFor('!'+q(person));
      await b.evaluate("document.querySelector('[data-online-colleagues] button').focus()");
      await escape(b);
      await b.waitFor("document.querySelector('.ds-online-panel')===null");

      // Subcase C: panel row hover card child-first Escape, then second Escape closes panel.
      await openOnlinePanel();
      await hover(b,'.ds-online-panel .ds-online-person');
      await b.waitFor(exists(person));
      await escape(b);
      await wait('C2.3 panel-row Escape',{personGone:'!'+q(person),panelOpen});
      await escape(b);
      await wait('C2.3 second panel Escape',{panelClosed,focusRestored:exists(onlineButton+':focus')});
    });
  }catch(error){
    failed=error;
  }finally{
    await closeBrowserTestResources(closers.reverse(),failed);
  }
},{precisionV212:true,syntheticServiceCodes:true,ticketSelfHandlingEnabled:true,workbenchInternalNotesEnabled:true,workbenchActivityEnabled:true,workbenchRealtimeEnabled:true,workbenchSearchEnabled:true,workbenchFollowEnabled:true,presencePeerSessions:true}));
