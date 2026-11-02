import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {transpileModule, ModuleKind, ScriptTarget} from 'typescript';
import {CircleHelp, Monitor, Printer, ScanLine} from 'lucide-react';

const root = process.env.TS_MIGRATION_TEST_SOURCE_ROOT ?? process.cwd();
// Like the H5 pure-module tests, execute the actual browser source without importing its DOM application.
async function designModule(name: string): Promise<string> {
  const source = await readFile(resolve(root, 'app/pc-admin/src/design', name + '.ts'), 'utf8');
  const output = transpileModule(source, {compilerOptions: {module: ModuleKind.ESNext, target: ScriptTarget.ES2022, verbatimModuleSyntax: true}}).outputText;
  return 'data:text/javascript;base64,' + Buffer.from(output.replaceAll("'lucide-react'", JSON.stringify(import.meta.resolve('lucide-react')))).toString('base64');
}
interface Heat {tone: string; label: string; ring: string | null}
const {heatOf, HEAT_THRESHOLDS_MINUTES}: {
  heatOf: (startIso: string | null | undefined, nowMs: number) => Heat | null;
  HEAT_THRESHOLDS_MINUTES: readonly number[];
} = await import(await designModule('heat'));
interface Category {label: string; bg: string; fg: string; icon: unknown; border: string | null}
const {categoryOf, categoryMap, unclassifiedCategory}: {
  categoryOf: (domainCode: string | null | undefined, serviceCode?: string | null) => Category;
  categoryMap: Readonly<Record<string, Category>>;
  unclassifiedCategory: Category;
} = await import(await designModule('category-map'));

const now = Date.parse('2026-11-02T10:00:00+08:00');
test('heat thresholds are the frozen shared minute tuple', () => {
  assert.deepEqual(HEAT_THRESHOLDS_MINUTES, [5, 20, 60, 240]);
  assert.ok(Object.isFrozen(HEAT_THRESHOLDS_MINUTES));
});
const boundaries: readonly (readonly [string, number, Heat | null])[] = [
  ['4:59', 299, null],
  ['5:00', 300, {tone: 'neutral', label: '5 分钟', ring: null}],
  ['19:59', 1199, {tone: 'neutral', label: '19 分钟', ring: null}],
  ['20:00', 1200, {tone: 'warning', label: '20 分钟', ring: null}],
  ['59:59', 3599, {tone: 'warning', label: '59 分钟', ring: null}],
  ['60:00', 3600, {tone: 'attention', label: '1 小时', ring: 'attention'}],
  ['239:59', 14399, {tone: 'attention', label: '3 小时', ring: 'attention'}],
  ['240:00', 14400, {tone: 'danger', label: '超时 4 小时', ring: 'danger'}],
];
for (const [boundary, seconds, expected] of boundaries) test('heat boundary ' + boundary, () => {
  const start = new Date(now - seconds * 1000).toISOString();
  assert.deepEqual(heatOf(start, now), expected);
});
test('heat floors units, uses the supplied clock, and respects explicit zones', () => {
  assert.deepEqual(heatOf('2026-11-02T08:00:01+08:00', now), {tone: 'attention', label: '1 小时', ring: 'attention'});
  assert.deepEqual(heatOf('2026-11-02T01:55:00Z', now), heatOf('2026-11-02T09:55:00+08:00', now));
  assert.deepEqual(heatOf('2026-11-01T01:00:00Z', now), {tone: 'danger', label: '超时 25 小时', ring: 'danger'});
  assert.equal(heatOf('2026-11-02T02:00:00Z', now), null);
  assert.deepEqual(heatOf('2026-11-02T02:00:00Z', now + 300_000), {tone: 'neutral', label: '5 分钟', ring: null});
});
test('missing, invalid, unzoned and future inputs never invent an overdue label', () => {
  for (const start of [null, undefined, '', 'invalid', '2026-13-02T00:00:00Z', '2026-02-30T00:00:00Z', '2025-02-29T12:00:00+08:00', '2026-11-02', '2026-11-02T01:00:00', '2026-11-02T02:00:01Z']) assert.equal(heatOf(start, now), null);
  for (const clock of [NaN, Infinity, -Infinity]) assert.equal(heatOf('2026-11-01T02:00:00Z', clock), null);
});
test('the visual map covers exactly the existing ServiceCatalog domains', async () => {
  const catalog: {domains: {domain_code: string; services: {service_code: string}[]}[]} = JSON.parse(await readFile(resolve(root, 'config_examples/p2-007-service-catalog.example.json'), 'utf8'));
  assert.equal(catalog.domains.length, 11);
  assert.deepEqual(Object.keys(categoryMap).sort(), catalog.domains.map(domain => domain.domain_code).sort());
  for (const domain of catalog.domains) {
    const category = categoryOf(domain.domain_code);
    assert.ok(category.label);
    assert.equal(category.border, null);
    assert.match(category.bg, /^var\(--cat-[a-z]+-bg\)$/u);
    assert.match(category.fg, /^var\(--cat-[a-z]+-fg\)$/u);
    for (const service of domain.services) assert.equal(categoryOf(domain.domain_code, service.service_code).bg, category.bg);
  }
});
test('printer services keep their category color, and mismatched or unknown services use the domain icon', () => {
  for (const code of ['PRINT.PRINTER_DEVICE', 'PRINT.PRINT_RENDERING']) {
    assert.equal(categoryOf('ENDPOINT_PRINT', code).icon, Printer);
    assert.equal(categoryOf('ENDPOINT_PRINT', code).bg, categoryOf('ENDPOINT_PRINT').bg);
  }
  assert.equal(categoryOf('DIAGNOSTIC', 'DIAG.LAB_RESULT_PRINT').icon, Printer);
  assert.equal(categoryOf('ENDPOINT_PRINT', 'ENDPOINT.COMPUTER').icon, Monitor);
  assert.equal(categoryOf('ENDPOINT_PRINT', 'UNKNOWN').icon, Monitor);
  assert.equal(categoryOf('DIAGNOSTIC', 'PRINT.PRINTER_DEVICE').icon, ScanLine);
  assert.equal(categoryOf('ENDPOINT_PRINT', 'toString').icon, Monitor);
});
test('unknown domains always use the neutral circle-help fallback', () => {
  for (const code of [null, undefined, '', 'UNKNOWN', 'toString', '__proto__']) {
    const category = categoryOf(code, 'PRINT.PRINTER_DEVICE');
    assert.deepEqual(category, unclassifiedCategory);
    assert.equal(category.icon, CircleHelp);
    assert.equal(category.border, 'var(--cat-unclassified-border)');
  }
});
test('solid badges meet white-text AA and every category meets its specified contrast', async () => {
  const css = await readFile(resolve(root, 'app/pc-admin/src/design/tokens.css'), 'utf8');
  const tokens = new Map([...css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/gu)].map(match => [match[1], match[2]?.trim()]));
  function color(name: string, seen = new Set<string>()): string {
    assert.ok(!seen.has(name), 'token cycle: ' + name); seen.add(name);
    const value = tokens.get(name); assert.ok(value, 'missing token: ' + name);
    const reference = /^var\((--[\w-]+)\)$/u.exec(value);
    if (reference?.[1]) return color(reference[1], seen);
    assert.match(value, /^#[\da-f]{6}$/iu); return value;
  }
  function luminance(hex: string): number {
    const channels = [1, 3, 5].map(index => {
      const value = parseInt(hex.slice(index, index + 2), 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return (channels[0] ?? 0) * 0.2126 + (channels[1] ?? 0) * 0.7152 + (channels[2] ?? 0) * 0.0722;
  }
  const contrast = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
  for (const tone of ['neutral', 'brand', 'info', 'success', 'warning', 'attention', 'danger', 'review']) {
    assert.equal(color('--tone-' + tone + '-solid'), color('--tone-' + tone + '-fg'));
    assert.ok(contrast(color('--tone-' + tone + '-solid'), color('--text-inverse')) >= 4.5, tone);
  }
  for (const category of [...Object.values(categoryMap), unclassifiedCategory]) {
    const bg = category.bg.slice(4, -1), fg = category.fg.slice(4, -1);
    assert.ok(contrast(color(bg), color(fg)) >= 4.5, category.label);
  }
});
