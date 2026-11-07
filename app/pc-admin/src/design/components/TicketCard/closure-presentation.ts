import type {ClosureReasonCode,ClosureSecondaryReasonCode} from '../../../../../../contracts/unified_closure_contracts';

export interface ClosureOption<T extends string> {value:T;label:string;hint?:string}
export const closureReasons:readonly ClosureOption<ClosureReasonCode>[]=[
 {value:'FALSE_REPORT_OR_TEST',label:'误报或测试'},{value:'DUPLICATE',label:'重复报修',hint:'可关联原单'},{value:'NOT_IT_SCOPE',label:'非 IT 范围'},
 {value:'REPORTER_WITHDREW',label:'报修人撤回'},{value:'REPORTER_UNREACHABLE',label:'无法联系报修人'},{value:'OTHER',label:'其他',hint:'需填写说明'},
];
/** Card 29 K1: why an item is outside IT. Existing codes, display names only; manual review keeps its own eight reasons. */
export const closureSecondaryReasons:readonly ClosureOption<ClosureSecondaryReasonCode>[]=[
 {value:'BUSINESS_CONSULTATION_CONFIRMED',label:'业务咨询',hint:'不是故障，只需解答'},
 {value:'OUT_OF_SCOPE_CONFIRMED',label:'其他部门职责',hint:'后勤、设备、医务等'},
 {value:'SERVICE_REQUEST_CONFIRMED',label:'服务请求',hint:'需走申请流程'},
];
/** Every code a stored closure or an unfinished command may still carry. */
export const knownClosureSecondaryCodes:readonly ClosureSecondaryReasonCode[]=['HUMAN_CONFIRMED','INFORMATION_INSUFFICIENT','BUSINESS_CONSULTATION_CONFIRMED','ACKNOWLEDGED','OUT_OF_SCOPE_CONFIRMED','SERVICE_REQUEST_CONFIRMED','INCIDENT_REVIEW_PENDING','STALE_REVIEW_CANCELLED'];
const closingSecondary=new Map<string,string>(closureSecondaryReasons.map(option=>[option.value,option.label]));
/** Closure records, card and list reason labels use the dialog's names; older codes keep their recorded label. */
export function closureSecondaryLabel(secondary:{code:string;label:string}|null|undefined):string|null{
 return secondary?closingSecondary.get(secondary.code)??secondary.label:null;
}
export function closureReasonText(closure:{reason_code?:string|null;reason_label?:string|null;secondary_reason?:{code:string;label:string}|null}):string{
 const secondary=closure.reason_code==='NOT_IT_SCOPE'?closureSecondaryLabel(closure.secondary_reason):null;
 return (closure.reason_label??'已关闭')+(secondary?' · '+secondary:'');
}
/** Card 29 L5: only the reporter-facing ticket number is shown; an internal reference is never displayed. */
export function externalTicketNumber(value:string|null|undefined):string|null{return value&&/^IT-[0-9]/u.test(value)?value:null;}
export interface ClosureFormValue {reason:ClosureReasonCode|'';secondary:ClosureSecondaryReasonCode|'';note:string;duplicate:string;notify:boolean}
export const emptyClosureForm:ClosureFormValue={reason:'',secondary:'',note:'',duplicate:'',notify:false};
export function closureValidation(value:ClosureFormValue):string|null{
 if(!value.reason)return '请选择关闭原因。';
 if(value.reason==='NOT_IT_SCOPE'&&!closingSecondary.has(value.secondary))return '请选择非 IT 范围的具体情况。';
 if(value.reason==='OTHER'&&!value.note.trim())return '选择“其他”时必须填写说明。';
 if(value.note.length>2000)return '说明不能超过 2000 字。';
 return null;
}
export function closureNotification(value:ClosureFormValue):{notify:boolean;text:string}{
 const texts:Record<ClosureReasonCode,string>={FALSE_REPORT_OR_TEST:'',DUPLICATE:'您的报修与已有报修重复，我们会在原报修中继续跟进。',NOT_IT_SCOPE:'您反映的问题不属于信息科受理范围，建议联系相关部门处理。',REPORTER_WITHDREW:'已按您的要求撤销本次报修。',REPORTER_UNREACHABLE:'多次联系未果，本次报修已关闭。如仍需处理，请重新报修。',OTHER:'您的报修已关闭。如仍需处理，请重新报修。'};
 const notify=Boolean(value.reason&&value.reason!=='FALSE_REPORT_OR_TEST'&&(value.reason!=='OTHER'||value.notify));
 return {notify,text:notify&&value.reason?texts[value.reason]+(value.reason==='DUPLICATE'&&value.duplicate?'原报修编号：'+value.duplicate:''):''};
}
