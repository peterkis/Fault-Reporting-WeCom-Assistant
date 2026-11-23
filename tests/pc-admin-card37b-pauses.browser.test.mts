import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  chip,
  current,
  frame,
  help,
  hint,
  key,
  menu,
  palette,
  record,
  target,
  suite,
  scene,
  writeLog,
  title,
  seen,
  undoFor,
  drawerFollow,
  checkFollow,
  withTimedOutFollowPreparation,
} from './helpers/card37b-keyboard-browser.mjs';
import {
  active,
  claimPath,
  closeDialog,
  ctrlZ,
  follow,
  heading,
  indexOf,
  pending,
  routeWrite,
  startTrace,
  visible,
  withScene,
} from './helpers/card37a-optimistic-fixture.mjs';
import {query} from './helpers/motion-board-fixture.mjs';
import {waitForAnimationsSettled} from './helpers/browser-animations.mjs';
import {clickWorkbenchControl} from './helpers/heroui-workbench-controls.mjs';
import {object} from './helpers/t42-board-browser-fixture.mjs';

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
