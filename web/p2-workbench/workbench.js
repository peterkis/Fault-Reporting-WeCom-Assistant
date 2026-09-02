import { initialWorkbenchState, loadRefreshState, reduceWorkbenchState, saveRefreshState } from './workbench-state.mjs';

const elements = Object.freeze(Object.fromEntries([
  'workspace','conversation-list','load-more-conversations','timeline','load-history','conversation-view','empty-state',
  'conversation-title','conversation-channel','session-facts','control-actions','ticket-panel','delivery-panel','composer',
  'message-text','message-label','composer-hint','send-message','connection-dot','connection-label','detail-panel','status-live',
  'refresh-list','mobile-back','toggle-details','close-details','test-session-label',
].map((id) => [id, document.getElementById(id)])));

const restored = loadRefreshState();
let state = Object.freeze({ ...initialWorkbenchState(), filter: restored.filter, selectedSessionId: restored.selectedSessionId });
let bootstrap = null; let csrfToken = null; let eventSource = null; let pollTimer = null; let activeController = null; let composerPending = false;
let realtimeRefreshRunning = false; let realtimeRefreshPending = false;
const realtimeEventTypes = Object.freeze([
  'conversation.session.created', 'conversation.session.updated', 'conversation.item.created',
  'conversation.timeline.rebuilt', 'conversation.mode.changed', 'conversation.assigned',
  'conversation.handoff.requested', 'conversation.handoff.accepted', 'conversation.read_cursor.changed',
  'communication.delivery.changed', 'ticket.updated', 'incident.updated', 'gateway.connection.changed',
]);

function setState(action) { state = reduceWorkbenchState(state, action); saveRefreshState(state); }
function announce(message) { elements['status-live'].textContent = message; }
function node(tag, textValue, className) { const value = document.createElement(tag); if (textValue !== undefined) value.textContent = textValue; if (className) value.className = className; return value; }
function clear(element) { while (element.firstChild) element.removeChild(element.firstChild); }
function commandId() { return crypto.randomUUID(); }
function etagVersion() { return state.detail?.session?.row_version ?? 0; }

async function api(path, options = {}) {
  const headers = new Headers(options.headers ?? {});
  if (options.body) headers.set('content-type', 'application/json');
  if (csrfToken && options.method && options.method !== 'GET') { headers.set('x-csrf-token', csrfToken); headers.set('sec-fetch-site', 'same-origin'); }
  const response = await fetch(path, { ...options, headers, credentials: 'same-origin' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.code ?? `HTTP_${response.status}`);
  return body;
}

function renderList() {
  clear(elements['conversation-list']);
  for (const item of state.conversations) {
    const li = node('li'); const button = node('button', undefined, `conversation-card${item.session.session_id === state.selectedSessionId ? ' selected' : ''}`);
    button.type = 'button'; button.dataset.sessionId = item.session.session_id;
    const top = node('div', undefined, 'card-top'); top.append(node('span', item.ticket?.ticket_no ?? item.channel_label, 'card-title'));
    if (item.unread_count > 0) top.append(node('span', String(item.unread_count), 'badge'));
    button.append(top, node('p', item.last_item?.text ?? '暂无消息', 'card-preview'));
    const meta = node('div', undefined, 'card-meta'); meta.append(node('span', item.queue_state), node('span', item.assignment.assigned_display_name ?? '未分配')); button.append(meta);
    li.append(button); elements['conversation-list'].append(li);
  }
  elements['load-more-conversations'].hidden = !state.nextCursor;
}

function renderTimeline() {
  clear(elements.timeline);
  for (const item of state.items) {
    const li = node('li', undefined, `timeline-item ${item.visibility === 'INTERNAL' ? 'internal' : item.sender_kind === 'AGENT' ? 'agent' : ''}`);
    li.append(node('div', `${item.visibility === 'INTERNAL' ? '内部备注 · ' : ''}${item.sender_kind} · ${new Date(item.occurred_at).toLocaleString()}`, 'item-meta'));
    li.append(node('div', item.text ?? '', 'item-text')); elements.timeline.append(li);
  }
  elements['load-history'].hidden = state.items.length === 0;
}

function addFact(term, description) { elements['session-facts'].append(node('dt', term), node('dd', description)); }
function actionButton(label, action, disabled = false) { const button = node('button', label); button.type = 'button'; button.dataset.action = action; button.disabled = disabled; return button; }

function renderDetail() {
  const detail = state.detail;
  elements['empty-state'].hidden = Boolean(detail); elements['conversation-view'].hidden = !detail;
  if (!detail) return;
  elements['conversation-title'].textContent = detail.ticket?.title ?? detail.ticket?.ticket_no ?? '服务会话';
  elements['conversation-channel'].textContent = `SESSION ${detail.session.session_id.slice(0, 8)}`;
  clear(elements['session-facts']); addFact('状态', detail.session.status); addFact('模式', detail.session.control_mode);
  addFact('分配', detail.assignment.assigned_display_name ?? detail.assignment.status); addFact('未读', String(detail.unread_count));
  clear(elements['control-actions']); const caps = new Set(detail.capabilities);
  elements['control-actions'].append(actionButton('接管会话', 'takeover', !caps.has('TAKEOVER')), actionButton('请求人工', 'handoff', !caps.has('REQUEST_HANDOFF')),
    actionButton('转派给可用坐席', 'transfer', !caps.has('TRANSFER')), actionButton('释放会话', 'release', !caps.has('RELEASE')));
  clear(elements['ticket-panel']);
  elements['ticket-panel'].append(node('strong', detail.ticket?.ticket_no ?? '未关联工单'), node('p', detail.ticket ? `${detail.ticket.status} · ${detail.ticket.priority}` : 'Conversation 不复制 Ticket 状态'));
  renderDeliveries(detail.deliveries ?? []);
}

function renderDeliveries(items) {
  clear(elements['delivery-panel']);
  if (!items.length) { elements['delivery-panel'].append(node('p', '暂无投递记录', 'disabled-capability')); return; }
  for (const item of items) { const entry = node('div', undefined, 'delivery-entry'); entry.append(node('strong', item.status), node('p', `${item.channel} · 尝试 ${item.attempt_count}`)); elements['delivery-panel'].append(entry); }
}

async function loadConversations(append = false) {
  const cursor = append ? state.nextCursor : null; const query = new URLSearchParams({ state: state.filter, limit: '30' }); if (cursor) query.set('cursor', cursor);
  const page = await api(`/api/conversations?${query}`); setState({ type: 'CONVERSATIONS', items: page.items, nextCursor: page.next_cursor, append }); renderList();
}

async function loadSelected({ incremental = false } = {}) {
  if (!state.selectedSessionId) return;
  activeController?.abort(); activeController = new AbortController();
  const [detail, timeline, deliveries] = await Promise.all([
    api(`/api/conversations/${state.selectedSessionId}`),
    api(`/api/conversations/${state.selectedSessionId}/items${incremental && state.items.length ? `?after_sequence=${state.items.at(-1).sequence_no}` : ''}`),
    api(`/api/conversations/${state.selectedSessionId}/deliveries`),
  ]);
  detail.deliveries = deliveries.items; setState({ type: 'DETAIL', detail }); setState({ type: 'ITEMS', items: timeline.items, append: incremental }); renderDetail(); renderTimeline();
}

async function selectSession(sessionId) { setState({ type: 'SELECT', sessionId }); elements.workspace.classList.add('show-conversation'); renderList(); await loadSelected(); }

async function sendCommand(path, body, { sessionMutation = true } = {}) {
  const id = commandId(); const payload = { ...body, client_command_id: id }; const headers = { 'idempotency-key': id };
  if (sessionMutation) headers['if-match'] = `"${payload.expected_row_version}"`;
  return api(path, { method: 'POST', headers, body: JSON.stringify(payload) });
}

async function controlAction(action) {
  const id = state.selectedSessionId; if (!id) return;
  const common = { expected_row_version: etagVersion(), reason_code: `WORKBENCH_${action.toUpperCase()}` };
  if (action === 'takeover') await sendCommand(`/api/conversations/${id}/takeover`, common);
  if (action === 'handoff') await sendCommand(`/api/conversations/${id}/handoff/request`, common);
  if (action === 'release') await sendCommand(`/api/conversations/${id}/release`, common);
  if (action === 'transfer') {
    const eligible = await api(`/api/conversations/${id}/eligible-principals`); const target = eligible.items.find((item) => item.principal_id !== bootstrap.principal.principal_id);
    if (!target) throw new Error('WORKBENCH_NO_ELIGIBLE_PRINCIPAL'); await sendCommand(`/api/conversations/${id}/transfer`, { ...common, target_principal_id: target.principal_id, force: false });
  }
  await loadSelected(); await loadConversations(); announce('操作已提交');
}

function startPolling() { clearInterval(pollTimer); pollTimer = setInterval(() => { void loadConversations().then(() => loadSelected({ incremental: true })).catch(() => {}); }, bootstrap.polling_interval_ms); }
async function refreshFromRealtime() {
  if (realtimeRefreshRunning) { realtimeRefreshPending = true; return; }
  realtimeRefreshRunning = true;
  try {
    do {
      realtimeRefreshPending = false;
      await loadConversations();
      await loadSelected({ incremental: true });
    } while (realtimeRefreshPending);
  } catch { /* polling remains the bounded fallback */ }
  finally { realtimeRefreshRunning = false; }
}
function connectRealtime() {
  eventSource?.close(); eventSource = new EventSource(bootstrap.sse_endpoint);
  eventSource.onopen = () => { clearInterval(pollTimer); setState({ type: 'CONNECTED', connected: true }); elements['connection-dot'].classList.add('online'); elements['connection-label'].textContent = '实时连接'; };
  const refresh = () => { void refreshFromRealtime(); };
  eventSource.onmessage = refresh;
  realtimeEventTypes.forEach((eventType) => eventSource.addEventListener(eventType, refresh));
  eventSource.onerror = () => { setState({ type: 'CONNECTED', connected: false }); elements['connection-dot'].classList.remove('online'); elements['connection-label'].textContent = '轮询模式'; startPolling(); };
}

async function boot() {
  bootstrap = await api('/api/workbench/bootstrap'); csrfToken = bootstrap.csrf_token ?? null;
  const testSession = location.hash.match(/^#test-agent-([A-D])$/u)?.[1] ?? null;
  if (testSession) {
    elements['test-session-label'].textContent = `测试窗口 ${testSession}`;
    elements['test-session-label'].hidden = false;
    document.title = `测试窗口 ${testSession} · 信息保障会话工作台`;
  }
  document.querySelectorAll('[data-filter]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.filter === state.filter)));
  await loadConversations(); if (state.selectedSessionId) await selectSession(state.selectedSessionId).catch(() => { setState({ type: 'SELECT', sessionId: null }); }); connectRealtime();
}

elements['conversation-list'].addEventListener('click', (event) => { const button = event.target.closest('[data-session-id]'); if (button) void selectSession(button.dataset.sessionId).catch((error) => announce(error.message)); });
document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => { document.querySelectorAll('[data-filter]').forEach((item) => item.setAttribute('aria-pressed', 'false')); button.setAttribute('aria-pressed', 'true'); setState({ type: 'FILTER', filter: button.dataset.filter }); void loadConversations(); }));
document.querySelectorAll('[data-compose]').forEach((button) => button.addEventListener('click', () => { document.querySelectorAll('[data-compose]').forEach((item) => item.setAttribute('aria-pressed', 'false')); button.setAttribute('aria-pressed', 'true'); setState({ type: 'COMPOSE_MODE', mode: button.dataset.compose }); elements['message-label'].textContent = state.composeMode === 'note' ? '内部备注' : '回复内容'; }));
elements['control-actions'].addEventListener('click', (event) => { const button = event.target.closest('[data-action]'); if (button) void controlAction(button.dataset.action).catch((error) => announce(error.message)); });
elements.composer.addEventListener('submit', async (event) => { event.preventDefault(); const value = elements['message-text'].value; if (!value || !state.detail || composerPending) return; composerPending = true; elements['send-message'].disabled = true; try { const route = state.composeMode === 'note' ? 'internal-notes' : 'messages'; const message = { expected_row_version: etagVersion(), text: value }; if (state.composeMode !== 'note') message.message_type = 'text'; await sendCommand(`/api/conversations/${state.selectedSessionId}/${route}`, message); elements['message-text'].value = ''; await loadSelected(); announce(state.composeMode === 'note' ? '内部备注已保存' : '回复已提交至投递队列'); } catch (error) { announce(error.message); } finally { composerPending = false; elements['send-message'].disabled = false; } });
elements['load-more-conversations'].addEventListener('click', () => { void loadConversations(true); });
elements['load-history'].addEventListener('click', async () => { if (!state.items.length) return; const page = await api(`/api/conversations/${state.selectedSessionId}/items?before_sequence=${state.items[0].sequence_no}`); setState({ type: 'ITEMS', items: page.items, prepend: true }); renderTimeline(); });
elements['refresh-list'].addEventListener('click', () => { void loadConversations(); }); elements['mobile-back'].addEventListener('click', () => elements.workspace.classList.remove('show-conversation'));
elements['toggle-details'].addEventListener('click', () => elements['detail-panel'].classList.add('open')); elements['close-details'].addEventListener('click', () => elements['detail-panel'].classList.remove('open'));
window.addEventListener('pagehide', () => { eventSource?.close(); clearInterval(pollTimer); activeController?.abort(); });

void boot().catch((error) => { elements['connection-label'].textContent = '不可用'; announce(error.message); });
