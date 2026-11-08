import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {object} from './helpers/t42-board-browser-fixture.mjs';
import {loadServiceCatalog} from '../app/server/src/p2-007-service-catalog.mjs';

type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
interface Fixture {origin:string;cookies:string[];browserCookies:{name:string;value:string;url:string}[];tickets:{ticket:{id:string}}[]}
type Mode='VIEWING'|'EDITING';

/** A colleague's open workbench page: one real SSE stream plus presence leases renewed like the drawer does. */
function colleague(origin:string,cookie:string){
 let csrf='',stream:AbortController|null=null;const browsers=new Map<string,string>(),held=new Map<string,Mode>();
 const browserFor=(id:string)=>{let value=browsers.get(id);if(!value){value=randomUUID();browsers.set(id,value);}return value;};
 const ready=async()=>{if(!csrf)csrf=String(object(await (await fetch(origin+'/api/lifecycle/bootstrap',{headers:{cookie}})).json()).csrf_token);};
 const post=async(id:string,body:Record<string,unknown>)=>{await ready();const response=await fetch(origin+'/api/workbench/activity',{method:'POST',headers:{cookie,origin,'content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify({schema_version:1,browser_id:browserFor(id),...body})});assert.equal(response.status,200,await response.text());};
 const renew=(id:string,mode:Mode)=>post(id,{action:'RENEW',target:{kind:'ticket',id},visible:true,active:true,mode,field:mode==='EDITING'?'internal-note':null});
 const timer=setInterval(()=>{for(const [id,mode] of held)void renew(id,mode).catch(()=>{});},4000);
 return {
  async connect(){const controller=new AbortController();stream=controller;const response=await fetch(origin+'/api/realtime/events?scope=workbench',{headers:{cookie,accept:'text/event-stream'},signal:controller.signal});assert.equal(response.status,200);const reader=response.body?.getReader();void (async()=>{try{while(reader&&!(await reader.read()).done){/* keep the stream open */}}catch{/* closed */}})();},
  async hold(id:string,mode:Mode){held.set(id,mode);await renew(id,mode);},
  async release(id:string){held.delete(id);await post(id,{action:'RELEASE',target:{kind:'ticket',id}});},
  stop(){clearInterval(timer);stream?.abort();},
 };
}

test('Card 32A list subgroup, show-more chevron, registered categories, claim hint, drawer field banner, editing colour and online avatars',{timeout:300000},()=>withWeb01Fixture(async(f:Fixture)=>{
 const directory=process.env.CARD32A_EVIDENCE_DIR??await mkdtemp(join(tmpdir(),'card32a-'));await mkdir(directory,{recursive:true});
 // Visible without expanding a column: ticket 0 (pending, unclaimed), 5 and 6 (active).
 const ids=f.tickets.map(row=>row.ticket.id),viewTarget=ids[0],editTarget=ids[5],crowdTarget=ids[6];assert.ok(viewTarget&&editTarget&&crowdTarget);
 // Sessions with presencePeerSessions: 林舟 (actor), 陈悦, 周宁, 沈然.
 const [,chenCookie,zhouCookie,shenCookie]=f.cookies;assert.ok(chenCookie&&zhouCookie&&shenCookie);
 const peers={chen:colleague(f.origin,chenCookie),zhou:colleague(f.origin,zhouCookie),shen:colleague(f.origin,shenCookie)};
 const metrics:Record<string,unknown>={},screenshots:unknown[]=[];
 let browser:Browser|undefined,failure:unknown;
 try{
  const actor=f.browserCookies[0];assert.ok(actor);
  for(const one of Object.values(peers))await one.connect();
  await peers.shen.hold(viewTarget,'VIEWING');
  // Only the assignee (陈悦, ticket 5) may edit its internal note; a second real editor is not authorised in this fixture.
  await peers.chen.hold(editTarget,'EDITING');await peers.shen.hold(editTarget,'VIEWING');
  for(const one of [peers.chen,peers.zhou,peers.shen])await one.hold(crowdTarget,'VIEWING');
  browser=await launchSystemBrowser({url:f.origin+'/workbench/app/?range=all',width:1440,height:1000,cookies:[actor]});assert.ok(browser);const b=browser;
  // Explicit synthetic seam (receipt `synthetic`): when window.__extraEditor is set, the drawer's activity read (GET /api/workbench/items/{kind}/{id}/activity) gains a second editor of the same field.
  await b.command('Page.addScriptToEvaluateOnNewDocument',{source:"(()=>{window.__extraEditor=null;const o=window.fetch.bind(window);window.fetch=async(i,n)=>{const r=await o(i,n);if(!/^\\/api\\/workbench\\/items\\/[a-z]+\\/[0-9a-f-]+\\/activity$/.test(String(i))||!window.__extraEditor||!r.ok)return r;const v=await r.clone().json();const e=(v.people??[]).find(p=>p.mode==='EDITING'&&p.field);if(!e)return r;const at=v.people.lastIndexOf(e)+1;v.people.splice(at,0,{...e,display_name:window.__extraEditor});return new Response(JSON.stringify(v),{status:r.status,headers:{'content-type':'application/json'}});};})()"});
  await b.command('Page.reload');
  const live="document.querySelector('[data-realtime-status=live]')!==null";
  const card=(id:string)=>'.ticket-card[data-item-id="'+id+'"]';
  const capture=async(name:string)=>{await b.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');const bytes=Buffer.from(await b.screenshot(),'base64');await writeFile(join(directory,name+'.png'),bytes);screenshots.push({file:name+'.png',width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')});};
  const move=async(x:number,y:number)=>b.command('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
  const point=async(selector:string,fx=.5,fy=.5)=>{await b.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);const p=object(await b.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width*${fx},y:r.top+r.height*${fy}};})()`));return {x:Number(p.x),y:Number(p.y)};};
  await b.waitFor(live+`&&document.querySelectorAll(${JSON.stringify(card(editTarget)+' .ds-presence-tag')}).length===2&&document.querySelector(${JSON.stringify(card(viewTarget)+' .ds-ticket-presence')})!==null&&document.querySelectorAll(${JSON.stringify(card(crowdTarget)+' .ds-presence-tag')}).length===2`);
  // A3: every synthetic ticket card uses a registered catalog category; no fallback 「?」 tile. 待判断 intakes have no service until triage, so they stay 「未分类」 by business rule and are counted separately.
  metrics.categories=object(await b.evaluate("(()=>{const fallback=t=>t.dataset.category==='unclassified'||Boolean(t.querySelector('svg.lucide-circle-help'));const tiles=[...document.querySelectorAll('.board .ticket-card[data-kind=ticket] .ds-ticket-category')],intakes=[...document.querySelectorAll('.board .ticket-card:not([data-kind=ticket]) .ds-ticket-category')];return {tiles:tiles.length,fallback:tiles.filter(fallback).length,categories:[...new Set(tiles.map(t=>t.dataset.category))].sort(),untriagedIntakes:intakes.length,untriagedFallback:intakes.filter(fallback).length};})()"));
  assert.ok(Number(object(metrics.categories).tiles)>=6,JSON.stringify(metrics.categories));assert.equal(object(metrics.categories).fallback,0,'no fallback category icon on synthetic fixture cards');
  // A6: the editing tag, the card outline and (below) the drawer capsule share one colour token.
  metrics.editingColour=object(await b.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(card(editTarget))}),tag=c.querySelector('.ds-presence-tag[data-mode=editing]'),probe=document.createElement('span');probe.style.color='var(--presence-editing)';document.body.append(probe);const token=getComputedStyle(probe).color;probe.remove();return {token,tag:getComputedStyle(tag).backgroundColor,outline:getComputedStyle(c).boxShadow.includes(token)};})()`));
  assert.equal(object(metrics.editingColour).tag,object(metrics.editingColour).token);assert.equal(object(metrics.editingColour).outline,true);
  await move(5,5);
  await capture('board-1440-presence');
  // A4: hovering or focusing 「领取」 on an unclaimed card someone views shows the hint on top of the next card.
  const claim=card(viewTarget)+' .ds-board-claim-slot button',hint=card(viewTarget)+' [data-presence-claim-hint]';
  const body=await point(card(viewTarget),.3,.5);await move(body.x,body.y);
  await b.waitFor(`document.querySelector(${JSON.stringify(claim)})!==null&&getComputedStyle(document.querySelector(${JSON.stringify(claim)}).closest('.ds-board-claim-slot')).display!=='none'`);
  const button=await point(claim);await move(button.x,button.y);
  await b.waitFor(`getComputedStyle(document.querySelector(${JSON.stringify(hint)})).display==='flex'`);
  // The hint ignores pointer events; probe hit-testing with them enabled to prove nothing paints over or clips it.
  const visibleHint=`(()=>{const h=document.querySelector(${JSON.stringify(hint)}),r=h.getBoundingClientRect();h.style.pointerEvents='auto';const top=document.elementFromPoint(r.left+r.width/2,r.top+r.height-2);h.style.pointerEvents='';return {text:h.textContent,onTop:Boolean(top&&h.contains(top)),height:Math.round(r.height)};})()`;
  metrics.claimHover=object(await b.evaluate(visibleHint));
  assert.deepEqual(metrics.claimHover,{text:'沈然正在查看这张工单，领取前可先确认',onTop:true,height:Number(object(metrics.claimHover).height)});assert.ok(Number(object(metrics.claimHover).height)>0);
  await capture('board-1440-claim-hint');
  await move(5,5);await b.waitFor(`getComputedStyle(document.querySelector(${JSON.stringify(hint)})).display==='none'`);
  // Keyboard: focusing the card's link reveals 「领取」 and the hint; focus then moves to 「领取」 and the hint stays on top.
  await b.evaluate(`document.querySelector(${JSON.stringify(card(viewTarget)+' a[href]')}).focus()`);
  await b.waitFor(`getComputedStyle(document.querySelector(${JSON.stringify(hint)})).display==='flex'&&getComputedStyle(document.querySelector(${JSON.stringify(claim)}).closest('.ds-board-claim-slot')).display!=='none'`);
  await b.evaluate(`document.querySelector(${JSON.stringify(claim)}).focus()`);
  await b.waitFor(`document.activeElement===document.querySelector(${JSON.stringify(claim)})&&getComputedStyle(document.querySelector(${JSON.stringify(hint)})).display==='flex'`);
  metrics.claimFocus=object(await b.evaluate(visibleHint));assert.equal(object(metrics.claimFocus).onTop,true);
  await b.evaluate('document.activeElement.blur()');
  // A1: list subgroup rows are lighter than a hovered row and separated by hairlines.
  await b.command('Page.navigate',{url:f.origin+'/workbench/app/?view=list&range=all'});
  await b.waitFor(live+"&&document.querySelector('.ds-list-subgroup>th')!==null&&document.querySelector('.ds-work-row')!==null");
  await move(5,5);
  const sub="document.querySelector('.ds-list-subgroup>th')";
  metrics.subgroup=object(await b.evaluate(`(()=>{const th=${sub},s=getComputedStyle(th),probe=document.createElement('span');const read=v=>{probe.style.backgroundColor='var('+v+')';document.body.append(probe);const c=getComputedStyle(probe).backgroundColor;probe.remove();return c;};return {background:s.backgroundColor,group:read('--bg-group'),hover:read('--bg-subtle'),hairlines:(s.boxShadow.match(/inset/g)??[]).length,header:getComputedStyle(document.querySelector('.ds-work-table thead th')).backgroundColor};})()`));
  const subgroup=object(metrics.subgroup);
  assert.equal(subgroup.background,subgroup.group);assert.equal(subgroup.background,'rgb(251, 251, 250)');assert.notEqual(subgroup.background,subgroup.hover);assert.equal(subgroup.hairlines,2);assert.equal(subgroup.header,'rgb(255, 255, 255)');
  await b.evaluate(`${sub}.scrollIntoView({block:'center'})`);
  await capture('list-1440-subgroup');
  const row="(()=>{const g=document.querySelector('.ds-list-subgroup');let n=g.nextElementSibling;while(n&&!(n.classList.contains('ds-work-row')&&!n.hidden))n=n.nextElementSibling;return n;})()";
  const rowPoint=object(await b.evaluate(`(()=>{const r=${row}.querySelector('.ds-list-reporter').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`));
  await move(Number(rowPoint.x),Number(rowPoint.y));await b.waitFor(`getComputedStyle(${row}).backgroundColor==='rgb(247, 247, 245)'`);
  metrics.subgroupHover={row:await b.evaluate(`getComputedStyle(${row}).backgroundColor`),subgroup:await b.evaluate(`getComputedStyle(${sub}).backgroundColor`)};
  assert.equal(object(metrics.subgroupHover).row,'rgb(247, 247, 245)');assert.equal(object(metrics.subgroupHover).subgroup,'rgb(251, 251, 250)');
  await capture('list-1440-subgroup-hover');
  // A2: 「显示剩余 N 项」 / 「收起」 carry a 14px chevron in --text-secondary with --space-1 before the text.
  await move(5,5);
  const more="document.querySelector('.ds-list-more:not([hidden]) [data-action=expand-column]')";
  await b.waitFor(`${more}!==null`);await b.evaluate(`${more}.scrollIntoView({block:'center'})`);
  const readMore=`(()=>{const m=${more},svg=m.querySelector('svg'),label=m.querySelector('.ds-button-label')??m,s=getComputedStyle(m);return {text:m.textContent,icon:svg?[...svg.classList].find(c=>c.startsWith('lucide-chevron')):null,size:svg?Math.round(svg.getBoundingClientRect().width):0,gap:getComputedStyle(label).columnGap,color:s.color,secondary:(()=>{const p=document.createElement('span');p.style.color='var(--text-secondary)';document.body.append(p);const c=getComputedStyle(p).color;p.remove();return c;})()};})()`;
  const before=object(await b.evaluate(readMore));
  assert.match(String(before.text),/^显示剩余 \d+ 项$/u);assert.equal(before.icon,'lucide-chevron-down');assert.equal(before.size,14);assert.equal(before.gap,'4px');assert.equal(before.color,before.secondary);
  await capture('list-1440-more');
  await b.evaluate(`${more}.click()`);await b.waitFor(`${more}.textContent==='收起'`);
  const after=object(await b.evaluate(readMore));assert.equal(after.icon,'lucide-chevron-up');assert.equal(after.size,14);
  metrics.more={before,after};
  await capture('list-1440-more-expanded');
  // A5: the drawer banner joins the composer frame: same width, no gap, 28px high, top corners = composer corners, lucide pencil, no pencil glyph character.
  await b.command('Page.navigate',{url:f.origin+'/workbench/app/items/ticket/'+editTarget});
  const banner='[data-presence-banner-anchor] [data-presence-field-banner]';
  await b.waitFor(live+`&&document.querySelector('.detail-toolbar-actions [data-workbench-activity]')!==null&&document.querySelector(${JSON.stringify(banner)})!==null`);
  const readBanner=`(()=>{const n=document.querySelector(${JSON.stringify(banner)}),frame=n.closest('[data-presence-banner-anchor]'),a=n.getBoundingClientRect(),c=frame.getBoundingClientRect(),s=getComputedStyle(n),cs=getComputedStyle(frame),svg=n.querySelector('svg'),input=frame.querySelector('textarea');return {text:n.textContent,height:Math.round(a.height),gap:Math.round(c.top-a.bottom),width:Math.round(a.width)===Math.round(c.width),left:Math.round(a.left)===Math.round(c.left),radius:s.borderTopLeftRadius+' '+s.borderTopRightRadius+' '+s.borderBottomLeftRadius+' '+s.borderBottomRightRadius,frameRadius:cs.borderBottomLeftRadius,frameTop:cs.borderTopLeftRadius+' '+cs.borderTopRightRadius,padding:s.paddingLeft+' '+s.paddingRight,font:s.fontSize,pencil:svg?svg.classList.contains('lucide-pencil'):false,icon:svg?Math.round(svg.getBoundingClientRect().width):0,stroke:svg?getComputedStyle(svg).strokeWidth:null,area:frame.closest('[data-activity-field]').getAttribute('data-presence-editing'),locked:input?input.disabled||input.readOnly:null,glyph:document.body.innerHTML.includes('\\u270E')||getComputedStyle(frame.closest('[data-activity-field]'),'::before').content.includes('\\u270E')};})()`;
  const one=object(await b.evaluate(readBanner));
  assert.deepEqual({...one,frameRadius:undefined},{text:'陈悦正在编辑内部备注',height:28,gap:0,width:true,left:true,radius:one.frameRadius+' '+one.frameRadius+' 0px 0px',frameRadius:undefined,frameTop:'0px 0px',padding:'12px 12px',font:'12px',pencil:true,icon:12,stroke:'1.75px',area:'陈悦正在编辑内部备注',locked:false,glyph:false});
  // A6: the capsule's editing tag uses the same token as the board.
  metrics.capsuleColour=await b.evaluate("getComputedStyle(document.querySelector('.detail-toolbar-actions [data-workbench-activity] .ds-presence-tag[data-mode=editing]')).backgroundColor");
  assert.equal(metrics.capsuleColour,object(metrics.editingColour).token);
  await capture('drawer-1440-banner');
  // Two editors of the same field (second one synthetic, see seam above): 「陈悦等 2 人正在编辑内部备注」.
  await b.evaluate("window.__extraEditor='周宁（合成）'");
  await b.waitFor(`/等 2 人正在编辑内部备注$/u.test(document.querySelector(${JSON.stringify(banner)})?.textContent??'')`);
  const two=object(await b.evaluate(readBanner));assert.equal(two.text,'陈悦等 2 人正在编辑内部备注');assert.equal(two.area,'陈悦等 2 人正在编辑内部备注');assert.equal(two.gap,0);
  metrics.banner={one,two};
  await capture('drawer-1440-banner-two');
  // A7: sidebar online row avatars 20px, popover list avatars 24px.
  await b.command('Page.navigate',{url:f.origin+'/workbench/app/?range=all'});
  await b.waitFor(live+"&&document.querySelector('[data-online-colleagues] .ds-online-count')?.textContent==='3'");
  metrics.onlineRow=await b.evaluate("[...document.querySelectorAll('[data-online-colleagues] .ds-presence-stack .ds-avatar')].map(n=>n.getBoundingClientRect().width)");
  assert.deepEqual(metrics.onlineRow,[20,20,20]);
  await capture('sidebar-online');
  await b.evaluate("document.querySelector('[data-online-colleagues] button').click()");await b.waitFor("document.querySelector('.ds-online-panel')!==null");
  metrics.onlinePopover=await b.evaluate("[...document.querySelectorAll('.ds-online-panel .ds-online-avatar')].map(n=>[n.getBoundingClientRect().width,n.getBoundingClientRect().height])");
  assert.deepEqual(metrics.onlinePopover,[[24,24],[24,24],[24,24]]);
  await capture('sidebar-online-popover');
 }catch(error){failure=error;}
 finally{await closeBrowserTestResources([async()=>{if(failure&&browser)await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));},()=>writeFile(join(directory,'receipt.json'),JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG_WITH_REAL_SSE_STREAMS',synthetic:['second internal-note editor 「周宁（合成）」 in the drawer activity read (window.__extraEditor)'],platform:process.platform,metrics,screenshots},null,2)),()=>{for(const one of Object.values(peers))one.stop();},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);}
},{syntheticServiceCodes:true,serviceCatalog:loadServiceCatalog(),workbenchBoardActionsEnabled:true,ticketSelfHandlingEnabled:true,workbenchRealtimeEnabled:true,workbenchActivityEnabled:true,workbenchInternalNotesEnabled:true,presencePeerSessions:true}));
