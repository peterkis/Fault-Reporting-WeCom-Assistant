import type {Tone} from './status-map';
import type {WorkbenchCard} from '../api/client';

/** Minutes; shared by every category. Intervals are inclusive at the lower bound. */
export const HEAT_THRESHOLDS_MINUTES = Object.freeze([5, 20, 60, 240] as const);

export interface Heat {
  readonly tone: Extract<Tone, 'neutral' | 'warning' | 'attention' | 'danger'>;
  readonly label: string;
  readonly ring: 'attention' | 'danger' | null;
}

type HeatCard = Pick<WorkbenchCard, 'column' | 'created_at' | 'stage_entered_at'>;

export function cardHeatStart(item: HeatCard): string | null {
  if (item.column === 'pending') return item.created_at;
  if (item.column === 'active') return item.stage_entered_at ?? null;
  return null;
}

/** API civil timestamps are Shanghai time. Missing stage starts never borrow another clock. */
export function cardHeat(item: HeatCard, now: number): Heat | null {
  const start = cardHeatStart(item);
  return heatOf(start ? start.replace(' ', 'T') + '+08:00' : null, now);
}

/** Presentation only; callers with WorkbenchCard data use cardHeat. */
export function heatOf(startIso: string | null | undefined, nowMs: number): Heat | null {
  // Require an explicit zone: a local timestamp must not change heat across machines.
  if (!startIso || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(startIso)) return null;
  const startMs = Date.parse(startIso);
  if (!Number.isFinite(startMs)) return null;
  const day = startIso.slice(0, 10);
  // Date.parse normalizes impossible dates such as February 30; reject those too.
  if (new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) !== day) return null;
  const elapsed = nowMs - startMs;
  if (!Number.isFinite(nowMs) || !Number.isFinite(elapsed) || elapsed < 0) return null;
  const minutes = Math.floor(elapsed / 60_000);
  const [visible, warning, attention, danger] = HEAT_THRESHOLDS_MINUTES;
  if (minutes < visible) return null;
  if (minutes < warning) return {tone: 'neutral', label: minutes + ' 分钟', ring: null};
  if (minutes < attention) return {tone: 'warning', label: minutes + ' 分钟', ring: null};
  const hours = Math.floor(minutes / 60);
  if (minutes < danger) return {tone: 'attention', label: hours + ' 小时', ring: 'attention'};
  return {tone: 'danger', label: '超时 ' + (hours >= 24 ? Math.floor(hours / 24) + ' 天' : hours + ' 小时'), ring: 'danger'};
}
