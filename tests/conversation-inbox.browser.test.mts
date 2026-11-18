import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {withT22Fixture,appendT22LiveItem} from './helpers/wbint-t22-fixture.mjs';
import type {T22Fixture} from './helpers/wbint-t22-fixture.mjs';
import {conversationPost,freshCommand,addInboxSession,attachInboxJourney,seedCard25bConversation,seedCard26Conversation} from './helpers/conversation-inbox-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {clickWorkbenchControl,assertWorkbenchPrimaryLabelContrast} from './helpers/heroui-workbench-controls.mjs';
import {createCommunicationDeliveryWorker} from '../app/server/src/p2-004-communication-delivery-worker.mjs';
import {createPilotAccessService} from '../app/server/src/p1-009-pilot-access-workbench.mjs';
import type {ConversationChatEntry,ConversationRelatedPage} from '../contracts/workbench_conversation_inbox_contracts.js';
import type {ConversationCommandReceipt,ConversationTextCommand} from '../contracts/workbench_conversation_workspace_contracts.js';
type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
const afterPaint='new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))';
const input=(purpose:string,text:string)=>`(()=>{const input=document.querySelector('textarea[data-purpose="${purpose}"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();})()`;
const ready="Boolean(document.querySelector('[data-conversation-ready]'))&&document.querySelector('[data-conversation-draft=messages]')?.textContent.includes('草稿')&&document.querySelector('[data-realtime-status]')?.dataset.realtimeStatus==='live'";
const inboxLive="Boolean(document.querySelector('[data-conversation-ready]'))&&document.querySelector('[data-realtime-status]')?.dataset.realtimeStatus==='live'";

async function verifyCard26Presentation(f:T22Fixture,active:Browser){
  type Rect={left:number;right:number;top:number;bottom:number;width:number;height:number};
  const directory=await mkdtemp(join(tmpdir(),'card26-inbox-')),shots:Record<string,unknown>[]=[],headerSamples:Record<string,unknown>[]=[],samples:Record<string,unknown>[]=[],writes:string[]=[];
  const observe=(request:import('node:http').IncomingMessage)=>{if(request.method==='POST')writes.push(new URL(request.url??'/',f.origin).pathname);};f.runtime.server.on('request',observe);
  try{
    const fallback=f.sessions[1];assert.ok(fallback);
    const fallbackResponse=await fetch(f.origin+'/api/workbench/conversations/'+fallback.id+'?view=chat',{headers:{cookie:f.cookie}});assert.equal(fallbackResponse.status,200);const fallbackDetail=await fallbackResponse.json() as ConversationChatEntry;
    await active.command('Emulation.setDeviceMetricsOverride',{width:1440,height:1080,deviceScaleFactor:1,mobile:false});
    if(await active.evaluate("document.querySelector('.app').classList.contains('sidebar-collapsed')")){await clickWorkbenchControl(active,'.topbar [aria-label="展开侧栏"]');await active.waitFor("!document.querySelector('.app').classList.contains('sidebar-collapsed')");}
    await active.command('Page.navigate',{url:f.origin+'/workbench/app/conversations/'+fallback.id});
    await active.waitFor(`location.pathname===${JSON.stringify('/workbench/app/conversations/'+fallback.id)}&&Boolean(document.querySelector('[data-conversation-ready]'))&&Boolean(document.querySelector('.inbox-chat-channel'))`);await active.evaluate('document.fonts.ready');
    for(const width of [1360,1366,1440]){
      await active.command('Emulation.setDeviceMetricsOverride',{width,height:1080,deviceScaleFactor:1,mobile:false});await active.evaluate(afterPaint);
      const sample=await active.evaluate("(()=>{const header=document.querySelector('.inbox-chat-header'),name=document.querySelector('.inbox-chat-name h2'),channel=document.querySelector('.inbox-chat-channel'),picker=document.querySelector('.inbox-topic-picker'),rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};return {width:innerWidth,scale:visualViewport.scale,dpr:devicePixelRatio,name:name.textContent,channel:channel.textContent,channelClient:channel.clientWidth,channelScroll:channel.scrollWidth,headerRect:rect(header),nameRect:rect(name),lineRect:rect(channel.parentElement),channelRect:rect(channel),pickerRect:rect(picker)};})()") as {width:number;scale:number;dpr:number;name:string;channel:string;channelClient:number;channelScroll:number;headerRect:Rect;nameRect:Rect;lineRect:Rect;channelRect:Rect;pickerRect:Rect};
      headerSamples.push(sample);assert.equal(sample.scale,1);assert.equal(sample.dpr,1);assert.equal(sample.name,'报修人');assert.equal(sample.channel,fallbackDetail.channel_label);assert.ok(sample.channelScroll<=sample.channelClient,'fallback channel text at '+width+': '+JSON.stringify(sample));assert.ok(sample.channelRect.left>=sample.lineRect.left-1&&sample.channelRect.right<=sample.lineRect.right+1&&sample.channelRect.top>=sample.lineRect.top-1&&sample.channelRect.bottom<=sample.lineRect.bottom+1,'fallback channel remains within its line at '+width+': '+JSON.stringify(sample));assert.ok(sample.pickerRect.width<=240,'fallback topic picker at '+width);
    }
    // Real synthetic setup commands are excluded from the presentation-only POST observation.
    f.runtime.server.off('request',observe);const data=await seedCard26Conversation(f);
    const detailResponse=await fetch(f.origin+'/api/workbench/conversations/'+data.session.id+'?view=chat&include_waiting_since=true',{headers:{cookie:f.cookie}});assert.equal(detailResponse.status,200);const detail=await detailResponse.json() as ConversationChatEntry;f.runtime.server.on('request',observe);
    await active.command('Emulation.setDeviceMetricsOverride',{width:1440,height:1080,deviceScaleFactor:1,mobile:false});
    await active.command('Page.navigate',{url:f.origin+'/workbench/app/conversations/'+data.session.id});
    await active.waitFor(`location.pathname===${JSON.stringify('/workbench/app/conversations/'+data.session.id)}&&Boolean(document.querySelector('[data-conversation-ready]'))&&Boolean(document.querySelector('.inbox-mini-ticket .inbox-mini-stage'))&&Boolean(document.querySelector('.ds-message-bubble[data-side=incoming][data-group-position=rest]'))`);
    await active.evaluate('document.fonts.ready');
    const corners=await active.evaluate("(()=>{const radii=node=>{const s=getComputedStyle(node);return [s.borderTopLeftRadius,s.borderTopRightRadius,s.borderBottomRightRadius,s.borderBottomLeftRadius];};const first=document.querySelector('.ds-message-bubble[data-side=incoming][data-group-position=first]'),rest=document.querySelector('.ds-message-bubble[data-side=incoming][data-group-position=rest]'),outgoing=document.querySelector('.ds-message-bubble[data-side=outgoing][data-group-position=first]:not([data-internal])');return {incoming:radii(first),rest:radii(rest),outgoing:radii(outgoing),backgrounds:[first,rest,outgoing].map(node=>getComputedStyle(node).backgroundColor)};})()") as {incoming:string[];rest:string[];outgoing:string[];backgrounds:string[]};
    assert.deepEqual(corners.incoming,['4px','12px','12px','12px']);assert.deepEqual(corners.rest,['12px','12px','12px','12px']);assert.deepEqual(corners.outgoing,['12px','4px','12px','12px']);assert.ok(corners.backgrounds.every(color=>color!=='rgba(0, 0, 0, 0)'&&color!=='transparent'));
    assert.equal(await active.evaluate("[...document.querySelectorAll('.inbox-contact-bottom')].some(node=>/(?:^|[^\\d])0 个/u.test(node.textContent))"),false,'zero group or topic labels are omitted');
    assert.equal(await active.evaluate(`document.querySelector('[data-contact-ref] a[href^="/workbench/app/conversations/${data.direct.id}"] .inbox-source-badges').textContent`),'1 个主题');
    assert.equal(await active.evaluate("[...document.querySelectorAll('.inbox-source-badges')].some(node=>node.textContent==='9 个主题 · 至少 8 个群')"),true,'truncated source list retains its lower bound');
    const alignment=await active.evaluate("(()=>{const link=document.querySelector('.inbox-business .inbox-open-summary'),card=document.querySelector('.inbox-business .inbox-mini-ticket'),range=document.createRange();range.selectNodeContents(link.firstChild);return {textLeft:range.getBoundingClientRect().left,cardLeft:card.getBoundingClientRect().left,paddingLeft:getComputedStyle(link).paddingLeft};})()") as {textLeft:number;cardLeft:number;paddingLeft:string};
    assert.ok(Math.abs(alignment.textLeft-alignment.cardLeft)<=1,JSON.stringify(alignment));assert.equal(alignment.paddingLeft,'0px');
    const separator=await active.evaluate("(()=>{const n=document.querySelector('.ds-conversation-separator'),s=getComputedStyle(n);return {text:n.textContent,color:s.color,left:s.marginLeft,right:s.marginRight};})()") as {text:string;color:string;left:string;right:string};
    assert.equal(separator.text,' · ');assert.equal(separator.left,'4px');assert.equal(separator.right,'4px');assert.equal(separator.color,'rgb(140, 138, 132)');console.log('CARD28_R3 '+JSON.stringify(separator));
    for(const width of [1440,1360,1359,1280,1100,1000,950,901,900,1920]){
      await active.command('Emulation.setDeviceMetricsOverride',{width,height:1080,deviceScaleFactor:1,mobile:false});await active.evaluate(afterPaint);
      const sample=await active.evaluate("(()=>{const status=document.querySelector('.inbox-reception-status'),name=document.querySelector('.inbox-reception-name'),hint=document.querySelector('.inbox-reception-hint'),channel=document.querySelector('.inbox-chat-channel'),picker=document.querySelector('.inbox-topic-picker'),reception=document.querySelector('.inbox-reception'),box=status.getBoundingClientRect(),actions=document.querySelector('.inbox-reception-actions').getBoundingClientRect(),receptionBox=reception.getBoundingClientRect(),channelBox=channel.getBoundingClientRect(),paragraph=channel.parentElement.getBoundingClientRect(),rect=r=>({left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}),inside=r=>r.left>=receptionBox.left-1&&r.right<=receptionBox.right+1&&r.top>=receptionBox.top-1&&r.bottom<=receptionBox.bottom+1;return {width:innerWidth,scale:visualViewport.scale,dpr:devicePixelRatio,status:status.textContent,statusClient:status.clientWidth,statusScroll:status.scrollWidth,statusInside:inside(box),statusRect:rect(box),actionsRect:rect(actions),bannerRect:rect(receptionBox),actionsInside:inside(actions),statusActionsOverlap:Math.min(box.right,actions.right)>Math.max(box.left,actions.left)&&Math.min(box.bottom,actions.bottom)>Math.max(box.top,actions.top),sameRow:Math.min(box.bottom,actions.bottom)>Math.max(box.top,actions.top),nameVisible:name.checkVisibility(),nameClient:name.clientWidth,nameScroll:name.scrollWidth,nameMax:getComputedStyle(name).maxWidth,hintVisible:hint.checkVisibility(),hintClient:hint.clientWidth,hintScroll:hint.scrollWidth,pickerWidth:picker.getBoundingClientRect().width,channel:channel.textContent,channelClient:channel.clientWidth,channelScroll:channel.scrollWidth,channelInside:channelBox.left>=paragraph.left&&channelBox.right<=paragraph.right,pageOverflow:document.documentElement.scrollWidth>innerWidth+1};})()") as {width:number;scale:number;dpr:number;status:string;statusClient:number;statusScroll:number;statusInside:boolean;statusRect:Rect;actionsRect:Rect;bannerRect:Rect;actionsInside:boolean;statusActionsOverlap:boolean;sameRow:boolean;nameVisible:boolean;nameClient:number;nameScroll:number;nameMax:string;hintVisible:boolean;hintClient:number;hintScroll:number;pickerWidth:number;channel:string;channelClient:number;channelScroll:number;channelInside:boolean;pageOverflow:boolean};
      samples.push(sample);assert.equal(sample.scale,1);assert.equal(sample.dpr,1);assert.equal(sample.status,'已等待 5 小时，尚无人接待');assert.ok(sample.statusScroll<=sample.statusClient,'complete reception status at '+width+': '+JSON.stringify(sample));assert.equal(sample.statusInside,true);assert.equal(sample.nameVisible,true);assert.equal(sample.pageOverflow,false);
      assert.ok(sample.nameClient>0,'reception name keeps positive width at '+width+': '+JSON.stringify(sample));assert.ok(sample.actionsRect.width>0&&sample.actionsRect.height>0,'reception action remains visible at '+width);assert.equal(sample.actionsInside,true,'reception action remains within the banner at '+width);assert.equal(sample.statusActionsOverlap,false,'reception status and action never overlap at '+width+': '+JSON.stringify(sample));if(sample.sameRow)assert.ok(sample.statusRect.right<=sample.actionsRect.left+1,'same-row reception status ends before its action at '+width);
      assert.ok(sample.pickerWidth<=240,'topic picker at '+width+': '+sample.pickerWidth);assert.equal(sample.channel,detail.channel_label);assert.ok(sample.channelScroll<=sample.channelClient,'channel text at '+width);assert.equal(sample.channelInside,true);
      if(width===1920){assert.equal(sample.hintVisible,true);assert.ok(sample.hintScroll<=sample.hintClient);assert.ok(sample.nameScroll<=sample.nameClient,'wide banner shows complete name');}else if(width===1440)assert.equal(sample.hintVisible,false,'secondary hint yields before core status at '+width);
      if([1440,900,1920].includes(width)){const bytes=Buffer.from(await active.screenshot(),'base64'),file=join(directory,'conversation-'+width+'.png');await writeFile(file,bytes);shots.push({file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),scale:1,sha256:createHash('sha256').update(bytes).digest('hex')});}
    }
    await active.command('Emulation.setDeviceMetricsOverride',{width:1440,height:1080,deviceScaleFactor:2,mobile:false});
    for(const side of ['incoming','outgoing'] as const){
      const selector='.ds-message-bubble[data-side='+side+'][data-group-position=first]:not([data-internal])';await active.evaluate(`document.querySelector(${JSON.stringify(selector)}).closest('li').scrollIntoView({block:'start'})`);await active.evaluate(afterPaint);
      const capture=await active.evaluate(`(()=>{const first=document.querySelector(${JSON.stringify(selector)}),row=first.closest('li'),last=${side==='incoming'?"row.nextElementSibling?.querySelector('.ds-message-bubble[data-group-position=rest]')":'null'},nodes=last?[first,last]:[first],bounds=nodes.map(node=>node.getBoundingClientRect()),timeline=document.querySelector('.inbox-timeline').getBoundingClientRect(),padding=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--space-1')),left=Math.floor(Math.min(...bounds.map(r=>r.left))+scrollX-padding),top=Math.floor(Math.min(...bounds.map(r=>r.top))+scrollY-padding),right=Math.ceil(Math.max(...bounds.map(r=>r.right))+scrollX+padding),bottom=Math.ceil(Math.max(...bounds.map(r=>r.bottom))+scrollY+padding);return {clip:{x:left,y:top,width:right-left,height:bottom-top,scale:1},padding,dpr:devicePixelRatio,viewportScale:visualViewport.scale,scrollX,scrollY,targets:bounds.map(r=>({left:r.left+scrollX,right:r.right+scrollX,top:r.top+scrollY,bottom:r.bottom+scrollY,width:r.width,height:r.height,inTimeline:r.left>=timeline.left-1&&r.right<=timeline.right+1&&r.top>=timeline.top-1&&r.bottom<=timeline.bottom+1,inViewport:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight}))};})()`) as {clip:{x:number;y:number;width:number;height:number;scale:number};padding:number;dpr:number;viewportScale:number;scrollX:number;scrollY:number;targets:(Rect&{inTimeline:boolean;inViewport:boolean})[]};
      assert.equal(capture.dpr,2);assert.equal(capture.viewportScale,1);assert.equal(capture.padding,4);assert.equal(capture.targets.length,side==='incoming'?2:1);
      const {clip}=capture;for(const target of capture.targets){assert.equal(target.inTimeline,true,'complete '+side+' bubble remains within the timeline');assert.equal(target.inViewport,true,'complete '+side+' bubble remains within the viewport');assert.ok(clip.x<=target.left-capture.padding&&clip.x+clip.width>=target.right+capture.padding&&clip.y<=target.top-capture.padding&&clip.y+clip.height>=target.bottom+capture.padding,'crop includes the complete '+side+' background and margin: '+JSON.stringify(capture));}
      const result=await active.command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,clip}) as {data:string};assert.equal(typeof result.data,'string');const bytes=Buffer.from(result.data,'base64'),file=join(directory,'bubble-'+side+'-x2.png');await writeFile(file,bytes);assert.equal(bytes.readUInt32BE(16),clip.width*2);assert.equal(bytes.readUInt32BE(20),clip.height*2);shots.push({file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),scale:2,...capture,sha256:createHash('sha256').update(bytes).digest('hex')});
    }
    assert.deepEqual(writes,[],'responsive presentation and screenshots never issue business commands');
    console.log('CARD26_INBOX '+JSON.stringify({directory,platform:process.platform,corners,alignment,headerSamples,samples,shots,scope:'LOCAL_SYNTHETIC_REAL_HTTP_PG',zero_counts_omitted:true,source_lower_bound:'至少 8 个群',business_posts:0}));
  }catch(error){await writeFile(join(directory,'failure.png'),Buffer.from(await active.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify({state:await active.evaluate('({text:document.body.innerText,url:location.href})'),headerSamples,samples,shots}));console.log('CARD26_INBOX_DIAGNOSTICS '+directory);throw error;}
  finally{f.runtime.server.off('request',observe);await active.command('Emulation.setDeviceMetricsOverride',{width:1440,height:1080,deviceScaleFactor:1,mobile:false});}
}

test('B1–B5 global counts, waiting heat and banners survive filters and share real SSE refresh',async()=>withT22Fixture(async f=>{
  const data=await seedCard25bConversation(f),directory=await mkdtemp(join(tmpdir(),'card25b-')),shots:Record<string,unknown>[]=[],requests:{path:string;query:string;method:string}[]=[];
  let browser:Browser|undefined,failure:unknown,summaryMode:'normal'|'failure'|'zero'='normal';
  f.runtime.server.on('request',(request,response)=>{const url=new URL(request.url??'/',f.origin);if(typeof request.headers['sec-fetch-site']==='string')requests.push({path:url.pathname,query:url.search,method:request.method??''});
    if(url.pathname==='/api/workbench/conversations/summary'){const end=response.end;response.end=(...args:unknown[])=>{if(summaryMode!=='normal')response.removeHeader('content-length');if(summaryMode==='failure'){response.statusCode=503;Reflect.apply(end,response,['{}']);}else if(summaryMode==='zero')Reflect.apply(end,response,[JSON.stringify({unassigned_contact_count:0,my_unread_count:0,as_of:'2026-11-05 09:00:00'})]);else Reflect.apply(end,response,args);return response;};}
  });
  const summary=async()=>await(await fetch(f.origin+'/api/workbench/conversations/summary',{headers:{cookie:f.cookie}})).json() as {unassigned_contact_count:number;my_unread_count:number};
  try{
    const original=await summary();assert.ok(original.unassigned_contact_count>=3&&original.my_unread_count>99);
    browser=await launchSystemBrowser({url:f.origin+'/workbench/app/conversations/'+data.five.id,width:1440,height:1080,cookies:[{...f.browserCookie,url:f.origin+'/'}]});assert.ok(browser);const active=browser;
    await active.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{const originalNow=Date.now,originalInterval=window.setInterval.bind(window),originalClear=window.clearInterval.bind(window),callbacks=new Map();let offset=0;Date.now=()=>originalNow()+offset;window.setInterval=(callback,delay,...args)=>{const id=originalInterval(callback,delay,...args);if(delay===60000)callbacks.set(id,()=>callback(...args));return id;};window.clearInterval=id=>{callbacks.delete(id);originalClear(id);};globalThis.__card25bClock={advance:()=>{offset+=60000;for(const tick of callbacks.values())tick();},reset:()=>{offset=0;for(const tick of callbacks.values())tick();}};})()`});
    await active.waitFor(inboxLive);requests.length=0;await active.command('Page.reload',{ignoreCache:true});await active.waitFor('Boolean(globalThis.__card25bClock)');await active.waitFor(inboxLive);
    const count=()=>active.evaluate("Number(document.querySelector('[data-unassigned-contact-count]')?.dataset.unassignedContactCount)");
    await active.waitFor("document.querySelector('.inbox-waiting-count')&&document.querySelectorAll('.inbox-wait-time').length>=3");assert.equal(await count(),original.unassigned_contact_count);
    assert.equal(await active.evaluate("document.querySelector('.conversation-unread-badge')?.textContent"),'99+');
    assert.equal(await active.evaluate("document.querySelector('.conversation-unread-badge')?.getAttribute('aria-label')"),original.my_unread_count+' 条未读');
    assert.equal(await active.evaluate("document.querySelector('.conversation-unread-badge').getBoundingClientRect().height"),18);
    for(const [contact,label,tone,token] of [[data.twelve,'12 分钟','neutral','--text-secondary'],[data.two,'2 小时','attention','--tone-attention-fg'],[data.five,'5 小时','danger','--tone-danger-fg']] as const){
      const selector='[data-contact-ref] a[href^="/workbench/app/conversations/'+contact.id+'"] time';
      assert.deepEqual(await active.evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)}),probe=document.createElement('span');probe.style.color='var(${token})';document.body.append(probe);const result={label:node?.textContent,tone:node?.dataset.waitTone,color:node&&getComputedStyle(node).color===getComputedStyle(probe).color,title:node?.title.includes('最近活动')&&node.title.endsWith('（北京时间）')};probe.remove();return result;})()`),{label,tone,color:true,title:true});
    }
    const assignedSelector='[data-contact-ref] a[href^="/workbench/app/conversations/'+data.assigned.id+'"] time';
    assert.equal(await active.evaluate(`document.querySelector(${JSON.stringify(assignedSelector)}).hasAttribute('data-wait-tone')`),false,'assigned contact retains activity clock');
    assert.equal(await active.evaluate("document.querySelector('.inbox-reception p').textContent"),'何明（合成）已等待 5 小时，尚无人接待 · 接待后即可回复');
    assert.equal(await active.evaluate("document.querySelector('.inbox-wait-duration').dataset.waitTone"),'danger');
    assert.equal(await active.evaluate("getComputedStyle(document.querySelector('.inbox-wait-duration')).color===getComputedStyle(document.querySelector('.inbox-wait-time[data-wait-tone=danger]')).color"),true);
    const capture=async(name:string,width:number)=>{await active.command('Emulation.setDeviceMetricsOverride',{width,height:1080,deviceScaleFactor:1,mobile:false});await active.evaluate('document.fonts.ready');await active.evaluate(afterPaint);const bytes=Buffer.from(await active.screenshot(),'base64'),file=join(directory,name+'.png');await writeFile(file,bytes);shots.push({file,width,height:1080,sha256:createHash('sha256').update(bytes).digest('hex')});};
    await capture('conversation-1440-before',1440);await capture('conversation-1920-before',1920);
    await clickWorkbenchControl(active,'.topbar [aria-label="收起侧栏"]');await active.waitFor("Boolean(document.querySelector('.sidebar-collapsed'))");
    assert.deepEqual(await active.evaluate("(()=>{const node=document.querySelector('.conversation-unread-badge'),box=node.getBoundingClientRect();return{width:box.width,height:box.height,label:node.getAttribute('aria-label'),textVisible:node.querySelector('span').checkVisibility()};})()"),{width:8,height:8,label:original.my_unread_count+' 条未读',textVisible:false});
    await capture('sidebar-collapsed',1440);await clickWorkbenchControl(active,'.topbar [aria-label="展开侧栏"]');
    const beforeFilters=requests.filter(row=>row.path.endsWith('/summary')).length;
    for(const [index,value,param] of [[1,'unassigned','state'],[2,'direct','source']] as const){await clickWorkbenchControl(active,`.inbox-filters>.ds-filter-chip:nth-child(${index}) [data-slot=select-trigger]`);await clickWorkbenchControl(active,'[role=option][data-key="'+value+'"]');await active.waitFor('new URLSearchParams(location.search).get('+JSON.stringify(param)+')==='+JSON.stringify(value));
      // Navigation updates the URL before the controlled chip/form render commits.
      await active.waitFor(`(()=>{const chip=document.querySelector('.inbox-filters>.ds-filter-chip:nth-child(${index})');return chip?.hasAttribute('data-filter-active')===true&&chip.querySelector('select')?.value===${JSON.stringify(value)};})()`);
      assert.equal(await count(),original.unassigned_contact_count);}
    await active.evaluate("(()=>{const input=document.querySelector('.inbox-search input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'不存在的主题（合成）');input.dispatchEvent(new Event('input',{bubbles:true}));})()");await active.evaluate('document.querySelector(".inbox-search").requestSubmit()');await active.waitFor("new URLSearchParams(location.search).has('q')");assert.equal(await count(),original.unassigned_contact_count);
    assert.equal(requests.filter(row=>row.path.endsWith('/summary')).length,beforeFilters,'after the initial read and real SSE snapshot refresh, queue, source and search never refetch the shared summary');
    await clickWorkbenchControl(active,'[aria-label="清除队列筛选"]');await active.waitFor("new URLSearchParams(location.search).get('state')==='open'&&!document.querySelector('.inbox-filters>.ds-filter-chip:nth-child(1)').hasAttribute('data-filter-active')");
    await clickWorkbenchControl(active,'[aria-label="清除来源筛选"]');await active.waitFor("!new URLSearchParams(location.search).has('source')&&!document.querySelector('.inbox-filters>.ds-filter-chip:nth-child(2)').hasAttribute('data-filter-active')");
    await active.evaluate("(()=>{const input=document.querySelector('.inbox-search input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'');input.dispatchEvent(new Event('input',{bubbles:true}));})()");await active.evaluate('document.querySelector(".inbox-search").requestSubmit()');await active.waitFor("document.querySelectorAll('.inbox-wait-time').length>=3");
    const beforeMinute=requests.filter(row=>row.method==='GET'&&(row.path.endsWith('/summary')||row.path==='/api/workbench/conversation-inbox')).length;
    await active.evaluate('globalThis.__card25bClock.advance()');await active.waitFor("[...document.querySelectorAll('.inbox-wait-time')].some(node=>node.textContent==='13 分钟')");
    assert.equal(requests.filter(row=>row.method==='GET'&&(row.path.endsWith('/summary')||row.path==='/api/workbench/conversation-inbox')).length,beforeMinute,'minute display updates do not fetch');await active.evaluate('globalThis.__card25bClock.reset()');
    await clickWorkbenchControl(active,'[data-action=takeover-conversation]');await active.waitFor("document.querySelector('.inbox-reception').hidden&&document.querySelector('[data-realtime-status]').dataset.realtimeStatus==='live'");await active.waitFor('Number(document.querySelector("[data-unassigned-contact-count]")?.dataset.unassignedContactCount)==='+String(original.unassigned_contact_count-1));
    assert.equal(await active.evaluate(`document.querySelector('[data-contact-ref] a[href^="/workbench/app/conversations/${data.five.id}"] time').hasAttribute('data-wait-tone')`),false);assert.equal((await summary()).unassigned_contact_count,original.unassigned_contact_count-1);
    await capture('conversation-1440-after-takeover',1440);
    summaryMode='failure';const detail=await(await fetch(f.origin+'/api/workbench/conversations/'+data.five.id+'?view=chat',{headers:{cookie:f.cookie}})).json() as ConversationChatEntry;
    assert.equal((await conversationPost(f.origin,f.cookie,data.five.id,'internal-notes',{...freshCommand(detail.session.row_version),text:'辅助计数失败时仍可沟通（合成）'})).status,201);await f.runtime.coordinator.runOnce();
    await active.waitFor("!document.querySelector('.inbox-waiting-count')&&!document.querySelector('.conversation-unread-badge')&&document.querySelector('[data-realtime-status]')?.dataset.realtimeStatus==='live'");assert.equal(await active.evaluate("document.querySelector('textarea[data-purpose=messages]').disabled"),false);assert.equal(await active.evaluate("document.body.innerText.includes('INVALID_RESPONSE')"),false);
    summaryMode='zero';await appendT22LiveItem(f.pool,data.five.id,'零计数边界（合成）');await f.runtime.coordinator.runOnce();await active.waitFor("document.querySelector('[data-conversation-timeline]').textContent.includes('零计数边界（合成）')");assert.equal(await active.evaluate("Boolean(document.querySelector('.inbox-waiting-count')||document.querySelector('.conversation-unread-badge'))"),false);
    assert.equal((await f.runtime.observability.metrics()).sse_clients,1);assert.ok(requests.filter(row=>row.path.endsWith('/summary')).every(row=>row.query===''));
    console.log('CARD25B_BROWSER '+JSON.stringify({directory,shots,initial:original,after_takeover:original.unassigned_contact_count-1,scope:'LOCAL_SYNTHETIC_REAL_HTTP_PG_SSE',summary_failure_hidden:true,minute_fetches:0}));
  }catch(error){failure=error;if(browser){await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify({state:await browser.evaluate('({text:document.body.innerText,url:location.href})'),requests}));console.log('CARD25B_DIAGNOSTICS '+directory);}}
  finally{await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);}
},{inbox:true,realtime:true,personalRead:false,recovery:false}));

test('B2 reading a real contact decreases the global badge through the existing Cursor SSE',async()=>withT22Fixture(async f=>{
  const data=await seedCard25bConversation(f);let browser:Browser|undefined,failure:unknown;
  const getSummary=async()=>await(await fetch(f.origin+'/api/workbench/conversations/summary',{headers:{cookie:f.cookie}})).json() as {my_unread_count:number};
  try{const before=await getSummary();assert.ok(before.my_unread_count>99);
    browser=await launchSystemBrowser({url:f.origin+'/workbench/app/conversations',width:1440,height:1080,cookies:[{...f.browserCookie,url:f.origin+'/'}]});assert.ok(browser);await browser.waitFor("document.querySelector('.conversation-unread-badge')?.textContent==='99+'");
    await clickWorkbenchControl(browser,'[data-contact-ref] a[href^="/workbench/app/conversations/'+data.assigned.id+'"]');await browser.waitFor(inboxLive);await browser.waitFor("Number(document.querySelector('.conversation-unread-badge')?.dataset.conversationUnread)<100");
    const after=await getSummary();assert.ok(after.my_unread_count<before.my_unread_count);assert.equal(await browser.evaluate("Number(document.querySelector('.conversation-unread-badge')?.dataset.conversationUnread)"),after.my_unread_count);assert.equal(await browser.evaluate("document.querySelector('.conversation-unread-badge').getAttribute('aria-label')"),after.my_unread_count+' 条未读');
    console.log('CARD25B_CURSOR '+JSON.stringify({before:before.my_unread_count,after:after.my_unread_count,real_cursor_sse:true}));
  }catch(error){failure=error;}finally{await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);}
},{inbox:true,realtime:true,personalRead:true,recovery:false}));

test('B1/B5 reply and internal notes remain available while summary remains pending beyond the refresh deadline',async()=>withT22Fixture(async f=>{
  const session=f.sessions[0];assert.ok(session);assert.equal((await conversationPost(f.origin,f.cookie,session.id,'takeover',freshCommand())).status,200);await f.runtime.coordinator.runOnce();
  const bootstrap=await(await fetch(f.origin+'/api/workbench/bootstrap',{headers:{cookie:f.cookie}})).json() as {polling_interval_ms:number};
  assert.ok(Number.isSafeInteger(bootstrap.polling_interval_ms)&&bootstrap.polling_interval_ms>0&&bootstrap.polling_interval_ms<=10000);
  const releases:(()=>void)[]=[],posts:string[]=[];let hold=true,summaryStartedAt:number|null=null,summaryRequests=0,browser:Browser|undefined,failure:unknown;
  f.runtime.server.on('request',(request,response)=>{const path=new URL(request.url??'/',f.origin).pathname;
    if(request.method==='POST')posts.push(path);
    if(request.method!=='GET'||path!=='/api/workbench/conversations/summary')return;
    summaryRequests++;const end=response.end;response.end=(...args:unknown[])=>{if(hold){summaryStartedAt??=Date.now();releases.push(()=>{if(!response.destroyed)Reflect.apply(end,response,args);});return response;}Reflect.apply(end,response,args);return response;};
  });
  try{
    browser=await launchSystemBrowser({url:f.origin+'/workbench/app/conversations/'+session.id,width:1440,height:1080,cookies:[{...f.browserCookie,url:f.origin+'/'}]});assert.ok(browser);
    await browser.waitFor("Boolean(document.querySelector('[data-conversation-ready]'))");for(let attempt=0;attempt<200&&releases.length===0;attempt++)await delay(25);assert.notEqual(summaryStartedAt,null);assert.ok(releases.length>0);
    // Observe beyond the real, existing refresh deadline, without changing its timer or server push.
    await delay(Math.max(0,Number(summaryStartedAt)+bootstrap.polling_interval_ms+1500-Date.now()));
    assert.equal(await browser.evaluate("document.querySelector('[data-realtime-status]').dataset.realtimeStatus"),'live','only auxiliary summary is pending; core refresh must remain live');
    assert.equal(await browser.evaluate("Boolean(document.querySelector('.inbox-waiting-count')||document.querySelector('.conversation-unread-badge'))"),false);
    const reply='辅助计数仍在读取时正常回复（合成）',note='辅助计数仍在读取时保存内部协作记录（合成）';
    await browser.evaluate(input('messages',reply));await clickWorkbenchControl(browser,'[data-action=send-conversation-reply]');await browser.waitFor('document.querySelector("[data-conversation-timeline]").textContent.includes('+JSON.stringify(reply)+')');
    await clickWorkbenchControl(browser,'#conversation-note-tab');await browser.evaluate(input('internal-notes',note));await clickWorkbenchControl(browser,'[data-action=save-conversation-note]');await browser.waitFor('document.querySelector("[data-conversation-timeline]").textContent.includes('+JSON.stringify(note)+')');
    assert.equal(posts.filter(path=>path.endsWith('/messages')).length,1);assert.equal(posts.filter(path=>path.endsWith('/internal-notes')).length,1);assert.equal(summaryRequests,1,'pending summary remains one shared read across command push refreshes');
    assert.equal(await browser.evaluate("document.querySelector('[data-realtime-status]').dataset.realtimeStatus"),'live');assert.equal((await f.runtime.observability.metrics()).sse_clients,1);
    hold=false;for(const release of releases.splice(0))release();await browser.waitFor("Boolean(document.querySelector('.conversation-unread-badge'))");
    console.log('CARD25B_SLOW_SUMMARY '+JSON.stringify({deadline_ms:bootstrap.polling_interval_ms,held_beyond_deadline:true,reply_posts:1,note_posts:1,real_http_pg_sse:true,core_remained_live:true}));
  }catch(error){failure=error;}finally{hold=false;for(const release of releases.splice(0))release();await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);}
},{inbox:true,realtime:true,personalRead:false,recovery:false}));

test('v2.1 reception uses the original command and keeps message space, purpose and newline boundaries',async()=>{
  await withT22Fixture(async f=>{
    const session=f.sessions[0];assert.ok(session);let browser:Browser|undefined,failure:unknown;
    const posts:string[]=[];
    const observe=(request:import('node:http').IncomingMessage)=>{if(request.method==='POST')posts.push(new URL(request.url??'/',f.origin).pathname);};f.runtime.server.on('request',observe);
    try{
      browser=await launchSystemBrowser({url:f.origin+'/workbench/app/conversations/'+session.id,width:1920,height:1080,cookies:[{...f.browserCookie,url:f.origin+'/'}]});assert.ok(browser);await browser.waitFor(ready);
      for(const width of [1920,1440,1280,900]){
        await browser.command('Emulation.setDeviceMetricsOverride',{width,height:1080,deviceScaleFactor:1,mobile:false});
        await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        assert.equal(await browser.evaluate("document.querySelector('.inbox-chat-header').getBoundingClientRect().height"),60);
        assert.equal(await browser.evaluate("document.querySelector('.inbox-timeline').getBoundingClientRect().height>=innerHeight/2"),true,'waiting message height at '+width);
        assert.equal(await browser.evaluate("document.querySelector('.inbox-reception').checkVisibility()&&document.querySelector('textarea[data-purpose=messages]').disabled"),true);
        assert.equal(await browser.evaluate("[...document.querySelectorAll('.inbox-chat [data-tone=primary]')].filter(node=>node.checkVisibility()).length"),1);
        assert.equal(await browser.evaluate("document.documentElement.scrollWidth>innerWidth+1"),false);
      }
      assert.deepEqual([...posts],[],'resizing and presentation produce no commands');
      await clickWorkbenchControl(browser,'[data-action=takeover-conversation]');
      await browser.waitFor("document.querySelector('.inbox-reception').hidden&&!document.querySelector('textarea[data-purpose=messages]').disabled");
      assert.deepEqual([...posts],['/api/workbench/conversations/'+session.id+'/takeover']);
      await browser.evaluate(input('messages','第一行'));
      await browser.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});await browser.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
      assert.equal(await browser.evaluate("document.querySelector('textarea[data-purpose=messages]').value.includes('\\n')"),true);
      assert.equal(posts.filter(path=>path.endsWith('/messages')).length,0,'plain Enter never sends');
      await clickWorkbenchControl(browser,'#conversation-note-tab');
      assert.equal(await browser.evaluate("getComputedStyle(document.querySelector('.inbox-composer')).backgroundColor===getComputedStyle(document.querySelector('.inbox-timeline')).backgroundColor"),false,'note mode colors the whole composer');
      assert.equal(await browser.evaluate("document.querySelector('textarea[data-purpose=internal-notes]').value"),'','reply is never copied to the note');
      assert.equal(await browser.evaluate("[...document.querySelectorAll('.inbox-chat [data-tone=primary]')].filter(node=>node.checkVisibility()).length"),1);
    }catch(error){failure=error;}finally{f.runtime.server.off('request',observe);await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);}
  },{inbox:true,realtime:true,personalRead:false,recovery:true});
});

test('ended inbox preserves historical neutral labels and the selected Session remains read-only',async()=>{
  await withT22Fixture(async f=>{
    const ended=f.sessions[2];assert.ok(ended);
    const entry=await (await fetch(f.origin+'/api/workbench/conversations/'+ended.id+'?view=chat',{headers:{cookie:f.cookie}})).json() as ConversationChatEntry;
    assert.equal(entry.session.status,'ENDED');assert.equal(entry.capabilities.length,0);
    const writes:string[]=[];const observe=(request:import('node:http').IncomingMessage)=>{if(request.method==='POST')writes.push(new URL(request.url??'/',f.origin).pathname);};
    f.runtime.server.on('request',observe);let browser:Browser|undefined,failure:unknown;
    try{
      browser=await launchSystemBrowser({url:f.origin+'/workbench/app/conversations?state=ended',width:1440,height:1080,cookies:[{...f.browserCookie,url:f.origin+'/'}]});assert.ok(browser);
      await browser.waitFor("document.querySelectorAll('[data-contact-ref]').length>0");
      assert.equal(await browser.evaluate("[...document.querySelectorAll('.inbox-contact-bottom .ds-status-badge')].every(node=>node.textContent==='历史主题'&&node.dataset.tone==='neutral')"),true);
      assert.equal(await browser.evaluate("document.querySelector('.inbox-empty')?.textContent.includes('历史沟通记录')"),true);
      assert.equal(await browser.evaluate("document.querySelector('.inbox-empty')?.textContent.includes('领取后可回复')"),false);
      await clickWorkbenchControl(browser,'[data-contact-ref] a');await browser.waitFor("Boolean(document.querySelector('[data-conversation-ready]'))&&Boolean(document.querySelector('textarea[data-purpose=messages]'))");
      assert.equal(await browser.evaluate("document.querySelector('.inbox-reception').checkVisibility()"),false);
      assert.equal(await browser.evaluate("[...document.querySelectorAll('textarea[data-purpose]')].every(node=>node.disabled)"),true);
      assert.equal(await browser.evaluate("[...document.querySelectorAll('.inbox-chat [data-tone=primary]')].filter(node=>node.checkVisibility()).length"),0);
      assert.equal(await browser.evaluate("document.querySelector('.inbox-ended')?.textContent.includes('历史主题只读')"),true);
      assert.deepEqual(writes,[],'historical navigation and presentation never POST');
    }catch(error){failure=error;}finally{f.runtime.server.off('request',observe);await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);}
  },{inbox:true,personalRead:false,recovery:false});
});

test('topic history and same-topic direct navigation remain separate, readable and reachable together',async()=>{
  await withT22Fixture(async f=>{
    for(let index=0;index<51;index++)await addInboxSession(f.pool,{reporter:'card14-paging-person',group:'card14-history-'+index,text:'历史主题 '+index});
    const group=await addInboxSession(f.pool,{reporter:'card14-paging-person',group:'card14-paging-group',text:'当前服务主题'}),journeyId=await attachInboxJourney(f.pool,group);
    const direct=await addInboxSession(f.pool,{reporter:group.reporter,group:null,text:'本主题私聊补充'});await attachInboxJourney(f.pool,direct,{journeyId});
    const related=await (await fetch(f.origin+'/api/workbench/conversations/'+group.id+'/related-sessions?limit=50',{headers:{cookie:f.cookie}})).json() as ConversationRelatedPage;
    assert.ok(related.next_cursor);assert.ok(related.items.some(row=>row.session.session_id===direct.id));
    const writes:string[]=[];const observe=(request:import('node:http').IncomingMessage)=>{if(request.method==='POST')writes.push(new URL(request.url??'/',f.origin).pathname);};
    f.runtime.server.on('request',observe);let browser:Browser|undefined,failure:unknown;
    try{
      browser=await launchSystemBrowser({url:f.origin+'/workbench/app/conversations/'+group.id,width:1440,height:1080,cookies:[{...f.browserCookie,url:f.origin+'/'}]});assert.ok(browser);
      await browser.waitFor("Boolean(document.querySelector('.inbox-new-direct'))&&Boolean(document.querySelector('.inbox-topic-pages button'))");
      await clickWorkbenchControl(browser,'.inbox-more-actions [data-action=open-detail-actions]');
      for(const width of [1920,1440,1280,900]){
        await browser.command('Emulation.setDeviceMetricsOverride',{width,height:1080,deviceScaleFactor:1,mobile:false});await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        const sample=await browser.evaluate("(()=>{const a=document.querySelector('.inbox-topic-pages button'),b=document.querySelector('.inbox-new-direct'),x=a.getBoundingClientRect(),y=b.getBoundingClientRect(),label=b.querySelector('.ds-button-label');const hit=node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));};return {overlap:Math.min(x.right,y.right)>Math.max(x.left,y.left)&&Math.min(x.bottom,y.bottom)>Math.max(x.top,y.top),clipped:b.scrollWidth>b.clientWidth||label.scrollWidth>label.clientWidth,reachable:hit(a)&&hit(b)};})()") as {overlap:boolean;clipped:boolean;reachable:boolean};
        assert.equal(sample.overlap,false,'navigation overlap at '+width);assert.equal(sample.clipped,false,'direct navigation text clipping at '+width);assert.equal(sample.reachable,true,'both navigation targets at '+width);
      }
      await clickWorkbenchControl(browser,'.inbox-topic-pages button');
      await browser.waitFor("document.querySelector('.inbox-topic-pages')?.textContent.includes('返回最新主题')");
      assert.equal(await browser.evaluate('location.pathname'),'/workbench/app/conversations/'+group.id,'history paging keeps the current Session');
      await clickWorkbenchControl(browser,'.inbox-topic-pages button');await browser.waitFor("Boolean(document.querySelector('.inbox-new-direct'))");
      await clickWorkbenchControl(browser,'.inbox-new-direct');await browser.waitFor(`location.pathname==='/workbench/app/conversations/${direct.id}'&&Boolean(document.querySelector('[data-conversation-ready]'))`);
      assert.equal(await browser.evaluate('location.pathname'),'/workbench/app/conversations/'+direct.id);
      assert.deepEqual(writes,[],'topic history and direct-window navigation remain read-only');
    }catch(error){failure=error;}finally{f.runtime.server.off('request',observe);await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);}
  },{inbox:true,personalRead:false,recovery:false});
});

test('ticket detail and conversation summary keep independent cache shapes across both client-side navigation directions',async()=>{
  await withT22Fixture(async f=>{
    const session=f.sessions[0];assert.ok(session);let browser:Browser|undefined,failure:unknown;
    try{
      browser=await launchSystemBrowser({url:f.origin+'/workbench/app/items/ticket/'+session.ticketId+'?detail=page',width:1440,height:1080,cookies:[{...f.browserCookie,url:f.origin+'/'}]});assert.ok(browser);
      const fullPageReady=`location.pathname===${JSON.stringify('/workbench/app/items/ticket/'+session.ticketId)}&&Boolean(document.querySelector('#detail-title'))&&Boolean(document.querySelector('.detail-workflows'))`;
      for(let round=0;round<2;round++){
        await browser.waitFor(fullPageReady);

        await clickWorkbenchControl(browser,'#detail-tab-trigger-conversations');
        await browser.waitFor(`Boolean(document.querySelector('a[href="/workbench/app/conversations/${session.id}"]'))`);
        await browser.evaluate(`document.querySelector('a[href="/workbench/app/conversations/${session.id}"]').click()`);
        await browser.waitFor("Boolean(document.querySelector('[data-conversation-ready]'))&&document.querySelector('.inbox-associated')?.textContent.includes('当前状态')");
        await browser.evaluate("document.querySelector('.inbox-associated a').click()");
        await browser.waitFor("Boolean(document.querySelector('.inbox-associated-detail'))");
        await clickWorkbenchControl(browser,'.inbox-full-item');
        await browser.waitFor(fullPageReady);
      }
      await browser.waitFor("Boolean(document.querySelector('#detail-title'))&&Boolean(document.querySelector('.properties'))");
      assert.equal(await browser.evaluate('location.pathname.endsWith('+JSON.stringify(session.ticketId)+')'),true);
      console.log('CONVERSATION_DETAIL_NAVIGATION '+JSON.stringify({bundle:'PRODUCTION',api:'REAL_LOOPBACK_HTTP_PG',directions:2,rounds:2,reloaded:false}));
    }catch(error){failure=error;}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
  },{inbox:true,realtime:true,recovery:false});
});

test('production inbox Split uses one viewport breakpoint with expanded and collapsed sidebars',{timeout:120000},()=>withT22Fixture(async f=>{
  const session=f.sessions[0];assert.ok(session);assert.equal((await conversationPost(f.origin,f.cookie,session.id,'takeover',freshCommand())).status,200);
  const directory=await mkdtemp(join(tmpdir(),'inbox-split-boundaries-')),samples:Record<string,unknown>[]=[],screenshots:Record<string,unknown>[]=[],writes:string[]=[];
  const observe=(request:import('node:http').IncomingMessage)=>{if(request.method==='POST')writes.push(new URL(request.url??'/',f.origin).pathname);};f.runtime.server.on('request',observe);
  let browser:Browser|undefined,failure:unknown;
  try{browser=await launchSystemBrowser({url:f.origin+'/workbench/app/conversations/'+session.id,width:1920,height:900,cookies:[{...f.browserCookie,url:f.origin+'/'}]});assert.ok(browser);const active=browser;
    for(const collapsed of [false,true])for(const selected of [true,false]){
      await active.command('Emulation.setDeviceMetricsOverride',{width:1920,height:900,deviceScaleFactor:1,mobile:false});await active.command('Page.navigate',{url:f.origin+'/workbench/app/conversations'+(selected?'/'+session.id:'')});
      await active.waitFor(selected?'Boolean(document.querySelector("[data-conversation-ready]"))':'document.querySelectorAll("[data-contact-ref]").length>0');
      const current=await active.evaluate("document.querySelector('.app').classList.contains('sidebar-collapsed')");if(current!==collapsed)await clickWorkbenchControl(active,'.topbar button[aria-label="收起侧栏"]');
      for(const width of [1920,1440,1360,1280,1100,1000,950,901,900,899,600,390]){
        await active.command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await active.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        const sample:unknown=await active.evaluate(`(()=>{const root=document.querySelector('.inbox-layout'),contacts=root.querySelector('.inbox-contacts'),chat=root.querySelector('.inbox-chat'),back=root.querySelector('.inbox-back'),business=root.querySelector('.inbox-business'),visible=n=>Boolean(n?.checkVisibility()),r=root.getBoundingClientRect(),c=contacts.getBoundingClientRect(),h=chat?.getBoundingClientRect(),mobile=innerWidth<=900,selected=${selected},display=getComputedStyle(root).display,overflow=document.documentElement.scrollWidth>innerWidth+1;const valid=display===(mobile?'flex':'grid')&&visible(contacts)===(!selected||!mobile)&&visible(back)===(selected&&mobile)&&visible(chat)===selected&&!overflow&&(mobile?(selected?Math.abs(h.width-r.width)<=1:Math.abs(c.width-r.width)<=1):(Math.abs(c.width-320)<=1&&(!selected||(h.width>200&&h.left>=c.right-1&&h.right<=r.right+1))))&&visible(business)===(selected&&innerWidth>=1360)&&document.querySelector('.app').classList.contains('sidebar-collapsed')===${collapsed};return {valid,width:innerWidth,collapsed:${collapsed},selected,display,layout:r.width,contacts:visible(contacts),back:visible(back),chatWidth:h?.width??null,business:visible(business),overflow};})()`);
        assert.ok(sample&&typeof sample==='object'&&'valid' in sample);assert.equal(sample.valid,true,JSON.stringify(sample));samples.push(sample);
        if((!collapsed&&selected&&[1920,1440,1360,1280,1000,900,390].includes(width))||(width===1000&&collapsed)||(width===900&&!selected&&!collapsed)){const bytes=Buffer.from(await active.screenshot(),'base64'),file=join(directory,'split-'+width+'-'+(collapsed?'collapsed':'expanded')+'-'+(selected?'selected':'contacts')+'.png');await writeFile(file,bytes);screenshots.push({file,width,height:900,sha256:createHash('sha256').update(bytes).digest('hex')});}
      }
      if(selected){const origin=await active.evaluate('performance.timeOrigin');await clickWorkbenchControl(active,'.inbox-back');await active.waitFor("location.pathname==='/workbench/app/conversations'&&document.querySelector('.inbox-contacts')?.checkVisibility()===true");assert.equal(await active.evaluate('performance.timeOrigin'),origin,'return to contacts keeps the same client document');assert.equal(await active.evaluate("Math.abs(document.querySelector('.inbox-contacts').getBoundingClientRect().width-document.querySelector('.inbox-layout').getBoundingClientRect().width)<=1"),true);}
    }
    assert.deepEqual(writes,[],'responsive navigation and sidebar changes never post business commands');console.log('CONVERSATION_SPLIT_VIEWPORTS '+JSON.stringify({scope:'INBOX_SPLIT_VIEWPORT_BOUNDARIES',samples,screenshots}));
    f.runtime.server.off('request',observe);await verifyCard26Presentation(f,active);
  }catch(error){failure=error;}finally{f.runtime.server.off('request',observe);await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);}
},{inbox:true,personalRead:false,recovery:false}));

test('production inbox keeps one real SSE stream, exact delivery and draft scopes, IME, scrolling, responsive layouts and current authority',async()=>{
  await withT22Fixture(async f=>{
    const a=f.sessions[0],b=f.sessions[1];assert.ok(a&&b);
    const explicit=await addInboxSession(f.pool,{reporter:'browser-inbox-reporter',group:'browser-inbox-group',text:'合成服务主题：终端无法打印'});await attachInboxJourney(f.pool,explicit,{name:'合成报修人'});
    for(let i=0;i<64;i++)await appendT22LiveItem(f.pool,explicit.id,'合成历史沟通 '+String(i+1).padStart(2,'0'));
    assert.equal((await conversationPost(f.origin,f.cookie,explicit.id,'takeover',freshCommand())).status,200);
    const directory=await mkdtemp(join(tmpdir(),'conversation-inbox-')),requests:{path:string;method:string;browser:boolean}[]=[],events:string[]=[],screenshots:Record<string,unknown>[]=[];
    let browser:Browser|undefined,failure:unknown,dropReply=false,unreadable=false;
    f.runtime.server.on('request',(request,response)=>{
      const path=new URL(request.url??'/',f.origin).pathname;requests.push({path,method:request.method??'',browser:typeof request.headers['sec-fetch-site']==='string'});
      if(path==='/api/realtime/events'){const write=response.write;response.write=(chunk:unknown,...args:unknown[]):boolean=>{for(const name of ['conversation.item.created','communication.delivery.changed'])if(String(chunk).includes('event: '+name))events.push(name);return Reflect.apply(write,response,[chunk,...args]);};}
      if(request.method==='GET'&&(path==='/api/workbench/conversation-inbox'||path.startsWith('/api/workbench/conversations/'))){const end=response.end;response.end=(...args:unknown[])=>{Reflect.apply(end,response,unreadable?['{']:args);return response;};}
      if(request.method==='POST'&&path.endsWith('/messages')){const end=response.end;response.end=(...args:unknown[])=>{if(dropReply&&response.statusCode===202){dropReply=false;response.flushHeaders();response.write(String(args[0]??'').slice(0,1),()=>request.socket.destroy());return response;}Reflect.apply(end,response,args);return response;};}
    });
    const gets=(path:string)=>requests.filter(r=>r.browser&&r.method==='GET'&&r.path===path).length;
    try{
      browser=await launchSystemBrowser({url:f.origin+'/workbench/app/conversations/'+explicit.id,width:1920,height:1080,cookies:[{...f.browserCookie,url:f.origin+'/'}]});assert.ok(browser);await browser.waitFor(ready);
      await clickWorkbenchControl(browser,'.inbox-topic-picker [data-slot=select-trigger]');
      await browser.waitFor("Boolean(document.querySelector('[role=listbox] [role=group]'))&&document.querySelectorAll('[role=option]').length>0");
      await clickWorkbenchControl(browser,'[role=option][data-key="'+explicit.id+'"]');
      await browser.waitFor(ready);
      await browser.waitFor("document.querySelectorAll('[data-contact-ref]').length>=3");assert.equal((await f.runtime.observability.metrics()).sse_clients,1);
      assert.equal(await browser.evaluate("document.querySelector('[data-conversation-timeline]').querySelectorAll('[data-conversation-item]').length"),50);
      await browser.waitFor("(()=>{const button=document.querySelector('.inbox-history');if(!button||button.disabled)return false;button.click();return true;})()");await browser.waitFor("document.querySelectorAll('[data-conversation-item]').length>=65");
      await browser.evaluate(input('messages','合成未发送回复'));await browser.waitFor("document.querySelector('[data-conversation-draft=messages]').textContent.includes('草稿已保存')");
      await browser.evaluate("(()=>{const t=document.querySelector('textarea[data-purpose=messages]');t.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));t.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true}));t.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));})()");
      assert.equal(requests.filter(r=>r.method==='POST'&&r.path.endsWith('/messages')).length,0);
      await browser.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',modifiers:8,windowsVirtualKeyCode:13,text:'\r'});await browser.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',modifiers:8,windowsVirtualKeyCode:13});
      await browser.waitFor("document.querySelector('textarea[data-purpose=messages]').value.includes('\\n')");assert.equal(requests.filter(r=>r.method==='POST'&&r.path.endsWith('/messages')).length,0);
      await browser.evaluate("document.querySelector('#conversation-note-tab').click()");await browser.evaluate(input('internal-notes','合成内部草稿，不能外发'));await browser.waitFor("document.querySelector('[data-conversation-draft=internal-notes]').textContent.includes('草稿已保存')");
      await browser.evaluate("document.querySelector('#conversation-reply-tab').click()");assert.ok(await browser.evaluate("document.querySelector('textarea[data-purpose=messages]').value.includes('合成未发送回复')"));
      await browser.evaluate("(()=>{const t=document.querySelector('.inbox-timeline');t.scrollTop=300;t.dispatchEvent(new Event('scroll'));const input=document.querySelector('textarea[data-purpose=messages]');input.focus();input.setSelectionRange(2,5);})()");
      const before=await browser.evaluate("(()=>{const t=document.querySelector('.inbox-timeline');const el=[...document.querySelectorAll('[data-conversation-item]')].find(i=>i.getBoundingClientRect().bottom>t.getBoundingClientRect().top);return {id:el.dataset.conversationItem,offset:el.getBoundingClientRect().top-t.getBoundingClientRect().top};})()") as {id:string;offset:number};
      const path='/api/workbench/conversations/'+explicit.id,listBefore=gets('/api/workbench/conversation-inbox'),relatedBefore=gets(path+'/related-sessions');
      const detail=await (await fetch(f.origin+path+'?view=chat',{headers:{cookie:f.cookie}})).json() as ConversationChatEntry;
      const changedAt=Date.now();assert.equal((await conversationPost(f.origin,f.cookie,explicit.id,'internal-notes',{...freshCommand(detail.session.row_version),text:'合成实时内部说明'})).status,201);await f.runtime.coordinator.runOnce();
      await browser.waitFor("document.querySelector('[data-conversation-timeline]').textContent.includes('合成实时内部说明')");const liveLatencyMs=Date.now()-changedAt;
      assert.ok(gets('/api/workbench/conversation-inbox')>listBefore&&gets(path+'/related-sessions')>relatedBefore);assert.equal((await f.runtime.observability.metrics()).sse_clients,1);
      const anchor=await browser.evaluate(`(()=>{const t=document.querySelector('.inbox-timeline'),el=document.querySelector('[data-conversation-item="${before.id}"]');return el.getBoundingClientRect().top-t.getBoundingClientRect().top;})()`) as number;assert.ok(Math.abs(anchor-before.offset)<3);
      assert.equal(await browser.evaluate("document.activeElement===document.querySelector('textarea[data-purpose=messages]')&&document.activeElement.selectionStart===2&&document.activeElement.selectionEnd===5"),true);assert.equal(await browser.evaluate("Boolean(document.querySelector('.inbox-new-messages'))"),true);
      await browser.evaluate("document.querySelector('.inbox-new-messages').click()");
      await browser.evaluate("(()=>{globalThis.__inboxCommands=[];const original=fetch;globalThis.fetch=(path,options)=>{if(String(path).endsWith('/messages')&&options?.method==='POST')globalThis.__inboxCommands.push(JSON.parse(options.body));return original(path,options);};})()");
      await browser.evaluate(input('messages','合成原UUID回复'));dropReply=true;
      await assertWorkbenchPrimaryLabelContrast(browser,'[data-action=send-conversation-reply]');
      await browser.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',modifiers:2,windowsVirtualKeyCode:13});await browser.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',modifiers:2,windowsVirtualKeyCode:13});
      await browser.waitFor("document.querySelector('[data-reply-outcome]')?.textContent.includes('结果未确认')");const command=await browser.evaluate('globalThis.__inboxCommands[0]') as ConversationTextCommand;assert.equal(command.text,'合成原UUID回复');
      // Codex review (P1): the read-only lookup and the replay are told apart by name. Exactly one button reads 「核对结果」 (the GET
      // receipt), the replay of the original command reads 「重新提交」; pressing 「核对结果」 by its visible name sends no POST.
      const names=await browser.evaluate("[...document.querySelector('[data-action=check-messages]').closest('section').querySelectorAll('button')].map(b=>b.textContent.trim())") as string[];
      assert.equal(names.filter(name=>name==='核对结果').length,1,'one read-only lookup '+JSON.stringify(names));assert.ok(!names.some(name=>name!=='核对结果'&&name.includes('核对')),'no other button claims to check '+JSON.stringify(names));
      await browser.evaluate("[...document.querySelector('[data-action=check-messages]').closest('section').querySelectorAll('button')].find(b=>b.textContent.trim()==='核对结果').click()");await browser.waitFor("document.querySelector('[data-reply-outcome]').textContent.includes('已受理发送')");assert.equal(await browser.evaluate('globalThis.__inboxCommands.length'),1,'核对结果 sends no POST');
      const receipt=await (await fetch(f.origin+path+'/messages/commands/'+command.client_command_id,{headers:{cookie:f.cookie}})).json() as ConversationCommandReceipt;assert.ok(receipt.state==='COMMITTED');const messageId=receipt.result.message_id,deliveryId=receipt.result.delivery_ids[0];assert.ok(deliveryId);
      const worker=createCommunicationDeliveryWorker({pool:f.pool,enabled:true,sender:{send:async()=>({outcome:'ACKNOWLEDGED',provider_message_id:'inbox-synthetic-ack',error_code:null,retryable:false})}});await worker.deliver({deliveryId});await f.runtime.coordinator.runOnce();
      await browser.waitFor(`Boolean(document.querySelector('[data-message-delivery="${messageId}"]')?.querySelector('svg[aria-label="渠道已确认发送"]'))`);assert.equal(await browser.evaluate(`document.querySelectorAll('[data-message-delivery="${messageId}"]').length`),1);assert.equal(await browser.evaluate(`Boolean(document.querySelector('[data-pending-message="${messageId}"]'))`),false);
      assert.ok(events.includes('conversation.item.created')&&events.includes('communication.delivery.changed'));
      for(const width of [1920,1440,1280,900,390]){
        await browser.command('Emulation.setDeviceMetricsOverride',{width,height:width<600?844:1080,deviceScaleFactor:1,mobile:width<600});
        const layout=await browser.evaluate("(()=>{const r=document.querySelector('.inbox-chat').getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth+1,chatWidth:r.width,chatVisible:r.width>0};})()") as {overflow:boolean;chatWidth:number;chatVisible:boolean};assert.equal(layout.overflow,false,'horizontal overflow at '+width);assert.ok(layout.chatVisible&&layout.chatWidth>200);
        if(width>=900){assert.equal(await browser.evaluate("document.querySelector('.inbox-chat-header').getBoundingClientRect().height"),60);assert.equal(await browser.evaluate("document.querySelector('.inbox-timeline').getBoundingClientRect().height>=innerHeight/2"),true,'1080p message space at '+width);}
        const bytes=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,'inbox-'+width+'.png');await writeFile(file,bytes);screenshots.push({file,width,height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')});
      }
      // A failed complete REST reread makes the existing controller unavailable;
      // its ordinary five-second retry retains both draft purposes and the UUID.
      unreadable=true;await browser.waitFor("document.querySelector('[data-realtime-status]')?.dataset.realtimeStatus==='offline'");unreadable=false;const fallbackStart=Date.now();await browser.waitFor("document.querySelector('[data-realtime-status]')?.dataset.realtimeStatus==='live'");const fallbackLatencyMs=Date.now()-fallbackStart;
      assert.equal(await browser.evaluate("document.querySelector('textarea[data-purpose=internal-notes]').value"),'合成内部草稿，不能外发');assert.equal((await f.runtime.observability.metrics()).sse_clients,1);
      assert.equal(await browser.evaluate('globalThis.__inboxCommands.length'),1);
      await browser.command('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
      await browser.evaluate("window.scrollTo(0,0)");
      const cursor=async()=>Number((await f.pool.query<{last:string}>('SELECT last_read_sequence::text AS last FROM conversation.read_cursor WHERE session_id=$1::uuid AND principal_id=$2::uuid',[explicit.id,f.principals[0]?.id])).rows[0]?.last??'0');
      const visibleCursor=await cursor();assert.ok(visibleCursor>0,'actual visible chat text must advance the existing personal cursor');
      await browser.evaluate("Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'))");
      const hiddenEntry=await (await fetch(f.origin+path+'?view=chat',{headers:{cookie:f.cookie}})).json() as ConversationChatEntry;
      assert.equal((await conversationPost(f.origin,f.cookie,explicit.id,'internal-notes',{...freshCommand(hiddenEntry.session.row_version),text:'合成隐藏期间材料'})).status,201);await f.runtime.coordinator.runOnce();
      await new Promise(resolve=>setTimeout(resolve,250));assert.equal(await cursor(),visibleCursor);
      await browser.evaluate("delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'))");await browser.waitFor("document.querySelector('[data-conversation-timeline]').textContent.includes('合成隐藏期间材料')");
      await browser.evaluate("(()=>{const node=document.querySelector('.inbox-timeline');node.scrollTop=node.scrollHeight;node.dispatchEvent(new Event('scroll'));})()");
      const deadline=Date.now()+5000;while(Date.now()<deadline&&await cursor()<=visibleCursor)await new Promise(resolve=>setTimeout(resolve,50));assert.ok(await cursor()>visibleCursor);
      const colleague=f.principals[1],principal=f.principals[0];assert.ok(colleague&&principal);
      await f.pool.query("INSERT INTO pilot_ticket.pilot_principal_role(principal_id,role) VALUES($1::uuid,'DISPATCHER') ON CONFLICT DO NOTHING",[colleague.id]);
      const transferEntry=await (await fetch(f.origin+path+'?view=chat',{headers:{cookie:f.cookie}})).json() as ConversationChatEntry;
      assert.equal((await conversationPost(f.origin,f.cookie,explicit.id,'transfer',{...freshCommand(transferEntry.session.row_version),target_principal_id:colleague.id})).status,200);
      const actor=(await f.pool.query<{wecom_user_id:string;display_name:string}>('SELECT wecom_user_id,display_name FROM pilot_ticket.pilot_principal WHERE id=$1::uuid',[principal.id])).rows[0];assert.ok(actor);
      await createPilotAccessService({pool:f.pool}).upsertPrincipal({wecomUserId:actor.wecom_user_id,displayName:actor.display_name,roles:['HANDLER'],resolverTeamIds:[]});
      await browser.waitFor("!document.querySelector('[data-conversation-ready]')&&!document.querySelector('textarea[data-purpose]')");assert.equal(await browser.evaluate("document.querySelector('.inbox-contact-rows').textContent.includes('合成报修人')"),false);
      await f.pool.query("DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid AND role='DISPATCHER'",[colleague.id]);
      const nextCookie=f.runtime.authenticate.browserCookies?.()[2];assert.ok(nextCookie);
      await browser.command('Network.deleteCookies',{name:f.browserCookie.name,url:f.origin+'/'});await browser.command('Network.setCookies',{cookies:[{...nextCookie,url:f.origin+'/'}]});
      await browser.command('Page.navigate',{url:f.origin+'/workbench/app/conversations/'+explicit.id});await browser.waitFor(ready);
      await browser.waitFor("document.querySelector('.inbox-business').textContent.includes('暂无可展示的关联事项')");
      assert.equal(await browser.evaluate("document.querySelector('textarea[data-purpose=internal-notes]').value"),'','a switched principal must not restore the old principal note');
      const scoped=await (await fetch(f.origin+path+'?view=chat',{headers:{cookie:f.handlerCookie}})).json() as ConversationChatEntry;assert.equal(scoped.canonical_item,null);assert.equal(scoped.assignment.assigned_to_me,true);assert.ok(scoped.capabilities.includes('REPLY'));
      console.log('CONVERSATION_INBOX_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',bundle:'PRODUCTION',real_sse:true,sse_clients:1,live_latency_ms:liveLatencyMs,fallback_latency_ms:fallbackLatencyMs,screenshots}));
    }catch(error){failure=error;try{if(browser){await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify({browser:await browser.evaluate('({text:document.body.innerText,url:location.href})'),requests,events}));console.log('CONVERSATION_INBOX_DIAGNOSTICS '+directory);}}catch(diagnostic){failure=new AggregateError([failure,diagnostic]);}}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
  },{inbox:true,realtime:true,personalRead:true});
});

test('returning to an inactive revoked chat cannot render cached messages while the current REST denial is delayed',async()=>{
  await withT22Fixture(async f=>{
    const a=f.sessions[0],b=f.sessions[1],handler=f.principals[1],admin=f.principals[0],recipient=f.principals[2],cookie=f.runtime.authenticate.browserCookies?.()[2];assert.ok(a&&b&&handler&&admin&&recipient&&cookie);
    const actor=(await f.pool.query<{wecom_user_id:string;display_name:string}>('SELECT wecom_user_id,display_name FROM pilot_ticket.pilot_principal WHERE id=$1::uuid',[handler.id])).rows[0];assert.ok(actor);
    await createPilotAccessService({pool:f.pool}).upsertPrincipal({wecomUserId:actor.wecom_user_id,displayName:actor.display_name,roles:['HANDLER'],resolverTeamIds:[]});
    for(const session of [a,b])await f.pool.query("INSERT INTO conversation.assignment(session_id,assignment_status,assigned_principal_id,assigned_by_principal_id,assigned_at) VALUES($1::uuid,'ASSIGNED',$2::uuid,$3::uuid,platform.local_now())",[session.id,handler.id,admin.id]);
    const canary='CACHE_REVOKED_INTERNAL_NOTE_CANARY',path='/api/workbench/conversations/'+a.id;
    assert.equal((await conversationPost(f.origin,f.handlerCookie,a.id,'internal-notes',{...freshCommand(),text:canary})).status,201);await f.runtime.coordinator.runOnce();
    let browser:Browser|undefined,failure:unknown;
    try{
      browser=await launchSystemBrowser({url:f.origin+'/workbench/app/conversations/'+a.id,width:1440,height:1080,cookies:[{...cookie,url:f.origin+'/'}]});assert.ok(browser);await browser.waitFor(ready);await browser.waitFor("document.querySelector('[data-conversation-timeline]')?.textContent.includes("+JSON.stringify(canary)+')');
      await browser.waitFor(`Boolean(document.querySelector('a[href*="/conversations/${b.id}"]'))`);await browser.evaluate(`document.querySelector('a[href*="/conversations/${b.id}"]').click()`);await browser.waitFor(ready+`&&location.pathname.endsWith('${b.id}')&&!document.querySelector('[data-conversation-timeline]')?.textContent.includes(${JSON.stringify(canary)})`);
      const entry=await (await fetch(f.origin+path+'?view=chat',{headers:{cookie:f.handlerCookie}})).json() as ConversationChatEntry;
      const transferred=await conversationPost(f.origin,f.cookie,a.id,'transfer',{...freshCommand(entry.session.row_version),target_principal_id:recipient.id,force:true,reason_code:'SYNTHETIC_READ_REVOCATION'});assert.equal(transferred.status,200,JSON.stringify(await transferred.json()));
      assert.equal((await fetch(f.origin+path+'?view=chat',{headers:{cookie:f.handlerCookie}})).status,404);
      await browser.evaluate(`(()=>{globalThis.__revokedReadStarted=false;globalThis.__revokedLeak=false;globalThis.__revokedResponses=0;const gate=new Promise(resolve=>globalThis.__releaseRevoked=resolve),original=fetch;globalThis.fetch=(url,options)=>{if(String(url).startsWith(${JSON.stringify(path)})&&(!options?.method||options.method==='GET')){globalThis.__revokedReadStarted=true;return original(url,options).then(async response=>{globalThis.__revokedResponses++;await gate;return response;});}return original(url,options);};new MutationObserver(()=>{if(document.querySelector('[data-conversation-timeline]')?.textContent.includes(${JSON.stringify(canary)}))globalThis.__revokedLeak=true;}).observe(document.body,{childList:true,subtree:true,characterData:true});history.pushState({},'',${JSON.stringify('/workbench/app/conversations/'+a.id)});dispatchEvent(new PopStateEvent('popstate'));})()`);
      await browser.waitFor('globalThis.__revokedReadStarted');assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-conversation-timeline]')?.textContent.includes("+JSON.stringify(canary)+'))||globalThis.__revokedLeak'),false,'an inactive chat must not expose cached internal notes before its current read completes');
      assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-conversation-ready]'))"),false);
      await browser.waitFor('globalThis.__revokedResponses>0');await browser.evaluate('globalThis.__releaseRevoked()');
      await browser.waitFor("document.querySelector('[role=alert]')&&!document.querySelector('[data-conversation-ready]')");assert.equal(await browser.evaluate('globalThis.__revokedLeak'),false);
      console.log('CONVERSATION_INACTIVE_REVOCATION '+JSON.stringify({same_principal:true,role_team_unchanged:true,real_transfer:true,delayed_rest_denial:true,cached_material_rendered:false}));
    }catch(error){failure=error;}
    await closeBrowserTestResources([async()=>{if(browser){await browser.evaluate('globalThis.__releaseRevoked?.()');await browser.close();assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}}],failure);
  },{inbox:true,realtime:true});
});
test('summary drawer blocks covered conversation cursor writes and closing re-observes visible text',async()=>{
  await withT22Fixture(async f=>{
    const session=f.sessions[0];assert.ok(session);const cursor=async()=>Number((await f.pool.query<{last:string}>('SELECT last_read_sequence::text AS last FROM conversation.read_cursor WHERE session_id=$1::uuid AND principal_id=$2::uuid',[session.id,f.principals[0]?.id])).rows[0]?.last??'0');
    let browser:Browser|undefined,failure:unknown;
    try{
      browser=await launchSystemBrowser({url:f.origin+'/workbench/app/conversations/'+session.id,width:1920,height:1080,cookies:[{...f.browserCookie,url:f.origin+'/'}]});assert.ok(browser);
      await browser.command('Emulation.setFocusEmulationEnabled',{enabled:true});
      await browser.waitFor("Boolean(document.querySelector('[data-conversation-ready]'))&&document.querySelector('[data-realtime-status]')?.dataset.realtimeStatus==='live'");
      await browser.evaluate(`(()=>{globalThis.__summaryReads={armed:false,gets:0,posts:0};const original=fetch;globalThis.fetch=(path,options)=>{const name=new URL(String(path),location.origin).pathname,t=globalThis.__summaryReads;if(t.armed){if(name===${JSON.stringify('/api/conversations/'+session.id)})t.gets++;if(options?.method==='POST'&&name===${JSON.stringify('/api/conversations/'+session.id+'/read-cursor')})t.posts++;}return original(path,options);};window.dispatchEvent(new Event('focus'));})()`);
      const initial=await browser.evaluate("Math.max(...[...document.querySelectorAll('[data-conversation-timeline] p[data-session-read-sequence]')].map(node=>Number(node.dataset.sessionReadSequence)))") as number;assert.ok(Number.isSafeInteger(initial)&&initial>0);
      await browser.waitFor(`(async()=>{const result=await (await fetch(${JSON.stringify('/api/conversations/'+session.id)},{cache:'no-store',headers:{accept:'application/json'}})).json();return Number(result.read_cursor.last_read_sequence)>=${initial};})()`);
      await clickWorkbenchControl(browser,'.inbox-business .inbox-mini-ticket a');await browser.waitFor("document.querySelector('[role=dialog].detail-dialog.ds-drawer')?.checkVisibility()===true");
      await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      const before=await cursor();await browser.evaluate('globalThis.__summaryReads.armed=true');
      const entry=await (await fetch(f.origin+'/api/workbench/conversations/'+session.id+'?view=chat',{headers:{cookie:f.cookie}})).json() as ConversationChatEntry;
      assert.equal((await conversationPost(f.origin,f.cookie,session.id,'internal-notes',{...freshCommand(entry.session.row_version),text:'合成摘要遮挡期间的新正文'})).status,201);await f.runtime.coordinator.runOnce();
      await browser.waitFor("document.querySelector('[data-conversation-timeline]')?.textContent.includes('合成摘要遮挡期间的新正文')&&document.querySelector('[data-realtime-status]')?.dataset.realtimeStatus==='live'");
      const newest=await browser.evaluate("Math.max(...[...document.querySelectorAll('[data-conversation-timeline] p[data-session-read-sequence]')].map(node=>Number(node.dataset.sessionReadSequence)))") as number;assert.ok(newest>before);
      const covered=await browser.evaluate("(()=>{window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('resize'));const node=document.querySelector('.inbox-timeline');node.scrollTop=node.scrollHeight;node.dispatchEvent(new Event('scroll'));return {gets:globalThis.__summaryReads.gets,posts:globalThis.__summaryReads.posts};})()") as {gets:number;posts:number};
      assert.deepEqual(covered,{gets:0,posts:0},'covered material does not start a Cursor intent or its authority GET');assert.equal(await cursor(),before,'unseen text never advances the durable cursor');
      await browser.evaluate('globalThis.__summaryReads.armed=false');
      await clickWorkbenchControl(browser,'[role=dialog].ds-drawer button[aria-label="关闭详情"]');await browser.waitFor("!document.querySelector('.inbox-associated-detail')");
      await browser.waitFor(`(async()=>{const result=await (await fetch(${JSON.stringify('/api/conversations/'+session.id)},{cache:'no-store',headers:{accept:'application/json'}})).json();return Number(result.read_cursor.last_read_sequence)>=${newest};})()`);
      assert.ok(await cursor()>=newest,'closing the drawer re-observes actually visible text without a synthetic scroll');
      console.log('CONVERSATION_SUMMARY_FOREGROUND '+JSON.stringify({before,covered,after:await cursor(),newest,real_http_pg:true}));
    }catch(error){failure=error;}finally{await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);}
  },{inbox:true,realtime:true,personalRead:true,recovery:false});
});

test('an uncertain personal Cursor remains GET-only across foreground observations and new projected material',async()=>{
  await withT22Fixture(async f=>{
    const session=f.sessions[0];assert.ok(session);let browser:Browser|undefined,failure:unknown;
    try{
      browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:1440,height:1200,cookies:[{...f.browserCookie,url:f.origin+'/'}]});assert.ok(browser);
      await browser.command('Emulation.setFocusEmulationEnabled',{enabled:true});
      await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{globalThis.__inboxVisible=false;globalThis.__inboxReadPosts=[];globalThis.__inboxOwnChecks=[];Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>globalThis.__inboxVisible?'visible':'hidden'});const original=fetch;globalThis.fetch=(path,options)=>{const name=String(path);if(options?.method==='POST'&&name.endsWith('/read-cursor')){globalThis.__inboxReadPosts.push(JSON.parse(options.body));return Promise.reject(new TypeError('synthetic unknown Cursor delivery before transport'));}return original(path,options).then(async response=>{if(name===${JSON.stringify('/api/conversations/'+session.id)}&&response.status===200){const data=await response.clone().json();globalThis.__inboxOwnChecks.push(data.read_cursor.last_read_sequence);}return response;});};})()`});
      await browser.command('Page.navigate',{url:f.origin+'/workbench/app/conversations/'+session.id});await browser.waitFor("Boolean(document.querySelector('p[data-session-read-sequence=\"1\"]'))");
      const show="(()=>{globalThis.__inboxVisible=true;document.querySelector('p[data-session-read-sequence=\"1\"]').scrollIntoView({block:'center'});document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'));})()";
      await browser.evaluate(show);await browser.waitFor("document.querySelector('[data-realtime-status]')?.dataset.realtimeStatus==='live'");await browser.evaluate(show);await browser.waitFor('globalThis.__inboxReadPosts.length===1');
      const checkCount=await browser.evaluate('globalThis.__inboxOwnChecks.length') as number;
      await browser.evaluate("globalThis.__inboxVisible=false;document.dispatchEvent(new Event('visibilitychange'))");await browser.evaluate(show);
      await browser.waitFor('globalThis.__inboxOwnChecks.length>'+checkCount);assert.equal(await browser.evaluate('globalThis.__inboxReadPosts.length'),1);
      const entry=await (await fetch(f.origin+'/api/workbench/conversations/'+session.id+'?view=chat',{headers:{cookie:f.cookie}})).json() as ConversationChatEntry;
      assert.equal((await conversationPost(f.origin,f.cookie,session.id,'internal-notes',{...freshCommand(entry.session.row_version),text:'合成未知Cursor期间的新正文'})).status,201);await f.runtime.coordinator.runOnce();
      await browser.waitFor("document.querySelector('[data-conversation-timeline]').textContent.includes('合成未知Cursor期间的新正文')");await browser.evaluate(show);
      assert.equal(await browser.evaluate('globalThis.__inboxReadPosts.length'),1,'new material must retain the uncertain original coordinate');
      const cursor=(await f.pool.query<{last:string}>('SELECT last_read_sequence::text AS last FROM conversation.read_cursor WHERE session_id=$1::uuid',[session.id])).rows[0]?.last??'0';assert.equal(cursor,'0');
      console.log('CONVERSATION_CURSOR_GET_ONLY '+JSON.stringify({unknown_posts:1,current_cursor:cursor,observations:'FOREGROUND_AND_NEW_MATERIAL',automatic_repost:false}));
    }catch(error){failure=error;}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
  },{inbox:true,realtime:true,personalRead:true});
});
