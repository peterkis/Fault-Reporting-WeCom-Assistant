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

/** The purpose label shown as a notice's title when no outcome title is given. */
const labels:Record<string,string>={'ticket-assignment':'派单','ticket-self-handling':'接单','ticket-conversation-handling':'接单','ticket-completion':'完工','ticket-notes':'内部备注','ticket-reopen':'重新打开工单','ticket-unassign':'解除分派','ticket-takeover':'接管工单','ticket-takeover-completion':'接管与完工','ticket-return-to-dispatch':'退回调度','ticket-waiting-cancel':'关闭事项','ticket-waiting-request-information':'等待补充','ticket-waiting-wait-vendor':'等待厂商','ticket-waiting-resume':'恢复处理','web-report':'公开进度','attachments':'报修资料','item-follow':'关注','board-actions':'看板操作','manual-report':'登记报修','manual-review':'报修复核','conversations':'会话操作','source-groups':'来源群','reminders':'提醒设置','supplement-follow-up':'补充材料','follow-up':'跟进安排','incident-candidates':'公共故障','draft':'恢复状态'};
/** Card 33: the title of a notice, or null when it has neither an outcome title nor a purpose label and its message is a single line. */
export function toastHeading(title:string|undefined,source:string):string|null{
  return title||labels[source]||null;
}

/** Card 33: the tone drives the colour block and its icon. */
export type ToastTone='success'|'info'|'warning'|'danger'|'loading';
export function toastTone(type:string,className?:string):ToastTone{
  return type==='loading'?'loading':type==='success'?'success':type==='error'?'danger':className==='is-warning'?'warning':'info';
}
