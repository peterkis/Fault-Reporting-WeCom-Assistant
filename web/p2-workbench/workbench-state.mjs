const MAX_CONVERSATIONS = 200;
const MAX_ITEMS = 400;

export function initialWorkbenchState() {
  return Object.freeze({ filter: 'open', conversations: Object.freeze([]), nextCursor: null,
    selectedSessionId: null, detail: null, items: Object.freeze([]), composeMode: 'reply', connected: false });
}

function boundedUnique(values, key, maximum) {
  const map = new Map();
  for (const value of values) map.set(typeof key === 'function' ? key(value) : value[key], value);
  return Object.freeze([...map.values()].slice(-maximum));
}

export function reduceWorkbenchState(state, action) {
  switch (action.type) {
    case 'FILTER': return Object.freeze({ ...state, filter: action.filter, conversations: Object.freeze([]), nextCursor: null });
    case 'CONVERSATIONS': return Object.freeze({ ...state, conversations: boundedUnique(action.append ? [...state.conversations, ...action.items] : action.items, (item) => item.session.session_id, MAX_CONVERSATIONS), nextCursor: action.nextCursor });
    case 'SELECT': return Object.freeze({ ...state, selectedSessionId: action.sessionId, detail: null, items: Object.freeze([]) });
    case 'DETAIL': return Object.freeze({ ...state, detail: action.detail });
    case 'ITEMS': return Object.freeze({ ...state, items: boundedUnique(action.prepend ? [...action.items, ...state.items] : action.append ? [...state.items, ...action.items] : action.items, 'item_id', MAX_ITEMS) });
    case 'COMPOSE_MODE': return Object.freeze({ ...state, composeMode: action.mode });
    case 'CONNECTED': return Object.freeze({ ...state, connected: action.connected });
    default: return state;
  }
}

export function loadRefreshState(storage = sessionStorage) {
  const filter = storage.getItem('p2_workbench_filter');
  const selectedSessionId = storage.getItem('p2_workbench_session');
  return Object.freeze({ filter: filter && /^[a-z_]{1,32}$/u.test(filter) ? filter : 'open',
    selectedSessionId: selectedSessionId && /^[0-9a-f-]{36}$/iu.test(selectedSessionId) ? selectedSessionId : null });
}

export function saveRefreshState(state, storage = sessionStorage) {
  storage.setItem('p2_workbench_filter', state.filter);
  if (state.selectedSessionId) storage.setItem('p2_workbench_session', state.selectedSessionId);
  else storage.removeItem('p2_workbench_session');
}
