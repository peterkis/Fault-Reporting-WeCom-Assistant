import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const candidates = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

export function findSystemBrowser() {
  const executable = candidates.find(existsSync);
  if (!executable) throw new Error('P2_006_SYSTEM_EDGE_OR_CHROME_REQUIRED');
  return executable;
}

function delay(milliseconds) { return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds)); }

async function waitFor(fn, { timeoutMs = 30_000, intervalMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try { const value = await fn(); if (value) return value; } catch (error) { lastError = error; }
    await delay(intervalMs);
  }
  throw lastError ?? new Error('P2_006_BROWSER_WAIT_TIMEOUT');
}

export async function launchSystemBrowser({ url, width, height }) {
  const executable = findSystemBrowser();
  const profile = await mkdtemp(join(tmpdir(), 'p2-006-browser-'));
  const child = spawn(executable, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run',
    '--disable-default-apps', '--disable-extensions', '--disable-gpu', '--disable-background-networking',
    `--window-size=${width},${height}`, url,
  ], { stdio: 'ignore', windowsHide: true });
  const activePortPath = join(profile, 'DevToolsActivePort');
  const active = await waitFor(async () => {
    if (!existsSync(activePortPath)) return null;
    const [portText] = (await readFile(activePortPath, 'utf8')).trim().split(/\r?\n/u);
    return /^[0-9]+$/u.test(portText) ? Number(portText) : null;
  });
  const targets = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${active}/json/list`);
    const values = await response.json();
    return values.find((value) => value.type === 'page' && value.webSocketDebuggerUrl) ?? null;
  });
  const socket = new WebSocket(targets.webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => { socket.addEventListener('open', resolveOpen, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const request = pending.get(message.id); pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
  });
  function command(method, params = {}) {
    const id = ++sequence;
    return new Promise((resolveCommand, reject) => {
      pending.set(id, { resolve: resolveCommand, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  await command('Runtime.enable');
  await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
  async function evaluate(expression, { awaitPromise = true } = {}) {
    const result = await command('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? 'P2_006_BROWSER_EVALUATION_FAILED');
    return result.result.value;
  }
  async function pressTab() {
    await command('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
  }
  async function close() {
    await command('Browser.close').catch(() => {});
    if (socket.readyState !== WebSocket.CLOSED) {
      await Promise.race([
        new Promise((resolveClose) => socket.addEventListener('close', resolveClose, { once: true })),
        delay(2_000),
      ]);
    }
    child.kill('SIGKILL');
    await new Promise((resolveExit) => { if (child.exitCode !== null) resolveExit(); else { child.once('exit', resolveExit); setTimeout(resolveExit, 2_000).unref?.(); } });
    const resolvedProfile = resolve(profile); const resolvedTemp = resolve(tmpdir());
    assert.ok(resolvedProfile.startsWith(`${resolvedTemp}\\`) && resolvedProfile.includes('p2-006-browser-'));
    await waitFor(async () => {
      try { await rm(resolvedProfile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); return true; }
      catch (error) { if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error?.code)) throw error; return false; }
    }, { timeoutMs: 8_000, intervalMs: 100 });
  }
  return Object.freeze({ executable, evaluate, pressTab, waitFor: (expression, options) => waitFor(async () => evaluate(expression), options), close });
}
