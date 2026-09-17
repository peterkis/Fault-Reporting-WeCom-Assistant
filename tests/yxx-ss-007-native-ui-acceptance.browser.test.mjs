import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import { launchSystemBrowser, closeBrowserTestResources } from './helpers/p2-006-browser-harness.mjs';
import {
  closeSs007AcceptanceFixture,
  SS007_REFS,
  startSs007AcceptanceFixture,
  waitForSs007State,
} from './helpers/yxx-ss-007-acceptance-fixture.mjs';

const cookie = origin => [{ name: 'yxx_session', value: 'member-a', url: origin }];
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
let fixture;
let browser;

async function launchAuthenticated({ fixture, path, width = 390, height = 844 }) {
  const browser = await launchSystemBrowser({
    url: `${fixture.origin}/wecom/yixiaoxiu/`, width, height, cookies: cookie(fixture.origin),
  });
  await browser.waitFor("document.querySelector('#home-view')?.hidden===false");
  if (path !== '/wecom/yixiaoxiu/') {
    await browser.evaluate(`location.assign(${JSON.stringify(path)})`, { awaitPromise: false });
  }
  return browser;
}

async function createTab(browser, url) {
  const { targetId } = await browser.command('Target.createTarget', { url });
  const { sessionId } = await browser.command('Target.attachToTarget', { targetId, flatten: true });
  const command = (method, params = {}) => browser.command(method, params, sessionId);
  await command('Runtime.enable');
  return {
    command,
    async evaluate(expression) {
      const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error('YXX_SS007_TAB_EVALUATION_FAILED');
      return result.result.value;
    },
    async waitFor(expression, timeoutMs = 20000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (await this.evaluate(expression)) return;
        await pause(40);
      }
      throw new Error('YXX_SS007_TAB_WAIT_TIMEOUT');
    },
    close: () => browser.command('Target.closeTarget', { targetId }),
  };
}

async function press(target, key) {
  const values = key === 'Tab'
    ? { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 }
    : { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
  await target.command('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...values });
  if (key === 'Enter') {
    await target.command('Input.dispatchKeyEvent', { type: 'char', text: '\r', unmodifiedText: '\r', ...values });
  }
  await target.command('Input.dispatchKeyEvent', { type: 'keyUp', ...values });
}

async function focusSubmitWithTabs(target) {
  await target.command('Page.bringToFront');
  await target.waitFor("document.querySelector('#new-view')?.hidden===false");
  await target.evaluate('document.activeElement?.blur()');
  await press(target, 'Tab');
  assert.equal(await target.evaluate('document.activeElement?.classList.contains("brand")'), true);
  await press(target, 'Tab');
  assert.equal(await target.evaluate('document.activeElement?.id'), 'description');
  for (let index = 0; index < 7; index += 1) await press(target, 'Tab');
  assert.equal(await target.evaluate('document.activeElement?.id'), 'submit-report');
}

async function syntheticVisibilityCycle(browser) {
  await browser.evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'))");
}

async function closeFixtureResources({ fixture, browser, tab, error = null }) {
  await closeBrowserTestResources([
    () => tab?.close(),
    () => browser?.close(),
    () => closeSs007AcceptanceFixture(fixture.server),
  ], error);
}

async function navigate(path) {
  await browser.evaluate(`location.assign(${JSON.stringify(path)})`, { awaitPromise: false });
}

before(async () => {
  fixture = await startSs007AcceptanceFixture();
  browser = await launchAuthenticated({ fixture, path: '/wecom/yixiaoxiu/' });
});

after(async () => {
  await closeFixtureResources({ fixture, browser });
});

beforeEach(async () => {
  fixture.state.authExpired = false;
  fixture.state.supplementConflict = false;
  fixture.state.timelineFailureOnce = false;
  fixture.state.commandStatusResponses.length = 0;
  await browser.command('Page.bringToFront');
  await browser.evaluate("sessionStorage.clear();localStorage.clear();delete document.hidden;window.dispatchEvent(new PageTransitionEvent('pagehide'))");
  await navigate('/wecom/yixiaoxiu/');
  await browser.waitFor("document.querySelector('#home-view')?.hidden===false");
});

test('SS-007 a new tab in the same browser recovers a closed tab command from durable opaque storage', { timeout: 60000 }, async () => {
  let submittingTab;
  let recoveryTab;
  try {
    const route = `${fixture.origin}/wecom/yixiaoxiu/reports/new`;
    submittingTab = await createTab(browser, route);
    await submittingTab.waitFor("document.querySelector('#new-view')?.hidden===false");
    await submittingTab.evaluate(`(() => {
      const actualFetch=window.fetch.bind(window);
      window.fetch=async(path,options)=>{
        const response=await actualFetch(path,options);
        if(String(path)==='/api/yixiaoxiu/requests'&&options?.method==='POST')return new Response('{',{status:200,headers:{'content-type':'application/json'}});
        return response;
      };
      document.querySelector('#description').value='关闭标签页后的待恢复命令';
      document.querySelector('#location-unknown').checked=true;
      document.querySelector('#new-report-form').requestSubmit();
    })()`);
    await waitForSs007State(() => fixture.state.commandCalls.some(item => item.description === '关闭标签页后的待恢复命令'));
    await submittingTab.waitFor("document.querySelector('#app-status')?.textContent.includes('结果未知')");
    const command = fixture.state.commandCalls.find(item => item.description === '关闭标签页后的待恢复命令');
    const pending = JSON.parse(await submittingTab.evaluate("sessionStorage.getItem('yxx.self_service.pending_command')"));
    assert.equal(pending.id, command.client_command_id);
    assert.deepEqual(Object.keys(pending).sort(), ['id', 'scope', 'v']);
    assert.equal(await submittingTab.evaluate("Object.keys(localStorage).filter(key=>key.startsWith('yxx.self_service.pending_command.')).length"), 1);

    await submittingTab.close();
    submittingTab = null;
    fixture.state.commandStatusResponses.push({
      status: 'ACCEPTED', client_command_id: command.client_command_id, request_ref: SS007_REFS.FIRST,
      intake_no: 'INT-20260917-0001', accepted_revision: '1',
      accepted_at: '2026-09-17 09:00:00', accepted_epoch_ms: '1789606800000',
    });
    recoveryTab = await createTab(browser, `${fixture.origin}/wecom/yixiaoxiu/`);
    await recoveryTab.waitFor(`location.pathname==='/wecom/yixiaoxiu/reports/${SS007_REFS.FIRST}'`);
    assert.equal(fixture.state.commandStatusCalls.includes(command.client_command_id), true);
    assert.equal(fixture.state.commandCalls.filter(item => item.client_command_id === command.client_command_id).length, 1);
    assert.equal(await recoveryTab.evaluate("Object.keys(localStorage).filter(key=>key.startsWith('yxx.self_service.pending_command.')).length"), 0);
  } finally {
    await submittingTab?.close();
    await recoveryTab?.close();
  }
});

test('SS-007 same-browser tabs keep form input and accepted request references isolated and capture responsive evidence', { timeout: 120000 }, async t => {
  let tab;
  try {
    const path = '/wecom/yixiaoxiu/reports/new';
    const route = fixture.origin + path;
    await navigate(path);
    await browser.waitFor("document.querySelector('#new-view')?.hidden===false");
    tab = await createTab(browser, route);
    await tab.command('Page.bringToFront');
    await tab.waitFor("document.querySelector('#new-view')?.hidden===false");
    await browser.evaluate("document.querySelector('#description').value='标签页一故障';document.querySelector('#location-unknown').checked=true");
    await tab.evaluate("document.querySelector('#description').value='标签页二故障';document.querySelector('#location-unknown').checked=true");
    assert.equal(await browser.evaluate("document.querySelector('#description').value"), '标签页一故障');
    assert.equal(await tab.evaluate("document.querySelector('#description').value"), '标签页二故障');

    await focusSubmitWithTabs(browser);
    await focusSubmitWithTabs(tab);
    await browser.command('Page.bringToFront');
    await browser.waitFor("document.querySelector('#new-view')?.hidden===false&&document.querySelector('#description')?.value==='标签页一故障'");
    await browser.evaluate("document.querySelector('#submit-report').focus()");
    await press(browser, 'Enter');
    await browser.waitFor(`location.pathname==='/wecom/yixiaoxiu/reports/${SS007_REFS.FIRST}'`);
    await browser.waitFor("document.querySelector('#detail-description')?.textContent==='标签页一故障'");
    await tab.command('Page.bringToFront');
    await tab.waitFor("document.querySelector('#new-view')?.hidden===false&&document.querySelector('#description')?.value==='标签页二故障'");
    await tab.evaluate("document.querySelector('#submit-report').focus()");
    await press(tab, 'Enter');
    await tab.waitFor(`location.pathname==='/wecom/yixiaoxiu/reports/${SS007_REFS.SECOND}'`);
    await tab.waitFor("document.querySelector('#detail-description')?.textContent==='标签页二故障'");
    assert.equal(await browser.evaluate("document.body.textContent.includes('标签页二故障')"), false);
    assert.equal(await tab.evaluate("document.body.textContent.includes('标签页一故障')"), false);
    const tabDescriptions = fixture.state.commandCalls.map(item => item.description)
      .filter(value => value === '标签页一故障' || value === '标签页二故障');
    assert.deepEqual(new Set(tabDescriptions), new Set(['标签页一故障', '标签页二故障']));
    assert.equal(tabDescriptions.length, 2);

    const screenshotDirectory = new URL('../tmp/ss007-ui/', import.meta.url);
    await mkdir(screenshotDirectory, { recursive: true });
    await browser.command('Page.bringToFront');
    await browser.evaluate("location.assign('/wecom/yixiaoxiu/')", { awaitPromise: false });
    await browser.waitFor("document.querySelector('#home-view')?.hidden===false");
    for (const [width, height] of [[390, 844], [1440, 900]]) {
      await browser.command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth>innerWidth'), false);
      const name = `${width}x${height}.png`;
      await writeFile(new URL(name, screenshotDirectory), await browser.screenshot(), 'base64');
      t.diagnostic(`local screenshot: tmp/ss007-ui/${name}`);
    }
    await browser.command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  } finally { await tab?.close(); }
});

test('SS-007 status copy is exercised through browser responses for 429, 409, 401 and 503', { timeout: 120000 }, async () => {
  const path = '/wecom/yixiaoxiu/reports/new';
  await navigate(path);
  await browser.waitFor("document.querySelector('#new-view')?.hidden===false");
  const submit = async (description, expected) => {
    await browser.evaluate(`document.querySelector('#description').value=${JSON.stringify(description)};document.querySelector('#location-unknown').checked=true;document.querySelector('#new-report-form').requestSubmit()`);
    await browser.waitFor(`document.querySelector('#app-status')?.textContent.includes(${JSON.stringify(expected)})`);
  };
  await submit('触发429', '操作太频繁');
  await submit('触发409', '版本或状态已变化');
  fixture.state.authExpired = true;
  await submit('触发401', '认证已失效');
  fixture.state.authExpired = false;
  await navigate(path);
  await browser.waitFor("document.querySelector('#new-view')?.hidden===false");
  await submit('触发503', '服务暂时不可用');
  await browser.evaluate("sessionStorage.removeItem('yxx.self_service.pending_command');for(const key of Object.keys(localStorage)){if(key.startsWith('yxx.self_service.pending_command.'))localStorage.removeItem(key)}");
  await navigate('/wecom/yixiaoxiu/');
  await browser.waitFor("document.querySelector('#home-view')?.hidden===false");
});

test('SS-007 supplement conflict refreshes the revision while retaining the draft without an automatic POST', { timeout: 60000 }, async () => {
  fixture.state.supplementCalls.length = 0;
  fixture.state.byRef.set(SS007_REFS.FIRST, { description: '标签页一故障', revision: '1' });
  fixture.state.supplementConflict = true;
  try {
    await navigate(`/wecom/yixiaoxiu/reports/${SS007_REFS.FIRST}`);
    await browser.waitFor("document.querySelector('#supplement-form')?.hidden===false");
    await browser.evaluate("document.querySelector('#supplement-text').value='冲突后仍保留的草稿';document.querySelector('#supplement-form').requestSubmit()");
    await browser.waitFor("document.querySelector('#app-status')?.textContent.includes('版本')&&document.querySelector('#detail-facts')?.textContent.includes('2')");
    assert.equal(await browser.evaluate("document.querySelector('#supplement-text').value"), '冲突后仍保留的草稿');
    await pause(100);
    assert.equal(fixture.state.supplementCalls.length, 1);
  } finally { fixture.state.supplementConflict = false; }
});

test('SS-007 does not accept a new detail ETag when the paired timeline request fails', { timeout: 60000 }, async () => {
  fixture.state.byRef.set(SS007_REFS.FIRST, { description: '标签页一故障', revision: '1' });
  await navigate(`/wecom/yixiaoxiu/reports/${SS007_REFS.FIRST}`);
  await browser.waitFor("document.querySelector('#detail-description')?.textContent==='标签页一故障'");
  fixture.state.byRef.set(SS007_REFS.FIRST, { description: '第二版详情', revision: '2' });
  fixture.state.timelineFailureOnce = true;
  const beforeFailure = fixture.state.detailCalls.length;
  await waitForSs007State(() => fixture.state.detailCalls.length > beforeFailure && !fixture.state.timelineFailureOnce, 8000);
  await browser.waitFor("document.querySelector('#app-status')?.textContent.includes('服务暂时不可用')");
  assert.equal(fixture.state.detailCalls.at(-1).ifNoneMatch, `"${SS007_REFS.FIRST}-1"`);
  assert.equal(await browser.evaluate("document.querySelector('#detail-description').textContent"), '标签页一故障');

  const beforeRecovery = fixture.state.detailCalls.length;
  await waitForSs007State(() => fixture.state.detailCalls.length > beforeRecovery, 8000);
  assert.equal(fixture.state.detailCalls.at(-1).ifNoneMatch, `"${SS007_REFS.FIRST}-1"`);
  await browser.waitFor("document.querySelector('#detail-description')?.textContent==='第二版详情'");
});

test('SS-007 synthetic page lifecycle rejects a late detail response and logout reaches a terminal page', { timeout: 90000 }, async () => {
  fixture.state.byRef.set(SS007_REFS.FIRST, { description: '标签页一故障', revision: '1' });
  await navigate(`/wecom/yixiaoxiu/reports/${SS007_REFS.FIRST}`);
  await browser.waitFor("document.querySelector('#detail-description')?.textContent==='标签页一故障'");
  await browser.evaluate(`(() => {
      const actualFetch=window.fetch.bind(window);let held=true;
      window.fetch=(path,options)=>{
        if(held&&String(path)==='/api/yixiaoxiu/requests/${SS007_REFS.FIRST}'){
          held=false;
          return new Promise(resolve=>{window.__releaseSs007Late=()=>resolve(new Response(JSON.stringify({
            source_kind:'WEB_REQUEST',request_ref:'${SS007_REFS.FIRST}',intake_no:'YXX-STALE',display_status:'WAITING_FOR_DETAILS',
            input_revision:'99',processed_revision:'0',needs_action:null,safe_description:'STALE-DETAIL-MUST-NOT-RENDER',
            safe_location:null,created_at:'2026-09-17 08:00:00',created_epoch_ms:'1789603200000',
            updated_at:'2026-09-17 08:00:00',updated_epoch_ms:'1789603200000',supplements:[],ticket:null,
            safe_clarification:null,can_supplement:true
          }),{status:200,headers:{'content-type':'application/json','etag':'"stale"'}}));});
        }
        return actualFetch(path,options);
      };
      document.dispatchEvent(new Event('visibilitychange'));
  })()`);
  await browser.waitFor("typeof window.__releaseSs007Late==='function'");
  // These are deterministic PageTransitionEvent seams. They verify the handlers and
  // generation fence; they are deliberately not evidence of an operating-system BFCache cycle.
  await browser.evaluate("window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))");
  await browser.waitFor("document.querySelector('#detail-description')?.textContent==='标签页一故障'");
  await browser.evaluate("window.__releaseSs007Late()");
  await pause(100);
  assert.equal(await browser.evaluate("document.body.textContent.includes('STALE-DETAIL-MUST-NOT-RENDER')"), false);

  const scope = await browser.evaluate("fetch('/api/yixiaoxiu/bootstrap').then(response=>response.json()).then(value=>value.recovery_scope)");
  await browser.evaluate(`(() => {const value={v:3,id:'00000000-0000-4000-8000-000000000077',scope:'${scope}'};const record=JSON.stringify(value);sessionStorage.setItem('yxx.self_service.pending_command',record);localStorage.setItem('yxx.self_service.pending_command.'+value.id,record);document.querySelector('#logout').click()})()`);
  await browser.waitFor("document.querySelector('#logged-out-view')?.hidden===false&&document.querySelector('#app-status')?.textContent.includes('已退出')");
  const pending = JSON.parse(await browser.evaluate("sessionStorage.getItem('yxx.self_service.pending_command')"));
  assert.deepEqual(Object.keys(pending).sort(), ['id', 'scope', 'v']);
  assert.equal(pending.scope, scope);
  assert.notEqual(await browser.evaluate("localStorage.getItem('yxx.self_service.pending_command.00000000-0000-4000-8000-000000000077')"), null);
  assert.equal(await browser.evaluate("document.body.textContent.includes('标签页一故障')"), false);
  assert.equal(await browser.evaluate("document.querySelector('#brand-link').hidden&&document.querySelector('#logout').hidden"), true);
  await browser.evaluate("document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))");
  assert.equal(await browser.evaluate("document.querySelector('#logged-out-view').hidden"), false);
  assert.equal(await browser.evaluate("document.body.textContent.includes('旧认证提示')"), false);
  assert.equal(fixture.state.logoutCalls > 0, true);
});
