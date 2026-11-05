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
