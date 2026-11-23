import {useEffect,useSyncExternalStore} from 'react';
import type {QueryClient} from '@tanstack/react-query';
import type {Principal,TicketCommandContext,WorkbenchCard} from '../../api/client';
import {showSuccessToast} from '../../app/ToastFeedback';
import {isWorkerAccount} from './shortcuts';

export interface KeyboardItemRef {
  kind: WorkbenchCard['kind'];
  id: string;
}

export type DetailPendingAction = 'claim' | 'transfer' | 'complete' | 'note';

export interface DetailTargetIdentity {
  requestedKind: string;
  requestedId: string;
  canonicalKind: WorkbenchCard['kind'];
  canonicalId: string;
}

export interface PendingDetailIntent {
  principalId: string;
  kind: string;
  id: string;
  requestedKind?: string;
  requestedId?: string;
  action: DetailPendingAction;
  seq: number;
}

export type TicketCommandAction = 'claim' | 'transfer' | 'complete' | 'note' | 'close';
export type TicketActionAdmission = 'allowed' | 'denied' | 'pending' | 'error';

export function hasSelfHandlingClaimAdmission(
  principal: Principal,
  allowed: readonly string[],
): boolean {
  return Boolean(
    (principal.ticket_self_handling_enabled && allowed.includes('take-and-start')) ||
      (principal.ticket_conversation_self_handling_enabled &&
        allowed.includes('take-and-start-with-conversations')),
  );
}

export function evaluateTicketCommandAdmission(
  principal: Principal,
  data: TicketCommandContext,
  action: TicketCommandAction,
): 'allowed' | 'denied' {
  const allowed = data.allowed_actions;
  switch (action) {
    case 'claim':
      return (principal.ticket_self_handling_enabled && allowed.includes('take-and-start')) ||
        (principal.ticket_conversation_self_handling_enabled &&
          allowed.includes('take-and-start-with-conversations')) ||
        (principal.ticket_takeover_enabled && allowed.includes('takeover-and-start'))
        ? 'allowed'
        : 'denied';
    case 'transfer':
      return principal.ticket_assignment_enabled &&
        (allowed.includes('assign') || allowed.includes('transfer-assignment'))
        ? 'allowed'
        : 'denied';
    case 'complete':
      return principal.ticket_staff_completion_enabled &&
        allowed.includes('complete') &&
        Boolean(data.handling_cycle?.first_responsibility_event_id) &&
        data.handling_cycle?.staff_completion_event_id === null
        ? 'allowed'
        : 'denied';
    case 'note':
      return principal.internal_notes_enabled && allowed.includes('add-note')
        ? 'allowed'
        : 'denied';
    case 'close':
      return allowed.includes('dismiss') ? 'allowed' : 'denied';
  }
}

export interface TicketCommandQuerySnapshot {
  status: 'pending' | 'error' | 'success';
  fetchStatus: 'fetching' | 'paused' | 'idle';
  data: TicketCommandContext | undefined;
}

export function evaluateTicketCommandQueryAdmission(
  principal: Principal,
  snapshot: TicketCommandQuerySnapshot | undefined,
  action: TicketCommandAction,
): TicketActionAdmission {
  if (!snapshot) return 'pending';
  if (snapshot.fetchStatus === 'fetching') return 'pending';
  if (snapshot.status === 'error') return 'error';
  if (snapshot.status === 'success' && snapshot.data) {
    return evaluateTicketCommandAdmission(principal, snapshot.data, action);
  }
  return 'pending';
}

export function readTicketCommandAdmission(
  client: QueryClient,
  principal: Principal,
  ticketId: string,
  action: TicketCommandAction,
): TicketActionAdmission {
  const state = client.getQueryState<TicketCommandContext>([
    'ticket-command-context',
    principal.principal_id,
    ticketId,
  ]);
  return evaluateTicketCommandQueryAdmission(principal, state, action);
}

export interface CloseAdmissionOptions {
  inDetail: boolean;
  detailReady: boolean;
  ticketAdmission?: TicketActionAdmission | undefined;
}
export type CloseAdmission = 'allowed' | 'denied' | 'unauthorized' | 'pending' | 'error';

export interface BoardKeyboardBridge {
  principalId: string;
  view: 'board' | 'list';
  items: readonly WorkbenchCard[];
  blocked: boolean;
  toggleView: () => void;
  openCloseDialog: (item: WorkbenchCard, inDetail?: boolean) => void;
  canCloseItem: (item: WorkbenchCard, options: CloseAdmissionOptions) => CloseAdmission;
  hasCloseRecovery: (item: WorkbenchCard) => boolean;
  isCloseDraftChecked: (item: WorkbenchCard) => boolean;
  probeCloseDraft: (item: WorkbenchCard, force?: boolean) => Promise<boolean>;
  triggerBoardClaim: (item: WorkbenchCard) => 'triggered' | 'pending' | 'unavailable' | 'error';
  triggerBoardFollow: (
    item: WorkbenchCard,
    options?: {requireKeyboardTarget?: boolean},
  ) => 'triggered' | 'busy' | 'unavailable';
  triggerBoardTransfer: (item: WorkbenchCard) => void;
}

export interface DetailKeyboardBridge {
  open: boolean;
  fullPage: boolean;
  kind: string;
  id: string;
  item: WorkbenchCard | null;
  detailReady: boolean;
  allowedActions: readonly string[] | null;
  commandReady: boolean;
  commandError: boolean;
  blocked: boolean;
  move: (direction: 'prev' | 'next') => void;
  close: () => void;
}

export interface DetailFollowController {
  canStart: boolean;
  busy: boolean;
  settled: boolean;
  trigger: () => boolean;
}

export interface DetailTakeoverController {
  status: 'available' | 'pending' | 'error' | 'unavailable';
  open: (target: DetailTargetIdentity) => boolean;
}

let currentTarget: KeyboardItemRef | null = null;
const targetListeners = new Set<() => void>();

function notifyTargetListeners() {
  for (const listener of targetListeners) listener();
}

function subscribeTarget(listener: () => void) {
  targetListeners.add(listener);
  return () => {
    targetListeners.delete(listener);
  };
}

export function getKeyboardCurrentTarget(): KeyboardItemRef | null {
  return currentTarget;
}

export function setKeyboardCurrentTarget(next: KeyboardItemRef | null) {
  if (
    currentTarget?.kind === next?.kind &&
    currentTarget?.id === next?.id
  ) {
    return;
  }
  currentTarget = next;
  notifyTargetListeners();
}

export function useKeyboardCurrentTarget(): KeyboardItemRef | null {
  return useSyncExternalStore(
    subscribeTarget,
    getKeyboardCurrentTarget,
    () => null,
  );
}

export function useIsKeyboardCurrent(
  kind: WorkbenchCard['kind'],
  id: string,
): boolean {
  return useSyncExternalStore(
    subscribeTarget,
    () => currentTarget?.kind === kind && currentTarget?.id === id,
    () => false,
  );
}

let boardBridge: BoardKeyboardBridge | null = null;
let detailBridge: DetailKeyboardBridge | null = null;
let bridgeRevision = 0;
const bridgeListeners = new Set<() => void>();

function notifyBridgeListeners() {
  bridgeRevision++;
  for (const listener of bridgeListeners) listener();
}

function subscribeBridge(listener: () => void) {
  bridgeListeners.add(listener);
  return () => {
    bridgeListeners.delete(listener);
  };
}

export function subscribeKeyboardBridge(listener: () => void): () => void {
  return subscribeBridge(listener);
}

export function useKeyboardBridgeRevision(): number {
  return useSyncExternalStore(subscribeBridge, () => bridgeRevision, () => 0);
}

export function setBoardKeyboardBridge(next: BoardKeyboardBridge | null) {
  boardBridge = next;
  notifyBridgeListeners();
}

export function getBoardKeyboardBridge(): BoardKeyboardBridge | null {
  return boardBridge;
}

export function setDetailKeyboardBridge(next: DetailKeyboardBridge | null) {
  detailBridge = next;
  notifyBridgeListeners();
}

export function getDetailKeyboardBridge(): DetailKeyboardBridge | null {
  return detailBridge;
}

const detailTransferHandlers = new Map<string, () => boolean>();
const detailCompleteHandlers = new Map<string, () => boolean>();
const detailFollowHandlers = new Map<string, DetailFollowController>();
const detailTakeoverHandlers = new Map<string, DetailTakeoverController>();
const detailNoteHandlers = new Map<string, () => boolean>();

export function registerDetailTransfer(ticketId: string, fn: (() => boolean) | null) {
  if (fn) detailTransferHandlers.set(ticketId, fn);
  else detailTransferHandlers.delete(ticketId);
}

export function invokeDetailTransfer(ticketId: string): boolean {
  return detailTransferHandlers.get(ticketId)?.() ?? false;
}

export function registerDetailComplete(ticketId: string, fn: (() => boolean) | null) {
  if (fn) detailCompleteHandlers.set(ticketId, fn);
  else detailCompleteHandlers.delete(ticketId);
}

export function invokeDetailComplete(ticketId: string): boolean {
  return detailCompleteHandlers.get(ticketId)?.() ?? false;
}

export function registerDetailFollow(
  itemKey: string,
  controller: DetailFollowController | null,
) {
  const prev = detailFollowHandlers.get(itemKey);
  if (controller) {
    detailFollowHandlers.set(itemKey, controller);
    if (
      !prev ||
      prev.canStart !== controller.canStart ||
      prev.busy !== controller.busy ||
      prev.settled !== controller.settled
    ) {
      notifyBridgeListeners();
    }
  } else if (prev) {
    detailFollowHandlers.delete(itemKey);
    notifyBridgeListeners();
  }
}

export function getDetailFollowController(itemKey: string): DetailFollowController | null {
  return detailFollowHandlers.get(itemKey) ?? null;
}

export function registerDetailTakeover(
  ticketId: string,
  controller: DetailTakeoverController | null,
) {
  const prev = detailTakeoverHandlers.get(ticketId);
  if (controller) {
    detailTakeoverHandlers.set(ticketId, controller);
    if (!prev || prev.status !== controller.status) {
      notifyBridgeListeners();
    }
  } else if (prev) {
    detailTakeoverHandlers.delete(ticketId);
    notifyBridgeListeners();
  }
}

export function getDetailTakeoverController(ticketId: string): DetailTakeoverController | null {
  return detailTakeoverHandlers.get(ticketId) ?? null;
}

export function registerDetailNoteFocus(ticketId: string, fn: (() => boolean) | null) {
  if (fn) detailNoteHandlers.set(ticketId, fn);
  else detailNoteHandlers.delete(ticketId);
}

export function invokeDetailNoteFocus(ticketId: string): boolean {
  return detailNoteHandlers.get(ticketId)?.() ?? false;
}

let pendingIntent: PendingDetailIntent | null = null;
let intentSeq = 0;
const intentListeners = new Set<() => void>();

function notifyIntentListeners() {
  for (const listener of intentListeners) listener();
}

function subscribeIntent(listener: () => void) {
  intentListeners.add(listener);
  return () => {
    intentListeners.delete(listener);
  };
}

export function setPendingDetailIntent(
  principalId: string,
  kind: string,
  id: string,
  action: DetailPendingAction,
  requested?: {kind: string; id: string},
): PendingDetailIntent {
  pendingIntent = {
    principalId,
    kind,
    id,
    ...(requested ? {requestedKind: requested.kind, requestedId: requested.id} : {}),
    action,
    seq: ++intentSeq,
  };
  notifyIntentListeners();
  return pendingIntent;
}

export function getPendingDetailIntent(): PendingDetailIntent | null {
  return pendingIntent;
}

export function clearPendingDetailIntent(expectedSeq?: number) {
  if (!pendingIntent) return;
  if (expectedSeq !== undefined && pendingIntent.seq !== expectedSeq) return;
  pendingIntent = null;
  notifyIntentListeners();
}

export function clearPendingClaimIntent(expectedSeq?: number) {
  if (!pendingIntent || pendingIntent.action !== 'claim') return;
  if (expectedSeq !== undefined && pendingIntent.seq !== expectedSeq) return;
  pendingIntent = null;
  notifyIntentListeners();
}

export function clearPendingDetailIntentFor(kind: string, id: string) {
  if (!pendingIntent) return;
  const matchesCanonical = pendingIntent.kind === kind && pendingIntent.id === id;
  const matchesRequested =
    pendingIntent.requestedKind === kind && pendingIntent.requestedId === id;
  if (!matchesCanonical && !matchesRequested) return;
  pendingIntent = null;
  notifyIntentListeners();
}

export function consumePendingDetailIntent(
  principalId: string,
  kind: string,
  id: string,
  action: DetailPendingAction,
): boolean {
  if (
    !pendingIntent ||
    pendingIntent.principalId !== principalId ||
    pendingIntent.kind !== kind ||
    pendingIntent.id !== id ||
    pendingIntent.action !== action
  ) {
    return false;
  }
  pendingIntent = null;
  notifyIntentListeners();
  return true;
}

export function usePendingDetailIntent(): PendingDetailIntent | null {
  return useSyncExternalStore(
    subscribeIntent,
    getPendingDetailIntent,
    () => null,
  );
}

const hintListeners = new Set<(message: string) => void>();

export function emitShortcutHint(message: string) {
  for (const listener of hintListeners) listener(message);
}

export function subscribeShortcutHint(listener: (message: string) => void) {
  hintListeners.add(listener);
  return () => {
    hintListeners.delete(listener);
  };
}

export function canCloseItem(item: WorkbenchCard): boolean {
  return item.kind === 'ticket'
    ? [
        'NEW',
        'QUEUED',
        'ACCEPTED',
        'IN_PROGRESS',
        'WAITING_REQUESTER',
        'WAITING_VENDOR',
        'REOPENED',
      ].includes(item.status)
    : item.column === 'pending';
}

export {isWorkerAccount as isWorkerPrincipal};

export async function copyItemNumber(number: string): Promise<boolean> {
  if (!number) return false;
  let copied = false;
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(number);
      copied = true;
    } catch {
      copied = false;
    }
  }
  if (!copied && typeof document !== 'undefined') {
    const area = document.createElement('textarea');
    area.value = number;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    } finally {
      area.remove();
    }
  }
  if (copied) {
    showSuccessToast({
      id: 'copy-number:' + number,
      source: 'copy-number',
      title: '已复制编号 ' + number,
    });
  } else {
    emitShortcutHint('无法复制工单编号，请选中编号后手动复制');
  }
  return copied;
}

export const EDITABLE_ELEMENT_SELECTOR =
  'input,textarea,select,[contenteditable]:not([contenteditable=false]),[role=textbox],[role=combobox],[role=spinbutton]';

export function isEditableElement(el: Element | null): boolean {
  return Boolean(el && el.closest(EDITABLE_ELEMENT_SELECTOR));
}

export const BLOCKING_OVERLAYS =
  '[data-workbench-modal],[role=alertdialog],[role=dialog]:not(.detail-dialog),[role=menu],[role=listbox],.board-action-options,details.ds-drawer-more[open],details.ds-toolbar-filters[open],.ds-online-panel:not([data-exiting]),.processed-date-popover:not([data-exiting])';

export function isVisibleElement(el: Element): boolean {
  if (el.closest('[inert],[aria-hidden=true],[data-exiting]')) return false;
  return el instanceof HTMLElement ? el.checkVisibility({visibilityProperty: true}) : true;
}

export function hasBlockingOverlayOpen(): boolean {
  if (typeof document === 'undefined') return false;
  const nodes = document.querySelectorAll(BLOCKING_OVERLAYS);
  for (const node of nodes) {
    if (isVisibleElement(node)) return true;
  }
  return false;
}

export function isDetailOpenInDom(): boolean {
  if (typeof document === 'undefined') return false;
  const nodes = document.querySelectorAll('.detail-dialog,.detail-page');
  for (const node of nodes) {
    if (isVisibleElement(node)) return true;
  }
  return false;
}

export interface FollowHostState {
  canStart: boolean;
  busy: boolean;
  inFlight: boolean;
  settled: boolean;
}

const boardFollowStates = new Map<string, FollowHostState>();
const followStateListeners = new Set<() => void>();

function notifyFollowStateListeners() {
  for (const listener of followStateListeners) listener();
}

function subscribeFollowState(listener: () => void) {
  followStateListeners.add(listener);
  return () => {
    followStateListeners.delete(listener);
  };
}

export function setBoardFollowHostState(
  principalId: string,
  itemKey: string,
  next: FollowHostState | null,
): void {
  const mapKey = principalId + '\0' + itemKey;
  const prev = boardFollowStates.get(mapKey);
  if (!next) {
    if (!prev) return;
    boardFollowStates.delete(mapKey);
    notifyFollowStateListeners();
    return;
  }
  if (
    prev &&
    prev.canStart === next.canStart &&
    prev.busy === next.busy &&
    prev.inFlight === next.inFlight &&
    prev.settled === next.settled
  ) {
    return;
  }
  boardFollowStates.set(mapKey, next);
  notifyFollowStateListeners();
}

export function clearBoardFollowHostStates(principalId: string): void {
  const prefix = principalId + '\0';
  let changed = false;
  for (const mapKey of boardFollowStates.keys()) {
    if (mapKey.startsWith(prefix)) {
      boardFollowStates.delete(mapKey);
      changed = true;
    }
  }
  if (changed) notifyFollowStateListeners();
}

export function getBoardFollowHostState(
  principalId: string,
  itemKey: string | null,
): FollowHostState | null {
  if (!principalId || !itemKey) return null;
  return boardFollowStates.get(principalId + '\0' + itemKey) ?? null;
}

export function useBoardFollowHostState(
  principalId: string,
  itemKey: string | null,
): FollowHostState | null {
  return useSyncExternalStore(
    subscribeFollowState,
    () => getBoardFollowHostState(principalId, itemKey),
    () => null,
  );
}

const EMPTY_DEMAND_MAP: ReadonlyMap<string, WorkbenchCard> = new Map();
const followHostDemands = new Map<string, WorkbenchCard>();
let demandSnapshot: ReadonlyMap<string, WorkbenchCard> = EMPTY_DEMAND_MAP;
const demandListeners = new Set<() => void>();

function notifyDemandListeners() {
  demandSnapshot = new Map(followHostDemands);
  for (const listener of demandListeners) listener();
}

function subscribeFollowDemands(listener: () => void) {
  demandListeners.add(listener);
  return () => {
    demandListeners.delete(listener);
  };
}

export function setFollowHostDemand(sourceId: string, item: WorkbenchCard | null): void {
  const prev = followHostDemands.get(sourceId);
  if (!item) {
    if (!prev) return;
    followHostDemands.delete(sourceId);
    notifyDemandListeners();
    return;
  }
  if (prev === item) return;
  followHostDemands.set(sourceId, item);
  notifyDemandListeners();
}

export function useFollowHostDemands(): ReadonlyMap<string, WorkbenchCard> {
  return useSyncExternalStore(
    subscribeFollowDemands,
    () => demandSnapshot,
    () => EMPTY_DEMAND_MAP,
  );
}

export function useDemandFollowHost(
  sourceId: string,
  item: WorkbenchCard | null,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!enabled || !item) {
      setFollowHostDemand(sourceId, null);
      return;
    }
    setFollowHostDemand(sourceId, item);
    return () => setFollowHostDemand(sourceId, null);
  }, [sourceId, item, enabled]);
}

let queuedFollowCanceller: (() => void) | null = null;

export function registerQueuedFollowCanceller(fn: (() => void) | null): void {
  queuedFollowCanceller = fn;
}

export function cancelQueuedBoardFollows(): void {
  queuedFollowCanceller?.();
}
