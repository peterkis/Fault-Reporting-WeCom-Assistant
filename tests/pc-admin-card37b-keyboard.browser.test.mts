import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {shortcuts} from './helpers/card37b-shortcut-module.mjs';
import {board,caps,capture,chip,current,frame,help,hint,key,menu,navigate,palette,record,select,target,timeCapsule,assertLifetime} from './helpers/card37b-keyboard-browser.mjs';
import {type Browser,type Scene,active,claimPath,claimToast,closeDialog,ctrlZ,follow,heading,indexOf,pending,routeWrite,startTrace,toast,visible,withScene} from './helpers/card37a-optimistic-fixture.mjs';
import {query,seedMotionTicket,ticketCard,ticketRow} from './helpers/motion-board-fixture.mjs';
import {waitForAnimationsSettled} from './helpers/browser-animations.mjs';
import {assertNoTransformAnimations} from './helpers/motion-assert.mjs';
import {clickWorkbenchControl} from './helpers/heroui-workbench-controls.mjs';
import {hover,move,point} from './helpers/card37c-hover-browser.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';
import {object} from './helpers/t42-board-browser-fixture.mjs';
import type {T11Fixture} from './helpers/t11-completion-fixture.mjs';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {seedPersistedIntake} from './helpers/p2-015-postgres-harness.mjs';
import {launchSystemBrowser} from './helpers/p2-006-browser-harness.mjs';
import {yxxTab} from './helpers/p2-g2-yixiaoxiu-browser.mjs';

const suite={timeout:360000};
const scene=(run:(s:Scene)=>Promise<void>)=>withScene(run,{keyboard:true});
const writeLog='b5log.calls.filter(([method])=>!["GET","HEAD","OPTIONS"].includes(method))';
const actions=['a','t','d','x','f','m','c'] as const;
const title=(selector:string)=>query(selector)+'?.textContent';
const seen=(selector:string)=>'Boolean('+query(selector)+')';
const undoFor=(source:string)=>toast(source)+' [data-toast-action=undo]';

async function number(s:Scene,id:string,kind:string){
  const response=await s.http.get('/api/workbench/items/'+kind+'/'+id);
  assert.equal(response.status,200);
  const data:unknown=await response.json();
  assert.ok(data&&typeof data==='object'&&'item' in data&&data.item&&typeof data.item==='object'&&'number' in data.item&&typeof data.item.number==='string');
  return data.item.number;
}
async function copy(s:Scene,id:string,kind='ticket'){
  const value=await number(s,id,kind);
  await s.b.command('Browser.grantPermissions',{origin:s.f.origin,permissions:['clipboardReadWrite','clipboardSanitizedWrite']});
  await s.b.evaluate("navigator.clipboard.writeText('等待复制（合成）')");
  await key(s.b,'c');
  await s.b.waitFor(heading('copy-number')+'==='+JSON.stringify('已复制编号 '+value));
  assert.equal(await s.b.evaluate('navigator.clipboard.readText()'),value);
}

for(const surface of ['board','list','drawer'] as const){
  test('37B B5.1 item keys on '+surface,suite,t=>scene(async s=>{
    const {b,http,f,id}=s;
    const mine=await seedMotionTicket(f.pool,'我的处理中工单');
    const theirs=await seedMotionTicket(f.pool,'同事已领取');
    await http.start(mine);
    await (await t11Http(f,2,{closeConnections:true})).start(theirs);
    for(const action of actions)await t.test('available '+action,async()=>{
      const item=action==='d'?mine:id;
      const owner=await target(s,surface,item);
      if(action==='a'){
        // Keyboard selection can precede the command-context read. Exercise the
        // admitted control here; the held-read case separately covers an early A.
        const claim=owner+(surface==='drawer'?' [data-action=take-and-start]':' [data-board-claim-action]');
        await b.waitFor(query(claim)+'?.matches(":enabled:not([aria-disabled=true])")===true');
      }
      if(surface==='drawer'){
        const ready:Record<string,string>={a:'[data-action=take-and-start]',t:'[data-action=open-assignment]',d:'.detail-complete-button,[data-step-action=complete]',m:'#internal-note',x:'[data-action=cancel]',f:follow};
        if(ready[action])await b.waitFor(seen(ready[action]));
      }
      await record(b);
      if(action==='c'){await copy(s,item);return;}
      await key(b,action);
      if(action==='a'){
        await b.waitFor(visible(undoFor('ticket-self-handling')));
        assert.equal((await http.detail(id)).status,'IN_PROGRESS');
        await ctrlZ(b);
        await b.waitFor(heading('ticket-return-to-dispatch')+'==="已撤销"');
        assert.equal((await http.detail(id)).assignee_id,null);
      }else if(action==='f'){
        await b.waitFor(visible(undoFor('item-follow')));
        assert.equal(await b.evaluate(writeLog+'.filter(([,p])=>p.endsWith("/follow")).length'),1);
        await ctrlZ(b);
        await b.waitFor(heading('item-follow')+'==="已撤销"');
      }else{
        const selector={t:'.detail-assignment-dialog',d:'#completion-process',x:closeDialog,m:'#internal-note'}[action];
        await b.waitFor(visible(selector));
        if(action==='m')await b.waitFor('document.activeElement==='+query(selector));
        assert.deepEqual(await b.evaluate(writeLog),[],action+' only opens the original entry');
        if(action!=='x')assert.equal(await b.evaluate('location.pathname'),'/workbench/app/items/ticket/'+item);
      }
    });
    await t.test('unavailable claim and completion',async()=>{
      for(const [action,item,message] of [['a',theirs,'这张工单现在不能领取'],['d',id,'这张工单现在不能登记完工']] as const){
        await target(s,surface,item);
        await record(b);
        await key(b,action);
        await b.waitFor(title(hint)+'==='+JSON.stringify(message));
        assert.deepEqual(await b.evaluate('b5log.calls'),[],surface+' '+action);
      }
    });
    if(surface!=='drawer')await t.test('no keyboard target',async()=>{
      await board(s,surface);
      assert.equal(await b.evaluate(seen(current)),false);
      const path=await b.evaluate('location.href');
      await record(b);
      for(const action of actions)await key(b,action);
      await b.evaluate(frame);
      assert.equal(await b.evaluate('location.href'),path);
      assert.equal(await b.evaluate(seen([current,help,hint,closeDialog,'.detail-dialog',toast('copy-number')].join(','))),false);
      assert.deepEqual(await b.evaluate('b5log.calls'),[]);
    });
  }));
}

test('37B B5.1 movement, workspace keys and detail precedence',suite,t=>scene(async s=>{
  const {b,id}=s;
  for(const view of ['board','list'] as const)await t.test(view,async()=>{
    await board(s,view);
    const stage=(i:number)=>view==='board'?'.board-column.'+['pending','active','handled'][i]:'#list-'+['pending','active','handled'][i];

    await waitForAnimationsSettled(b);
    for(const i of [0,1,2]){
      const first=await b.evaluate(`[...${query(stage(i))}.querySelectorAll('a.card-open')].find(n=>n.checkVisibility()&&!n.closest('[hidden],[inert],[aria-hidden=true]'))?.href`);
      assert.equal(typeof first,'string',stage(i)+' fixture requires a navigable item');
      await key(b,String(i+1));
      assert.equal(await b.evaluate('document.activeElement.href'),first);
    }
    await key(b,'1');
    const first=await b.evaluate('document.activeElement.href');
    await key(b,'j');assert.notEqual(await b.evaluate('document.activeElement.href'),first);
    await key(b,'k');assert.equal(await b.evaluate('document.activeElement.href'),first);
    for(const [letter,column] of [['l',1],['h',0]] as const){
      await key(b,letter);
      if(view==='board')assert.equal(await b.evaluate(query(stage(column))+'.contains(document.activeElement)'),true);
      else assert.equal(await b.evaluate('document.activeElement.href'),first);
    }
    await key(b,'/');assert.equal(await b.evaluate("document.activeElement.matches('.workbench-search input[name=q]')"),true);
    await b.evaluate('document.activeElement.blur()');
    await key(b,'v');await b.waitFor(visible(view==='board'?'.ds-work-table':'.board'));
    await key(b,'n');await b.waitFor(visible('[data-manual-report-form]'));
  });
  await t.test('drawer J and K use neighbouring detail, C uses detail, Escape returns',async()=>{
    await target(s,'board',id);await key(b,'Enter');await b.waitFor(visible('.detail-dialog #detail-title'));
    const original=await b.evaluate('location.pathname');
    const next='.detail-next[aria-label=下一项]';
    await b.waitFor(query(next)+'?.disabled===false');
    // Read the original next/previous buttons' destination without a pointerdown
    // clearing keyboard-current on the background board.
    await b.evaluate(query(next)+'.click()');
    await b.waitFor('location.pathname!=='+JSON.stringify(original)+'&&'+visible('.detail-dialog .ds-next-step'));
    const nextPath=String(await b.evaluate('location.pathname'));
    await b.evaluate(query('.detail-previous')+'.click()');
    await b.waitFor('location.pathname==='+JSON.stringify(original));
    await waitForAnimationsSettled(b,'.detail-dialog');
    await b.evaluate(query(next)+'.focus()');
    await key(b,'j');await b.waitFor('location.pathname==='+JSON.stringify(nextPath));
    const parts=nextPath.split('/'),other=parts.at(-1),kind=parts.at(-2);
    assert.ok(other&&kind);
    await b.waitFor(visible('.detail-dialog .ds-next-step'));
    assert.equal(await b.evaluate(query(current)+'?.dataset.itemId'),id);
    await copy(s,other,kind);
    await key(b,'k');await b.waitFor('location.pathname==='+JSON.stringify(original));
    await key(b,'Escape');await b.waitFor('!'+seen('.detail-dialog'));
    await navigate(s,'items/'+kind+'/'+other+'?detail=page',visible('.detail-page .ds-next-step'));
    await copy(s,other,kind);
    await key(b,'Escape');await b.waitFor(visible('.board'));
  });
}));

test('37B B5.2 A moves before acknowledgement and newest Ctrl Z restores original index',suite,()=>scene(async s=>{
  const {b,card,id,http}=s;
  await target(s,'board');
  const before=Number(await b.evaluate(indexOf(card)));
  assert.ok(before>0,'exercise a non-leading card');
  await b.waitFor(query(card+' [data-board-claim-action]')+'?.disabled===false');
  // Put a real older Undo in the stack, then let A become the newest.
  await key(b,'f');await b.waitFor(visible(undoFor('item-follow')));
  await routeWrite(b,claimPath,'hold');
  await startTrace(b,card);
  await b.evaluate("document.addEventListener('keydown',()=>{card37Trace.clicked=performance.now()},{capture:true,once:true})");
  await record(b);
  try{
    await key(b,'a');
    await b.waitFor(visible(active(card)+'[data-optimistic-pending=claim]')+'&&card37Route.started>0');
    assert.equal(await b.evaluate('card37Route.ack'),0);
    await b.waitFor('card37Trace.moved!==null');
    const latency=Number(await b.evaluate('card37Trace.moved-b5log.at'));
    assert.ok(latency>=0&&latency<=100,'A keydown to optimistic column '+latency+'ms');
    assert.equal((await http.detail(id)).assignee_id,null);
  }finally{await b.evaluate('card37Trace.stop();card37Route.release()');}
  await b.waitFor(visible(undoFor('ticket-self-handling')));
  assert.equal(await b.evaluate(writeLog+'.filter(([,p])=>p.endsWith("/take-and-start")).length'),1);
  await ctrlZ(b);
  await b.waitFor(heading('ticket-return-to-dispatch')+'==="已撤销"&&'+visible(pending(card))+'&&!'+seen(card+'[data-optimistic-state]'));
  assert.equal(await b.evaluate(indexOf(card)),before);
  assert.equal((await http.detail(id)).status,'QUEUED');
  assert.equal(await b.evaluate(writeLog+'.filter(([,p])=>p.endsWith("/follow")).length'),0,'older follow was untouched by Ctrl Z');
}));

test('37B B5.3 editable, composition, modifiers, menu and modal own their keys',suite,()=>scene(async s=>{
  const {b,card}=s;
  await target(s,'board');
  await key(b,'/');assert.equal(await b.evaluate('document.activeElement.matches("input")'),true);
  await record(b);
  await key(b,'a');await key(b,'x');
  assert.equal(await b.evaluate(seen(closeDialog)),false);
  assert.deepEqual(await b.evaluate(writeLog),[]);
  await b.evaluate(query(card+' a.card-open')+'.focus()');
  await b.evaluate("document.activeElement.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}))");
  await key(b,'a');await key(b,'x');
  assert.equal(await b.evaluate(seen(closeDialog)),false);
  assert.deepEqual(await b.evaluate(writeLog),[]);
  await b.evaluate("window.b5compositionEnd=performance.now();document.activeElement.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}))");
  await b.evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'x',isComposing:true,bubbles:true}))");

  // The app has a 50ms IME-tail guard. Await the end of that time window before
  // asking it to open another surface.
  await b.waitFor('performance.now()-b5compositionEnd>50');
  for(const modifier of [1,2,4,8])await key(b,'a',modifier);
  for(const [open,marker] of [['?',help],['k',palette],['menu',menu],['x',closeDialog]] as const){
    if(open==='menu')await clickWorkbenchControl(b,card+' [data-action=board-action-menu]');
    else await key(b,open,open==='k'?2:0);
    await b.waitFor(visible(marker));
    const before=await b.evaluate(query(current)+'?.dataset.itemId');
    assert.equal(before,s.id);
    // Focus a non-editable control, so the overlay guard must do the work.
    await b.evaluate(query(marker)+".querySelector('button:not(:disabled)').focus()");
    await key(b,'j');await key(b,'a');
    assert.equal(await b.evaluate(query(current)+'?.dataset.itemId'),before);
    assert.equal(await b.evaluate(visible(marker)),true);
    await key(b,'Escape');await b.waitFor('!'+seen(marker));
  }
  assert.deepEqual(await b.evaluate(writeLog),[]);
}));

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

test('37B B5.1 accepted by me keeps the admitted drawer claim action',suite,()=>scene(async s=>{
  const {b,http,id}=s,prior=await http.detail(id);
  const accepted=await http.post(id,'accept-for-later',{client_command_id:randomUUID(),expected_version:prior.version,
    reason_code:'WORKBENCH_SELF_HANDLING',resolver_team_id:prior.resolver_team_id});
  assert.equal(accepted.status,200,await accepted.text());
  await target(s,'drawer');
  await b.waitFor(query('[data-action=take-and-start]')+'?.disabled===false');
  await record(b);await key(b,'a');
  await b.waitFor(heading('ticket-self-handling')+'==="已领取"');
  assert.equal((await http.detail(id)).status,'IN_PROGRESS');
  assert.equal(await b.evaluate(writeLog+'.filter(([,p])=>p.endsWith("/take-and-start")).length'),1);
}));

test('37B B5.3 Ctrl Z cannot consume Undo underneath a board menu',suite,()=>scene(async s=>{
  const {b,card}=s;
  await target(s,'board');await key(b,'f');await b.waitFor(visible(undoFor('item-follow')));
  await clickWorkbenchControl(b,card+' [data-action=board-action-menu]');await b.waitFor(visible(menu));
  await b.evaluate(query(menu+' [role=menuitem]')+'.focus()');
  await record(b);await ctrlZ(b);await b.evaluate(frame);
  assert.deepEqual(await b.evaluate(writeLog),[]);
  assert.equal(await b.evaluate(visible(undoFor('item-follow'))),true);
  await key(b,'Escape');await b.waitFor('!'+seen(menu));
  await ctrlZ(b);await b.waitFor(heading('item-follow')+'==="已撤销"');
}));

test('37B B5.2 pending keyboard follow retains its Undo when detail opens',suite,()=>scene(async s=>{
  const {b,card}=s;
  await target(s,'board');await routeWrite(b,'/follow','hold');
  try{
    await key(b,'f');await b.waitFor('card37Route.started>0');
    await b.waitFor(seen(card+'[data-optimistic-pending=follow]')+'||'+seen(card+'[data-optimistic-state]'));
    await key(b,'Enter');await b.waitFor(visible('.detail-dialog #detail-title'));
  }finally{await b.evaluate('card37Route.release()');}
  await b.waitFor(visible(undoFor('item-follow')));
  await ctrlZ(b);await b.waitFor(heading('item-follow')+'==="已撤销"');
  await b.waitFor(query(follow)+'?.dataset.following==="false"');
}));

test('37B B5.1 B5.7 restricted account across board, list and drawer',suite,t=>withScene(async s=>{
  const {b,id}=s;
  // The fixture supplies authenticated worker reads. Replace only the UI bootstrap
  // role to exercise the read-only projection; the server actually disables follow.
  await b.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
    const fetch=window.fetch;window.fetch=async function(input,init){
      const response=await fetch.call(this,input,init);
      if(new URL(input.url??input,location.href).pathname!=='/api/lifecycle/bootstrap'||!response.ok)return response;
      const body=await response.json();body.roles=['REPORTER'];window.b5Role=body.roles[0];return Response.json(body);
    };
  })()`});
  for(const view of ['board','list','drawer'] as const)await t.test(view,async()=>{
    if(view==='drawer'){
      await navigate(s,'items/ticket/'+id,visible('.detail-dialog .ds-next-step'));
      await b.evaluate(query('.detail-dialog [aria-label=复制编号]')+'.focus()');
    }else await target(s,view);
    assert.equal(await b.evaluate('window.b5Role'),'REPORTER');
    await key(b,'?');await b.waitFor(visible(help+' [data-shortcut-id=copy-number]'));
    assert.equal(await b.evaluate(seen(help+' [data-shortcut-id=close]')),false);
    assert.equal(await b.evaluate(query(help)+'.innerText.includes("关闭事项…")'),false);
    await key(b,'Escape');await b.waitFor('!'+seen(help));
    const url=await b.evaluate('location.href');
    for(const [letter,copy] of [['a','你没有领取这张工单的权限'],['t','你没有转交这张工单的权限'],
      ['d','你没有登记完工的权限'],['x','你没有关闭这张工单的权限'],['f','你没有关注工单的权限'],['m','你没有写内部备注的权限']] as const){
      await record(b);await key(b,letter);await b.waitFor(title(hint)+'==='+JSON.stringify(copy));
      assert.deepEqual(await b.evaluate('b5log.calls'),[],view+' '+letter);
      assert.equal(await b.evaluate('location.href'),url);
      assert.equal(await b.evaluate(seen(closeDialog+',.detail-assignment-dialog')),false);
      assert.equal(await b.evaluate(query(hint)+'.closest("[inert],[aria-hidden=true]")'),null);
    }
    await copy(s,id);
  });
},{keyboard:true,followEnabled:false}));

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

test('37B B5.1 workspace and detail navigation by context',suite,t=>scene(async s=>{
  const {b}=s;
  for(const view of ['board','list','drawer'] as const)await t.test(view,async()=>{
    await target(s,view);
    await key(b,'k',2);
    if(view==='drawer'){
      const url=await b.evaluate('location.href');
      assert.equal(await b.evaluate(seen(palette)),false);
      for(const letter of ['h','l','1','2','3','n','v','/'])await key(b,letter);
      assert.equal(await b.evaluate('location.href'),url);
      assert.equal(await b.evaluate('document.activeElement.matches("input")'),false);
    }else{
      await b.waitFor(visible(palette));await key(b,'Escape');await b.waitFor('!'+seen(palette));
      await key(b,'Enter');await b.waitFor(visible('.detail-dialog #detail-title'));
      assert.equal(await b.evaluate('location.pathname'),'/workbench/app/items/ticket/'+s.id);
      await key(b,'Escape');await b.waitFor('!'+seen('.detail-dialog'));
    }
    for(const [letter,path] of [['w','/'],['c','/conversations'],['n','/notification-exceptions']] as const){
      await target(s,view);await key(b,'g');await b.waitFor(visible(chip));await key(b,letter);
      await b.waitFor('location.pathname==='+JSON.stringify('/workbench/app'+path)+'&&!'+seen(chip));
    }
  });
}));

test('37B B5.3 a delayed claim lookup cannot submit behind help',suite,()=>scene(async s=>{
  const {b,id,card}=s;
  await b.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
    const fetch=window.fetch;
    let release;const gate=new Promise(resolve=>{release=resolve});
    window.fetch=async function(input,init){
      const response=await fetch.call(this,input,init);
      if(new URL(input.url??input,location.href).pathname===${JSON.stringify('/api/tickets/'+id)}){
        window.releaseB5ClaimRead=release;await gate;
      }
      return response;
    };
  })()`});
  await target(s,'board');
  await b.waitFor('typeof window.releaseB5ClaimRead==="function"');
  try{
    await record(b);await key(b,'a');await key(b,'?');await b.waitFor(visible(help));
  }finally{await b.evaluate('releaseB5ClaimRead()');}
  // Wait until the held context is consumed. An illegal background claim can
  // move the source button away, so both outcomes finish the observation.
  await b.waitFor(query(card+' [data-board-claim-action]')+'?.disabled===false||'+writeLog+'.length>0');
  await b.evaluate(frame);
  assert.deepEqual(await b.evaluate(writeLog),[]);
  assert.equal(await b.evaluate(visible(help)),true);
  assert.equal((await s.http.detail(id)).assignee_id,null);
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

test('37B B5.1 unavailable item actions reuse command admission before navigating',suite,t=>withScene(async s=>{
  const {b,f,http}=s;
  const mine=await seedMotionTicket(f.pool,'只由原处理人办理');
  await http.start(mine);
  const reopened=await seedMotionTicket(f.pool,'等待重新派单');
  await f.pool.query("UPDATE pilot_ticket.ticket SET status='REOPENED' WHERE id=$1::uuid",[reopened]);
  const peer=await t11Http(f,2,{closeConnections:true}),cookie=f.browserCookies[2],actorCookie=f.browserCookies[0];
  const handler=f.principals[1];assert.ok(cookie&&actorCookie&&handler);
  // The isolated auth fixture issues distinct names and resolves the first
  // configured match. Remove the actor session before selecting the handler.
  await b.command('Network.deleteCookies',{name:actorCookie.name,url:f.origin+'/'});
  await b.command('Network.setCookie',{...cookie,url:f.origin+'/'});
  const browserPrincipal=await b.evaluate(`(async()=>{
    const response=await fetch('/api/lifecycle/bootstrap',{cache:'no-store'});
    const {principal_id,roles}=await response.json();return {status:response.status,principal_id,roles};
  })()`);
  assert.deepEqual(browserPrincipal,{status:200,principal_id:handler.id,roles:['HANDLER']});
  for(const [letter,item,admissions,verb] of [
    ['t',reopened,['assign','transfer-assignment'],'转交'],['d',mine,['complete'],'登记完工'],['m',mine,['add-note'],'写内部备注'],
  ] as const){
    const ctx=await peer.detail(item);
    assert.ok(admissions.every(action=>!ctx.allowed_actions.includes(action)),'fixture requires denied '+verb);
    for(const view of ['board','list','drawer'] as const)await t.test(view+' '+letter,async()=>{
      if(view==='drawer'){
        await navigate(s,'items/ticket/'+item,visible('.detail-dialog .ds-next-step'));
        await b.evaluate(query('.detail-dialog [aria-label=复制编号]')+'.focus()');
      }else await target(s,view,item);
      const previous=await b.evaluate('location.href');
      await record(b);await key(b,letter);
      await b.waitFor(seen(hint)+'||location.href!=='+JSON.stringify(previous));
      assert.equal(await b.evaluate('location.href'),previous,'denied '+verb+' stays on its original surface');
      assert.match(String(await b.evaluate(title(hint))),new RegExp(verb,'u'));
      assert.deepEqual(await b.evaluate('b5log.calls'),[],'denied '+verb+' makes no request');
    });
  }
},{keyboard:true,followEnabled:false}));

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

test('37B B5.1 B5.6 unavailable workspace destinations and entry keys',suite,t=>withScene(async s=>{
  const {b}=s;
  for(const view of ['board','list','drawer'] as const)await t.test(view,async()=>{
    await target(s,view);
    const url=await b.evaluate('location.href');
    await b.evaluate('window.b5InitialFocus=document.activeElement;true');
    assert.equal(await b.evaluate(seen('[data-action=new-report]')),false);
    await record(b);
    await key(b,'n');await key(b,'/');
    assert.equal(await b.evaluate('document.activeElement===b5InitialFocus'),true);
    for(const letter of ['c','n']){
      await key(b,'g');await b.waitFor(visible(chip));
      const label=String(await b.evaluate(title(chip)));
      assert.match(label,/W 工作台/u);assert.doesNotMatch(label,/C 会话|N 通知异常/u);
      await key(b,letter);await b.waitFor('!'+seen(chip));
      assert.equal(await b.evaluate('location.href'),url);
    }
    assert.deepEqual(await b.evaluate('b5log.calls'),[]);
  });
}));

test('37B R2 Tab to a different card applies C to the focused ticket',suite,()=>scene(async s=>{
  const {b}=s;
  await target(s,'board');
  await b.command('Browser.grantPermissions',{origin:s.f.origin,permissions:['clipboardReadWrite','clipboardSanitizedWrite']});
  const limit=Number(await b.evaluate("document.querySelectorAll('a,button,input,select,textarea,[tabindex]').length"))+1;
  let focusedId:unknown;
  for(let i=0;i<limit;i++){
    await b.pressTab();
    focusedId=await b.evaluate("document.activeElement.matches('a.card-open')?document.activeElement.closest('.ticket-card[data-kind=ticket]')?.dataset.itemId:null");
    if(typeof focusedId==='string'&&focusedId!==s.id)break;
  }
  assert.ok(typeof focusedId==='string'&&focusedId!==s.id,'Tab must reach another ticket link');
  const expected=await number(s,focusedId,'ticket');
  await key(b,'c');await b.waitFor(visible(toast('copy-number')));
  assert.equal(await b.evaluate('navigator.clipboard.readText()'),expected,'C uses the ticket reached with Tab');
}));

test('37B R2 a committed keyboard follow keeps Undo across G C',suite,()=>scene(async s=>{
  const {b,http,id}=s;
  await target(s,'board');
  const itemPath='/api/workbench/items/ticket/'+id;
  const following=async()=>{
    const response=await http.get(itemPath);
    assert.equal(response.status,200);
    const item=object((object(await response.json())).item);
    return object(item.attention).following;
  };
  const path=itemPath+'/follow';
  // Hold only the successful response. The server has already committed the
  // real command when the operator navigates away from Workbench.
  await b.evaluate(`(()=>{
    const original=window.fetch,gate=new Promise(resolve=>{window.releaseFollowResponse=resolve});
    window.fetch=async function(input,init){
      const result=await original.apply(this,arguments);
      if(init?.method==='POST'&&new URL(input.url??input,location.href).pathname===${JSON.stringify(path)}){
        window.followResponseStatus=result.status;await gate;
      }
      return result;
    };
  })()`);
  try{
    await key(b,'f');
    await b.waitFor('Number.isInteger(window.followResponseStatus)');
    assert.equal(await b.evaluate('window.followResponseStatus'),200);
    assert.equal(await following(),true);
    await key(b,'g');await b.waitFor(visible(chip));await key(b,'c');
    await b.waitFor('location.pathname.endsWith("/conversations")');
  }finally{await b.evaluate('releaseFollowResponse()');}
  await b.waitFor(visible(undoFor('item-follow')),{timeoutMs:5000});
  await ctrlZ(b);await b.waitFor(heading('item-follow')+'==="已撤销"');
  assert.equal(await following(),false);
}));

test('37B R2 a denied read retires an UNKNOWN board claim controller once',suite,()=>scene(async s=>{
  const {b,id,card,f}=s,principal=f.principals[0];
  assert.ok(principal);
  await target(s,'board');
  await b.waitFor(query(card+' [data-board-claim-action]')+'?.disabled===false');
  const contextPath='/api/tickets/'+id;
  await b.evaluate(`(()=>{
    const original=window.fetch,trace=window.claimRetirement={revoke:false,reads:0,commits:0,removed:0,remounted:0};
    window.fetch=async function(input,init){
      const path=new URL(input.url??input,location.href).pathname;
      if(trace.revoke&&path===${JSON.stringify(contextPath)}){
        trace.reads++;return Response.json({error:{code:'P2_016_FORBIDDEN'}},{status:403});
      }
      const result=await original.apply(this,arguments);
      if(path===${JSON.stringify(contextPath+'/take-and-start')}&&init?.method==='POST'&&result.ok){
        trace.commits++;throw new TypeError('lost acknowledgement（合成）');
      }
      return result;
    };
  })()`);
  await key(b,'a');await b.waitFor(visible('.board-claim-controller [data-action=check-self-handling]'));
  // Exercise the same object-read invalidation used by another fixture tab.
  // Record transient remounts too: a second 403 can hide them from a final DOM snapshot.
  await b.evaluate(`(()=>{
    const trace=claimRetirement,selector='.board-claim-controller';
    const observer=new MutationObserver(records=>{
      for(const record of records){
        for(const [nodes,field] of [[record.removedNodes,'removed'],[record.addedNodes,'remounted']]){
          for(const n of nodes)if(n.nodeType===1&&(n.matches(selector)||n.querySelector(selector)))trace[field]++;
        }
      }
    });
    observer.observe(document.body,{subtree:true,childList:true});
    trace.stop=()=>observer.disconnect();trace.revoke=true;
    const channel=new BroadcastChannel('wecom-workbench-drafts-v1');
    channel.postMessage(${JSON.stringify({principal:principal.id,kind:'ticket',id,purpose:'waiting-cancel',reason:'revoked'})});
    channel.close();
  })()`);
  try{
    await b.waitFor('claimRetirement.reads>0&&claimRetirement.removed>0');
    await b.evaluate(frame);
    assert.equal(await b.evaluate('claimRetirement.commits'),1);
    assert.equal(await b.evaluate('claimRetirement.remounted'),0,'a 403 must retire the original controller without recreating it');
    assert.equal(await b.evaluate(seen('.board-claim-controller')),false);
  }finally{await b.evaluate('claimRetirement.stop()');}
}));

test('37B R2 a failed command-context refresh gives feedback with zero keydown requests',suite,()=>scene(async s=>{
  const {b,card,id,f}=s,principal=f.principals[0];
  assert.ok(principal);
  await target(s,'board');
  await b.waitFor(query(card+' [data-board-claim-action]')+'?.disabled===false');
  // The initial read has admitted transfer. Fail its next read on the same
  // mounted query, so React Query retains the earlier data with an error status.
  await b.evaluate(`(()=>{
    const original=window.fetch;
    window.fetch=function(input,init){
      if(new URL(input.url??input,location.href).pathname===${JSON.stringify('/api/tickets/'+id)}){
        return Promise.resolve(Response.json({error:{code:'P2_016_PROVIDER_UNAVAILABLE'}},{status:503}));
      }
      return original.apply(this,arguments);
    };
    const channel=new BroadcastChannel('wecom-workbench-drafts-v1');
    channel.postMessage(${JSON.stringify({principal:principal.id,kind:'ticket',id,purpose:'waiting-cancel',reason:'revoked'})});
    channel.close();
  })()`);
  await b.waitFor(visible('.board-claim-controller [data-action=refresh-self-handling]'));
  const url=await b.evaluate('location.href');
  await record(b);await key(b,'t');
  await b.evaluate(frame);
  assert.equal(await b.evaluate('location.href'),url);
  assert.deepEqual(await b.evaluate('b5log.calls'),[]);
  assert.equal(await b.evaluate(title(hint)),'暂时无法确认工单操作，请稍后再试');
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

test('37B R3 an unknown keyboard follow remains checkable in the same ticket drawer',suite,()=>scene(async s=>{
  const {b,id,card}=s;
  await target(s,'board');await routeWrite(b,'/follow','hang');
  await key(b,'f');
  await b.waitFor(seen(card+'[data-optimistic-state=unknown]'),{timeoutMs:12000});
  const commandId=await b.evaluate('card37Route.body.client_command_id');
  assert.ok(typeof commandId==='string'&&commandId.length>0);
  await clickWorkbenchControl(b,card+' .card-open');
  await b.waitFor(visible('.detail-dialog .ds-next-step'));
  await waitForAnimationsSettled(b);
  const check='.detail-dialog [data-action=follow-ack]';
  await b.waitFor(visible(check)+'||'+query('.detail-dialog '+follow)+'?.disabled===false');
  assert.equal(await b.evaluate(visible(check)),true,'the original follow receipt must still be checkable');
  await b.evaluate(`(()=>{
    const original=window.fetch;window.r3FollowCalls=[];
    window.fetch=function(input,init){
      window.r3FollowCalls.push([init?.method??'GET',new URL(input.url??input,location.href).pathname]);
      return original.apply(this,arguments);
    };
  })()`);
  await clickWorkbenchControl(b,check);
  const receipt='/api/workbench/items/ticket/'+id+'/follow/commands/'+commandId;
  await b.waitFor('r3FollowCalls.some(([method,path])=>method==="GET"&&path==='+JSON.stringify(receipt)+')');
  assert.deepEqual(await b.evaluate('r3FollowCalls.filter(([method])=>method==="POST")'),[]);
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

for (const verification of ['503', 'stall'] as const) {
  test('37B R5 committed follow keeps its original receipt after ' + verification, suite, () => scene(async s => {
    const {b, card, id, http} = s;
    await target(s, 'board');
    const itemPath = '/api/workbench/items/ticket/' + id;
    // Let the real POST commit. Intercept only its next session verification.
    await b.evaluate(`(() => {
      const original = window.fetch;
      const trace = window.r5Follow = {posts: [], receipts: [], committed: false, intercepted: false, undos: new Set()};
      const recordUndos = () => document.querySelectorAll(${JSON.stringify(undoFor('item-follow'))}).forEach(el => trace.undos.add(el));
      new MutationObserver(recordUndos).observe(document.body, {childList: true, subtree: true});
      const gate = new Promise(resolve => { trace.release = resolve; });
      window.fetch = async function(input, init) {
        const path = new URL(input.url ?? input, location.href).pathname;
        if (path === ${JSON.stringify(itemPath + '/follow')} && init?.method === 'POST') {
          trace.posts.push(JSON.parse(init.body).client_command_id);
          const response = await original.apply(this, arguments);
          trace.committed = response.ok;
          return response;
        }
        if (trace.committed && !trace.intercepted && path === '/api/lifecycle/bootstrap') {
          trace.intercepted = true;
          if (${verification === '503'}) return Response.json({}, {status: 503});
          await Promise.race([gate, new Promise((_, reject) => {
            const signal = init?.signal ?? input.signal;
            if (signal?.aborted) reject(signal.reason);
            else signal?.addEventListener('abort', () => reject(signal.reason), {once: true});
          })]);
        }
        const response = await original.apply(this, arguments);
        if (path.startsWith(${JSON.stringify(itemPath + '/follow/commands/')})) trace.receipts.push([path, response.status]);
        return response;
      };
    })()`);
    try {
      await key(b, 'f');
      await b.waitFor('r5Follow.intercepted');
      const response = await http.get(itemPath);
      assert.equal(response.status, 200);
      assert.equal(object(object(object(await response.json()).item).attention).following, true);
      // The production UNKNOWN deadline is 8s. Allow 4s for Chrome to publish it.
      await b.waitFor(seen(card + '[data-optimistic-state=unknown]'), {timeoutMs: 12000});
      await clickWorkbenchControl(b, card + ' .card-open');
      const check = '.detail-dialog [data-action=follow-ack]';
      await b.waitFor(visible('.detail-dialog .ds-next-step'));
      await waitForAnimationsSettled(b);
      assert.equal(await b.evaluate(visible(check)), true, 'the drawer owns the committed command receipt');
      await clickWorkbenchControl(b, check);
      await b.waitFor('r5Follow.receipts.length > 0 && !' + seen(check));
      const trace = await b.evaluate('({posts: r5Follow.posts, receipts: r5Follow.receipts, undos: r5Follow.undos.size})');
      assert.equal(trace.posts.length, 1, 'the handoff and read-only check never resubmit');
      assert.match(trace.posts[0], /^[\da-f]{8}-[\da-f-]{27}$/i);
      assert.deepEqual(trace.receipts, [[itemPath + '/follow/commands/' + trace.posts[0], 200]]);
      assert.equal(trace.undos, 0, 'a read-only receipt check cannot mint another Undo');
    } finally {
      await b.evaluate('r5Follow.release()');
    }
  }));
}

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

for (const stage of ['session read', 'encrypted preparation'] as const) {
  test('37B R5 a pre-dispatch timeout during ' + stage + ' leaves no follow receipt', suite, () => withScene(async s => {
    const {b, id} = s;
    await target(s, 'drawer');
    const toggle = '.detail-dialog ' + follow;
    const check = '.detail-dialog [data-action=follow-ack]';
    await b.waitFor(query(toggle) + '?.disabled === false');
    await record(b);
    await b.evaluate(`(() => {
      const state = window.r5Preflight = {};
      const gate = new Promise(resolve => {state.release = resolve;});
      if (${stage === 'session read'}) {
        const original = window.fetch;
        window.fetch = async function(input, init) {
          if (!state.held && new URL(input.url ?? input, location.href).pathname === '/api/lifecycle/bootstrap') {
            state.held = true;
            await gate;
            state.delivered = true;
          }
          return original.apply(this, arguments);
        };
        return;
      }
      // Delay notification of the real IndexedDB commit to the controller. The
      // transaction and encrypted operation are genuine, and no POST has run.
      const targetTransactions = new WeakSet();
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(row) {
        if (this.name === 'operations' && row.purpose === 'item-follow' && row.id === ${JSON.stringify(id)}) {
          targetTransactions.add(this.transaction);
        }
        return put.apply(this, arguments);
      };
      const descriptor = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete');
      Object.defineProperty(IDBTransaction.prototype, 'oncomplete', {...descriptor, set(callback) {
        descriptor.set.call(this, function(event) {
          if (!state.held && targetTransactions.has(this)) {
            state.held = true;
            gate.then(() => { callback.call(this, event); state.delivered = true; });
          } else callback.call(this, event);
        });
      }});
    })()`);
    try {
      await key(b, 'f');
      await b.waitFor('r5Preflight.held');
      // Exercise the real 8s command deadline with room for its UI update.
      await b.waitFor(heading('item-follow') + ' === "关注没有提交"', {timeoutMs: 12000});
      assert.deepEqual(await b.evaluate(writeLog), []);
    } finally {
      await b.evaluate('r5Preflight.release()');
    }
    await b.waitFor('r5Preflight.delivered');
    await b.evaluate(frame);
    await waitForAnimationsSettled(b);
    assert.deepEqual(await b.evaluate(writeLog), [], 'a late preflight must never dispatch');
    await b.waitFor(query(toggle) + '?.disabled === false || (' + visible(check) + ' && ' + query(check) + '?.disabled === false)');
    assert.equal(await b.evaluate(visible(check)), false, 'the completed preflight must retire its unsent operation');
    // Re-open through a new document to exercise persisted as well as local state.
    await target(s, 'drawer');
    await b.waitFor(query(toggle) + '?.disabled === false || (' + visible(check) + ' && ' + query(check) + '?.disabled === false)');
    assert.equal(await b.evaluate(visible(check)), false, 'an unsent follow has no receipt to check');
    assert.equal(await b.evaluate(query(toggle) + '.disabled'), false, 'fresh follow is available');
    await record(b);
    await key(b, 'f');
    await b.waitFor(visible(undoFor('item-follow')));
    assert.deepEqual(await b.evaluate(writeLog), [['POST', '/api/workbench/items/ticket/' + id + '/follow']]);
  }, {keyboard: true, draftRecovery: stage === 'encrypted preparation'}));
}

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

const drawerFollow = '.detail-dialog ' + follow;
const checkFollow = '.detail-dialog [data-action=follow-ack]';
const replayFollow = '.detail-dialog [data-action=follow-replay]';

async function withTimedOutFollowPreparation(run: (s: Scene, originalId: string) => Promise<void>) {
  await withScene(async s => {
    const {b, id} = s;
    await target(s, 'drawer');
    await b.waitFor(query(drawerFollow) + '?.disabled === false');
    await record(b);
    // IndexedDB commits normally in the shared profile. Delay only the original
    // controller's notification, so a second tab can read the genuine saved command.
    await b.evaluate(`(() => {
      const gate = new Promise(resolve => { window.releaseFollowPreparation = resolve; });
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(row) {
        const request = put.apply(this, arguments);
        if (this.name !== 'operations' || row.purpose !== 'item-follow' || row.id !== ${JSON.stringify(id)}) return request;
        IDBObjectStore.prototype.put = put;
        const tx = this.transaction, complete = tx.oncomplete;
        tx.oncomplete = async function(event) {
          window.savedFollowId = row.commandId;
          await gate;
          complete.call(this, event);
        };
        return request;
      };
    })()`);
    try {
      await key(b, 'f');
      await b.waitFor('typeof window.savedFollowId === "string"');
      // The 8s deadline itself is under test. Give Chrome 4s to publish the result.
      await b.waitFor(heading('item-follow') + ' === "关注没有提交"', {timeoutMs: 12000});
      assert.deepEqual(await b.evaluate(writeLog), []);
      const originalId: unknown = await b.evaluate('savedFollowId');
      assert.ok(typeof originalId === 'string');
      assert.match(originalId, /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i);
      await run(s, originalId);
    } finally {
      await b.evaluate('releaseFollowPreparation()');
    }
  }, {keyboard: true, draftRecovery: true});
}

test('37B R8 follow retry stays disabled until the unsent preparation releases', suite, () =>
  withTimedOutFollowPreparation(async ({b, id}) => {
    assert.equal(await b.evaluate(query(drawerFollow) + '.disabled'), true);
    await key(b, 'f');
    await b.waitFor(title(hint) + ' === "这张工单现在不能关注"');
    assert.deepEqual(await b.evaluate(writeLog), [], 'F cannot start a second command during preparation');
    await b.evaluate('releaseFollowPreparation()');
    await b.waitFor(query(drawerFollow) + '?.disabled === false');
    assert.equal(await b.evaluate(seen(checkFollow)), false, 'the unsent UUID has retired');
    await key(b, 'f');
    await b.waitFor(visible(undoFor('item-follow')));
    assert.deepEqual(await b.evaluate(writeLog), [['POST', '/api/workbench/items/ticket/' + id + '/follow']]);
  }));

test('37B R8 original tab cannot erase a replayed follow receipt from another tab', suite, () =>
  withTimedOutFollowPreparation(async ({b, id, http}, originalId) => {
    const url: unknown = await b.evaluate('location.href');
    assert.ok(typeof url === 'string');
    const path = '/api/workbench/items/ticket/' + id + '/follow';
    const peer = await yxxTab(b, url);
    try {
      await peer.waitFor(query(replayFollow) + '?.disabled === false');
      await peer.evaluate(`(() => {
        const original = window.fetch;
        window.replayPosts = [];
        window.fetch = async function(input, init) {
          const response = await original.apply(this, arguments);
          if (init?.method === 'POST' && new URL(input.url ?? input, location.href).pathname === ${JSON.stringify(path)}) {
            replayPosts.push([JSON.parse(init.body).client_command_id, response.status]);
            throw new TypeError('test transport lost the committed response');
          }
          return response;
        };
      })()`);
      await peer.evaluate(query(replayFollow) + '.click()');
      await peer.waitFor('replayPosts.length > 0 && ' + query(checkFollow) + '?.disabled === false');
      assert.deepEqual(await peer.evaluate('replayPosts'), [[originalId, 200]]);
      const detail = await http.get('/api/workbench/items/ticket/' + id);
      assert.equal(detail.status, 200);
      assert.equal(object(object(object(await detail.json()).item).attention).following, true);

      await b.command('Page.bringToFront');
      await b.evaluate('releaseFollowPreparation()');
      await b.waitFor(query(checkFollow) + '?.disabled === false || ' + query(drawerFollow) + '?.disabled === false');
      assert.deepEqual(await b.evaluate(writeLog), [], 'the originating tab never dispatched');
      const fresh = await yxxTab(b, url);
      try {
        await fresh.waitFor(query(checkFollow) + '?.disabled === false || ' + query(drawerFollow) + '?.disabled === false');
        assert.equal(await fresh.evaluate(visible(checkFollow)), true, 'a new document can recover the original receipt');
        await fresh.evaluate(`(() => {
          const original = window.fetch;
          window.receiptReads = [];
          window.recoveryWrites = [];
          window.fetch = async function(input, init) {
            const pathname = new URL(input.url ?? input, location.href).pathname;
            const method = init?.method ?? input.method ?? 'GET';
            if (method !== 'GET' && method !== 'HEAD') recoveryWrites.push([method, pathname]);
            const response = await original.apply(this, arguments);
            if (pathname.startsWith(${JSON.stringify(path + '/commands/')})) {
              const receipt = await response.clone().json();
              receiptReads.push([method, pathname, response.status, receipt.state, receipt.client_command_id]);
            }
            return response;
          };
        })()`);
        await fresh.evaluate(query(checkFollow) + '.click()');
        await fresh.waitFor('receiptReads.length > 0 && !' + seen(checkFollow));
        assert.deepEqual(await fresh.evaluate('receiptReads'), [['GET', path + '/commands/' + originalId, 200, 'COMMITTED', originalId]]);
        assert.deepEqual(await fresh.evaluate('recoveryWrites'), []);
        assert.deepEqual(await peer.evaluate('replayPosts'), [[originalId, 200]], 'exactly one replay POST');
      } finally {
        await fresh.close();
      }
    } finally {
      await peer.close();
    }
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
    await f.pool.query("UPDATE pilot_ticket.ticket SET status='COMPLETED',version=version+1 WHERE id=$1::uuid", [converted.id]);
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

test('37B R9 releasing a preparation preserves the first F on a different open ticket', suite, () =>
  withTimedOutFollowPreparation(async ({b, f, http, id}) => {
    const other = await seedMotionTicket(f.pool, '独立草稿版本验收');
    const peer = await yxxTab(b, f.origin + '/workbench/app/items/ticket/' + other + '?range=all');
    try {
      await peer.waitFor(query(drawerFollow) + '?.disabled === false');
      await peer.evaluate(`(() => {
        const original = window.fetch;
        window.peerWrites = [];
        window.fetch = async function(input, init) {
          const method = init?.method ?? input.method ?? 'GET';
          const response = await original.apply(this, arguments);
          if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
            peerWrites.push([method, new URL(input.url ?? input, location.href).pathname, response.status]);
          }
          return response;
        };
        const channel = new BroadcastChannel('wecom-workbench-drafts-v1');
        channel.onmessage = ({data}) => {
          if (data.reason === 'released' && data.id === ${JSON.stringify(id)} && data.purpose === 'item-follow') {
            window.otherFollowReleased = true;
            channel.close();
          }
        };
      })()`);
      await b.evaluate('releaseFollowPreparation()');
      await b.waitFor(query(drawerFollow) + '?.disabled === false');
      await peer.waitFor('window.otherFollowReleased === true');
      await peer.command('Page.bringToFront');
      await peer.evaluate(query('.detail-dialog [aria-label=复制编号]') + '.focus()');
      for (const type of ['keyDown', 'keyUp']) {
        await peer.command('Input.dispatchKeyEvent', {type, key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70});
      }
      await peer.waitFor(visible(undoFor('item-follow')) + ' || ' + heading('item-follow') + ' === "关注没有提交"');
      assert.deepEqual(await peer.evaluate('peerWrites'), [['POST', '/api/workbench/items/ticket/' + other + '/follow', 200]]);
      assert.equal(await peer.evaluate(visible(undoFor('item-follow'))), true);
      assert.deepEqual(await b.evaluate(writeLog), [], 'the released preparation sent no command');
      const response = await http.get('/api/workbench/items/ticket/' + other);
      assert.equal(response.status, 200);
      assert.equal(object(object(object(await response.json()).item).attention).following, true);
    } finally {
      await peer.close();
    }
  }));

test('37B R9 original drawer can retry an aborted cleanup with its original UUID', suite, () =>
  withTimedOutFollowPreparation(async ({b, id}, originalId) => {
    // Abort only the first transaction deleting this ticket's follow operation.
    // Both the saved encrypted draft and the subsequent retry use real IndexedDB.
    await b.evaluate(`(() => {
      const remove = IDBObjectStore.prototype.delete;
      IDBObjectStore.prototype.delete = function(key) {
        const request = remove.apply(this, arguments);
        if (this.name === 'operations') {
          const [, kind, itemId, purpose] = JSON.parse(key);
          if (kind === 'ticket' && itemId === ${JSON.stringify(id)} && purpose === 'item-follow') {
            IDBObjectStore.prototype.delete = remove;
            const tx = this.transaction;
            tx.addEventListener('abort', () => { window.followCleanupAborted = true; }, {once: true});
            queueMicrotask(() => tx.abort());
          }
        }
        return request;
      };
    })()`);
    const savedIds = `new Promise((resolve, reject) => {
      const open = indexedDB.open('wecom-workbench-drafts-v1');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result, tx = db.transaction('operations', 'readonly');
        const rows = tx.objectStore('operations').getAll();
        tx.oncomplete = () => {
          db.close();
          resolve(rows.result.filter(row => row.kind === 'ticket' && row.id === ${JSON.stringify(id)} && row.purpose === 'item-follow').map(row => row.commandId));
        };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    })`;
    await b.evaluate('releaseFollowPreparation()');
    await b.waitFor('window.followCleanupAborted === true && ' + query(checkFollow) + '?.disabled === false');
    assert.deepEqual(await b.evaluate(savedIds), [originalId]);
    assert.equal(await b.evaluate(query(drawerFollow) + '.disabled'), true);
    await clickWorkbenchControl(b, checkFollow);
    await b.waitFor('!' + seen(checkFollow) + ' && ' + query(drawerFollow) + '?.disabled === false');
    assert.deepEqual(await b.evaluate(savedIds), [], 'the retry retired the original unsent UUID');
    assert.deepEqual(await b.evaluate(writeLog), [], 'checking an unsent preparation never posts a follow');
    assert.equal(await b.evaluate(seen(undoFor('item-follow'))), false);
    await b.evaluate(query('.detail-dialog [aria-label=复制编号]') + '.focus()');
    await key(b, 'f');
    await b.waitFor(visible(undoFor('item-follow')));
    assert.deepEqual(await b.evaluate(writeLog), [['POST', '/api/workbench/items/ticket/' + id + '/follow']]);
  }));

const draftEpoch = `new Promise((resolve, reject) => {
  const open = indexedDB.open('wecom-workbench-drafts-v1');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result, tx = db.transaction('control', 'readonly');
    const epoch = tx.objectStore('control').get('epoch');
    tx.oncomplete = () => { db.close(); resolve(epoch.result); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  };
})`;

async function withOtherFollowDrawer(run: (s: Scene, sender: Awaited<ReturnType<typeof yxxTab>>, senderId: string) => Promise<void>) {
  await withScene(async s => {
    await target(s, 'drawer');
    await s.b.waitFor(query(drawerFollow) + '?.disabled === false');
    const senderId = await seedMotionTicket(s.f.pool, '另一个窗口的关注操作');
    const sender = await yxxTab(s.b, s.f.origin + '/workbench/app/items/ticket/' + senderId + '?range=all');
    try {
      await sender.waitFor(query(drawerFollow) + '?.disabled === false');
      await s.b.command('Page.bringToFront');
      await waitForAnimationsSettled(s.b);
      await s.b.evaluate(query('.detail-dialog [aria-label=复制编号]') + '.focus()');
      await s.b.evaluate(`(() => {
        window.peerFollowEvents = [];
        const channel = new BroadcastChannel('wecom-workbench-drafts-v1');
        channel.onmessage = ({data}) => {
          if (data.id === ${JSON.stringify(senderId)} && data.purpose === 'item-follow') peerFollowEvents.push(data.reason);
        };
        window.closeFollowObserver = () => channel.close();
      })()`);
      await run(s, sender, senderId);
    } finally {
      try { await s.b.evaluate('window.closeFollowObserver?.()'); } finally { await sender.close(); }
    }
  }, {keyboard: true, draftRecovery: true});
}

test('37B R10 a closure awaiting permission persists its first note after another ticket settles', suite, () =>
  withOtherFollowDrawer(async ({b, id, f}, sender) => {
    const status = closeDialog + ' [data-waiting-draft-status]';
    const textarea = closeDialog + ' textarea';
    // The form and the encrypted draft authorize independently. Gate the
    // form at the start of its read so network response order cannot select
    // the draft's request instead. Check both UI states before settling.
    await b.evaluate(`(() => {
      const original = window.fetch;
      const gate = new Promise(resolve => { window.allowClosureRead = resolve; });
      let bootstrapReads = 0;
      window.fetch = async function(input, init) {
        const path = new URL(input.url ?? input, location.href).pathname;
        if (path === '/api/lifecycle/bootstrap' && ++bootstrapReads === 1) await gate;
        if (path === ${JSON.stringify('/api/tickets/' + id)}) {
          const response = await original.apply(this, arguments);
          window.closureContextRead = true;
          return response;
        }
        return original.apply(this, arguments);
      };
    })()`);
    try {
      await key(b, 'x');
      await b.waitFor('window.closureContextRead && ' + visible(closeDialog));
      await b.waitFor(query(closeDialog) + '?.innerText.includes("正在加载可用操作") && ' +
        query(status) + '?.textContent.includes("草稿仅在当前浏览器")');
      const before = await b.evaluate(draftEpoch);
      assert.equal(typeof before, 'string');
      await sender.evaluate(query(drawerFollow) + '.click()');
      await b.waitFor('peerFollowEvents.includes("settled")');
      assert.notEqual(await b.evaluate(draftEpoch), before, 'the prepared empty handle predates the settlement');

      await b.evaluate('allowClosureRead()');
      await b.waitFor('!' + query(closeDialog) + '.innerText.includes("正在加载可用操作") && ' + query(textarea) + '?.disabled === false');
      const note = '首次补充关闭说明（合成）';
      await b.evaluate(query(textarea) + '.focus()');
      await b.command('Input.insertText', {text: note});
      await b.waitFor(`/已保存|未能保存/.test(${query(status)}?.textContent)`);
      assert.match(await b.evaluate(title(status)), /草稿已保存/);
      // Restore from the encrypted record in a new document, independently of the saved badge.
      const fresh = await yxxTab(b, f.origin + '/workbench/app/items/ticket/' + id + '?range=all');
      try {
        const closeEntry = '.detail-dialog [data-action=cancel]';
        await fresh.waitFor(query(closeEntry) + '?.disabled === false');
        await fresh.evaluate(query(closeEntry) + '.click()');
        await fresh.waitFor(query(textarea) + '?.value === ' + JSON.stringify(note));
      } finally {
        await fresh.close();
      }
    } finally {
      await b.evaluate('allowClosureRead()');
    }
  }));

test('37B R10 an ordinary follow preparation leaves the first F on another ticket available', suite, () =>
  withOtherFollowDrawer(async ({b, id, http}, sender, senderId) => {
    const itemPath = '/api/workbench/items/ticket/' + id;
    await sender.evaluate(`(() => {
      const original = window.fetch;
      const gate = new Promise(resolve => { window.allowFollowPost = resolve; });
      window.fetch = async function(input, init) {
        if (init?.method === 'POST' && new URL(input.url ?? input, location.href).pathname ===
            ${JSON.stringify('/api/workbench/items/ticket/' + senderId + '/follow')}) {
          window.followPostHeld = true;
          await gate;
        }
        return original.apply(this, arguments);
      };
    })()`);
    try {
      const before = await b.evaluate(draftEpoch);
      assert.equal(typeof before, 'string');
      await b.evaluate(`(() => {
        const original = window.fetch;
        window.backgroundFailures = 0;
        window.ownWrites = [];
        window.fetch = async function(input, init) {
          const path = new URL(input.url ?? input, location.href).pathname;
          const method = init?.method ?? input.method ?? 'GET';
          // Fail only the redundant background detail read. The first user
          // command and its subsequent verification use the real server.
          if (method === 'GET' && path === ${JSON.stringify(itemPath)} && !ownWrites.length &&
              peerFollowEvents.includes('released') && !backgroundFailures) {
            backgroundFailures++;
            return Response.json({}, {status: 503});
          }
          if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) ownWrites.push([method, path]);
          return original.apply(this, arguments);
        };
      })()`);
      await sender.evaluate(query(drawerFollow) + '.click()');
      await sender.waitFor('window.followPostHeld === true');
      await b.waitFor('peerFollowEvents.includes("released")');
      assert.equal(await b.evaluate(draftEpoch), before, 'preparing the peer operation did not rotate the epoch');
      await key(b, 'f');
      await b.waitFor(visible(undoFor('item-follow')) + ' || ' + visible(hint) + ' || ' + heading('item-follow') + ' === "关注没有提交"');
      assert.deepEqual(await b.evaluate('ownWrites'), [['POST', itemPath + '/follow']]);
      assert.equal(await b.evaluate('backgroundFailures'), 0);
      assert.equal(await b.evaluate(visible(undoFor('item-follow'))), true);
      const response = await http.get(itemPath);
      assert.equal(response.status, 200);
      assert.equal(object(object(object(await response.json()).item).attention).following, true);
    } finally {
      await sender.evaluate('allowFollowPost()');
    }
  }));
