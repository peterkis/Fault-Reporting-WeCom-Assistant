import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir,platform,release} from 'node:os';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import {launchSystemBrowser} from './helpers/p2-006-browser-harness.mjs';
import {clickWorkbenchControl} from './helpers/heroui-workbench-controls.mjs';
import {waitForAnimationsSettled} from './helpers/browser-animations.mjs';
import {assertMotion,assertNoTransformAnimations,assertMonotonicCollapse} from './helpers/motion-assert.mjs';
import {createFilmstripCapture} from './helpers/motion-filmstrip.mjs';

const root=process.env.TS_MIGRATION_TEST_SOURCE_ROOT??process.cwd();
type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
// This entry isolates presentation only. The registered integration entries retain all business assertions.
test('Card36A E1–E7 tokens, reduced motion, interrupt/focus, monotonic collapse, tool APIs, debug and E1–E5 filmstrips',{timeout:180000},async t=>{
  const directory=process.env.CARD36A_EVIDENCE_DIR??await mkdtemp(join(tmpdir(),'card36a-evidence-')),cache=await mkdtemp(join(tmpdir(),'card36a-vite-'));
  await mkdir(directory,{recursive:true});
  const measurements:Record<string,unknown>={},filmstrips:string[]=[];let browser:Browser|undefined,failure:unknown;
  const server=await createServer({configFile:false,root:join(root,'tests/fixtures'),cacheDir:cache,plugins:[react(),tailwind()],server:{host:'127.0.0.1',port:0,fs:{allow:[root]}},logLevel:'error'});
  const check=async(name:string,run:()=>Promise<void>)=>{let failed:unknown;await t.test(name,async()=>{try{await run();}catch(error){failed=error;throw error;}});if(failed)throw failed;};
  try{
    await server.listen();const address=server.httpServer?.address();assert.ok(address&&typeof address==='object');
    const origin='http://127.0.0.1:'+address.port;
    assert.equal((await fetch(origin+'/motion-app.html')).status,200);assert.equal((await fetch(origin+'/motion-app.tsx')).status,200,'isolation fixture must compile through Vite');
    browser=await launchSystemBrowser({url:origin+'/motion-app.html',width:1100,height:900});assert.ok(browser);const b=browser;
    await b.command('Page.bringToFront');await b.waitFor('Boolean(window.motionFixture)&&document.fonts.status==="loaded"');
    let pressPoint={x:0,y:0};
    const preparePress=async()=>{
      await b.evaluate("document.querySelector('#press').scrollIntoView({block:'nearest'})");await waitForAnimationsSettled(b);
      const point=await b.evaluate("(()=>{const r=document.querySelector('#press').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");assert.ok(point&&typeof point==='object'&&'x' in point&&typeof point.x==='number'&&'y' in point&&typeof point.y==='number');pressPoint={x:point.x,y:point.y};
      await b.command('Input.dispatchMouseEvent',{type:'mouseMoved',buttons:0,...pressPoint});await waitForAnimationsSettled(b);
    };
    const press=async(down:boolean)=>{
      await waitForAnimationsSettled(b);
      if(down)await preparePress();
      await b.command('Input.dispatchMouseEvent',{type:down?'mousePressed':'mouseReleased',button:'left',buttons:down?1:0,clickCount:1,...pressPoint});
    };
    const assertGroupChevron=async(expanded:boolean)=>{
      await waitForAnimationsSettled(b,'#hero-group');
      const pose:unknown=await b.evaluate("(()=>{const trigger=document.querySelector('#hero-group .ds-board-group-trigger'),icon=trigger.querySelector('[data-slot=disclosure-indicator]'),style=getComputedStyle(icon),matrix=new DOMMatrixReadOnly(style.transform);return {expanded:trigger.getAttribute('aria-expanded'),rotate:style.rotate,a:matrix.a,d:matrix.d};})()");
      assert.ok(pose&&typeof pose==='object'&&'expanded' in pose&&'rotate' in pose&&'a' in pose&&'d' in pose);
      assert.equal(pose.expanded,String(expanded));assert.equal(pose.rotate,'none','HeroUI independent rotation must be reset');assert.equal(pose.a,expanded?-1:1);assert.equal(pose.d,expanded?-1:1);
    };
    const openMenu=()=>clickWorkbenchControl(b,'#menu-trigger'),openModal=()=>clickWorkbenchControl(b,'#modal-trigger');
    const escape=async()=>{for(const type of ['keyDown','keyUp'])await b.command('Input.dispatchKeyEvent',{type,key:'Escape',code:'Escape'});};
    await check('E1–E7 measured timing/easing and allowed keyframes',async()=>{
      await press(true);measurements.E1=await assertMotion(b,'#press','--dur-instant','--ease-standard');await waitForAnimationsSettled(b);await press(false);measurements.E1Return=await assertMotion(b,'#press','--dur-fast','--ease-standard');
      await waitForAnimationsSettled(b);await b.evaluate("document.querySelector('.ds-segmented button:last-child').click()");measurements.E2=await assertMotion(b,'.ds-segmented-slider','--dur-base','--ease-standard');
      await waitForAnimationsSettled(b);await b.evaluate("document.querySelector('#collapse-trigger').click()");measurements.E3=await assertMotion(b,'#collapse','--dur-base','--ease-standard',{cssExceptions:['gridTemplateRows']});measurements.E3Arrow=await assertMotion(b,'#collapse-trigger svg','--dur-base','--ease-standard');
      await waitForAnimationsSettled(b);await openMenu();measurements.E4=await assertMotion(b,'.motion-menu','--dur-fast','--ease-standard');await waitForAnimationsSettled(b);await escape();measurements.E4Exit=await assertMotion(b,'.motion-menu','--dur-instant','--ease-exit');await b.waitFor('!document.querySelector(".motion-menu")');
      await openModal();measurements.E5=await assertMotion(b,'.ds-modal-container','--dur-slow','--ease-soft');measurements.E5Backdrop=await assertMotion(b,'.ds-modal-backdrop','--dur-slow','--ease-soft');await waitForAnimationsSettled(b);await escape();measurements.E5Exit=await assertMotion(b,'.ds-modal-container','--dur-fast','--ease-exit');measurements.E5BackdropExit=await assertMotion(b,'.ds-modal-backdrop','--dur-fast','--ease-exit');await b.waitFor('!document.querySelector(".ds-modal")');
      await waitForAnimationsSettled(b);const point=await b.evaluate("(()=>{const r=document.querySelector('#hover-card').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");assert.ok(point&&typeof point==='object'&&'x' in point&&'y' in point);await b.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x,y:point.y});measurements.E6=await assertMotion(b,'#hover-card','--dur-fast','--ease-standard',{cssExceptions:['boxShadow']});
      await b.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});await waitForAnimationsSettled(b);
      await b.evaluate("window.tooltipStarted=performance.now();document.querySelector('.motion-tooltips button').focus()");await b.waitFor("document.querySelector('.motion-tooltips [data-tooltip-open=true]')!==null");measurements.E7=await assertMotion(b,'.motion-tooltips .ds-read-only-tooltip','--dur-instant','--ease-standard');
      const elapsed=await b.evaluate('performance.now()-window.tooltipStarted');assert.ok(typeof elapsed==='number'&&elapsed>=400,'cold tooltip waits full delay');await waitForAnimationsSettled(b);
      await b.evaluate("window.adjacentStarted=performance.now();document.querySelectorAll('.motion-tooltips button')[1].focus()");await b.waitFor("document.querySelectorAll('.motion-tooltips [data-tooltip-open=true]')[0]?.querySelector('button')===document.querySelectorAll('.motion-tooltips button')[1]");const adjacent=await b.evaluate('performance.now()-window.adjacentStarted');assert.ok(typeof adjacent==='number'&&adjacent<400,'adjacent tooltip skips warmup');
    });
    await check('E3 ten-frame zero-jump expansion and collapse',async()=>{
      await b.evaluate("document.activeElement.blur();if(document.querySelector('#collapse-trigger').getAttribute('aria-expanded')==='true')document.querySelector('#collapse-trigger').click()");await waitForAnimationsSettled(b);
      measurements.collapseExpand=await assertMonotonicCollapse(b,'#collapse-trigger','#below-collapse','expand');measurements.collapseClose=await assertMonotonicCollapse(b,'#collapse-trigger','#below-collapse','collapse');
      await assertGroupChevron(true);await b.evaluate("document.querySelector('#hero-group .ds-board-group-trigger').click()");await assertGroupChevron(false);
      await b.evaluate("document.querySelector('#hero-group .ds-board-group-trigger').click()");await assertGroupChevron(true);
    });
    await check('E4/E5 Esc halfway reverses immediately, unmounts and returns focus',async()=>{
      for(const [open,selector,trigger] of [[openMenu,'.motion-menu','#menu-trigger'],[openModal,'.ds-modal-container','#modal-trigger']] as const){
        await waitForAnimationsSettled(b);await open();
        const before=await b.evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)}),animations=n.getAnimations();if(!animations.length)throw Error('OPEN_ANIMATION_MISSING');for(const a of animations){a.pause();a.currentTime=Number(a.effect.getTiming().duration)/2;}const matrix=new DOMMatrixReadOnly(getComputedStyle(n).transform);return {x:matrix.m41,y:matrix.m42,scale:matrix.a};})()`);
        await escape();const after=await b.evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)return null;const frames=n.getAnimations().flatMap(a=>a.effect.getKeyframes()).find(frame=>'transform' in frame);const matrix=new DOMMatrixReadOnly(frames?.transform??getComputedStyle(n).transform);return {x:matrix.m41,y:matrix.m42,scale:matrix.a,exiting:n.hasAttribute('data-exiting'),animations:n.getAnimations().length};})()`);
        assert.ok(after&&typeof after==='object'&&'exiting' in after&&after.exiting===true&&'animations' in after&&Number(after.animations)>0,'Esc immediately begins exit');
        assert.ok(before&&typeof before==='object'&&'x' in before&&'y' in before&&'scale' in before&&'x' in after&&'y' in after&&'scale' in after);
        assert.ok(Math.abs(Number(before.x)-Number(after.x))<=1&&Math.abs(Number(before.y)-Number(after.y))<=1&&Math.abs(Number(before.scale)-Number(after.scale))<=.001,'exit starts at the sampled mid-open position');
        measurements[selector+'Interrupt']={before,after};
        await b.waitFor(`!document.querySelector(${JSON.stringify(selector)})&&document.activeElement===document.querySelector(${JSON.stringify(trigger)})`);
      }
    });
    await check('isolated highlight, FLIP, NumberRoll, exit presence and live debug override',async()=>{
      assert.equal(await b.evaluate("document.querySelector('#number').getAnimations({subtree:true}).length"),0,'first number render is static');
      await b.evaluate('window.motionFixture.setNumber(11)');await b.evaluate('new Promise(resolve=>requestAnimationFrame(resolve))');measurements.numberRoll=await assertMotion(b,'#number','--dur-base','--ease-standard',{subtree:true});
      assert.equal(await b.evaluate("document.querySelector('#number .sr-only').textContent"),'11');
      assert.equal(await b.evaluate("document.querySelector('#number .ds-number-roll-old').getAnimations()[0].effect.getKeyframes().at(-1).transform.includes('-100%')"),true,'increase leaves upwards');await waitForAnimationsSettled(b);
      await b.evaluate('window.motionFixture.setNumber(9)');await b.evaluate('new Promise(resolve=>requestAnimationFrame(resolve))');assert.equal(await b.evaluate("document.querySelector('#number .ds-number-roll-old').getAnimations()[0].effect.getKeyframes().at(-1).transform.includes('100%')&&!document.querySelector('#number .ds-number-roll-old').getAnimations()[0].effect.getKeyframes().at(-1).transform.includes('-100%')"),true,'decrease leaves downwards');await b.evaluate('window.motionFixture.setNumber(9);window.motionFixture.setNumber(123)');await waitForAnimationsSettled(b);assert.equal(await b.evaluate("document.querySelector('#number .sr-only').textContent"),'123');
      await b.evaluate('window.motionFixture.setRolling(false)');await b.evaluate('new Promise(resolve=>requestAnimationFrame(resolve))');await b.evaluate('window.motionFixture.setNumber(77)');await b.evaluate('new Promise(resolve=>requestAnimationFrame(resolve))');assert.equal(await b.evaluate("document.querySelector('#number').getAnimations({subtree:true}).length"),0);
      for(const tone of ['intake','active','done','brand']){await b.evaluate(`window.motionFixture.highlight(document.querySelector('#highlight'),{tone:${JSON.stringify(tone)}})`);measurements['highlight-'+tone]=await assertMotion(b,'#highlight','--dur-highlight','--ease-standard');await b.evaluate("document.querySelector('#highlight').getAnimations().forEach(animation=>animation.finish())");}
      const cap=await b.evaluate("(()=>{const f=window.motionFixture;return Array.from({length:7},(_,index)=>f.flip(document.querySelector('#flip-'+index),{left:0,top:0},{left:100,top:100}).playState);})()");assert.ok(Array.isArray(cap));assert.equal(cap.filter(state=>state==='running').length,6);assert.equal(cap[6],'finished');measurements.flip=await assertMotion(b,'#flip-0','--dur-base','--ease-standard');await b.evaluate("document.querySelectorAll('.flip-target').forEach(n=>n.getAnimations().forEach(a=>a.finish()))");
      await b.evaluate('window.motionFixture.setPresent(false)');await b.evaluate('new Promise(resolve=>requestAnimationFrame(resolve))');assert.equal(await b.evaluate('Boolean(document.querySelector("#retained"))'),true);await b.evaluate('window.motionFixture.setPresent(true)');await waitForAnimationsSettled(b);assert.equal(await b.evaluate('Boolean(document.querySelector("#retained"))'),true);
      await b.evaluate("localStorage.setItem('motion-debug','slow')");assert.equal(await b.evaluate("document.documentElement.dataset.motion"),'slow');assert.equal(await b.evaluate("window.motionFixture.motionToken('--dur-base')"),900);await b.evaluate("localStorage.removeItem('motion-debug')");assert.equal(await b.evaluate("window.motionFixture.motionToken('--dur-base')"),180);
    });
    await check('CDP reduced motion E1–E5 preserves functions without transform animations',async()=>{
      await b.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await b.evaluate('new Promise(resolve=>requestAnimationFrame(resolve))');
      await press(true);await assertNoTransformAnimations(b,'#press');await press(false);
      await b.evaluate("document.querySelector('.ds-segmented button:first-of-type').click()");await assertNoTransformAnimations(b,'.ds-segmented');assert.equal(await b.evaluate("document.querySelector('.ds-segmented button').getAttribute('aria-pressed')"),'true');
      await b.evaluate("document.querySelector('#collapse-trigger').click()");await assertNoTransformAnimations(b,'#control-examples');assert.equal(await b.evaluate("document.querySelector('#collapse-trigger').getAttribute('aria-expanded')"),'true');
      await assertGroupChevron(true);await b.evaluate("document.querySelector('#hero-group .ds-board-group-trigger').click()");await assertGroupChevron(false);await assertNoTransformAnimations(b,'#hero-group');
      await b.evaluate("document.querySelector('#hero-group .ds-board-group-trigger').click()");await assertGroupChevron(true);await assertNoTransformAnimations(b,'#hero-group');
      await openMenu();await assertNoTransformAnimations(b,'.motion-menu');await escape();await b.waitFor('!document.querySelector(".motion-menu")');
      await openModal();await assertNoTransformAnimations(b,'.ds-modal-backdrop');await escape();await b.waitFor('!document.querySelector(".ds-modal")&&document.activeElement===document.querySelector("#modal-trigger")');
      await b.evaluate('window.motionFixture.setNumber(8);window.motionFixture.setPresent(false)');await b.evaluate('new Promise(resolve=>requestAnimationFrame(resolve))');assert.equal(await b.evaluate('Boolean(document.querySelector("#retained"))'),false);assert.equal(await b.evaluate("document.querySelector('#number').getAnimations({subtree:true}).length"),0);
      await b.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
      await b.waitFor("!matchMedia('(prefers-reduced-motion: reduce)').matches&&!document.documentElement.hasAttribute('data-motion-reduced')");
      assert.equal(await b.evaluate('window.motionFixture.prefersReducedMotion()'),false);
    });
    await check('deterministic E1–E5 filmstrips',async()=>{
      // Isolate evidence from the preceding reduced-motion and pointer interactions. A live
      // matchMedia value can reset before its change listener clears the root CSS attribute.
      await b.evaluate('window.__card36aBeforeFilmstrip=true');
      await b.command('Page.navigate',{url:origin+'/motion-app.html'});await b.command('Page.bringToFront');
      await b.waitFor("!window.__card36aBeforeFilmstrip&&Boolean(window.motionFixture)&&document.fonts.status==='loaded'&&!matchMedia('(prefers-reduced-motion: reduce)').matches&&!document.documentElement.hasAttribute('data-motion-reduced')&&!document.documentElement.hasAttribute('data-motion')");
      await b.command('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,x:1,y:1});
      await b.command('Input.dispatchMouseEvent',{type:'mouseMoved',buttons:0,x:1,y:1});
      const captureFilmstrip=createFilmstripCapture(b,join(directory,'filmstrip'));
      await preparePress();
      const ready:unknown=await b.evaluate(`(()=>{const node=document.querySelector('#press'),style=getComputedStyle(node),hit=document.elementFromPoint(${pressPoint.x},${pressPoint.y});return {normal:!window.motionFixture.prefersReducedMotion()&&!document.documentElement.hasAttribute('data-motion-reduced'),active:node.matches(':active'),dataPressed:node.getAttribute('data-pressed'),transform:style.transform,transitionProperty:style.transitionProperty,transitionDuration:style.transitionDuration,hit:hit===node||node.contains(hit)};})()`);
      measurements.filmstripStart=ready;
      assert.ok(ready&&typeof ready==='object'&&'normal' in ready&&ready.normal===true&&'active' in ready&&ready.active===false&&'dataPressed' in ready&&ready.dataPressed!=='true'&&'hit' in ready&&ready.hit===true&&'transform' in ready&&ready.transform==='none'&&'transitionProperty' in ready&&typeof ready.transitionProperty==='string'&&ready.transitionProperty.split(',').map(value=>value.trim()).includes('transform')&&'transitionDuration' in ready&&typeof ready.transitionDuration==='string'&&ready.transitionDuration.split(',').some(value=>parseFloat(value)>0),'filmstrip requires normal, released, hit-testable press target: '+JSON.stringify(ready));
      filmstrips.push(await captureFilmstrip('e1-press',()=>b.command('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...pressPoint}),'#press'));await press(false);await waitForAnimationsSettled(b);
      filmstrips.push(await captureFilmstrip('e2-segment',()=>b.evaluate("document.querySelector('.ds-segmented button:last-child').click()"),'.ds-segmented'));
      await b.evaluate("if(document.querySelector('#collapse-trigger').getAttribute('aria-expanded')==='true')document.querySelector('#collapse-trigger').click()");await waitForAnimationsSettled(b);filmstrips.push(await captureFilmstrip('e3-collapse',()=>b.evaluate("document.querySelector('#collapse-trigger').click()"),'#collapse,#collapse-trigger svg'));
      filmstrips.push(await captureFilmstrip('e4-menu',openMenu,'.motion-menu'));await escape();await b.waitFor('!document.querySelector(".motion-menu")');
      filmstrips.push(await captureFilmstrip('e5-modal',openModal,'.ds-modal-container,.ds-modal-backdrop'));await escape();await b.waitFor('!document.querySelector(".ds-modal")');
    });
    await check('development URL slow/off switches update all duration tokens and reduced CSS',async()=>{
      await b.command('Page.navigate',{url:origin+'/motion-app.html?motion=slow'});await b.waitFor('Boolean(window.motionFixture)&&document.documentElement.dataset.motion==="slow"');
      assert.equal(await b.evaluate("window.motionFixture.motionToken('--dur-base')"),900);
      await b.command('Page.navigate',{url:origin+'/motion-app.html?motion=off'});await b.waitFor('Boolean(window.motionFixture)&&document.documentElement.dataset.motion==="off"');
      assert.equal(await b.evaluate('window.motionFixture.prefersReducedMotion()'),true);await press(true);await assertNoTransformAnimations(b,'#press');assert.equal(await b.evaluate("getComputedStyle(document.querySelector('#press')).transform"),'none');await press(false);
    });
  }catch(error){failure=error;throw error;}finally{
    const version=browser?await browser.command('Browser.getVersion').catch(()=>null):null;
    await browser?.close();await server.close();await rm(cache,{recursive:true,force:true});
    const resources:unknown=browser?.ownedResourceState()??null;if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});
    await writeFile(join(directory,'motion-receipt.json'),JSON.stringify({status:failure?'FAIL':'PASS',os:{platform:platform(),release:release()},browser:version,measurements,filmstrips,resources,error:failure instanceof Error?failure.message:null},null,2)+'\n');
  }
});
