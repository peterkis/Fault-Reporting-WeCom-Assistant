
import type { ServerResponse } from 'node:http';

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../web/p2-workbench/', import.meta.url));
const ASSETS: Readonly<Record<string, Readonly<{ file: string; type: string }>>> = Object.freeze({
  '/workbench': Object.freeze({ file: 'index.html', type: 'text/html; charset=utf-8' }),
  '/workbench/': Object.freeze({ file: 'index.html', type: 'text/html; charset=utf-8' }),
  '/static/workbench/workbench.css': Object.freeze({ file: 'workbench.css', type: 'text/css; charset=utf-8' }),
  '/static/workbench/workbench.js': Object.freeze({ file: 'workbench.js', type: 'text/javascript; charset=utf-8' }),
  '/static/workbench/workbench-state.mjs': Object.freeze({ file: 'workbench-state.mjs', type: 'text/javascript; charset=utf-8' }),
  '/static/workbench/time-display.mjs': Object.freeze({ file: 'time-display.mjs', type: 'text/javascript; charset=utf-8' }),
});

export function createWorkbenchStaticHandler({ enabled = false, root = ROOT }: { enabled?: boolean; root?: string } = {}) {
  if (typeof enabled !== 'boolean') throw new TypeError('Static handler configuration is invalid.');
  const resolvedRoot = path.resolve(root);
  return async function serve(pathname: string, response: ServerResponse) {
    const asset = ASSETS[pathname];
    if (!asset) return false;
    if (!enabled) {
      response.writeHead(503, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>工作台未启用</title><main><h1>工作台未启用</h1><p>Human-only Workbench 当前保持关闭。</p></main></html>');
      return true;
    }
    const target = path.resolve(resolvedRoot, asset.file);
    if (!target.startsWith(`${resolvedRoot}${path.sep}`)) return false;
    const body = await readFile(target);
    response.writeHead(200, { 'content-type': asset.type, 'cache-control': asset.file === 'index.html' ? 'no-store' : 'private, max-age=300' });
    response.end(body);
    return true;
  };
}
