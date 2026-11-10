import type {BoardColumn, WorkbenchCard} from '../api/client';
import {cardHeat} from './heat';

export type BoardSummaryFilter = 'pending' | 'overdue' | 'mine' | 'today';
export type BoardSort = 'oldest' | 'newest';

/** The API's civil timestamps are Shanghai time, irrespective of the browser zone. */
function instant(value: string | null) {
  return value ? Date.parse(value.replace(' ', 'T') + '+08:00') : NaN;
}

export function matchesBoardSummary(item: WorkbenchCard, filter: BoardSummaryFilter, now: number): boolean {
  switch (filter) {
    case 'pending': return item.column === 'pending';
    case 'overdue': return cardHeat(item, now)?.tone === 'danger';
    case 'mine': return item.attention?.related_reasons.includes('HANDLING') === true;
    case 'today': {
      const completed = instant(item.completed_at);
      if (item.column !== 'handled' || item.closure?.kind !== 'COMPLETED' || !Number.isFinite(completed) || completed > now) return false;
      return new Date(completed + 8 * 3_600_000).toISOString().slice(0, 10)
        === new Date(now + 8 * 3_600_000).toISOString().slice(0, 10);
    }
  }
}

/** Local presentation only; input order, server cursors and business DTOs remain intact. */
export function sortBoardItems(items: readonly WorkbenchCard[], column: BoardColumn, sort: BoardSort): WorkbenchCard[] {
  if (column === 'active') return [...items];
  const time = (item: WorkbenchCard) => instant(column === 'handled' ? item.closure?.kind === 'DISMISSED' ? item.closure.ended_at : item.completed_at : item.created_at);
  return [...items].sort((a, b) => {
    const left = time(a), right = time(b);
    if (!Number.isFinite(left)) return Number.isFinite(right) ? 1 : 0;
    if (!Number.isFinite(right)) return -1;
    return (left - right) * (sort === 'oldest' ? 1 : -1);
  });
}
