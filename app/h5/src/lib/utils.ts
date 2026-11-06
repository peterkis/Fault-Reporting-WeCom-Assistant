import { clsx, type ClassValue } from 'clsx';
// H5 uses semantic component classes; no utility-conflict resolver is needed.
export function cn(...inputs: ClassValue[]) { return clsx(inputs); }
export function safeAvatarURL(value:string|null|undefined):string|null { if(!value)return null;try{const url=new URL(value,window.location.origin);return url.origin===window.location.origin&&(/^(?:\/api\/|\/wecom\/yixiaoxiu\/)/.test(url.pathname))?url.href:null;}catch{return null;} }
export function safePhone(value: string | null | undefined): string | null {
  return value && /^[+\d][\d ()-]{2,24}$/.test(value) ? 'tel:' + value.replace(/[ ()-]/g, '') : null;
}
export function formatPhone(value:string):string {const phone=value.replace(/\s/g,'');return /^\d{8}$/.test(phone)?phone.slice(0,4)+' '+phone.slice(4):/^\d{11}$/.test(phone)?phone.slice(0,3)+' '+phone.slice(3,7)+' '+phone.slice(7):value;}
export async function copyText(text:string):Promise<boolean> {
  try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);return true;}}catch{}
  let textarea:HTMLTextAreaElement|null=null;
  try{textarea=document.createElement('textarea');textarea.value=text;textarea.readOnly=true;textarea.style.cssText='position:fixed;left:-9999px;top:0;font-size:16px';document.body.appendChild(textarea);textarea.select();textarea.setSelectionRange(0,text.length);return document.execCommand('copy');}catch{return false;}finally{textarea?.remove();}
}
export function safeMemberLink(value: string | null | undefined): string | null {
  if (!value) return null;
  try { const url = new URL(value, window.location.origin); return url.origin === window.location.origin && url.pathname.startsWith('/wecom/') ? url.pathname + url.search + url.hash : null; } catch { return null; }
}
const dateFormatters=new Map<string,Intl.DateTimeFormat>();
const calendarFormatter=new Intl.DateTimeFormat('en',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'});
function calendarDay(epoch:number){const parts=calendarFormatter.formatToParts(epoch),year=Number(parts.find(part=>part.type==='year')?.value),month=Number(parts.find(part=>part.type==='month')?.value),day=Number(parts.find(part=>part.type==='day')?.value);return{year,day:Date.UTC(year,month-1,day)/86400000};}
export function formatDate(epoch: string | null | undefined, language: string, timeOnly = false): string {
  if (!epoch || !/^\d+$/.test(epoch)) return '';
  const value = Number(epoch);
  if (!Number.isSafeInteger(value) || !Number.isFinite(new Date(value).getTime())) return '';
  const locale=/^zh/i.test(language)?'zh-CN':'en',current=calendarDay(Date.now()),target=calendarDay(value),difference=target.day-current.day,recent=!timeOnly&&(difference===0||difference===-1),sameYear=target.year===current.year,key=locale+':'+(timeOnly?'time':recent?'recent':sameYear?'date':'year');let formatter=dateFormatters.get(key);
  if(!formatter){formatter=new Intl.DateTimeFormat(locale,{timeZone:'Asia/Shanghai',hour:timeOnly||locale==='zh-CN'?'2-digit':'numeric',minute:'2-digit',...(!timeOnly&&!recent?{month:locale==='en'?'short':'2-digit',day:locale==='en'?'numeric':'2-digit',...(!sameYear?{year:'numeric'}:{})}:{})});dateFormatters.set(key,formatter);}
  if(recent){const label=new Intl.RelativeTimeFormat(locale,{numeric:'auto'}).format(difference,'day');return (locale==='en'?label.charAt(0).toUpperCase()+label.slice(1)+', ':label+' ')+formatter.format(value);}
  return formatter.format(value);
}
