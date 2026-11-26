import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {shortcuts} from './helpers/card37b-shortcut-module.mjs';
import {
  board,
  caps,
  capture,
  chip,
  current,
  frame,
  help,
  hint,
  key,
  menu,
  navigate,
  palette,
  record,
  select,
  target,
  timeCapsule,
  assertLifetime,
  suite,
  scene,
  writeLog,
  actions,
  title,
  seen,
  undoFor,
  number,
  takeoverSection,
  takeoverEntry,
  takeoverTeam,
  takeoverScene,
  assignTakeoverOnly,
} from './helpers/card37b-keyboard-browser.mjs';
import {
  type Browser,
  type Scene,
  active,
  closeDialog,
  follow,
  toast,
  visible,
  withScene,
} from './helpers/card37a-optimistic-fixture.mjs';
import {query,seedMotionTicket,ticketCard,ticketRow} from './helpers/motion-board-fixture.mjs';
import {waitForAnimationsSettled} from './helpers/browser-animations.mjs';
import {assertNoTransformAnimations} from './helpers/motion-assert.mjs';
import {clickWorkbenchControl} from './helpers/heroui-workbench-controls.mjs';
import {hover,move,point} from './helpers/card37c-hover-browser.mjs';
import {t11Http,type T11Fixture} from './helpers/t11-completion-fixture.mjs';
import {object} from './helpers/t42-board-browser-fixture.mjs';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {seedPersistedIntake} from './helpers/p2-015-postgres-harness.mjs';
import {launchSystemBrowser} from './helpers/p2-006-browser-harness.mjs';

test('37B B5.4 B5.8 B5.9 already claimed by a colleague, timed status and zero requests',suite,()=>scene(async s=>{
  const {b,f,id}=s;
  await (await t11Http(f,2,{closeConnections:true})).start(id);
  await target(s,'board');
  assert.equal(await b.evaluate(query(active(s.card)+' .owner-name')+'.textContent'),'陈悦（合成）');
  await timeCapsule(b,hint);await record(b);await key(b,'a');
  await b.waitFor(title(hint)+'==="这张工单现在不能领取"');
  assert.equal(await b.evaluate(query(hint)+'.getAttribute("role")'),'status');
  await capture(b,'shortcut-unavailable-hint',hint);
  await assertLifetime(b,2000);
  assert.deepEqual(await b.evaluate('b5log.calls'),[]);
}));

test('37B B5.6 B5.8 B5.9 G destinations, timeout and consumed second key',suite,()=>scene(async s=>{
  const {b}=s;
  await target(s,'board');
  const original=await b.evaluate('location.href');
  await timeCapsule(b,chip);await key(b,'g');await b.waitFor(visible(chip));
  assert.equal(await b.evaluate(query(chip)+'.getAttribute("role")'),'status');
  assert.match(String(await b.evaluate(title(chip))),/G前往…W 工作台 · C 会话 · N 通知异常/u);
  await capture(b,'goto-chip',chip);
  await assertLifetime(b,1500);assert.equal(await b.evaluate('location.href'),original);
  await key(b,'g');await b.waitFor(visible(chip));await key(b,'j');
  await b.waitFor('!'+seen(chip));
  assert.equal(await b.evaluate(query(current)+'?.dataset.itemId'),s.id);
  assert.equal(await b.evaluate('location.href'),original);
  await b.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  for(const [letter,path] of [['c','/conversations'],['n','/notification-exceptions'],['w','/']] as const){
    await key(b,'g');await b.waitFor(visible(chip));
    await assertNoTransformAnimations(b,chip);
    await key(b,letter);await b.waitFor('location.pathname==='+JSON.stringify('/workbench/app'+path)+'&&!'+seen(chip));
  }
}));

async function tooltip(b:Browser,selector:string,id:string,mac:boolean,shot=false){
  await b.waitFor(seen(selector));
  const more=await b.evaluate(query(selector)+'.closest("details.ds-drawer-more:not([open])")!==null');
  if(more)await clickWorkbenchControl(b,'[data-action=open-detail-actions]');
  await hover(b,selector);
  const tip='[data-tooltip-open=true]:has(>'+selector.split(' ').at(-1)+') > [data-shortcut-tooltip=true]';
  await b.waitFor(visible(tip)+'&&getComputedStyle('+query(tip)+').visibility==="visible"');
  if(shot)await capture(b,'tooltip-kbd',tip);
  assert.deepEqual(await caps(b,tip),shortcuts.shortcutKeys(id,mac),id+' tooltip');
}

async function assertMenuItemsVisible(b:Browser){
  await b.waitFor(visible(menu));
  await waitForAnimationsSettled(b);
  const result=await b.evaluate(`(()=>{
    const items=[...${query(menu)}.querySelectorAll('[role=menuitem]')];
    const failures=[];
    for(const item of items){
      const r=item.getBoundingClientRect(),outside=[];
      if(r.left<0||r.top<0||r.right>document.documentElement.clientWidth||r.bottom>document.documentElement.clientHeight)outside.push('viewport');
      for(let parent=item.parentElement;parent;parent=parent.parentElement){
        const css=getComputedStyle(parent),p=parent.getBoundingClientRect();
        const left=p.left+parent.clientLeft,top=p.top+parent.clientTop;
        const clips=value=>['hidden','clip','auto','scroll','overlay'].includes(value);
        if((clips(css.overflowX)&&(r.left<left||r.right>left+parent.clientWidth))||
           (clips(css.overflowY)&&(r.top<top||r.bottom>top+parent.clientHeight)))outside.push(parent.className||parent.tagName);
      }
      const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
      if(outside.length||!item.contains(hit)||!r.width||!r.height||!item.checkVisibility({opacityProperty:true,visibilityProperty:true})){
        failures.push({item:item.textContent.trim(),outside,hit:hit?.className??null});
      }
    }
    return {count:items.length,failures};
  })()`);
  assert.ok(result.count>=7,'expected the four ticket shortcuts, two column moves and Cancel');
  assert.deepEqual(result.failures,[],'every menu item must fit its clipping ancestors and receive its centre hit');
}

test('37B B5.5 B5.7 B5.8 B5.9 table matches all four rendered surfaces',suite,t=>scene(async s=>{
  const {b,card}=s,mac=await b.evaluate('/mac/i.test(navigator.userAgentData?.platform??navigator.platform)')===true;
  await t.test('shortcuts dialog layout, account rows and live search',async()=>{
    await target(s,'board');
    await b.waitFor(visible('[data-action=new-report]'));
    await key(b,'?');await b.waitFor(visible(help));
    await capture(b,'shortcuts-dialog',help);
    assert.equal(await b.evaluate(title(help+' h2')),'快捷键');
    const found=await b.evaluate(`[...${query(help)}.querySelectorAll('[data-shortcut-id]')].map(n=>n.dataset.shortcutId)`);
    assert.deepEqual(found,shortcuts.SHORTCUTS.map(def=>def.id));
    for(const def of shortcuts.SHORTCUTS)
      assert.deepEqual(await caps(b,help+' [data-shortcut-id="'+def.id+'"]'),shortcuts.shortcutKeys(def.id,mac),def.label);
    await waitForAnimationsSettled(b,help);
    const layout=await b.evaluate(`(()=>{
      const box=${query(help)},groups=[...box.querySelectorAll('.efficiency-help-group')];
      return {width:box.getBoundingClientRect().width,cols:new Set(groups.map(n=>n.getBoundingClientRect().left)).size,
        // Rounded to 0.01px: hairline rows can report sub-pixel layout noise such as 29.99994.
        heights:[...new Set([...box.querySelectorAll('[data-shortcut-id]')].map(n=>Math.round(n.getBoundingClientRect().height*100)/100))],
        groups:groups.map(n=>n.getAttribute('aria-label')),footer:box.querySelector('footer').textContent.trim()};
    })()`);
    assert.deepEqual(layout,{width:560,cols:2,heights:[30],groups:shortcuts.SHORTCUT_GROUPS,
      footer:'输入文字、填写表单时，单键快捷键自动暂停。没有权限的操作不会执行。'});
    await b.evaluate(query(help+' input')+'.focus()');
    await b.command('Input.insertText',{text:'领'});
    await b.waitFor(query(help)+'.querySelectorAll("[data-shortcut-id]").length===1');
    assert.equal(await b.evaluate(title(help+' .efficiency-help-label')),'领取');
  });
  await t.test('menu key caps and accessible keyboard shortcuts',async()=>{
    await target(s,'board');await clickWorkbenchControl(b,card+' [data-action=board-action-menu]');
    await b.waitFor(visible(menu));
    for(const [action,id] of [['board-copy-number','copy-number'],['board-toggle-follow','follow'],['board-transfer','transfer'],['board-close-item','close']]){
      assert.ok(action&&id);
      const item=menu+' [data-action='+action+']';
      assert.deepEqual(await caps(b,item),shortcuts.shortcutKeys(id,mac));
      assert.equal(await b.evaluate(query(item)+'.getAttribute("role")'),'menuitem');
      assert.equal(await b.evaluate(query(item)+'.getAttribute("aria-keyshortcuts")'),shortcuts.ariaKeyshortcuts(id,mac));
    }
    // Capture the complete menu on an ordinary single-result board. The last
    // pending card on the unfiltered board has its own clipping regression.
    const id=await b.evaluate(query('.board-column.active .ticket-card[data-kind=ticket]')+'.dataset.itemId');
    assert.equal(typeof id,'string');
    const params=new URLSearchParams({view:'board',range:'all',search:'1',q:await number(s,id,'ticket')});
    const result=ticketCard(id);
    await navigate(s,'?'+params,visible(result)+'&&document.querySelectorAll(".board .ticket-card").length===1');
    await b.evaluate(query(result+' .card-open')+'.focus()');
    await clickWorkbenchControl(b,result+' [data-action=board-action-menu]');
    await assertMenuItemsVisible(b);
    await capture(b,'menu-kbd',menu);
  });
  await t.test('command panel caps for every offered action',async()=>{
    await target(s,'board');await b.waitFor(visible('[data-action=new-report]'));
    await key(b,'k',2);await b.waitFor(visible(palette));
    await capture(b,'palette-kbd',palette);
    const names:Record<string,string>={'新报修':'new-report','切到列表':'toggle-view','打开会话':'goto-conversations','打开通知异常':'goto-exceptions',
      '查看快捷键':'help','领取':'claim','转交…':'transfer','关闭事项…':'close','关注':'follow','写内部备注':'note','复制编号':'copy-number'};
    const rows:unknown=await b.evaluate(`[...${query(palette)}.querySelectorAll('[role=option]')].map(row=>[row.querySelector('strong').textContent,[...row.querySelectorAll('kbd')].map(n=>n.textContent)])`);
    assert.ok(Array.isArray(rows));
    assert.deepEqual(rows.map(row=>row[0]).sort(),Object.keys(names).sort());
    for(const [name,tokens] of rows){const id=names[name];assert.ok(id);assert.deepEqual(tokens,shortcuts.shortcutKeys(id,mac),name);}
  });
  await t.test('button tooltips and inline caps',async()=>{
    await target(s,'board');
    await tooltip(b,card+' [data-board-claim-action]','claim',mac,true);
    await tooltip(b,'[data-action=new-report]','new-report',mac);
    assert.deepEqual(await caps(b,'[data-action=new-report]'),shortcuts.shortcutKeys('new-report',mac));
    await tooltip(b,'button.efficiency-entry','command-panel',mac);
    assert.deepEqual(await caps(b,'button.efficiency-entry'),shortcuts.shortcutKeys('command-panel',mac));
    await target(s,'list');await b.waitFor(visible(ticketRow(s.id)+' .ds-list-claim-key'));
    assert.deepEqual(await caps(b,ticketRow(s.id)+' .ds-list-claim-key'),shortcuts.shortcutKeys('claim',mac));
    await target(s,'drawer');
    await tooltip(b,'[aria-label=复制编号]','copy-number',mac);
    await tooltip(b,follow,'follow',mac);
    await tooltip(b,'[data-action=open-assignment]','transfer',mac);
    await tooltip(b,'[data-action=cancel]','close',mac);
    await s.http.start(s.id);await target(s,'drawer');
    await b.waitFor(seen('.detail-complete-button,[data-step-action=complete]'));
    const button=await b.evaluate(seen('.detail-complete-button'))?'.detail-complete-button':'[data-step-action=complete]';
    await tooltip(b,button,'complete',mac);
  });

}));

test('37B B5.8 B5.9 keyboard-current focus ring, mouse movement and click elsewhere',suite,()=>scene(async s=>{
  const {b,card}=s;
  await target(s,'board');
  await move(b,{x:2,y:2});
  await waitForAnimationsSettled(b,card);
  assert.deepEqual(await b.evaluate(`(()=>{
    const el=${query(card)},probe=document.createElement('span');el.append(probe);
    probe.style.boxShadow='0 0 0 2px var(--brand), 0 0 0 5px var(--brand-subtle)';
    const expected=getComputedStyle(probe).boxShadow;probe.remove();
    return [el.getAttribute('aria-current'),document.activeElement.matches(':focus-visible'),
      el.contains(document.activeElement),getComputedStyle(el).boxShadow===expected,getComputedStyle(el).outlineWidth];
  })()`),['true',true,true,true,'0px']);
  await capture(b,'board-keyboard-current',card);
  const xy=await point(b,'.ds-page-header h1');
  await move(b,xy);assert.equal(await b.evaluate(query(card)+'.getAttribute("aria-current")'),'true');
  for(const type of ['mousePressed','mouseReleased'])await b.command('Input.dispatchMouseEvent',{type,...xy,button:'left',clickCount:1});
  await b.waitFor('!'+seen(current));
  await target(s,'list');
  assert.equal(await b.evaluate(query(ticketRow(s.id))+'.getAttribute("aria-current")'),'true');
  assert.equal(await b.evaluate("document.activeElement.matches(':focus-visible')"),true);
}));

test('37B B5.1 drawer without an item never falls back to board',suite,()=>scene(async s=>{
  const {b}=s,missing=randomUUID();
  // Hold the first detail read for an ID absent from the real board.
  await b.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
    const fetch=window.fetch;window.fetch=async function(input,init){
      if(new URL(input.url??input,location.href).pathname===${JSON.stringify('/api/workbench/items/ticket/'+missing)}){
        await new Promise(resolve=>{window.releaseB5Detail=resolve});
      }
      return fetch.call(this,input,init);
    };
  })()`});
  await navigate(s,'items/ticket/'+missing,seen('.detail-dialog')+'&&typeof window.releaseB5Detail==="function"');
  try{
    await record(b);
    const url=await b.evaluate('location.href');
    for(const action of actions)await key(b,action);
    await b.evaluate(frame);
    assert.equal(await b.evaluate('location.href'),url);
    assert.equal(await b.evaluate(seen([closeDialog,hint,'.detail-assignment-dialog',toast('copy-number')].join(','))),false);
    assert.deepEqual(await b.evaluate('b5log.calls'),[]);
  }finally{await b.evaluate('releaseB5Detail()');}
}));

test('37B B5.8 forced colors preserve focus on the hovered current card',suite,()=>scene(async s=>{
  const {b,card}=s;
  await target(s,'board');
  await hover(b,card+' .card-open');
  await b.command('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'active'}]});
  await waitForAnimationsSettled(b,card);
  const indicator=await b.evaluate(`(()=>{
    const card=${query(card)},link=card.querySelector('a.card-open');
    if(!matchMedia('(forced-colors: active)').matches||!card.matches(':hover')||!card.contains(document.activeElement))throw Error('missing focused high-contrast fixture');
    return [card,link].some(n=>{const css=getComputedStyle(n);return css.outlineStyle!=='none'&&parseFloat(css.outlineWidth)>=2;});
  })()`);
  assert.equal(indicator,true,'the current card keeps a visible outline when the browser suppresses shadows');
}));

test('37B B5.3 B5.8 keyboard-opened menu owns focus and Escape',suite,()=>scene(async s=>{
  const {b,card}=s;
  await target(s,'board');
  const trigger=card+' [data-action=board-action-menu]';
  await b.evaluate(query(trigger)+'.focus()');await key(b,'Enter');await b.waitFor(visible(menu));
  await b.evaluate(frame);
  assert.equal(await b.evaluate(query(menu)+'?.contains(document.activeElement)&&document.activeElement.matches("[role=menuitem]")'),true);
  await key(b,'Escape');await b.waitFor('!'+seen(menu));
  assert.equal(await b.evaluate('document.activeElement==='+query(trigger)),true);
}));

test('37B R2 Ctrl K uses the owner-approved label on every shortcut surface',suite,()=>scene(async({b})=>{
  const approved='搜索与快捷操作',entry='button.efficiency-entry';
  await b.waitFor(visible(entry));
  await hover(b,entry);
  const tip='[data-tooltip-open=true]:has(>'+entry+') > [data-shortcut-tooltip=true]';
  await b.waitFor(visible(tip));
  const labels={
    definition:shortcuts.SHORTCUTS.find(row=>row.id==='command-panel')?.label,
    // The sidebar entry keeps its existing visible text 「搜索工作区」 (card B4: the sidebar entry is kept); the owner decision covers the Ctrl K label.
    button:await b.evaluate(query(entry+' .ds-button-label > span:not(.ds-kbd-group)')+'.innerText'),
    accessibleName:await b.evaluate(query(entry)+'.getAttribute("aria-label")'),
    tooltip:await b.evaluate(title(tip+' > span:first-child')),
  };
  await key(b,'k',2);await b.waitFor(visible(palette));
  const panelTitle=await b.evaluate(title(palette+' h2'));
  await key(b,'Escape');await b.waitFor('!'+seen(palette));
  await key(b,'?');await b.waitFor(visible(help));
  const dialogRow=await b.evaluate(title(help+' [data-shortcut-id=command-panel] .efficiency-help-label'));
  assert.deepEqual({...labels,panelTitle,dialogRow},{
    definition:approved,button:'搜索工作区',accessibleName:approved,tooltip:approved,panelTitle:approved,dialogRow:approved,
  });
}));

test('37B R3 every menu item on the last pending card is fully visible and hit-testable',suite,()=>scene(async s=>{
  const {b}=s;
  await board(s,'board');
  const last=await b.evaluate(`[...document.querySelectorAll('.board-column.pending .ticket-card')].filter(
    n=>n.checkVisibility()&&!n.closest('[hidden],[inert],[aria-hidden=true]')).at(-1)?.dataset.itemId`);
  assert.ok(typeof last==='string');
  const card=ticketCard(last);
  await b.evaluate(query(card+' .card-open')+'.focus({preventScroll:true});'+query(card)+'.scrollIntoView({block:"center",behavior:"instant"})');
  await waitForAnimationsSettled(b);
  await clickWorkbenchControl(b,card+' [data-action=board-action-menu]');
  await assertMenuItemsVisible(b);
}));

test('37B R3 canceling an untouched closure does not grant X after completion',suite,()=>scene(async s=>{
  const {b,id,http,card}=s;
  await target(s,'board');
  await b.waitFor(query(card+' [data-board-claim-action]')+'?.disabled===false');
  await record(b);
  await key(b,'x');await b.waitFor(visible(closeDialog));
  await key(b,'Escape');await b.waitFor('!'+seen(closeDialog));
  assert.deepEqual(await b.evaluate(writeLog),[],'the canceled form owns no submitted command');

  // Keep the provider mounted while the real ticket moves to the terminal state.
  const started=await http.start(id);
  const done=await http.post(id,'complete',http.command(started));
  assert.equal(done.status,200,await done.text());
  assert.ok(!(await http.detail(id)).allowed_actions.includes('dismiss'));
  await clickWorkbenchControl(b,'.ds-page-header button[aria-label=刷新]');
  await b.waitFor(visible('.board-column.handled '+card));
  await waitForAnimationsSettled(b);
  await clickWorkbenchControl(b,card+' .card-open');
  await b.waitFor(visible('.detail-dialog .ds-next-step'));
  assert.equal(await b.evaluate(seen('.detail-dialog [data-action=cancel]')),false,'no close or recovery entry for this completed ticket');
  await key(b,'Escape');await b.waitFor('!'+seen('.detail-dialog'));
  await waitForAnimationsSettled(b);
  await key(b,'3');
  await b.evaluate(query(card+' .card-open')+'.focus()');
  await b.waitFor(visible(card+current)+'&&document.activeElement==='+query(card+' .card-open'));
  await record(b);await key(b,'x');
  await b.waitFor(seen(hint)+'||'+seen(closeDialog));
  assert.equal(await b.evaluate(seen(closeDialog)),false,'an idle retained form cannot admit a fresh close');
  assert.equal(await b.evaluate(title(hint)),'这张工单现在不能关闭');
  assert.deepEqual(await b.evaluate('b5log.calls'),[]);
}));

test('37B R3 an idle close target gives a read-only role no recovery entry',suite,()=>scene(async s=>{
  const {b,id,card}=s;
  await target(s,'board');
  await b.waitFor(query(card+' [data-board-claim-action]')+'?.disabled===false');
  // Keep the authenticated read fixture and principal ID. Project a loss of
  // worker role and dismiss admission on the close dialog's normal fresh reads.
  await b.evaluate(`(()=>{
    const original=window.fetch;
    window.fetch=async function(input,init){
      const response=await original.apply(this,arguments);
      const path=new URL(input.url??input,location.href).pathname;
      if(!response.ok)return response;
      if(path==='/api/lifecycle/bootstrap'){
        const data=await response.json();data.roles=['REPORTER'];return Response.json(data);
      }
      if(path===${JSON.stringify('/api/tickets/'+id)}){
        const data=await response.json();data.allowed_actions=data.allowed_actions.filter(a=>a!=='dismiss');
        window.r3CloseReadOnly=true;return Response.json(data);
      }
      return response;
    };
  })()`);
  await record(b);
  await key(b,'x');await b.waitFor(visible(closeDialog)+'&&window.r3CloseReadOnly===true');
  await key(b,'Escape');await b.waitFor('!'+seen(closeDialog));
  assert.deepEqual(await b.evaluate(writeLog),[],'no unfinished operation was submitted');
  await key(b,'?');await b.waitFor(visible(help+' [data-shortcut-id=copy-number]'));
  assert.equal(await b.evaluate(seen(help+' [data-shortcut-id=close]')),false,'the role change reached the live workbench');
  await key(b,'Escape');await b.waitFor('!'+seen(help));

  await select(b,id,'board');await record(b);await key(b,'x');
  await b.waitFor(seen(closeDialog)+'||'+seen(hint));
  const opened=await b.evaluate(seen(closeDialog));
  if(opened){
    await b.waitFor(query(closeDialog)+'.innerText.includes("当前事项不可执行此操作")');
    assert.equal(await b.evaluate(seen(closeDialog+' [data-action=check-cancel-command]')),false,'no original command to recover');
    assert.equal(await b.evaluate(query(closeDialog+' button[type=submit]')+'.disabled'),true);
    assert.deepEqual(await b.evaluate(writeLog),[],'the erroneous form opening did not dispatch a close');
  }
  assert.equal(opened,false,'an empty target must not unlock X for a non-worker');
  assert.equal(await b.evaluate(title(hint)),'你没有关闭这张工单的权限');
  assert.deepEqual(await b.evaluate('b5log.calls'),[]);
}));

test('37B R5 one drawer X survives the initial detail read', suite, () => scene(async s => {
  const {b, id} = s;
  await target(s, 'board');
  await b.evaluate(`(() => {
    const original = window.fetch;
    const gate = new Promise(resolve => { window.r5ReleaseDetail = resolve; });
    window.fetch = async function(input, init) {
      if (new URL(input.url ?? input, location.href).pathname === ${JSON.stringify('/api/workbench/items/ticket/' + id)}
          && (init?.method ?? 'GET') === 'GET') {
        window.r5DetailStarted = true;
        await gate;
      }
      return original.apply(this, arguments);
    };
  })()`);
  const headerButton = '.detail-dialog [aria-label=关闭详情]';
  const entry = '.detail-dialog [data-action=cancel]';
  try {
    await key(b, 'Enter');
    await b.waitFor('window.r5DetailStarted && ' + visible(headerButton));
    await waitForAnimationsSettled(b, '.detail-dialog');
    await b.evaluate(query(headerButton) + '.focus()');
    assert.equal(await b.evaluate(query(headerButton) + ' === document.activeElement'), true);
    await record(b);
    await key(b, 'x');
    assert.equal(await b.evaluate(seen(closeDialog)), false, 'await the existing detail controller');
  } finally {
    await b.evaluate('r5ReleaseDetail()');
  }
  await b.waitFor(visible(closeDialog) + ' || ' + query(entry) + '?.disabled === false');
  await waitForAnimationsSettled(b);
  assert.deepEqual(await b.evaluate(writeLog), [], 'opening the form must never write');
  assert.equal(await b.evaluate(visible(closeDialog)), true,
    'one X opens the admitted form when the same drawer becomes ready');
}));

async function openCappedMenu(s: Scene) {
  const {b, card} = s;
  for (let i = 0; i < 6; i++) await seedMotionTicket(s.f.pool, '菜单滚动验收（合成）' + i);
  await target(s, 'board');
  await b.command('Emulation.setDeviceMetricsOverride', {width: 1280, height: 340, deviceScaleFactor: 1, mobile: false});
  const trigger = card + ' [data-action=board-action-menu]';
  await b.evaluate(query(trigger) + '.scrollIntoView({block:"center",behavior:"instant"});' + query(trigger) + '.focus({preventScroll:true})');
  await waitForAnimationsSettled(b);
  await key(b, 'Enter');
  await b.waitFor(visible(menu));
  await waitForAnimationsSettled(b);
  assert.equal(await b.evaluate(query(menu) + '.scrollHeight > ' + query(menu) + '.clientHeight'), true, 'exercise a capped menu');
  return trigger;
}

test('37B R5 capped board menu scrolls focused rows and dismisses offscreen', suite, () => scene(async s => {
  const {b} = s;
  const trigger = await openCappedMenu(s);
  const pageScroll = `(() => {
    const offsets = [];
    for (let el = ${query(trigger)}.parentElement; el; el = el.parentElement) offsets.push(el.scrollTop);
    return offsets;
  })()`;
  const initialScroll = await b.evaluate(pageScroll);
  for (const [name, code, index] of [['End', 35, -1], ['Home', 36, 0], ['ArrowDown', 40, 1], ['ArrowUp', 38, 0]] as const) {
    for (const type of ['keyDown', 'keyUp']) await b.command('Input.dispatchKeyEvent', {type, key: name, code: name, windowsVirtualKeyCode: code});
    await waitForAnimationsSettled(b);
    const state = await b.evaluate(`(() => {
      const menu = ${query(menu)};
      const items = [...menu.querySelectorAll('[role=menuitem]:not(:disabled):not([aria-disabled=true])')];
      const item = items.at(${index}), rect = item.getBoundingClientRect();
      const top = menu.getBoundingClientRect().top + menu.clientTop;
      return {focused: document.activeElement === item, fullyVisible: rect.top >= top && rect.bottom <= top + menu.clientHeight,
        hit: item.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)), scroll: ${pageScroll}};
    })()`);
    assert.deepEqual(state, {focused: true, fullyVisible: true, hit: true, scroll: initialScroll}, name);
  }
  // Scroll the real workspace scroller. Its identity depends on the board breakpoint.
  const destination = await b.evaluate(`(() => {
    const anchor = ${query(trigger)}, rect = anchor.getBoundingClientRect();
    for (let el = anchor.parentElement; el; el = el.parentElement) {
      if (el !== document.scrollingElement && !['auto','scroll'].includes(getComputedStyle(el).overflowY)) continue;
      const remaining = el.scrollHeight - el.clientHeight - el.scrollTop;
      if (remaining > rect.bottom || el.scrollTop > innerHeight - rect.top) {
        el.scrollTo({top: remaining > rect.bottom ? el.scrollHeight : 0, behavior: 'instant'});
        return true;
      }
    }
    return false;
  })()`);
  assert.equal(destination, true, 'the fixture has sufficient scroll range to move the anchor outside the viewport');
  await waitForAnimationsSettled(b);
  assert.equal(await b.evaluate(`(() => {const r = ${query(trigger)}.getBoundingClientRect(); return r.bottom <= 0 || r.top >= innerHeight;})()`), true, 'the mounted anchor scrolled outside the viewport');
  await b.waitFor('!' + seen(menu));
  assert.equal(await b.evaluate(query(trigger) + '.getAttribute("aria-expanded")'), 'false');
}));

test('37B R5 board menu stays open while its trigger intersects the viewport edge', suite, () => scene(async s => {
  const {b} = s;
  const trigger = await openCappedMenu(s);
  const moved = await b.evaluate(`(() => {
    const anchor = ${query(trigger)};
    const distance = innerHeight - 4 - anchor.getBoundingClientRect().top;
    for (let scroller = anchor.parentElement; scroller; scroller = scroller.parentElement) {
      if (scroller.scrollTop > distance && (scroller === document.scrollingElement || ['auto','scroll'].includes(getComputedStyle(scroller).overflowY))) {
        scroller.scrollTo({top: scroller.scrollTop - distance, behavior: 'instant'});
        return true;
      }
    }
    return false;
  })()`);
  assert.equal(moved, true, 'the fixture can place the trigger partly inside the viewport');
  await waitForAnimationsSettled(b);
  const state = await b.evaluate(`(() => {
    const anchor = ${query(trigger)}, rect = anchor.getBoundingClientRect();
    return {visiblePixels: innerHeight - rect.top, expanded: anchor.getAttribute('aria-expanded'),
      hit: anchor.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + 2))};
  })()`);
  assert.ok(state.visiblePixels >= 3 && state.visiblePixels <= 5, 'four pixels of the trigger still intersect the viewport');
  assert.equal(state.expanded, 'true', 'placement padding must not dismiss a menu with a visible anchor');
  assert.equal(state.hit, true, 'the visible portion of the trigger receives pointer hits');
}));

test('37B R5 reduced-motion board menu retains an inert opacity-only exit', suite, () => withScene(async s => {
  const {b, card} = s;
  await target(s, 'board');
  await clickWorkbenchControl(b, card + ' [data-action=board-action-menu]');
  await b.waitFor(visible(menu));
  await waitForAnimationsSettled(b);
  await b.evaluate(`(() => {
    const el = ${query(menu)};
    const observer = new MutationObserver(() => {
      if (!el.hasAttribute('data-exiting')) return;
      const css = getComputedStyle(el);
      window.r5Exit = {inert: el.inert, hidden: el.getAttribute('aria-hidden'), transform: css.transform,
        property: css.transitionProperty, seconds: parseFloat(css.transitionDuration), moves: el.querySelectorAll('[data-board-action-target]').length};
      observer.disconnect();
    });
    observer.observe(el, {attributes: true});
  })()`);
  await key(b, 'Escape');
  await b.waitFor('window.r5Exit && !' + seen(menu));
  const exit = await b.evaluate('r5Exit');
  assert.deepEqual({inert: exit.inert, hidden: exit.hidden, transform: exit.transform, moves: exit.moves},
    {inert: true, hidden: 'true', transform: 'none', moves: 0});
  assert.equal(exit.property, 'opacity', '36A E4 preserves an opacity-only exit under reduced motion');
  assert.ok(exit.seconds > 0, 'the exit shell must fade for a positive duration');
}, {keyboard: true, motion: 'reduce'}));

test('37B R5 board menu owns Ctrl Z through the first opacity transition frame', suite, () => scene(async s => {
  const {b, card, http, id} = s;
  await target(s, 'board');
  await key(b, 'f');
  await b.waitFor(visible(undoFor('item-follow')));
  await record(b);
  // Input at exactly the DOM-to-CSS transition boundary cannot be scheduled
  // reproducibly with two CDP round trips. Deliver it from the marker mutation.
  await b.evaluate(`(() => {
    const observer = new MutationObserver(records => {
      for (const {target} of records) {
        if (!target.matches(${JSON.stringify(menu)}) || target.hasAttribute('data-entering') || target.hasAttribute('data-exiting')) continue;
        observer.disconnect();
        document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true
        }));
        window.r5TransitionKeyDelivered = true;
        return;
      }
    });
    observer.observe(document.body, {subtree: true, attributes: true, attributeFilter: ['data-entering']});
  })()`);
  await clickWorkbenchControl(b, card + ' [data-action=board-action-menu]');
  await b.waitFor('window.r5TransitionKeyDelivered');
  await waitForAnimationsSettled(b);
  assert.deepEqual(await b.evaluate(writeLog), [], 'the menu must protect the committed follow throughout entry');
  assert.equal(await b.evaluate(visible(undoFor('item-follow'))), true);
  const response = await http.get('/api/workbench/items/ticket/' + id);
  assert.equal(response.status, 200);
  assert.equal(object(object(object(await response.json()).item).attention).following, true);
}));

test('37B R8 X gives the same unavailable hint on the converted review URL and canonical ticket URL', suite, () =>
  withWeb01Fixture(async (f: T11Fixture & {processReviewIntake: (id: string) => Promise<unknown>}) => {
    const http = await t11Http(f, 0, {closeConnections: true});
    const intake = await seedPersistedIntake({pool: f.pool, text: '转换工单快捷键（合成）'});
    await f.processReviewIntake(intake.intakeId);
    const review = await f.pool.query<{id: string}>(
      'SELECT id::text FROM intake.manual_review_item WHERE service_intake_id=$1::uuid', [intake.intakeId]);
    const reviewId = review.rows[0]?.id;
    assert.ok(reviewId);
    const read = async (path: string) => {
      const response = await http.get(path);
      assert.equal(response.status, 200, await response.clone().text());
      return object(await response.json());
    };
    const context = await read('/api/manual-reviews/' + reviewId);
    const command = {
      client_command_id: randomUUID(), expected_row_version: context.row_version,
      expected_material_basis: object(context.material_basis).current_hash,
      resolution_code: 'CONFIRM_TICKET_ELIGIBLE', resolution_reason_code: 'EXPLICIT_HUMAN_CHOICE',
    };
    const {csrf_token} = await read('/api/lifecycle/bootstrap');
    const cookie = f.cookies[0];
    assert.ok(cookie && typeof csrf_token === 'string' && typeof context.row_version === 'string');
    const resolved = await fetch(f.origin + '/api/manual-reviews/' + reviewId + '/resolve', {
      method: 'POST', body: JSON.stringify(command),
      headers: {cookie, origin: f.origin, 'content-type': 'application/json', 'x-csrf-token': csrf_token,
        'idempotency-key': command.client_command_id, 'if-match': '"' + context.row_version + '"'},
    });
    assert.equal(resolved.status, 200, await resolved.clone().text());
    const alias = 'review/' + reviewId;
    const converted = object((await read('/api/workbench/items/' + alias)).item);
    assert.ok(converted.kind === 'ticket' && typeof converted.id === 'string');
    // Set the terminal fixture state after the real review conversion. Both
    // drawer routes must now reject X for precisely the same canonical ticket.
    await f.pool.query("UPDATE pilot_ticket.ticket SET status='COMPLETED',version=version+1,terminal_at=platform.local_now(),terminal_epoch_ms=NULL WHERE id=$1::uuid", [converted.id]);
    const canonical = 'ticket/' + converted.id;
    const url = f.origin + '/workbench/app/items/';
    const sessionCookie = f.browserCookies[0];
    assert.ok(sessionCookie);
    const b = await launchSystemBrowser({url: url + canonical, width: 1280, height: 850,
      cookies: [{...sessionCookie, url: f.origin + '/'}]});
    assert.ok(b);
    try {
      for (const path of [canonical, alias]) {
        const detail = await read('/api/workbench/items/' + path);
        assert.equal(object(detail.item).id, converted.id);
        assert.equal(object(detail.item).status, 'COMPLETED');
        if (path === alias) assert.deepEqual(detail.requested_item, {kind: 'review', id: reviewId});
        const oldDocument = await b.evaluate('performance.timeOrigin');
        await b.command('Page.navigate', {url: url + path + '?range=all'});
        const copyButton = '.detail-dialog [aria-label=复制编号]';
        await b.waitFor('performance.timeOrigin !== ' + Number(oldDocument) + ' && ' + visible('.detail-dialog .ds-next-step') + ' && ' + query(copyButton) + '?.disabled === false');
        await waitForAnimationsSettled(b);
        await b.evaluate(query(copyButton) + '.focus()');
        await record(b);
        await key(b, 'x');
        await b.waitFor(visible(hint));
        assert.equal(await b.evaluate(title(hint)), '这张工单现在不能关闭', path);
        assert.equal(await b.evaluate(seen(closeDialog)), false, path);
        assert.deepEqual(await b.evaluate(writeLog), [], path);
      }
    } finally {
      await b.close();
    }
  }, {workbenchManualReviewEnabled: true, workbenchBoardActionsEnabled: true, ticketSelfHandlingEnabled: true,
    workbenchFollowEnabled: true, manualProjection: true}));

const detailCopy = '.detail-dialog [aria-label="复制编号"]';

async function assertTakeoverDisclosure(b: Browser, trigger: () => Promise<void>) {
  await b.waitFor(visible(takeoverEntry));
  assert.equal(await b.evaluate(query(takeoverEntry) + '.textContent.trim()'), '接管处理');
  assert.equal(await b.evaluate(query(takeoverEntry) + '.getAttribute("aria-expanded")'), 'false');
  const choices = `[...${query(takeoverSection)}.querySelectorAll('input[type=radio],input[type=checkbox]')].map(n=>[n.value,n.checked])`;
  const initialChoices = await b.evaluate(choices);
  assert.ok(Array.isArray(initialChoices) && initialChoices.length >= 2);
  await record(b);
  await trigger();
  await b.waitFor(visible(takeoverTeam) + ' || ' + seen(hint));
  await waitForAnimationsSettled(b);
  assert.equal(await b.evaluate(seen(hint)), false);
  assert.equal(await b.evaluate(query(takeoverEntry) + '.getAttribute("aria-expanded")'), 'true');
  const labels = await b.evaluate(query(takeoverTeam) + ".getAttribute('aria-labelledby').split(' ').map(id => document.getElementById(id)?.textContent.trim())");
  assert.ok(labels.includes('接管处理组'), 'the focused selector is labelled 接管处理组');
  assert.equal(await b.evaluate('document.activeElement === ' + query(takeoverTeam)), true);
  assert.match(await b.evaluate(title(takeoverTeam)), /请选择本人的处理组/);
  assert.deepEqual(await b.evaluate(choices), initialChoices);
  assert.equal(await b.evaluate(query(takeoverSection + ' [data-action=takeover-and-start]') + '.disabled'), true);
  assert.deepEqual(await b.evaluate(writeLog), [], 'selecting the workflow cannot send a business command');
}

test('37B PR1 drawer A opens and focuses the original takeover form without submitting', suite, () =>
  takeoverScene(async s => {
    await assignTakeoverOnly(s);
    await target(s, 'drawer');
    await s.b.waitFor(visible(takeoverEntry));
    for (const expanded of ['true', 'false']) {
      await clickWorkbenchControl(s.b, takeoverEntry);
      await waitForAnimationsSettled(s.b);
      assert.equal(await s.b.evaluate(query(takeoverEntry) + '.getAttribute("aria-expanded")'), expanded);
      assert.equal(await s.b.evaluate('document.activeElement === ' + query(takeoverEntry)), true, 'pointer disclosure keeps trigger focus');
    }
    await s.b.evaluate(query(detailCopy) + '.focus()');
    await assertTakeoverDisclosure(s.b, () => key(s.b, 'a'));
    // A second request from the header keeps the disclosure open.
    await s.b.evaluate(query(detailCopy) + '.focus()');
    await key(s.b, 'a');
    await s.b.waitFor('document.activeElement === ' + query(takeoverTeam));
    assert.deepEqual(await s.b.evaluate(writeLog), []);
  }));

test('37B PR1 palette 领取 opens the same takeover form and focuses its team field', suite, () =>
  takeoverScene(async s => {
    const {b, id} = s;
    await assignTakeoverOnly(s);
    // The sidebar entry is accessible on full-page detail. Ctrl K is paused in detail.
    await navigate(s, 'items/ticket/' + id + '?range=all&detail=page', visible('.detail-page .ds-next-step'));
    await assertTakeoverDisclosure(b, async () => {
      await b.evaluate(query('.sidebar-search.efficiency-entry') + '.focus()');
      await key(b, 'Enter');
      await b.waitFor(visible(palette + ' input'));
      const claimRows = `[...${query(palette)}.querySelectorAll('[role=option]')].filter(row => row.querySelector('strong')?.textContent === '领取')`;
      await b.waitFor(claimRows + '.length === 1');
      const optionId: unknown = await b.evaluate(claimRows + '[0].id');
      assert.ok(typeof optionId === 'string' && optionId.length > 0);
      await clickWorkbenchControl(b, palette + ' [role=option][id=' + JSON.stringify(optionId) + ']');
      await b.waitFor('!' + seen(palette));
    });
  }));
