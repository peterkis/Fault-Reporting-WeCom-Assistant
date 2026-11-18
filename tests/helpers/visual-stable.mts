import { waitForAnimationsSettled } from './browser-animations.mjs';
import type { Viewport, Mask } from '../../tools/visual-regression/model.mjs';

interface Browser {
  command(method: string, params?: Record<string, unknown>): Promise<unknown>;
  evaluate(expression: string): Promise<unknown>;
}

export const VISUAL_VIEWPORT: Viewport = Object.freeze({ width: 1440, height: 1000, dpr: 1 });

// Constructed in the browser's local timezone, before the application evaluates.
export const VISUAL_CLOCK_SCRIPT = `(() => {
  const RealDate = Date;
  const fixed = new RealDate(2026, 10, 13, 10, 0, 0, 0).getTime();
  const FrozenDate = new Proxy(RealDate, {
    construct(target, args, newTarget) {
      return Reflect.construct(target, args.length ? args : [fixed], newTarget);
    },
    apply() {
      return new RealDate(fixed).toString();
    },
    get(target, key, receiver) {
      return key === 'now' ? () => fixed : Reflect.get(target, key, receiver);
    },
  });
  globalThis.Date = FrozenDate;
  const css =
    '*,*::before,*::after{' +
    'animation:none!important;transition:none!important;caret-color:transparent!important}';
  const install = () => {
    if (!document.documentElement) return;
    const style = document.createElement('style');
    style.dataset.visualStable = '';
    style.textContent = css;
    document.documentElement.append(style);
  };
  if (document.documentElement) {
    install();
  } else {
    new MutationObserver((_, observer) => {
      if (document.documentElement) {
        install();
        observer.disconnect();
      }
    }).observe(document, { childList: true, subtree: true });
  }
})();`;

export async function installVisualStability(browser: Browser, viewport: Viewport): Promise<void> {
  await browser.command('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.dpr,
    mobile: false,
  });
  await browser.command('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  await browser.command('Page.addScriptToEvaluateOnNewDocument', { source: VISUAL_CLOCK_SCRIPT });
}

const TWO_FRAMES = `new Promise(resolve => {
  requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
})`;

export async function settleVisual(browser: Browser, masks: readonly Mask[]): Promise<void> {
  await browser.evaluate(`(async () => {
  const end = performance.now() + 5000;
  for (;;) {
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    if (!window.__visualPending) return true;
    if (performance.now() > end) throw Error('Visual requests did not settle');
  }
})();`);
  await browser.evaluate(`(async () => {
  await document.fonts.ready;
  const requests = new Map();
  const add = (node, text) => {
    if (!node?.checkVisibility() || !text.trim()) return;
    const style = getComputedStyle(node);
    const font =
      style.fontStyle + ' ' + style.fontWeight + ' ' + style.fontSize + ' ' + style.fontFamily;
    requests.set(font, (requests.get(font) ?? '') + ' ' + text);
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    add(node.parentElement, node.textContent ?? '');
  }
  for (const node of document.querySelectorAll('input,textarea')) {
    add(node, (node.value ?? '') + ' ' + (node.placeholder ?? ''));
  }
  await Promise.all([...requests].map(([font, text]) => document.fonts.load(font, text)));
  await document.fonts.ready;
  await Promise.all([...document.images].map((image) => image.decode()));
  return true;
})();`);
  await browser.evaluate(`(async () => {
  const end = performance.now() + 5000;
  while (document.querySelector('[data-entering],[data-exiting]')) {
    if (performance.now() > end) throw Error('Visual entering/exiting state did not settle');
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
})();`);
  await waitForAnimationsSettled(browser);

  // HeroUI's layered !important hints beat an unlayered universal rule. Remove the
  // now-unused hints inline, after its disclosure/drawer lifecycle has settled.
  // Preserve hints that establish fixed containing blocks (notably drawer translate).
  // The sort trigger's scale(1) also creates a text rasterization boundary at a
  // fractional grid position. Replacing only this identity matrix preserves its
  // geometry, font and text while making the raster path consistent.
  await browser.evaluate(`(() => {
  const watched = [
    ...document.querySelectorAll(
      '.ds-column-sort,.ds-drawer,.workbench-toast-viewport,.workbench-toast',
    ),
  ];
  const bounds = (node) => {
    const rect = node.getBoundingClientRect();
    return [rect.x, rect.y, rect.width, rect.height];
  };
  const before = watched.map(bounds);
  for (const node of document.querySelectorAll('*')) {
    const hint = getComputedStyle(node).willChange;
    if (
      hint !== 'auto' &&
      !/transform|translate|scale|rotate|perspective|filter|contain/.test(hint)
    ) {
      node.style.setProperty('will-change', 'auto', 'important');
    }
  }
  for (const node of document.querySelectorAll('.ds-column-sort')) {
    if (getComputedStyle(node).transform === 'matrix(1, 0, 0, 1, 0, 0)') {
      node.style.setProperty('transform', 'none', 'important');
    }
  }
  watched.forEach((node, index) => {
    if (JSON.stringify(bounds(node)) !== JSON.stringify(before[index])) {
      throw Error('Visual stabilization changed control, drawer or toast geometry');
    }
  });
})();`);
  await browser.evaluate(TWO_FRAMES);
  await browser.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await browser.evaluate(TWO_FRAMES);

  // Masks remain available for genuinely unfixed small regions. The initial
  // eighteen screens deliberately use none; scrims and backgrounds are compared.
  await browser.evaluate(`(() => {
  document.querySelectorAll('[data-visual-mask]').forEach((node) => node.remove());
  for (const { selector } of ${JSON.stringify(masks)}) {
    const nodes = [...document.querySelectorAll(selector)];
    if (!nodes.length) throw Error('Mask selector has no match: ' + selector);
    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      const cover = document.createElement('div');
      cover.dataset.visualMask = '';
      Object.assign(cover.style, {
        position: 'fixed',
        left: rect.left + 'px',
        top: rect.top + 'px',
        width: rect.width + 'px',
        height: rect.height + 'px',
        background: 'var(--bg-muted)',
        zIndex: '2147483647',
        pointerEvents: 'none',
      });
      document.body.append(cover);
    }
  }
})();`);
  await browser.evaluate(TWO_FRAMES);
}
