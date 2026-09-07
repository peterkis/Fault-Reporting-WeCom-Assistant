import { randomUUID } from 'node:crypto';
import { appendCommunication } from './p2-004-communication-core.mjs';
import { hash,fail } from './p2-012-domain-contracts.mjs';

const POLICY=Object.freeze({'incident.confirmed':['INCIDENT_CONFIRMED_GROUP','INCIDENT_CONFIRMED_DIRECT'],
  'incident.investigating':['INCIDENT_INVESTIGATING_DIRECT'],'incident.resolved':['INCIDENT_RESOLVED_GROUP','INCIDENT_RESOLVED_DIRECT'],
  'incident.closed':['INCIDENT_CLOSED_DIRECT']});
const SERVICE=Object.freeze({HIS:'医院信息系统',LIS:'检验信息系统',RIS:'放射信息系统',PACS:'医学影像系统',EMR:'电子病历系统',NETWORK:'网络服务'});
const SCOPE=Object.freeze({LOCAL:'局部',BUILDING:'楼宇',CAMPUS:'院区',HOSPITAL_WIDE:'全院'});
export const incidentNotificationTemplates=type=>POLICY[type]??[];
export function createP2012NotificationPolicy({enabled=false,publicEnabled=false,privateEnabled=false,testLabel=false}){
  return Object.freeze({async project({transaction:tx,incident,event}){
    if(!enabled)return {created:0};
    const fact=await tx.query('SELECT id,event_type FROM incident.incident_event WHERE id=$1::uuid AND incident_id=$2::uuid',[event.id,incident.id]);
    if(fact.rowCount!==1)fail('NOTIFICATION_EVENT_INVALID');
    let created=0;
    for(const template of incidentNotificationTemplates(fact.rows[0].event_type)){
      const group=template.endsWith('_GROUP');if(group?!publicEnabled:!privateEnabled)continue;
      let after=null;
      for(;;){
      const destinations=group?await tx.query(`SELECT DISTINCT ON (l.channel_identity_hash) l.id AS leg_id,l.channel_identity_hash AS binding,
        i.source_bot_id AS account,i.source_chat_id AS target FROM incident.incident_report r
        JOIN intake.channel_leg l ON l.id=r.origin_channel_leg_id JOIN intake.service_intake i ON i.id=l.source_intake_id
        WHERE r.incident_id=$1::uuid AND r.link_state='LINKED' AND l.leg_type IN ('GROUP_ORIGIN','GROUP_CONTINUATION') AND i.source_chat_type='group' AND ($2::text IS NULL OR l.channel_identity_hash>$2)
        ORDER BY l.channel_identity_hash,l.id LIMIT 100`,[incident.id,after]):await tx.query(`SELECT s.id AS subscription_id,l.id AS leg_id,s.reporter_identity_hash AS binding,
        i.source_bot_id AS account,i.reporter_wecom_userid AS target FROM incident.reporter_subscription s
        JOIN intake.channel_leg l ON l.id=s.direct_channel_leg_id AND l.reporter_identity_hash=s.reporter_identity_hash
        JOIN intake.service_intake i ON i.id=l.source_intake_id
        WHERE s.incident_id=$1::uuid AND s.status='ACTIVE' AND l.leg_type IN ('DIRECT_GUIDED','DIRECT_ORGANIC') AND i.source_chat_type='single' AND ($2::text IS NULL OR s.reporter_identity_hash>$2)
        ORDER BY s.reporter_identity_hash LIMIT 100`,[incident.id,after]);
      for(const d of destinations.rows){
        const audience=group?'GROUP':'REPORTER_DIRECT';
        const existing=await tx.query(`SELECT 1 FROM communication.incident_notification_binding WHERE incident_event_id=$1::uuid
          AND audience_type=$2 AND audience_binding_hash=$3 AND template_code=$4 AND template_version='1'`,[event.id,audience,d.binding,template]);
        if(existing.rowCount)continue;
        const resolved=template.includes('RESOLVED'),closed=template.includes('CLOSED'),investigating=template.includes('INVESTIGATING');
        const text=(testLabel?'【P2-012测试】':'')+(resolved?'【IT故障恢复通知】此前公共信息系统故障已恢复。如您的终端仍异常，请通过原工单继续反馈。':
          closed?'【IT故障通知】公共故障处理已关闭，您的个人报修工单仍保留。':
          investigating?'【IT故障通知】信息部门正在调查已确认的公共故障。':
          '【IT故障通知】已确认存在公共信息系统故障，信息部门正在处理。个人报修工单仍保留，请勿重复提交。')+
          '\n受影响服务：'+(SERVICE[incident.service_family]??'信息系统服务')+'\n影响范围：'+SCOPE[incident.confirmed_scope];
        const result=await appendCommunication({transaction:tx,actor:null,command:{session_id:null,sender_kind:'SYSTEM',
          sender_system_code:'HUMAN_CONFIRMED_INCIDENT',purpose:'SYSTEM_NOTIFICATION',message_type:'text',visibility:'EXTERNAL',
          client_command_id:randomUUID(),content:{text},destination_policy:'P2_012_FIXED_NOTICE',privacy_class:'INTERNAL',
          retention_until:incident.retention_until,retention_until_epoch_ms:String(incident.retention_until_epoch_ms)},
          resolvedDestinations:[{provider:'WECOM_AIBOT',channel_account_id:d.account,target_type:group?'GROUP':'PERSON',target_id:d.target}]});
        if(result.error)fail('NOTIFICATION_FAILED',503);
        await tx.query(`INSERT INTO communication.incident_notification_binding(incident_id,incident_event_id,audience_type,audience_binding_hash,
          reporter_subscription_id,origin_channel_leg_id,template_code,template_version,communication_message_id)
          VALUES($1::uuid,$2::uuid,$3,$4,$5::uuid,$6::uuid,$7,'1',$8::uuid)`,[incident.id,event.id,audience,d.binding,d.subscription_id??null,group?d.leg_id:null,template,result.message_id]);
        if(!group)await tx.query('UPDATE incident.reporter_subscription SET last_notified_incident_version=$2,updated_at=platform.local_now() WHERE id=$1::uuid',[d.subscription_id,incident.row_version]);
        created++;
      }
      if(destinations.rows.length<100)break;after=destinations.rows.at(-1).binding;
      }
    }
    return {created};
  }});
}
