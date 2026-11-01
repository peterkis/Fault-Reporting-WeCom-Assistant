import type {WorkbenchWebUrge} from '../../../../../contracts/workbench_web_report_contracts';
import {Bell} from 'lucide-react';
import {UrgencyTag} from '../../design/components/Tag/Tag';
export function WebReportUrgency({value}:{value:WorkbenchWebUrge|undefined}){
 if(!value?.active)return null;
 return <UrgencyTag title={value.last_urged_at?'最近催单：'+value.last_urged_at+'（北京时间）':undefined}><Bell/>本轮已催单{value.count>1?' · '+value.count+' 次':''}</UrgencyTag>;
}
