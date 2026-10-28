import type {Principal} from '../../api/client';
import {AttachmentSection} from './AttachmentSection';
import {WebReportSection} from '../web-report/WebReportSection';
import {WebReportUrgency} from '../web-report/WebReportUrgency';
import {useWebReport} from '../web-report/use-web-report';

export function ReportMaterialsSection({principal,kind,id,requested,readReady,reporterName,otherBlocked,onBlockedChange,onMediaOpenChange}:{principal:Principal;kind:'ticket'|'review'|'intake';id:string;requested:{kind:'ticket'|'review'|'intake';id:string};readReady:boolean;reporterName:string|null;otherBlocked:boolean;onBlockedChange:(value:boolean)=>void;onMediaOpenChange:(open:boolean)=>void}){
  const web=useWebReport(principal,kind,id,readReady);
  return <section className="report-materials" aria-label="报修资料">
    <header className="report-materials-heading"><h3>报修资料</h3>{principal.web_reports_enabled&&web.data?.applicable?<WebReportUrgency value={web.data.urge}/>:null}</header>
    <AttachmentSection principal={principal} kind={kind} id={id} requested={requested} readReady={readReady} reporterName={reporterName} onOpenChange={onMediaOpenChange} web={web}/>
    {principal.web_reports_enabled?<WebReportSection principal={principal} kind={kind} id={id} requested={requested} readReady={readReady} otherBlocked={otherBlocked} onBlockedChange={onBlockedChange} view={web}/>:null}
  </section>;
}
