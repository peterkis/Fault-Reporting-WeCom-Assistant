import {heatOf} from './heat';

const shanghaiDate = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
});

/** Both list times and conversation dividers use Shanghai civil days. */
export function shanghaiDays(nowMs: number): {today: string; yesterday: string} {
  return {today: shanghaiDate.format(nowMs), yesterday: shanghaiDate.format(nowMs - 86_400_000)};
}

/** The API supplies YYYY-MM-DD HH:mm:ss in Asia/Shanghai. */
export function formatListTime(local: string, nowMs: number): string {
  const day = local.slice(0, 10), {today, yesterday} = shanghaiDays(nowMs);
  if (day === today) return local.slice(11, 16);
  if (day === yesterday) return '昨天';
  return day.slice(0, 4) === today.slice(0, 4) ? day.slice(5) : day;
}
/** Waiting is a read projection, never inferred from a message or activity clock. */
export function formatWaitingTime(local: string | null | undefined, nowMs: number): {label: string; tone: 'neutral' | 'attention' | 'danger'} | null {
  if (!local || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(local)) return null;
  const startIso = local.replace(' ', 'T') + '+08:00', startMs = Date.parse(startIso);
  if (!Number.isFinite(startMs) || !Number.isFinite(nowMs) || startMs > nowMs || new Date(startMs + 28_800_000).toISOString().slice(0,19) !== local.replace(' ', 'T')) return null;
  const heat = heatOf(startIso, nowMs), minutes = Math.floor((nowMs - startMs) / 60_000);
  return {label: (heat?.label ?? minutes + ' 分钟').replace(/^超时 /u, ''), tone: heat?.tone === 'attention' || heat?.tone === 'danger' ? heat.tone : 'neutral'};
}

/** Shared presentation-only minute clock; subscribing never invalidates or fetches data. */
export function observeVisibleMinute(update: (nowMs: number) => void): () => void {
  let timer: number | undefined;
  const pause = () => {if (timer !== undefined) window.clearInterval(timer); timer = undefined;};
  const resume = () => {pause(); if (!document.hidden) {update(Date.now()); timer = window.setInterval(() => {if (!document.hidden) update(Date.now());}, 60_000);}};
  document.addEventListener('visibilitychange', resume); resume();
  return () => {pause(); document.removeEventListener('visibilitychange', resume);};
}
