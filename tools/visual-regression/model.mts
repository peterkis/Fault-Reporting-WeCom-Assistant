import path from 'node:path';
// Product-owner decision 2026-11-18: any pixelmatch-classified changed pixel.
// The card's original whole-screen ratio > 0.1% is superseded.
export const DEFAULT_THRESHOLD = Object.freeze({ pixelmatch: 0.1, ratio: 0 });
export interface Viewport {
  width: number;
  height: number;
  dpr: number;
}
export interface Mask {
  selector: string;
  reason: string;
}
export interface Threshold {
  pixelmatch: number;
  ratio: number;
  reason?: string;
}
export interface Screen {
  name: string;
  route: string;
  prepare: readonly string[];
  viewport: Viewport;
  mask: readonly Mask[];
  threshold: Threshold;
}
export function platformName(os: string, browser: string): string {
  if (
    !['darwin', 'win32', 'linux', 'freebsd', 'openbsd', 'aix', 'sunos'].includes(os) ||
    !['chrome', 'edge', 'chromium'].includes(browser)
  )
    throw Error('Unsupported OS/browser');
  return os + '-' + browser;
}
export function browserName(executable: string): string {
  const name = path.basename(executable).toLowerCase();
  return name.includes('edge') ? 'edge' : name.includes('chromium') ? 'chromium' : 'chrome';
}
/** Alternate capture outputs are temporary artifacts, never an approval destination. */
export function transientCurrentRoot(root: string, value: string): string {
  const directory = path.resolve(value);
  const relative = path.relative(path.join(root, '.build/visual'), directory);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw Error(
      'Alternate current directory must be inside .build/visual; approval uses its own command',
    );
  }
  return directory;
}
export function overThreshold(diff: number, total: number, limit: number): boolean {
  if (
    !Number.isSafeInteger(diff) ||
    !Number.isSafeInteger(total) ||
    diff < 0 ||
    total <= 0 ||
    diff > total ||
    !Number.isFinite(limit) ||
    limit < 0 ||
    limit > 1
  )
    throw Error('Invalid pixel count/threshold');
  return diff / total > limit;
}
export function validateManifest(screens: readonly Screen[]): void {
  if (!screens.length) throw Error('Empty visual manifest');
  const names = new Set<string>();
  for (const s of screens) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(s.name) || names.has(s.name))
      throw Error('Invalid/duplicate screen name: ' + s.name);
    names.add(s.name);
    if (
      !s.route.startsWith('/workbench/app/') ||
      !s.prepare.length ||
      s.prepare.some((step) => !step.trim())
    )
      throw Error('Route/preparation required: ' + s.name);
    if (
      ![s.viewport.width, s.viewport.height].every((n) => Number.isSafeInteger(n) && n > 0) ||
      !Number.isFinite(s.viewport.dpr) ||
      s.viewport.dpr <= 0
    )
      throw Error('Invalid viewport: ' + s.name);
    const t = s.threshold;
    if (![t.pixelmatch, t.ratio].every((n) => Number.isFinite(n) && n >= 0 && n <= 1))
      throw Error('Invalid threshold: ' + s.name);
    // Zero is the owner-approved default, not a missing value. Any differing
    // ratio (including the former 0.001 default) or color threshold needs a reason.
    if (
      (t.pixelmatch !== DEFAULT_THRESHOLD.pixelmatch || t.ratio !== DEFAULT_THRESHOLD.ratio) &&
      !t.reason?.trim()
    )
      throw Error('Threshold override requires reason: ' + s.name);
    for (const m of s.mask)
      if (!m.selector.trim() || !m.reason.trim())
        throw Error('Mask requires selector and reason: ' + s.name);
  }
}
/** Deliberately fail closed. No CLI switch or environment variable bypasses this guard. */
export function assertHumanApproval(tty: boolean | undefined, env: NodeJS.ProcessEnv): void {
  if (!tty)
    throw Error(
      'Approval refused: stdin must be an interactive TTY. A person must review the images and confirm.',
    );
  const markers =
    /^(?:CODEX(?:_|$)|OPENAI_AGENT(?:_|$)|CLAUDE(?:CODE|_|$)|CURSOR(?:_|$)|COPILOT(?:_|$)|AIDER(?:_|$)|AGENT(?:_|$)|CI$|GITHUB_ACTIONS$|CHATGPT(?:_|$))/iu;
  if (Object.keys(env).some((key) => markers.test(key)))
    throw Error(
      'Approval refused: agent/automation environment detected. Run manually outside the agent.',
    );
}
export interface CaptureMeta {
  schema_version: 1;
  platform: string;
  os_version: string;
  browser_version: string;
  dpr: number;
  viewports: Record<string, Viewport>;
  source_head: string;
  input_hash: string;
  captured_at: string;
  screens: Record<string, string>;
}
