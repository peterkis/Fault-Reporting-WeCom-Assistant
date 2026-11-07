import type {ClosureReasonCode,ClosureSecondaryReasonCode} from '../../../../../../contracts/unified_closure_contracts';

export const closureReasons:readonly {value:ClosureReasonCode;label:string}[]=[
 {value:'FALSE_REPORT_OR_TEST',label:'误报或测试'},{value:'DUPLICATE',label:'重复报修'},{value:'NOT_IT_SCOPE',label:'非 IT 范围'},
 {value:'REPORTER_WITHDREW',label:'报修人撤回'},{value:'REPORTER_UNREACHABLE',label:'无法联系报修人'},{value:'OTHER',label:'其他'},
];
export const closureSecondaryReasons:readonly {value:ClosureSecondaryReasonCode;label:string}[]=[
 {value:'HUMAN_CONFIRMED',label:'人工核对确认'},{value:'INFORMATION_INSUFFICIENT',label:'描述不足，需要补充'},
 {value:'BUSINESS_CONSULTATION_CONFIRMED',label:'已核对为业务咨询'},{value:'ACKNOWLEDGED',label:'确认收到'},
 {value:'OUT_OF_SCOPE_CONFIRMED',label:'已核对为范围外诉求'},{value:'SERVICE_REQUEST_CONFIRMED',label:'已核对为服务请求'},
 {value:'INCIDENT_REVIEW_PENDING',label:'待公共故障审核'},{value:'STALE_REVIEW_CANCELLED',label:'明确取消旧复核'},
];
export interface ClosureFormValue {reason:ClosureReasonCode|'';secondary:ClosureSecondaryReasonCode|'';note:string;duplicate:string;notify:boolean}
export const emptyClosureForm:ClosureFormValue={reason:'',secondary:'',note:'',duplicate:'',notify:false};
export function closureValidation(value:ClosureFormValue):string|null{
 if(!value.reason)return '请选择关闭原因。';
 if(value.reason==='NOT_IT_SCOPE'&&!value.secondary)return '请选择非 IT 范围的二级原因。';
 if(value.reason==='OTHER'&&!value.note.trim())return '选择“其他”时必须填写说明。';
 if(value.note.length>2000)return '说明不能超过 2000 字。';
 return null;
}
export function closureNotification(value:ClosureFormValue):{notify:boolean;text:string}{
 const texts:Record<ClosureReasonCode,string>={FALSE_REPORT_OR_TEST:'',DUPLICATE:'您的报修与已有报修重复，我们会在原报修中继续跟进。',NOT_IT_SCOPE:'您反映的问题不属于信息科受理范围，建议联系相关部门处理。',REPORTER_WITHDREW:'已按您的要求撤销本次报修。',REPORTER_UNREACHABLE:'多次联系未果，本次报修已关闭。如仍需处理，请重新报修。',OTHER:'您的报修已关闭。如仍需处理，请重新报修。'};
 const notify=Boolean(value.reason&&value.reason!=='FALSE_REPORT_OR_TEST'&&(value.reason!=='OTHER'||value.notify));
 return {notify,text:notify&&value.reason?texts[value.reason]+(value.reason==='DUPLICATE'&&value.duplicate?'原报修编号：'+value.duplicate:''):''};
}
