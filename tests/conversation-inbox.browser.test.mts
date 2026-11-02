import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {withT22Fixture,appendT22LiveItem} from './helpers/wbint-t22-fixture.mjs';
import {conversationPost,freshCommand,addInboxSession,attachInboxJourney} from './helpers/conversation-inbox-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {clickWorkbenchControl,assertWorkbenchPrimaryLabelContrast} from './helpers/heroui-workbench-controls.mjs';
import {createCommunicationDeliveryWorker} from '../app/server/src/p2-004-communication-delivery-worker.mjs';
import {createPilotAccessService} from '../app/server/src/p1-009-pilot-access-workbench.mjs';
import type {ConversationChatEntry,ConversationRelatedPage} from '../contracts/workbench_conversation_inbox_contracts.js';
import type {ConversationCommandReceipt,ConversationTextCommand} from '../contracts/workbench_conversation_workspace_contracts.js';
type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
const input=(purpose:string,text:string)=>`(()=>{const input=document.querySelector('textarea[data-purpose="${purpose}"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();})()`;
const ready="Boolean(document.querySelector('[data-conversation-ready]'))&&document.querySelector('[data-conversation-draft=messages]')?.textContent.includes('草稿')&&document.querySelector('[data-realtime-status]')?.dataset.realtimeStatus==='live'";

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
        await browser.evaluate("(()=>{const section=document.querySelector('.detail-workflows');if(!section.hasAttribute('data-expanded'))section.querySelector('.workbench-disclosure-trigger').click();})()");
        await clickWorkbenchControl(browser,'.workflow-support .workbench-disclosure-trigger');
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
      await browser.evaluate(input('messages','合成未发送回复'));await browser.waitFor("document.querySelector('[data-conversation-draft=messages]').textContent.includes('已保存恢复副本')");
      await browser.evaluate("(()=>{const t=document.querySelector('textarea[data-purpose=messages]');t.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));t.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true}));t.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));})()");
      assert.equal(requests.filter(r=>r.method==='POST'&&r.path.endsWith('/messages')).length,0);
      await browser.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',modifiers:8,windowsVirtualKeyCode:13,text:'\r'});await browser.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',modifiers:8,windowsVirtualKeyCode:13});
      await browser.waitFor("document.querySelector('textarea[data-purpose=messages]').value.includes('\\n')");assert.equal(requests.filter(r=>r.method==='POST'&&r.path.endsWith('/messages')).length,0);
      await browser.evaluate("document.querySelector('#conversation-note-tab').click()");await browser.evaluate(input('internal-notes','合成内部草稿，不能外发'));await browser.waitFor("document.querySelector('[data-conversation-draft=internal-notes]').textContent.includes('已保存恢复副本')");
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
      await browser.waitFor("document.querySelector('[data-reply-outcome]').textContent.includes('结果未知')");const command=await browser.evaluate('globalThis.__inboxCommands[0]') as ConversationTextCommand;assert.equal(command.text,'合成原UUID回复');
      await browser.evaluate("document.querySelector('[data-action=check-messages]').click()");await browser.waitFor("document.querySelector('[data-reply-outcome]').textContent.includes('已受理发送')");assert.equal(await browser.evaluate('globalThis.__inboxCommands.length'),1);
      const receipt=await (await fetch(f.origin+path+'/messages/commands/'+command.client_command_id,{headers:{cookie:f.cookie}})).json() as ConversationCommandReceipt;assert.ok(receipt.state==='COMMITTED');const messageId=receipt.result.message_id,deliveryId=receipt.result.delivery_ids[0];assert.ok(deliveryId);
      const worker=createCommunicationDeliveryWorker({pool:f.pool,enabled:true,sender:{send:async()=>({outcome:'ACKNOWLEDGED',provider_message_id:'inbox-synthetic-ack',error_code:null,retryable:false})}});await worker.deliver({deliveryId});await f.runtime.coordinator.runOnce();
      await browser.waitFor(`document.querySelector('[data-message-delivery="${messageId}"]')?.textContent.includes('渠道已确认发送')`);assert.equal(await browser.evaluate(`document.querySelectorAll('[data-message-delivery="${messageId}"]').length`),1);assert.equal(await browser.evaluate(`Boolean(document.querySelector('[data-pending-message="${messageId}"]'))`),false);
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
