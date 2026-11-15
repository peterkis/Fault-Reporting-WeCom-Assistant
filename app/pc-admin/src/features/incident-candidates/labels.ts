/**
 * Codex review (card 34C): service status values are shown in business Chinese, never as the raw enumeration. Every value has a
 * label (the records are exhaustive), and tests check each one.
 */
import type {IncidentDetail} from '../../../../../contracts/p2_012_contracts';

export const incidentStatusLabels:Readonly<Record<IncidentDetail['status'],string>>={
  CONFIRMED_LOCAL:'已确认',CONFIRMED_BUILDING:'已确认',CONFIRMED_CAMPUS:'已确认',CONFIRMED_HOSPITAL_WIDE:'已确认',
  INVESTIGATING:'调查中',RESOLVED:'已解决',CLOSED:'已关闭',
};
export const incidentScopeLabels:Readonly<Record<IncidentDetail['confirmed_scope'],string>>={
  LOCAL:'局部',BUILDING:'楼宇',CAMPUS:'院区',HOSPITAL_WIDE:'全院',
};
export const manualReviewStatusLabels:Readonly<Record<'PENDING'|'RESOLVED'|'CANCELLED',string>>={
  PENDING:'待复核',RESOLVED:'已处理',CANCELLED:'已取消',
};

export const subscriptionStatusLabels:Readonly<Record<'PENDING_DESTINATION'|'ACTIVE'|'PAUSED'|'ENDED',string>>={PENDING_DESTINATION:'待配置通知渠道',ACTIVE:'通知中',PAUSED:'已暂停',ENDED:'已结束'};
export const impactLabels:Readonly<Record<'UNKNOWN'|'IMPACTED'|'RECOVERED',string>>={UNKNOWN:'影响未确认',IMPACTED:'受影响',RECOVERED:'已恢复'};
export const linkStateLabels:Readonly<Record<'CANDIDATE'|'LINKED'|'UNLINKED'|'REJECTED',string>>={CANDIDATE:'待确认关联',LINKED:'已关联',UNLINKED:'已取消关联',REJECTED:'已排除'};
export const sendEffectLabels:Readonly<Record<'NOT_ATTEMPTED'|'ACKNOWLEDGED'|'UNKNOWN',string>>={NOT_ATTEMPTED:'尚未发送',ACKNOWLEDGED:'渠道已确认收到',UNKNOWN:'发送结果未确认'};
export function label<K extends string>(labels:Readonly<Record<K,string>>,value:K):string{return labels[value]??'状态未知';}
