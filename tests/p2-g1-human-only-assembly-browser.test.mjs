import {createServer as createNetServer} from 'node:net';
const SESSION_ID='018f0000-0000-7000-8000-000000000061';
async function reservePort(){const server=createNetServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
import assert from 'node:assert/strict';
import {createServer as createHttpServer} from 'node:http';
import {test} from 'node:test';
import {launchP2G1TestBrowserSessions} from '../app/server/src/p2-g1-browser-sessions.mjs';
test('P2-G1 live browser sessions navigate to the actual Workbench route with isolated cookies', { timeout: 90_000 }, async (t) => {
  const port = await reservePort();
  const origin = `http://127.0.0.1:${port}`;
  const requests = [];
  const server = createHttpServer((request, response) => {
    requests.push({ path: request.url, cookie: typeof request.headers.cookie === 'string' });
    if (request.url?.startsWith('/workbench')) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><title>P2-G1 Workbench route check</title><script>fetch("/api/conversations");const source=new EventSource("/events");source.addEventListener("conversation.item.created",()=>source.close());</script>');
      return;
    }
    if (request.url === '/api/conversations') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"items":[]}');
      return;
    }
    if (request.url === '/events') {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      setTimeout(() => response.end('event: conversation.item.created\ndata: {}\n\n'), 100);
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end('{"error":{"code":"WORKBENCH_NOT_FOUND"}}');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const expires = Math.floor(Date.now() / 1000) + 60;
  let sessions;
  try {
    sessions = await launchP2G1TestBrowserSessions({
      origin,
      headless: true,
      cookies: [
        { name: 'p2_g1_test_1', value: 'a'.repeat(40), secure: false, expires },
        { name: 'p2_g1_test_2', value: 'b'.repeat(40), secure: false, expires },
      ],
    });
    const deadline = Date.now() + 10_000;
    while (requests.filter((request) => request.path?.startsWith('/workbench')).length < 2 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const workbenchRequests = requests.filter((request) => request.path?.startsWith('/workbench'));
    assert.equal(sessions.count, 2);
    assert.ok(workbenchRequests.length >= 2);
    assert.equal(workbenchRequests.every((request) => request.cookie), true);
    assert.equal(requests.some((request) => request.path === '/'), false);
    let telemetry = [];
    const telemetryDeadline = Date.now() + 10_000;
    while (Date.now() < telemetryDeadline) {
      telemetry = await sessions.safeTelemetry();
      if (telemetry.every((session) => session.sse.length === 1 && session.fetch.length === 1)) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(telemetry.every((session) => session.sse[0]?.event_type === 'conversation.item.created'), true);
    assert.equal(telemetry.every((session) => session.fetch[0]?.category === 'LIST' && session.fetch[0]?.status === 200), true);
    assert.equal(telemetry.every((session) => Number.isInteger(session.sse[0]?.received_ms)), true);
    assert.equal(telemetry.every((session) => Number.isInteger(session.fetch[0]?.end_ms)), true);
    assert.equal(JSON.stringify(telemetry).includes(SESSION_ID), false);
    t.diagnostic(JSON.stringify({ browser_sessions: 2, workbench_route_requests: workbenchRequests.length, isolated_cookie_headers: true, root_not_requested: true, safe_telemetry: true }));
  } finally {
    await sessions?.close?.();
    await new Promise((resolve) => server.close(resolve));
  }
});
