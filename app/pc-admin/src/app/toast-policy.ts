/** Design system 6.11 (card 32D): success and plain notices close after 4s; unknown, in-progress and error notices stay until closed. */
export const AUTO_DISMISS_MS=4000;
/** At most three notices are visible at once. */
export const MAX_VISIBLE_TOASTS=3;

export function toastDuration({unknown,loading,error,persistent}:{unknown:boolean;loading:boolean;error:boolean;persistent:boolean}):number{
  return unknown||loading||error||persistent?Infinity:AUTO_DISMISS_MS;
}

export interface ToastLike {id:string;visible:boolean;duration?:number|undefined;createdAt:number}
/** The notices to push out when more than three are visible: the oldest that would close on their own; a notice that waits for the user is never pushed out. */
export function overflowToasts<T extends ToastLike>(toasts:readonly T[]):T[]{
  const visible=toasts.filter(item=>item.visible);
  return visible.filter(item=>item.duration!==undefined&&Number.isFinite(item.duration)).sort((a,b)=>a.createdAt-b.createdAt).slice(0,Math.max(0,visible.length-MAX_VISIBLE_TOASTS));
}
