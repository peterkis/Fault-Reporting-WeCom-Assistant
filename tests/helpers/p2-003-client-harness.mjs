import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';

const activeClients = new Set();
const activeFallbackRequests = new Set();
const activeHttpSockets = new Set();
let activeWaitTimers = 0;

function registerHttpSocket(request) {
  request.once('socket', (socket) => {
    activeHttpSockets.add(socket);
    socket.once('close', () => activeHttpSockets.delete(socket));
  });
}

function authorizationHeader(token) {
  assert.ok(['workbench', 'admin', 'invalid'].includes(token));
  return `Bearer p2-003-${token}`;
}

function withTimeout(promise, timeoutMs, code) {
  let timer;
  activeWaitTimers += 1;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(code);
        error.code = code;
        reject(error);
      }, timeoutMs);
    }),
  ]).finally(() => {
    clearTimeout(timer);
    activeWaitTimers -= 1;
  });
}

function frameSeparator(buffer) {
  const match = /\r?\n\r?\n/u.exec(buffer);
  return match ? { index: match.index, length: match[0].length } : null;
}

export function openP2003SseClient({
  port,
  lastEventId,
  token = 'workbench',
  paused = false,
  captureLimit = 0,
  maxParserBufferBytes = 262_144,
}) {
  assert.ok(Number.isInteger(port) && port >= 1 && port <= 65_535);
  if (lastEventId !== undefined) {
    assert.match(lastEventId, /^(?:0|[1-9][0-9]*)$/u);
  }
  assert.equal(typeof paused, 'boolean');
  assert.ok(Number.isInteger(captureLimit) && captureLimit >= 0 && captureLimit <= 10_000);
  assert.ok(Number.isInteger(maxParserBufferBytes) && maxParserBufferBytes >= 1_024);

  let response;
  let parserBuffer = '';
  let maximumParserBufferBytes = 0;
  let eventCount = 0;
  let heartbeatCount = 0;
  let firstEventId = null;
  let lastReceivedEventId = null;
  let responseStatus = null;
  let responseHeaders = null;
  let closed = false;
  let closeInformation;
  const capturedEvents = [];
  const countWaiters = new Set();
  const heartbeatWaiters = new Set();
  let resolveConnected;
  let rejectConnected;
  let resolveClosed;
  const connectedPromise = new Promise((resolve, reject) => {
    resolveConnected = resolve;
    rejectConnected = reject;
  });
  const closedPromise = new Promise((resolve) => {
    resolveClosed = resolve;
  });

  function settleClosed(reason, error = null) {
    if (closed) {
      return;
    }
    closed = true;
    activeClients.delete(client);
    closeInformation = Object.freeze({ reason, error_code: error?.code ?? null });
    for (const waiter of countWaiters) {
      waiter.reject(error ?? new Error('P2_003_SSE_CLIENT_CLOSED'));
    }
    countWaiters.clear();
    for (const waiter of heartbeatWaiters) {
      waiter.reject(error ?? new Error('P2_003_SSE_CLIENT_CLOSED'));
    }
    heartbeatWaiters.clear();
    resolveClosed(closeInformation);
  }

  function notifyWaiters() {
    for (const waiter of [...countWaiters]) {
      if (eventCount >= waiter.expected) {
        countWaiters.delete(waiter);
        waiter.resolve(snapshot());
      }
    }
    for (const waiter of [...heartbeatWaiters]) {
      if (heartbeatCount >= waiter.expected) {
        heartbeatWaiters.delete(waiter);
        waiter.resolve(snapshot());
      }
    }
  }

  function parseFrame(frame) {
    const lines = frame.split(/\r?\n/u);
    if (lines.every((line) => line.length === 0 || line.startsWith(':'))) {
      if (lines.some((line) => line === ': heartbeat')) {
        heartbeatCount += 1;
        notifyWaiters();
      }
      return;
    }
    let id;
    let eventType;
    let dataLine;
    for (const line of lines) {
      if (line.startsWith('id: ')) {
        id = line.slice(4);
      } else if (line.startsWith('event: ')) {
        eventType = line.slice(7);
      } else if (line.startsWith('data: ')) {
        assert.equal(dataLine, undefined, 'P2_003_SSE_DATA_MUST_BE_SINGLE_LINE');
        dataLine = line.slice(6);
      }
    }
    assert.match(id ?? '', /^(?:0|[1-9][0-9]*)$/u);
    assert.match(eventType ?? '', /^[a-z][a-z0-9_.]{0,127}$/u);
    assert.equal(typeof dataLine, 'string');
    assert.doesNotMatch(dataLine, /[\r\n]/u);
    const data = JSON.parse(dataLine);
    eventCount += 1;
    firstEventId ??= id;
    lastReceivedEventId = id;
    if (capturedEvents.length < captureLimit) {
      capturedEvents.push(Object.freeze({ id, event: eventType, data }));
    }
    notifyWaiters();
  }

  function consume(chunk) {
    parserBuffer += chunk;
    maximumParserBufferBytes = Math.max(
      maximumParserBufferBytes,
      Buffer.byteLength(parserBuffer, 'utf8'),
    );
    assert.ok(
      maximumParserBufferBytes <= maxParserBufferBytes,
      'P2_003_SSE_CLIENT_PARSER_BUFFER_EXCEEDED',
    );
    let separator = frameSeparator(parserBuffer);
    while (separator) {
      const frame = parserBuffer.slice(0, separator.index);
      parserBuffer = parserBuffer.slice(separator.index + separator.length);
      parseFrame(frame);
      separator = frameSeparator(parserBuffer);
    }
  }

  function snapshot() {
    return Object.freeze({
      event_count: eventCount,
      heartbeat_count: heartbeatCount,
      first_event_id: firstEventId,
      last_event_id: lastReceivedEventId,
      maximum_parser_buffer_bytes: maximumParserBufferBytes,
      captured_events: Object.freeze([...capturedEvents]),
      status_code: responseStatus,
      headers: responseHeaders,
      paused: response?.readableFlowing === false,
      closed,
      close: closeInformation,
    });
  }

  const headers = {
    Accept: 'text/event-stream',
    Authorization: authorizationHeader(token),
  };
  if (lastEventId !== undefined) {
    headers['Last-Event-ID'] = lastEventId;
  }
  const request = httpRequest({
    host: '127.0.0.1',
    port,
    method: 'GET',
    path: '/api/realtime/events?scope=workbench',
    headers,
    agent: false,
  });
  registerHttpSocket(request);
  request.once('response', (incoming) => {
    response = incoming;
    responseStatus = incoming.statusCode;
    responseHeaders = Object.freeze({ ...incoming.headers });
    if (incoming.statusCode !== 200) {
      const error = new Error(`P2_003_SSE_UNEXPECTED_STATUS_${incoming.statusCode}`);
      error.code = 'P2_003_SSE_UNEXPECTED_STATUS';
      rejectConnected(error);
      incoming.resume();
      incoming.once('end', () => settleClosed('response-end', error));
      return;
    }
    if (paused) {
      incoming.pause();
    } else {
      incoming.setEncoding('utf8');
      incoming.on('data', consume);
    }
    incoming.once('aborted', () => settleClosed('response-aborted'));
    incoming.once('error', (error) => settleClosed('response-error', error));
    incoming.once('end', () => settleClosed('response-end'));
    incoming.once('close', () => settleClosed('response-close'));
    resolveConnected(Object.freeze({
      status_code: incoming.statusCode,
      headers: responseHeaders,
    }));
  });
  request.once('error', (error) => {
    rejectConnected(error);
    settleClosed('request-error', error);
  });
  request.end();

  async function waitForCount(expected, timeoutMs = 10_000) {
    assert.ok(Number.isInteger(expected) && expected >= 0);
    if (eventCount >= expected) {
      return snapshot();
    }
    let waiter;
    try {
      return await withTimeout(new Promise((resolve, reject) => {
        waiter = { expected, resolve, reject };
        countWaiters.add(waiter);
      }), timeoutMs, 'P2_003_SSE_EVENT_WAIT_TIMEOUT');
    } finally {
      countWaiters.delete(waiter);
    }
  }

  async function waitForHeartbeat(expected = 1, timeoutMs = 10_000) {
    assert.ok(Number.isInteger(expected) && expected >= 1);
    if (heartbeatCount >= expected) {
      return snapshot();
    }
    let waiter;
    try {
      return await withTimeout(new Promise((resolve, reject) => {
        waiter = { expected, resolve, reject };
        heartbeatWaiters.add(waiter);
      }), timeoutMs, 'P2_003_SSE_HEARTBEAT_WAIT_TIMEOUT');
    } finally {
      heartbeatWaiters.delete(waiter);
    }
  }

  const client = Object.freeze({
    connected: (timeoutMs = 10_000) => withTimeout(
      connectedPromise,
      timeoutMs,
      'P2_003_SSE_CONNECT_TIMEOUT',
    ),
    waitForEventCount: waitForCount,
    waitForHeartbeatCount: waitForHeartbeat,
    snapshot,
    pause: () => response?.pause(),
    resume: () => response?.resume(),
    destroy: async () => {
      request.destroy();
      response?.destroy();
      if (!closed) {
        settleClosed('client-destroy');
      }
      return closedPromise;
    },
    waitForClose: (timeoutMs = 10_000) => withTimeout(
      closedPromise,
      timeoutMs,
      'P2_003_SSE_CLOSE_TIMEOUT',
    ),
  });
  activeClients.add(client);
  return client;
}

export function requestP2003Fallback({
  port,
  lastEventId,
  token = 'workbench',
  timeoutMs = 10_000,
  maxBodyBytes = 65_536,
}) {
  assert.ok(Number.isInteger(port) && port >= 1 && port <= 65_535);
  const headers = {
    Accept: 'text/event-stream',
    Authorization: authorizationHeader(token),
  };
  if (lastEventId !== undefined) {
    headers['Last-Event-ID'] = lastEventId;
  }
  let request;
  const operation = new Promise((resolve, reject) => {
    request = httpRequest({
      host: '127.0.0.1',
      port,
      method: 'GET',
      path: '/api/realtime/events?scope=workbench',
      headers,
      agent: false,
    });
    registerHttpSocket(request);
    activeFallbackRequests.add(request);
    request.once('response', (response) => {
      const chunks = [];
      let byteLength = 0;
      let responseEnded = false;
      response.on('data', (chunk) => {
        byteLength += chunk.length;
        if (byteLength > maxBodyBytes) {
          request.destroy(new Error('P2_003_FALLBACK_BODY_TOO_LARGE'));
          return;
        }
        chunks.push(chunk);
      });
      response.once('error', reject);
      response.once('aborted', () => reject(new Error('P2_003_FALLBACK_RESPONSE_ABORTED')));
      response.once('close', () => {
        if (!responseEnded) {
          reject(new Error('P2_003_FALLBACK_RESPONSE_CLOSED'));
        }
      });
      response.once('end', () => {
        responseEnded = true;
        try {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve(Object.freeze({
            status_code: response.statusCode,
            headers: Object.freeze({ ...response.headers }),
            body: JSON.parse(text),
            byte_length: byteLength,
          }));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.once('error', reject);
    request.end();
  });
  return withTimeout(operation, timeoutMs, 'P2_003_FALLBACK_TIMEOUT')
    .catch((error) => {
      request?.destroy();
      throw error;
    })
    .finally(() => {
      activeFallbackRequests.delete(request);
    });
}

export async function destroyAllP2003SseClients() {
  const clients = [...activeClients];
  const fallbackRequests = [...activeFallbackRequests];
  const httpSockets = [...activeHttpSockets];
  await Promise.all(clients.map((client) => client.destroy().catch(() => {})));
  for (const request of fallbackRequests) {
    request.destroy();
    activeFallbackRequests.delete(request);
  }
  for (const socket of httpSockets) {
    socket.destroy();
    activeHttpSockets.delete(socket);
  }
  assert.equal(activeClients.size, 0);
  assert.equal(activeFallbackRequests.size, 0);
  assert.equal(activeHttpSockets.size, 0);
  return Object.freeze({
    destroyed_client_count: clients.length,
    destroyed_fallback_request_count: fallbackRequests.length,
    destroyed_http_socket_count: httpSockets.length,
    active_client_count: 0,
    active_fallback_request_count: 0,
    active_http_socket_count: 0,
  });
}

export function assertNoP2003ClientResidual() {
  assert.equal(activeClients.size, 0);
  assert.equal(activeFallbackRequests.size, 0);
  assert.equal(activeHttpSockets.size, 0);
  assert.equal(activeWaitTimers, 0);
  return Object.freeze({
    active_test_clients: 0,
    active_fallback_requests: 0,
    active_test_http_sockets: 0,
    active_test_wait_timers: 0,
  });
}
