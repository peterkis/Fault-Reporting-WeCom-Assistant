import type {WorkbenchWebUrge} from '../../../../../contracts/workbench_web_report_contracts';
export function WebReportUrgency({value}:{value:WorkbenchWebUrge|undefined}){
 if(!value?.active)return null;
 return <span className="status-chip orange web-report-urge" title={value.last_urged_at?'最近催单：'+value.last_urged_at+'（北京时间）':undefined}>本轮已催单{value.count>1?' · '+value.count+' 次':''}</span>;
}
