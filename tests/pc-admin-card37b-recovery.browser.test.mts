import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {
  frame,
  hint,
  key,
  navigate,
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
  takeoverSection,
  takeoverEntry,
  takeoverTeam,
  takeoverScene,
  assignTakeoverOnly,
} from './helpers/card37b-keyboard-browser.mjs';
import {
  type Scene,
  closeDialog,
  ctrlZ,
  follow,
  heading,
  routeWrite,
  visible,
  withScene,
} from './helpers/card37a-optimistic-fixture.mjs';
import {query,seedMotionTicket,ticketCard} from './helpers/motion-board-fixture.mjs';
import {waitForAnimationsSettled} from './helpers/browser-animations.mjs';
import {clickWorkbenchControl} from './helpers/heroui-workbench-controls.mjs';
import {object} from './helpers/t42-board-browser-fixture.mjs';
import {yxxTab} from './helpers/p2-g2-yixiaoxiu-browser.mjs';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {seedPersistedIntake} from './helpers/p2-015-postgres-harness.mjs';
import {type T11Fixture, t11Http} from './helpers/t11-completion-fixture.mjs';
import {launchSystemBrowser} from './helpers/p2-006-browser-harness.mjs';

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

const replayFollow = '.detail-dialog [data-action=follow-replay]';

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

test('37B PR1 self-handling still sends one original claim and Ctrl Z undoes it', suite, () =>
  takeoverScene(async s => {
    const {b, id, http} = s, path = '/api/tickets/' + id;
    const actor = s.f.principals[0];
    assert.ok(actor);
    // An owner who also belongs to another resolver team can use either workflow.
    await s.f.pool.query("INSERT INTO pilot_ticket.resolver_team(team_id,display_name) VALUES('PR1_SUPPORT','另一处理组（合成）')");
    await s.f.pool.query("INSERT INTO pilot_ticket.pilot_team_member(principal_id,team_id) VALUES($1::uuid,'PR1_SUPPORT')", [actor.id]);
    const prior = await http.detail(id);
    const accepted = await http.post(id, 'accept-for-later', {client_command_id: randomUUID(),
      expected_version: prior.version, reason_code: 'WORKBENCH_SELF_HANDLING', resolver_team_id: prior.resolver_team_id});
    assert.equal(accepted.status, 200, await accepted.text());
    const {allowed_actions} = await http.detail(id);
    assert.ok(allowed_actions.includes('take-and-start') && allowed_actions.includes('takeover-and-start'));
    await target(s, 'drawer');
    await b.waitFor(query('.detail-dialog [data-action=take-and-start]') + '?.disabled === false && ' + visible(takeoverEntry));
    await record(b); await key(b, 'a');
    await b.waitFor(visible(undoFor('ticket-self-handling')));
    assert.deepEqual(await b.evaluate(writeLog), [['POST', path + '/take-and-start']]);
    const claimed = await http.detail(id);
    assert.equal(claimed.status, 'IN_PROGRESS');
    assert.equal(claimed.assignee_id, actor.id);
    await ctrlZ(b);
    await b.waitFor(heading('ticket-return-to-dispatch') + ' === "已撤销"');
    assert.equal((await http.detail(id)).assignee_id, null);
    assert.deepEqual(await b.evaluate(writeLog), [['POST', path + '/take-and-start'], ['POST', path + '/return-to-dispatch']]);
  }));

for (const surface of ['board', 'list'] as const) {
  // Owner decision (PR #203): on board/list, A only claims. A takeover-only ticket keeps main's
  // 「这张工单现在不能领取」 hint with no write and no navigation; takeover stays in the detail view.
  test('37B PR1 takeover-only pending ticket keeps the claim-only hint on ' + surface, suite, () =>
    takeoverScene(async s => {
      const {b, id, http} = s;
      await assignTakeoverOnly(s);
      const response = await http.get('/api/workbench/items/ticket/' + id);
      assert.equal(response.status, 200);
      const item = object(object(await response.json()).item);
      assert.equal(item.column, 'pending');
      assert.ok(item.assignee_name, 'the projected pending ticket retains its current assignee');
      await target(s, surface);
      const before = await b.evaluate('location.pathname + location.search');
      await record(b); await key(b, 'a');
      await b.waitFor(visible(hint));
      assert.equal(await b.evaluate(title(hint)), '这张工单现在不能领取');
      assert.deepEqual(await b.evaluate(writeLog), []);
      assert.equal(await b.evaluate(visible('.detail-dialog ' + takeoverTeam)), false);
      assert.equal(await b.evaluate('location.pathname + location.search'), before);
    }));
}

test('37B PR1 a pending A cannot take focus back from a newer internal-note action', suite, () =>
  takeoverScene(async s => {
    const {b, id} = s, path = '/api/tickets/' + id;
    await assignTakeoverOnly(s);
    const script = await b.command('Page.addScriptToEvaluateOnNewDocument', {source: `(() => {
      const original = window.fetch;
      const gate = new Promise(resolve => { window.releaseTakeoverTargets = resolve; });
      window.fetch = async function(input, init) {
        const pathname = new URL(input.url ?? input, location.href).pathname;
        if (pathname === ${JSON.stringify(path + '/takeover-targets')}) {
          window.takeoverReadHeld = true;
          await gate;
        }
        const response = await original.apply(this, arguments);
        if (pathname === ${JSON.stringify(path)} && response.ok) {
          window.seenClaimActions = (await response.clone().json()).allowed_actions;
        }
        return response;
      };
    })()`});
    try {
      await target(s, 'drawer');
      await b.waitFor('window.takeoverReadHeld && window.seenClaimActions?.includes("takeover-and-start")');
      await record(b); await key(b, 'a'); await key(b, 'm');
      await b.waitFor('document.activeElement === ' + query('#internal-note'));
      const text = '继续记录处理进度（合成）';
      await b.command('Input.insertText', {text});
      await b.evaluate('releaseTakeoverTargets()');
      await b.waitFor(visible(takeoverEntry));
      await waitForAnimationsSettled(b);
      assert.deepEqual(await b.evaluate(writeLog), []);
      assert.equal(await b.evaluate(query('#internal-note') + '.value'), text);
      assert.equal(await b.evaluate('document.activeElement === ' + query('#internal-note')), true,
        'completing the earlier admission read must preserve the active editor');
      assert.equal(await b.evaluate(query(takeoverEntry) + '.getAttribute("aria-expanded")'), 'false');
    } finally {
      await b.evaluate('window.releaseTakeoverTargets?.()');
      await b.command('Page.removeScriptToEvaluateOnNewDocument', {identifier: object(script).identifier});
    }
  }));

test('37B PR3 A opens takeover through the original converted review URL', suite, t =>
  withWeb01Fixture(async (f: T11Fixture & {processReviewIntake: (id: string) => Promise<unknown>}) => {
    const http = await t11Http(f, 0, {closeConnections: true});
    const read = async (path: string) => {
      const response = await http.get(path);
      assert.equal(response.status, 200, await response.clone().text());
      return object(await response.json());
    };
    const intake = await seedPersistedIntake({pool: f.pool, text: '复核转单后键盘接管（合成）'});
    await f.processReviewIntake(intake.intakeId);
    const reviews = await f.pool.query<{id: string}>(
      'SELECT id::text FROM intake.manual_review_item WHERE service_intake_id=$1::uuid', [intake.intakeId]);
    const reviewId = reviews.rows[0]?.id;
    assert.ok(reviewId);
    const reviewPath = '/api/manual-reviews/' + reviewId;
    const review = await read(reviewPath);
    const {csrf_token} = await read('/api/lifecycle/bootstrap');
    const cookie = f.cookies[0], browserCookie = f.browserCookies[0];
    assert.ok(cookie && browserCookie && typeof csrf_token === 'string' && typeof review.row_version === 'string');
    const commandId = randomUUID();
    const resolved = await fetch(f.origin + reviewPath + '/resolve', {
      method: 'POST',
      headers: {cookie, origin: f.origin, 'content-type': 'application/json', 'x-csrf-token': csrf_token,
        'idempotency-key': commandId, 'if-match': '"' + review.row_version + '"'},
      body: JSON.stringify({client_command_id: commandId, expected_row_version: review.row_version,
        expected_material_basis: object(review.material_basis).current_hash,
        resolution_code: 'CONFIRM_TICKET_ELIGIBLE', resolution_reason_code: 'EXPLICIT_HUMAN_CHOICE'}),
    });
    assert.equal(resolved.status, 200, await resolved.text());
    const alias = 'review/' + reviewId, detail = await read('/api/workbench/items/' + alias);
    assert.deepEqual(detail.requested_item, {kind: 'review', id: reviewId});
    const item = object(detail.item);
    assert.ok(item.kind === 'ticket' && typeof item.id === 'string' && item.id !== reviewId);
    const id = item.id, path = 'items/' + alias, copy = '.detail-dialog [aria-label="复制编号"]';
    const b = await launchSystemBrowser({url: f.origin + '/workbench/app/', width: 1280, height: 850,
      cookies: [{...browserCookie, url: f.origin + '/'}]});
    assert.ok(b);
    try {
      const s = {b, f, http, id, card: ticketCard(id)};
      await assignTakeoverOnly(s);
      for (const held of [false, true]) {
        await t.test(held ? 'one queued A opens and focuses after targets are released' : 'one A opens and focuses with targets loaded', async () => {
          // Hold only the targets response. The ticket query still publishes real command admission.
          const script = held ? await b.command('Page.addScriptToEvaluateOnNewDocument', {source: `(() => {
            const original = window.fetch;
            const gate = new Promise(resolve => { window.releaseTargets = resolve; });
            window.fetch = async function(input, init) {
              const pathname = new URL(input.url ?? input, location.href).pathname;
              const response = await original.apply(this, arguments);
              if (pathname === ${JSON.stringify('/api/tickets/' + id + '/takeover-targets')} && response.ok) {
                window.targetsHeld = true;
                await gate;
              }
              if (pathname === ${JSON.stringify('/api/tickets/' + id)} && response.ok)
                window.claimActions = (await response.clone().json()).allowed_actions;
              return response;
            };
          })()`}) : null;
          try {
            await navigate(s, path, query(copy) + '?.disabled === false');
            await b.waitFor(held ? 'window.targetsHeld && window.claimActions?.includes("takeover-and-start")' : visible(takeoverEntry));
            await waitForAnimationsSettled(b);
            assert.equal(await b.evaluate(visible(takeoverTeam)), false);
            await b.evaluate(query(copy) + '.focus()');
            await record(b);
            await key(b, 'a');
            if (held) {
              await b.evaluate(frame);
              assert.equal(await b.evaluate(visible(takeoverTeam)), false);
              assert.equal(await b.evaluate('document.activeElement === ' + query(copy)), true);
              assert.deepEqual(await b.evaluate(writeLog), []);
              await b.evaluate('releaseTargets()');
            }
            await b.waitFor(visible(takeoverEntry));
            await waitForAnimationsSettled(b);
            assert.equal(await b.evaluate(title(takeoverEntry) + '.trim()'), '接管处理');
            assert.equal(await b.evaluate(query(takeoverEntry) + '.getAttribute("aria-expanded")'), 'true');
            assert.equal(await b.evaluate(visible(takeoverTeam)), true);
            assert.equal(await b.evaluate('document.activeElement === ' + query(takeoverTeam)), true);
            const labels = await b.evaluate(query(takeoverTeam) +
              '.getAttribute("aria-labelledby").split(" ").map(id => document.getElementById(id)?.textContent.trim())');
            assert.ok(labels.includes('接管处理组'));
            assert.equal(await b.evaluate('location.pathname'), '/workbench/app/' + path);
            assert.equal(await b.evaluate(seen(hint)), false);
            assert.deepEqual(await b.evaluate(writeLog), []);
          } finally {
            if (script) {
              await b.evaluate('window.releaseTargets?.()');
              await b.command('Page.removeScriptToEvaluateOnNewDocument', {identifier: object(script).identifier});
            }
          }
        });
      }
    } finally {
      await b.close();
    }
  }, {workbenchManualReviewEnabled: true, workbenchBoardActionsEnabled: true, ticketSelfHandlingEnabled: true,
    ticketTakeoverEnabled: true, manualProjection: true}));

test('37B PR3 successful A focus leaves a subsequent pre-frame focus on 复制编号', suite, () =>
  takeoverScene(async s => {
    const {b} = s, copy = '.detail-dialog [aria-label="复制编号"]';
    await assignTakeoverOnly(s);
    await target(s, 'drawer');
    await b.waitFor(visible(takeoverEntry));
    await b.evaluate(`(() => {
      const copy = ${query(copy)}, team = ${query(takeoverTeam)};
      window.takeoverFocusOrder = [];
      document.addEventListener('focusin', e => {
        if (e.target === team) {
          takeoverFocusOrder.push('team');
          // Let focus() return success, then exercise the gap before the next paint.
          if (takeoverFocusOrder.length === 1) queueMicrotask(() => copy.focus());
        } else if (e.target === copy) takeoverFocusOrder.push('copy');
      });
    })()`);
    await record(b);
    await key(b, 'a');
    await b.waitFor('window.takeoverFocusOrder.includes("copy")');
    await b.evaluate(frame);
    assert.deepEqual(await b.evaluate('takeoverFocusOrder'), ['team', 'copy']);
    assert.equal(await b.evaluate('document.activeElement === ' + query(copy)), true);
    assert.equal(await b.evaluate(query(takeoverEntry) + '.getAttribute("aria-expanded")'), 'true');
    assert.deepEqual(await b.evaluate(writeLog), []);
  }));
