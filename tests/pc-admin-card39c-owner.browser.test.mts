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
  try{
    const stream=await fetch(f.origin+'/api/realtime/events?scope=workbench',{signal:controller.signal,headers:{cookie,accept:'text/event-stream'}});
    assert.equal(stream.status,200);
    await renew();
  }catch(error){
    controller.abort();
    throw error;
  }
  let failure:unknown;
  const timer=setInterval(()=>{void renew().catch(error=>{failure=error;});},4000);
  return ()=>{clearInterval(timer);controller.abort();if(failure)throw failure;};
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
    [ticketSelf,selfPrincipal,'IN_PROGRESS','门诊五楼（合成）'],
    [nestedOwnerTicket,zhouPrincipal,'IN_PROGRESS','门诊六楼（合成）'],
  ] as const){
    await f.pool.query(
      'UPDATE pilot_ticket.ticket SET status=$2,assignee_id=$3,reported_location_text=$4,updated_at=platform.local_now() WHERE id=$1::uuid',
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
    const b=browser;
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

    await t.test('C1 owner name fits 2-4 CJK chars across 260/300/360px, ellipsises 5-char name with hover, and shrinks crowded tags first',async()=>{
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
      try{
        for(const width of [260,300,360]){
          await b.evaluate(`document.querySelector('.board').style.gridTemplateColumns='minmax(0,1fr) ${width+columnInset}px minmax(0,1fr)'`);
          await waitForAnimationsSettled(b,'.board-column.active');
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
            const tagContents=[...tagsEl.querySelectorAll('.ds-tag-content')];
            const ownerWrap=cardEl.querySelector('.ds-ticket-card-footer .ds-ticket-owner');
            const nameEl=ownerWrap.querySelector('.owner-name');
            return {
              cardWidth:Math.round(cardEl.getBoundingClientRect().width),
              ownerScroll:nameEl.scrollWidth,
              ownerClient:nameEl.clientWidth,
              tagsShrunk:tagsEl.scrollWidth>tagsEl.clientWidth||tagContents.some(n=>n.scrollWidth>n.clientWidth),
              tagsRight:tagsEl.getBoundingClientRect().right,
              ownerLeft:ownerWrap.getBoundingClientRect().left,
            };
          })()`));
          assert.equal(manyTags.cardWidth,width);
          assert.ok(Number(manyTags.ownerScroll)<=Number(manyTags.ownerClient),`width=${width} 4-char owner must stay complete beside crowded tags: ${JSON.stringify(manyTags)}`);
          assert.equal(manyTags.tagsShrunk,true,`width=${width} crowded tags must absorb shrinking: ${JSON.stringify(manyTags)}`);
          assert.ok(Number(manyTags.tagsRight)<=Number(manyTags.ownerLeft)+1);
          await b.evaluate("window.scrollTo({top:0,behavior:'instant'})");
          await shot(`owner-${width}.png`,ownerCards,true);
        }

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
      await b.waitFor(`location.pathname.endsWith('/items/ticket/${ticket2}')&&${detailReady}`);
      await waitForAnimationsSettled(b,'.detail-dialog');

      const before=Number(await b.evaluate('window.__hoverBridgeProbe.comparisons'));
      const visited=new Set<string>([String(await b.evaluate('location.pathname'))]);

      for(let i=0;i<10;i++){
        const currentPath=String(await b.evaluate('location.pathname'));
        const nextDisabled=Boolean(await b.evaluate("document.querySelector('.detail-next')?.disabled!==false"));
        const selector=nextDisabled?'.detail-previous':'.detail-next';
        assert.equal(await b.evaluate(`document.querySelector(${JSON.stringify(selector)})?.disabled`),false,`step ${i} requires enabled ${selector}`);
        await clickWorkbenchControl(b,selector);
        await b.waitFor(`location.pathname!==${JSON.stringify(currentPath)}&&${detailReady}`);
        await waitForAnimationsSettled(b,'.detail-dialog');
        visited.add(String(await b.evaluate('location.pathname')));
      }
      assert.ok(visited.size>=2,'Next/Previous switches must navigate across multiple search items');
      const after=Number(await b.evaluate('window.__hoverBridgeProbe.comparisons'));
      assert.equal(after,before,'hover-bridge element comparisons must stay constant across 10 Next/Previous switches');
      await escape(b);
      await b.waitFor("!document.querySelector('.detail-dialog')");
    });

    // 周宁 (peer 2) owns the in-progress ticket and can edit its internal note.
    for(const [id,cookieIndex,mode] of [
      [presenceCrowd,1,'VIEWING'],[presenceCrowd,2,'VIEWING'],[presenceCrowd,3,'VIEWING'],
      [presenceTwo,1,'VIEWING'],[presenceTwo,2,'EDITING'],
    ] as const){
      closers.push(await beginPresence(f,id,cookieIndex,mode));
    }

    await t.test('C2.2 open presence name tag to +N or midpoint gap shows warm aggregate tooltip only after exit completes',async()=>{
      await openAllBoard();
      const crowdTags=`.ticket-card[data-item-id="${presenceCrowd}"] .ds-presence-tags`;
      const twoTags=`.ticket-card[data-item-id="${presenceTwo}"] .ds-presence-tags`;
      await b.waitFor(`document.querySelectorAll('${crowdTags} .ds-presence-tag').length===2&&document.querySelectorAll('${twoTags} .ds-presence-tag').length===2`);

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
      await hover(b,`${crowdTags} .ds-presence-tag:not([data-mode="more"])`);
      await b.waitFor(`document.querySelector(${JSON.stringify(crowdTags+' .ds-presence-tag[aria-expanded="true"]')})!==null&&Boolean(${q(person)})`);
      await watchGroup(crowdTags);
      await move(b,await point(b,`${crowdTags} .ds-presence-tag[data-mode="more"]`));
      await b.waitFor(`!document.querySelector(${JSON.stringify(person)})&&document.querySelector(${JSON.stringify(crowdTags)})?.dataset.tooltipOpen==='true'`);
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
      await b.waitFor(`!${q(person)}&&${q(twoTags)}.dataset.tooltipOpen==='true'`);
      await watchGroup(twoTags);
      await move(b,namePoint);
      await b.evaluate(`${q(firstName)}.focus({preventScroll:true})`);
      await b.waitFor(`${q(firstName)}.matches(':hover:focus[aria-expanded="true"]')&&Boolean(${q(person)})`);
      await b.evaluate(`${q(firstName)}.blur()`);
      await move(b,gapPoint);
      await b.waitFor(`!document.querySelector(${JSON.stringify(person)})&&document.querySelector(${JSON.stringify(twoTags)})?.dataset.tooltipOpen==='true'`);
      const warmResult=object(await b.evaluate('window.__card39cOverlap.stop()'));
      assert.equal(warmResult.overlaps,0,'warm tooltip must stay suppressed through both 150ms leave and 80ms exit');
      assert.equal(warmResult.sawExiting,true,'warm watcher must observe the 80ms exit phase before tooltip opens');

      // Subcase C (keyboard focus suppression)
      await b.evaluate(`document.querySelector(${JSON.stringify(crowdTags)}).scrollIntoView({block:'center'})`);
      await b.evaluate(`document.querySelector(${JSON.stringify(crowdTags+' .ds-presence-tag:not([data-mode="more"])')}).focus()`);
      await b.waitFor(`document.activeElement?.matches(${JSON.stringify(crowdTags+' .ds-presence-tag[aria-expanded="true"]')})&&Boolean(${q(person)})`);
      await move(b,await point(b,`${crowdTags} .ds-presence-tag[data-mode="more"]`));
      await escape(b);
      await delay(500);
      assert.notEqual(await b.evaluate(`document.querySelector(${JSON.stringify(crowdTags)}).dataset.tooltipOpen`),'true');
      await b.evaluate('document.activeElement?.blur()');
      await b.waitFor(`document.querySelector(${JSON.stringify(crowdTags)})?.dataset.tooltipOpen==='true'`);
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
          await b.waitFor(`!${q(person)}&&${q(crowdTags)}.dataset.tooltipOpen==='true'&&${q(aggregate)}.getAnimations().some(a=>a.transitionProperty==='opacity')`);
        },[person,crowdTags,aggregate].join(','),{initialFrame:'person-card-open'});
      }finally{
        await b.command('Emulation.setEmulatedMedia',{features:[]});
      }
      saved.add(`filmstrip/${stripName}.png`);
      saved.add(`filmstrip/${stripName}.json`);
    });

    await t.test('C2.3 online-colleagues Escape handles unrelated parent+child stack and parent-focused child-first Escape',async()=>{
      await openAllBoard();
      await b.waitFor("Boolean(document.querySelector('[data-online-colleagues] button'))");
      const openOnlinePanel=async()=>{
        await b.evaluate("document.querySelector('[data-online-colleagues] button').focus()");
        for(const type of ['keyDown','keyUp'] as const){
          await b.command('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',...(type==='keyDown'?{text:'\r'}:{})});
        }
        await b.waitFor("document.querySelector('.ds-online-panel:not([data-entering])')!==null");
        await waitForAnimationsSettled(b,'.ds-online-panel');
      };

      // Subcase A: unrelated parent PersonHoverCard + nested TicketHoverCard while focus stays on online panel trigger.
      await openOnlinePanel();
      await hover(b,`.ticket-card[data-item-id="${nestedOwnerTicket}"] .ds-ticket-owner-link`);
      await b.waitFor(exists(person)+'&&'+exists('.ds-person-hover-presence-link'));
      await hover(b,'.ds-person-hover-presence-link');
      await b.waitFor(exists(ticket));
      await escape(b);
      await b.waitFor("document.querySelector('.ds-online-panel')===null&&!document.querySelector('[data-hover-card]')");
      assert.equal(await b.evaluate("document.activeElement===document.querySelector('[data-online-colleagues] button')"),true,'one Escape dismisses unrelated parent+child stack and online panel');

      // Subcase B: unrelated parent+child stack with focus inside the parent PersonHoverCard -> Escape closes child first, keeps parent & online panel open.
      await openOnlinePanel();
      await hover(b,`.ticket-card[data-item-id="${nestedOwnerTicket}"] .ds-ticket-owner-link`);
      await b.waitFor(exists(person)+'&&'+exists('.ds-person-hover-presence-link'));
      const parentAction='[data-hover-card="person"] [data-action="filter-person-tickets"]';
      await b.evaluate(`${q(parentAction)}.focus({preventScroll:true})`);
      await hover(b,'.ds-person-hover-presence-link');
      await b.waitFor(exists(ticket));
      assert.equal(await b.evaluate(`document.activeElement===${q(parentAction)}`),true,'parent action must hold focus when Escape is pressed');
      await escape(b);
      await b.waitFor(`!document.querySelector(${JSON.stringify(ticket)})&&Boolean(${q(person)})&&document.querySelector('.ds-online-panel')!==null`);
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
      await b.waitFor(`!document.querySelector(${JSON.stringify(person)})&&document.querySelector('.ds-online-panel')!==null`);
      await escape(b);
      await b.waitFor("document.querySelector('.ds-online-panel')===null&&document.activeElement===document.querySelector('[data-online-colleagues] button')");
    });
  }catch(error){
    failed=error;
  }finally{
    await closeBrowserTestResources(closers.reverse(),failed);
  }
},{precisionV212:true,syntheticServiceCodes:true,ticketSelfHandlingEnabled:true,workbenchInternalNotesEnabled:true,workbenchActivityEnabled:true,workbenchRealtimeEnabled:true,workbenchSearchEnabled:true,workbenchFollowEnabled:true,presencePeerSessions:true}));
