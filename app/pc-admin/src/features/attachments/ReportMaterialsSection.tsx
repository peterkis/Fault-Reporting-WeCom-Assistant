import type {Principal} from '../../api/client';
import {createPortal} from 'react-dom';
import {Section} from '../../design/components/Section/Section';
import {AttachmentSection} from './AttachmentSection';
import {WebReportSection} from '../web-report/WebReportSection';
import {WebReportUrgency} from '../web-report/WebReportUrgency';
import {useWebReport} from '../web-report/use-web-report';

export function ReportMaterialsSection({principal,kind,id,requested,readReady,reporterName,otherBlocked,onBlockedChange,onMediaOpenChange,urgencyTarget,onCountChange}:{principal:Principal;kind:'ticket'|'review'|'intake';id:string;requested:{kind:'ticket'|'review'|'intake';id:string};readReady:boolean;reporterName:string|null;otherBlocked:boolean;onBlockedChange:(value:boolean)=>void;onMediaOpenChange:(open:boolean)=>void;urgencyTarget?:HTMLElement|null;onCountChange?:((count:number|null)=>void)|undefined}){
  const web=useWebReport(principal,kind,id,readReady);
  const urgency=principal.web_reports_enabled&&web.data?.applicable?<WebReportUrgency value={web.data.urge}/>:null;
  return <Section className="report-materials" title="报修资料" headingClassName="report-materials-heading" aria-label="报修资料" actions={urgencyTarget?undefined:urgency}>
    {urgencyTarget?createPortal(urgency,urgencyTarget):null}
    <AttachmentSection onCountChange={onCountChange} principal={principal} kind={kind} id={id} requested={requested} readReady={readReady} reporterName={reporterName} onOpenChange={onMediaOpenChange} web={web}/>
    {principal.web_reports_enabled?<WebReportSection principal={principal} kind={kind} id={id} requested={requested} readReady={readReady} otherBlocked={otherBlocked} onBlockedChange={onBlockedChange} view={web}/>:null}
  </Section>;
}
