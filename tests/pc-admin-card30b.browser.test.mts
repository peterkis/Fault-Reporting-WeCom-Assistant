import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {object} from './helpers/t42-board-browser-fixture.mjs';

type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
interface Fixture {origin:string;cookies:string[];browserCookies:{name:string;value:string;url:string}[];tickets:{ticket:{id:string}}[];runtime:{server:import('node:http').Server}}
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
type Mode='VIEWING'|'EDITING';

/** A colleague's real presence: the existing activity command, renewed like the drawer would (every 5 seconds). */
function peer(origin:string,cookie:string){
 let csrf='';const browsers=new Map<string,string>(),held=new Map<string,Mode>();
 const browserFor=(id:string)=>{let value=browsers.get(id);if(!value){value=randomUUID();browsers.set(id,value);}return value;};
 const ready=async()=>{if(!csrf)csrf=String(object(await (await fetch(origin+'/api/lifecycle/bootstrap',{headers:{cookie}})).json()).csrf_token);};
 const post=async(id:string,body:Record<string,unknown>)=>{await ready();const response=await fetch(origin+'/api/workbench/activity',{method:'POST',headers:{cookie,origin,'content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify({schema_version:1,browser_id:browserFor(id),...body})});assert.equal(response.status,200,await response.text());};
 const renew=(id:string,mode:Mode)=>post(id,{action:'RENEW',target:{kind:'ticket',id},visible:true,active:true,mode,field:mode==='EDITING'?'internal-note':null});
 const timer=setInterval(()=>{for(const [id,mode] of held)void renew(id,mode).catch(()=>{});},4000);
 return {
  async hold(id:string,mode:Mode){held.set(id,mode);await renew(id,mode);},
  async release(id:string){held.delete(id);await post(id,{action:'RELEASE',target:{kind:'ticket',id}});},
  stop(){clearInterval(timer);},
 };
}

test('Card 30B presence tags, outline, claim hint, list, drawer capsule and field banner with B6 request, render and idle measurements',{timeout:300000},()=>withWeb01Fixture(async(f:Fixture)=>{
 const directory=process.env.CARD30B_EVIDENCE_DIR??await mkdtemp(join(tmpdir(),'card30b-'));await mkdir(directory,{recursive:true});
 // Visible without expanding a column: tickets 0 (pending, unclaimed), 5 and 6 (active).
 const ids=f.tickets.map(row=>row.ticket.id),viewTarget=ids[0],editTarget=ids[5],crowdTarget=ids[6];assert.ok(viewTarget&&crowdTarget&&editTarget);
 // Sessions with presencePeerSessions: 林舟 (actor), 陈悦, 周宁, 沈然.
 const [,chen,zhou,shen]=f.cookies;assert.ok(chen&&zhou&&shen);
 const peers={chen:peer(f.origin,chen),zhou:peer(f.origin,zhou),shen:peer(f.origin,shen)};
 const batch:number[]=[],metrics:Record<string,unknown>={},screenshots:unknown[]=[];
 const observe=(request:import('node:http').IncomingMessage)=>{if(request.method==='POST'&&request.url==='/api/workbench/activity/batch-view')batch.push(Date.now());};f.runtime.server.on('request',observe);
 let browser:Browser|undefined,failure:unknown;
 try{
  const actor=f.browserCookies[0];assert.ok(actor);
  browser=await launchSystemBrowser({url:f.origin+'/workbench/app/?range=all',width:1440,height:1000,cookies:[actor]});assert.ok(browser);const b=browser;
  // Count live 5-second intervals from page start, to prove the expiry check stops when nobody is present.
  await b.command('Page.addScriptToEvaluateOnNewDocument',{source:"(()=>{const live=new Set(),set=window.setInterval.bind(window),clear=window.clearInterval.bind(window);window.__presenceIntervals=()=>live.size;window.setInterval=(fn,ms,...rest)=>{const id=set(fn,ms,...rest);if(ms===5000)live.add(id);return id;};window.clearInterval=id=>{live.delete(id);clear(id);};})()"});
  await b.command('Page.reload');
  const live="document.querySelector('[data-realtime-status=live]')!==null";
  const card=(id:string)=>'.ticket-card[data-item-id="'+id+'"]';
  await b.waitFor(live+`&&Boolean(document.querySelector(${JSON.stringify(card(viewTarget))}))&&Boolean(document.querySelector(${JSON.stringify(card(editTarget))}))`);
  const capture=async(name:string)=>{await b.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');const bytes=Buffer.from(await b.screenshot(),'base64');await writeFile(join(directory,name+'.png'),bytes);screenshots.push({file:name+'.png',width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')});};
  const heightBefore=Number(await b.evaluate(`document.querySelector(${JSON.stringify(card(viewTarget))}).getBoundingClientRect().height`));
  await peers.zhou.hold(viewTarget,'VIEWING');
  await peers.chen.hold(editTarget,'EDITING');await peers.zhou.hold(editTarget,'VIEWING');
  for(const one of [peers.chen,peers.zhou,peers.shen])await one.hold(crowdTarget,'VIEWING');
  await b.waitFor(`document.querySelector(${JSON.stringify(card(viewTarget)+' .ds-ticket-presence')})!==null&&document.querySelectorAll(${JSON.stringify(card(editTarget)+' .ds-presence-tag')}).length===2&&document.querySelectorAll(${JSON.stringify(card(crowdTarget)+' .ds-presence-tag')}).length===2`);
  // B1/B2: one viewer, an editor first with a pencil, and three people as first + 「+2」; the outline replaces the ring.
  metrics.board=object(await b.evaluate(`(()=>{const read=id=>{const c=document.querySelector('.ticket-card[data-item-id="'+id+'"]');return {presence:c.dataset.presence??null,ring:c.dataset.ring??null,outline:getComputedStyle(c).boxShadow.includes('1.5px')?'1.5px':getComputedStyle(c).outlineWidth,tags:[...c.querySelectorAll('.ds-presence-tag')].map(n=>({text:n.textContent,mode:n.dataset.mode,pencil:Boolean(n.querySelector('svg'))})),label:c.querySelector('.ds-presence-tags').getAttribute('aria-label')};};return {view:read(${JSON.stringify(viewTarget)}),edit:read(${JSON.stringify(editTarget)}),crowd:read(${JSON.stringify(crowdTarget)})};})()`));
  const board=metrics.board as Record<string,Record<string,unknown>>;
  assert.deepEqual(board.view?.tags,[{text:'周宁',mode:'viewing',pencil:false}]);assert.equal(board.view?.presence,'viewing');assert.equal(board.view?.ring,null);assert.equal(board.view?.outline,'1.5px');
  assert.deepEqual(board.edit?.tags,[{text:'陈悦',mode:'editing',pencil:true},{text:'周宁',mode:'viewing',pencil:false}]);assert.equal(board.edit?.presence,'editing');assert.equal(board.edit?.label,'陈悦正在编辑内部备注、周宁正在查看');
  assert.deepEqual((board.crowd?.tags as {text:string;mode:string}[]).map(tag=>tag.mode),['viewing','more']);assert.equal((board.crowd?.tags as {text:string}[])[1]?.text,'+2');
  // Tag geometry: outside the top edge, 18px high, 4/4/4/0 corners, 11px / 600; the card keeps its height.
  metrics.geometry=object(await b.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(card(viewTarget))}),g=c.querySelector('.ds-ticket-presence'),t=g.querySelector('.ds-presence-tag'),s=getComputedStyle(t),cr=c.getBoundingClientRect(),gr=g.getBoundingClientRect();return {top:Math.round(gr.top-cr.top),right:Math.round(cr.right-gr.right),height:t.getBoundingClientRect().height,radius:s.borderRadius,font:s.fontSize,weight:s.fontWeight,cardHeight:cr.height};})()`));
  assert.deepEqual(metrics.geometry,{top:-9,right:12,height:18,radius:'4px 4px 4px 0px',font:'11px',weight:'600',cardHeight:heightBefore});
  await capture('board-1440-presence');
  // Tooltip after hover: full names and actions, editor first.
  const tags=card(editTarget)+' .ds-presence-tags';await b.evaluate(`document.querySelector(${JSON.stringify(tags)}).scrollIntoView({block:'center'})`);
  const point=object(await b.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(tags)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`));
  await b.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:Number(point.x),y:Number(point.y)});await delay(500);
  metrics.tooltip=object(await b.evaluate(`(()=>{const t=document.querySelector(${JSON.stringify(card(editTarget)+' .ds-presence-tooltip')});return {opacity:getComputedStyle(t).opacity,rows:[...t.querySelectorAll('.ds-presence-tooltip-row')].map(r=>r.querySelector('strong').textContent+' '+r.querySelector('strong+span').textContent),avatars:t.querySelectorAll('.ds-avatar').length};})()`));
  assert.equal(object(metrics.tooltip).opacity,'1');assert.deepEqual(object(metrics.tooltip).rows,['陈悦 正在编辑内部备注','周宁 正在查看']);assert.equal(object(metrics.tooltip).avatars,2);
  await capture('board-1440-tooltip');
  // Unclaimed card with someone present: hover hint, claiming not blocked.
  const view=object(await b.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(card(viewTarget))}).getBoundingClientRect();return {x:r.left+r.width/3,y:r.top+r.height/2};})()`));
  await b.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:Number(view.x),y:Number(view.y)});
  await b.waitFor(`getComputedStyle(document.querySelector(${JSON.stringify(card(viewTarget)+' [data-presence-claim-hint]')})).display==='flex'`);
  assert.equal(await b.evaluate(`document.querySelector(${JSON.stringify(card(viewTarget)+' [data-presence-claim-hint]')}).textContent`),'周宁正在查看这张工单，领取前可先确认');
  await capture('board-1440-claim-hint');
  // B6 render: a single presence change mutates only that card.
  await b.evaluate(`window.__touchedPromise=new Promise(resolve=>{const cards=[...document.querySelectorAll('.ticket-card')],hit=new Set();const o=new MutationObserver(list=>{for(const m of list){const n=m.target.nodeType===1?m.target:m.target.parentElement;const c=n&&n.closest?n.closest('.ticket-card'):null;if(c)hit.add(c.dataset.itemId);}});o.observe(document.querySelector('.board'),{subtree:true,childList:true,attributes:true,characterData:true});window.__finishTouched=()=>{o.disconnect();resolve({cards:cards.length,touched:[...hit]});};});0`);
  await b.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:5,y:5});await delay(300);
  await peers.zhou.release(viewTarget);
  await b.waitFor(`document.querySelector(${JSON.stringify(card(viewTarget)+' .ds-ticket-presence')})===null`);await delay(300);
  await b.evaluate('window.__finishTouched()');metrics.render=object(await b.evaluate('window.__touchedPromise'));
  assert.deepEqual(object(metrics.render).touched,[viewTarget],'only the card whose presence changed re-renders');
  // B3: list row tags at the problem cell's right; rows get no outline.
  await b.command('Page.navigate',{url:f.origin+'/workbench/app/?view=list&range=all'});
  const row='.ds-work-row[data-item-id="'+editTarget+'"]';await b.waitFor(live+`&&document.querySelectorAll(${JSON.stringify(row+' .ds-presence-tag')}).length===2`);
  metrics.list=object(await b.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(row)}),g=r.querySelector('.ds-list-presence'),cell=r.querySelector('.ds-list-problem').getBoundingClientRect(),gr=g.getBoundingClientRect();return {outline:getComputedStyle(r).outlineStyle,rightGap:Math.round(cell.right-gr.right),height:r.getBoundingClientRect().height};})()`));
  assert.equal(object(metrics.list).outline,'none');assert.ok(Number(object(metrics.list).rightGap)<=24);assert.equal(object(metrics.list).height,44);
  await capture('list-1440-presence');
  // B4: drawer capsule replaces the body text; a same-field editor marks the internal note area without locking it.
  await b.command('Page.navigate',{url:f.origin+'/workbench/app/items/ticket/'+editTarget});
  await b.waitFor(live+"&&document.querySelector('.detail-toolbar-actions [data-workbench-activity]')!==null&&document.querySelector('[data-activity-field=internal-note][data-presence-editing]')!==null");
  metrics.drawer=object(await b.evaluate("(()=>{const c=document.querySelector('.detail-toolbar-actions [data-workbench-activity]'),s=getComputedStyle(c),area=document.querySelector('[data-activity-field=internal-note]'),input=area.querySelector('textarea');return {text:c.textContent,height:c.getBoundingClientRect().height,radius:s.borderRadius,bodyText:Boolean(document.querySelector('.detail-body [data-workbench-activity]')),banner:area.getAttribute('data-presence-editing'),before:getComputedStyle(area,'::before').content,locked:input?input.disabled||input.readOnly:null};})()"));
  const drawer=object(metrics.drawer);
  assert.match(String(drawer.text),/在看/u);assert.match(String(drawer.text),/陈悦正在编辑内部备注/u);assert.equal(drawer.height,26);assert.equal(drawer.radius,'13px');assert.equal(drawer.bodyText,false);
  assert.equal(drawer.banner,'陈悦正在编辑内部备注，同时编辑可能互相覆盖');assert.match(String(drawer.before),/同时编辑可能互相覆盖/u);assert.notEqual(drawer.locked,true);
  await capture('drawer-1440-capsule-banner');
  // B6 network: 20 presence hints within 10 seconds cause at most 10 batch reads.
  await b.command('Page.navigate',{url:f.origin+'/workbench/app/?range=all'});await b.waitFor(live+`&&document.querySelectorAll(${JSON.stringify(card(editTarget)+' .ds-presence-tag')}).length===2`);await delay(1500);
  const from=batch.length;
  // Each hold or release changes the presence version, i.e. 20 server hints in 10 seconds.
  for(let index=0;index<20;index++){if(index%2)await peers.zhou.release(viewTarget);else await peers.zhou.hold(viewTarget,'VIEWING');await delay(500);}
  await delay(1500);metrics.network={hints:20,seconds:10,batchReads:batch.length-from};
  assert.ok(batch.length-from<=10&&batch.length-from>=1,JSON.stringify(metrics.network));
  // B6 idle: with nobody present there are no batch reads and no running 5-second check for 60 seconds.
  for(const one of Object.values(peers))one.stop();
  await peers.zhou.release(viewTarget);await peers.zhou.release(crowdTarget);await peers.zhou.release(editTarget);await peers.chen.release(editTarget);await peers.chen.release(crowdTarget);await peers.shen.release(crowdTarget);
  await b.waitFor("document.querySelector('.ds-presence-tags')===null");await delay(2000);
  const idleFrom=batch.length;await delay(60000);
  metrics.idle={seconds:60,batchReads:batch.length-idleFrom,intervals:await b.evaluate('window.__presenceIntervals()')};
  assert.deepEqual(metrics.idle,{seconds:60,batchReads:0,intervals:0});
 }catch(error){failure=error;}
 finally{await closeBrowserTestResources([async()=>{if(failure&&browser)await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));},()=>writeFile(join(directory,'receipt.json'),JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',platform:process.platform,metrics,screenshots},null,2)),()=>{for(const one of Object.values(peers))one.stop();f.runtime.server.off('request',observe);},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);}
},{workbenchRealtimeEnabled:true,workbenchActivityEnabled:true,workbenchInternalNotesEnabled:true,presencePeerSessions:true}));
