import { randomUUID } from 'node:crypto';
import { createP2012IncidentQuery,broad } from './p2-012-incident-query.mjs';
import { normalizeCommand,guard,hash,frozen,fail,transaction,ERROR_CODES } from './p2-012-domain-contracts.mjs';

export function createP2012IncidentCommandService({pool,enabled=false,query=createP2012IncidentQuery({pool,enabled}),
  notifications=null,realtime=null,allowDispatcherCampus=false,maintenanceEnabled=false}){
  async function authorize(tx,authContext,c,system){
    const kind=c.candidate_review_id?'candidate':'incident';
    if(system){if(c.action!=='EXPIRE_CANDIDATE'||!maintenanceEnabled)fail('FORBIDDEN',403);
      const q=await tx.query('SELECT * FROM incident.candidate_review WHERE id=$1::uuid',[c.candidate_review_id]);if(q.rowCount!==1)fail('NOT_FOUND',404);
      return {row:q.rows[0],principal:null,kind};}
    if(c.action==='EXPIRE_CANDIDATE')fail('FORBIDDEN',403);
    const ctx=await query.resource({authContext,id:c.candidate_review_id??c.incident_id,kind,tx});const p=ctx.principal;
    if(!broad(p)&&c.action!=='MARK_REPORTER_RECOVERED')fail('FORBIDDEN',403);
    if(['CORRECT_SCOPE','CLOSE_INCIDENT','PAUSE_SUBSCRIPTION','RESUME_SUBSCRIPTION'].includes(c.action)&&!p.roles.includes('ADMIN'))fail('FORBIDDEN',403);
    if(c.confirmed_scope==='HOSPITAL_WIDE'&&!p.roles.includes('ADMIN'))fail('FORBIDDEN',403);
    if(c.confirmed_scope==='CAMPUS'&&!p.roles.includes('ADMIN')&&!allowDispatcherCampus)fail('FORBIDDEN',403);
    if(c.incident_report_id){
      const r=await tx.query(`SELECT r.ticket_id,t.assignee_id FROM incident.incident_report r LEFT JOIN pilot_ticket.ticket t ON t.id=r.ticket_id
        WHERE r.id=$1::uuid AND r.incident_id=$2::uuid`,[c.incident_report_id,c.incident_id]);
      if(r.rowCount!==1||(!broad(p)&&(!p.roles.includes('HANDLER')||r.rows[0].assignee_id!==p.principal_id)))fail('FORBIDDEN',403);
    }
    if(c.subscription_id&&(await tx.query('SELECT 1 FROM incident.reporter_subscription WHERE id=$1::uuid AND incident_id=$2::uuid',[c.subscription_id,c.incident_id])).rowCount!==1)fail('NOT_FOUND',404);
    for(const id of c.selected_report_refs??(c.source_decision_id?[c.source_decision_id]:[]))await query.source({tx,principal:p,id});
    return {...ctx,kind};
  }
  async function append(tx,ctx,type,{oldStatus=null,newStatus=null,oldScope=null,newScope=null,payload={}}={}){
    const candidate=type.startsWith('candidate.'),target=candidate?ctx.candidate:ctx.incident;
    const ordinal=await tx.query(`UPDATE incident.${candidate?'candidate_review':'incident'} SET event_ordinal=event_ordinal+1 WHERE id=$1::uuid RETURNING event_ordinal`,[target.id]);
    const n=ordinal.rows[0].event_ordinal,id=randomUUID();
    const r=await tx.query(`INSERT INTO incident.incident_event(id,event_key,incident_id,candidate_review_id,event_ordinal,event_type,actor_kind,
      actor_principal_id,old_status,new_status,old_scope,new_scope,source_command_id,safe_payload,payload_hash)
      VALUES($1::uuid,$2,$3::uuid,$4::uuid,$5,$6,$7,$8::uuid,$9,$10,$11,$12,$13::uuid,$14::jsonb,$15) RETURNING *`,
      [id,'incident_event_v1_'+hash({receipt:ctx.receipt.id,type,ordinal:String(n)}),candidate?null:target.id,candidate?target.id:null,n,type,
        ctx.principal?'HUMAN':'SYSTEM',ctx.principal?.principal_id??null,oldStatus,newStatus,oldScope,newScope,ctx.receipt.id,JSON.stringify(payload),hash(payload)]);
    const event=r.rows[0];if(realtime)await realtime.append({transaction:tx,event,incident:ctx.incident,candidate:ctx.candidate});return event;
  }
  async function linkedSubscription(tx,ctx,report){
    const old=(await tx.query('SELECT * FROM incident.reporter_subscription WHERE incident_id=$1::uuid AND reporter_identity_hash=$2 FOR UPDATE',[ctx.incident.id,report.reporter_identity_hash])).rows[0];
    if(old&&old.status!=='ENDED'){
      if(old.status==='PENDING_DESTINATION'&&report.direct_channel_leg_id){
        await tx.query("UPDATE incident.reporter_subscription SET status='ACTIVE',direct_channel_leg_id=$2::uuid,row_version=row_version+1,updated_at=platform.local_now() WHERE id=$1::uuid",[old.id,report.direct_channel_leg_id]);
        await append(tx,ctx,'incident.subscription.activated',{payload:{subscription_id:old.id,status:'ACTIVE'}});
      }
      return;
    }
    const status=report.direct_channel_leg_id?'ACTIVE':'PENDING_DESTINATION';
    const result=old?await tx.query(`UPDATE incident.reporter_subscription SET representative_report_id=$2::uuid,direct_channel_leg_id=$3::uuid,
      status=$4,impact_state=$5,ended_at=NULL,row_version=row_version+1,updated_at=platform.local_now() WHERE id=$1::uuid RETURNING id`,[old.id,report.id,report.direct_channel_leg_id,status,report.impact_state]):
      await tx.query(`INSERT INTO incident.reporter_subscription(incident_id,reporter_identity_hash,representative_report_id,direct_channel_leg_id,status)
        VALUES($1::uuid,$2,$3::uuid,$4::uuid,$5) RETURNING id`,[ctx.incident.id,report.reporter_identity_hash,report.id,report.direct_channel_leg_id,status]);
    await append(tx,ctx,old?'incident.subscription.activated':'incident.subscription.created',{payload:{subscription_id:result.rows[0].id,status}});
  }
  async function link(tx,ctx,decisionId){
    const c=ctx.command,s=await query.source({tx,principal:ctx.principal,id:decisionId});
    const old=(await tx.query('SELECT * FROM incident.incident_report WHERE incident_id=$1::uuid AND source_decision_id=$2::uuid FOR UPDATE',[ctx.incident.id,decisionId])).rows[0];
    if(old?.link_state==='LINKED')fail('REPORT_ALREADY_LINKED',409);
    if(s.ticket_id&&(await tx.query("SELECT 1 FROM incident.incident_report r JOIN incident.incident i ON i.id=r.incident_id WHERE r.ticket_id=$1::uuid AND r.incident_id<>$2::uuid AND r.link_state='LINKED' AND i.status<>'CLOSED'",[s.ticket_id,ctx.incident.id])).rowCount)fail('TICKET_ALREADY_LINKED',409);
    const legs=(await tx.query(`SELECT id,leg_type,source_intake_id FROM intake.channel_leg WHERE journey_id=$1::uuid
      AND reporter_identity_hash=$2 ORDER BY leg_ordinal`,[s.journey_id,s.reporter_identity_hash])).rows;
    const origin=legs.find(l=>l.source_intake_id===s.origin_intake_id),direct=legs.find(l=>['DIRECT_GUIDED','DIRECT_ORGANIC'].includes(l.leg_type));
    const r=old?await tx.query(`UPDATE incident.incident_report SET link_state='LINKED',linked_by_principal_id=$2::uuid,
      link_reason_code=$3,direct_channel_leg_id=$4::uuid,linked_at=platform.local_now(),row_version=row_version+1,updated_at=platform.local_now()
      WHERE id=$1::uuid RETURNING *`,[old.id,ctx.principal.principal_id,c.reason_code,direct?.id??null]):
      await tx.query(`INSERT INTO incident.incident_report(candidate_review_id,incident_id,source_decision_id,journey_id,service_intake_id,ticket_id,
        reporter_identity_hash,origin_channel_leg_id,direct_channel_leg_id,link_state,link_reason_code,linked_by_principal_id,linked_at)
        VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7,$8::uuid,$9::uuid,'LINKED',$10,$11::uuid,platform.local_now()) RETURNING *`,
        [ctx.candidate?.id??null,ctx.incident.id,s.id,s.journey_id,s.service_intake_id,s.ticket_id,s.reporter_identity_hash,origin?.id??null,direct?.id??null,c.reason_code,ctx.principal.principal_id]);
    const report=r.rows[0];await append(tx,ctx,'incident.report.linked',{payload:{report_id:report.id,ticket_id:report.ticket_id,reason_code:c.reason_code}});
    await linkedSubscription(tx,ctx,report);
  }
  async function primary(tx,ctx,id){
    if(id&&(await tx.query("SELECT 1 FROM incident.incident_report WHERE incident_id=$1::uuid AND ticket_id=$2::uuid AND link_state='LINKED' LIMIT 1",[ctx.incident.id,id])).rowCount!==1)fail('PRIMARY_NOT_LINKED',409);
    await tx.query('UPDATE incident.incident SET primary_ticket_id=$2::uuid WHERE id=$1::uuid',[ctx.incident.id,id]);
    await append(tx,ctx,'incident.primary_ticket_changed',{payload:{ticket_id:id}});
  }
  async function run(tx,ctx){
    const c=ctx.command,p=ctx.principal;
    const r=await tx.query(`SELECT * FROM incident.${ctx.kind==='candidate'?'candidate_review':'incident'} WHERE id=$1::uuid FOR UPDATE`,[ctx.row.id]);
    const row=r.rows[0];if(String(row.row_version)!==c.expected_row_version)fail('VERSION_CONFLICT',409);
    if(ctx.kind==='candidate')ctx.candidate=row;else ctx.incident=row;
    if(ctx.kind==='candidate'){
      const target={START_REVIEW:'UNDER_REVIEW',REJECT_CANDIDATE:'REJECTED',EXPIRE_CANDIDATE:'EXPIRED',CONFIRM_INCIDENT:'CONFIRMED'}[c.action];
      const allowed=c.action==='CONFIRM_INCIDENT'?['UNDER_REVIEW']:c.action==='REJECT_CANDIDATE'?['CANDIDATE','UNDER_REVIEW']:['CANDIDATE'];
      if(!allowed.includes(row.status))fail('STATE_CONFLICT',409);
      const expired=(await tx.query('SELECT $1::bigint<=platform.physical_epoch_ms() AS expired',[row.expires_epoch_ms])).rows[0].expired;
      if(c.action==='EXPIRE_CANDIDATE'?!expired:expired&&c.action!=='REJECT_CANDIDATE')fail('EXPIRY_CONFLICT',409);
      if(c.action==='CONFIRM_INCIDENT'){
        const d=(await tx.query('SELECT result_hash,safe_result FROM intake.deterministic_decision WHERE id=$1::uuid',[row.source_decision_id])).rows[0];
        if(d.result_hash!==row.source_result_hash)fail('SOURCE_CONFLICT',409);
        const allowedRefs=d.safe_result.incident_report_decision_ids??[row.source_decision_id];
        if(c.selected_report_refs.some(id=>!allowedRefs.includes(id)))fail('SOURCE_CONFLICT',409);
        const owner=await tx.query(`SELECT 1 FROM pilot_ticket.pilot_principal p WHERE p.id=$1::uuid AND p.is_active
          AND EXISTS(SELECT 1 FROM pilot_ticket.pilot_principal_role r WHERE r.principal_id=p.id AND r.role IN ('HANDLER','DISPATCHER','ADMIN'))
          AND ($2::text IS NULL OR EXISTS(SELECT 1 FROM pilot_ticket.pilot_team_member m WHERE m.principal_id=p.id AND m.team_id=$2))`,[c.owner_principal_id,c.owner_team_id??null]);
        if(owner.rowCount!==1)fail('OWNER_INVALID');
        const id=randomUUID();ctx.incident=(await tx.query(`WITH clock AS (SELECT platform.physical_epoch_ms()+2592000000 AS expiry)
          INSERT INTO incident.incident(id,incident_no,status,confirmed_scope,service_family,symptom_family,severity,safe_title,safe_public_summary_code,
            owner_principal_id,owner_team_id,retention_until,retention_until_epoch_ms)
          SELECT $1::uuid,$2,$3,$4,$5,$6,$7,'公共信息系统故障','PUBLIC_IT_INCIDENT',$8::uuid,$9,platform.local_from_epoch_ms(expiry),expiry FROM clock RETURNING *`,
          [id,'INC-'+id.replaceAll('-','').toUpperCase(),'CONFIRMED_'+c.confirmed_scope,c.confirmed_scope,row.service_family,row.symptom_family,row.clinical_severity_candidate,c.owner_principal_id,c.owner_team_id??null])).rows[0];
        for(const ref of c.selected_report_refs)await link(tx,ctx,ref);
        if(c.primary_ticket_id)await primary(tx,ctx,c.primary_ticket_id);
      }
      const updated=await tx.query(`UPDATE incident.candidate_review SET status=$2,row_version=row_version+1,
        opened_by_principal_id=CASE WHEN $2='UNDER_REVIEW' THEN $3::uuid ELSE opened_by_principal_id END,
        opened_at=CASE WHEN $2='UNDER_REVIEW' THEN platform.local_now() ELSE opened_at END,
        confirmed_incident_id=$4::uuid,updated_at=platform.local_now() WHERE id=$1::uuid RETURNING row_version`,[row.id,target,p?.principal_id??null,ctx.incident?.id??null]);
      ctx.candidate={...row,row_version:updated.rows[0].row_version};
      let event=await append(tx,ctx,{START_REVIEW:'candidate.review_started',REJECT_CANDIDATE:'candidate.rejected',EXPIRE_CANDIDATE:'candidate.expired',CONFIRM_INCIDENT:'candidate.confirmed'}[c.action],{oldStatus:row.status,newStatus:target,payload:{reason_code:c.reason_code}});
      if(c.action==='CONFIRM_INCIDENT'){
        event=await append(tx,ctx,'incident.confirmed',{newStatus:ctx.incident.status,newScope:ctx.incident.confirmed_scope,payload:{confirmed_scope:ctx.incident.confirmed_scope}});
        await notifications?.project({transaction:tx,incident:ctx.incident,event});
      }
      return {result_ref_type:ctx.incident?'INCIDENT':'CANDIDATE',result_ref_id:ctx.incident?.id??row.id,result_row_version:String(ctx.incident?.row_version??updated.rows[0].row_version),result_event_id:event.id};
    }
    if(row.status==='CLOSED')fail('STATE_CONFLICT',409);
    ctx.incident=(await tx.query('UPDATE incident.incident SET row_version=row_version+1,updated_at=platform.local_now() WHERE id=$1::uuid RETURNING *',[row.id])).rows[0];
    let event;
    if(['START_INVESTIGATING','RESOLVE_INCIDENT','CLOSE_INCIDENT'].includes(c.action)){
      const next={START_INVESTIGATING:'INVESTIGATING',RESOLVE_INCIDENT:'RESOLVED',CLOSE_INCIDENT:'CLOSED'}[c.action];
      if(c.action==='START_INVESTIGATING'?!row.status.startsWith('CONFIRMED_'):c.action==='RESOLVE_INCIDENT'?row.status!=='INVESTIGATING':row.status!=='RESOLVED')fail('STATE_CONFLICT',409);
      const column={INVESTIGATING:'investigating_at',RESOLVED:'resolved_at',CLOSED:'closed_at'}[next];
      ctx.incident=(await tx.query(`UPDATE incident.incident SET status=$2,${column}=platform.local_now() WHERE id=$1::uuid RETURNING *`,[row.id,next])).rows[0];
      event=await append(tx,ctx,{INVESTIGATING:'incident.investigating',RESOLVED:'incident.resolved',CLOSED:'incident.closed'}[next],{oldStatus:row.status,newStatus:next,newScope:row.confirmed_scope,payload:{confirmed_scope:row.confirmed_scope}});
      await notifications?.project({transaction:tx,incident:ctx.incident,event});
    }else if(c.action==='CORRECT_SCOPE'){
      await tx.query("UPDATE incident.incident SET confirmed_scope=$2,status=CASE WHEN status LIKE 'CONFIRMED_%' THEN 'CONFIRMED_'||$2 ELSE status END WHERE id=$1::uuid",[row.id,c.confirmed_scope]);
      event=await append(tx,ctx,'incident.scope.corrected',{oldScope:row.confirmed_scope,newScope:c.confirmed_scope,payload:{reason_code:c.reason_code}});
    }else if(c.action==='SET_PRIMARY_TICKET'){await primary(tx,ctx,c.primary_ticket_id??null);
    }else if(c.action==='LINK_REPORT'){
      if(row.status==='RESOLVED')fail('STATE_CONFLICT',409);await link(tx,ctx,c.source_decision_id);
    }else if(['UNLINK_REPORT','MARK_REPORTER_RECOVERED'].includes(c.action)){
      const report=(await tx.query('SELECT * FROM incident.incident_report WHERE id=$1::uuid AND incident_id=$2::uuid FOR UPDATE',[c.incident_report_id,row.id])).rows[0];
      if(!report||report.link_state!=='LINKED'||String(report.row_version)!==c.expected_report_version)fail('VERSION_CONFLICT',409);
      if(c.action==='UNLINK_REPORT'){
        if(report.ticket_id&&row.primary_ticket_id===report.ticket_id)fail('PRIMARY_STILL_LINKED',409);
        await tx.query("UPDATE incident.incident_report SET link_state='UNLINKED',unlink_reason_code=$2,unlinked_by_principal_id=$3::uuid,unlinked_at=platform.local_now(),row_version=row_version+1,updated_at=platform.local_now() WHERE id=$1::uuid",[report.id,c.reason_code,p.principal_id]);
        event=await append(tx,ctx,'incident.report.unlinked',{payload:{report_id:report.id,reason_code:c.reason_code}});
        if((await tx.query("SELECT 1 FROM incident.incident_report WHERE incident_id=$1::uuid AND reporter_identity_hash=$2 AND link_state='LINKED' LIMIT 1",[row.id,report.reporter_identity_hash])).rowCount===0){
          const sub=await tx.query("UPDATE incident.reporter_subscription SET status='ENDED',ended_at=platform.local_now(),row_version=row_version+1,updated_at=platform.local_now() WHERE incident_id=$1::uuid AND reporter_identity_hash=$2 RETURNING id",[row.id,report.reporter_identity_hash]);
          if(sub.rowCount)await append(tx,ctx,'incident.subscription.ended',{payload:{subscription_id:sub.rows[0].id}});
        }else{
          await tx.query("UPDATE incident.reporter_subscription s SET representative_report_id=(SELECT r.id FROM incident.incident_report r WHERE r.incident_id=s.incident_id AND r.reporter_identity_hash=s.reporter_identity_hash AND r.link_state='LINKED' ORDER BY r.linked_at,r.id LIMIT 1),row_version=row_version+1,updated_at=platform.local_now() WHERE s.incident_id=$1::uuid AND s.reporter_identity_hash=$2 AND s.representative_report_id=$3::uuid",[row.id,report.reporter_identity_hash,report.id]);
        }
      }else{
        await tx.query("UPDATE incident.incident_report SET impact_state='RECOVERED',recovery_reason_code=$2,recovered_by_principal_id=$3::uuid,recovered_at=platform.local_now(),row_version=row_version+1,updated_at=platform.local_now() WHERE id=$1::uuid",[report.id,c.reason_code,p.principal_id]);
        await tx.query("UPDATE incident.reporter_subscription SET impact_state='RECOVERED',row_version=row_version+1,updated_at=platform.local_now() WHERE incident_id=$1::uuid AND reporter_identity_hash=$2",[row.id,report.reporter_identity_hash]);
        event=await append(tx,ctx,'incident.report.recovered',{payload:{report_id:report.id}});
      }
    }else if(['PAUSE_SUBSCRIPTION','RESUME_SUBSCRIPTION'].includes(c.action)){
      const sub=(await tx.query('SELECT * FROM incident.reporter_subscription WHERE id=$1::uuid AND incident_id=$2::uuid FOR UPDATE',[c.subscription_id,row.id])).rows[0];
      if(!sub||sub.status==='ENDED'||String(sub.row_version)!==c.expected_subscription_version)fail('VERSION_CONFLICT',409);
      const direct=c.direct_channel_leg_id??sub.direct_channel_leg_id;let status='PAUSED';
      if(c.action==='RESUME_SUBSCRIPTION'){
        if(!direct||(await tx.query(`SELECT 1 FROM intake.channel_leg l JOIN intake.service_intake i ON i.id=l.source_intake_id
          WHERE l.id=$1::uuid AND l.reporter_identity_hash=$2 AND l.leg_type IN ('DIRECT_GUIDED','DIRECT_ORGANIC') AND i.source_chat_type='single'`,[direct,sub.reporter_identity_hash])).rowCount!==1)fail('DIRECT_DESTINATION_REQUIRED',409);
        status='ACTIVE';
      }
      await tx.query('UPDATE incident.reporter_subscription SET status=$2,direct_channel_leg_id=$3::uuid,row_version=row_version+1,updated_at=platform.local_now() WHERE id=$1::uuid',[sub.id,status,direct]);
      event=await append(tx,ctx,status==='ACTIVE'?'incident.subscription.activated':'incident.subscription.paused',{payload:{subscription_id:sub.id,status}});
    }else fail();
    event??=(await tx.query('SELECT id FROM incident.incident_event WHERE source_command_id=$1::uuid AND incident_id=$2::uuid ORDER BY event_ordinal DESC LIMIT 1',[ctx.receipt.id,row.id])).rows[0];
    return {result_ref_type:'INCIDENT',result_ref_id:row.id,result_row_version:String(ctx.incident.row_version),result_event_id:event.id};
  }
  async function perform({authContext,command:input},system=false){
    guard(enabled);const c=normalizeCommand(input);
    const result=await transaction(pool,async tx=>{
      // Consistent global lock order with the existing single durable SSE stream.
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('P2_003_REALTIME_STREAM:CONVERSATION_WORKBENCH',0))");
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('P2_012_COMMAND',0))");
      const ctx=await authorize(tx,authContext,c,system),scope='P2_012:'+(ctx.principal?.principal_id??'SYSTEM'),digest=hash(c);
      await tx.query(`INSERT INTO incident.command_receipt(command_scope,client_command_id,command_hash,command_type,candidate_review_id,incident_id,incident_report_id,actor_principal_id,expected_row_version)
        VALUES($1,$2::uuid,$3,$4,$5::uuid,$6::uuid,$7::uuid,$8::uuid,$9) ON CONFLICT(command_scope,client_command_id) DO NOTHING`,
        [scope,c.client_command_id,digest,c.action,c.candidate_review_id??null,c.incident_id??null,c.incident_report_id??null,ctx.principal?.principal_id??null,c.expected_row_version]);
      const receipt=(await tx.query('SELECT * FROM incident.command_receipt WHERE command_scope=$1 AND client_command_id=$2::uuid FOR UPDATE',[scope,c.client_command_id])).rows[0];
      if(receipt.command_hash!==digest)fail('COMMAND_CONFLICT',409);
      const receiptResult=r=>({ok:true,result_ref_type:r.result_ref_type,result_ref_id:r.result_ref_id,result_row_version:String(r.result_row_version),result_event_id:r.result_event_id});
      if(receipt.state==='COMMITTED')return frozen({...receiptResult(receipt),replayed:true});
      if(receipt.state==='FAILED')return frozen({ok:false,error:{code:receipt.error_code,retryable:false},replayed:true});
      await tx.query('SAVEPOINT p2012_business');
      try{
        const value=await run(tx,{...ctx,command:c,receipt});
        await tx.query(`UPDATE incident.command_receipt SET state='COMMITTED',result_ref_type=$2,result_ref_id=$3::uuid,result_row_version=$4,
          result_event_id=$5::uuid,updated_at=platform.local_now(),completed_at=platform.local_now() WHERE id=$1::uuid`,[receipt.id,value.result_ref_type,value.result_ref_id,value.result_row_version,value.result_event_id]);
        await tx.query('RELEASE SAVEPOINT p2012_business');return frozen({ok:true,...value,replayed:false});
      }catch(e){
        await tx.query('ROLLBACK TO SAVEPOINT p2012_business');
        const stable=ERROR_CODES.includes(e.code)?e.code:'P2_012_COMMAND_FAILED';
        await tx.query("UPDATE incident.command_receipt SET state='FAILED',error_code=$2,retryable=false,updated_at=platform.local_now(),completed_at=platform.local_now() WHERE id=$1::uuid",[receipt.id,stable]);
        return frozen({ok:false,error:{code:stable,retryable:false},replayed:false});
      }
    });
    try{await realtime?.wakeup?.();}catch{/* durable facts have already committed */}return result;
  }
  return Object.freeze({perform:input=>perform(input),expireCandidate:command=>perform({command},true)});
}
