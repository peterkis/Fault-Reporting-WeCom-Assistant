import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {platform,release,tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import {object} from './helpers/t42-board-browser-fixture.mjs';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import type {T11Fixture} from './helpers/t11-completion-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {boardReady,seedMotionTicket} from './helpers/motion-board-fixture.mjs';
import {clickWorkbenchControl,chooseWorkbenchSelect} from './helpers/heroui-workbench-controls.mjs';
import {waitForAnimationsSettled} from './helpers/browser-animations.mjs';
import {assertMotion,type MotionMeasurement} from './helpers/motion-assert.mjs';
import {createFilmstripCapture} from './helpers/motion-filmstrip.mjs';
import {card,person,ticket,q,exists,point,move,hover,escape,navigate,observe,type Browser} from './helpers/card37c-hover-browser.mjs';

const root=process.env.TS_MIGRATION_TEST_SOURCE_ROOT??process.cwd();
const names=['hover-person','hover-person-self','hover-person-offline','hover-ticket','hover-ticket-loading','hover-ticket-denied','hover-edge-flip'];
const delay=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const away={x:2,y:2};
const peerName='周宁（合成）',selfName='林舟（合成）',offlineName='陈悦（合成）';
const owner=(name:string)=>'.board-column .ticket-card .owner[title='+JSON.stringify(name)+']';

async function beginPresence(f:T11Fixture,id:string){
  const cookie=f.cookies[2];assert.ok(cookie);
  const bootstrap=await fetch(f.origin+'/api/lifecycle/bootstrap',{headers:{cookie}});
  assert.equal(bootstrap.status,200);const {csrf_token}=object(await bootstrap.json());assert.ok(typeof csrf_token==='string');
  const controller=new AbortController(),browser_id=randomUUID();
  const stream=await fetch(f.origin+'/api/realtime/events?scope=workbench',{signal:controller.signal,headers:{cookie,accept:'text/event-stream'}});
  assert.equal(stream.status,200);
  const renew=async()=>{
    const response=await fetch(f.origin+'/api/workbench/activity',{method:'POST',headers:{cookie,origin:f.origin,'content-type':'application/json','x-csrf-token':csrf_token},
      body:JSON.stringify({schema_version:1,browser_id,target:{kind:'ticket',id},action:'RENEW',visible:true,active:true,mode:'EDITING',field:'internal-note'})});
    assert.equal(response.status,200,await response.text());
  };
  try{await renew();}catch(e){controller.abort();throw e;}
  let failure:unknown;
  const timer=setInterval(()=>{void renew().catch(e=>{failure=e;});},4000);
  return ()=>{clearInterval(timer);controller.abort();if(failure)throw failure;};
}

test('C4.7 unchanged loaded board publishes once without pointer input',async t=>withWeb01Fixture(async(f:T11Fixture)=>{
  const cookie=f.cookies[0];assert.ok(cookie);
  const bootstrap=await fetch(f.origin+'/api/lifecycle/bootstrap',{headers:{cookie}});assert.equal(bootstrap.status,200);
  const cacheDir=await mkdtemp(join(tmpdir(),'card37c-react-'));
  const server=await createServer({
    root:join(root,'tests/fixtures'),configFile:false,cacheDir,logLevel:'error',oxc:{jsx:{runtime:'automatic'}},
    optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,ws:false},
  });
  const previous=Object.getOwnPropertyDescriptor(globalThis,'IS_REACT_ACT_ENVIRONMENT');
  Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{configurable:true,value:true});
  t.after(async()=>{
    if(previous)Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',previous);else Reflect.deleteProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT');
    await server.close();await rm(cacheDir,{recursive:true,force:true});
  });
  const module=await server.ssrLoadModule('/card37c-board-publication.tsx');
  assert.equal(await module.countBoardPublications(await bootstrap.json()),1,'one stable projection for unchanged board inputs');
},{precisionV212:true}));

test('37C hover-card C4 browser acceptance',{timeout:600000},t=>withWeb01Fixture(async(f:T11Fixture)=>{
  const target=f.tickets[5]?.ticket,offline=f.tickets[8]?.ticket,other=f.principals[1];
  assert.ok(target&&offline&&other);
  await f.pool.query('UPDATE pilot_ticket.ticket SET assignee_id=$1 WHERE id=$2',[other.id,offline.id]);
  const completed=f.tickets[9]?.ticket;assert.ok(completed);
  await f.pool.query("UPDATE pilot_ticket.ticket_event SET created_at=platform.local_now() WHERE ticket_id=$1 AND event_type='ticket.completed'",[completed.id]);
  await f.pool.query("UPDATE pilot_ticket.ticket SET terminal_at=platform.local_now() WHERE id=$1 AND status='COMPLETED'",[completed.id]);
  const cookie=f.cookies[0],actor=f.browserCookies[0];assert.ok(cookie&&actor);
  const result=await fetch(f.origin+'/api/workbench/items/ticket/'+target.id+'?limit=50',{headers:{cookie}});
  assert.equal(result.status,200);
  const raw=object(object(await result.json()).item);
  function field(key:string){const value=raw[key];assert.ok(typeof value==='string'&&value.length>0,key);return value;}
  const item={number:field('number'),title:field('title'),location:field('location'),assignee_name:field('assignee_name')};
  const temp=await mkdtemp(join(tmpdir(),'card37c-vite-'));
  const evidence=process.env.CARD37C_EVIDENCE_DIR??await mkdtemp(join(tmpdir(),'card37c-evidence-'));
  const saved=new Set<string>(),measures:Record<string,MotionMeasurement[]>={};
  let b:Browser|undefined,vite:Awaited<ReturnType<typeof createServer>>|undefined,stopPresence:(()=>void)|undefined,failed:unknown;
  try{
    await mkdir(evidence,{recursive:true});
    vite=await createServer({root:join(root,'tests/fixtures'),configFile:false,cacheDir:temp,logLevel:'error',plugins:[react(),tailwind()],
      server:{host:'127.0.0.1',port:0,fs:{allow:[root]},proxy:{'/api':{target:f.origin,changeOrigin:true,headers:{origin:f.origin}}}}});
    await vite.listen();const addr=vite.httpServer?.address();assert.ok(addr&&typeof addr==='object');
    const sceneOrigin='http://127.0.0.1:'+addr.port,sceneUrl=sceneOrigin+'/card37c-hovercard.html?'+new URLSearchParams({ticket:target.id,number:item.number});
    const appUrl=f.origin+'/workbench/app/?range=all';
    const browser=await launchSystemBrowser({url:sceneUrl,width:1440,height:1000,cookies:[{...actor,url:sceneOrigin}]});
    assert.ok(browser);b=browser;
    await browser.command('Page.bringToFront');
    await observe(browser);
    const version=await browser.command('Browser.getVersion');
    const system=platform()+' '+release()+' / '+String(version.product);
    const scene=async(extra='')=>navigate(browser,sceneUrl+extra,q('#first'));
    const board=async()=>{
      await navigate(browser,appUrl,boardReady+'&&Object.keys(probe37.pages).length===3');
      await browser.evaluate("document.querySelectorAll('[data-action=expand-column][aria-expanded=false]').forEach(el=>el.click())");
      await waitForAnimationsSettled(browser);
    };
    const shot=async(name:string)=>{
      await waitForAnimationsSettled(browser);
      await writeFile(join(evidence,name+'.png'),Buffer.from(await browser.screenshot(),'base64'));saved.add(name+'.png');
    };
    const open=async(selector:string,kind=person)=>{
      await hover(browser,selector);await browser.waitFor(q(selector)+".getAttribute('aria-expanded')==='true'&&"+exists(kind));
    };
    const close=async()=>{await escape(browser);await browser.waitFor('!'+q(card));};
    const check=async(name:string,run:()=>Promise<void>)=>{await t.test(name,run);};

    await check('C4.1 cold cancellation, 400ms open, 150ms close and <100ms warm neighbour',async()=>{
      await scene();
      const first=await point(browser,'#first'),next=await point(browser,'#neighbor');
      await move(browser,first);await delay(300);await move(browser,away);
      await delay(420);assert.deepEqual(await browser.evaluate('probe37.mounts'),[]);
      assert.deepEqual(await browser.evaluate('probe37.requests'),[]);
      await move(browser,first);await browser.waitFor(exists(person));
      const cold=Number(await browser.evaluate('probe37.mounts[0].at-probe37.entries.at(-1).at'));
      assert.ok(cold>=395&&cold<500,'cold hover measured '+cold+'ms');
      await hover(browser,person);await delay(240);
      assert.equal(await browser.evaluate(q('#first')+".getAttribute('aria-expanded')"),'true');
      await move(browser,away);await browser.waitFor('probe37.exits.length>0');
      const closing=Number(await browser.evaluate('probe37.exits[0]-probe37.leaves.at(-1)'));
      assert.ok(closing>=145&&closing<225,'semantic close before 36A exit retention: '+closing);
      await browser.waitFor('!'+q(card));await move(browser,next);await browser.waitFor(q('#neighbor')+".getAttribute('aria-expanded')==='true'");
      const warm=Number(await browser.evaluate('probe37.mounts.at(-1).at-probe37.entries.at(-1).at'));
      assert.ok(warm>=0&&warm<100,'warm hover measured '+warm+'ms');
      assert.ok(Number(await browser.evaluate('probe37.entries.at(-1).at-probe37.exits[0]'))<300,'visited neighbour within the 300ms warm window');
    });

    for(const vertical of ['top','bottom'])for(const horizontal of ['left','right']){
      await check('C4.2 placement '+vertical+'-'+horizontal,async()=>{
        await scene();
        await browser.evaluate(`Object.assign(${q('#peer')}.style,{position:'fixed',${vertical}:'1px',${horizontal}:'1px'})`);
        await open('#peer');await waitForAnimationsSettled(browser);
        assert.equal(await browser.evaluate(q(person)+'.dataset.placement'),vertical==='bottom'?'top':'bottom');
        const geometry=await browser.evaluate(`(()=>{
          const a=${q('#peer')}.getBoundingClientRect(),c=${q(person)}.getBoundingClientRect(),v=document.documentElement;
          return {visible:c.left>=8&&c.right<=v.clientWidth-8&&c.top>=0&&c.bottom<=v.clientHeight,
            gap:${vertical==='bottom'?'a.top-c.bottom':'c.top-a.bottom'},width:c.width};
        })()`);
        assert.deepEqual(geometry,{visible:true,gap:6,width:300});
        if(vertical==='bottom'&&horizontal==='right')await shot('hover-edge-flip');
      });
    }
    await check('C4.2 modal stacking and hit testing',async()=>{
      await scene();await clickWorkbenchControl(browser,'#open-modal');await open('#modal-peer');await waitForAnimationsSettled(browser);
      assert.equal(await browser.evaluate(`(()=>{const n=${q(person)},r=n.getBoundingClientRect();return n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()`),true);
    });
    await check('C4.5 Tab, dialog name, Tab into action, Shift-Tab and Escape restoration',async()=>{
      await scene();await browser.pressTab();await browser.waitFor(q('#first')+'===document.activeElement&&'+exists(person));
      assert.deepEqual(await browser.evaluate(`(()=>{const a=document.activeElement,c=${q(person)};return [a.getAttribute('aria-haspopup'),a.getAttribute('aria-expanded'),a.getAttribute('aria-controls')===c.id,c.getAttribute('role'),document.getElementById(c.getAttribute('aria-labelledby'))?.textContent];})()`),['dialog','true',true,'dialog',peerName]);
      await browser.pressTab();await browser.waitFor(q(person+' button')+'===document.activeElement');
      for(const type of ['rawKeyDown','keyUp'])await browser.command('Input.dispatchKeyEvent',{type,key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers:8});
      await browser.waitFor(q('#first')+'===document.activeElement');
      await browser.pressTab();await browser.waitFor(q(person+' button')+'===document.activeElement');await close();
      assert.equal(await browser.evaluate('document.activeElement.id'),'first');
    });
    for(const mode of ['touch','600px']){
      await check('C4.6 '+mode+' keeps the original ticket navigation',async()=>{
        await scene();await browser.waitFor(q('#ticket')+".hasAttribute('data-hover-card-trigger')");
        try{
          if(mode==='touch'){
            await browser.command('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
            assert.equal(await browser.evaluate("matchMedia('(hover:none), (pointer:coarse)').matches"),true);
          }else{
            await browser.command('Emulation.setDeviceMetricsOverride',{width:600,height:900,deviceScaleFactor:1,mobile:false});
            assert.equal(await browser.evaluate("matchMedia('(max-width:640px)').matches"),true);
          }
          await browser.waitFor('!'+q('#ticket')+".hasAttribute('data-hover-card-trigger')");
          const pos=await point(browser,'#ticket');await move(browser,pos);
          for(let i=0;i<12&&!(await browser.evaluate(q('#ticket')+'===document.activeElement'));i++)await browser.pressTab();
          assert.equal(await browser.evaluate(q('#ticket')+'===document.activeElement'),true);
          await delay(500);
          assert.deepEqual(await browser.evaluate('probe37.mounts'),[]);
          assert.deepEqual(await browser.evaluate(`['aria-expanded','aria-haspopup','aria-controls'].filter(k=>${q('#ticket')}.hasAttribute(k))`),[]);
          if(mode==='touch'){
            await browser.command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[pos]});
            await browser.command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
          }else await clickWorkbenchControl(browser,'#ticket');
          await browser.waitFor('location.pathname==='+JSON.stringify('/items/ticket/'+target.id));
        }finally{
          await browser.command('Emulation.setTouchEmulationEnabled',{enabled:false});
          await browser.command('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
        }
      });
    }
    await check('C4.8 department starts after mount and reuses the result until five minutes',async()=>{
      await scene();
      const pos=await point(browser,'#peer');await move(browser,pos);await delay(300);await move(browser,away);await delay(420);
      assert.deepEqual(await browser.evaluate('probe37.requests'),[]);assert.deepEqual(await browser.evaluate('probe37.mounts'),[]);
      await move(browser,pos);await browser.waitFor(q('.ds-person-hover-dept')+"?.textContent==='信息科（合成）'");
      const requests='probe37.requests.filter(r=>r.path==="/api/workbench/people/profile")';
      assert.deepEqual(await browser.evaluate(requests+'.map(r=>[r.open,JSON.parse(r.body).display_name])'),[[true,peerName]]);
      await move(browser,away);await browser.waitFor('!'+q(card));await browser.evaluate('probe37.offset=295000');
      await open('#peer');await browser.waitFor(q('.ds-person-hover-dept')+"?.textContent==='信息科（合成）'");
      assert.equal(await browser.evaluate(requests+'.length'),1);
      await move(browser,away);await browser.waitFor('!'+q(card));await browser.evaluate('probe37.offset=301000');
      await open('#peer');await browser.waitFor(requests+'.length===2');
    });
    await check('C4.8 unavailable department omits the line and limits repeat reads',async()=>{
      await scene('&department=unavailable');await open('#peer');
      await browser.waitFor('probe37.requests.some(r=>r.path==="/api/workbench/people/profile")');
      await move(browser,away);await browser.waitFor('!'+q(card));await browser.evaluate('probe37.offset=240000');
      await open('#peer');await waitForAnimationsSettled(browser);
      assert.equal(await browser.evaluate('Boolean('+q('.ds-person-hover-dept')+')'),false);
      assert.equal(await browser.evaluate('probe37.requests.filter(r=>r.path==="/api/workbench/people/profile").length'),1);
    });
    await check('C4.4 cold ticket and number-only triggers cancel both reads before mount',async()=>{
      await scene();
      for(const selector of ['#ticket','[data-action=open-closure-original]']){
        await hover(browser,selector);await delay(300);await move(browser,away);
        await delay(420);
        assert.deepEqual(await browser.evaluate('probe37.mounts'),[]);
        assert.deepEqual(await browser.evaluate('probe37.requests'),[]);
      }
    });
    await check('C4.4 unloaded ID, delayed skeleton then real detail',async()=>{
      await scene('&fault=hold');await open('#ticket',ticket);
      await browser.waitFor('typeof probe37.releaseDetail==="function"&&probe37.skeletons.length>0');
      const ms=Number(await browser.evaluate('probe37.skeletons[0]-probe37.mounts[0].at'));
      assert.ok(ms>=145&&ms<375,'150ms skeleton threshold: '+ms);
      assert.equal(await browser.evaluate(q(ticket)+'.dataset.hoverCardState'),'loading');
      await shot('hover-ticket-loading');await browser.evaluate('probe37.releaseDetail()');
      await browser.waitFor(q(ticket)+"?.dataset.hoverCardState==='ready'");
      assert.ok(String(await browser.evaluate(q(ticket)+'.textContent')).includes(item.title));
      assert.deepEqual(await browser.evaluate('probe37.requests.map(r=>[r.path,r.open])'),[['/api/workbench/items/ticket/'+target.id,true]]);
    });
    for(const [status,state,sentence] of [[403,'denied','这张工单你没有查看权限'],[404,'missing','这张工单已不存在']] as const){
      await check('C4.4 '+state+' contains only public number and sentence',async()=>{
        await scene('&fault='+status);await open('#ticket',ticket);await browser.waitFor(q(ticket)+'?.dataset.hoverCardState==='+JSON.stringify(state));
        const text=String(await browser.evaluate(q(ticket)+'.textContent')).replace(/\s/gu,'');
        assert.equal(text,item.number+sentence);
        for(const value of [item.title,item.location,item.assignee_name])assert.equal(text.includes(value),false);
        if(status===403)await shot('hover-ticket-denied');
      });
    }
    await check('C4.4 number-only closure link uses exact existing search',async()=>{
      await scene();await open('[data-action=open-closure-original]',ticket);await browser.waitFor(q(ticket)+"?.dataset.hoverCardState==='ready'");
      assert.ok(String(await browser.evaluate(q(ticket)+'.textContent')).includes(item.title));
      assert.deepEqual(await browser.evaluate('probe37.requests.map(r=>r.path)'),['/api/workbench/search']);
      assert.equal(await browser.evaluate(q(ticket)+".textContent.includes('最近：')"),false);
    });
    await check('C4.4 number-only nonexact results use neutral copy',async()=>{
      const prefix=item.number.slice(0,-1),url=new URL(sceneUrl);
      url.searchParams.set('number',prefix);await navigate(browser,url.href,q('#first'));
      await open('[data-action=open-closure-original]',ticket);
      await browser.waitFor(q(ticket)+"?.dataset.hoverCardState==='missing'");
      assert.equal(await browser.evaluate(q(ticket)+'.textContent'),prefix+'这张工单当前不可见或已不存在');
      assert.deepEqual(await browser.evaluate('probe37.requests.map(r=>r.path)'),['/api/workbench/search']);
    });
    await check('C4.9 hovercard-enter filmstrip and real 36A enter/exit transitions',async()=>{
      await scene();
      const pos=await point(browser,'#peer');
      const start=async()=>{
        await move(browser,pos);
        await browser.waitFor(q(person)+ '?.getAnimations().some(a=>a.transitionProperty==="opacity")');
      };
      const strip=createFilmstripCapture(browser,join(evidence,'filmstrip'));
      await strip('hovercard-enter',async()=>{
        await start();measures.enter=await assertMotion(browser,person,'--dur-fast','--ease-standard');
      },person);
      saved.add('filmstrip/hovercard-enter.png');saved.add('filmstrip/hovercard-enter.json');
      await waitForAnimationsSettled(browser);
      // Observe at the first exit commit. The panel is retained for only --dur-instant.
      await browser.command('Animation.setPlaybackRate',{playbackRate:0});
      try{
        await escape(browser);
        measures.exit=await assertMotion(browser,person,'--dur-instant','--ease-exit');
      }finally{await browser.command('Animation.setPlaybackRate',{playbackRate:1});}
      for(const phase of ['enter','exit'])assert.deepEqual(measures[phase]?.map(a=>a.name).sort(),['opacity','transform']);
    });

    stopPresence=await beginPresence(f,target.id);
    const presenceSelector='.ticket-card[data-item-id="'+target.id+'"] .ds-presence-tag[data-mode=editing]';
    await check('C4.3 online colleague, presence, workload counts and handler filter',async()=>{
      await board();await browser.waitFor(exists(presenceSelector));await open(owner(peerName));
      await browser.waitFor(q('[data-person-online=online]')+'&&'+exists('.ds-person-hover-presence-link'));
      const line=String(await browser.evaluate(q('.ds-person-hover-presence')+'.textContent'));
      assert.equal(line.replace(/\s/gu,''),'正在编辑'+item.number+'的内部备注');
      // The oracle uses the actual board responses from this browser, including collapsed rows.
      // SQL civil timestamps in the HTTP projection already use Asia/Shanghai.
      const expected=await browser.evaluate(`(()=>{
        const items=[...new Map(Object.values(probe37.pages).flat().map(i=>[i.kind+':'+i.id,i])).values()].filter(i=>i.assignee_name===${JSON.stringify(peerName)});
        const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(Date.now());
        const active=items.filter(i=>i.column==='active'),waiting=active.filter(i=>['WAITING_VENDOR','WAITING_REQUESTER'].includes(i.status));
        return [active.length-waiting.length,waiting.length,items.filter(i=>i.column==='handled'&&i.closure?.kind==='COMPLETED'&&i.completed_at?.slice(0,10)===today).length];
      })()`);
      assert.ok(Array.isArray(expected)&&expected.length===3&&expected.every(n=>n>0),'fixture must distinguish all three counters');
      assert.deepEqual(await browser.evaluate(`['active','waiting','done-today'].map(key=>Number(document.querySelector('[data-person-stat="'+key+'"] .sr-only')?.textContent))`),expected);
      assert.equal(await browser.evaluate(q('[data-action=filter-person-tickets]')+'.textContent'),'只看他的工单');
      await shot('hover-person');await clickWorkbenchControl(browser,'[data-action=filter-person-tickets]');
      await browser.waitFor('!'+q(person)+'&&'+q('.ds-filter-chip[data-filter-active] [data-slot=select-trigger]')+'?.textContent.includes('+JSON.stringify(peerName)+')');
      assert.equal(await browser.evaluate("location.pathname.endsWith('/workbench/app/')"),true);
      const shown=await browser.evaluate("[...document.querySelectorAll('.board-column .ticket-card[data-item-id]')].map(c=>c.querySelector('.owner-name')?.textContent)");
      assert.ok(Array.isArray(shown)&&shown.length>0&&shown.every(n=>n===peerName),'only this handler remains: '+JSON.stringify(shown));
    });
    for(const [name,state,label] of [[selfName,'online','self'],[offlineName,'offline','offline']] as const){
      await check('C4.3 '+label+' person',async()=>{
        await board();await open(owner(name));
        await browser.waitFor(exists('[data-person-online='+state+']'));
        assert.equal(await browser.evaluate(q('[data-person-online]')+'.textContent'),state==='online'?'在线':'离线');
        assert.equal(await browser.evaluate('Boolean('+q('.ds-person-hover-presence')+')'),false);
        if(label==='self'){
          assert.equal(await browser.evaluate(q('[data-action=filter-person-tickets]')+'.textContent'),'只看我的工单');
          assert.equal(await browser.evaluate('Boolean('+q('[data-action=transfer-to-person]')+')'),false);
        }
        await shot('hover-person-'+label);
      });
    }
    await check('C4.4 loaded nested ticket performs zero reads',async()=>{
      await board();await browser.waitFor(exists(presenceSelector));await open(owner(peerName));
      const link='.ds-person-hover-presence-link';await browser.waitFor(exists(link));
      const p=await point(browser,link);
      await browser.evaluate('probe37.requests.length=0');await move(browser,p);
      await browser.waitFor(q(ticket)+"?.dataset.hoverCardState==='ready'");
      assert.ok(String(await browser.evaluate(q(ticket)+'.textContent')).includes(item.title));
      assert.deepEqual(await browser.evaluate('probe37.requests'),[]);await shot('hover-ticket');
    });
    await check('C4.3 presence tag opens a single readable overlay',async()=>{
      await board();await open(presenceSelector);await waitForAnimationsSettled(browser);
      assert.equal(await browser.evaluate(q(presenceSelector)+".closest('.ds-presence-tags').querySelector('.ds-presence-tooltip').checkVisibility({visibilityProperty:true,opacityProperty:true})"),false);
    });
    await check('C4.5 board owner can be reached by Tab and Escape restores that owner',async()=>{
      await board();
      const selector=owner(peerName);await browser.waitFor(exists(selector));
      // The existing card-open link precedes its owner in document order.
      await browser.evaluate(q(selector)+".closest('.ticket-card').querySelector('.card-open').focus()");
      await browser.pressTab();
      assert.equal(await browser.evaluate(q(selector)+'===document.activeElement'),true);
      await browser.waitFor(exists(person));await close();assert.equal(await browser.evaluate(q(selector)+'===document.activeElement'),true);
    });
    await check('C4.7 one-screen sweep visits 30 real owners, zero mounts or reads',async()=>{
      const ids:string[]=[];
      const handler=f.principals[3];assert.ok(handler);
      for(let i=0;i<30;i++)ids.push(await seedMotionTicket(f.pool,'悬停扫过 '+(i+1)));
      await f.pool.query("UPDATE pilot_ticket.ticket SET status='IN_PROGRESS',assignee_id=$1,updated_at=platform.local_now() WHERE id=ANY($2::uuid[])",[handler.id,ids]);
      await browser.command('Emulation.setDeviceMetricsOverride',{width:1800,height:10500,deviceScaleFactor:1,mobile:false});
      await board();await waitForAnimationsSettled(browser);
      await chooseWorkbenchSelect(browser,'[data-field-label="处理人"]','name:沈然（合成）');
      await move(browser,away);
      await browser.waitFor("document.querySelectorAll('.board-column .ticket-card[data-item-id]').length===30");
      await browser.waitFor(`(${JSON.stringify(ids)}).every(id=>document.querySelector('.ticket-card[data-item-id="'+id+'"] .owner[data-hover-card-trigger]'))`);
      await waitForAnimationsSettled(browser);
      const positions=await browser.evaluate(`(${JSON.stringify(ids)}).map(id=>{
        const el=document.querySelector('.ticket-card[data-item-id="'+id+'"] .owner'),rect=el.getBoundingClientRect();
        const x=rect.x+rect.width/2,y=rect.y+rect.height/2;
        if(!el.contains(document.elementFromPoint(x,y)))throw Error('30-card viewport must hit every owner: '+id);
        return {x,y};})`);
      assert.ok(Array.isArray(positions)&&positions.length===30);
      await browser.evaluate(`probe37.mounts.length=probe37.requests.length=0;probe37.sweep=[];
        document.addEventListener('pointerover',e=>{const n=e.target.closest('.owner');if(n&&!n.contains(e.relatedTarget))probe37.sweep.push({id:n.closest('.ticket-card').dataset.itemId,at:performance.now()});},true)`);
      for(const p of positions)await move(browser,p);await move(browser,away);
      const finished=Number(await browser.evaluate('performance.now()'));await delay(450);
      assert.deepEqual(await browser.evaluate('probe37.sweep.map(s=>s.id)'),ids);
      assert.equal(await browser.evaluate(`probe37.sweep.every((s,i)=>((probe37.sweep[i+1]?.at??${finished})-s.at)<400)`),true);
      assert.deepEqual(await browser.evaluate('probe37.mounts'),[]);assert.deepEqual(await browser.evaluate('probe37.requests'),[]);
    });
    const expectedFiles=[...names.map(n=>n+'.png'),'filmstrip/hovercard-enter.png','filmstrip/hovercard-enter.json'];
    await writeFile(join(evidence,'card37c-hover.md'),[
      '# Card 37C hover evidence','','| File | Capture | OS and browser |','| --- | --- | --- |',
      ...expectedFiles.map(name=>'| '+name+' | '+(saved.has(name)?'Captured':'Missing in this run')+' | '+system+' |'),'',
      '## Popover motion','','| Phase | 36A duration and curve | Measured |','| --- | --- | --- |',
      ...['enter','exit'].map(phase=>'| '+phase+' | '+(phase==='enter'?'--dur-fast / --ease-standard':'--dur-instant / --ease-exit')+' | '+(measures[phase]?.map(a=>a.name+' '+a.duration+'ms '+a.easing).join(', ')??'Unavailable')+' |'),'',
    ].join('\n'));
    await check('C4.9 all seven screenshots and filmstrip pair captured',async()=>assert.deepEqual([...saved].sort(),expectedFiles.sort()));
  }catch(e){failed=e;}
  await closeBrowserTestResources([async()=>{stopPresence?.();},async()=>{await b?.close();},async()=>{await vite?.close();},()=>rm(temp,{recursive:true,force:true})],failed);
},{precisionV212:true,syntheticServiceCodes:true,ticketSelfHandlingEnabled:true,workbenchInternalNotesEnabled:true,workbenchActivityEnabled:true,workbenchRealtimeEnabled:true,workbenchSearchEnabled:true,presencePeerSessions:true}));
