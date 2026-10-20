import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
export function safeAvatarURL(value:string|null|undefined):string|null { if(!value)return null;try{const url=new URL(value,window.location.origin);return url.origin===window.location.origin&&(/^(?:\/api\/|\/wecom\/yixiaoxiu\/)/.test(url.pathname))?url.href:null;}catch{return null;} }
export function safePhone(value: string | null | undefined): string | null {
  return value && /^[+\d][\d ()-]{2,24}$/.test(value) ? 'tel:' + value.replace(/[ ()-]/g, '') : null;
}
export function safeMemberLink(value: string | null | undefined): string | null {
  if (!value) return null;
  try { const url = new URL(value, window.location.origin); return url.origin === window.location.origin && url.pathname.startsWith('/wecom/') ? url.pathname + url.search + url.hash : null; } catch { return null; }
}
export function formatDate(epoch: string | null | undefined, language: string, timeOnly = false): string {
  if (!epoch || !/^\d+$/.test(epoch)) return '';
  const value = Number(epoch);
  if (!Number.isSafeInteger(value) || !Number.isFinite(new Date(value).getTime())) return '';
  return new Intl.DateTimeFormat(language, {timeZone:'Asia/Shanghai', ...(timeOnly ? {hour:'2-digit',minute:'2-digit'} : {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}).format(value);
}
