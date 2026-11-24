import assert from 'node:assert/strict';
import {test} from 'node:test';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir, platform, release} from 'node:os';
import {dirname, isAbsolute, join} from 'node:path';
import sharp from 'sharp';
import {type Browser, type Scene, visible, withScene} from './helpers/card37a-optimistic-fixture.mjs';
import {board, current, key, suite} from './helpers/card37b-keyboard-browser.mjs';
import {boardReady, query, seedMotionTicket} from './helpers/motion-board-fixture.mjs';
import {waitForAnimationsSettled} from './helpers/browser-animations.mjs';
import {move} from './helpers/card37c-hover-browser.mjs';
import {assertMotion, assertNoTransformAnimations} from './helpers/motion-assert.mjs';

const root = process.env.TS_MIGRATION_TEST_SOURCE_ROOT ?? process.cwd();
let evidenceDir: string | undefined;

interface PlainBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

interface GeometryPair {
  x: number;
  width: number;
}

interface GroupGeometry {
  count: number;
  first: GeometryPair;
  last: GeometryPair;
}

interface ColumnGeometry {
  contentLeft: number;
  contentWidth: number;
}

interface BoardGeometrySnapshot {
  viewport: {width: number; height: number};
  columns: {
    pending: ColumnGeometry;
    active: ColumnGeometry;
    handled: ColumnGeometry;
  };
  groups: {
    intake: GroupGeometry;
    dispatch: GroupGeometry;
    active: GroupGeometry;
    done: GroupGeometry;
  };
  remainders: {
    dispatch: GroupGeometry;
    active: GroupGeometry;
    done: GroupGeometry;
  };
  nextGroupHeadingY: {
    expanded: number;
    collapsed: number;
  };
}

function assertFiniteBox(box: unknown, label: string): PlainBox {
  assert.ok(box && typeof box === 'object', label + ' must be an object');
  const record = box as Record<string, unknown>;
  for (const field of ['left', 'top', 'right', 'bottom', 'width', 'height'] as const) {
    assert.ok(typeof record[field] === 'number' && Number.isFinite(record[field]), `${label}.${field} must be finite`);
  }
  return {
    left: Number(record.left),
    top: Number(record.top),
    right: Number(record.right),
    bottom: Number(record.bottom),
    width: Number(record.width),
    height: Number(record.height),
  };
}

function assertRgbTuple(value: unknown, label: string): [number, number, number] {
  assert.ok(Array.isArray(value) && value.length === 3 && value.every(c => typeof c === 'number' && Number.isFinite(c)), label + ' RGB');
  return [Number(value[0]), Number(value[1]), Number(value[2])];
}

async function writeEvidencePng(b: Browser, name: string, png: Buffer): Promise<void> {
  const dir = (evidenceDir ??= process.env.CARD39A_EVIDENCE_DIR
    ? join(root, process.env.CARD39A_EVIDENCE_DIR)
    : await mkdtemp(join(tmpdir(), 'card39a-evidence-')));
  await mkdir(dir, {recursive: true});
  await writeFile(join(dir, name + '.png'), png);
  const readme = join(dir, 'README.md');
  if (!existsSync(readme)) {
    console.log('CARD39A_EVIDENCE ' + JSON.stringify({name, file: join(dir, name + '.png')}));
    return;
  }
  const version: unknown = await b.command('Browser.getVersion');
  assert.ok(version && typeof version === 'object' && 'product' in version && typeof version.product === 'string');
  const before = await readFile(readme, 'utf8');
  const prefix = '| `' + name + '.png` |';
  assert.equal(before.split('\n').filter(line => line.startsWith(prefix)).length, 1);
  const line = prefix + ' ' + platform() + ' ' + release() + ' | ' + version.product + ' |';
  await writeFile(readme, before.split('\n').map(old => (old.startsWith(prefix) ? line : old)).join('\n'));
}

async function prepareBoardFixture(s: Scene): Promise<void> {
  // Append the synthetic suffix only within this test's isolated DB so shared fixture assertions remain intact.
  await s.f.pool.query(
    "UPDATE intake.service_intake SET summary = summary || '（合成）' WHERE summary IN ($1, $2)",
    ['尚待判断的合成材料，请协助确认。', '位置尚不清楚，等待补充的全新合成报修。'],
  );
  const ticketId = await seedMotionTicket(s.f.pool, '已处理剩余验收');
  const active = await s.http.start(ticketId);
  const done = await s.http.post(ticketId, 'complete', s.http.command(active));
  assert.equal(done.status, 200, await done.text());
}

async function cdpClick(b: Browser, selector: string): Promise<void> {
  await b.waitFor(visible(selector));
  await b.evaluate(`${query(selector)}.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})`);
  await waitForAnimationsSettled(b);
  const pt = await b.evaluate(`(()=>{
    const el=${query(selector)};
    if(!el)throw Error('click target missing');
    const r=el.getBoundingClientRect();
    const x=r.left+r.width/2,y=r.top+r.height/2;
    const hit=document.elementFromPoint(x,y);
    if(!hit||(hit!==el&&!el.contains(hit)))throw Error('click target obscured');
    return {x,y};
  })()`) as {x: number; y: number};
  assert.ok(Number.isFinite(pt.x) && Number.isFinite(pt.y));
  await b.command('Input.dispatchMouseEvent', {type: 'mouseMoved', buttons: 0, x: pt.x, y: pt.y});
  await b.command('Input.dispatchMouseEvent', {type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1, x: pt.x, y: pt.y});
  await b.command('Input.dispatchMouseEvent', {type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1, x: pt.x, y: pt.y});
}

async function decodeScreenshot(b: Browser) {
  const png = Buffer.from(await b.screenshot(), 'base64');
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  const {data, info} = await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject: true});
  return {png, data, info};
}

function assertPixelMatchesRgb(
  data: Buffer,
  info: {width: number; height: number; channels: number},
  px: number,
  py: number,
  expected: readonly [number, number, number],
  label: string,
): void {
  assert.ok(px >= 0 && px < info.width && py >= 0 && py < info.height, `${label} sample out of bounds (${px},${py}) in ${info.width}x${info.height}`);
  const idx = (py * info.width + px) * info.channels;
  const ar = data[idx];
  const ag = data[idx + 1];
  const ab = data[idx + 2];
  assert.ok(ar !== undefined && ag !== undefined && ab !== undefined, `${label} missing pixel channel`);
  const [er, eg, eb] = expected;
  assert.ok(
    Math.abs(ar - er) <= 2 && Math.abs(ag - eg) <= 2 && Math.abs(ab - eb) <= 2,
    `${label} at (${px},${py}) expected rgb(${er},${eg},${eb}) +-2, got rgb(${ar},${ag},${ab})`,
  );
}

async function sampleHorizontalStripRgb(
  b: Browser,
  yCss: number,
  xLeftCss: number,
  xRightCss: number,
  viewport: {width: number; height: number},
  expected: readonly [number, number, number],
  label: string,
): Promise<void> {
  assert.ok(yCss >= 0 && yCss < viewport.height, `${label} y=${yCss} outside viewport height ${viewport.height}`);
  assert.ok(xRightCss > xLeftCss, `${label} strip width must be positive (${xLeftCss}..${xRightCss})`);
  const {data, info} = await decodeScreenshot(b);
  const sx = info.width / viewport.width;
  const sy = info.height / viewport.height;
  const py = Math.floor(yCss * sy);
  for (const t of [0.2, 0.35, 0.5, 0.65, 0.8]) {
    const px = Math.floor((xLeftCss + (xRightCss - xLeftCss) * t) * sx);
    assertPixelMatchesRgb(data, info, px, py, expected, `${label} t=${t}`);
  }
}

async function selectCardBySelector(b: Browser, selector: string): Promise<void> {
  await b.waitFor(visible(selector + ' .card-open'));
  await b.evaluate(`${query(selector)}.scrollIntoView({block:'center',behavior:'instant'})`);
  await waitForAnimationsSettled(b);
  const direction = await b.evaluate(`(()=>{
    const link=${query(selector + ' .card-open')},col=link.closest('.board-column');
    if(!link||!col)throw Error('missing card or column');
    const links=[...col.querySelectorAll('a.card-open[href]')].filter(a=>a.checkVisibility()&&!a.closest('[inert],[aria-hidden=true]')&&
      !a.closest('.ds-collapse-inner')?.parentElement?.matches('[aria-hidden=true]'));
    const i=links.indexOf(link);if(i<0)throw Error('target card not navigable');
    const previous=links[i-1],next=links[i+1];
    (previous??next??link).focus({preventScroll:true});
    return previous?'j':next?'k':'j';
  })()`);
  assert.ok(direction === 'j' || direction === 'k');
  await key(b, direction);
  await b.waitFor(visible(selector + current) + '&&' + query(selector) + '.contains(document.activeElement)');
}

/**
 * Pixel-sampling method for `--shadow-keyboard-current` (`0 0 0 2px var(--brand), 0 0 0 5px var(--brand-subtle)`):
 * - Sampling position: 4px outward from the card border edge at each of the 4 edge midpoints
 *   (`3.5px` CSS offset scaled by `sx`/`sy` -> at DPR 1, `Math.floor((edge +- 3.5) * 1)` is the 4th outward pixel,
 *   the exact center of the 2px..5px `--brand-subtle` outer band). Sampling 4px beyond the outer edge of the 5px
 *   ring (5px + 4px = 9px) would land on the column/page background and could never equal `--brand-subtle`.
 * - We apply `.is-selected` directly on the card for unobscured pixel sampling because opening the detail drawer
 *   covers the viewport with `.workbench-drawer-backdrop` (`rgba(55,53,47,.16)`) and obscures the 已处理 column
 *   behind the 720px drawer panel; the real pointer click selection path is separately verified in the same test.
 * - We hover `.card-top` and call `waitForAnimationsSettled` so `:hover` (`translateY(-1px)`) is settled before
 *   reading explicit numeric bounds and capturing the PNG via CDP, then decode RGBA with `sharp` (tolerance +-2/channel).
 */
async function activateRingStatesAndSample(
  b: Browser,
  selector: string,
  label: string,
  captureName?: string,
): Promise<void> {
  await selectCardBySelector(b, selector);
  await b.evaluate(`${query(selector)}.classList.add('is-selected')`);
  const hoverPt = await b.evaluate(`(()=>{
    const target=${query(selector + ' .card-top')}??${query(selector)};
    if(!target)throw Error('hover target missing');
    const r=target.getBoundingClientRect();
    return {x:r.left+r.width/2,y:r.top+r.height/2};
  })()`) as {x: number; y: number};
  await move(b, hoverPt);
  await waitForAnimationsSettled(b);

  const rawMeta = await b.evaluate(`(()=>{
    const el=${query(selector)};
    if(!el)throw Error('sampled card missing');
    const probe=document.createElement('span');
    probe.style.color='var(--brand-subtle)';
    probe.style.boxShadow='var(--shadow-keyboard-current)';
    document.body.append(probe);
    const ps=getComputedStyle(probe);
    const rgb=ps.color.match(/\\d+/g).slice(0,3).map(Number);
    const expectedShadow=ps.boxShadow;
    probe.remove();
    const r=el.getBoundingClientRect();
    return {
      keyboardCurrent:el.dataset.keyboardCurrent==='true',
      selected:el.classList.contains('is-selected'),
      hovered:el.matches(':hover'),
      boxShadowMatches:getComputedStyle(el).boxShadow===expectedShadow,
      rgb,
      rect:{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height},
      viewport:{width:innerWidth,height:innerHeight}
    };
  })()`) as {
    keyboardCurrent: boolean;
    selected: boolean;
    hovered: boolean;
    boxShadowMatches: boolean;
    rgb: unknown;
    rect: unknown;
    viewport: {width: number; height: number};
  };

  assert.equal(rawMeta.keyboardCurrent, true, label + ' must be keyboard-current');
  assert.equal(rawMeta.selected, true, label + ' must be selected');
  assert.equal(rawMeta.hovered, true, label + ' must be hovered');
  assert.equal(rawMeta.boxShadowMatches, true, label + ' must draw --shadow-keyboard-current');
  const expectedRgb = assertRgbTuple(rawMeta.rgb, label);
  const rect = assertFiniteBox(rawMeta.rect, label);

  const {png, data, info} = await decodeScreenshot(b);
  const sx = info.width / rawMeta.viewport.width;
  const sy = info.height / rawMeta.viewport.height;
  const midX = Math.floor((rect.left + rect.width / 2) * sx);
  const midY = Math.floor((rect.top + rect.height / 2) * sy);
  const offset = 3.5; // 4th pixel outward from card border edge: center of the 2px..5px --brand-subtle band.
  const samples = [
    ['top', midX, Math.floor((rect.top - offset) * sy)],
    ['bottom', midX, Math.floor((rect.bottom + offset) * sy)],
    ['left', Math.floor((rect.left - offset) * sx), midY],
    ['right', Math.floor((rect.right + offset) * sx), midY],
  ] as const;

  for (const [edge, px, py] of samples) {
    assertPixelMatchesRgb(data, info, px, py, expectedRgb, `${label} ${edge}`);
  }

  if (captureName) await writeEvidencePng(b, captureName, png);

  await b.evaluate(`${query(selector)}.classList.remove('is-selected')`);
  await move(b, {x: 2, y: 2});
  await waitForAnimationsSettled(b);
}

async function resolveGroupCardSelectors(b: Browser, containerSelector: string): Promise<{first: string; last: string; count: number}> {
  const result = await b.evaluate(`(()=>{
    const container=${query(containerSelector)};
    if(!container)return {count:0,first:null,last:null};
    const cards=[...container.querySelectorAll('.ticket-card[data-kind][data-item-id]')].filter(n=>n.checkVisibility());
    const sel=n=>n?${JSON.stringify(containerSelector)}+' .ticket-card[data-kind='+JSON.stringify(n.dataset.kind)+'][data-item-id='+JSON.stringify(n.dataset.itemId)+']':null;
    return {count:cards.length,first:sel(cards[0]),last:sel(cards.at(-1))};
  })()`) as {count: number; first: string | null; last: string | null};
  return {count: result.count, first: result.first ?? '', last: result.last ?? ''};
}

test('39A A1/A4 ring pixel sampling, real click selection, hover shadow and keyboard focus', suite, () =>
  withScene(async s => {
    const {b} = s;
    await prepareBoardFixture(s);
    await board(s, 'board');
    // Collapse remainders first so 待判断 is tested before remainder expansion.
    await b.evaluate(`[...document.querySelectorAll('[data-action=expand-column][aria-expanded=true]')].forEach(n=>n.click())`);
    await waitForAnimationsSettled(b);

    const intakeGroup = '.board-column.pending [data-board-group="待判断"]';
    const intakeTitles = await b.evaluate(`[...document.querySelectorAll(${JSON.stringify(intakeGroup + ' .ticket-card h3')})].map(n=>n.textContent.trim())`) as string[];
    assert.ok(intakeTitles.length >= 2, '待判断 must have at least 2 cards');
    for (const title of intakeTitles) {
      assert.ok(title.includes('（合成）'), '待判断 title must carry （合成）: ' + title);
    }

    const intakeCards = await resolveGroupCardSelectors(b, intakeGroup);
    assert.ok(intakeCards.count >= 2, '待判断 fixture must contain at least 2 cards');
    await activateRingStatesAndSample(b, intakeCards.first, '待判断 first', 'board-selected-intake-group');
    await activateRingStatesAndSample(b, intakeCards.last, '待判断 last');

    // Expand all remainders.
    await b.evaluate(`[...document.querySelectorAll('[data-action=expand-column][aria-expanded=false]')].filter(n=>n.checkVisibility()).forEach(n=>n.click())`);
    await waitForAnimationsSettled(b);

    const targets: readonly [string, string, string | undefined, string | undefined][] = [
      ['.board-column.pending [data-board-group="待接单"]', '待接单', undefined, undefined],
      ['.board-column.handled [data-board-group="已完成"]', '已完成', 'board-keyboard-current-done-group', undefined],
      ['.board-column.pending [data-board-group="待接单"] .ds-column-remainder[data-expanded="true"]', '待接单显示剩余', undefined, 'board-remainder-selected'],
      ['.board-column.handled [data-board-group="已完成"] .ds-column-remainder[data-expanded="true"]', '已完成显示剩余', undefined, undefined],
    ];
    for (const [container, label, firstShot, lastShot] of targets) {
      const cards = await resolveGroupCardSelectors(b, container);
      assert.ok(cards.count >= 2, label + ' must contain at least 2 cards so first and last are distinct');
      assert.notEqual(cards.first, cards.last, label + ' first and last must be distinct');
      await activateRingStatesAndSample(b, cards.first, label + ' first', firstShot);
      await activateRingStatesAndSample(b, cards.last, label + ' last', lastShot);
    }

    // Per-column padding (8px > --card-ring-room 6px) and no column overflow clipping.
    const columnReport = await b.evaluate(`(()=>{
      const room=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--card-ring-room'));
      const columns=['pending','active','handled'].map(name=>{
        const col=document.querySelector('.ds-board-column.'+name),css=getComputedStyle(col);
        return {name,left:parseFloat(css.paddingLeft),right:parseFloat(css.paddingRight),top:parseFloat(css.paddingTop),bottom:parseFloat(css.paddingBottom),overflowX:css.overflowX,overflowY:css.overflowY};
      });
      return {room,columns};
    })()`) as {room: number; columns: {name: string; left: number; right: number; top: number; bottom: number; overflowX: string; overflowY: string}[]};
    assert.equal(columnReport.room, 6);
    for (const col of columnReport.columns) {
      assert.ok(col.left > columnReport.room && col.right > columnReport.room && col.top > columnReport.room && col.bottom > columnReport.room,
        col.name + ' column padding must exceed --card-ring-room: ' + JSON.stringify(col));
      assert.equal(col.overflowX, 'visible', col.name + ' overflowX');
      assert.equal(col.overflowY, 'visible', col.name + ' overflowY');
    }

    // Real pointer click path: clicking a keyboard-current card opens its item and keeps both .is-selected and data-keyboard-current.
    const dispatchFirst = (await resolveGroupCardSelectors(b, '.board-column.pending [data-board-group="待接单"]')).first;
    await selectCardBySelector(b, dispatchFirst);
    const clickedRef = await b.evaluate(`(()=>{
      const el=${query(dispatchFirst)};
      return {kind:el.dataset.kind,id:el.dataset.itemId};
    })()`) as {kind: string; id: string};
    assert.ok(clickedRef.kind && clickedRef.id);
    await cdpClick(b, dispatchFirst + ' .card-open');
    await b.waitFor(visible('.detail-dialog #detail-title'));
    await waitForAnimationsSettled(b);
    const clickSelectedState = await b.evaluate(`(()=>{
      const el=${query(dispatchFirst)};
      const probe=document.createElement('span');probe.style.boxShadow='var(--shadow-keyboard-current)';document.body.append(probe);
      const expected=getComputedStyle(probe).boxShadow;probe.remove();
      return {
        pathname:location.pathname,
        selected:el.classList.contains('is-selected'),
        keyboardCurrent:el.dataset.keyboardCurrent==='true',
        boxShadowMatches:getComputedStyle(el).boxShadow===expected,
      };
    })()`) as {pathname: string; selected: boolean; keyboardCurrent: boolean; boxShadowMatches: boolean};
    assert.equal(clickSelectedState.pathname, `/workbench/app/items/${clickedRef.kind}/${clickedRef.id}`);
    assert.equal(clickSelectedState.selected, true, 'real pointer click must mark card .is-selected');
    assert.equal(clickSelectedState.keyboardCurrent, true, 'real pointer click on keyboard-current card preserves data-keyboard-current');
    assert.equal(clickSelectedState.boxShadowMatches, true, 'real clicked card renders --shadow-keyboard-current');
    await key(b, 'Escape');
    await b.waitFor('!document.querySelector(".detail-dialog")');
    await waitForAnimationsSettled(b);

    // Hover-only (--shadow-2) check: clear keyboard-current with a real CDP click on a neutral Element (page heading).
    await cdpClick(b, '.ds-page-header h1');
    await b.waitFor('!' + query(current));
    const cardHoverPt = await b.evaluate(`(()=>{
      const el=${query(intakeCards.first)};
      el.scrollIntoView({block:'center',behavior:'instant'});
      const t=el.querySelector('.card-top')??el,r=t.getBoundingClientRect();
      return {x:r.left+r.width/2,y:r.top+r.height/2};
    })()`) as {x: number; y: number};
    await move(b, cardHoverPt);
    await waitForAnimationsSettled(b);
    const hoverOnly = await b.evaluate(`(()=>{
      const card=${query(intakeCards.first)};
      const content=card.closest('.disclosure__content'),body=card.closest('.disclosure__body');
      const probe=document.createElement('span');probe.style.boxShadow='var(--shadow-2)';document.body.append(probe);
      const shadow2=getComputedStyle(probe).boxShadow;probe.remove();
      const cr=card.getBoundingClientRect(),contentR=content.getBoundingClientRect(),bodyR=body.getBoundingClientRect();
      return {
        keyboardCurrent:card.hasAttribute('data-keyboard-current'),
        hovered:card.matches(':hover'),
        hoverShadow:getComputedStyle(card).boxShadow.startsWith(shadow2),
        leftRoom:cr.left-Math.max(contentR.left,bodyR.left),
        rightRoom:Math.min(contentR.right,bodyR.right)-cr.right,
        topRoom:cr.top-Math.max(contentR.top,bodyR.top),
        bottomRoom:Math.min(contentR.bottom,bodyR.bottom)-cr.bottom,
      };
    })()`) as {
      keyboardCurrent: boolean; hovered: boolean; hoverShadow: boolean;
      leftRoom: number; rightRoom: number; topRoom: number; bottomRoom: number;
    };
    assert.equal(hoverOnly.keyboardCurrent, false, 'real neutral click clears keyboard-current');
    assert.equal(hoverOnly.hovered, true);
    assert.equal(hoverOnly.hoverShadow, true, 'hover-only card draws --shadow-2');
    assert.ok(hoverOnly.leftRoom >= 6 && hoverOnly.rightRoom >= 6 && hoverOnly.topRoom >= 6 && hoverOnly.bottomRoom >= 6,
      'clip ancestors leave >= 6px around hover shadow: ' + JSON.stringify(hoverOnly));

    // Separate keyboard Tab focus check: Tab onto card link restores keyboard-current (37B ring suppresses duplicate outline) within >= 6px room.
    await move(b, {x: 2, y: 2});
    await b.evaluate(`${query(intakeGroup + ' .ds-board-group-trigger')}.focus({preventScroll:true})`);
    await b.pressTab();
    await waitForAnimationsSettled(b);
    const focusCheck = await b.evaluate(`(()=>{
      const card=${query(intakeCards.first)},link=card.querySelector('.card-open');
      const content=card.closest('.disclosure__content'),body=card.closest('.disclosure__body');
      const probe=document.createElement('span');probe.style.boxShadow='var(--shadow-keyboard-current)';document.body.append(probe);
      const expected=getComputedStyle(probe).boxShadow;probe.remove();
      const cr=card.getBoundingClientRect(),contentR=content.getBoundingClientRect(),bodyR=body.getBoundingClientRect();
      return {
        activeIsLink:document.activeElement===link,
        focusVisible:link.matches(':focus-visible'),
        keyboardCurrent:card.dataset.keyboardCurrent==='true',
        ringMatches:getComputedStyle(card).boxShadow===expected,
        linkOutlineWidth:getComputedStyle(link).outlineWidth,
        leftRoom:cr.left-Math.max(contentR.left,bodyR.left),
        rightRoom:Math.min(contentR.right,bodyR.right)-cr.right,
        topRoom:cr.top-Math.max(contentR.top,bodyR.top),
        bottomRoom:Math.min(contentR.bottom,bodyR.bottom)-cr.bottom,
      };
    })()`) as {
      activeIsLink: boolean; focusVisible: boolean; keyboardCurrent: boolean; ringMatches: boolean;
      linkOutlineWidth: string; leftRoom: number; rightRoom: number; topRoom: number; bottomRoom: number;
    };
    assert.equal(focusCheck.activeIsLink, true, 'Tab from group trigger must focus first card link');
    assert.equal(focusCheck.focusVisible, true);
    assert.equal(focusCheck.keyboardCurrent, true, 'keyboard Tab restores data-keyboard-current');
    assert.equal(focusCheck.ringMatches, true, 'keyboard Tab draws 37B --shadow-keyboard-current');
    assert.equal(focusCheck.linkOutlineWidth, '0px', '37B ring replaces separate .card-open outline');
    assert.ok(focusCheck.leftRoom >= 6 && focusCheck.rightRoom >= 6 && focusCheck.topRoom >= 6 && focusCheck.bottomRoom >= 6,
      'clip ancestors leave >= 6px around focused ring: ' + JSON.stringify(focusCheck));
  }, {keyboard: true}));

test('39A A2 group and remainder collapse/expand clip painted card pixels across 5 frames each', suite, () =>
  withScene(async s => {
    const {b} = s;
    await prepareBoardFixture(s);
    await board(s, 'board');
    const intakeGroup = '.board-column.pending [data-board-group="待判断"]';
    const intakeTrigger = intakeGroup + ' .ds-board-group-trigger';
    const intakeContent = intakeGroup + ' > .disclosure__content';
    const intakeBody = intakeContent + ' > .disclosure__body';
    const dispatchTrigger = '.board-column.pending [data-board-group="待接单"] .ds-board-group-trigger';

    const laneRgbRaw = await b.evaluate(`(()=>{
      const p=document.createElement('span');p.style.color='var(--lane-intake)';document.body.append(p);
      const rgb=getComputedStyle(p).color.match(/\\d+/g).slice(0,3).map(Number);p.remove();
      return rgb;
    })()`);
    const laneRgb = assertRgbTuple(laneRgbRaw, '--lane-intake');

    const settledExpanded = await b.evaluate(`(()=>{
      const box=r=>({left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height});
      const trigger=${query(intakeTrigger)},content=${query(intakeContent)},body=${query(intakeBody)};
      return {
        expanded:trigger.getAttribute('aria-expanded'),
        contentBox:box(content.getBoundingClientRect()),
        bodyBox:box(body.getBoundingClientRect()),
        overflowContent:[getComputedStyle(content).overflowX,getComputedStyle(content).overflowY],
        overflowBody:[getComputedStyle(body).overflowX,getComputedStyle(body).overflowY],
        cards:[...body.querySelectorAll('.ticket-card')].map(c=>box(c.getBoundingClientRect())),
      };
    })()`) as {
      expanded: string | null;
      contentBox: unknown;
      bodyBox: unknown;
      overflowContent: [string, string];
      overflowBody: [string, string];
      cards: unknown[];
    };
    assert.equal(settledExpanded.expanded, 'true');
    assert.deepEqual(settledExpanded.overflowContent, ['clip', 'clip']);
    assert.deepEqual(settledExpanded.overflowBody, ['hidden', 'hidden']);
    const expandedContentBox = assertFiniteBox(settledExpanded.contentBox, 'expandedContent');
    const expandedBodyBox = assertFiniteBox(settledExpanded.bodyBox, 'expandedBody');
    assert.ok(settledExpanded.cards.length >= 2, '待判断 must have >= 2 cards');
    for (const rawCard of settledExpanded.cards) {
      const cardBox = assertFiniteBox(rawCard, 'expandedCard');
      assert.ok(cardBox.left - 6 >= expandedContentBox.left - 0.5 && cardBox.right + 6 <= expandedContentBox.right + 0.5);
      assert.ok(cardBox.top - 6 >= expandedContentBox.top - 0.5 && cardBox.bottom + 6 <= expandedContentBox.bottom + 0.5);
      assert.ok(cardBox.left - 6 >= expandedBodyBox.left - 0.5 && cardBox.right + 6 <= expandedBodyBox.right + 0.5);
      assert.ok(cardBox.top - 6 >= expandedBodyBox.top - 0.5 && cardBox.bottom + 6 <= expandedBodyBox.bottom + 0.5);
    }

    await b.command('Animation.enable');
    try {
      const sampleDisclosure = async (direction: 'collapse' | 'expand') => {
        const expectedStartExpanded = direction === 'collapse' ? 'true' : 'false';
        const expectedEndExpanded = direction === 'collapse' ? 'false' : 'true';
        assert.equal(await b.evaluate(`${query(intakeTrigger)}.getAttribute('aria-expanded')`), expectedStartExpanded);
        await b.evaluate(`${query(intakeGroup)}.scrollIntoView({block:'start',behavior:'instant'})`);
        await b.command('Animation.setPlaybackRate', {playbackRate: 0});
        await b.evaluate(`${query(intakeTrigger)}.click()`);
        await b.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
        // Scoped E3 exception (card 39A option A): verify both grid-template-rows and margin-bottom use --dur-base / --ease-standard.
        const motionTiming = await assertMotion(b, intakeContent, '--dur-base', '--ease-standard', {
          cssExceptions: ['gridTemplateRows', 'marginBottom'],
        });
        assert.deepEqual(
          motionTiming.map(m => m.name).sort(),
          ['grid-template-rows', 'margin-bottom'],
          `待判断 ${direction} must transition both grid-template-rows and margin-bottom with --dur-base / --ease-standard`,
        );
        await b.evaluate(`(()=>{
          const content=${query(intakeContent)};
          const anims=content.getAnimations({subtree:true}).filter(a=>Number.isFinite(a.effect?.getComputedTiming().duration));
          for(const a of anims)a.pause();
          window.__card39aAnims=anims;
          if(!anims.length)throw Error('missing disclosure collapse animation');
        })()`);
        const heights: number[] = [];
        const nextTops: number[] = [];
        for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
          await b.evaluate(`(async()=>{
            for(const a of window.__card39aAnims)a.currentTime=Number(a.effect.getComputedTiming().duration)*${fraction};
            await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
          })()`);
          const frame = await b.evaluate(`(()=>{
            const box=r=>({left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height});
            const content=${query(intakeContent)},body=${query(intakeBody)},next=${query(dispatchTrigger)};
            const cc=getComputedStyle(content),bc=getComputedStyle(body);
            return {
              contentBox:box(content.getBoundingClientRect()),
              bodyBox:box(body.getBoundingClientRect()),
              nextTop:next.getBoundingClientRect().top,
              viewport:{width:innerWidth,height:innerHeight},
              overflowOk:cc.overflowX==='clip'&&cc.overflowY==='clip'&&bc.overflowX==='hidden'&&bc.overflowY==='hidden',
            };
          })()`) as {contentBox: unknown; bodyBox: unknown; nextTop: number; viewport: {width: number; height: number}; overflowOk: boolean};
          assert.equal(frame.overflowOk, true, direction + ' fraction ' + fraction + ' must keep clip/hidden');
          const cBox = assertFiniteBox(frame.contentBox, direction + ' content ' + fraction);
          const bBox = assertFiniteBox(frame.bodyBox, direction + ' body ' + fraction);
          assert.ok(Number.isFinite(frame.nextTop), 'next group heading top must be finite');
          assert.ok(bBox.top >= cBox.top - 0.5 && bBox.bottom <= cBox.bottom + 0.5, direction + ' fraction ' + fraction + ' body must fit inside content');
          // Sample painted pixels outside the clip bottom edge across the card column width: no card pixel may show.
          await sampleHorizontalStripRgb(b, cBox.bottom + 2, cBox.left + 12, cBox.right - 12, frame.viewport, laneRgb, `group ${direction} f=${fraction} +2px`);
          if (direction === 'collapse' && fraction === 1) {
            await sampleHorizontalStripRgb(b, cBox.bottom + 6, cBox.left + 12, cBox.right - 12, frame.viewport, laneRgb, `group collapse f=1 +6px`);
          }
          heights.push(cBox.height);
          nextTops.push(frame.nextTop);
        }
        await b.evaluate(`(()=>{for(const a of window.__card39aAnims??[])a.finish();delete window.__card39aAnims;})()`);
        await b.command('Animation.setPlaybackRate', {playbackRate: 1});
        await waitForAnimationsSettled(b);
        assert.equal(await b.evaluate(`${query(intakeTrigger)}.getAttribute('aria-expanded')`), expectedEndExpanded);
        for (let i = 1; i < heights.length; i++) {
          const prevH = heights[i - 1], currH = heights[i];
          const prevY = nextTops[i - 1], currY = nextTops[i];
          assert.ok(prevH !== undefined && currH !== undefined && prevY !== undefined && currY !== undefined);
          if (direction === 'collapse') {
            assert.ok(currH <= prevH + 0.5, 'collapse height monotonic: ' + JSON.stringify(heights));
            assert.ok(currY <= prevY + 0.5, 'collapse next heading monotonic: ' + JSON.stringify(nextTops));
          } else {
            assert.ok(currH >= prevH - 0.5, 'expand height monotonic: ' + JSON.stringify(heights));
            assert.ok(currY >= prevY - 0.5, 'expand next heading monotonic: ' + JSON.stringify(nextTops));
          }
        }
        const firstH = heights[0], lastH = heights.at(-1);
        assert.ok(firstH !== undefined && lastH !== undefined);
        if (direction === 'collapse') {
          assert.ok(firstH > 100 && lastH <= 0.5 && firstH - lastH > 100, 'collapse endpoints: ' + JSON.stringify(heights));
        } else {
          assert.ok(firstH <= 0.5 && lastH > 100 && lastH - firstH > 100, 'expand endpoints: ' + JSON.stringify(heights));
        }
      };

      await sampleDisclosure('collapse');
      await sampleDisclosure('expand');

      // Populated remainder (待受理「待接单」) collapse & expand: `board()` leaves remainders expanded.
      const pendingMore = '.board-column.pending [data-action=expand-column]';
      const dispatchRemainder = '.board-column.pending [data-board-group="待接单"] .ds-column-remainder';
      const dispatchRemainderInner = dispatchRemainder + ' > .ds-collapse-inner';
      const remStart = await b.evaluate(`(()=>{
        const box=r=>({left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height});
        const btn=${query(pendingMore)},rem=${query(dispatchRemainder)};
        return {
          ariaExpanded:btn?.getAttribute('aria-expanded')??null,
          dataExpanded:rem?.getAttribute('data-expanded')??null,
          cardCount:rem?rem.querySelectorAll('.ticket-card').length:0,
          box:rem?box(rem.getBoundingClientRect()):null,
        };
      })()`) as {ariaExpanded: string | null; dataExpanded: string | null; cardCount: number; box: unknown};
      assert.equal(remStart.ariaExpanded, 'true', 'board() must start with 待接单 remainder expanded');
      assert.equal(remStart.dataExpanded, 'true');
      assert.ok(remStart.cardCount >= 2, '待接单 remainder must have >= 2 cards, got ' + remStart.cardCount);
      assert.ok(assertFiniteBox(remStart.box, 'remStart').height > 150, 'expanded remainder must have non-trivial height');

      await b.evaluate(`${query(pendingMore)}.scrollIntoView({block:'center',behavior:'instant'})`);
      await waitForAnimationsSettled(b);

      // Collapse remainder (true -> false), coordinating with the real 180ms useExitPresence unmount timer.
      await b.evaluate(`(()=>{
        const orig=window.setTimeout;
        const held=[];
        window.__card39aHeldTimers=[];
        window.__card39aRestoreTimer=()=>{
          window.setTimeout=orig;
          while(held.length){const fn=held.shift();if(typeof fn==='function')fn();}
        };
        window.setTimeout=function(fn,delay,...rest){
          if(delay===180&&typeof fn==='function'){
            window.__card39aHeldTimers.push(delay);
            held.push(fn);
            return 0;
          }
          return orig.call(this,fn,delay,...rest);
        };
      })()`);
      const collapseHeights: number[] = [];
      try {
        await b.command('Animation.setPlaybackRate', {playbackRate: 0});
        await b.evaluate(`${query(pendingMore)}.click()`);
        await b.evaluate(`(async()=>{
          await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
          const node=${query(dispatchRemainder)};
          if(!node)throw Error('remainder collapse missing');
          const anims=node.getAnimations({subtree:true}).filter(a=>Number.isFinite(a.effect?.getComputedTiming().duration));
          for(const a of anims)a.pause();
          window.__card39aRemAnims=anims;
          if(!anims.length)throw Error('missing remainder collapse animation');
        })()`);
        const heldDelays = await b.evaluate('window.__card39aHeldTimers') as number[];
        assert.ok(heldDelays.includes(180), 'remainder collapse must schedule the real 180ms unmount timer: ' + JSON.stringify(heldDelays));

        for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
          await b.evaluate(`(async()=>{
            for(const a of window.__card39aRemAnims)a.currentTime=Number(a.effect.getComputedTiming().duration)*${fraction};
            await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
          })()`);
          const frame = await b.evaluate(`(()=>{
            const box=r=>({left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height});
            const root=${query(dispatchRemainder)},inner=${query(dispatchRemainderInner)};
            const ic=getComputedStyle(inner);
            const firstCard=inner.querySelector('.ticket-card')?.getBoundingClientRect()??null;
            return {
              rootBox:box(root.getBoundingClientRect()),
              innerBox:box(inner.getBoundingClientRect()),
              firstCardBox:firstCard?box(firstCard):null,
              viewport:{width:innerWidth,height:innerHeight},
              overflowOk:ic.overflowX==='hidden'&&ic.overflowY==='hidden',
            };
          })()`) as {rootBox: unknown; innerBox: unknown; firstCardBox: unknown; viewport: {width: number; height: number}; overflowOk: boolean};
          assert.equal(frame.overflowOk, true, 'remainder collapse fraction ' + fraction + ' must keep overflow:hidden');
          const rBox = assertFiniteBox(frame.rootBox, 'remCollapseRoot ' + fraction);
          const iBox = assertFiniteBox(frame.innerBox, 'remCollapseInner ' + fraction);
          assert.ok(iBox.top >= rBox.top - 0.5 && iBox.bottom <= rBox.bottom + 0.5, 'inner must fit inside root at f=' + fraction);
          // Sample painted pixels in the 8px top padding of .ds-column-footer right below innerBox.bottom.
          await sampleHorizontalStripRgb(b, iBox.bottom + 3, iBox.left + 12, iBox.right - 12, frame.viewport, laneRgb, `remainder collapse f=${fraction}`);
          if (fraction === 1) {
            assert.ok(frame.firstCardBox !== null, 'first remainder card must remain mounted before unmount timer fires');
            const fcBox = assertFiniteBox(frame.firstCardBox, 'remCollapseFirstCard');
            assert.ok(fcBox.top >= iBox.bottom - 0.5, 'collapsed remainder must expose 0px of first card: ' + JSON.stringify({fcBox, iBox}));
            assert.ok(rBox.height <= 10.5, 'collapsed remainder grid height must shrink to top padding only: ' + rBox.height);
          }
          collapseHeights.push(rBox.height);
        }
        await b.evaluate(`(()=>{for(const a of window.__card39aRemAnims??[])a.finish();delete window.__card39aRemAnims;})()`);
        await b.command('Animation.setPlaybackRate', {playbackRate: 1});
      } finally {
        await b.evaluate('window.__card39aRestoreTimer?.();delete window.__card39aRestoreTimer;delete window.__card39aHeldTimers;');
      }
      await b.waitFor(`!document.querySelector(${JSON.stringify(dispatchRemainder)})&&${query(pendingMore)}.getAttribute('aria-expanded')==='false'`);
      await waitForAnimationsSettled(b);

      assert.ok((collapseHeights[0] ?? 0) > 150 && (collapseHeights.at(-1) ?? 999) <= 10.5 && (collapseHeights[0] ?? 0) - (collapseHeights.at(-1) ?? 0) > 100,
        'remainder collapse endpoints must show full collapse: ' + JSON.stringify(collapseHeights));
      for (let i = 1; i < collapseHeights.length; i++) {
        assert.ok((collapseHeights[i] ?? 0) <= (collapseHeights[i - 1] ?? 0) + 0.5, 'remainder collapse monotonic');
      }

      // Expand remainder (false -> true).
      await b.evaluate(`${query(pendingMore)}.scrollIntoView({block:'center',behavior:'instant'})`);
      await waitForAnimationsSettled(b);
      await b.command('Animation.setPlaybackRate', {playbackRate: 0});
      await b.evaluate(`${query(pendingMore)}.click()`);
      await b.evaluate(`(async()=>{
        await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        const node=${query(dispatchRemainder)};
        if(!node)throw Error('remainder expand missing');
        const anims=node.getAnimations({subtree:true}).filter(a=>Number.isFinite(a.effect?.getComputedTiming().duration));
        for(const a of anims)a.pause();
        window.__card39aRemAnims=anims;
        if(!anims.length)throw Error('missing remainder expand animation');
      })()`);
      const expandHeights: number[] = [];
      for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
        await b.evaluate(`(async()=>{
          for(const a of window.__card39aRemAnims)a.currentTime=Number(a.effect.getComputedTiming().duration)*${fraction};
          await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        })()`);
        const frame = await b.evaluate(`(()=>{
          const box=r=>({left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height});
          const root=${query(dispatchRemainder)},inner=${query(dispatchRemainderInner)};
          const ic=getComputedStyle(inner);
          return {
            rootBox:box(root.getBoundingClientRect()),
            innerBox:box(inner.getBoundingClientRect()),
            viewport:{width:innerWidth,height:innerHeight},
            overflowOk:ic.overflowX==='hidden'&&ic.overflowY==='hidden',
          };
        })()`) as {rootBox: unknown; innerBox: unknown; viewport: {width: number; height: number}; overflowOk: boolean};
        assert.equal(frame.overflowOk, true, 'remainder expand fraction ' + fraction + ' must keep overflow:hidden');
        const rBox = assertFiniteBox(frame.rootBox, 'remExpandRoot ' + fraction);
        const iBox = assertFiniteBox(frame.innerBox, 'remExpandInner ' + fraction);
        assert.ok(iBox.top >= rBox.top - 0.5 && iBox.bottom <= rBox.bottom + 0.5, 'inner must fit inside root at f=' + fraction);
        await sampleHorizontalStripRgb(b, iBox.bottom + 3, iBox.left + 12, iBox.right - 12, frame.viewport, laneRgb, `remainder expand f=${fraction}`);
        expandHeights.push(rBox.height);
      }
      await b.evaluate(`(()=>{for(const a of window.__card39aRemAnims??[])a.finish();delete window.__card39aRemAnims;})()`);
      await b.command('Animation.setPlaybackRate', {playbackRate: 1});
      await waitForAnimationsSettled(b);

      assert.equal(await b.evaluate(`${query(pendingMore)}.getAttribute('aria-expanded')`), 'true');
      assert.ok((expandHeights[0] ?? 999) <= 10.5 && (expandHeights.at(-1) ?? 0) > 150 && (expandHeights.at(-1) ?? 0) - (expandHeights[0] ?? 0) > 100,
        'remainder expand endpoints must show full expansion: ' + JSON.stringify(expandHeights));
      for (let i = 1; i < expandHeights.length; i++) {
        assert.ok((expandHeights[i] ?? 0) >= (expandHeights[i - 1] ?? 0) - 0.5, 'remainder expand monotonic');
      }
    } finally {
      await b.command('Animation.setPlaybackRate', {playbackRate: 1}).catch(() => {});
    }

    // Scoped E3 exception under reduced motion (36A pattern): both grid-template-rows and margin-bottom transitions are disabled.
    await waitForAnimationsSettled(b);
    await b.command('Emulation.setEmulatedMedia', {features: [{name: 'prefers-reduced-motion', value: 'reduce'}]});
    try {
      await b.waitFor("matchMedia('(prefers-reduced-motion: reduce)').matches && document.documentElement.hasAttribute('data-motion-reduced')");
      const reducedStyle = await b.evaluate(`(()=>{
        const s=getComputedStyle(${query(intakeContent)});
        return {property:s.transitionProperty,duration:s.transitionDuration};
      })()`) as {property: string; duration: string};
      assert.ok(
        reducedStyle.property === 'none' || reducedStyle.duration === '0s',
        'reduced motion must disable transitions on 待判断 content: ' + JSON.stringify(reducedStyle),
      );
      for (const expectedExpanded of ['false', 'true'] as const) {
        await b.evaluate(`${query(intakeTrigger)}.click()`);
        await b.waitFor(`${query(intakeTrigger)}.getAttribute('aria-expanded')===${JSON.stringify(expectedExpanded)}`);
        await b.evaluate('new Promise(resolve=>requestAnimationFrame(resolve))');
        const activeTransitions = await b.evaluate(
          `${query(intakeContent)}.getAnimations().map(a=>a.transitionProperty??a.animationName??'WAAPI')`,
        );
        assert.deepEqual(
          activeTransitions,
          [],
          `reduced motion 待判断 (${expectedExpanded}) must not animate grid-template-rows or margin-bottom`,
        );
        await assertNoTransformAnimations(b, intakeGroup);
      }
    } finally {
      await b.command('Emulation.setEmulatedMedia', {features: [{name: 'prefers-reduced-motion', value: 'no-preference'}]});
      await b.waitFor("!matchMedia('(prefers-reduced-motion: reduce)').matches && !document.documentElement.hasAttribute('data-motion-reduced')");
    }
  }, {keyboard: true}));

// This test deliberately avoids referencing 39A-only tokens so the host can also run it on clean main (`8f86d51e`)
// with CARD39A_GEOMETRY_OUT=docs/ui/evidence/v231-card39/main-geometry.json to capture the baseline reference.
test('39A A3 geometry', suite, () =>
  withScene(async s => {
    const {b} = s;
    await prepareBoardFixture(s);
    await board(s, 'board');
    await b.evaluate(`[...document.querySelectorAll('[data-action=expand-column][aria-expanded=false]')].filter(n=>n.checkVisibility()).forEach(n=>n.click())`);
    await waitForAnimationsSettled(b);

    const expandedMeasurements = await b.evaluate(`(()=>{
      const pair=el=>{const r=el.getBoundingClientRect();return {x:r.left,width:r.width};};
      const measure=(selector)=>{
        const cards=[...document.querySelectorAll(selector)].filter(n=>n.checkVisibility());
        if(cards.length<2)throw Error('expected >= 2 cards for '+selector+', got '+cards.length);
        return {count:cards.length,first:pair(cards[0]),last:pair(cards.at(-1))};
      };
      const colInfo=(name)=>{
        const col=document.querySelector('.ds-board-column.'+name);
        if(!col)throw Error('missing column '+name);
        const r=col.getBoundingClientRect(),css=getComputedStyle(col);
        return {contentLeft:r.left+parseFloat(css.paddingLeft),contentWidth:r.width-parseFloat(css.paddingLeft)-parseFloat(css.paddingRight)};
      };
      const nextTrigger=document.querySelector('.board-column.pending [data-board-group="待接单"] .ds-board-group-trigger');
      if(!nextTrigger)throw Error('missing 待接单 trigger');
      return {
        viewport:{width:innerWidth,height:innerHeight},
        columns:{pending:colInfo('pending'),active:colInfo('active'),handled:colInfo('handled')},
        groups:{
          intake:measure('.board-column.pending [data-board-group="待判断"] .ticket-card'),
          dispatch:measure('.board-column.pending [data-board-group="待接单"] .ticket-card'),
          active:measure('.board-column.active .ticket-card'),
          done:measure('.board-column.handled [data-board-group="已完成"] .ticket-card'),
        },
        remainders:{
          dispatch:measure('.board-column.pending [data-board-group="待接单"] .ds-column-remainder .ticket-card'),
          active:measure('.board-column.active .ds-column-remainder .ticket-card'),
          done:measure('.board-column.handled [data-board-group="已完成"] .ds-column-remainder .ticket-card'),
        },
        nextGroupHeadingYExpanded:nextTrigger.getBoundingClientRect().top,
      };
    })()`) as Omit<BoardGeometrySnapshot, 'nextGroupHeadingY'> & {nextGroupHeadingYExpanded: number};

    const intakeTrigger = '.board-column.pending [data-board-group="待判断"] .ds-board-group-trigger';
    const dispatchTrigger = '.board-column.pending [data-board-group="待接单"] .ds-board-group-trigger';
    assert.equal(await b.evaluate(`${query(intakeTrigger)}.getAttribute('aria-expanded')`), 'true');
    await b.evaluate(`${query(intakeTrigger)}.click()`);
    await waitForAnimationsSettled(b);
    assert.equal(await b.evaluate(`${query(intakeTrigger)}.getAttribute('aria-expanded')`), 'false');
    const nextGroupHeadingYCollapsed = await b.evaluate(`${query(dispatchTrigger)}.getBoundingClientRect().top`) as number;
    assert.ok(Number.isFinite(nextGroupHeadingYCollapsed));
    assert.ok(nextGroupHeadingYCollapsed < expandedMeasurements.nextGroupHeadingYExpanded,
      'collapsing 待判断 must move 待接单 heading upward');

    const measured: BoardGeometrySnapshot = {
      viewport: expandedMeasurements.viewport,
      columns: expandedMeasurements.columns,
      groups: expandedMeasurements.groups,
      remainders: expandedMeasurements.remainders,
      nextGroupHeadingY: {
        expanded: expandedMeasurements.nextGroupHeadingYExpanded,
        collapsed: nextGroupHeadingYCollapsed,
      },
    };

    const checkPair = (pair: GeometryPair, col: ColumnGeometry, name: string) => {
      assert.ok(Number.isFinite(pair.x) && Number.isFinite(pair.width), name + ' must be finite');
      assert.ok(Math.abs(pair.x - col.contentLeft) <= 0.01, `${name} x=${pair.x} must equal column contentLeft=${col.contentLeft}`);
      assert.ok(Math.abs(pair.width - col.contentWidth) <= 0.01, `${name} width=${pair.width} must equal column contentWidth=${col.contentWidth}`);
    };
    checkPair(measured.groups.intake.first, measured.columns.pending, 'groups.intake.first');
    checkPair(measured.groups.intake.last, measured.columns.pending, 'groups.intake.last');
    checkPair(measured.groups.dispatch.first, measured.columns.pending, 'groups.dispatch.first');
    checkPair(measured.groups.dispatch.last, measured.columns.pending, 'groups.dispatch.last');
    checkPair(measured.groups.active.first, measured.columns.active, 'groups.active.first');
    checkPair(measured.groups.active.last, measured.columns.active, 'groups.active.last');
    checkPair(measured.groups.done.first, measured.columns.handled, 'groups.done.first');
    checkPair(measured.groups.done.last, measured.columns.handled, 'groups.done.last');
    checkPair(measured.remainders.dispatch.first, measured.columns.pending, 'remainders.dispatch.first');
    checkPair(measured.remainders.dispatch.last, measured.columns.pending, 'remainders.dispatch.last');
    checkPair(measured.remainders.active.first, measured.columns.active, 'remainders.active.first');
    checkPair(measured.remainders.active.last, measured.columns.active, 'remainders.active.last');
    checkPair(measured.remainders.done.first, measured.columns.handled, 'remainders.done.first');
    checkPair(measured.remainders.done.last, measured.columns.handled, 'remainders.done.last');

    const outEnv = process.env.CARD39A_GEOMETRY_OUT;
    if (outEnv) {
      const outPath = isAbsolute(outEnv) ? outEnv : join(root, outEnv);
      await mkdir(dirname(outPath), {recursive: true});
      await writeFile(outPath, JSON.stringify(measured, null, 2) + '\n');
      return;
    }

    const baselinePath = join(root, 'docs/ui/evidence/v231-card39/main-geometry.json');
    assert.equal(
      existsSync(baselinePath),
      true,
      `Missing ${baselinePath}. Generate it on clean main (8f86d51e) with CARD39A_GEOMETRY_OUT=${baselinePath} and --test-name-pattern='39A A3 geometry'.`,
    );
    const baseline = JSON.parse(await readFile(baselinePath, 'utf8')) as BoardGeometrySnapshot;
    assert.deepEqual(measured.viewport, baseline.viewport, 'viewport must match main baseline');
    assert.deepEqual(measured.columns, baseline.columns, 'column content boxes must match main baseline (deviation 0)');
    for (const key of ['intake', 'dispatch', 'active', 'done'] as const) {
      assert.equal(measured.groups[key].first.x, baseline.groups[key].first.x, `groups.${key}.first.x vs main`);
      assert.equal(measured.groups[key].first.width, baseline.groups[key].first.width, `groups.${key}.first.width vs main`);
      assert.equal(measured.groups[key].last.x, baseline.groups[key].last.x, `groups.${key}.last.x vs main`);
      assert.equal(measured.groups[key].last.width, baseline.groups[key].last.width, `groups.${key}.last.width vs main`);
    }
    for (const key of ['dispatch', 'active', 'done'] as const) {
      assert.equal(measured.remainders[key].first.x, baseline.remainders[key].first.x, `remainders.${key}.first.x vs main`);
      assert.equal(measured.remainders[key].first.width, baseline.remainders[key].first.width, `remainders.${key}.first.width vs main`);
      assert.equal(measured.remainders[key].last.x, baseline.remainders[key].last.x, `remainders.${key}.last.x vs main`);
      assert.equal(measured.remainders[key].last.width, baseline.remainders[key].last.width, `remainders.${key}.last.width vs main`);
    }
    assert.equal(measured.nextGroupHeadingY.expanded, baseline.nextGroupHeadingY.expanded, 'expanded 待接单 heading y must equal main');
    assert.equal(measured.nextGroupHeadingY.collapsed, baseline.nextGroupHeadingY.collapsed, 'collapsed 待接单 heading y must equal main');
  }, {keyboard: true}));
