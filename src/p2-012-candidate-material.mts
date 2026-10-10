import type {PostgresTransaction} from './platform/postgres-pool.mjs';
import {safeHash,P2_015_LIMITS} from './p2-015-domain-contracts.mjs';
import {uuid,hash,fail} from './p2-012-domain-contracts.mjs';
import {YXX_WEB_LIMITS} from './yxx-self-service-store.mjs';

export interface CandidateMaterial {source_decision_id:string;source_kind:'BOT'|'WEB';original_revision:string;current_revision:string|null;original_source_hash:string;current_source_hash:string|null;status:'CURRENT'|'CHANGED'|'EXPIRED'}
interface Source {id:string;journey_id:string;service_intake_id:string;source_hash:string;source_window_start_sequence:number;source_window_end_sequence:number;source_message_count:number;source_kind:'BOT'|'WEB';basis_input_revision:string|null;primary_web_submission_id:string|null}
interface Message {sequence_no:number;message_id:string;clean_text:string|null;msg_type:string;retained:boolean}

/** Compare each immutable Decision with its own current Intake, never a Journey-wide revision. */
export async function readCandidateMaterial(tx:PostgresTransaction,decisionIds:readonly string[],{lock=false}:{lock?:boolean}={}){
  // At most one immutable root plus the existing hundred Report choices.
  if(decisionIds.length===0||decisionIds.length>101)fail('SOURCE_CONFLICT',409);
  const ids=[...new Set(decisionIds.map(uuid))].sort();
  const sources=await tx.query<Source>(`SELECT d.id::text,d.journey_id::text,d.service_intake_id::text,d.source_hash,
    d.source_window_start_sequence,d.source_window_end_sequence,d.source_message_count,
    COALESCE(to_jsonb(d)->>'source_kind','BOT') AS source_kind,to_jsonb(d)->>'basis_input_revision' AS basis_input_revision,
    to_jsonb(d)->>'primary_web_submission_id' AS primary_web_submission_id
    FROM intake.deterministic_decision d WHERE d.id=ANY($1::uuid[]) ORDER BY d.id`,[ids]);
  if(sources.rowCount!==ids.length)fail('SOURCE_NOT_FOUND',404);
  if(lock){
    // Match the actual Web producer's binding + Intake lock, before Journey.
    const webIntakes=[...new Set(sources.rows.filter(s=>s.source_kind==='WEB').map(s=>s.service_intake_id))].sort();
    if(webIntakes.length)await tx.query(`SELECT b.intake_id FROM intake.web_request_binding b JOIN intake.service_intake i ON i.id=b.intake_id
      WHERE b.intake_id=ANY($1::uuid[]) ORDER BY b.intake_id FOR SHARE OF b,i`,[webIntakes]);
    const botIntakes=[...new Set(sources.rows.filter(s=>s.source_kind!=='WEB').map(s=>s.service_intake_id))].sort();
    if(botIntakes.length)await tx.query('SELECT id FROM intake.service_intake WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',[botIntakes]);
    await tx.query('SELECT id FROM intake.contact_journey WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',[[...new Set(sources.rows.map(s=>s.journey_id))].sort()]);
  }
  const items:CandidateMaterial[]=[];
  for(const s of sources.rows){
    const retained=await tx.query<{retained:boolean}>(`SELECT i.retention_until_epoch_ms>platform.physical_epoch_ms()
      AND j.retention_until_epoch_ms>platform.physical_epoch_ms() AS retained
      FROM intake.service_intake i JOIN intake.contact_journey j ON j.id=$2::uuid WHERE i.id=$1::uuid`,[s.service_intake_id,s.journey_id]);
    let currentRevision:string|null=null,currentHash:string|null=null,current=false,expired=retained.rows[0]?.retained!==true;
    if(s.source_kind==='WEB'){
      const web=await tx.query<{input_revision:string;retained:boolean;submission_count:number;submissions:{id:string;revision:string;hash:string}[]|null}>(`SELECT b.input_revision::text,
        b.revoked_at IS NULL AND b.retention_until>platform.local_now() AND original.retention_until>platform.local_now()
        AND NOT EXISTS(SELECT 1 FROM intake.web_submission x WHERE x.intake_id=b.intake_id AND x.retention_until<=platform.local_now()) AS retained,
        (SELECT count(*)::integer FROM intake.web_submission x WHERE x.intake_id=b.intake_id) AS submission_count,
        (SELECT jsonb_agg(jsonb_build_object('id',x.id::text,'revision',x.input_revision::text,'hash',x.canonical_content_hash) ORDER BY x.input_revision)
          FROM (SELECT id,input_revision,canonical_content_hash FROM intake.web_submission WHERE intake_id=b.intake_id ORDER BY input_revision LIMIT $3) x) AS submissions
        FROM intake.web_request_binding b JOIN intake.web_submission original ON original.id=$2::uuid AND original.intake_id=b.intake_id
        WHERE b.intake_id=$1::uuid`,[s.service_intake_id,s.primary_web_submission_id,YXX_WEB_LIMITS.window+1]);
      const snapshot=web.rows[0],submissions=snapshot?.submissions??[];
      currentRevision=snapshot?.input_revision??null;
      expired ||=snapshot?.retained!==true||submissions.length===0;
      // Same bounded, single-snapshot material identity as processOne; no raw content.
      currentHash=!expired&&snapshot&&snapshot.submission_count<=YXX_WEB_LIMITS.window&&submissions.length===snapshot.submission_count?safeHash(submissions):null;
      current=currentRevision===s.basis_input_revision&&snapshot?.submission_count===s.source_message_count&&currentHash===s.source_hash;
    }else{
      const messages=await tx.query<Message>(`SELECT relation.sequence_no,message.id::text AS message_id,message.clean_text,message.msg_type,
        message.retention_until_epoch_ms>platform.physical_epoch_ms() AS retained
        FROM intake.service_intake_message relation JOIN channel.message_inbox message ON message.id=relation.channel_message_id
        WHERE relation.intake_id=$1::uuid AND relation.sequence_no>=$2 ORDER BY relation.sequence_no LIMIT $3`,
        [s.service_intake_id,s.source_window_start_sequence,P2_015_LIMITS.messageWindowTurns+1]);
      const count=await tx.query<{last_sequence:string|null;count:string}>(`SELECT max(sequence_no)::text AS last_sequence,count(*)::text AS count
        FROM intake.service_intake_message WHERE intake_id=$1::uuid AND sequence_no>=$2`,[s.service_intake_id,s.source_window_start_sequence]);
      currentRevision=count.rows[0]?.last_sequence??null;
      expired ||=messages.rows.length===0||messages.rows.some(m=>!m.retained);
      currentHash=safeHash(messages.rows.map(m=>({sequence_no:m.sequence_no,message_id:m.message_id,clean_text_hash:safeHash({text:m.clean_text??'',type:m.msg_type})})));
      current=currentRevision===String(s.source_window_end_sequence)&&count.rows[0]?.count===String(s.source_message_count)&&currentHash===s.source_hash;
    }
    items.push({source_decision_id:s.id,source_kind:s.source_kind,original_revision:s.source_kind==='WEB'?s.basis_input_revision??'':String(s.source_window_end_sequence),current_revision:currentRevision,
      original_source_hash:s.source_hash,current_source_hash:currentHash,status:expired?'EXPIRED':current?'CURRENT':'CHANGED'});
  }
  return {items,basis:hash(items)};
}
