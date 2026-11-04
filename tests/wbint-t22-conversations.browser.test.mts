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
type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;

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
        if(width>900){assert.equal(sample.grid,'grid');assert.ok(sample.timeRight<=sample.rowRight+1,'C1 time right edge at '+width);assert.match(sample.timeText,/^\d{2}-\d{2} \d{2}:\d{2}$/u);assert.ok(sample.preview.length>60);}
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
     assert.equal(await browser.evaluate("document.querySelector('#audience-messages').textContent==='领取接待后可回复'&&document.querySelector('#audience-messages').checkVisibility()&&document.querySelector('textarea[data-purpose=messages]').disabled"),true,'R4 waiting reason is visible; original recovery-enabled half-screen regression also runs separately');
    }
   }catch(error){failure=error;if(browser)await captureCard22(browser,directory,'conversation-'+account+'-failure');}
   finally{await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);}
  }assert.deepEqual(posts,[],'presentation and no-capability inputs produce no write requests');}
  finally{f.runtime.server.off('request',observe);await writeFile(join(directory,'conversation-metrics.json'),JSON.stringify(metrics,null,2));}
 },{inbox:true,personalRead:false,recovery:false});
});
