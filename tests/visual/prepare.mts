import assert from 'node:assert/strict';
import { clickWorkbenchControl } from '../helpers/heroui-workbench-controls.mjs';
import { waitForAnimationsSettled } from '../helpers/browser-animations.mjs';
import type { Browser } from '../helpers/t43-service-actions.mjs';
import type { VisualFixture } from './fixture.mjs';
import type { Screen } from '../../tools/visual-regression/model.mjs';
/** Card 32A response seam: static, mutually authorised synthetic presence, no wall-clock leases. */
export function fixtureScript(presence: boolean, principalId?: string): string {
  return `(() => {
  const principal = ${JSON.stringify(principalId ?? null)};
  if (principal)
    for (const group of ['completed', 'dismissed'])
      sessionStorage.setItem('pc-admin:processed-group:' + principal + ':' + group, 'true');
  class SyntheticEventSource extends EventTarget {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 2;
    readyState = 1;
    constructor(url) {
      super();
      this.url = String(url);
      queueMicrotask(() => this.dispatchEvent(new Event('open')));
    }
    close() {
      this.readyState = 2;
    }
  }
  window.EventSource = SyntheticEventSource;
  const original = fetch.bind(window),
    expires = String(Date.now() + 15000);
  const people = ${JSON.stringify(
    presence
      ? [
          {
            display_name: '陈悦（合成）',
            mode: 'EDITING',
            field: 'internal-note',
            expires_epoch_ms: '1794535215000',
          },
          {
            display_name: '周宁（合成）',
            mode: 'VIEWING',
            field: null,
            expires_epoch_ms: '1794535215000',
          },
        ]
      : [],
  )}.map((person) => ({
    ...person,
    expires_epoch_ms: expires,
  }));
  window.__visualPending = 0;
  const response = (value) =>
    new Response(JSON.stringify(value), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  window.fetch = async (input, options) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href),
      method = (options?.method ?? 'GET').toUpperCase();
    if (url.pathname === '/api/workbench/online')
      return response({
        schema_version: 1,
        total: ${presence ? 3 : 0},
        people: ${JSON.stringify(
          presence
            ? [
                { display_name: '陈悦（合成）', status: 'EDITING' },
                { display_name: '周宁（合成）', status: 'VIEWING' },
                { display_name: '沈然（合成）', status: 'ONLINE' },
              ]
            : [],
        )},
      });
    if (url.pathname === '/api/workbench/activity' && method === 'POST')
      return response({ schema_version: 1, accepted: true, expires_epoch_ms: expires });
    if (url.pathname === '/api/workbench/activity/batch-view') {
      const body = JSON.parse(options.body);
      return response({
        schema_version: 1,
        items: people.length ? body.targets.map((t) => ({ ...t, people })) : [],
      });
    }
    if (url.pathname.endsWith('/activity') && method === 'GET')
      return response({ schema_version: 1, people });
    if (
      method === 'POST' &&
      url.pathname.endsWith('/follow') &&
      window.__visualToastMode === 'loading'
    )
      return new Promise(() => {});
    if (
      method === 'POST' &&
      url.pathname.endsWith('/internal-notes') &&
      window.__visualToastMode === 'conflict'
    )
      return new Response(
        JSON.stringify({
          ok: false,
          error: { code: 'P2_016_VERSION_CONFLICT', retryable: false },
        }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      );
    window.__visualPending++;
    try {
      const result = await original(input, options);
      await result.clone().text();
      if (url.pathname === '/api/lifecycle/bootstrap' && result.ok)
        return response({
          ...(await result.clone().json()),
          expires_epoch_ms: String(Date.now() + 900000),
        });
      return result;
    } finally {
      window.__visualPending--;
    }
  };
})();`;
}
const q = JSON.stringify;
async function click(b: Browser, selector: string) {
  await b.waitFor(`Boolean(document.querySelector(${q(selector)}))`);
  await clickWorkbenchControl(b, selector);
}
async function fill(b: Browser, selector: string, value: string) {
  await click(b, selector);
  await b.command('Input.insertText', { text: value });
}
async function expand(b: Browser, selector: string, prepared = false): Promise<void> {
  const count = Number(await b.evaluate(`document.querySelectorAll(${q(selector)}).length`));
  for (let i = 0; i < count; i++) {
    const marker = '[data-visual-expand="' + i + '"]';
    await b.evaluate(
      `document.querySelectorAll(${q(selector)})[${i}].setAttribute('data-visual-expand','${i}')`,
    );
    if (
      !prepared &&
      (await b.evaluate(
        `document.querySelector(${q(marker)})?.getAttribute('aria-expanded')==='false'`,
      ))
    )
      await clickWorkbenchControl(b, marker);
    await b.waitFor(
      `document.querySelectorAll(${q(selector)})[${i}]?.getAttribute('aria-expanded')==='true'`,
    );
    await waitForAnimationsSettled(b);
    await b.waitFor(`(() => {
  const n = document.querySelectorAll(${q(selector)})[${i}],
    ids = n?.getAttribute('aria-controls')?.split(' ') ?? [];
  return (
    ids.length > 0 &&
    ids.every((id) => {
      const panel = document.getElementById(id);
      return panel && panel.getBoundingClientRect().height > 0;
    })
  );
})();`);
    await b.evaluate(`document.querySelector(${q(marker)})?.removeAttribute('data-visual-expand')`);
  }
  await waitForAnimationsSettled(b);
}
async function toastCopies(b: Browser): Promise<Record<string, string>> {
  const copies: Record<string, string> = {};
  const take = async (tone: string) => {
    const s = `.workbench-toast[data-visible=true][data-tone=${tone}]`;
    await b.waitFor(`Boolean(document.querySelector(${q(s)}))`);
    await waitForAnimationsSettled(b, s);
    copies[tone] = String(await b.evaluate(`document.querySelector(${q(s)}).outerHTML`));
  };
  const follow = async () => {
    await b.waitFor("document.querySelector('[data-action=toggle-item-follow]')?.disabled===false");
    await b.evaluate("document.querySelector('[data-action=toggle-item-follow]').click()");
  };
  await follow();
  await b.waitFor(`[...document.querySelectorAll('.workbench-toast[data-tone=success]')].some(
  (n) => !n.textContent.includes('正在读取'),
);`);
  await take('success');
  await b.evaluate("window.__visualToastMode='conflict'");
  await fill(b, '.ds-detail-footer textarea', '打印故障排查记录（合成）。');
  await b.waitFor(`[...document.querySelectorAll('.ds-detail-footer button')].some(
  (b) => b.textContent.includes('保存') && !b.disabled,
);`);
  await b.evaluate(`[...document.querySelectorAll('.ds-detail-footer button')]
  .find((b) => b.textContent.includes('保存') && !b.disabled)
  .click();`);
  await take('danger');
  // Card 33: failed draft encryption surfaces the production warning, then an ordinary reload restores the saved draft (info).
  await b.evaluate(`window.__visualOriginalEncrypt = crypto.subtle.encrypt;
crypto.subtle.encrypt = () => Promise.reject(new DOMException('synthetic', 'OperationError'));`);
  await b.command('Input.insertText', { text: '补充（合成）' });
  await take('warning');
  await b.evaluate('crypto.subtle.encrypt=window.__visualOriginalEncrypt');
  await b.command('Input.insertText', { text: '再次补充（合成）' });
  await b.waitFor(
    "document.querySelector('[data-draft-status]')?.textContent.includes('草稿已保存')",
  );
  const url = String(await b.evaluate('location.href'));
  await b.command('Page.navigate', { url });
  await b.waitFor("Boolean(document.querySelector('#detail-title'))");
  await take('info');
  await b.evaluate("window.__visualToastMode='loading'");
  await follow();
  await take('loading');
  return copies;
}
export async function prepareScreen(b: Browser, f: VisualFixture, s: Screen): Promise<void> {
  const isDetail = s.route.includes('/items/');
  await b.waitFor(
    isDetail
      ? "Boolean(document.querySelector('#detail-title'))&&Boolean(document.querySelector('.detail-body'))"
      : "Boolean(document.querySelector('.board,.ds-work-table,.conversation-inbox-workspace,[data-notification-exceptions]'))",
  );
  await b.waitFor("Boolean(document.querySelector('[data-realtime-status=live]'))");
  for (const step of s.prepare) {
    switch (step) {
      case 'seed-board':
      case 'seed-conversation':
      case 'seed-notifications':
      case 'detail-ready':
        break;
      case 'expand-board-groups':
        await b.waitFor(`document.querySelectorAll('.ticket-card').length >= 3 &&
  Boolean(
    document.querySelector(
      '.ds-board-group[data-board-group=已完成] button.ds-board-group-trigger',
    ),
  ) &&
  Boolean(
    document.querySelector(
      '.ds-board-group[data-board-group=已关闭] button.ds-board-group-trigger',
    ),
  );`);
        await expand(b, '.ds-board-group button.ds-board-group-trigger[aria-expanded]', true);
        break;
      case 'expand-list-groups':
        await b.waitFor(`document.querySelectorAll('.ds-list-subgroup').length >= 4 &&
  document.querySelectorAll('.ds-work-row').length >= 3;`);
        await expand(b, '.ds-list-subgroup button[aria-expanded]');
        break;
      case 'scroll-closed-groups':
        await b.evaluate(
          "document.querySelector('.ds-list-subgroup[data-board-group=已完成]')?.scrollIntoView({block:'start'})",
        );
        break;
      case 'fixed-presence':
        await b.waitFor("Boolean(document.querySelector('[data-action=open-online-colleagues]'))");
        break;
      case 'editing-banner':
        await b.waitFor(`Boolean(document.querySelector('[data-presence-field-banner]')) &&
  Boolean(document.querySelector('.detail-toolbar-actions [data-workbench-activity]'));`);
        break;
      case 'empty-search':
        await b.waitFor(`new URLSearchParams(location.search).get('q') === '不匹配的打印设备（合成）' &&
  document.querySelector('.workbench-search')?.getAttribute('aria-busy') === 'false' &&
  document.querySelectorAll('.ticket-card,.ds-work-row').length === 0 &&
  !document.body.innerText.includes('查询未完成');`);
        break;
      case 'closure-record':
        await b.waitFor("document.body.innerText.includes('关闭记录')");
        break;
      case 'close-dialog':
        await click(b, 'details.ds-drawer-more>summary[aria-label="更多工单操作"]');
        await click(b, 'details.ds-drawer-more [data-action=cancel]');
        await b.waitFor(
          "document.querySelector('.detail-cancel-dialog')?.checkVisibility()===true",
        );
        break;
      case 'choose-out-of-scope':
        await click(b, '.detail-cancel-dialog input[value=NOT_IT_SCOPE]');
        await b.waitFor(
          "Boolean(document.querySelector('.detail-cancel-dialog input[value=OUT_OF_SCOPE_CONFIRMED]'))",
        );
        await click(b, '.detail-cancel-dialog input[value=OUT_OF_SCOPE_CONFIRMED]');
        break;
      case 'search-original': {
        await click(b, '.detail-cancel-dialog input[value=DUPLICATE]');
        const original = f.tickets[3];
        assert.ok(original);
        const ticket = (
          await f.pool.query<{
            ticket_no: string;
          }>('SELECT ticket_no FROM pilot_ticket.ticket WHERE id=$1::uuid', [original.ticket.id])
        ).rows[0];
        assert.ok(ticket);
        await fill(b, 'input[aria-label="关联原单（选填）"]', ticket.ticket_no);
        await b.waitFor("document.querySelectorAll('.ds-closure-search-option').length>0");
        break;
      }
      case 'restore-dialog':
        await click(b, '.ds-next-step [data-action=restore-dismissed]');
        await b.waitFor("Boolean(document.querySelector('[data-restore-confirmation]'))");
        break;
      case 'online-popover':
        await click(b, '[data-action=open-online-colleagues]');
        await b.waitFor("Boolean(document.querySelector('.ds-online-panel'))");
        break;
      case 'waiting-inbox':
        await b.waitFor(`document.querySelectorAll('[data-contact-ref]').length > 0 &&
  Boolean(document.querySelector('[data-conversation-ready]'));`);
        break;
      case 'notification-rows':
        await b.waitFor("document.querySelectorAll('[data-exception-row]').length===3");
        break;
      case 'toast-exhibit':
      case 'toast-stack': {
        const copies = await toastCopies(b),
          stack = step === 'toast-stack';
        // Return to a settled drawer after collecting transient notices; keep the real placement viewport.
        await b.command('Storage.clearDataForOrigin', {
          origin: f.origin,
          storageTypes: 'local_storage,indexeddb,cache_storage',
        });
        await b.command('Page.navigate', {
          url: f.origin + '/workbench/app/items/ticket/' + f.ids.processing + '?range=all',
        });
        await b.waitFor("Boolean(document.querySelector('.ds-detail-footer textarea'))");
        await b.evaluate(`(() => {
  const a = document.querySelector('.ds-detail-footer textarea');
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(a, '');
  a.dispatchEvent(new Event('input', { bubbles: true }));
})();`);
        await b.waitFor(`document.querySelector('.ds-detail-footer textarea')?.value === '' &&
  !document.querySelector('[data-draft-status]')?.textContent.includes('正在保存');`);
        await waitForAnimationsSettled(b);
        // Card 33's static evidence seam: exact production-rendered DOM and stylesheet, no substitute components.
        await b.evaluate(`(() => {
  const stack = ${stack};
  const original = document.querySelector('.workbench-toast-viewport');
  const row = stack ? original.cloneNode(false) : document.createElement('div');
  document.querySelectorAll('.workbench-toast-viewport').forEach((node) => {
    node.style.visibility = 'hidden';
  });
  row.dataset.visualToasts = '';
  if (stack) {
    row.style.visibility = 'visible';
    row.removeAttribute('hidden');
  } else {
    Object.assign(row.style, {
      position: 'fixed',
      inset: '0',
      display: 'grid',
      gridTemplateColumns: 'repeat(3,400px)',
      gap: 'var(--space-8)',
      alignContent: 'center',
      justifyContent: 'center',
      background: 'var(--bg-subtle)',
      zIndex: 'var(--z-toast)',
      pointerEvents: 'none',
    });
  }
  const copies = ${q(copies)};
  const tones = stack
    ? ['success', 'danger', 'warning']
    : ['success', 'info', 'warning', 'danger', 'loading'];
  row.innerHTML = tones.map((tone) => copies[tone]).join('');
  if (!stack) {
    const one = row.querySelector('.workbench-toast').cloneNode(true);
    const content = one.querySelector('.workbench-toast-content');
    content.classList.add('is-single');
    content.querySelector('span')?.remove();
    content.querySelector('strong').textContent = '已复制编号（合成）';
    row.append(one);
  }
  row.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
  row.querySelectorAll('.workbench-toast').forEach((node) => {
    node.dataset.visible = 'true';
    node.style.visibility = 'visible';
  });
  if (stack) original.parentElement.append(row);
  else document.body.append(row);
})();`);

        break;
      }
      default:
        throw Error('Unimplemented visual preparation step: ' + step);
    }
  }
  if (s.prepare.includes('close-dialog'))
    await b.waitFor(
      "document.querySelector('.detail-cancel-dialog [data-waiting-draft-status]')?.textContent.includes('草稿已保存')",
    );
  await b.command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
}
