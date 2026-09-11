import { frozen,guard,hashText } from './p2-012-domain-contracts.mjs';
const MILESTONES=Object.freeze({'incident.confirmed':['PUBLIC_INCIDENT_CONFIRMED','已确认公共故障，个人工单仍保留。'],
  'incident.investigating':['PUBLIC_INCIDENT_INVESTIGATING','公共故障正在调查处理。'],
  'incident.resolved':['PUBLIC_INCIDENT_RESOLVED','公共故障已恢复，如仍异常请通过原工单反馈。'],
  'incident.closed':['PUBLIC_INCIDENT_CLOSED','公共故障处理已关闭，个人工单状态保持独立。']});
export function createP2012ReporterTimelineAdapter({pool,enabled=false}){
  return Object.freeze({async milestones({ticketId,transaction=pool,memberRead=false}){
    if(!enabled)return [];
    const q=await transaction.query(`SELECT e.id,i.incident_no,i.service_family,e.new_scope,e.new_status,e.occurred_at,e.event_type,e.event_ordinal
      FROM incident.incident_event e JOIN incident.incident i ON i.id=e.incident_id
      WHERE e.event_type=ANY($2::text[]) AND (NOT $3::boolean OR i.retention_until_epoch_ms>platform.physical_epoch_ms())
      AND EXISTS(SELECT 1 FROM incident.incident_report r WHERE r.incident_id=i.id AND r.ticket_id=$1::uuid AND r.link_state='LINKED')
      ORDER BY e.occurred_at DESC,e.event_ordinal DESC,e.id DESC LIMIT 100`,[ticketId,Object.keys(MILESTONES),memberRead]);
    return frozen(q.rows.reverse().map(r=>({ref:hashText(r.id).slice(0,32),milestone:MILESTONES[r.event_type][0],text:MILESTONES[r.event_type][1],
      incident_no:r.incident_no,service_family:r.service_family,confirmed_scope:r.new_scope,public_status:r.new_status,
      occurred_at:r.occurred_at,source_rank:1,source_ordinal:String(r.event_ordinal)})));
  }});
}
