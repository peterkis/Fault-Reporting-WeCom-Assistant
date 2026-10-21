import { clsx, type ClassValue } from 'clsx';
// H5 uses semantic component classes; no utility-conflict resolver is needed.
export function cn(...inputs: ClassValue[]) { return clsx(inputs); }
export function safeAvatarURL(value:string|null|undefined):string|null { if(!value)return null;try{const url=new URL(value,window.location.origin);return url.origin===window.location.origin&&(/^(?:\/api\/|\/wecom\/yixiaoxiu\/)/.test(url.pathname))?url.href:null;}catch{return null;} }
export function safePhone(value: string | null | undefined): string | null {
  return value && /^[+\d][\d ()-]{2,24}$/.test(value) ? 'tel:' + value.replace(/[ ()-]/g, '') : null;
}
export function safeMemberLink(value: string | null | undefined): string | null {
  if (!value) return null;
  try { const url = new URL(value, window.location.origin); return url.origin === window.location.origin && url.pathname.startsWith('/wecom/') ? url.pathname + url.search + url.hash : null; } catch { return null; }
}
const dateFormatters=new Map<string,Intl.DateTimeFormat>();
export function formatDate(epoch: string | null | undefined, language: string, timeOnly = false): string {
  if (!epoch || !/^\d+$/.test(epoch)) return '';
  const value = Number(epoch);
  if (!Number.isSafeInteger(value) || !Number.isFinite(new Date(value).getTime())) return '';
  const locale=/^zh/i.test(language)?'zh-CN':'en',key=locale+':'+String(timeOnly);let formatter=dateFormatters.get(key);
  if(!formatter){formatter=new Intl.DateTimeFormat(locale,{timeZone:'Asia/Shanghai',...(timeOnly?{hour:'2-digit',minute:'2-digit'}:{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})});dateFormatters.set(key,formatter);}
  return formatter.format(value);
}
