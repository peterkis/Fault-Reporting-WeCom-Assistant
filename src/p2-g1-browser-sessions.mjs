import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

const BROWSER_CANDIDATES = Object.freeze([
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
]);

const SAFE_REALTIME_EVENT_TYPES = Object.freeze([
  'conversation.session.created', 'conversation.session.updated', 'conversation.item.created',
  'conversation.timeline.rebuilt', 'conversation.mode.changed', 'conversation.assigned',
  'conversation.handoff.requested', 'conversation.handoff.accepted', 'conversation.read_cursor.changed',
  'communication.delivery.changed', 'ticket.updated', 'incident.updated', 'gateway.connection.changed',
]);
const SAFE_FETCH_CATEGORIES = Object.freeze(['LIST', 'DETAIL', 'TIMELINE']);

const SAFE_TELEMETRY_SOURCE = `(() => {
  const maximumEntries = 1000;
  const state = { sse: [], fetch: [] };
  const safeEventTypes = new Set(${JSON.stringify(SAFE_REALTIME_EVENT_TYPES)});
  Object.defineProperty(window, '__p2g1SafeTelemetry', { value: state, enumerable: false });
  const append = (values, value) => { values.push(value); if (values.length > maximumEntries) values.shift(); };
  const category = (input) => {
    try {
      const path = new URL(typeof input === 'string' ? input : input.url, location.origin).pathname;
      if (path === '/api/conversations') return 'LIST';
      if (/^\\/api\\/conversations\\/[^/]+$/u.test(path)) return 'DETAIL';
      if (/^\\/api\\/conversations\\/[^/]+\\/items$/u.test(path)) return 'TIMELINE';
    } catch {}
    return null;
  };
  const nativeFetch = window.fetch;
  window.fetch = async function safeTimedFetch(input, init) {
    const requestCategory = category(input);
    if (!requestCategory) return nativeFetch.call(this, input, init);
    const startMs = Date.now();
    try {
      const response = await nativeFetch.call(this, input, init);
      append(state.fetch, { category: requestCategory, start_ms: startMs, end_ms: Date.now(), status: response.status });
      return response;
    } catch (error) {
      append(state.fetch, { category: requestCategory, start_ms: startMs, end_ms: Date.now(), status: 0 });
      throw error;
    }
  };
  const nativeAddEventListener = EventSource.prototype.addEventListener;
  EventSource.prototype.addEventListener = function safeTimedEventListener(type, listener, options) {
    if (typeof listener !== 'function' || !safeEventTypes.has(type)) return nativeAddEventListener.call(this, type, listener, options);
    return nativeAddEventListener.call(this, type, function safeRealtimeListener(event) {
      append(state.sse, { event_type: String(type), received_ms: Date.now() });
      return listener.call(this, event);
    }, options);
  };
})();`;

function delay(milliseconds) { return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds)); }

async function waitFor(operation, { timeoutMs = 30_000, intervalMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const value = await operation(); if (value) return value; }
    catch { /* local browser startup remains pending without exposing details */ }
    await delay(intervalMs);
  }
  throw new Error('P2_G1_TEST_BROWSER_START_TIMEOUT');
}

function browserExecutable() {
  const executable = BROWSER_CANDIDATES.find(existsSync);
  if (!executable) throw new Error('P2_G1_TEST_BROWSER_REQUIRED');
  return executable;
}

async function removeProfile(profile) {
  const resolvedProfile = resolve(profile);
  const resolvedTemp = resolve(tmpdir());
  if (!resolvedProfile.startsWith(`${resolvedTemp}${sep}`) || !resolvedProfile.includes('p2-g1-live-browser-')) {
    throw new Error('P2_G1_TEST_BROWSER_PROFILE_INVALID');
  }
  await waitFor(async () => {
    try { await rm(resolvedProfile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); return true; }
    catch (error) { if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error?.code)) throw error; return false; }
  }, { timeoutMs: 8_000, intervalMs: 100 });
}

async function cleanupStaleProfiles() {
  const root = resolve(tmpdir());
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('p2-g1-live-browser-')) continue;
    const profile = join(root, entry.name);
    let active = false;
    try {
      const [portText] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/u);
      if (/^[0-9]+$/u.test(portText)) {
        const response = await fetch(`http://127.0.0.1:${portText}/json/version`, { signal: AbortSignal.timeout(250) });
        active = response.ok;
      }
    } catch { active = false; }
    if (!active) await removeProfile(profile);
  }
}

async function launchOne({ executable, origin, cookie, label, headless }) {
  const profile = await mkdtemp(join(tmpdir(), 'p2-g1-live-browser-'));
  const argumentsList = [
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--new-window',
    '--disable-default-apps', '--disable-extensions', '--disable-background-networking',
    'about:blank',
  ];
  if (headless) argumentsList.unshift('--headless=new');
  const child = spawn(executable, argumentsList, { stdio: 'ignore', windowsHide: headless });
  try {
    const activePortPath = join(profile, 'DevToolsActivePort');
    const activePort = await waitFor(async () => {
      if (!existsSync(activePortPath)) return null;
      const [portText] = (await readFile(activePortPath, 'utf8')).trim().split(/\r?\n/u);
      return /^[0-9]+$/u.test(portText) ? Number(portText) : null;
    });
    const target = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${activePort}/json/list`, { signal: AbortSignal.timeout(2_000) });
      const values = await response.json();
      return values.find((value) => value.type === 'page' && value.webSocketDebuggerUrl) ?? null;
    });
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolveOpen, reject) => {
      socket.addEventListener('open', resolveOpen, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    let sequence = 0;
    const pending = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id || !pending.has(message.id)) return;
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) request.reject(new Error('P2_G1_TEST_BROWSER_COMMAND_FAILED'));
      else request.resolve(message.result);
    });
    function command(method, params = {}) {
      const id = ++sequence;
      return new Promise((resolveCommand, reject) => {
        pending.set(id, { resolve: resolveCommand, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    }
    await command('Page.enable');
    await command('Network.enable');
    const accepted = await command('Network.setCookie', {
      name: cookie.name,
      value: cookie.value,
      url: origin,
      httpOnly: true,
      secure: cookie.secure === true,
      sameSite: 'Strict',
      expires: cookie.expires,
    });
    if (accepted?.success !== true) throw new Error('P2_G1_TEST_BROWSER_COOKIE_FAILED');
    const installed = await command('Page.addScriptToEvaluateOnNewDocument', { source: SAFE_TELEMETRY_SOURCE });
    if (typeof installed?.identifier !== 'string') throw new Error('P2_G1_TEST_BROWSER_TELEMETRY_FAILED');
    const currentDocument = await command('Runtime.evaluate', { expression: SAFE_TELEMETRY_SOURCE });
    if (currentDocument?.exceptionDetails) throw new Error('P2_G1_TEST_BROWSER_TELEMETRY_FAILED');
    await command('Page.navigate', { url: `${origin}/workbench#test-agent-${label}` });

    async function safeTelemetry() {
      const evaluated = await command('Runtime.evaluate', {
        expression: 'JSON.stringify(window.__p2g1SafeTelemetry ?? {sse:[],fetch:[]})',
        returnByValue: true,
      });
      const value = JSON.parse(evaluated?.result?.value ?? '{"sse":[],"fetch":[]}');
      const sse = (Array.isArray(value.sse) ? value.sse : []).filter((entry) => entry
        && SAFE_REALTIME_EVENT_TYPES.includes(entry.event_type) && Number.isSafeInteger(entry.received_ms))
        .slice(0, 1000).map((entry) => Object.freeze({ event_type: entry.event_type, received_ms: entry.received_ms }));
      const fetchEntries = (Array.isArray(value.fetch) ? value.fetch : []).filter((entry) => entry
        && SAFE_FETCH_CATEGORIES.includes(entry.category) && Number.isSafeInteger(entry.start_ms)
        && Number.isSafeInteger(entry.end_ms) && entry.end_ms >= entry.start_ms
        && Number.isInteger(entry.status) && entry.status >= 0 && entry.status <= 599)
        .slice(0, 1000).map((entry) => Object.freeze({
          category: entry.category, start_ms: entry.start_ms, end_ms: entry.end_ms, status: entry.status,
        }));
      return Object.freeze({
        session_label: label,
        sse: Object.freeze(sse),
        fetch: Object.freeze(fetchEntries),
      });
    }

    async function close() {
      try { await Promise.race([command('Browser.close'), delay(2_000)]); } catch { /* continue local cleanup */ }
      if (socket.readyState !== WebSocket.CLOSED) socket.close();
      if (child.exitCode === null) child.kill();
      await new Promise((resolveExit) => {
        if (child.exitCode !== null) resolveExit();
        else { child.once('exit', resolveExit); setTimeout(resolveExit, 2_000).unref?.(); }
      });
      await removeProfile(profile);
    }
    return Object.freeze({ close, safeTelemetry });
  } catch (error) {
    if (child.exitCode === null) child.kill();
    await removeProfile(profile).catch(() => {});
    throw error;
  }
}

export async function launchP2G1TestBrowserSessions({ origin, cookies, headless = false } = {}) {
  if (typeof origin !== 'string' || !/^http:\/\/127\.0\.0\.1:[0-9]{4,5}$/u.test(origin)
    || !Array.isArray(cookies) || cookies.length < 2 || cookies.length > 4 || typeof headless !== 'boolean') {
    throw new TypeError('P2_G1_TEST_BROWSER_CONFIGURATION_INVALID');
  }
  await cleanupStaleProfiles();
  const executable = browserExecutable();
  const sessions = [];
  try {
    for (let index = 0; index < cookies.length; index += 1) {
      sessions.push(await launchOne({ executable, origin, cookie: cookies[index], label: String.fromCharCode(65 + index), headless }));
    }
  } catch (error) {
    await Promise.allSettled(sessions.map((session) => session.close()));
    throw error;
  }
  return Object.freeze({
    count: sessions.length,
    safeTelemetry: async () => Object.freeze(await Promise.all(sessions.map((session) => session.safeTelemetry()))),
    close: async () => { await Promise.allSettled(sessions.map((session) => session.close())); },
  });
}
