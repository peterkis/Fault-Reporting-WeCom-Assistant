import type {Principal} from '../../api/client';

export type ShortcutGroup = '移动' | '对当前工单' | '工作区' | '前往';
export type ShortcutKind = 'single' | 'combo' | 'sequence' | 'alternatives';
export type ShortcutId =
  | 'move-vertical'
  | 'move-horizontal'
  | 'open-close-detail'
  | 'jump-column'
  | 'claim'
  | 'transfer'
  | 'complete'
  | 'close'
  | 'follow'
  | 'note'
  | 'copy-number'
  | 'command-panel'
  | 'focus-search'
  | 'new-report'
  | 'toggle-view'
  | 'undo'
  | 'goto-workbench'
  | 'goto-conversations'
  | 'goto-exceptions'
  | 'help';

export interface ShortcutDefinition {
  readonly id: ShortcutId;
  readonly group: ShortcutGroup;
  readonly kind: ShortcutKind;
  readonly label: string;
  readonly keys: readonly string[];
  readonly ariaKeyshortcuts: string;
  readonly route?: string;
}

function defineShortcut(definition: ShortcutDefinition): ShortcutDefinition {
  Object.freeze(definition.keys);
  return Object.freeze(definition);
}

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = Object.freeze([
  '移动',
  '对当前工单',
  '工作区',
  '前往',
]);

export const GOTO_SHORTCUT_IDS: readonly ShortcutId[] = Object.freeze([
  'goto-workbench',
  'goto-conversations',
  'goto-exceptions',
]);

export const SHORTCUTS: readonly ShortcutDefinition[] = Object.freeze([
  defineShortcut({
    id: 'move-vertical',
    group: '移动',
    kind: 'alternatives',
    label: '下一张 / 上一张',
    keys: ['J', 'K'],
    ariaKeyshortcuts: 'J K',
  }),
  defineShortcut({
    id: 'move-horizontal',
    group: '移动',
    kind: 'alternatives',
    label: '左列 / 右列',
    keys: ['H', 'L'],
    ariaKeyshortcuts: 'H L',
  }),
  defineShortcut({
    id: 'open-close-detail',
    group: '移动',
    kind: 'alternatives',
    label: '打开 / 关闭详情',
    keys: ['Enter', 'Esc'],
    ariaKeyshortcuts: 'Enter Escape',
  }),
  defineShortcut({
    id: 'jump-column',
    group: '移动',
    kind: 'alternatives',
    label: '跳到第 1–3 列',
    keys: ['1', '2', '3'],
    ariaKeyshortcuts: '1 2 3',
  }),
  defineShortcut({
    id: 'claim',
    group: '对当前工单',
    kind: 'single',
    label: '领取',
    keys: ['A'],
    ariaKeyshortcuts: 'A',
  }),
  defineShortcut({
    id: 'transfer',
    group: '对当前工单',
    kind: 'single',
    label: '转交…',
    keys: ['T'],
    ariaKeyshortcuts: 'T',
  }),
  defineShortcut({
    id: 'complete',
    group: '对当前工单',
    kind: 'single',
    label: '登记完工…',
    keys: ['D'],
    ariaKeyshortcuts: 'D',
  }),
  defineShortcut({
    id: 'close',
    group: '对当前工单',
    kind: 'single',
    label: '关闭事项…',
    keys: ['X'],
    ariaKeyshortcuts: 'X',
  }),
  defineShortcut({
    id: 'follow',
    group: '对当前工单',
    kind: 'single',
    label: '关注 / 取消关注',
    keys: ['F'],
    ariaKeyshortcuts: 'F',
  }),
  defineShortcut({
    id: 'note',
    group: '对当前工单',
    kind: 'single',
    label: '写内部备注',
    keys: ['M'],
    ariaKeyshortcuts: 'M',
  }),
  defineShortcut({
    id: 'copy-number',
    group: '对当前工单',
    kind: 'single',
    label: '复制编号',
    keys: ['C'],
    ariaKeyshortcuts: 'C',
  }),
  defineShortcut({
    id: 'command-panel',
    group: '工作区',
    kind: 'combo',
    // Card 34C banned copy sweep forbids 「命令」; keep the approved label.
    label: '搜索与快捷操作',
    keys: ['Ctrl', 'K'],
    ariaKeyshortcuts: 'Control+K',
  }),
  defineShortcut({
    id: 'focus-search',
    group: '工作区',
    kind: 'single',
    label: '聚焦搜索',
    keys: ['/'],
    ariaKeyshortcuts: '/',
  }),
  defineShortcut({
    id: 'new-report',
    group: '工作区',
    kind: 'single',
    label: '新报修',
    keys: ['N'],
    ariaKeyshortcuts: 'N',
  }),
  defineShortcut({
    id: 'toggle-view',
    group: '工作区',
    kind: 'single',
    label: '看板 / 列表',
    keys: ['V'],
    ariaKeyshortcuts: 'V',
  }),
  defineShortcut({
    id: 'undo',
    group: '工作区',
    kind: 'combo',
    label: '撤销',
    keys: ['Ctrl', 'Z'],
    ariaKeyshortcuts: 'Control+Z',
  }),
  defineShortcut({
    id: 'goto-workbench',
    group: '前往',
    kind: 'sequence',
    label: '工作台',
    keys: ['G', 'W'],
    ariaKeyshortcuts: 'G W',
    route: '/',
  }),
  defineShortcut({
    id: 'goto-conversations',
    group: '前往',
    kind: 'sequence',
    label: '会话',
    keys: ['G', 'C'],
    ariaKeyshortcuts: 'G C',
    route: '/conversations',
  }),
  defineShortcut({
    id: 'goto-exceptions',
    group: '前往',
    kind: 'sequence',
    label: '通知异常',
    keys: ['G', 'N'],
    ariaKeyshortcuts: 'G N',
    route: '/notification-exceptions',
  }),
  defineShortcut({
    id: 'help',
    group: '前往',
    kind: 'single',
    label: '查看快捷键',
    keys: ['?'],
    ariaKeyshortcuts: '?',
  }),
]);

const SHORTCUT_MAP = new Map<ShortcutId, ShortcutDefinition>(
  SHORTCUTS.map(entry => [entry.id, entry]),
);

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator as Navigator & {userAgentData?: {platform?: string}};
  const platform = ua.userAgentData?.platform ?? navigator.platform ?? navigator.userAgent ?? '';
  return /mac/iu.test(platform);
}

export function getShortcut(id: ShortcutId): ShortcutDefinition {
  const entry = SHORTCUT_MAP.get(id);
  if (!entry) throw new RangeError('UNKNOWN_SHORTCUT_' + id);
  return entry;
}

export function shortcutKeys(id: ShortcutId, mac = isMacPlatform()): readonly string[] {
  const {keys} = getShortcut(id);
  return mac ? Object.freeze(keys.map(token => (token === 'Ctrl' ? '⌘' : token))) : keys;
}

export function shortcutSeparator(id: ShortcutId): string | undefined {
  const {kind} = getShortcut(id);
  if (kind === 'sequence') return '然后';
  if (kind === 'alternatives') return '/';
  return undefined;
}

export function ariaKeyshortcuts(id: ShortcutId, mac = isMacPlatform()): string {
  const value = getShortcut(id).ariaKeyshortcuts;
  return mac ? value.replaceAll('Control+', 'Meta+') : value;
}

function matchSingleToken(event: KeyboardEvent, token: string): boolean {
  if (token === '?') {
    return !event.ctrlKey && !event.metaKey && !event.altKey && event.key === '?';
  }
  if (token === 'Esc') {
    return !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.key === 'Escape';
  }
  if (token === 'Enter') {
    return !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.key === 'Enter';
  }
  return (
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === token.toLowerCase()
  );
}

export function matchesShortcut(
  event: KeyboardEvent,
  id: ShortcutId,
  activePrefix?: string | null,
): boolean {
  const entry = getShortcut(id);
  if (entry.kind === 'single') {
    const token = entry.keys[0];
    return token ? matchSingleToken(event, token) : false;
  }
  if (entry.kind === 'alternatives') {
    return entry.keys.some(token => matchSingleToken(event, token));
  }
  if (entry.kind === 'combo') {
    const main = entry.keys.at(-1);
    return Boolean(
      main &&
        Boolean(event.ctrlKey) !== Boolean(event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === main.toLowerCase(),
    );
  }
  const [prefix, next] = entry.keys;
  return Boolean(
    prefix &&
      next &&
      activePrefix &&
      activePrefix.toLowerCase() === prefix.toLowerCase() &&
      matchSingleToken(event, next),
  );
}

export function gotoPrefixKey(): string {
  const firstGotoId = GOTO_SHORTCUT_IDS[0];
  if (!firstGotoId) return '';
  return getShortcut(firstGotoId).keys[0] ?? '';
}

export function matchAlternativeIndex(event: KeyboardEvent, id: ShortcutId): number {
  const entry = getShortcut(id);
  if (entry.kind !== 'alternatives') return -1;
  return entry.keys.findIndex(token => matchSingleToken(event, token));
}

export function matchesGotoPrefix(event: KeyboardEvent): boolean {
  const prefix = gotoPrefixKey();
  return prefix ? matchSingleToken(event, prefix) : false;
}

export function isWorkerAccount(principal: Principal): boolean {
  return principal.roles.some(
    role => role === 'ADMIN' || role === 'DISPATCHER' || role === 'HANDLER',
  );
}

export function isShortcutAvailableForPrincipal(
  id: ShortcutId,
  principal: Principal,
  canCreateManualReport: boolean,
): boolean {
  switch (id) {
    case 'claim':
      return (
        isWorkerAccount(principal) &&
        Boolean(
          principal.ticket_self_handling_enabled ||
            principal.ticket_conversation_self_handling_enabled ||
            principal.ticket_takeover_enabled,
        )
      );
    case 'transfer':
      return isWorkerAccount(principal) && principal.ticket_assignment_enabled === true;
    case 'complete':
      return isWorkerAccount(principal) && principal.ticket_staff_completion_enabled === true;
    case 'close':
      return isWorkerAccount(principal);
    case 'follow':
      return principal.workbench_follow_enabled === true;
    case 'note':
      return isWorkerAccount(principal) && principal.internal_notes_enabled === true;
    case 'focus-search':
      return principal.workbench_search_enabled === true;
    case 'new-report':
      return canCreateManualReport;
    case 'undo':
      return (
        isShortcutAvailableForPrincipal('claim', principal, canCreateManualReport) ||
        isShortcutAvailableForPrincipal('close', principal, canCreateManualReport) ||
        isShortcutAvailableForPrincipal('follow', principal, canCreateManualReport)
      );
    case 'goto-conversations':
      return principal.conversation_workspace_enabled === true;
    case 'goto-exceptions':
      return principal.notification_exceptions_enabled === true;
    default:
      return true;
  }
}
