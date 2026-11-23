import {createContext,Fragment,useCallback,useContext,useEffect,useId,useMemo,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {useLocation,useNavigate} from 'react-router';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {
  ArrowUpRight,
  Bell,
  CheckCircle2,
  CircleX,
  Copy,
  HelpCircle,
  LayoutGrid,
  LayoutList,
  Lock,
  MessageSquare,
  Plus,
  Search,
  Star,
  TriangleAlert,
  UserRound,
  X,
} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';
import {Button} from '../../design/components/Button/Button';
import {EmptyState} from '../../design/components/EmptyState/EmptyState';
import {Kbd,ShortcutTooltip} from '../../design/components/Kbd/Kbd';
import {Modal} from '../../design/components/Modal/Modal';
import {usePopoverPresence} from '../../design/components/Popover/usePopoverPresence';
import {SearchField} from '../../design/components/SearchField/SearchField';
import {motionToken} from '../../design/motion/tokens';
import {api,errorMessage,workbenchTransportWritable} from '../../api/client';
import type {Principal,WorkbenchCard} from '../../api/client';
import {itemLink} from '../../app/WorkbenchItemPresentation';
import {triggerNewestUndoToast} from '../../app/ToastFeedback';
import {manualReportCapabilitiesKey} from '../manual-report/use-manual-report-draft';
import {useCommandRecoveryRevision} from '../optimistic/command-recovery';
import {isItemActionPending,useItemOptimisticState} from '../optimistic/store';
import {parseSearchRequest} from '../../../../../shared/workbench-search-contracts.mjs';
import type {WorkbenchSearchCriteria} from '../../../../../contracts/workbench_search_contracts';
import {
  GOTO_SHORTCUT_IDS,
  SHORTCUT_GROUPS,
  SHORTCUTS,
  ariaKeyshortcuts,
  getShortcut,
  gotoPrefixKey,
  isShortcutAvailableForPrincipal,
  isWorkerAccount,
  matchAlternativeIndex,
  matchesGotoPrefix,
  matchesShortcut,
  shortcutKeys,
  shortcutSeparator,
} from './shortcuts';
import type {ShortcutId} from './shortcuts';
import {
  cancelQueuedBoardFollows,
  clearPendingDetailIntent,
  copyItemNumber,
  emitShortcutHint,
  evaluateTicketCommandQueryAdmission,
  getBoardKeyboardBridge,
  getDetailFollowController,
  getDetailKeyboardBridge,
  getKeyboardCurrentTarget,
  hasBlockingOverlayOpen,
  invokeDetailComplete,
  invokeDetailNoteFocus,
  invokeDetailTransfer,
  isDetailOpenInDom,
  readTicketCommandAdmission,
  setKeyboardCurrentTarget,
  setPendingDetailIntent,
  subscribeKeyboardBridge,
  subscribeShortcutHint,
  useBoardFollowHostState,
  useDemandFollowHost,
  useKeyboardBridgeRevision,
  useKeyboardCurrentTarget,
} from './keyboard-store';
import type {KeyboardItemRef,TicketActionAdmission,TicketCommandAction} from './keyboard-store';
import './efficiency.css';

type CapturedCommandTarget = {surface: 'detail' | 'board'; ref: KeyboardItemRef};

const EfficiencyContext = createContext<{open: () => void; blocked: boolean} | null>(null);
const EDITABLE_SELECTOR =
  'input,textarea,select,[contenteditable]:not([contenteditable=false]),[role=textbox],[role=combobox],[role=spinbutton]';
const BOARD_CLIPS = '.ds-collapse-inner,.ds-board-group > .disclosure__content > .disclosure__body';
const STAGE_TBODY_IDS = ['list-pending', 'list-active', 'list-handled'] as const;

function isVisibleBoardLink(link: HTMLAnchorElement): boolean {
  if (
    link.closest('[inert],[aria-hidden=true]') ||
    !link.checkVisibility({visibilityProperty: true, opacityProperty: true})
  ) {
    return false;
  }
  let clip = link.closest(BOARD_CLIPS);
  if (!clip) return true;
  let {top, bottom} = link.getBoundingClientRect();
  while (clip) {
    const bounds = clip.getBoundingClientRect();
    top = Math.max(top, bounds.top);
    bottom = Math.min(bottom, bounds.bottom);
    if (top >= bottom) return false;
    clip = clip.parentElement?.closest(BOARD_CLIPS) ?? null;
  }
  return true;
}

function itemRefFromLink(link: HTMLElement): {kind: WorkbenchCard['kind']; id: string} | null {
  const owner = link.closest<HTMLElement>('.ticket-card[data-kind][data-item-id],.ds-work-row[data-kind][data-item-id]');
  const kind = owner?.dataset.kind;
  const id = owner?.dataset.itemId;
  if (!id || (kind !== 'ticket' && kind !== 'intake' && kind !== 'review')) return null;
  return {kind, id};
}

function findCardLink(container: ParentNode, ref: {kind: WorkbenchCard['kind']; id: string}): HTMLAnchorElement | null {
  const selector = `[data-kind="${CSS.escape(ref.kind)}"][data-item-id="${CSS.escape(ref.id)}"] a.card-open[href]`;
  const link = container.querySelector<HTMLAnchorElement>(selector);
  return link && isVisibleBoardLink(link) ? link : null;
}

function isImeEvent(
  event: {isComposing?: boolean; keyCode?: number},
  composing: boolean,
  lastCompositionEnd: number,
  timeStamp: number,
): boolean {
  return Boolean(
    event.isComposing ||
      event.keyCode === 229 ||
      composing ||
      (lastCompositionEnd > 0 && Math.abs(timeStamp - lastCompositionEnd) < 50),
  );
}

/** Both entry points share one panel and one window listener. */
export function EfficiencyEntry({compact = false}: {compact?: boolean}) {
  const context = useContext(EfficiencyContext);
  if (!context) return null;
  const keys = shortcutKeys('command-panel');
  const label = getShortcut('command-panel').label;
  return (
    <ShortcutTooltip
      label={label}
      keys={keys}
      placement={compact ? 'bottom-end' : 'bottom-start'}
      enabled={!context.blocked}
    >
      <Button
        className={compact ? 'efficiency-compact' : 'sidebar-search efficiency-entry'}
        tone="ghost"
        isDisabled={context.blocked}
        aria-label={label}
        aria-keyshortcuts={ariaKeyshortcuts('command-panel')}
        aria-haspopup="dialog"
        onPress={context.open}
      >
        <Search size={16} />
        {compact ? null : <span>搜索工作区</span>}
        <Kbd keys={keys} disabled={context.blocked} className="efficiency-entry-kbd" />
      </Button>
    </ShortcutTooltip>
  );
}

export function WorkbenchEfficiency({
  principal,
  blocked,
  children,
}: {
  principal: Principal;
  blocked: boolean;
  children: ReactNode;
}) {
  const [panel, setPanel] = useState<'commands' | 'shortcuts' | null>(null);
  const [commandTarget, setCommandTarget] = useState<CapturedCommandTarget | null>(null);
  const [gotoOpen, setGotoOpen] = useState(false);
  const [hint, setHint] = useState<{id: number; text: string} | null>(null);
  const [lastHintText, setLastHintText] = useState('');
  const queryClient = useQueryClient();
  const keyboardTarget = useKeyboardCurrentTarget();
  const navigate = useNavigate();
  const location = useLocation();
  const capabilities = useQuery({
    queryKey: manualReportCapabilitiesKey(principal.principal_id),
    queryFn: ({signal}) => api.manualReportCapabilities(signal),
    enabled: principal.manual_reports_enabled,
  });
  const canCreate =
    principal.manual_reports_enabled &&
    capabilities.isSuccess &&
    !capabilities.isError &&
    capabilities.data.can_create;
  const returnFocus = useRef<HTMLElement | null>(null);
  const lastInputModalityRef = useRef<'unknown' | 'keyboard' | 'pointer'>('unknown');
  const composingRef = useRef(false);
  const lastCompositionEndRef = useRef(0);
  const gotoTimerRef = useRef<number | null>(null);
  const hintTimerRef = useRef<number | null>(null);
  const hintSeqRef = useRef(0);
  const pendingBoardReadCancelRef = useRef<(() => void) | null>(null);

  const cancelPendingBoardRead = useCallback(() => {
    pendingBoardReadCancelRef.current?.();
    pendingBoardReadCancelRef.current = null;
    cancelQueuedBoardFollows();
  }, []);

  const clearGoto = useCallback(() => {
    if (gotoTimerRef.current !== null) {
      window.clearTimeout(gotoTimerRef.current);
      gotoTimerRef.current = null;
    }
    setGotoOpen(false);
  }, []);

  const showHint = useCallback((text: string) => {
    if (!text) return;
    if (hintTimerRef.current !== null) {
      window.clearTimeout(hintTimerRef.current);
      hintTimerRef.current = null;
    }
    setLastHintText(text);
    setHint({id: ++hintSeqRef.current, text});
    hintTimerRef.current = window.setTimeout(() => {
      hintTimerRef.current = null;
      setHint(null);
    }, motionToken('--delay-shortcut-hint'));
  }, []);

  useEffect(() => {
    return subscribeShortcutHint(text => {
      cancelPendingBoardRead();
      clearGoto();
      showHint(text);
    });
  }, [cancelPendingBoardRead, clearGoto, showHint]);

  useEffect(() => {
    return () => {
      cancelPendingBoardRead();
      if (gotoTimerRef.current !== null) window.clearTimeout(gotoTimerRef.current);
      if (hintTimerRef.current !== null) window.clearTimeout(hintTimerRef.current);
    };
  }, [cancelPendingBoardRead]);

  useEffect(() => {
    cancelPendingBoardRead();
  }, [
    keyboardTarget?.kind,
    keyboardTarget?.id,
    blocked,
    panel,
    gotoOpen,
    location.pathname,
    location.search,
    principal.principal_id,
    principal.authorization_revision,
    cancelPendingBoardRead,
  ]);

  useEffect(() => {
    if (!gotoOpen) return;
    const cancel = () => clearGoto();
    document.addEventListener('pointerdown', cancel, true);
    window.addEventListener('blur', cancel);
    return () => {
      document.removeEventListener('pointerdown', cancel, true);
      window.removeEventListener('blur', cancel);
    };
  }, [gotoOpen, clearGoto]);

  useEffect(() => {
    const onPointerDown = () => {
      lastInputModalityRef.current = 'pointer';
    };
    const onKeyDown = () => {
      lastInputModalityRef.current = 'keyboard';
    };
    const onFocusIn = (event: FocusEvent) => {
      if (
        blocked ||
        panel !== null ||
        Boolean(getDetailKeyboardBridge()?.open || isDetailOpenInDom()) ||
        hasBlockingOverlayOpen()
      ) {
        return;
      }
      const el = event.target;
      if (
        !(el instanceof HTMLAnchorElement) ||
        !el.matches('a.card-open[href]') ||
        !el.closest('.board,.ds-work-table') ||
        !isVisibleBoardLink(el)
      ) {
        return;
      }
      const keyboardFocus =
        lastInputModalityRef.current === 'keyboard' ||
        (lastInputModalityRef.current !== 'pointer' && el.matches(':focus-visible'));
      if (!keyboardFocus) return;
      const ref = itemRefFromLink(el);
      if (ref) setKeyboardCurrentTarget(ref);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocusIn, true);
    };
  }, [blocked, panel]);

  const open = useCallback(
    (kind: 'commands' | 'shortcuts') => {
      if (blocked) return;
      cancelPendingBoardRead();
      clearGoto();
      returnFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (kind === 'commands') {
        const detail = getDetailKeyboardBridge();
        const inDetail = Boolean(detail?.open || isDetailOpenInDom());
        if (inDetail) {
          setCommandTarget(
            detail?.item
              ? {surface: 'detail', ref: {kind: detail.item.kind, id: detail.item.id}}
              : null,
          );
        } else {
          const ref = getKeyboardCurrentTarget();
          setCommandTarget(ref ? {surface: 'board', ref} : null);
        }
      } else {
        setCommandTarget(null);
      }
      setPanel(kind);
    },
    [blocked, cancelPendingBoardRead, clearGoto],
  );

  const close = useCallback(() => {
    setPanel(null);
    setCommandTarget(null);
    requestAnimationFrame(() => {
      if (returnFocus.current?.isConnected) {
        returnFocus.current.focus({preventScroll: true});
      }
    });
  }, []);

  const normalizeWorkbenchRoot = useCallback(() => {
    if (typeof window !== 'undefined' && window.location.pathname === '/workbench/app') {
      window.history.replaceState(
        window.history.state,
        '',
        '/workbench/app/' + window.location.search + window.location.hash,
      );
    }
  }, []);

  const go = useCallback(
    (path: string) => {
      if (blocked) return;
      cancelPendingBoardRead();
      clearGoto();
      setPanel(null);
      setCommandTarget(null);
      void navigate(path);
      if (path === '/') {
        normalizeWorkbenchRoot();
        queueMicrotask(normalizeWorkbenchRoot);
      }
    },
    [blocked, cancelPendingBoardRead, clearGoto, navigate, normalizeWorkbenchRoot],
  );

  useEffect(() => {
    setPanel(null);
    setCommandTarget(null);
    clearGoto();
    if (location.pathname === '/') normalizeWorkbenchRoot();
  }, [location.pathname, location.search, principal.authorization_revision, clearGoto, normalizeWorkbenchRoot]);

  useEffect(() => {
    clearPendingDetailIntent();
  }, [principal.principal_id, principal.authorization_revision]);

  const executeItemShortcut = useCallback(
    (actionId: ShortcutId, expectedTarget?: CapturedCommandTarget | null): boolean => {
      cancelPendingBoardRead();
      const detail = getDetailKeyboardBridge();
      const board = getBoardKeyboardBridge();
      const inDetail = Boolean(detail?.open || isDetailOpenInDom());

      let item: WorkbenchCard | null = null;
      if (expectedTarget !== undefined) {
        if (!expectedTarget) return false;
        if (expectedTarget.surface === 'detail') {
          if (
            !inDetail ||
            !detail?.item ||
            detail.item.kind !== expectedTarget.ref.kind ||
            detail.item.id !== expectedTarget.ref.id
          ) {
            return false;
          }
          item = detail.item;
        } else {
          if (inDetail || !board || board.principalId !== principal.principal_id) {
            return false;
          }
          item =
            board.items.find(
              entry => entry.kind === expectedTarget.ref.kind && entry.id === expectedTarget.ref.id,
            ) ?? null;
          if (!item) return false;
        }
      } else if (inDetail) {
        if (!detail) return false;
        if (!detail.item) {
          if (detail.commandError) {
            showHint('暂时无法确认工单操作，请稍后再试');
            return true;
          }
          return false;
        }
        item = detail.item;
      } else {
        const kbRef = getKeyboardCurrentTarget();
        if (!kbRef || !board) return false;
        item =
          board.items.find(
            entry => entry.kind === kbRef.kind && entry.id === kbRef.id,
          ) ?? null;
        if (!item) return false;
      }

      const subscribeInFlightTicketContext = (
        ticketItem: WorkbenchCard,
        onSettled: () => void,
      ) => {
        const key = ['ticket-command-context', principal.principal_id, ticketItem.id] as const;
        if (queryClient.isFetching({queryKey: key, exact: true}) <= 0) return;
        let disposed = false;
        const dispose = () => {
          if (disposed) return;
          disposed = true;
          unsubscribe();
          document.removeEventListener('focusin', dispose, true);
          if (pendingBoardReadCancelRef.current === dispose) {
            pendingBoardReadCancelRef.current = null;
          }
        };
        const stillValid = () => {
          if (disposed || blocked || hasBlockingOverlayOpen() || isDetailOpenInDom()) return false;
          const activeRef =
            getKeyboardCurrentTarget() ??
            (document.activeElement instanceof HTMLElement
              ? itemRefFromLink(document.activeElement)
              : null);
          return Boolean(activeRef && activeRef.kind === ticketItem.kind && activeRef.id === ticketItem.id);
        };
        const unsubscribe = queryClient.getQueryCache().subscribe(event => {
          const k = event.query.queryKey;
          if (k[0] !== key[0] || k[1] !== key[1] || k[2] !== key[2]) return;
          const state = event.query.state;
          if (state.status === 'pending' || state.fetchStatus !== 'idle') return;
          if (!stillValid()) {
            dispose();
            return;
          }
          dispose();
          onSettled();
        });
        document.addEventListener('focusin', dispose, true);
        pendingBoardReadCancelRef.current = dispose;
      };

      const runBoardAdmittedDetailAction = (
        targetItem: WorkbenchCard,
        action: Extract<TicketCommandAction, 'transfer' | 'complete' | 'note'>,
        unavailableMsg: string,
      ) => {
        const dispatchByAdmission = (admission: TicketActionAdmission): boolean => {
          if (admission === 'denied') {
            showHint(unavailableMsg);
            return true;
          }
          if (admission === 'error') {
            showHint('暂时无法确认工单操作，请稍后再试');
            return true;
          }
          if (admission === 'allowed') {
            setPendingDetailIntent(principal.principal_id, targetItem.kind, targetItem.id, action);
            void navigate(itemLink(targetItem, location.search), {state: {fromBoard: true}});
            return true;
          }
          return false;
        };
        if (dispatchByAdmission(readTicketCommandAdmission(queryClient, principal, targetItem.id, action))) {
          return;
        }
        subscribeInFlightTicketContext(targetItem, () => {
          dispatchByAdmission(readTicketCommandAdmission(queryClient, principal, targetItem.id, action));
        });
      };

      switch (actionId) {
        case 'copy-number': {
          void copyItemNumber(item.number);
          return true;
        }
        case 'claim': {
          if (!isShortcutAvailableForPrincipal('claim', principal, canCreate)) {
            showHint('你没有领取这张工单的权限');
            return true;
          }
          if (
            item.kind !== 'ticket' ||
            isItemActionPending(principal.principal_id, 'ticket', item.id, 'movement')
          ) {
            showHint('这张工单现在不能领取');
            return true;
          }
          if (inDetail && detail) {
            const detailRoot = document.querySelector('.detail-dialog, .detail-page');
            const button = detailRoot?.querySelector<HTMLButtonElement>(
              '[data-action="take-and-start"], [data-action="take-and-start-with-conversations"]',
            );
            if (button && !button.disabled && button.getAttribute('aria-disabled') !== 'true') {
              button.click();
              return true;
            }
            if (detail.commandReady) {
              showHint('这张工单现在不能领取');
            } else if (detail.commandError) {
              showHint('暂时无法确认工单操作，请稍后再试');
            }
            return true;
          }
          if (item.column !== 'pending' || Boolean(item.assignee_name) || !board) {
            showHint('这张工单现在不能领取');
            return true;
          }
          const result = board.triggerBoardClaim(item);
          if (result === 'error') {
            showHint('暂时无法确认工单操作，请稍后再试');
          } else if (result === 'unavailable') {
            showHint('这张工单现在不能领取');
          }
          return true;
        }
        case 'transfer': {
          if (!isShortcutAvailableForPrincipal('transfer', principal, canCreate)) {
            showHint('你没有转交这张工单的权限');
            return true;
          }
          if (
            item.kind !== 'ticket' ||
            item.column === 'handled' ||
            item.closure?.kind === 'DISMISSED'
          ) {
            showHint('这张工单现在不能转交');
            return true;
          }
          if (inDetail && detail) {
            if (detail.commandReady) {
              if (!invokeDetailTransfer(item.id)) {
                showHint('这张工单现在不能转交');
              }
            } else if (detail.commandError) {
              showHint('暂时无法确认工单操作，请稍后再试');
            } else {
              setPendingDetailIntent(principal.principal_id, item.kind, item.id, 'transfer');
            }
            return true;
          }
          runBoardAdmittedDetailAction(item, 'transfer', '这张工单现在不能转交');
          return true;
        }
        case 'complete': {
          if (!isShortcutAvailableForPrincipal('complete', principal, canCreate)) {
            showHint('你没有登记完工的权限');
            return true;
          }
          if (
            item.kind !== 'ticket' ||
            item.column !== 'active' ||
            item.closure?.kind === 'DISMISSED' ||
            !['IN_PROGRESS', 'WAITING_REQUESTER', 'WAITING_VENDOR'].includes(item.status)
          ) {
            showHint('这张工单现在不能登记完工');
            return true;
          }
          if (inDetail && detail) {
            if (detail.commandReady) {
              if (!invokeDetailComplete(item.id)) {
                const detailRoot = document.querySelector('.detail-dialog, .detail-page');
                const stepButton = detailRoot?.querySelector<HTMLButtonElement>(
                  '[data-step-action="complete"]',
                );
                if (
                  stepButton &&
                  !stepButton.disabled &&
                  stepButton.getAttribute('aria-disabled') !== 'true'
                ) {
                  stepButton.click();
                } else {
                  showHint('这张工单现在不能登记完工');
                }
              }
            } else if (detail.commandError) {
              showHint('暂时无法确认工单操作，请稍后再试');
            } else {
              setPendingDetailIntent(principal.principal_id, item.kind, item.id, 'complete');
            }
            return true;
          }
          runBoardAdmittedDetailAction(item, 'complete', '这张工单现在不能登记完工');
          return true;
        }
        case 'close': {
          if (!board) {
            showHint(
              isShortcutAvailableForPrincipal('close', principal, canCreate)
                ? '这张工单现在不能关闭'
                : '你没有关闭这张工单的权限',
            );
            return true;
          }
          const requestedRef =
            inDetail && detail
              ? {kind: detail.kind, id: detail.id}
              : {kind: item.kind, id: item.id};
          const canonicalRef = {kind: item.kind, id: item.id};
          const evaluateClose = () => {
            const liveBoard = getBoardKeyboardBridge() ?? board;
            const liveDetail = getDetailKeyboardBridge();
            const liveItem = (inDetail ? liveDetail?.item : null) ?? item;
            const ticketAdmission =
              !inDetail && liveItem.kind === 'ticket'
                ? readTicketCommandAdmission(queryClient, principal, liveItem.id, 'close')
                : undefined;
            return liveBoard.canCloseItem(liveItem, {
              inDetail,
              detailReady: Boolean(liveDetail?.detailReady),
              ticketAdmission,
            });
          };
          const handleCloseDecision = (closeState: ReturnType<typeof evaluateClose>) => {
            const liveBoard = getBoardKeyboardBridge() ?? board;
            const liveItem = (inDetail ? getDetailKeyboardBridge()?.item : null) ?? item;
            if (closeState === 'allowed') {
              liveBoard.openCloseDialog(liveItem, inDetail);
            } else if (closeState === 'unauthorized') {
              showHint('你没有关闭这张工单的权限');
            } else if (closeState === 'error') {
              showHint('暂时无法确认工单操作，请稍后再试');
            } else if (closeState === 'denied') {
              showHint('这张工单现在不能关闭');
            }
          };
          const closeState = evaluateClose();
          if (closeState === 'allowed') {
            handleCloseDecision(closeState);
          } else {
            let disposed = false;
            let unsubscribeBridge: (() => void) | null = null;
            const cancelProbe = () => {
              if (disposed) return;
              disposed = true;
              unsubscribeBridge?.();
              unsubscribeBridge = null;
              document.removeEventListener('focusin', onFocusCancel, true);
              if (pendingBoardReadCancelRef.current === cancelProbe) {
                pendingBoardReadCancelRef.current = null;
              }
            };
            const onFocusCancel = (event: FocusEvent) => {
              if (
                inDetail &&
                event.target instanceof Element &&
                event.target.closest('.detail-dialog,.detail-page')
              ) {
                return;
              }
              cancelProbe();
            };
            const probeStillValid = () => {
              if (disposed || blocked || hasBlockingOverlayOpen()) return false;
              const liveDetail = getDetailKeyboardBridge();
              const liveDetailOpen = isDetailOpenInDom() || Boolean(liveDetail?.open);
              if (inDetail) {
                return Boolean(
                  liveDetailOpen &&
                    liveDetail &&
                    liveDetail.kind === requestedRef.kind &&
                    liveDetail.id === requestedRef.id &&
                    (!liveDetail.item ||
                      (liveDetail.item.kind === canonicalRef.kind &&
                        liveDetail.item.id === canonicalRef.id)),
                );
              }
              if (liveDetailOpen) return false;
              const activeRef =
                getKeyboardCurrentTarget() ??
                (document.activeElement instanceof HTMLElement
                  ? itemRefFromLink(document.activeElement)
                  : null);
              return Boolean(
                activeRef &&
                  activeRef.kind === canonicalRef.kind &&
                  activeRef.id === canonicalRef.id,
              );
            };
            document.addEventListener('focusin', onFocusCancel, true);
            pendingBoardReadCancelRef.current = cancelProbe;
            const forceRefresh = board.isCloseDraftChecked(item) && !board.hasCloseRecovery(item);
            void board.probeCloseDraft(item, forceRefresh).then(() => {
              if (!probeStillValid()) {
                cancelProbe();
                return;
              }
              const nextState = evaluateClose();
              if (nextState !== 'pending') {
                cancelProbe();
                handleCloseDecision(nextState);
                return;
              }
              if (inDetail) {
                unsubscribeBridge = subscribeKeyboardBridge(() => {
                  if (!probeStillValid()) {
                    cancelProbe();
                    return;
                  }
                  const settledState = evaluateClose();
                  if (settledState !== 'pending') {
                    cancelProbe();
                    handleCloseDecision(settledState);
                  }
                });
                return;
              }
              cancelProbe();
              if (item.kind === 'ticket') {
                subscribeInFlightTicketContext(item, () => {
                  handleCloseDecision(evaluateClose());
                });
              }
            });
          }
          return true;
        }
        case 'follow': {
          if (!isShortcutAvailableForPrincipal('follow', principal, canCreate)) {
            showHint('你没有关注工单的权限');
            return true;
          }
          if (item.attention === undefined || !workbenchTransportWritable()) {
            showHint('这张工单现在不能关注');
            return true;
          }
          if (inDetail) {
            const ctrl = getDetailFollowController(item.kind + ':' + item.id);
            if (!ctrl || !ctrl.canStart) {
              showHint('这张工单现在不能关注');
              return true;
            }
            ctrl.trigger();
            return true;
          }
          const result =
            board?.triggerBoardFollow(item, {
              requireKeyboardTarget: expectedTarget === undefined,
            }) ?? 'unavailable';
          if (result !== 'triggered') {
            showHint('这张工单现在不能关注');
          }
          return true;
        }
        case 'note': {
          if (!isShortcutAvailableForPrincipal('note', principal, canCreate)) {
            showHint('你没有写内部备注的权限');
            return true;
          }
          if (item.kind !== 'ticket' || item.closure?.kind === 'DISMISSED') {
            showHint('这张工单现在不能写内部备注');
            return true;
          }
          if (inDetail && detail) {
            if (detail.commandReady) {
              if (!invokeDetailNoteFocus(item.id)) {
                showHint('这张工单现在不能写内部备注');
              }
            } else if (detail.commandError) {
              showHint('暂时无法确认工单操作，请稍后再试');
            } else {
              setPendingDetailIntent(principal.principal_id, item.kind, item.id, 'note');
            }
            return true;
          }
          runBoardAdmittedDetailAction(item, 'note', '这张工单现在不能写内部备注');
          return true;
        }
        default:
          return false;
      }
    },
    [
      blocked,
      cancelPendingBoardRead,
      canCreate,
      location.search,
      navigate,
      principal,
      queryClient,
      showHint,
    ],
  );

  const allowedGotoDefs = useMemo(
    () =>
      GOTO_SHORTCUT_IDS.map(id => getShortcut(id)).filter(def =>
        isShortcutAvailableForPrincipal(def.id, principal, canCreate),
      ),
    [principal, canCreate],
  );

  useEffect(() => {
    const onCompositionStart = () => {
      composingRef.current = true;
    };
    const onCompositionEnd = (event: CompositionEvent) => {
      composingRef.current = false;
      lastCompositionEndRef.current = event.timeStamp;
    };
    window.addEventListener('compositionstart', onCompositionStart, true);
    window.addEventListener('compositionend', onCompositionEnd, true);
    return () => {
      window.removeEventListener('compositionstart', onCompositionStart, true);
      window.removeEventListener('compositionend', onCompositionEnd, true);
    };
  }, []);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.defaultPrevented ||
        event.repeat ||
        isImeEvent(event, composingRef.current, lastCompositionEndRef.current, event.timeStamp) ||
        blocked ||
        panel ||
        !(target instanceof Element)
      ) {
        return;
      }
      if (target.closest(EDITABLE_SELECTOR)) {
        cancelPendingBoardRead();
        if (gotoOpen) clearGoto();
        return;
      }

      if (hasBlockingOverlayOpen()) {
        cancelPendingBoardRead();
        clearGoto();
        return;
      }

      if (gotoOpen) {
        if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
        cancelPendingBoardRead();
        clearGoto();
        event.preventDefault();
        event.stopPropagation();
        if (!event.ctrlKey && !event.metaKey && !event.altKey) {
          const matched = allowedGotoDefs.find(def =>
            matchesShortcut(event, def.id, gotoPrefixKey()),
          );
          if (matched?.route) {
            go(matched.route);
          }
        }
        return;
      }

      if (matchesShortcut(event, 'undo')) {
        cancelPendingBoardRead();
        if (triggerNewestUndoToast()) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      const detailOpen = Boolean(getDetailKeyboardBridge()?.open || isDetailOpenInDom());

      if (matchesShortcut(event, 'command-panel')) {
        cancelPendingBoardRead();
        if (detailOpen) return;
        event.preventDefault();
        open('commands');
        return;
      }

      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.shiftKey && event.key !== '?') return;
      if (!['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) {
        cancelPendingBoardRead();
      }

      if (matchesShortcut(event, 'help')) {
        event.preventDefault();
        open('shortcuts');
        return;
      }

      if (matchesGotoPrefix(event)) {
        if (allowedGotoDefs.length === 0) return;
        event.preventDefault();
        if (hintTimerRef.current !== null) {
          window.clearTimeout(hintTimerRef.current);
          hintTimerRef.current = null;
        }
        setHint(null);
        setGotoOpen(true);
        gotoTimerRef.current = window.setTimeout(() => {
          gotoTimerRef.current = null;
          setGotoOpen(false);
        }, motionToken('--delay-goto-sequence'));
        return;
      }

      if (detailOpen) {
        const detail = getDetailKeyboardBridge();
        if (matchAlternativeIndex(event, 'open-close-detail') === 1 && detail?.fullPage) {
          event.preventDefault();
          detail.close();
          return;
        }
        const detailMoveIndex = matchAlternativeIndex(event, 'move-vertical');
        if (detailMoveIndex >= 0 && detail && !detail.fullPage) {
          event.preventDefault();
          detail.move(detailMoveIndex === 0 ? 'next' : 'prev');
          return;
        }
        const itemShortcutId = (
          ['claim', 'transfer', 'complete', 'close', 'follow', 'note', 'copy-number'] as const
        ).find(id => matchesShortcut(event, id));
        if (itemShortcutId && executeItemShortcut(itemShortcutId)) {
          event.preventDefault();
        }
        return;
      }

      if (matchesShortcut(event, 'new-report') && canCreate) {
        event.preventDefault();
        go('/reports/new');
        return;
      }

      const board = document.querySelector<HTMLElement>('.board');
      const table = document.querySelector<HTMLElement>('.ds-work-table');
      if (location.pathname !== '/' || (!board && !table)) return;

      if (matchesShortcut(event, 'focus-search') && principal.workbench_search_enabled) {
        const input = document.querySelector<HTMLInputElement>('.workbench-search input[name=q]');
        if (input) {
          event.preventDefault();
          const disclosure = input.closest('details');
          if (disclosure) disclosure.open = true;
          input.focus();
        }
        return;
      }

      if (matchesShortcut(event, 'toggle-view')) {
        const bridge = getBoardKeyboardBridge();
        if (bridge) {
          event.preventDefault();
          bridge.toggleView();
        }
        return;
      }

      if (matchAlternativeIndex(event, 'open-close-detail') === 0) {
        if (
          document.activeElement instanceof Element &&
          document.activeElement.closest('a[href],button,summary')
        ) {
          return;
        }
        const kbRef = getKeyboardCurrentTarget();
        const container = board ?? table;
        const link = kbRef && container ? findCardLink(container, kbRef) : null;
        if (link) {
          event.preventDefault();
          link.click();
        }
        return;
      }

      const colIdx = matchAlternativeIndex(event, 'jump-column');
      if (colIdx >= 0) {
        let firstLink: HTMLAnchorElement | undefined;
        if (board) {
          const col = board.querySelectorAll<HTMLElement>('.board-column')[colIdx];
          firstLink = col
            ? [...col.querySelectorAll<HTMLAnchorElement>('a.card-open[href]')].find(
                isVisibleBoardLink,
              )
            : undefined;
        } else if (table) {
          const stageId = STAGE_TBODY_IDS[colIdx];
          const tbody = stageId ? document.getElementById(stageId) : null;
          firstLink = tbody
            ? [
                ...tbody.querySelectorAll<HTMLAnchorElement>(
                  'tr.ds-work-row:not([hidden]) a.card-open[href]',
                ),
              ].find(isVisibleBoardLink)
            : undefined;
        }
        if (firstLink) {
          event.preventDefault();
          const ref = itemRefFromLink(firstLink);
          if (ref) setKeyboardCurrentTarget(ref);
          firstLink.focus({preventScroll: true});
          firstLink.scrollIntoView({block: 'nearest', inline: 'nearest', behavior: 'instant'});
        }
        return;
      }

      const verticalIndex = matchAlternativeIndex(event, 'move-vertical');
      const horizontalIndex = board ? matchAlternativeIndex(event, 'move-horizontal') : -1;
      if (verticalIndex >= 0 || horizontalIndex >= 0) {
        const kbRef = getKeyboardCurrentTarget();
        if (board) {
          const columns = [...board.querySelectorAll<HTMLElement>('.board-column')].map(column =>
            [...column.querySelectorAll<HTMLAnchorElement>('a.card-open[href]')].filter(
              isVisibleBoardLink,
            ),
          );
          const focusedLink =
            document.activeElement instanceof HTMLAnchorElement &&
            document.activeElement.matches('a.card-open[href]') &&
            board.contains(document.activeElement)
              ? document.activeElement
              : null;
          const activeLink = focusedLink ?? (kbRef ? findCardLink(board, kbRef) : null);
          let column = columns.findIndex(cards => activeLink !== null && cards.includes(activeLink));
          let row = column < 0 || !activeLink ? -1 : (columns[column]?.indexOf(activeLink) ?? -1);
          if (column < 0) {
            column = columns.findIndex(cards => cards.length > 0);
            row = verticalIndex === 1 ? (columns[column]?.length ?? 1) - 1 : 0;
          } else if (verticalIndex >= 0) {
            row = Math.max(
              0,
              Math.min((columns[column]?.length ?? 1) - 1, row + (verticalIndex === 0 ? 1 : -1)),
            );
          } else {
            const step = horizontalIndex === 0 ? -1 : 1;
            for (let nextCol = column + step; nextCol >= 0 && nextCol < columns.length; nextCol += step) {
              if (columns[nextCol]?.length) {
                column = nextCol;
                break;
              }
            }
          }
          const next = columns[column]?.[Math.min(row, (columns[column]?.length ?? 1) - 1)];
          if (next) {
            event.preventDefault();
            const ref = itemRefFromLink(next);
            if (ref) setKeyboardCurrentTarget(ref);
            next.focus({preventScroll: true});
            next.scrollIntoView({block: 'nearest', inline: 'nearest', behavior: 'instant'});
          }
        } else if (table && verticalIndex >= 0) {
          const rows = [
            ...table.querySelectorAll<HTMLAnchorElement>(
              'tr.ds-work-row:not([hidden]) a.card-open[href]',
            ),
          ].filter(isVisibleBoardLink);
          if (!rows.length) return;
          const focusedLink =
            document.activeElement instanceof HTMLAnchorElement &&
            document.activeElement.matches('a.card-open[href]') &&
            table.contains(document.activeElement)
              ? document.activeElement
              : null;
          const activeLink = focusedLink ?? (kbRef ? findCardLink(table, kbRef) : null);
          const currentIndex = activeLink ? rows.indexOf(activeLink) : -1;
          const nextIndex =
            currentIndex < 0
              ? verticalIndex === 1
                ? rows.length - 1
                : 0
              : Math.max(0, Math.min(rows.length - 1, currentIndex + (verticalIndex === 0 ? 1 : -1)));
          const next = rows[nextIndex];
          if (next) {
            event.preventDefault();
            const ref = itemRefFromLink(next);
            if (ref) setKeyboardCurrentTarget(ref);
            next.focus({preventScroll: true});
            next.scrollIntoView({block: 'nearest', inline: 'nearest', behavior: 'instant'});
          }
        }
        return;
      }

      const itemShortcutId = (
        ['claim', 'transfer', 'complete', 'close', 'follow', 'note', 'copy-number'] as const
      ).find(id => matchesShortcut(event, id));
      if (itemShortcutId && executeItemShortcut(itemShortcutId)) {
        event.preventDefault();
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [
    blocked,
    panel,
    gotoOpen,
    allowedGotoDefs,
    canCreate,
    principal,
    location.pathname,
    cancelPendingBoardRead,
    clearGoto,
    go,
    open,
    executeItemShortcut,
  ]);

  const gotoPresence = usePopoverPresence(gotoOpen, {immediateEnter: true});
  const hintPresence = usePopoverPresence(hint !== null, {immediateEnter: true});
  const portalTarget = useMemo(() => {
    if (typeof document === 'undefined') return null;
    const drawerDialog = [...document.querySelectorAll<HTMLElement>('.detail-dialog')].find(
      node => !node.closest('[inert],[aria-hidden=true],[data-exiting]'),
    );
    return drawerDialog ?? document.body;
  }, [gotoPresence.present, hintPresence.present, location.pathname, location.search]);

  return (
    <EfficiencyContext.Provider value={{open: () => open('commands'), blocked}}>
      {children}
      {panel === 'commands' ? (
        <CommandPanel
          key={principal.principal_id + ':' + principal.authorization_revision}
          principal={principal}
          blocked={blocked}
          canCreate={canCreate}
          capturedTarget={commandTarget}
          go={go}
          openShortcuts={() => {
            setCommandTarget(null);
            setPanel('shortcuts');
          }}
          onRunItemAction={(shortcutId, target) => {
            setPanel(null);
            setCommandTarget(null);
            executeItemShortcut(shortcutId, target);
          }}
          close={close}
        />
      ) : null}
      <ShortcutsModal
        isOpen={panel === 'shortcuts'}
        principal={principal}
        canCreate={canCreate}
        onClose={close}
      />
      {portalTarget && (gotoPresence.present || hintPresence.present)
        ? createPortal(
            <div className="ds-shortcut-capsule-host">
              {gotoPresence.present ? (
                <div
                  className="ds-shortcut-capsule"
                  role="status"
                  aria-live="polite"
                  data-goto-chip="true"
                  {...gotoPresence.attributes}
                >
                  <span className="ds-shortcut-capsule-prefix">
                    <Kbd keys={[gotoPrefixKey()]} tone="dark" />
                    <span>前往…</span>
                  </span>
                  <span className="ds-shortcut-capsule-options">
                    {allowedGotoDefs.map((def, index) => (
                      <Fragment key={def.id}>
                        {index > 0 ? <span className="ds-shortcut-capsule-sep"> · </span> : null}
                        <span>
                          {def.keys[1]} {def.label}
                        </span>
                      </Fragment>
                    ))}
                  </span>
                </div>
              ) : null}
              {hintPresence.present && !gotoPresence.present ? (
                <div
                  className="ds-shortcut-capsule"
                  role="status"
                  aria-live="polite"
                  data-shortcut-hint="true"
                  {...hintPresence.attributes}
                >
                  <span>{hint?.text ?? lastHintText}</span>
                </div>
              ) : null}
            </div>,
            portalTarget,
          )
        : null}
    </EfficiencyContext.Provider>
  );
}

function ShortcutsModal({
  isOpen,
  principal,
  canCreate,
  onClose,
}: {
  isOpen: boolean;
  principal: Principal;
  canCreate: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [wasOpen, setWasOpen] = useState(false);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (!isOpen && query) setQuery('');
  }
  const normalized = query.trim().toLowerCase();
  const visibleGroups = useMemo(
    () =>
      SHORTCUT_GROUPS.map(group => ({
        group,
        items: SHORTCUTS.filter(
          def =>
            def.group === group &&
            isShortcutAvailableForPrincipal(def.id, principal, canCreate) &&
            (!normalized ||
              def.label.toLowerCase().includes(normalized) ||
              def.keys.join(' ').toLowerCase().includes(normalized)),
        ),
      })).filter(entry => entry.items.length > 0),
    [principal, canCreate, normalized],
  );
  return (
    <Modal.Backdrop
      className="workbench-modal-backdrop"
      isOpen={isOpen}
      onOpenChange={value => {
        if (!value) onClose();
      }}
      isDismissable
    >
      <Modal.Container size="md">
        <Modal.Dialog
          className="efficiency-help"
          data-shortcuts-dialog="true"
          aria-label="快捷键"
        >
          <header>
            <Modal.Heading>快捷键</Modal.Heading>
            <Button tone="ghost" isIconOnly aria-label="关闭快捷键" onPress={onClose}>
              <X size={16} />
            </Button>
          </header>
          <div className="efficiency-help-search">
            <SearchField
              autoFocus
              aria-label="搜索快捷键"
              placeholder="搜索操作，例如「领取」"
              value={query}
              onChange={event => setQuery(event.target.value)}
              onClear={() => setQuery('')}
            />
          </div>
          {visibleGroups.length ? (
            <div className="efficiency-help-grid">
              {visibleGroups.map(({group, items}) => (
                <section key={group} className="efficiency-help-group" aria-label={group}>
                  <h3>{group}</h3>
                  <div className="efficiency-help-list">
                    {items.map(def => (
                      <div
                        key={def.id}
                        className="efficiency-help-row"
                        data-shortcut-id={def.id}
                      >
                        <span className="efficiency-help-label">{def.label}</span>
                        <Kbd
                          keys={shortcutKeys(def.id)}
                          separator={shortcutSeparator(def.id)}
                          decorative={false}
                        />
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="efficiency-help-empty">
              <EmptyState size="compact" title="没有匹配的快捷键" />
            </div>
          )}
          <footer className="efficiency-help-footer">
            输入文字、填写表单时，单键快捷键自动暂停。没有权限的操作不会执行。
          </footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

interface CommandOption {
  key: string;
  name: string;
  description: string;
  icon: LucideIcon;
  shortcutId?: ShortcutId;
  action: () => void;
}

function CommandPanel({
  principal,
  blocked,
  canCreate,
  capturedTarget,
  go,
  openShortcuts,
  onRunItemAction,
  close,
}: {
  principal: Principal;
  blocked: boolean;
  canCreate: boolean;
  capturedTarget: CapturedCommandTarget | null;
  go: (path: string) => void;
  openShortcuts: () => void;
  onRunItemAction: (id: ShortcutId, target: CapturedCommandTarget | null) => void;
  close: () => void;
}) {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const id = useId();
  useKeyboardBridgeRevision();
  useCommandRecoveryRevision();
  const boardBridge = getBoardKeyboardBridge();
  const detailBridge = getDetailKeyboardBridge();
  const currentItem = useMemo(() => {
    if (!capturedTarget) return null;
    if (capturedTarget.surface === 'detail') {
      return detailBridge?.open &&
        detailBridge.item &&
        detailBridge.item.kind === capturedTarget.ref.kind &&
        detailBridge.item.id === capturedTarget.ref.id
        ? detailBridge.item
        : null;
    }
    if (detailBridge?.open || !boardBridge || boardBridge.principalId !== principal.principal_id) {
      return null;
    }
    return (
      boardBridge.items.find(
        entry => entry.kind === capturedTarget.ref.kind && entry.id === capturedTarget.ref.id,
      ) ?? null
    );
  }, [capturedTarget, detailBridge, boardBridge, principal.principal_id]);

  const ticketContext = useQuery({
    queryKey: ['ticket-command-context', principal.principal_id, currentItem?.id ?? ''],
    queryFn: ({signal}) => api.ticketCommandContext(currentItem!.id, signal),
    enabled: Boolean(
      currentItem &&
        currentItem.kind === 'ticket' &&
        isWorkerAccount(principal) &&
        !blocked,
    ),
    refetchOnMount: false,
  });

  const inDetail = Boolean(capturedTarget?.surface === 'detail' && detailBridge?.open);
  const probeCloseDraft = boardBridge?.probeCloseDraft;
  useEffect(() => {
    if (currentItem && probeCloseDraft) void probeCloseDraft(currentItem, true);
  }, [currentItem?.kind, currentItem?.id, probeCloseDraft]);
  const itemKey = currentItem ? currentItem.kind + ':' + currentItem.id : null;
  useDemandFollowHost(
    'command-panel',
    currentItem,
    !inDetail &&
      Boolean(
        currentItem &&
          principal.workbench_follow_enabled === true &&
          currentItem.attention !== undefined &&
          !blocked,
      ),
  );
  const boardFollowState = useBoardFollowHostState(principal.principal_id, !inDetail ? itemKey : null);
  const opt = useItemOptimisticState(
    principal.principal_id,
    currentItem?.kind ?? 'ticket',
    currentItem?.id ?? '',
    currentItem?.intake_id,
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(text.trim()), 180);
    return () => window.clearTimeout(timer);
  }, [text]);

  let criteria: WorkbenchSearchCriteria | null = null;
  try {
    criteria = parseSearchRequest(
      new URLSearchParams({q: query, range: 'all', scope: 'team', column: 'all'}),
    ).criteria;
  } catch {
    /* Invalid pasted text stays in the input and never becomes a request. */
  }

  const searched = useQuery({
    queryKey: [
      'board',
      principal.principal_id,
      'search',
      'commands',
      query,
      principal.authorization_revision,
      principal.expires_epoch_ms,
      [...principal.roles].sort().join(','),
    ],
    enabled:
      principal.workbench_search_enabled === true &&
      Boolean(query) &&
      criteria !== null &&
      !blocked,
    queryFn: ({signal}) => {
      if (!criteria) throw new TypeError('SEARCH_CRITERIA_REQUIRED');
      return api.search(criteria, null, signal, principal.csrf_token);
    },
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const current = query === text.trim();
  const items =
    principal.workbench_search_enabled === true &&
    criteria !== null &&
    !blocked &&
    current &&
    searched.isSuccess &&
    !searched.isError
      ? searched.data.items
      : [];

  const targetCommands: CommandOption[] = [];
  if (currentItem) {
    const desc = '对当前工单 · ' + currentItem.number;
    const contextSnapshot = currentItem.kind === 'ticket' ? ticketContext : undefined;
    const claimAdmission =
      currentItem.kind === 'ticket'
        ? evaluateTicketCommandQueryAdmission(principal, contextSnapshot, 'claim')
        : 'denied';
    const transferAdmission =
      currentItem.kind === 'ticket'
        ? evaluateTicketCommandQueryAdmission(principal, contextSnapshot, 'transfer')
        : 'denied';
    const completeAdmission =
      currentItem.kind === 'ticket'
        ? evaluateTicketCommandQueryAdmission(principal, contextSnapshot, 'complete')
        : 'denied';
    const noteAdmission =
      currentItem.kind === 'ticket'
        ? evaluateTicketCommandQueryAdmission(principal, contextSnapshot, 'note')
        : 'denied';
    const ticketCloseAdmission: TicketActionAdmission | undefined =
      currentItem.kind === 'ticket'
        ? evaluateTicketCommandQueryAdmission(principal, contextSnapshot, 'close')
        : undefined;
    const canClaimTarget =
      isShortcutAvailableForPrincipal('claim', principal, canCreate) &&
      currentItem.kind === 'ticket' &&
      !isItemActionPending(principal.principal_id, 'ticket', currentItem.id, 'movement') &&
      claimAdmission === 'allowed' &&
      (inDetail || (currentItem.column === 'pending' && !currentItem.assignee_name));
    if (canClaimTarget) {
      targetCommands.push({
        key: 'item:claim',
        name: getShortcut('claim').label,
        description: desc,
        icon: UserRound,
        shortcutId: 'claim',
        action: () => onRunItemAction('claim', capturedTarget),
      });
    }
    if (
      isShortcutAvailableForPrincipal('transfer', principal, canCreate) &&
      currentItem.kind === 'ticket' &&
      currentItem.column !== 'handled' &&
      currentItem.closure?.kind !== 'DISMISSED' &&
      transferAdmission === 'allowed'
    ) {
      targetCommands.push({
        key: 'item:transfer',
        name: getShortcut('transfer').label,
        description: desc,
        icon: UserRound,
        shortcutId: 'transfer',
        action: () => onRunItemAction('transfer', capturedTarget),
      });
    }
    if (
      isShortcutAvailableForPrincipal('complete', principal, canCreate) &&
      currentItem.kind === 'ticket' &&
      currentItem.column === 'active' &&
      currentItem.closure?.kind !== 'DISMISSED' &&
      completeAdmission === 'allowed'
    ) {
      targetCommands.push({
        key: 'item:complete',
        name: getShortcut('complete').label,
        description: desc,
        icon: CheckCircle2,
        shortcutId: 'complete',
        action: () => onRunItemAction('complete', capturedTarget),
      });
    }
    const followAvailable = Boolean(
      isShortcutAvailableForPrincipal('follow', principal, canCreate) &&
        currentItem.attention !== undefined &&
        workbenchTransportWritable() &&
        itemKey &&
        (inDetail
          ? getDetailFollowController(itemKey)?.canStart
          : boardFollowState?.canStart),
    );
    if (followAvailable && currentItem.attention) {
      const displayFollowing = opt.followTarget ?? currentItem.attention.following;
      targetCommands.push({
        key: 'item:follow',
        name: displayFollowing ? '取消关注' : '关注',
        description: desc,
        icon: Star,
        shortcutId: 'follow',
        action: () => onRunItemAction('follow', capturedTarget),
      });
    }
    if (
      isShortcutAvailableForPrincipal('note', principal, canCreate) &&
      currentItem.kind === 'ticket' &&
      currentItem.closure?.kind !== 'DISMISSED' &&
      noteAdmission === 'allowed'
    ) {
      targetCommands.push({
        key: 'item:note',
        name: getShortcut('note').label,
        description: desc,
        icon: Lock,
        shortcutId: 'note',
        action: () => onRunItemAction('note', capturedTarget),
      });
    }
    targetCommands.push({
      key: 'item:copy',
      name: getShortcut('copy-number').label,
      description: desc,
      icon: Copy,
      shortcutId: 'copy-number',
      action: () => onRunItemAction('copy-number', capturedTarget),
    });
    if (
      boardBridge?.canCloseItem(currentItem, {
        inDetail,
        detailReady: Boolean(detailBridge?.detailReady),
        ticketAdmission: ticketCloseAdmission,
      }) === 'allowed'
    ) {
      targetCommands.push({
        key: 'item:close',
        name: getShortcut('close').label,
        description: desc,
        icon: CircleX,
        shortcutId: 'close',
        action: () => onRunItemAction('close', capturedTarget),
      });
    }
  }

  const workspaceCommands: CommandOption[] = [
    ...(canCreate
      ? [
          {
            key: 'ws:new-report',
            name: '新报修',
            description: '工作区操作',
            icon: Plus,
            shortcutId: 'new-report' as const,
            action: () => go('/reports/new'),
          },
        ]
      : []),
    boardBridge?.view === 'list'
      ? {
          key: 'ws:view-board',
          name: '切到看板',
          description: '工作区操作',
          icon: LayoutGrid,
          shortcutId: 'toggle-view' as const,
          action: () => {
            close();
            boardBridge.toggleView();
          },
        }
      : {
          key: 'ws:view-list',
          name: '切到列表',
          description: '工作区操作',
          icon: LayoutList,
          shortcutId: 'toggle-view' as const,
          action: () => go('/?view=list'),
        },
    ...(principal.conversation_workspace_enabled
      ? [
          {
            key: 'ws:conversations',
            name: '打开会话',
            description: '工作区操作',
            icon: MessageSquare,
            shortcutId: 'goto-conversations' as const,
            action: () => go('/conversations'),
          },
        ]
      : []),
    ...(principal.notification_exceptions_enabled
      ? [
          {
            key: 'ws:exceptions',
            name: '打开通知异常',
            description: '工作区操作',
            icon: TriangleAlert,
            shortcutId: 'goto-exceptions' as const,
            action: () => go('/notification-exceptions'),
          },
        ]
      : []),
    {
      key: 'ws:help',
      name: getShortcut('help').label,
      description: '工作区操作',
      icon: HelpCircle,
      shortcutId: 'help' as const,
      action: openShortcuts,
    },
  ];

  const filterText = text.trim().toLowerCase();
  const commands = [...workspaceCommands, ...targetCommands].filter(
    command => !filterText || command.name.toLowerCase().includes(filterText),
  );

  const options: CommandOption[] = [
    ...commands,
    ...items.map(item => ({
      key: 'search:' + item.kind + ':' + item.id,
      name: item.number + ' · ' + item.title,
      description: [item.reporter_name, item.reporter_department]
        .filter(Boolean)
        .join(' · '),
      icon: ArrowUpRight,
      action: () => go('/items/' + item.kind + '/' + item.id),
    })),
  ];

  const index = Math.min(selected, Math.max(0, options.length - 1));
  useEffect(() => {
    document
      .getElementById(id + '-' + index)
      ?.scrollIntoView({block: 'nearest', behavior: 'instant'});
  }, [id, index, options.length]);

  return (
    <Modal.Backdrop
      className="workbench-modal-backdrop"
      isOpen
      onOpenChange={value => {
        if (!value) close();
      }}
      isDismissable
    >
      <Modal.Container size="md">
        <Modal.Dialog className="efficiency-panel" aria-label="搜索与快捷操作">
          <header>
            <Modal.Heading>搜索与快捷操作</Modal.Heading>
            <Button tone="ghost" isIconOnly aria-label="关闭快捷操作" onPress={close}>
              <X size={18} />
            </Button>
          </header>
          <SearchField
            autoFocus
            role="combobox"
            aria-label="搜索工单号、报修人或科室"
            aria-expanded="true"
            aria-controls={id}
            aria-autocomplete="list"
            aria-activedescendant={options.length ? id + '-' + index : undefined}
            placeholder="工单号、报修人、科室，或输入操作名称"
            value={text}
            maxLength={128}
            disabled={blocked}
            onChange={event => {
              setText(event.target.value);
              setSelected(0);
            }}
            onKeyDown={event => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                setSelected(value =>
                  Math.max(
                    0,
                    Math.min(
                      options.length - 1,
                      value + (event.key === 'ArrowDown' ? 1 : -1),
                    ),
                  ),
                );
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                const option = options[index];
                if (option) option.action();
              }
            }}
          />
          <p className="efficiency-hint">
            {principal.workbench_search_enabled
              ? '搜索全部当前可查看的事项。'
              : '当前可使用以下工作区操作。'}
          </p>
          <div className="efficiency-results" id={id} role="listbox" aria-label="工单和操作">
            {options.map((option, i) => {
              const Icon = option.icon;
              return (
                <Button
                  key={option.key}
                  id={id + '-' + i}
                  role="option"
                  aria-selected={i === index}
                  className="efficiency-result"
                  tone="ghost"
                  isDisabled={blocked}
                  onFocus={() => setSelected(i)}
                  onPress={option.action}
                >
                  <Icon size={18} />
                  <span>
                    <strong>{option.name}</strong>
                    <small>{option.description}</small>
                  </span>
                  {option.shortcutId ? (
                    <Kbd
                      keys={shortcutKeys(option.shortcutId)}
                      separator={shortcutSeparator(option.shortcutId)}
                      className="efficiency-result-kbd"
                    />
                  ) : null}
                </Button>
              );
            })}
          </div>
          <p className="efficiency-status" role="status">{blocked?'请先完成当前操作。':criteria===null?'搜索文字包含不支持的字符，请修改后重试。':principal.workbench_search_enabled&&(query&&!current||query&&searched.isPending)?'正在搜索…':query&&searched.isError?errorMessage(searched.error):query&&!options.length?'没有找到当前可查看的事项或操作。':searched.data?.next_cursor?'仅显示首批结果；缩小搜索范围可找到更多事项。':'↑ ↓ 选择 · Enter 打开 · Esc 关闭'}</p>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
