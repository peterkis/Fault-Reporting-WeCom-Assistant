import {test} from 'node:test';
import {assertWorkbenchPrimaryLabelContrast,chooseWorkbenchSelect,clickWorkbenchControl} from './helpers/heroui-workbench-controls.mjs';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {withT22Fixture,appendT22LiveItem} from './helpers/wbint-t22-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {conversationPost,freshCommand,seedCard21Conversation,seedCard22Conversation} from './helpers/conversation-inbox-fixture.mjs';
import {card22Filters,assertCard22Filters,assertCard22Avatars,captureCard22} from './helpers/card22-presentation.mjs';
import type {ConversationChatEntry} from '../contracts/workbench_conversation_inbox_contracts.js';
import {seedCard23Conversation} from './helpers/conversation-inbox-fixture.mjs';
import {card23Geometry,assertCard23Geometry} from './helpers/card23-presentation.mjs';
import {createCommunicationDeliveryWorker} from '../app/server/src/p2-004-communication-delivery-worker.mjs';
import {createPilotAccessService} from '../app/server/src/p1-009-pilot-access-workbench.mjs';
import {card24Fonts,card24Kbd,card24Conversation,card24Numeric} from './helpers/card24-presentation.mjs';
import {seedCard22Board} from './helpers/web01-workbench-fixture.mjs';
type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;

test('Card24 F1–F4 C1–C9 G1–G3 measure local fonts, four conversation states, board and drawer',{timeout:240000},async()=>{
 await withT22Fixture(async f=>{
  const data=await seedCard23Conversation(f),waiting=data.contacts.waiting,other=data.contacts.earlier;assert.ok(waiting&&other);
  const directory=process.env.CARD24_EVIDENCE_DIR??await mkdtemp(join(tmpdir(),'card24-'));await mkdir(directory,{recursive:true});
  let browser:Browser|undefined,failure:unknown;const metrics:unknown[]=[],posts:string[]=[];
  const observe=(request:import('node:http').IncomingMessage)=>{if(request.method==='POST')posts.push(new URL(request.url??'/',f.origin).pathname);};f.runtime.server.on('request',observe);
  try{
   browser=await launchSystemBrowser({url:f.origin+'/workbench/app/conversations/'+data.session.id,width:1440,height:1080,cookies:[{...f.browserCookie,url:f.origin+'/'}]});assert.ok(browser);
   await browser.waitFor("document.querySelectorAll('[data-message-delivery]').length===4&&Boolean(document.querySelector('.inbox-mini-stage'))");
   metrics.push({page:'conversation',fonts:await card24Fonts(browser)});
   const kbd=await card24Kbd(browser,'.sidebar kbd');assert.deepEqual(await card24Kbd(browser,'#conversation-reply-panel kbd'),kbd);metrics.push({G3:kbd});
   const team=await browser.evaluate("({sidebar:document.querySelector('[data-sidebar-team]').textContent,breadcrumb:document.querySelector('[data-breadcrumb-team]').textContent,height:document.querySelector('.sidebar-brand').getBoundingClientRect().height,icon:document.querySelector('.sidebar-brand-icon').getBoundingClientRect().width,size:getComputedStyle(document.querySelector('.sidebar-brand-copy strong')).fontSize})") as {sidebar:string;breadcrumb:string;height:number;icon:number;size:string};
   assert.equal(team.sidebar,team.breadcrumb);assert.equal(team.height,48);assert.equal(team.icon,28);assert.equal(team.size,'15px');metrics.push({G2:team});
   const header=await browser.evaluate("document.querySelector('h1').getBoundingClientRect().toJSON()") as {x:number;y:number};
   for(const mode of ['allowed','failed','waiting','denied'] as const){
    const cookie=mode==='denied'?f.handlerCookie:f.cookie,split=cookie.indexOf('=');await browser.command('Network.clearBrowserCookies');await browser.command('Network.setCookie',{name:cookie.slice(0,split),value:cookie.slice(split+1),url:f.origin+'/'});
    await browser.evaluate("document.documentElement.dataset.card24Leaving='true'");await browser.command('Page.navigate',{url:f.origin+'/workbench/app/conversations/'+(mode==='waiting'?waiting.id:data.session.id)});
    await browser.waitFor("!document.documentElement.dataset.card24Leaving&&Boolean(document.querySelector('[data-conversation-ready]'))");
    if(mode!=='waiting')await browser.waitFor("document.querySelectorAll('[data-message-delivery]').length===4&&Boolean(document.querySelector('.inbox-mini-stage'))");
    metrics.push({mode,...await card24Conversation(browser,mode)});
    await browser.evaluate(mode==='allowed'?"document.querySelector('.inbox-timeline').scrollTop=0":"document.querySelector('.inbox-timeline').scrollTop=document.querySelector('.inbox-timeline').scrollHeight");
    await captureCard22(browser,directory,'conversation-'+mode+'-1440');
    if(mode==='allowed'){
     await captureCard22(browser,directory,'glyph-bubble-meta-x2','.inbox-message-user:has(+.inbox-message-merged)');
     await browser.command('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});await card24Conversation(browser,mode);await captureCard22(browser,directory,'conversation-allowed-1920');await browser.command('Emulation.setDeviceMetricsOverride',{width:1440,height:1080,deviceScaleFactor:1,mobile:false});
     await browser.evaluate("(()=>{const n=document.querySelector('textarea[data-purpose=messages]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(n,'继续核对打印配置（合成）');n.dispatchEvent(new Event('input',{bubbles:true}));})()");
     await browser.waitFor("Boolean(document.querySelector('[data-action=discard-messages]'))&&document.querySelector('[data-conversation-draft=messages]')?.textContent.includes('草稿已保存')");
     const discard=await browser.evaluate("(()=>{const n=document.querySelector('[data-action=discard-messages]'),s=getComputedStyle(n);return {font:s.fontSize,border:s.borderTopWidth,height:n.getBoundingClientRect().height,parent:n.parentElement.className};})()") as {font:string;border:string;height:number;parent:string};assert.equal(discard.font,'12px');assert.equal(discard.border,'0px');assert.equal(discard.height,24);assert.equal(discard.parent,'ds-composer-status');metrics.push({C4:discard});
     await captureCard22(browser,directory,'detail-composer-bottom-x2','.ds-composer-bottom');await clickWorkbenchControl(browser,'[data-action=discard-messages]');await browser.waitFor("document.querySelector('textarea[data-purpose=messages]').value===''");
    }
   }
   // C6: use the fixture's existing synthetic UPDATE path; exact real delivery IDs remain unchanged.
   await f.pool.query("UPDATE communication.delivery SET last_error_code='COMMUNICATION_SEND_TIMEOUT' WHERE outbox_id=(SELECT id FROM communication.outbox WHERE message_id=$1::uuid)",[data.sent[3]]);
   const cookie=f.cookie,split=cookie.indexOf('=');await browser.command('Network.clearBrowserCookies');await browser.command('Network.setCookie',{name:cookie.slice(0,split),value:cookie.slice(split+1),url:f.origin+'/'});
   await browser.command('Page.navigate',{url:f.origin+'/workbench/app/conversations/'+data.session.id});await browser.waitFor("Boolean(document.querySelector('[data-delivery-label=结果待核实] [title=COMMUNICATION_SEND_TIMEOUT]'))");
   const errors=await browser.evaluate("[...document.querySelectorAll('[data-delivery-label=发送失败],[data-delivery-label=结果待核实]')].map(n=>({text:n.innerText,title:n.title,code:n.querySelector('code')?.textContent,mapped:n.querySelector('[title=COMMUNICATION_SEND_TIMEOUT]')?.textContent}))") as {text:string;title:string;code?:string;mapped?:string}[];
   assert.ok(errors.some(n=>n.text==='发送失败 · 错误码 V23_SYNTHETIC_FAILURE'&&n.code==='V23_SYNTHETIC_FAILURE'&&n.title.includes('V23_SYNTHETIC_FAILURE')));assert.ok(errors.some(n=>n.text==='结果待核实 · 企微接口超时'&&n.mapped==='企微接口超时'&&n.title.includes('COMMUNICATION_SEND_TIMEOUT')));metrics.push({C6:errors});await captureCard22(browser,directory,'detail-errors-x2','.inbox-message-human:has([data-delivery-label=结果待核实])');
   await browser.command('Page.navigate',{url:f.origin+'/workbench/app/conversations/'+other.id});await browser.waitFor("document.querySelector('[data-chat-assignment]')?.textContent==='接待中 · 只读值班'");assert.equal(await browser.evaluate("document.querySelector('[data-chat-assignment]').dataset.tone"),'brand');
   const ended=f.sessions[2];assert.ok(ended);await browser.command('Page.navigate',{url:f.origin+'/workbench/app/conversations/'+ended.id});await browser.waitFor("document.querySelector('[data-chat-assignment]')?.textContent==='已结束'");assert.equal(await browser.evaluate("document.querySelector('[data-chat-assignment]').dataset.tone"),'neutral');
   // Same fixture, current production board and drawer. No browser-mocked API or command.
   await seedCard22Board(f);await browser.command('Network.clearBrowserCache');await browser.command('Network.setCacheDisabled',{cacheDisabled:true});await browser.command('Page.navigate',{url:f.origin+'/workbench/app/'});await browser.waitFor("document.querySelectorAll('.ticket-card').length>=3");
   metrics.push({page:'board',fonts:await card24Fonts(browser)});assert.deepEqual(await card24Kbd(browser,'.ds-board-search kbd'),kbd);
   const boardHeader=await browser.evaluate("({title:document.querySelector('h1').getBoundingClientRect().toJSON(),icon:document.querySelector('.page-icon').getBoundingClientRect().toJSON()})") as {title:{x:number;y:number};icon:{width:number;height:number}};assert.equal(boardHeader.title.x,header.x);assert.equal(boardHeader.title.y,header.y);assert.equal(boardHeader.icon.width,36);assert.equal(boardHeader.icon.height,36);metrics.push({G1:boardHeader});
   await captureCard22(browser,directory,'board-1440');await captureCard22(browser,directory,'glyph-card-x2','.ticket-card');await captureCard22(browser,directory,'glyph-account-x2','.sidebar .account');
   await browser.command('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});await browser.evaluate('scrollTo(0,0)');await captureCard22(browser,directory,'board-1920');await browser.command('Emulation.setDeviceMetricsOverride',{width:1440,height:1080,deviceScaleFactor:1,mobile:false});
   await browser.command('Page.navigate',{url:f.origin+'/workbench/app/?view=list'});await browser.waitFor("document.querySelectorAll('.work-table tbody.list-group td').length>0");
   const listNumeric=await card24Numeric(browser);assert.ok(listNumeric.some(n=>n.selector==='.list-group .column-heading>span'));metrics.push({F1ListNumeric:listNumeric});
   await browser.command('Page.navigate',{url:f.origin+'/workbench/app/'});await browser.waitFor("document.querySelectorAll('.ticket-card').length>=3");
   await clickWorkbenchControl(browser,'.ticket-card .card-open');await browser.waitFor("Boolean(document.querySelector('.detail-body'))");await captureCard22(browser,directory,'drawer-1440');
   await browser.command('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});await browser.evaluate('document.fonts.ready');assert.equal(await browser.evaluate('document.fonts.check(\'14px "Noto Sans SC Variable"\')'),true);await captureCard22(browser,directory,'offline-loaded-fonts-1440');metrics.push({F4:'already loaded page, full browser network offline; this is not a cold Electron start'});await browser.command('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
   assert.deepEqual(posts,[],'presentation verification never POSTs');
  }catch(error){failure=error;}
  finally{await closeBrowserTestResources([()=>writeFile(join(directory,'card24-conversation-metrics.json'),JSON.stringify({metrics,posts},null,2)),()=>{f.runtime.server.off('request',observe);},async()=>{if(failure&&browser)await captureCard22(browser,directory,'card24-failure');},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);}
 },{inbox:true,recovery:true,search:true});
});

test('V1–V13 card23 conversation details use real DTOs and measured geometry in all four states',{timeout:240000},async()=>{
 await withT22Fixture(async f=>{
  const data=await seedCard23Conversation(f),directory=process.env.CARD23_EVIDENCE_DIR??await mkdtemp(join(tmpdir(),'card23-conversation-'));await mkdir(directory,{recursive:true});
  const waiting=data.contacts.waiting;assert.ok(waiting);const metrics:unknown[]=[],posts:string[]=[];
  const listResponse=await fetch(f.origin+'/api/workbench/conversation-inbox?state=open&source=all&limit=30',{headers:{cookie:f.cookie}});
  assert.equal(listResponse.status,200);
  const inbox=await listResponse.json() as {items:{participant_label:string;assignment_summary:{kind:string};latest_activity_at:string}[];next_cursor:string|null};
  assert.deepEqual(Object.keys(inbox).sort(),['items','next_cursor']);assert.ok(inbox.items.some(n=>n.assignment_summary.kind==='UNASSIGNED'));assert.ok(inbox.items.some(n=>n.assignment_summary.kind==='MINE'));assert.ok(inbox.items.some(n=>n.assignment_summary.kind==='SINGLE'));
  assert.equal(inbox.items.some(n=>Object.keys(n).some(k=>/waiting_since|unassigned_since/u.test(k))),false,'V1/V9 contract has no waiting origin');
  const observe=(request:import('node:http').IncomingMessage)=>{if(request.method==='POST')posts.push(new URL(request.url??'/',f.origin).pathname);};f.runtime.server.on('request',observe);
  let browser:Browser|undefined,failure:unknown;
  try{
   browser=await launchSystemBrowser({url:f.origin+'/workbench/app/conversations/'+data.session.id,width:1440,height:1080,cookies:[{...f.browserCookie,url:f.origin+'/'}]});assert.ok(browser);
   await browser.waitFor("Boolean(document.querySelector('[data-conversation-ready]'))&&document.querySelectorAll('[data-message-delivery]').length===4&&document.querySelector('.inbox-business .inbox-mini-stage')&&document.querySelector('[data-conversation-draft=messages]')?.textContent.includes('草稿仅在当前浏览器')");
   const contacts=await browser.evaluate(`[...document.querySelectorAll('[data-contact-ref]')].map(n=>{const time=n.querySelector('time'),badge=n.querySelector('.ds-status-badge'),dot=badge.querySelector('.ds-status-dot');return {text:n.querySelector('strong').textContent,time:time.textContent,title:time.title,dateTime:time.dateTime,status:badge.textContent,color:getComputedStyle(dot).backgroundColor,tone:badge.dataset.tone,waiting:time.classList.contains('inbox-wait-time')};})`) as {text:string;time:string;title:string;dateTime:string;status:string;color:string;tone:string;waiting:boolean}[];
   // Since card 26 a contact nobody has received shows how long it has waited (from the session start, which this fixture does not
   // backdate) and keeps its latest activity in the title; the others show the list time of their latest activity.
   for(const [name,expected] of [['宋岚（合成）','09:35'],['欧阳慧敏（合成）','09:35'],['许初（合成）','昨天'],['何明（合成）','10-21']] as const){const contact=contacts.find(n=>n.text===name);assert.ok(contact);assert.match(contact.dateTime,/T\d{2}:\d{2}:\d{2}\+08:00$/u);
    if(!contact.waiting){assert.equal(contact.time,expected);assert.match(contact.title,/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}（北京时间）$/u);continue;}
    const activity=/^已等待 (.+) · 最近活动 (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})（北京时间）$/u.exec(contact.title);assert.ok(activity,name+' '+contact.title);assert.equal(activity[1],contact.time);
    assert.equal(expected==='昨天'?activity[2]===data.dates.yesterday:/^\d{2}-\d{2}$/u.test(expected)?activity[2]?.slice(5)===expected:activity[2]===data.dates.today&&activity[3]===expected,true,name+' latest activity '+contact.title);}
   assert.equal(contacts.find(n=>n.text==='宋岚（合成）')?.waiting,true,'the unreceived contact shows its waiting time');
   assert.equal(contacts.find(n=>n.text==='宋岚（合成）')?.status,'待接待');assert.equal(contacts.find(n=>n.text==='欧阳慧敏（合成）')?.status,'接待中 · 我');assert.equal(contacts.find(n=>n.text==='何明（合成）')?.status,'接待中');
   const colors=await browser.evaluate(`(()=>{const n=document.createElement('span');document.body.append(n);const result={};for(const tone of ['warning','brand']){n.style.backgroundColor='var(--tone-'+tone+'-dot)';result[tone]=getComputedStyle(n).backgroundColor;}n.remove();return result;})()`) as Record<string,string>;
   for(const contact of contacts)assert.equal(contact.color,colors[contact.tone]);
   metrics.push({V1V11:contacts});
   await captureCard22(browser,directory,'detail-contact-x2','[data-contact-ref]:has([aria-current=page])');
   for(const width of [901,950,1000,1100,1280,1360,1441,1536]){
    await browser.command('Emulation.setDeviceMetricsOverride',{width,height:1080,deviceScaleFactor:1,mobile:false});
    const sample=await card23Geometry(browser);assert.equal(sample.headerOverlap,false,'V3 intermediate width '+width);assert.ok(sample.name.scroll<=sample.name.client);assert.ok(sample.picker.gap>=4);assert.ok(sample.picker.menuGap>=4);assert.equal(sample.picker.indicatorContained,true);assert.equal(sample.overflow,false);metrics.push({V3:'intermediate-width',...sample});
   }
   for(const mode of ['allowed','denied','waiting','failed'] as const){
    const cookie=mode==='denied'?f.handlerCookie:f.cookie,separator=cookie.indexOf('=');
    await browser.command('Network.clearBrowserCookies');
    await browser.command('Network.setCookie',{name:cookie.slice(0,separator),value:cookie.slice(separator+1),url:f.origin+'/'});
    const id=mode==='waiting'?waiting.id:data.session.id;
    await browser.evaluate("document.documentElement.dataset.card23Leaving='true'");
    await browser.command('Page.navigate',{url:f.origin+'/workbench/app/conversations/'+id});
    await browser.waitFor("!document.documentElement.dataset.card23Leaving&&Boolean(document.querySelector('[data-conversation-ready]'))&&Boolean(document.querySelector('textarea[data-purpose=messages]'))");
    if(mode!=='waiting')await browser.waitFor("document.querySelectorAll('[data-message-delivery]').length===4");
    for(const width of [1920,1440,900]){
     await browser.command('Emulation.setDeviceMetricsOverride',{width,height:1080,deviceScaleFactor:1,mobile:false});
     if(mode!=='waiting'){
      await browser.waitFor("Boolean(document.querySelector('.inbox-mini-stage')&&document.querySelector('.inbox-message-user header'))");
      const sample=await card23Geometry(browser);metrics.push({mode,...sample});assertCard23Geometry(sample,mode);
      await browser.evaluate(mode==='allowed'?"document.querySelector('.inbox-timeline').scrollTop=0":"document.querySelector('.inbox-timeline').scrollTop=document.querySelector('.inbox-timeline').scrollHeight");
     }else{
      const sample=await browser.evaluate(`(()=>{const b=document.querySelector('.inbox-reception'),input=document.querySelector('textarea[data-purpose=messages]'),reason=document.getElementById(input.getAttribute('aria-describedby')),draft=document.querySelector('#conversation-reply-panel .inbox-draft-status');return {width:innerWidth,text:b.textContent,visible:b.checkVisibility(),icon:b.querySelector('p>svg').getBoundingClientRect().width,takeover:b.querySelector('[data-action=takeover-conversation] svg').getBoundingClientRect().width,disabled:input.disabled,reason:reason.textContent,reasonHidden:getComputedStyle(reason).clipPath!=='none',described:input.getAttribute('aria-describedby')===reason.id,placeholder:input.placeholder,draftIconOnly:Boolean(draft&&getComputedStyle(draft).clipPath==='none'&&draft.querySelector('svg')&&!draft.querySelector('.inbox-draft-copy'))};})()`) as {text:string;visible:boolean;icon:number;takeover:number;disabled:boolean;reason:string;reasonHidden:boolean;described:boolean;placeholder:string;draftIconOnly:boolean};
      assert.equal(sample.visible,true);assert.equal(sample.text.includes('（资料未提供）'),false);/* Since card 26 the banner states the waiting time from the read projection (design system: 等待横幅). */assert.match(sample.text,/已等待 \S+，尚无人接待/u);assert.equal(sample.icon,16);assert.equal(sample.takeover,14);assert.equal(sample.disabled,true);assert.equal(sample.reason,'领取接待后可回复');assert.equal(sample.reasonHidden,true);assert.equal(sample.described,true);assert.equal(sample.placeholder.includes('Ctrl'),false);assert.equal(sample.draftIconOnly,false);metrics.push({mode,...sample});
     }
     await captureCard22(browser,directory,'conversation-'+mode+'-'+width);
    }
    if(mode==='waiting')await captureCard22(browser,directory,'detail-waiting-x2','.inbox-reception');
    if(mode==='failed'){
     await browser.command('Emulation.setDeviceMetricsOverride',{width:1440,height:1080,deviceScaleFactor:1,mobile:false});
     await captureCard22(browser,directory,'detail-header-x2','.inbox-chat-header');
     const groupClip=await browser.evaluate("(()=>{const nodes=[...document.querySelectorAll('.inbox-message-user')].slice(0,2);nodes[0].scrollIntoView({block:'center'});const a=nodes[0].getBoundingClientRect(),b=nodes[1].getBoundingClientRect();return {x:a.left-8,y:a.top-8,width:Math.max(a.right,b.right)-a.left+16,height:b.bottom-a.top+16,scale:2};})()") as {x:number;y:number;width:number;height:number;scale:number};
     const groupShot=await browser.command('Page.captureScreenshot',{format:'png',clip:groupClip,captureBeyondViewport:true}) as {data:string};
     await writeFile(join(directory,'detail-message-group-x2.png'),Buffer.from(groupShot.data,'base64'));
     await captureCard22(browser,directory,'detail-failure-x2','.inbox-message:has([data-delivery-label="发送失败"])');
     await captureCard22(browser,directory,'detail-reporter-x2','.inbox-business .inbox-reporter');
     await browser.evaluate("(()=>{const n=document.querySelector('textarea[data-purpose=messages]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(n,'请保留打印文件，待核对配置（合成）。');n.dispatchEvent(new Event('input',{bubbles:true}));})()");
     await browser.waitFor("document.querySelector('#conversation-reply-panel .inbox-draft-copy')?.textContent==='草稿已保存'&&!document.querySelector('[data-action=send-conversation-reply]').disabled");
     assert.equal(await browser.evaluate("getComputedStyle(document.querySelector('#conversation-reply-panel .ds-composer-shortcut')).display!=='none'"),true);
     await captureCard22(browser,directory,'detail-composer-bottom-x2','#conversation-reply-panel .ds-composer-bottom');
     await clickWorkbenchControl(browser,'.inbox-business .inbox-open-summary');await browser.waitFor("Boolean(document.querySelector('.inbox-associated-detail'))");
     assert.equal(await browser.evaluate("document.querySelector('#detail-title').textContent"),'护士站打印设备与护理系统连接异常（合成）');
     await clickWorkbenchControl(browser,'[aria-label="关闭详情"]');await browser.waitFor("!document.querySelector('.inbox-associated-detail')");
    }
   }
   assert.deepEqual(posts,[],'V1–V13 presentation, draft input and the existing summary drawer issue no business POST');
  }catch(error){failure=error;}
  finally{await closeBrowserTestResources([
   ()=>{f.runtime.server.off('request',observe);},
   ()=>writeFile(join(directory,'card23-conversation-metrics.json'),JSON.stringify({inbox,metrics,posts},null,2)),
   async()=>{if(failure&&browser)await captureCard22(browser,directory,'card23-failure');},
   async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},
  ],failure);}
 },{inbox:true,recovery:true});
});

test('V4 card23 delivery-only transitions keep the bottom pin and preserve a history reader anchor',{timeout:180000},async()=>{
 await withT22Fixture(async f=>{
  const {session,sent}=await seedCard23Conversation(f),last=sent[3];assert.ok(last);
  await f.pool.query("UPDATE communication.delivery SET status='PENDING',side_effect_state='NOT_ATTEMPTED',send_started_at=NULL,last_error_code=NULL WHERE outbox_id=(SELECT id FROM communication.outbox WHERE message_id=$1::uuid)",[last]);
  let browser:Browser|undefined,failure:unknown;const samples:unknown[]=[];
  const directory=process.env.CARD23_REVIEW_EVIDENCE_DIR??await mkdtemp(join(tmpdir(),'card23-live-delivery-'));await mkdir(directory,{recursive:true});
  try{
   browser=await launchSystemBrowser({url:f.origin+'/workbench/app/conversations/'+session.id,width:1440,height:900,cookies:[{...f.browserCookie,url:f.origin+'/'}]});assert.ok(browser);
   await browser.waitFor("document.querySelectorAll('[data-message-delivery]').length===4");
   const measure=()=>{assert.ok(browser);return browser.evaluate("(()=>{const n=document.querySelector('.inbox-timeline'),top=n.getBoundingClientRect().top,first=[...n.querySelectorAll('[data-conversation-item]')].find(x=>x.getBoundingClientRect().bottom>top);return {gap:n.scrollHeight-n.scrollTop-n.clientHeight,top:n.scrollTop,signature:[...n.querySelectorAll('[data-conversation-item]')].map(x=>[x.dataset.conversationItem,x.querySelector('p')?.textContent]),anchor:first?.dataset.conversationItem,offset:first?first.getBoundingClientRect().top-top:null,newPrompt:Boolean(document.querySelector('.inbox-new-messages'))};})()") as Promise<{gap:number;top:number;signature:unknown;anchor:string|null;offset:number|null;newPrompt:boolean}>;};
   await browser.evaluate("document.querySelector('.inbox-timeline').scrollTop=document.querySelector('.inbox-timeline').scrollHeight");await browser.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
   const before=await measure();assert.ok(before.gap<=1);
   let sends=0;const worker=createCommunicationDeliveryWorker({pool:f.pool,enabled:true,sender:{send:async()=>{sends++;return {outcome:'REJECTED_NOT_APPLIED',provider_message_id:null,error_code:'V23_REVIEW_SYNTHETIC_FAILURE',retryable:false};}}});
   for(const [index,message] of [sent[1],last].entries()){
    assert.ok(message);const response=await fetch(f.origin+'/api/workbench/conversations/'+session.id+'/deliveries?view=chat&message_ids='+message,{headers:{cookie:f.cookie}});assert.equal(response.status,200);
    const page=await response.json() as {items:{delivery_id:string;status:string}[]};assert.equal(page.items[0]?.status,'PENDING');const delivery=page.items[0];assert.ok(delivery);
    let history:Awaited<ReturnType<typeof measure>>|null=null;
    if(index===1){await browser.evaluate("document.querySelector('.inbox-timeline').scrollTop=0");await browser.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');history=await measure();assert.ok(history.gap>48);}
    assert.ok(await worker.deliver({deliveryId:delivery.delivery_id}));await f.runtime.coordinator.runOnce();
    await browser.waitFor('document.querySelector('+JSON.stringify('[data-message-delivery="'+message+'"]')+')?.dataset.deliveryLabel==="发送失败"');await browser.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const after=await measure();assert.deepEqual(after.signature,before.signature);assert.equal(after.newPrompt,false);
    if(history){assert.equal(after.anchor,history.anchor);assert.ok(Math.abs((after.offset??Infinity)-(history.offset??0))<=1);assert.equal(after.top,history.top);}
    else assert.ok(after.gap<=1,'delivery-only footer remains pinned: '+JSON.stringify(after));samples.push({index,before:history??before,after});
   }
   assert.equal(sends,2);
  }catch(error){failure=error;}
  finally{await closeBrowserTestResources([
   ()=>writeFile(join(directory,'delivery-layout.json'),JSON.stringify(samples,null,2)),
   async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},
  ],failure);}
 },{inbox:true,realtime:true,recovery:false});
});

test('V5 card23 only groups a proven Session reporter and keeps same-name staff authors distinct',{timeout:180000},async()=>{
 await withT22Fixture(async f=>{
  const {session,reporterItems}=await seedCard23Conversation(f),label='同名工程师（合成）';assert.equal(reporterItems.length,2);
  await f.pool.query('UPDATE pilot_ticket.pilot_principal SET display_name=$2 WHERE id=$1::uuid',[f.principals[0]?.id,label]);
  await createPilotAccessService({pool:f.pool}).upsertPrincipal({wecomUserId:'web01-synthetic-1',displayName:label,roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});
  const messages:string[]=[];
  for(const [cookie,text] of [[f.cookie,'不同作者甲的回复（合成）'],[f.handlerCookie,'不同作者乙的回复（合成）']] as const){
   const response=await fetch(f.origin+'/api/workbench/conversations/'+session.id+'?view=chat',{headers:{cookie}});assert.equal(response.status,200);const entry=await response.json() as ConversationChatEntry;assert.ok(entry.capabilities.includes('REPLY'));
   const result=await conversationPost(f.origin,cookie,session.id,'messages',{...freshCommand(entry.session.row_version),text});assert.equal(result.status,202);messages.push(String((await result.json() as {message_id:string}).message_id));
  }
  await f.runtime.coordinator.runOnce();assert.equal((await f.pool.query<{count:number}>('SELECT count(DISTINCT sender_principal_id)::integer AS count FROM communication.message WHERE id=ANY($1::uuid[])',[messages])).rows[0]?.count,2);
  let browser:Browser|undefined,failure:unknown;
  try{
   const url=f.origin+'/workbench/app/conversations/'+session.id;
   browser=await launchSystemBrowser({url,width:1440,height:1080,cookies:[{...f.browserCookie,url:f.origin+'/'}]});assert.ok(browser);
   for(const id of messages){
    await browser.waitFor('Boolean(document.querySelector('+JSON.stringify('[data-message-delivery="'+id+'"]')+'))');
    const author=await browser.evaluate('(()=>{const n=document.querySelector('+JSON.stringify('[data-message-delivery="'+id+'"]')+').closest(".inbox-message");return {merged:n.classList.contains("inbox-message-merged"),names:[...n.querySelectorAll("header strong")].map(x=>x.textContent),avatars:n.querySelectorAll(".ds-avatar").length};})()') as {merged:boolean;names:string[];avatars:number};
    assert.equal(author.merged,false);assert.deepEqual(author.names,[label]);assert.equal(author.avatars,1);
   }
   for(const [seconds,merged] of [[300,true],[301,false]] as const){
    await f.pool.query("UPDATE conversation.item SET occurred_at=(SELECT occurred_at+($3::text||' seconds')::interval FROM conversation.item WHERE id=$1::uuid) WHERE id=$2::uuid",[reporterItems[0],reporterItems[1],seconds]);
    await browser.evaluate("document.documentElement.dataset.card23Leaving='true'");await browser.command('Page.navigate',{url});await browser.waitFor('!document.documentElement.dataset.card23Leaving&&Boolean(document.querySelector('+JSON.stringify('[data-conversation-item="'+reporterItems[1]+'"]')+'))');
    const group=await browser.evaluate('(()=>{const n=document.querySelector('+JSON.stringify('[data-conversation-item="'+reporterItems[1]+'"]')+');return {merged:n.classList.contains("inbox-message-merged"),names:n.querySelectorAll("header strong").length,avatars:n.querySelectorAll(".ds-avatar").length};})()') as {merged:boolean;names:number;avatars:number};
    assert.equal(group.merged,merged);assert.equal(group.names,merged?0:1);assert.equal(group.avatars,merged?0:1);
   }
  }catch(error){failure=error;}
  finally{await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);}
 },{inbox:true,recovery:false});
});

test('v2.1.2 G1 S10 C1–C10 use real long contacts, chronological fixtures and shared keyboard filters',{timeout:240000},async()=>{
  await withT22Fixture(async f=>{
    const {session,dates}=await seedCard21Conversation(f),directory=process.env.CARD21_EVIDENCE_DIR??await mkdtemp(join(tmpdir(),'card21-conversation-'));await mkdir(directory,{recursive:true});
    const raw=(await f.pool.query<{sequence_no:string;occurred_at:string;sender_kind:string;item_type:string}>('SELECT sequence_no::text,occurred_at::text,sender_kind,item_type FROM conversation.item WHERE session_id=$1::uuid ORDER BY sequence_no',[session.id])).rows;
    assert.deepEqual(raw.filter(row=>['USER_MESSAGE','AGENT_MESSAGE'].includes(row.item_type)).slice(0,4).map(row=>row.occurred_at),[dates.yesterday+' 16:40:00',dates.yesterday+' 16:52:00',dates.today+' 09:10:00',dates.today+' 09:30:00']);
    assert.ok(raw.every((row,index)=>index===0||row.occurred_at>=(raw[index-1]?.occurred_at??'')),'fixture timestamps, including appended system projections, must follow the original sequence');
    let browser:Browser|undefined,failure:unknown;const posts:string[]=[],metrics:unknown[]=[];
    const observe=(request:import('node:http').IncomingMessage)=>{if(request.method==='POST')posts.push(new URL(request.url??'/',f.origin).pathname);};f.runtime.server.on('request',observe);
    try{
      browser=await launchSystemBrowser({url:f.origin+'/workbench/app/conversations/'+session.id,width:1920,height:1080,cookies:[{...f.browserCookie,url:f.origin+'/'}]});assert.ok(browser);
      await browser.waitFor("Boolean(document.querySelector('[data-conversation-ready]'))&&document.querySelector('.inbox-associated')?.textContent.includes('当前状态')&&document.querySelector('.inbox-message-internal_note')?.textContent.includes('已联系同事')");
      for(const width of [1920,1440,1280,900]){
        await browser.command('Emulation.setDeviceMetricsOverride',{width,height:1080,deviceScaleFactor:1,mobile:false});
        await browser.evaluate('window.scrollTo(0,0);document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
        const sample=await browser.evaluate(`(()=>{const row=[...document.querySelectorAll('[data-contact-ref]')].find(n=>n.textContent.includes('欧阳慧敏')),t=row.querySelector('time'),title=row.querySelector('.inbox-contact-title'),preview=row.querySelector('.inbox-contact-preview'),note=document.querySelector('.inbox-message-internal_note'),header=document.querySelector('.ds-page-header'),toolbar=document.querySelector('.ds-toolbar'),chip=document.querySelector('.ds-filter-chip'),search=document.querySelector('.inbox-search .ds-search-field'),mini=document.querySelector('.inbox-mini-ticket'),root=getComputedStyle(document.documentElement);return {width:innerWidth,title:document.querySelector('h1').getBoundingClientRect().toJSON(),headerGap:toolbar.getBoundingClientRect().top-header.getBoundingClientRect().bottom,timeRight:t.getBoundingClientRect().right,rowRight:row.getBoundingClientRect().right,timeText:t.textContent,grid:getComputedStyle(title).display,preview:preview.textContent,ellipsis:getComputedStyle(preview).textOverflow,previewWhiteSpace:getComputedStyle(preview).whiteSpace,dates:[...document.querySelectorAll('.inbox-message-divider time')].map(n=>n.textContent),dividers:[...document.querySelectorAll('.inbox-message-divider')].map(n=>n.textContent),note:note.innerText,noteLabel:note.querySelectorAll('.ds-message-prefix').length,lock:note.querySelectorAll('.inbox-internal-lock').length,systemHeaders:document.querySelectorAll('.inbox-message-system header').length,systemTimes:document.querySelectorAll('.inbox-message-system .ds-message-bubble time').length,systemCount:document.querySelectorAll('.inbox-message-system').length,chipHeight:chip.getBoundingClientRect().height,searchHeight:search.getBoundingClientRect().height,searchBorder:getComputedStyle(search).borderTopWidth,searchBg:getComputedStyle(search).backgroundColor,pagination:document.querySelectorAll('.inbox-pagination button').length,miniPadding:getComputedStyle(mini.querySelector('.card-open')).paddingTop,miniTitle:getComputedStyle(mini.querySelector('h3')).fontSize,miniCategory:mini.querySelectorAll('.ds-ticket-category').length,miniStage:mini.querySelectorAll('.ds-stage-glyph').length,miniHeat:mini.querySelectorAll('.ds-ticket-heat').length,miniOwnerVisible:mini.querySelector('.card-footer').checkVisibility(),scrollbar:getComputedStyle(document.querySelector('.inbox-timeline'),'::-webkit-scrollbar').width,brand:root.getPropertyValue('--tone-brand-solid').trim(),overflow:document.documentElement.scrollWidth>innerWidth};})()`) as {width:number;title:{x:number;y:number};headerGap:number;timeRight:number;rowRight:number;timeText:string;grid:string;preview:string;ellipsis:string;previewWhiteSpace:string;dates:string[];dividers:string[];note:string;noteLabel:number;lock:number;systemHeaders:number;systemTimes:number;systemCount:number;chipHeight:number;searchHeight:number;searchBorder:string;searchBg:string;pagination:number;miniPadding:string;miniTitle:string;miniCategory:number;miniStage:number;miniHeat:number;miniOwnerVisible:boolean;scrollbar:string;brand:string;overflow:boolean};
        assert.equal(sample.headerGap,12);assert.equal(sample.chipHeight,32);assert.equal(sample.searchHeight,32);assert.equal(sample.searchBorder,'0px');assert.equal(sample.searchBg,'rgb(241, 241, 239)');
        if(width>900){assert.equal(sample.grid,'grid');assert.ok(sample.timeRight<=sample.rowRight+1,'C1 time right edge at '+width);assert.match(sample.timeText,/^\d{2}:\d{2}$/u);assert.ok(sample.preview.length>60);}
        assert.equal(sample.ellipsis,'ellipsis');assert.equal(sample.previewWhiteSpace,'nowrap');assert.deepEqual(sample.dates,['昨天','今天']);assert.deepEqual(sample.dividers,['昨天','今天 · 切换到 Bot 私聊']);
        assert.equal(sample.noteLabel,1);assert.equal(sample.lock,1);assert.equal((sample.note.match(/内部/gu)??[]).length,1);assert.equal(sample.systemHeaders,0);assert.equal(sample.systemTimes,sample.systemCount);assert.ok(sample.systemCount>0);
        assert.equal(sample.pagination,0);assert.equal(sample.miniPadding,'10px');assert.equal(sample.miniTitle,'13px');assert.equal(sample.miniCategory,1);assert.equal(sample.miniStage,1);assert.equal(sample.miniHeat,1);assert.equal(sample.miniOwnerVisible,false);assert.equal(sample.scrollbar,'8px');assert.equal(sample.brand.toUpperCase(),'#2563C9');assert.equal(sample.overflow,false);
        metrics.push(sample);await writeFile(join(directory,'conversation-'+width+'.png'),Buffer.from(await browser.screenshot(),'base64'));
        await browser.command('Page.navigate',{url:f.origin+'/workbench/app/'});await browser.waitFor("document.querySelectorAll('.ds-board-filter-row .ds-filter-chip').length===2");
        const boardTitle=await browser.evaluate("document.querySelector('h1').getBoundingClientRect().toJSON()") as {x:number;y:number};assert.equal(boardTitle.x,sample.title.x);assert.equal(boardTitle.y,sample.title.y);
        const chips=await browser.evaluate("[...document.querySelectorAll('.ds-board-filter-row .ds-filter-chip')].map(n=>{const trigger=n.querySelector('[data-slot=select-trigger]'),icon=n.querySelector('.ds-filter-chip-icon svg'),label=trigger.querySelector('.ds-board-filter-label'),arrow=trigger.querySelector('[data-slot=select-default-indicator]');return {height:n.getBoundingClientRect().height,iconLeft:icon.getBoundingClientRect().left-n.getBoundingClientRect().left,iconGap:label.getBoundingClientRect().left-icon.getBoundingClientRect().right,arrowGap:arrow.getBoundingClientRect().left-label.getBoundingClientRect().right,labelCenterDelta:Math.abs((label.getBoundingClientRect().top+label.getBoundingClientRect().bottom-n.getBoundingClientRect().top-n.getBoundingClientRect().bottom)/2)};})") as {height:number;iconLeft:number;iconGap:number;arrowGap:number;labelCenterDelta:number}[];
        assert.ok(chips.every(n=>n.height===32&&n.iconLeft===11&&n.iconGap===6&&n.arrowGap===6&&n.labelCenterDelta<=1),'G1 official board 01 spacing');
        await browser.evaluate('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
        // The 77px reference includes 39px of CJK text. CI may use fallback glyphs;
        // verify the same fixed geometry around its actual text, rather than a system font.
        const stages=await browser.evaluate("[...document.querySelectorAll('.ds-board-column .ds-status-badge[data-stage]')].map(n=>{const c=getComputedStyle(n),text=n.querySelector('.ds-status-text'),icon=n.querySelector('.ds-stage-glyph');return {width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height,textWidth:text.getBoundingClientRect().width,iconWidth:icon.getBoundingClientRect().width,paddingLeft:c.paddingLeft,paddingRight:c.paddingRight,gap:c.columnGap,font:c.fontSize,weight:c.fontWeight};})") as {width:number;height:number;textWidth:number;iconWidth:number;paddingLeft:string;paddingRight:string;gap:string;font:string;weight:string}[];assert.equal(stages.length,3);assert.ok(stages.every(n=>Math.abs(n.width-n.textWidth-38)<=1&&n.height===26&&n.iconWidth===14&&n.paddingLeft==='8px'&&n.paddingRight==='10px'&&n.gap==='6px'&&n.font==='13px'&&n.weight==='600'),'column labels use official board 01, never discussion 06: '+JSON.stringify(stages));metrics.push({boardWidth:width,stages});
        await writeFile(join(directory,'board-'+width+'.png'),Buffer.from(await browser.screenshot(),'base64'));
        await browser.command('Page.navigate',{url:f.origin+'/workbench/app/conversations/'+session.id});await browser.waitFor("Boolean(document.querySelector('[data-conversation-ready]'))&&Boolean(document.querySelector('.inbox-message-internal_note'))&&document.querySelector('.inbox-associated')?.textContent.includes('当前状态')");
      }
      await browser.command('Emulation.setDeviceMetricsOverride',{width:1440,height:1080,deviceScaleFactor:1,mobile:false});
      const queue='[data-field-label="收件箱队列"] [data-slot=select-trigger]',source='[data-field-label="收件箱来源"]';
      assert.equal(await browser.evaluate('document.querySelector('+JSON.stringify(queue)+').closest(".ds-filter-chip").title'),'当前：进行中');
      await browser.evaluate('document.querySelector('+JSON.stringify(queue)+').focus()');
      for(const type of ['keyDown','keyUp'])await browser.command('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
      await browser.waitFor("Boolean(document.querySelector('.ds-filter-chip[data-filter-open]'))");await clickWorkbenchControl(browser,'[role=option][data-key=unassigned]');
      await browser.waitFor("new URLSearchParams(location.search).get('state')==='unassigned'");await chooseWorkbenchSelect(browser,source,'group');
      await browser.waitFor("new URLSearchParams(location.search).get('source')==='group'");
      await browser.evaluate('document.querySelector(\'[aria-label="清除队列筛选"]\').focus()');
      for(const type of ['keyDown','keyUp'])await browser.command('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
      assert.equal(await browser.evaluate("new URLSearchParams(location.search).get('state')"),'open');assert.equal(await browser.evaluate("new URLSearchParams(location.search).get('source')"),'group');assert.equal(await browser.evaluate("document.activeElement?.closest('[data-field-label]')?.dataset.fieldLabel"),'收件箱队列');
      await browser.evaluate('document.querySelector('+JSON.stringify(queue)+').focus()');
      for(const type of ['keyDown','keyUp'])await browser.command('Input.dispatchKeyEvent',{type,key:' ',code:'Space',windowsVirtualKeyCode:32});
      await browser.waitFor("Boolean(document.querySelector('.ds-filter-chip[data-filter-open]'))");
      for(const type of ['keyDown','keyUp'])await browser.command('Input.dispatchKeyEvent',{type,key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      await browser.waitFor("!document.querySelector('.ds-filter-chip[data-filter-open]')");
      const groupValue=await browser.waitFor("[...(document.querySelector('[data-field-label=\"具体来源群\"] select')?.options??[])].find(option=>option.value&&option.value!=='all')?.value");assert.equal(typeof groupValue,'string');
      await chooseWorkbenchSelect(browser,'[data-field-label="具体来源群"]',String(groupValue));
      await clickWorkbenchControl(browser,'[aria-label="清除来源筛选"]');
      assert.equal(await browser.evaluate("new URLSearchParams(location.search).get('source_group_ref')"),groupValue,'clearing source preserves the separately selected source group');assert.equal(await browser.evaluate("new URLSearchParams(location.search).get('source')??'all'"),'all');assert.equal(await browser.evaluate("new URLSearchParams(location.search).get('state')"),'open');
      assert.deepEqual(posts,[],'G1 presentation and filter navigation issue no business commands');
      f.runtime.server.off('request',observe);
      const sourceNote='内部：保留报修沟通中的原文前缀（合成）。',entry=await (await fetch(f.origin+'/api/workbench/conversations/'+session.id+'?view=chat',{headers:{cookie:f.cookie}})).json() as ConversationChatEntry;
      assert.equal((await conversationPost(f.origin,f.cookie,session.id,'internal-notes',{...freshCommand(entry.session.row_version),text:sourceNote})).status,201);await f.runtime.coordinator.runOnce();
      await browser.command('Page.navigate',{url:f.origin+'/workbench/app/conversations/'+session.id});await browser.waitFor("[...document.querySelectorAll('.inbox-message-internal_note p')].some(node=>node.textContent==="+JSON.stringify(sourceNote)+')');
      await writeFile(join(directory,'conversation-metrics.json'),JSON.stringify({raw,metrics,posts,sourcePrefixPreserved:true},null,2));console.log('CARD21_CONVERSATION_EVIDENCE '+directory);
    }catch(error){failure=error;if(browser){await writeFile(join(directory,'conversation-failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'conversation-failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText,url:location.href})')));}}
    finally{f.runtime.server.off('request',observe);await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);}
  },{inbox:true,personalRead:false,recovery:true});
});

test('the production workspace reads real scoped topics, keeps input and selection during new material, and labels 202 as pending delivery',async()=>{
  await withT22Fixture(async({origin,browserCookie,pool,sessions})=>{
    const session=sessions[0],other=sessions[1];assert.ok(session);assert.ok(other);
    const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);let browser:Awaited<ReturnType<typeof launchSystemBrowser>>|undefined,failure:unknown;
    try{
      browser=await launchSystemBrowser({url:origin+'/workbench/app/',width:1920,height:1080,cookies:[{...browserCookie,url:origin+'/'}]});assert.ok(browser);
      await browser.waitFor("document.querySelectorAll('.ticket-card').length>0");
      assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-action=open-conversations]'))"),true);
      await browser.evaluate("document.querySelector('[data-action=open-conversations]').click()");
      await browser.waitFor(`Boolean(document.querySelector('[data-conversation-id="${session.id}"]')&&document.querySelector('[data-conversation-id="${other.id}"]'))`);
      assert.equal(await browser.evaluate(`Boolean(document.querySelector('[data-conversation-id="${sessions[2]?.id}"]'))`),false);
      const topics=await browser.evaluate(`[document.querySelector('[data-conversation-id="${session.id}"] p').textContent,document.querySelector('[data-conversation-id="${other.id}"] p').textContent]`) as string[];
      assert.ok(topics[0]);assert.ok(topics[1]);assert.notEqual(topics[0],topics[1]);
      await browser.evaluate(`document.querySelector('[data-conversation-id="${session.id}"] a').click()`);
      await browser.waitFor("document.querySelector('[data-conversation-ready]')&&document.querySelector('[data-conversation-draft]')?.textContent.includes('草稿仅在当前浏览器')");
      assert.equal(await browser.evaluate("document.querySelector('[data-conversation-timeline]').textContent.includes('参与者甲的打印机主题')"),true);
      assert.equal(await browser.evaluate("document.querySelector('[data-conversation-timeline]').textContent.includes('参与者乙的护理主题')"),false);
      await browser.evaluate("(()=>{const input=document.querySelector('textarea[data-purpose=messages]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'T22 browser preserved reply');input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();input.setSelectionRange(4,11);})()");
      await browser.waitFor("document.querySelector('[data-conversation-draft=messages]').textContent.includes('已保存恢复副本')");
      await appendT22LiveItem(pool,session.id,'T22 arrived while writing',10);await pool.query('UPDATE conversation.session SET row_version=row_version+1,generation_version=generation_version+1 WHERE id=$1::uuid',[session.id]);
      await browser.waitFor("document.querySelector('[data-conversation-timeline]').textContent.includes('T22 arrived while writing')");
      assert.deepEqual(await browser.evaluate("(()=>{const input=document.querySelector('textarea[data-purpose=messages]');return {value:input.value,start:input.selectionStart,end:input.selectionEnd,focused:document.activeElement===input};})()"),{value:'T22 browser preserved reply',start:4,end:11,focused:true});
      await assertWorkbenchPrimaryLabelContrast(browser,'[data-action=send-conversation-reply]');
      await browser.evaluate("document.querySelector('[data-action=send-conversation-reply]').click()");
      await browser.waitFor("document.querySelector('[data-reply-outcome]').textContent.includes('已受理发送')");
      assert.equal(await browser.evaluate("document.querySelector('[data-reply-outcome]').textContent.includes('发送成功')"),false);
      await browser.waitFor("document.querySelector('[data-conversation-deliveries]').textContent.includes('待发送')");
      const bytes=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,'new-detail-page-1920.png');await writeFile(file,bytes);
      console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',conversation_workspace:true,screenshots:[{file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')}]}));
    }catch(error){failure=error;try{if(browser){await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText,url:location.href})')));}}catch(diagnosticFailure){failure=new AggregateError([failure,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
  });
});

test('R1 R3 R4 R5 card22 merged dividers, actual reply capabilities and aligned conversation filters',{timeout:240000},async()=>{
 await withT22Fixture(async f=>{
  const {session,dates}=await seedCard22Conversation(f),directory=process.env.CARD22_EVIDENCE_DIR??await mkdtemp(join(tmpdir(),'card22-conversation-'));await mkdir(directory,{recursive:true});
  const metrics:unknown[]=[],posts:string[]=[];const observe=(request:import('node:http').IncomingMessage)=>{if(request.method==='POST')posts.push(new URL(request.url??'/',f.origin).pathname);};f.runtime.server.on('request',observe);
  let scenarioFailure:unknown;
  try{for(const [account,cookie,allowed] of [['denied',f.handlerCookie,false],['allowed',f.cookie,true]] as const){
   const response=await fetch(f.origin+'/api/workbench/conversations/'+session.id+'?view=chat',{headers:{cookie}});assert.equal(response.status,200);const entry=await response.json() as ConversationChatEntry;
   assert.equal(entry.capabilities.includes('REPLY'),allowed);assert.equal(entry.capabilities.includes('INTERNAL_NOTE'),allowed);
   const separator=cookie.indexOf('='),browserCookie={name:cookie.slice(0,separator),value:cookie.slice(separator+1),url:f.origin+'/'};let browser:Browser|undefined,failure:unknown;
   try{
    browser=await launchSystemBrowser({url:f.origin+'/workbench/app/conversations/'+session.id,width:1440,height:1080,cookies:[browserCookie]});assert.ok(browser);
    await browser.waitFor("Boolean(document.querySelector('[data-conversation-ready]'))&&Boolean(document.querySelector('textarea[data-purpose=messages]'))&&Boolean(document.querySelector('.inbox-message-internal_note'))");
    const sample=await browser.evaluate("(()=>{const input=document.querySelector('textarea[data-purpose=messages]'),reason=document.querySelector('#audience-messages'),probe=document.createElement('span');probe.style.backgroundColor='var(--bg-subtle)';document.body.append(probe);const token=getComputedStyle(probe).backgroundColor;probe.remove();return {sidebar:document.querySelector('.read-only-badge').textContent,disabled:input.disabled,background:getComputedStyle(input).backgroundColor,token,cursor:getComputedStyle(input).cursor,reason:reason.textContent,reasonVisible:reason.checkVisibility()&&getComputedStyle(reason).clipPath==='none',countVisible:document.querySelector('#conversation-reply-panel .ds-composer-count').checkVisibility(),sendDisabled:document.querySelector('[data-action=send-conversation-reply]').disabled,dividers:[...document.querySelectorAll('.inbox-message-divider')].map(n=>n.textContent),dividerStyles:[...document.querySelectorAll('.inbox-message-divider')].map(n=>{const s=getComputedStyle(n),b=getComputedStyle(n,'::before'),a=getComputedStyle(n,'::after');return {marginTop:s.marginTop,marginBottom:s.marginBottom,beforeHeight:b.height,afterHeight:a.height,beforeColor:b.backgroundColor,afterColor:a.backgroundColor};}),headerName:document.querySelector('.inbox-chat-person .ds-avatar').getAttribute('aria-label'),headerTitle:document.querySelector('.inbox-chat-person .ds-avatar').title,composerAvatars:document.querySelectorAll('.inbox-composer [data-slot=avatar-fallback]').length};})()") as {sidebar:string;disabled:boolean;background:string;token:string;cursor:string;reason:string;reasonVisible:boolean;countVisible:boolean;sendDisabled:boolean;dividers:string[];dividerStyles:unknown[];headerName:string;headerTitle:string;composerAvatars:number};
    assert.equal(sample.sidebar,'只读');assert.equal(sample.disabled,!allowed);assert.equal(sample.headerName,'欧阳慧敏（合成）');assert.equal(sample.headerTitle,sample.headerName);assert.deepEqual(sample.dividers,['昨天','今天 · 切换到 Bot 私聊']);assert.equal(sample.dividerStyles.length,2);assert.deepEqual(sample.dividerStyles[0],sample.dividerStyles[1]);
    if(!allowed){assert.equal(sample.reason,'你当前没有回复权限');assert.equal(sample.reasonVisible,true);assert.equal(sample.background,sample.token);assert.equal(sample.cursor,'not-allowed');assert.equal(sample.countVisible,false);assert.equal(sample.sendDisabled,true);}
    else{assert.equal(sample.reasonVisible,false);assert.equal(await browser.evaluate("document.querySelectorAll('.ds-composer-disabled-reason').length"),0);assert.equal(sample.countVisible,true);}
    metrics.push({R4:account,capabilities:entry.capabilities,...sample,avatars:await assertCard22Avatars(browser)});
    for(const width of [1440,1920]){await browser.command('Emulation.setDeviceMetricsOverride',{width,height:1080,deviceScaleFactor:1,mobile:false});await captureCard22(browser,directory,'conversation-'+account+'-'+width);}
    await captureCard22(browser,directory,'conversation-composer-'+account,'.inbox-composer');
    await clickWorkbenchControl(browser,'#conversation-note-tab');assert.equal(await browser.evaluate("document.querySelector('textarea[data-purpose=internal-notes]').disabled"),!allowed);
    if(!allowed){assert.equal(await browser.evaluate("document.querySelector('#audience-internal-notes').textContent"),'你当前没有内部备注权限');assert.equal(await browser.evaluate("document.querySelector('#audience-internal-notes').checkVisibility()"),true);}
    await clickWorkbenchControl(browser,'#conversation-reply-tab');
    if(allowed){
     await captureCard22(browser,directory,'avatar-conversation-header','.inbox-chat-person');
     await browser.command('Emulation.setDeviceMetricsOverride',{width:1440,height:1080,deviceScaleFactor:1,mobile:false});
     const defaults=await card22Filters(browser,'.inbox-search .ds-search-field');assert.ok(defaults.search);assertCard22Filters(defaults);assert.ok(defaults.chips.every(chip=>!chip.active));metrics.push({R5:'conversation-inactive',...defaults});
     await chooseWorkbenchSelect(browser,'[data-field-label="收件箱来源"]','group');
     const active=await card22Filters(browser,'.inbox-search .ds-search-field');assertCard22Filters(active);assert.ok(active.chips.some(chip=>chip.active));metrics.push({R5:'conversation-active',...active});await captureCard22(browser,directory,'toolbar-conversation-1440','.conversation-inbox-workspace>.ds-toolbar');
     const id=await appendT22LiveItem(f.pool,session.id,'已回到群内补充现场进展（合成）。');await f.pool.query('UPDATE conversation.item SET occurred_at=$2::timestamp WHERE id=$1::uuid',[id,dates.today+' 10:00:00']);
     await browser.command('Page.navigate',{url:f.origin+'/workbench/app/conversations/'+session.id});await browser.waitFor("document.querySelectorAll('.inbox-message-divider').length===3");
     const dividers=await browser.evaluate("[...document.querySelectorAll('.inbox-message-divider')].map(n=>n.textContent)");assert.deepEqual(dividers,['昨天','今天 · 切换到 Bot 私聊','切换到 群内原始消息']);metrics.push({R3:'midday-switch',dividers});
     await browser.evaluate("document.querySelector('.inbox-timeline').scrollTop=0");await captureCard22(browser,directory,'conversation-dividers-1440');
     const waiting=f.sessions[0];assert.ok(waiting);await browser.command('Page.navigate',{url:f.origin+'/workbench/app/conversations/'+waiting.id});await browser.waitFor("Boolean(document.querySelector('[data-conversation-ready]'))&&Boolean(document.querySelector('textarea[data-purpose=messages]'))");
     assert.equal(await browser.evaluate("document.querySelector('#audience-messages').textContent==='领取接待后可回复'&&getComputedStyle(document.querySelector('#audience-messages')).clipPath!=='none'&&document.querySelector('textarea[data-purpose=messages]').disabled"),true,'V7 waiting reason remains accessible and visually hidden; original recovery-enabled half-screen regression also runs separately');
    }
   }catch(error){failure=error;}
   finally{await closeBrowserTestResources([
    async()=>{if(failure&&browser)await captureCard22(browser,directory,'conversation-'+account+'-failure');},
    async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},
   ],failure);}
  }assert.deepEqual(posts,[],'presentation and no-capability inputs produce no write requests');}
  catch(error){scenarioFailure=error;}
  finally{await closeBrowserTestResources([
   ()=>{f.runtime.server.off('request',observe);},
   ()=>writeFile(join(directory,'conversation-metrics.json'),JSON.stringify(metrics,null,2)),
  ],scenarioFailure);}
 },{inbox:true,personalRead:false,recovery:false});
});
