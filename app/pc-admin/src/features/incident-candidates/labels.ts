/**
 * Codex review (card 34C): service status values are shown in business Chinese, never as the raw enumeration. Every value has a
 * label (the records are exhaustive), and tests check each one.
 */
export const subscriptionStatusLabels:Readonly<Record<'PENDING_DESTINATION'|'ACTIVE'|'PAUSED'|'ENDED',string>>={PENDING_DESTINATION:'待配置通知渠道',ACTIVE:'通知中',PAUSED:'已暂停',ENDED:'已结束'};
export const impactLabels:Readonly<Record<'UNKNOWN'|'IMPACTED'|'RECOVERED',string>>={UNKNOWN:'影响未确认',IMPACTED:'受影响',RECOVERED:'已恢复'};
export const linkStateLabels:Readonly<Record<'CANDIDATE'|'LINKED'|'UNLINKED'|'REJECTED',string>>={CANDIDATE:'待确认关联',LINKED:'已关联',UNLINKED:'已取消关联',REJECTED:'已排除'};
export const sendEffectLabels:Readonly<Record<'NOT_ATTEMPTED'|'ACKNOWLEDGED'|'UNKNOWN',string>>={NOT_ATTEMPTED:'尚未发送',ACKNOWLEDGED:'渠道已确认收到',UNKNOWN:'发送结果未确认'};
export function label<K extends string>(labels:Readonly<Record<K,string>>,value:K):string{return labels[value]??'状态未知';}
