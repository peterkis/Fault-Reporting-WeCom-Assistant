import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {platform,release,tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import {appendTicketEvent} from '../app/server/src/p1-006-ticket-state-actions.mjs';
import {waitForAnimationsSettled} from './helpers/browser-animations.mjs';
import {clickWorkbenchControl} from './helpers/heroui-workbench-controls.mjs';
import {assertMotion,assertNoTransformAnimations} from './helpers/motion-assert.mjs';
import type {MotionMeasurement} from './helpers/motion-assert.mjs';
import {createFilmstripCapture} from './helpers/motion-filmstrip.mjs';
import {closeBrowserTestResources,launchSystemBrowser} from './helpers/p2-006-browser-harness.mjs';
import {object} from './helpers/t42-board-browser-fixture.mjs';
import type {T11Fixture} from './helpers/t11-completion-fixture.mjs';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';

type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
type Ticket=Parameters<typeof appendTicketEvent>[0]['ticket'];
type Fixture=Omit<T11Fixture,'tickets'>&{tickets:{ticket:Ticket}[]};
const root=process.env.TS_MIGRATION_TEST_SOURCE_ROOT??process.cwd();
const appPath='/workbench/app/';
const panel='.ds-drawer-content';
const backdrop='.ds-drawer-backdrop';
const liveBody='.ds-detail-body-live';
const detailView=liveBody+' .ds-detail-view';
const scrollBody=detailView+' .detail-body';
const stage='.ds-detail-body-stage';
const toolbar='.detail-navigation';
const next='.detail-next[aria-label="下一项"]';
const position='.ds-detail-position';
const heading=detailView+' #detail-title';
const enterBody='[data-detail-body-enter=next]';
const exitBody='[data-detail-body-exit=next]';
const timeline='.detail-main';
const record='[data-record-id]';
const chip=detailView+' [data-timeline-chip-anchor] [data-new-items-chip-region] [data-new-items-chip][data-direction=up]';
const timelineEnter='[data-timeline-entry-enter=true]';
const timelineHighlight='[data-timeline-entry-highlight=true]';
const cue='[data-return-cue=true]';
const presenceCard='#card36c-presence';
const tag=presenceCard+' [data-presence-person]:not([data-mode=more])';
const more=presenceCard+' [data-presence-more]';
const roll=more+' .ds-number-roll';
const frames='new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))';
const q=(selector:string)=>'document.querySelector('+JSON.stringify(selector)+')';
const boardCard=(id:string)=>'.ticket-card[data-item-id='+JSON.stringify(id)+']';
const openControl=(id:string)=>boardCard(id)+' .card-open';
const effect=(selector:string,subtree=false)=>q(selector)+'?.getAnimations({subtree:'+subtree+'}).some(a=>a.pending||a.playState==="running")';
const textIs=(selector:string,value:string)=>q(selector)+'?.textContent.trim()==='+JSON.stringify(value);

async function escape(browser:Browser){
  for(const type of ['keyDown','keyUp'])await browser.command('Input.dispatchKeyEvent',{type,key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
}

async function freeze<T>(browser:Browser,inspect:()=>Promise<T>):Promise<T>{
  await browser.command('Animation.enable');
  await browser.command('Animation.setPlaybackRate',{playbackRate:0});
  try{return await inspect();}
  finally{await browser.command('Animation.setPlaybackRate',{playbackRate:1});}
}

function exactProperties(measured:MotionMeasurement[],properties:readonly string[]){
  const cssName=(name:string)=>name.replace(/[A-Z]/gu,part=>'-'+part.toLowerCase());
  assert.deepEqual([...new Set(measured.flatMap(row=>row.properties.map(cssName)))].sort(),[...properties].sort());
}

// Card 30B's real authenticated colleague session and batch-view read provide the input snapshots.
// Only their delivery to React is scripted in the isolated fixture: the real client batches reads >=1.5s apart.
function session(origin:string,cookie:string){
  let csrf='';
  const browserId=randomUUID();
  async function read(path:string){
    const response=await fetch(origin+path,{headers:{cookie}});
    assert.equal(response.status,200);
    return object(await response.json());
  }
  async function post(path:string,body:Record<string,unknown>,headers:Record<string,string>={}){
    if(!csrf){
      const token=(await read('/api/lifecycle/bootstrap')).csrf_token;
      assert.equal(typeof token,'string');
      csrf=String(token);
    }
    const response=await fetch(origin+path,{method:'POST',headers:{cookie,origin,'content-type':'application/json','x-csrf-token':csrf,...headers},body:JSON.stringify(body)});
    assert.equal(response.status,200,await response.clone().text());
    return object(await response.json());
  }
  return {read,post,
    presence:(id:string,mode:'VIEWING'|'EDITING'|null)=>post('/api/workbench/activity',{
      schema_version:1,browser_id:browserId,target:{kind:'ticket',id},
      ...(mode?{action:'RENEW',visible:true,active:true,mode,field:mode==='EDITING'?'internal-note':null}:{action:'RELEASE'}),
    }),
  };
}

// Observe flags and actual row animations before activation. A final settled DOM alone cannot prove absence.
async function watchTimeline(browser:Browser){
  await browser.evaluate(`(()=>{
    const animated=new Set(),selector=${JSON.stringify(timelineEnter+','+timelineHighlight)};
    const remember=node=>{if(node instanceof Element&&node.matches(${JSON.stringify(record)}))animated.add(node.dataset.recordId);};
    const scan=()=>{document.querySelectorAll(selector).forEach(remember);document.querySelectorAll('.activity-list ${record}').forEach(node=>{if(node.getAnimations().length)remember(node);});};
    const observer=new MutationObserver(changes=>{for(const change of changes)if(change.type==='attributes')remember(change.target);scan();});
    observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['data-timeline-entry-enter','data-timeline-entry-highlight']});
    const tick=()=>{scan();window.__timelineFrame=requestAnimationFrame(tick);};tick();
    window.__stopTimeline=()=>{observer.disconnect();cancelAnimationFrame(window.__timelineFrame);return [...animated];};
  })()`);
}

const options={
  precisionV212:true,
  workbenchRealtimeEnabled:true,workbenchActivityEnabled:true,
  workbenchInternalNotesEnabled:true,presencePeerSessions:true,
};

test('Card 36C C5 browser acceptance and filmstrips',{timeout:600_000},t=>withWeb01Fixture(async(f:Fixture)=>{
  const directory=process.env.CARD36C_EVIDENCE_DIR??await mkdtemp(join(tmpdir(),'card36c-evidence-'));
  const cache=await mkdtemp(join(tmpdir(),'card36c-vite-'));
  const appRoot=join(root,'app/pc-admin');
  const measurements:Record<string,MotionMeasurement[]>={};
  const filmstrips:string[]=[];
  const results:Record<string,'PASS'|'FAIL'>={};
  let browser:Browser|undefined,app:Awaited<ReturnType<typeof createServer>>|undefined;
  let presence:Awaited<ReturnType<typeof createServer>>|undefined,failure:unknown;
  let browserVersion:unknown=null;
  try{
    await f.pool.query("UPDATE intake.service_intake SET summary=summary||'（合成）' WHERE summary IN ($1,$2)",[
      '尚待判断的合成材料，请协助确认。','位置尚不清楚，等待补充的全新合成报修。',
    ]);
    app=await createServer({
      root:appRoot,configFile:join(appRoot,'vite.config.ts'),cacheDir:join(cache,'app'),logLevel:'error',
      server:{host:'127.0.0.1',port:0,proxy:{'/api':{target:f.origin,changeOrigin:true,headers:{origin:f.origin}}}},
    });
    presence=await createServer({
      configFile:false,root:join(root,'tests/fixtures'),cacheDir:join(cache,'presence'),plugins:[react(),tailwind()],
      server:{host:'127.0.0.1',port:0,fs:{allow:[root]}},logLevel:'error',
    });
    await app.listen();
    await presence.listen();
    const appAddress=app.httpServer?.address(),presenceAddress=presence.httpServer?.address();
    assert.ok(appAddress&&typeof appAddress==='object'&&presenceAddress&&typeof presenceAddress==='object');
    const origin='http://127.0.0.1:'+appAddress.port;
    const fixtureUrl='http://127.0.0.1:'+presenceAddress.port+'/card36c-presence.html';
    const actorCookie=f.browserCookies[0],bootstrapCookie=f.cookies[0];
    assert.ok(actorCookie&&bootstrapCookie);
    assert.equal((await fetch(origin+appPath)).status,200);
    assert.equal((await fetch(origin+'/api/lifecycle/bootstrap',{headers:{cookie:bootstrapCookie}})).status,200,'Vite proxies the fixture session');
    assert.equal((await fetch(fixtureUrl.replace('.html','.tsx'))).status,200,'presence fixture must compile in Vite');
    const b=await launchSystemBrowser({url:origin+appPath+'?range=all',width:1440,height:900,cookies:[{...actorCookie,url:origin}]});
    assert.ok(b);
    browser=b;
    browserVersion=await b.command('Browser.getVersion');
    await b.command('Page.bringToFront');
    const captureFilmstrip=createFilmstripCapture(b,directory);
    const measure=async(name:string,selector:string,duration:string,easing:string,properties:string[],options?:Parameters<typeof assertMotion>[4])=>{
      const measured=await assertMotion(b,selector,duration,easing,options);
      exactProperties(measured,properties);
      measurements[name]=measured;
    };
    const check=async(name:string,run:()=>Promise<void>)=>{
      await t.test(name,async()=>{
        try{await run();results[name]='PASS';}
        catch(error){results[name]='FAIL';throw error;}
      });
    };
    const navigate=async(path:string)=>{
      await b.evaluate('window.__card36cPreviousDocument=true');
      await b.command('Page.navigate',{url:origin+path});
      await b.waitFor('!window.__card36cPreviousDocument&&Boolean(document.querySelector("[data-realtime-status=live]"))');
    };
    const board=async(mode:'slow'|'off'|null=null,height=900)=>{
      await b.command('Emulation.setDeviceMetricsOverride',{width:1440,height,deviceScaleFactor:1,mobile:false});
      await navigate(appPath+'?range=all'+(mode?'&motion='+mode:''));
      await b.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});
      // Wait for all three columns to finish loading past 35A TicketCardSkeleton placeholders (which also carry .ticket-card).
      await b.waitFor(`
        document.fonts.status==='loaded'&&
        document.querySelectorAll('.board-column .ticket-card[data-item-id]').length>=7&&
        ['pending','active','handled'].every(column=>{
          const section=document.querySelector('.board-column.'+column);
          return Boolean(section&&/^\\d+$/.test(section.querySelector('.ds-stage-count')?.textContent?.trim()??'')&&
            !section.querySelector('[data-loading-status],.ds-ticket-skeleton,[data-refreshing]'));
        })
      `);
      if(mode)await b.waitFor(`document.documentElement.dataset.motion===${JSON.stringify(mode)}`);
    };
    const overlayClosed=()=>b.waitFor('!'+q(panel));
    const settleOverlay=()=>waitForAnimationsSettled(b,backdrop);
    const close=async()=>{await escape(b);await overlayClosed();await waitForAnimationsSettled(b);};
    const click=async(selector:string)=>{
      await b.evaluate(`(()=>{const node=${q(selector)};if(!node||node.disabled)throw Error('Control unavailable: '+${JSON.stringify(selector)});node.focus({preventScroll:true});node.click();})()`);
    };
    const open=async(id:string)=>{await clickWorkbenchControl(b,openControl(id));await b.waitFor('Boolean('+q(heading)+')');await settleOverlay();};
    const expandLane=async(lane:string)=>{
      const expander='.board-column.'+lane+' [data-action=expand-column][aria-expanded=false]';
      if(await b.evaluate('Boolean('+q(expander)+')'))await clickWorkbenchControl(b,expander);
      await waitForAnimationsSettled(b,'.board-column.'+lane);
    };
    const visibleActive=async()=>{
      const read=()=>b.evaluate(`(()=>{
        const cards=[...document.querySelectorAll('.board-column.active .ticket-card[data-item-id]')];
        const visibleTicket=card=>card?.dataset.kind==='ticket'&&card.checkVisibility()&&card.getBoundingClientRect().height>0;
        const first=cards.findIndex((card,index)=>visibleTicket(card)&&visibleTicket(cards[index+1]));
        return first<0?[]:[cards[first].dataset.itemId,cards[first+1].dataset.itemId];
      })()`);
      let ids:unknown=await read();
      if(!Array.isArray(ids)||ids.length<2){await expandLane('active');ids=await read();}
      assert.ok(Array.isArray(ids)&&typeof ids[0]==='string'&&typeof ids[1]==='string','fixture needs two adjacent active tickets');
      return [ids[0],ids[1]] as const;
    };
    const waitEffect=(selector:string,subtree=false)=>b.waitFor(effect(selector,subtree),{timeoutMs:5000,intervalMs:8});
    const checkDrawerSync=async()=>{
      await b.evaluate(frames);
      const startTimes=await b.evaluate(`[
        ${q(panel)}.getAnimations().find(a=>a.transitionProperty==='opacity')?.startTime,
        ${q(backdrop)}.getAnimations().find(a=>a.transitionProperty==='opacity')?.startTime,
      ]`) as (number|null)[];
      assert.ok(typeof startTimes[0]==='number'&&typeof startTimes[1]==='number');
      assert.equal(startTimes[0],startTimes[1],'panel and backdrop opacity start on the same timeline frame');
    };

    await check('C5.1 drawer and backdrop enter/exit token timing, selected source and full-page fade',async()=>{
      await board();
      await waitForAnimationsSettled(b);
      const [id]=await visibleActive();
      await freeze(b,async()=>{
        await clickWorkbenchControl(b,openControl(id));await waitEffect(panel);await waitEffect(backdrop);
        await measure('drawer-enter',panel,'--dur-slow','--ease-soft',['transform','opacity']);
        await measure('backdrop-enter',backdrop,'--dur-slow','--ease-soft',['opacity']);
        await checkDrawerSync();
      });
      await b.waitFor('Boolean('+q(heading)+')');await settleOverlay();
      assert.equal(await b.evaluate(q(boardCard(id))+'?.classList.contains("is-selected")'),true);
      await freeze(b,async()=>{
        await escape(b);await waitEffect(panel);await waitEffect(backdrop);
        await measure('drawer-exit',panel,'--dur-base','--ease-exit',['transform','opacity']);
        await measure('backdrop-exit',backdrop,'--dur-base','--ease-exit',['opacity']);
        await checkDrawerSync();
      });
      await overlayClosed();
      await open(id);
      const page='.detail-page .ds-detail-view';
      await freeze(b,async()=>{
        await clickWorkbenchControl(b,'[aria-label="展开完整页面"]');await waitEffect(page);
        await measure('full-page',page,'--dur-fast','--ease-standard',['opacity']);
      });
    });

    await check('C5.1 body next exit/enter token timing and stable toolbar',async()=>{
      await board();
      await waitForAnimationsSettled(b);
      const [first,second]=await visibleActive();
      await open(second);await close(); // Prime the target via its real route so 35A never substitutes a skeleton.
      await open(first);
      const toolbarAtRest=await b.evaluate(`(()=>{const bar=${q(toolbar)};window.__card36cToolbar=bar;return bar.getBoundingClientRect().toJSON();})()`);
      await freeze(b,async()=>{
        await click(next);await waitEffect(exitBody);await waitEffect(enterBody);
        await measure('body-exit',exitBody,'--dur-fast','--ease-exit',['transform','opacity']);
        await measure('body-enter',enterBody,'--dur-base','--ease-standard',['transform','opacity']);
        assert.equal(await b.evaluate(q(toolbar)+'===window.__card36cToolbar&&'+q(toolbar)+'.getAnimations().length===0'),true);
        const directions=await b.evaluate(`(()=>{const offset=(selector,index)=>new DOMMatrixReadOnly(document.querySelector(selector).getAnimations()[0].effect.getKeyframes().at(index).transform).m42;return [offset(${JSON.stringify(exitBody)},-1),offset(${JSON.stringify(enterBody)},0),parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--shift-md'))];})()`) as number[];
        assert.deepEqual(directions,[-Number(directions[2]),Number(directions[2]),Number(directions[2])]);
      });
      await settleOverlay();
      assert.deepEqual(await b.evaluate(q(toolbar)+'.getBoundingClientRect().toJSON()'),toolbarAtRest);
    });

    await check('C5.2 last-viewed card alone receives the cue after scrolling into view',async()=>{
      await board();
      await waitForAnimationsSettled(b);
      const [first,second]=await visibleActive();
      const a=boardCard(first),bCard=boardCard(second);
      const secondBottom=Number(await b.evaluate(q(bCard)+'.getBoundingClientRect().bottom'));
      assert.ok(secondBottom>344,'fixture must leave room for a clipped second card');
      await b.command('Emulation.setDeviceMetricsOverride',{width:1440,height:Math.min(900,Math.floor(secondBottom-24)),deviceScaleFactor:1,mobile:false});
      await open(first);
      await click(next);
      await b.waitFor('location.pathname.endsWith('+JSON.stringify('/'+second)+')&&Boolean('+q(heading)+')');
      await settleOverlay();
      // Use the real board overflow, including any clipped column and the sticky topbar.
      const state=await b.evaluate(`(()=>{
        const a=${q(a)},b=${q(bCard)};
        const box=()=>{let top=Math.max(0,document.querySelector('.topbar')?.getBoundingClientRect().bottom??0),bottom=innerHeight;
          for(let node=b.parentElement;node;node=node.parentElement)if(/^(auto|scroll|overlay)$/.test(getComputedStyle(node).overflowY)&&node.scrollHeight>node.clientHeight){
            const rect=node.getBoundingClientRect();top=Math.max(top,rect.top);bottom=Math.min(bottom,rect.bottom);
          }
          const rect=b.getBoundingClientRect();return {inView:rect.top>=top-1&&rect.bottom<=bottom+1,top,bottom,cardTop:rect.top,cardBottom:rect.bottom};
        };
        const cues=[];const observer=new MutationObserver(changes=>{for(const {target} of changes)if(target.dataset.returnCue==='true')cues.push({which:target===a?'A':'B',...box()});});
        for(const node of [a,b])observer.observe(node,{attributes:true,attributeFilter:['data-return-cue']});
        window.__card36cReturn={cues,stop:()=>observer.disconnect()};return box();
      })()`) as {inView:boolean};
      assert.equal(state.inView,false,'B must start outside the visible board area: '+JSON.stringify(state));
      await escape(b);await overlayClosed();
      await b.waitFor(q(bCard+cue)+'!==null');
      await measure('return-cue',bCard+cue,'--dur-return','--ease-standard',['background-color']);
      await waitForAnimationsSettled(b,bCard);
      const observations=await b.evaluate('window.__card36cReturn.stop();window.__card36cReturn.cues') as {which:string;inView:boolean}[];
      assert.deepEqual(observations.map(({which,inView})=>({which,inView})),[{which:'B',inView:true}],JSON.stringify(observations));
    });

    await check('C5.3 slow Esc reverses from the current drawer pose and restores source focus',async()=>{
      await board('slow');
      await waitForAnimationsSettled(b);
      const [id]=await visibleActive(),source=openControl(id);
      const pose=`(()=>{const node=${q(panel)};if(!node)return null;const style=getComputedStyle(node);return {x:new DOMMatrixReadOnly(style.transform).m41,opacity:Number(style.opacity),exiting:node.hasAttribute('data-exiting')};})()`;
      const after=await freeze(b,async()=>{
        await clickWorkbenchControl(b,source);await waitEffect(panel);await waitEffect(backdrop);
        // Hold a real intermediate pose before sending trusted Esc. Polling a narrow opacity
        // window can miss it entirely while a slow runner mounts the cold drawer content.
        await b.evaluate(`(()=>{for(const selector of ${JSON.stringify([panel,backdrop])})for(const animation of document.querySelector(selector).getAnimations())animation.currentTime=Number(animation.effect.getComputedTiming().duration)*.1;})()`);
        await b.evaluate(frames);
        const before=await b.evaluate(pose) as {x:number;opacity:number};
        assert.ok(before.opacity>=.38&&before.opacity<=.68,JSON.stringify(before));
        await escape(b);
        await b.waitFor(q(panel)+'?.hasAttribute("data-exiting")',{intervalMs:8,timeoutMs:1500});
        const current=await b.evaluate(pose) as {x:number;opacity:number;exiting:boolean};
        assert.ok(current.exiting&&current.opacity>0&&current.opacity<1&&current.x>0,JSON.stringify({before,after:current}));
        assert.ok(Math.abs(current.x-before.x)<=3&&Math.abs(current.opacity-before.opacity)<=.12,'exit start jumped: '+JSON.stringify({before,after:current}));
        return current;
      });
      const samples=await b.evaluate(`(async()=>{const samples=[];while(samples.length<120){await new Promise(requestAnimationFrame);const pose=${pose};if(!pose)break;samples.push(pose);}return samples;})()`) as {x:number;opacity:number}[];
      let previous=after;
      for(const sample of samples){
        assert.ok(sample.x>=previous.x-.25&&sample.opacity<=previous.opacity+.015,'exit pose must move monotonically: '+JSON.stringify({previous,sample}));
        previous={...sample,exiting:true};
      }
      assert.ok(samples.length>=2&&previous.x>after.x&&previous.opacity<after.opacity,'must observe real closing progress');
      await overlayClosed();
      await b.waitFor('document.activeElement==='+q(source),{timeoutMs:3000});
    });

    const checkNextBurst=async(interleave:boolean)=>{
      await board('slow',420);
      for(const lane of ['pending','active'])await expandLane(lane);
      await waitForAnimationsSettled(b);
      const sequence=await b.evaluate(`[...document.querySelectorAll('.board-column:is(.pending,.active) .ticket-card[data-item-id]')].filter(card=>card.checkVisibility()&&card.getBoundingClientRect().height>0).map(card=>({id:card.dataset.itemId,title:card.querySelector('.card-open h3')?.textContent.trim()??card.querySelector('.card-open')?.textContent.trim()}))`) as {id:string;title:string}[];
      const first=sequence[0],sixth=sequence[5];
      assert.ok(first&&sixth&&sequence[6],'the sixth item must still have an enabled next control');
      await open(first.id);
      const initialPosition=String(await b.evaluate(q(position)+'.textContent'));
      assert.match(initialPosition,/^1 \/ \d+$/u);
      await b.evaluate(`${q(scrollBody)}.scrollTop=${q(scrollBody)}.scrollHeight`);
      assert.ok(Number(await b.evaluate(q(scrollBody)+'.scrollTop'))>0,'start the burst with the drawer scrolled');
      const burst=await b.evaluate(`(async()=>{
        const button=${q(next)},stage=${q(stage)},counter=${q(position)};
        button.focus({preventScroll:true});
        const counts=[],presses=[];
        let buttonDisabled=false,finishedAt=null,timer;
        const sample=()=>counts.push(stage.getAnimations({subtree:true}).filter(a=>a.effect?.target?.matches('[data-detail-body-enter],[data-detail-body-exit]')&&a.effect.getKeyframes().some(f=>'transform' in f)).length);
        const press=()=>{
          if(button.disabled){buttonDisabled=true;clearInterval(timer);return;}
          presses.push(performance.now());
          button.click();
          if(presses.length===5)clearInterval(timer);
        };
        const start=performance.now();
        try{
          sample();
          // Generate the <=200ms input burst in one task, independent of runner timer drift.
          // A second pass retains the 40ms cadence to exercise cancellation across React commits.
          if(${interleave}){timer=setInterval(press,40);press();}
          else for(let index=0;index<5;index++){press();sample();}
          for(let now=await new Promise(requestAnimationFrame);now-start<3000;now=await new Promise(requestAnimationFrame)){
            sample();
            if(buttonDisabled)break;
            if(presses.length===5&&parseInt(counter.textContent,10)===6&&finishedAt===null)finishedAt=now;
            if(finishedAt!==null&&now-finishedAt>=200)break;
          }
        }finally{clearInterval(timer);}
        return {counts,presses,buttonDisabled,focus:document.activeElement===button};
      })()`) as {counts:number[];presses:number[];buttonDisabled:boolean;focus:boolean};
      assert.equal(burst.buttonDisabled,false);
      assert.equal(burst.presses.length,5);
      if(!interleave)assert.ok(Number(burst.presses.at(-1))-Number(burst.presses[0])<=200,JSON.stringify(burst.presses));
      const maxConcurrent=Math.max(...burst.counts);
      assert.ok(maxConcurrent>=1&&maxConcurrent<=2,JSON.stringify(burst.counts));
      await b.waitFor(textIs(heading,sixth.title));
      await settleOverlay();
      assert.equal(await b.evaluate(q(position)+'.textContent'),'6'+initialPosition.slice(1));
      assert.equal(await b.evaluate('location.pathname.endsWith('+JSON.stringify('/'+sixth.id)+')'),true);
      assert.equal(await b.evaluate("document.querySelectorAll('[data-detail-body-exit],.ds-detail-body-exit,[data-detail-body-enter]').length"),0);
      assert.equal(await b.evaluate(q(stage)+'.getAnimations({subtree:true}).length'),0);
      assert.equal(await b.evaluate(q(scrollBody)+'.scrollTop'),0);
      assert.ok(burst.focus&&await b.evaluate('document.activeElement==='+q(next)),'focus stays on the enabled next control');
    };
    await check('C5.4 five next presses in 200ms show item six, cap body animations and preserve focus',()=>checkNextBurst(false));
    await check('C5.4 next presses interleaved with rendering cancel old body animations and preserve focus',()=>checkNextBurst(true));

    await check('C5.5 trusted mouse clicks on next at a fixed point land on the button while items switch',async()=>{
      await close();
      await board();
      for(const lane of ['pending','active'])await expandLane(lane);
      await waitForAnimationsSettled(b);
      const ids=await b.evaluate(`[...document.querySelectorAll('.board-column:is(.pending,.active) .ticket-card[data-item-id]')].filter(card=>card.checkVisibility()&&card.getBoundingClientRect().height>0).map(card=>card.dataset.itemId)`) as string[];
      const presses=5;
      assert.ok(ids.length>presses+1,'the loaded range must leave an enabled next control after the burst');
      await open(String(ids[0]));
      await b.waitFor(q('.detail-navigation .ds-drawer-more')+'?.checkVisibility()',{timeoutMs:5000});
      const initialPosition=String(await b.evaluate(q(position)+'.textContent'));
      assert.match(initialPosition,/^1 \/ \d+$/u);
      const point=await b.evaluate(`(()=>{const box=${q(next)}.getBoundingClientRect();return {x:box.x+box.width/2,y:box.y+box.height/2};})()`) as {x:number;y:number};
      // Record what every trusted press hits and how the toolbar moves on every frame of the burst.
      await b.evaluate(`(()=>{
        const log=window.__card36cTrusted={hits:[],shifts:[],stop:false};
        const left=()=>${q(next)}?.getBoundingClientRect().left;
        const origin=left();
        document.addEventListener('pointerdown',event=>log.hits.push(event.target instanceof Element&&Boolean(event.target.closest('.detail-next'))?'next':(event.target instanceof Element?event.target.className||event.target.tagName:'none')),true);
        const frame=()=>{const now=left();if(now!==origin)log.shifts.push(now-origin);if(!log.stop)requestAnimationFrame(frame);};
        requestAnimationFrame(frame);
      })()`);
      for(let press=0;press<presses;press++){
        for(const type of ['mousePressed','mouseReleased'])await b.command('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,x:point.x,y:point.y});
        await b.evaluate('new Promise(resolve=>setTimeout(resolve,40))');
      }
      await b.waitFor('window.__card36cTrusted.hits.length==='+presses,{timeoutMs:5000});
      await b.waitFor(q(heading)+'&&'+q('.detail-navigation .ds-drawer-more')+'?.checkVisibility()',{timeoutMs:5000});
      await settleOverlay();
      const log=await b.evaluate('(()=>{const log=window.__card36cTrusted;log.stop=true;return {hits:log.hits,shifts:log.shifts};})()') as {hits:string[];shifts:number[]};
      assert.deepEqual(log.hits,Array(presses).fill('next'),'every trusted press lands on 下一项');
      assert.deepEqual(log.shifts,[],'the navigation controls keep their place while the next item loads');
      await b.waitFor(q(position)+'.textContent==='+JSON.stringify(String(presses+1)+initialPosition.slice(1)),{timeoutMs:5000});
      await b.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});
    });

    const [actorCookieHeader,chenCookie,zhouCookie,shenCookie]=f.cookies;
    assert.ok(actorCookieHeader&&chenCookie&&zhouCookie&&shenCookie);
    const actor=session(f.origin,actorCookieHeader),chen=session(f.origin,chenCookie);
    const zhou=session(f.origin,zhouCookie),shen=session(f.origin,shenCookie);
    const target=f.tickets[5]?.ticket;
    assert.ok(target,'fixture needs the in-progress ticket for presence and timeline writes');
    const snapshots=async()=>{
      const readPeople=async(count:number)=>{
        const response=await actor.post('/api/workbench/activity/batch-view',{schema_version:1,targets:[{kind:'ticket',id:target.id}]});
        assert.ok(Array.isArray(response.items));
        const people=response.items.length?object(response.items[0]).people:[];
        assert.ok(Array.isArray(people)&&people.length===count,JSON.stringify({count,actual:Array.isArray(people)?people.length:null}));
        return people;
      };
      await zhou.presence(target.id,'VIEWING');const viewing=await readPeople(1);
      await zhou.presence(target.id,null);const absent=await readPeople(0);
      await zhou.presence(target.id,'EDITING');const editing=await readPeople(1);
      await chen.presence(target.id,'VIEWING');await shen.presence(target.id,'VIEWING');
      const three=await readPeople(3);
      // A single peer can edit this item. Replay one additional view-only identity from
      // this same fixture to exercise 3→4 without changing production presence limits.
      const four=[...three,{...object(viewing[0]),display_name:'第四位同事（合成）'}];
      // RELEASE advances the activity generation, so a parallel release can invalidate another peer's authority check.
      for(const peer of [zhou,chen,shen])await peer.presence(target.id,null);
      await readPeople(0);
      return {absent,viewing,editing,three,four};
    };
    // Read the real peer snapshots lazily so a fixture/transport failure is specific to its consumers.
    let people:ReturnType<typeof snapshots>|undefined;
    const input=()=>people??=snapshots();
    const presencePage=async(off=false)=>{
      await b.command('Page.navigate',{url:fixtureUrl+(off?'?motion=off':'')});
      await b.waitFor('typeof window.setCard36cPeople==="function"&&document.fonts.status==="loaded"');
      await b.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});
      if(off)await b.waitFor('document.documentElement.dataset.motion==="off"');
    };
    const supply=(snapshot:unknown)=>b.evaluate('window.setCard36cPeople('+JSON.stringify(snapshot)+')');
    const waitNoTag=()=>b.waitFor('!'+q(tag));

    await check('C5.1/C5.5 presence enter/exit timing and 200ms/500ms same-person reappearance',async()=>{
      const {viewing,absent}=await input();
      await presencePage();
      await freeze(b,async()=>{
        await supply(viewing);await waitEffect(tag);
        await measure('presence-enter',tag,'--dur-fast','--ease-standard',['transform','opacity']);
        // The card outline's box-shadow is the explicit D4 CSS transition exception.
        await measure('presence-outline-enter',presenceCard,'--dur-fast','--ease-standard',['box-shadow'],{cssExceptions:['boxShadow']});
      });
      await waitForAnimationsSettled(b,presenceCard);
      const short=await b.evaluate(`(async()=>{
        const node=${q(tag)},card=${q(presenceCard)},motion=[];
        node.dataset.card36cIdentity='original';
        const remember=event=>{if(event.target===node)motion.push(event.propertyName??event.animationName);};
        for(const name of ['transitionrun','animationstart'])card.addEventListener(name,remember);
        const start=performance.now();
        window.setCard36cPeople(${JSON.stringify(absent)});
        await new Promise(resolve=>setTimeout(resolve,200));
        const elapsed=performance.now()-start;
        const sameWhileAway=${q(tag)}===node&&node.isConnected;
        window.setCard36cPeople(${JSON.stringify(viewing)});
        await ${frames};
        for(const name of ['transitionrun','animationstart'])card.removeEventListener(name,remember);
        return {elapsed,sameWhileAway,same:${q(tag)}===node,identity:${q(tag)}?.dataset.card36cIdentity,motion};
      })()`) as {elapsed:number;sameWhileAway:boolean;same:boolean;identity:string;motion:string[]};
      assert.ok(short.elapsed>=200&&short.elapsed<300,JSON.stringify(short));
      assert.deepEqual({sameWhileAway:short.sameWhileAway,same:short.same,identity:short.identity,motion:short.motion},{sameWhileAway:true,same:true,identity:'original',motion:[]});

      // Set the precise 500ms reappearance timer in the browser. Capture the actual exit
      // while still mounted, independently of whether Node's next CDP command arrives late.
      await b.evaluate(`(()=>{
        const start=performance.now(),node=${q(tag)},gone=[];
        const observer=new MutationObserver(()=>{if(!node.isConnected)gone.push(performance.now()-start);});
        observer.observe(${q(presenceCard)},{subtree:true,childList:true});
        window.__card36cReappearance=new Promise(resolve=>setTimeout(()=>{
          const removed=!node.isConnected,elapsed=performance.now()-start;observer.disconnect();
          window.setCard36cPeople(${JSON.stringify(viewing)});
          resolve({removed,elapsed,gone:gone[0]??null,same:${q(tag)}===node,identity:${q(tag)}?.dataset.card36cIdentity??null});
        },500));
        window.setCard36cPeople(${JSON.stringify(absent)});
      })()`);
      const exiting=tag+'[data-presence-state=exiting]';
      await waitEffect(exiting);
      await measure('presence-exit',exiting,'--dur-fast','--ease-exit',['transform','opacity']);
      const long=await b.evaluate('window.__card36cReappearance') as {removed:boolean;elapsed:number;gone:number|null;same:boolean;identity:string|null};
      assert.ok(long.elapsed>=500&&long.removed&&long.gone!==null&&long.gone>=300&&long.gone<=long.elapsed,JSON.stringify(long));
      assert.equal(long.same,false);assert.equal(long.identity,null);
      await waitEffect(tag);
      await measure('presence-reenter',tag,'--dur-fast','--ease-standard',['transform','opacity']);
    });

    await check('C5.1/C5.6 view↔edit animates colour only on the same tag and +N rolls',async()=>{
      const {viewing,editing,three,four}=await input();
      await presencePage();
      await supply(viewing);await waitForAnimationsSettled(b,presenceCard);
      await b.evaluate('window.__card36cTag='+q(tag)+';true');
      for(const [mode,snapshot,colour] of [['edit',editing,'--presence-editing'],['view',viewing,'--brand']] as const){
        await freeze(b,async()=>{
          await supply(snapshot);await waitEffect(tag);
          // D4 expressly uses a background-color transition for changes of mode.
          await measure('presence-'+mode+'-colour',tag,'--dur-base','--ease-standard',['background-color'],{cssExceptions:['backgroundColor']});
          await measure('presence-'+mode+'-outline',presenceCard,'--dur-base','--ease-standard',['box-shadow'],{cssExceptions:['boxShadow']});
          assert.equal(await b.evaluate(q(tag)+'===window.__card36cTag&&'+q(tag)+'.dataset.presenceState==="present"'),true);
          if(mode==='edit')await measure('presence-pencil',tag+' [data-presence-pencil-enter=true]','--dur-base','--ease-standard',['opacity']);
        });
        await waitForAnimationsSettled(b,presenceCard);
        assert.equal(await b.evaluate(`(()=>{const node=${q(tag)},probe=document.createElement('i');probe.style.backgroundColor='var(${colour})';document.body.append(probe);const target=getComputedStyle(probe).backgroundColor;probe.remove();return getComputedStyle(node).backgroundColor===target;})()`),true);
      }
      await supply(three);await waitForAnimationsSettled(b,presenceCard);
      assert.equal(await b.evaluate(q(more)+'.dataset.presenceMore'),'2');
      await freeze(b,async()=>{
        await supply(four);await waitEffect(roll,true);
        await measure('presence-number-roll',roll,'--dur-base','--ease-standard',['transform','opacity'],{subtree:true});
        assert.equal(await b.evaluate(q(more)+'.dataset.presenceMore'),'3');
      });
      await waitForAnimationsSettled(b,presenceCard);
      assert.equal(await b.evaluate(`(()=>{const next=${q(roll+' .ds-number-roll-next')};return next.getAttribute('data-value')??next.textContent;})()`),'3');
    });

    const note=async(writer:ReturnType<typeof session>,message:string)=>{
      const path='/api/tickets/'+target.id,current=await writer.read(path);
      const commandId=randomUUID(),version=current.version;
      assert.equal(typeof version,'number');
      return writer.post(path+'/internal-notes',{
        client_command_id:commandId,expected_version:version,reason_code:'WORKBENCH_INTERNAL_NOTE',note:message,external_visible:false,
      },{'idempotency-key':commandId,'if-match':'"'+version+'"'});
    };
    const noteSelector=async(message:string)=>{
      const expression=`[...document.querySelectorAll(${JSON.stringify('.activity-list '+record)})].find(node=>node.textContent.includes(${JSON.stringify(message)}))?.dataset.recordId`;
      await b.waitFor('Boolean('+expression+')',{timeoutMs:8000,intervalMs:8});
      const id=await b.evaluate(expression);assert.equal(typeof id,'string');
      return '[data-record-id='+JSON.stringify(id)+']';
    };
    const activeTimeline=async()=>{
      await board();
      await expandLane('active');
      await open(target.id);
      await b.waitFor('Boolean('+q('.activity-list '+record)+')');
    };
    const lookAtTimeline=async()=>{
      await settleOverlay();
      await b.evaluate(`(()=>{const node=${q(timeline)},body=${q(scrollBody)};body.scrollTop+=node.getBoundingClientRect().top-body.getBoundingClientRect().top-12;})()`);
      await settleOverlay();
      assert.equal(await b.evaluate(`(()=>{const node=${q(timeline)},body=${q(scrollBody)};const top=node.getBoundingClientRect().top,view=body.getBoundingClientRect();return top>=view.top-1&&top<view.bottom;})()`),true);
    };

    await check('C5.7 timeline initial, older page and item switch have no arrival motion',async()=>{
      // Card 34B detail/record path, with just over the real API page size pre-seeded.
      const colleague=f.principals[2];assert.ok(colleague);
      for(let index=0;index<52;index++){
        await appendTicketEvent({transaction:f.pool,ticket:target,eventType:'ticket.note_added',oldStatus:target.status,
          actor:{type:'PILOT_USER',id:colleague.id},internalNote:'卡 36C 历史记录 '+index+'（合成）',traceId:'card36c-older-'+index});
      }
      await board();
      await expandLane('active');
      await watchTimeline(b);await open(target.id);
      const earlier='[data-action=view-earlier-records]';
      await b.waitFor('Boolean('+q(earlier)+')');
      const count=await b.evaluate('document.querySelectorAll(".activity-list [data-record-id]").length');
      assert.equal(typeof count,'number');
      await clickWorkbenchControl(b,earlier);
      await b.waitFor(`document.querySelectorAll('.activity-list [data-record-id]').length>${Number(count)}`);
      await settleOverlay();
      await click(next);
      await b.waitFor('!location.pathname.endsWith('+JSON.stringify('/'+target.id)+')&&Boolean('+q(detailView+' .activity-list '+record)+')');
      await settleOverlay();
      assert.deepEqual(await b.evaluate('window.__stopTimeline()'),[]);
    });

    await check('C5.1/C5.7 colleague arrival enters then highlights intake; own note is static',async()=>{
      await activeTimeline();
      await lookAtTimeline();
      const incoming='同事新增的处理记录（合成）';
      let node='';
      await freeze(b,async()=>{
        await note(zhou,incoming);node=await noteSelector(incoming);
        await waitEffect(node+timelineEnter);
        assert.equal(await b.evaluate('Boolean('+q(node+timelineHighlight)+')'),false,'highlight starts after entry');
        await measure('timeline-entry',node+timelineEnter,'--dur-base','--ease-standard',['transform','opacity']);
      });
      await waitEffect(node+timelineHighlight);
      await measure('timeline-highlight',node+timelineHighlight,'--dur-highlight','--ease-standard',['background-color']);
      const intake=await b.evaluate(`(()=>{const element=${q(node)},probe=document.createElement('i');probe.style.backgroundColor='var(--stage-intake-bg)';document.body.append(probe);const value=getComputedStyle(probe).backgroundColor;probe.remove();return element.getAnimations().some(a=>a.effect.getKeyframes()[0]?.backgroundColor===value);})()`);
      assert.equal(intake,true,'highlight starts at the intake background token');
      await settleOverlay();
      await watchTimeline(b);
      const own='我的内部备注（合成）';
      await clickWorkbenchControl(b,'#internal-note');
      await b.command('Input.insertText',{text:own});
      await clickWorkbenchControl(b,'[data-action=save-internal-note]');
      await noteSelector(own);
      await settleOverlay();
      assert.deepEqual(await b.evaluate('window.__stopTimeline()'),[]);
      assert.equal(await b.evaluate('Boolean('+q(chip)+')'),false);
    });

    await check('C5.7 offscreen arrival preserves the reading position and both reveal paths highlight it',async()=>{
      await activeTimeline();
      await settleOverlay();
      await b.evaluate(`${q(scrollBody)}.scrollTop=${q(scrollBody)}.scrollHeight/2`);
      await settleOverlay();
      const before=await b.evaluate(`(()=>{
        const body=${q(scrollBody)},section=body.querySelector(${JSON.stringify(timeline)});
        const bodyTop=body.getBoundingClientRect().top+body.clientTop;
        const bodyBottom=bodyTop+body.clientHeight;
        const anchor=[...section.querySelectorAll(${JSON.stringify(record)})].find(row=>{
          const bounds=row.getBoundingClientRect();
          return bounds.height>0&&bounds.top>=bodyTop&&bounds.bottom<=bodyBottom;
        });
        return {id:anchor?.dataset.recordId??null,top:anchor?.getBoundingClientRect().top??null,timelineTop:section.getBoundingClientRect().top,bodyTop};
      })()`) as {id:string|null;top:number|null;timelineTop:number;bodyTop:number};
      assert.ok(before.id&&before.top!==null&&before.timelineTop<before.bodyTop-1,JSON.stringify(before));
      const anchor='[data-record-id='+JSON.stringify(before.id)+']';
      const incoming='滚动时同事新增的处理记录（合成）';
      await watchTimeline(b);
      await note(zhou,incoming);
      const node=await noteSelector(incoming);
      await b.waitFor(textIs(chip,'↑ 1 条新记录'));
      await settleOverlay();
      const after=await b.evaluate(`(()=>{
        const body=${q(scrollBody)},section=body.querySelector(${JSON.stringify(timeline)});
        return {scroll:body.scrollTop,top:section.querySelector(${JSON.stringify(anchor)})?.getBoundingClientRect().top??null,timelineTop:section.getBoundingClientRect().top,bodyTop:body.getBoundingClientRect().top+body.clientTop};
      })()`) as {scroll:number;top:number|null;timelineTop:number;bodyTop:number};
      // Browser scroll anchoring may adjust scrollTop to compensate for a row inserted above the reader.
      assert.ok(after.top!==null&&Math.abs(after.top-before.top)<=1,JSON.stringify({before,after}));
      assert.ok(after.timelineTop<after.bodyTop-1,'arrival leaves the timeline top above the viewport');
      assert.deepEqual(await b.evaluate('window.__stopTimeline()'),[]);
      const chipStyle=object(await b.evaluate(`(()=>{
        const style=getComputedStyle(${q(chip)});
        return {radius:style.borderRadius,height:style.height,
          radiusToken:style.getPropertyValue('--radius-lg').trim(),heightToken:style.getPropertyValue('--space-6').trim()};
      })()`));
      assert.equal(chipStyle.radius,chipStyle.radiusToken,'the timeline chip uses --radius-lg');
      assert.equal(chipStyle.height,chipStyle.heightToken,'the timeline chip uses --space-6');
      // Inspect hit testing before using the click helper (which intentionally scrolls
      // controls into view). The chip must be actionable from the current reading position.
      const point=await b.evaluate(`(()=>{const button=${q(chip)},box=button.getBoundingClientRect(),x=box.x+box.width/2,y=box.y+box.height/2;return {x,y,hit:button.contains(document.elementFromPoint(x,y))};})()`) as {x:number;y:number;hit:boolean};
      assert.equal(point.hit,true,'the new-record chip is visible and clickable at the preserved scroll position');
      for(const type of ['mousePressed','mouseReleased'])await b.command('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,x:point.x,y:point.y});
      await b.waitFor('Boolean('+q(node+timelineHighlight)+')',{intervalMs:8,timeoutMs:5000});
      await settleOverlay();
      await b.waitFor('!'+q(chip));
      assert.equal(await b.evaluate('Boolean('+q(chip)+')'),false);
      const revealed=await b.evaluate(`({scroll:${q(scrollBody)}.scrollTop,offset:${q(timeline)}.getBoundingClientRect().top-${q(scrollBody)}.getBoundingClientRect().top})`) as {scroll:number;offset:number};
      assert.ok(revealed.scroll<after.scroll&&Math.abs(revealed.offset)<=2,JSON.stringify(revealed));

      // A fresh arrival exercises the scroll-listener path without clicking the chip again.
      await b.evaluate(`${q(scrollBody)}.scrollTop=${after.scroll}`);
      await settleOverlay();
      assert.equal(await b.evaluate(`${q(timeline)}.getBoundingClientRect().top<${q(scrollBody)}.getBoundingClientRect().top-1`),true);
      const second='读者自行滚回时发现的处理记录（合成）';
      await note(zhou,second);
      const secondNode=await noteSelector(second);
      await b.waitFor(textIs(chip,'↑ 1 条新记录'));
      await settleOverlay();
      assert.equal(await b.evaluate('Boolean('+q(secondNode+timelineHighlight)+')'),false);
      await b.evaluate(`(()=>{
        let changes=0;
        const observer=new MutationObserver(mutations=>{changes+=mutations.length;});
        observer.observe(${q(secondNode)},{attributes:true,attributeFilter:['data-timeline-entry-highlight']});
        window.__stopCard36cHighlight=()=>{changes+=observer.takeRecords().length;observer.disconnect();return changes;};
      })()`);
      await lookAtTimeline();
      await b.waitFor('!'+q(chip));
      await b.evaluate(`${q(scrollBody)}.scrollTop=${after.scroll}`);
      await settleOverlay();
      await lookAtTimeline();
      assert.equal(await b.evaluate('Boolean('+q(chip)+')'),false);
      assert.equal(await b.evaluate('Boolean('+q(secondNode+timelineHighlight)+')'),false);
      assert.equal(await b.evaluate('window.__stopCard36cHighlight()'),2,'scrolling back sets and clears the highlight marker once');
    });

    const emulate=(value:'reduce'|'no-preference')=>b.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value}]});
    const opacityOnly=async(selector:string)=>{
      await assertNoTransformAnimations(b,selector);
      const observed=await b.evaluate(`(()=>{
        const node=${q(selector)},root=getComputedStyle(document.documentElement);
        const limit=root.getPropertyValue('--dur-fast').trim();
        const ms=parseFloat(limit)*(limit.endsWith('ms')?1:1000);
        const animations=node.getAnimations();
        return {count:animations.length,ok:animations.every(a=>{
          const effect=a.effect,props=effect.getKeyframes().flatMap(f=>Object.keys(f)).filter(k=>!['offset','computedOffset','easing','composite'].includes(k));
          return Number(effect.getTiming().duration)<=ms&&props.length>0&&props.every(k=>k==='opacity');
        })};
      })()`) as {count:number;ok:boolean};
      assert.ok(observed.count>0&&observed.ok,selector+' must have opacity-only effects at most --dur-fast '+JSON.stringify(observed));
    };
    for(const mode of ['CDP reduce','?motion=off'] as const){
      await check('C5.8 '+mode+' drawer opacity, static body, opacity name tags and held cue',async()=>{
        try{
          await emulate(mode==='CDP reduce'?'reduce':'no-preference');
          await board(mode==='?motion=off'?'off':null);
          assert.equal(await b.evaluate("document.documentElement.hasAttribute('data-motion-reduced')"),true);
          await waitForAnimationsSettled(b);
          const [first,second]=await visibleActive();
          const card=boardCard(second),marked=card+cue;
          const secondTitle=await b.evaluate(q(card+' h3')+'.textContent.trim()');
          assert.ok(typeof secondTitle==='string'&&secondTitle.length>0);
          const baseColour=await b.evaluate('getComputedStyle('+q(card)+').backgroundColor');
          await freeze(b,async()=>{
            await clickWorkbenchControl(b,openControl(first));await waitEffect(panel);
            await opacityOnly(panel);await opacityOnly(backdrop);
          });
          await b.waitFor('Boolean('+q(heading)+')');await settleOverlay();
          await freeze(b,async()=>{
            await click(next);
            // History updates before React commits the new selection and drawer body.
            await b.waitFor('location.pathname.endsWith('+JSON.stringify('/'+second)+')&&'+
              q(card)+'?.classList.contains("is-selected")&&'+textIs(heading,secondTitle));
            await b.evaluate(frames);
            await assertNoTransformAnimations(b,stage);
            assert.equal(await b.evaluate(q(stage)+'.getAnimations({subtree:true}).length'),0);
            assert.equal(await b.evaluate("document.querySelectorAll('[data-detail-body-exit],[data-detail-body-enter]').length"),0);
          });
          // Sample the finite hold in the page so a delayed CDP poll cannot miss it.
          await b.evaluate(`(() => {
            const probe=document.createElement('span');
            probe.style.backgroundColor='var(--brand-subtle)';document.body.append(probe);
            const expected=getComputedStyle(probe).backgroundColor;probe.remove();
            const observer=new MutationObserver(() => {
              const node=${q(marked)};
              if (!node || ${q(panel)}) return;
              observer.disconnect();
              const read=()=>({colour:getComputedStyle(node).backgroundColor,count:node.getAnimations().length,marked:${q(marked)}===node});
              const first=read();
              ${frames}.then(()=>{window.__card36cHeldCue={expected,first,second:read()};});
            });
            window.__card36cHeldCue=null;
            observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['data-return-cue']});
          })()`);
          await freeze(b,async()=>{
            await escape(b);await waitEffect(panel);await opacityOnly(panel);await opacityOnly(backdrop);
          });
          await overlayClosed();
          await b.waitFor('Boolean(window.__card36cHeldCue)');
          const held=await b.evaluate('window.__card36cHeldCue') as {expected:string;first:unknown;second:unknown};
          const expected={colour:held.expected,count:0,marked:true};
          assert.deepEqual(held.first,expected);assert.deepEqual(held.second,expected);
          assert.notEqual(held.expected,baseColour);
          await b.waitFor('!'+q(marked));
          assert.equal(await b.evaluate('getComputedStyle('+q(card)+').backgroundColor'),baseColour);
          const {viewing,absent}=await input();
          await presencePage(mode==='?motion=off');
          await freeze(b,async()=>{
            await supply(viewing);await waitEffect(tag);await opacityOnly(tag);
          });
          await waitForAnimationsSettled(b,tag);
          await supply(absent);
          await waitNoTag();
        }finally{await emulate('no-preference');}
      });
    }

    const save=async(name:string,trigger:()=>Promise<unknown>,selector:string)=>{
      await captureFilmstrip(name,trigger,selector);
      filmstrips.push(name);
    };
    await check('C5.9 drawer-enter filmstrip',async()=>{
      await board();await waitForAnimationsSettled(b);
      const [id]=await visibleActive();
      await open(id);await close();
      await save('drawer-enter',async()=>{await clickWorkbenchControl(b,openControl(id));await waitEffect(panel);},'.detail-dialog,'+backdrop);
    });
    await check('C5.9 drawer-exit filmstrip',async()=>{
      await board();await waitForAnimationsSettled(b);
      const [id]=await visibleActive();await open(id);
      await save('drawer-exit',async()=>{await escape(b);await waitEffect(panel);},'.detail-dialog,'+backdrop);
    });
    await check('C5.9 drawer-return-cue filmstrip',async()=>{
      await board();await waitForAnimationsSettled(b);
      const [id]=await visibleActive();await open(id);
      await save('drawer-return-cue',async()=>{
        await escape(b);await waitEffect(panel);
        // The CDP clock is frozen. Finish only the prerequisite close so the cue can be captured.
        await b.evaluate(`for(const selector of ${JSON.stringify([panel,backdrop])})for(const a of document.querySelector(selector)?.getAnimations()??[])a.finish()`);
        await overlayClosed();await waitEffect(boardCard(id)+cue);
      },boardCard(id));
    });
    await check('C5.9 detail-next filmstrip',async()=>{
      await board();await waitForAnimationsSettled(b);
      const [first,second]=await visibleActive();
      await open(second);await close();await open(first);
      await save('detail-next',async()=>{await click(next);await waitEffect(exitBody);await waitEffect(enterBody);},stage);
    });
    await check('C5.9 timeline-arrival filmstrip',async()=>{
      await activeTimeline();await lookAtTimeline();
      const message='时间线胶片新增记录（合成）';
      await save('timeline-arrival',async()=>{await note(zhou,message);await waitEffect((await noteSelector(message))+timelineEnter);},timelineEnter);
    });
    await check('C5.9 presence-enter filmstrip',async()=>{
      const {viewing}=await input();
      await presencePage();
      await save('presence-enter',async()=>{await supply(viewing);await waitEffect(tag);},presenceCard);
    });
    await check('C5.9 presence-exit filmstrip',async()=>{
      const {viewing,absent}=await input();
      await presencePage();await supply(viewing);await waitForAnimationsSettled(b,presenceCard);
      // Keep the already-exiting tag mounted while captureFilmstrip seeks its real
      // 120ms effects. Defer only the fixture window's exit-retention timeout.
      await b.evaluate(`(()=>{
        const set=window.setTimeout,held=[];
        window.setTimeout=function(callback,delay,...args){
          const exiting=${q(tag+'[data-presence-state=exiting]')};
          if(exiting&&delay===parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dur-fast'))){
            const id=set.call(this,()=>{},10000);held.push({id,callback,args});return id;
          }
          return set.call(this,callback,delay,...args);
        };
        window.__card36cResumeTimers=()=>{window.setTimeout=set;for(const {id,callback,args} of held){clearTimeout(id);set(callback,0,...args);}};
      })()`);
      try{
        await save('presence-exit',async()=>{await supply(absent);await waitEffect(tag+'[data-presence-state=exiting]');},presenceCard);
      }finally{await b.evaluate('window.__card36cResumeTimers()');}
      await waitNoTag();
    });
  }catch(error){failure=error;}
  finally{
    await closeBrowserTestResources([
      async()=>{
        await browser?.close();
        if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});
      },
      async()=>{await presence?.close();},
      async()=>{await app?.close();},
      ()=>rm(cache,{recursive:true,force:true}),
      async()=>{
        await mkdir(directory,{recursive:true});
        await writeFile(join(directory,'card36c-motion-receipt.json'),JSON.stringify({
          os:{platform:platform(),release:release()},browser:browserVersion,
          measurements,filmstrips,results,resources:browser?.ownedResourceState()??null,
          startupError:failure instanceof Error?failure.message:null,
        },null,2)+'\n');
      },
    ],failure);
  }
},options));
