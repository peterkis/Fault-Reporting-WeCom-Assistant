import {randomUUID} from 'node:crypto';
import type {PostgresPool,PostgresTransaction} from '../../app/server/src/platform/postgres-pool.mjs';
import {EXTERNAL_TICKET_STATUS} from '../../app/server/src/p1-005-pilot-ticket-core.mjs';

async function capacityEpoch(tx:PostgresTransaction):Promise<string>{
  const row=(await tx.query<{epoch:string}>('SELECT platform.physical_epoch_ms()::text AS epoch')).rows[0];
  if(!row)throw new Error('CAPACITY_CLOCK_UNAVAILABLE');
  return row.epoch;
}

async function seedIntakeHistory(tx:PostgresTransaction,messages:string,received:string,values:unknown[]):Promise<void>{
  await tx.query(`INSERT INTO intake.service_intake_message(intake_id,channel_message_id,relation_type,sequence_no,linked_at,trace_id)
    SELECT intake_id,message_id,CASE WHEN sequence_no=1 THEN 'PRIMARY' ELSE 'SUPPLEMENT' END,sequence_no,linked_at,trace_id
    FROM (${messages}) m(intake_id,message_id,sequence_no,linked_at,trace_id)`,values);
  await tx.query(`INSERT INTO intake.service_intake_event(event_type,aggregate_type,intake_id,aggregate_version,event_ordinal,occurred_at,trace_id,payload)
    SELECT 'intake.received','intake',id,1,1,created_at,trace_id,payload FROM (${received}) i(id,created_at,trace_id,payload)`,values);
}

interface WorkerCapacity {pool:PostgresTransaction;tag?:string;profile?:'worker'}
interface AnnualCapacity {pool:PostgresPool;adminId:string;handlerId:string;profile:'annual-board'}
interface WorkerCounts {journeys:number;turns:number;expectedReviews:number}
export function seedCapacityDataset(options:AnnualCapacity):Promise<SeedResult>;
export function seedCapacityDataset(options:WorkerCapacity):Promise<WorkerCounts>;
export async function seedCapacityDataset(options:WorkerCapacity|AnnualCapacity):Promise<WorkerCounts|SeedResult>{
  if(options.profile==='annual-board')return seedAnnualBoard(options.pool,options.adminId,options.handlerId);
  const {pool,tag=randomUUID().slice(0,8)}=options;
  const epoch=await capacityEpoch(pool);
  await pool.query(
    `INSERT INTO channel.message_inbox(schema_version,provider,msg_id,idempotency_key,req_id,bot_id,
      chat_type,chat_id,sender_user_id,msg_type,received_at,raw_text,clean_text,normalized_message,
      processing_status,response_snapshot,privacy_class,trace_id,retention_until,completed_at)
     SELECT 1,'WECOM_AIBOT',format('cap-%s-%s-%s',$1::text,i,t),
      'WECOM_AIBOT:'||format('cap-%s-%s-%s',$1::text,i,t),'req-'||format('cap-%s-%s-%s',$1::text,i,t),'bot-test',
      CASE WHEN i BETWEEN 301 AND 400 THEN 'single' ELSE 'group' END,
      CASE WHEN i BETWEEN 301 AND 400 THEN NULL ELSE format('group-cap-%s',i) END,
      format('user-cap-%s',i),'text',
      platform.local_from_epoch_ms($2::bigint) - interval '2004 seconds' + ((i*4+t)||' seconds')::interval,
      CASE WHEN i<=100 THEN '需人工判断' WHEN i<=400 THEN '处方提交不了' ELSE '系统不行' END,
      CASE WHEN i<=100 THEN '需人工判断' WHEN i<=400 THEN '处方提交不了' ELSE '系统不行' END,
      jsonb_build_object('msgtype','text','bot_mentioned',NOT (i BETWEEN 301 AND 400)),
      'COMPLETED','{}'::jsonb,'INTERNAL','trace-cap-'||i||'-'||t,
      platform.local_from_epoch_ms($2::bigint + 2592000000),
      platform.local_from_epoch_ms($2::bigint) - interval '2004 seconds' + ((i*4+t)||' seconds')::interval
     FROM generate_series(1,500) i CROSS JOIN generate_series(1,4) t`, [tag, epoch],
  );
  await pool.query(
    `INSERT INTO intake.service_intake(intake_no,source_channel,source_provider,source_bot_id,
      source_chat_type,source_chat_id,reporter_wecom_userid,privacy_class,retention_until,
      request_type,summary,status,primary_message_id,message_count,last_message_at,version)
     SELECT 'INT-20260903-'||lpad(nextval('intake.service_intake_number_seq')::text,4,'0'),
      CASE WHEN i BETWEEN 301 AND 400 THEN 'WECOM_DIRECT' ELSE 'WECOM_GROUP' END,
      'WECOM_AIBOT','bot-test',CASE WHEN i BETWEEN 301 AND 400 THEN 'single' ELSE 'group' END,
      CASE WHEN i BETWEEN 301 AND 400 THEN NULL ELSE format('group-cap-%s',i) END,
      format('user-cap-%s',i),'INTERNAL',platform.local_from_epoch_ms($2::bigint + 2592000000),
      'UNKNOWN',format('CAP:%s:%s',$1::text,i),'WAITING_TRIAGE',message.id,4,
      platform.local_from_epoch_ms($2::bigint) - interval '2004 seconds' + ((i*4+4)||' seconds')::interval,1
     FROM generate_series(1,500) i JOIN channel.message_inbox message
       ON message.msg_id=format('cap-%s-%s-1',$1::text,i)`, [tag, epoch],
  );
  await seedIntakeHistory(pool,
    `SELECT intake.id,message.id,t,message.received_at,format('trace-rel-%s-%s',i,t) FROM generate_series(1,500) i CROSS JOIN generate_series(1,4) t
     JOIN intake.service_intake intake ON intake.summary=format('CAP:%s:%s',$1::text,i)
     JOIN channel.message_inbox message ON message.msg_id=format('cap-%s-%s-%s',$1::text,i,t)`,
    `SELECT id,created_at,'trace-cap-event-'||id,'{}'::jsonb FROM intake.service_intake WHERE summary LIKE 'CAP:'||$1::text||':%'`,[tag]);
  return Object.freeze({ journeys: 500, turns: 2000, expectedReviews: 100 });
}

interface SeedResult {sampleTicketId: string; sampleHandledTicketId: string}
export async function seedAnnualBoardIntakes(client:PostgresTransaction,epoch:string,count:number){
  // One primary message and one received event per synthetic Intake.
  await client.query(
    `INSERT INTO channel.message_inbox(schema_version,provider,msg_id,idempotency_key,req_id,bot_id,
       chat_type,chat_id,sender_user_id,msg_type,received_at,raw_text,clean_text,normalized_message,
       processing_status,response_snapshot,privacy_class,trace_id,retention_until,completed_at)
     SELECT 1,'WECOM_AIBOT','perf-'||g,'WECOM_AIBOT:perf-'||g,'req-perf-'||g,'bot-perf',
       CASE WHEN g % 3 = 0 THEN 'group' ELSE 'single' END,CASE WHEN g % 3 = 0 THEN 'group-perf-'||(g % 40) END,
       'reporter-'||((g - 1) % 200 + 1),'text',
       platform.local_from_epoch_ms($1::bigint) - ((g % 360)||' days')::interval - ((g % 80000)||' seconds')::interval,
       '临床工作站网络波动（合成） #'||g,'临床工作站网络波动（合成） #'||g,
       jsonb_build_object('msgtype','text','bot_mentioned',g % 3 = 0),
       'COMPLETED','{}'::jsonb,'INTERNAL','trace-perf-'||g,
       platform.local_from_epoch_ms($1::bigint) + interval '400 days',
       platform.local_from_epoch_ms($1::bigint) - ((g % 360)||' days')::interval - ((g % 80000)||' seconds')::interval
     FROM generate_series(1,$2::integer) g`,
    [epoch,count],
  );
  await client.query(
    `INSERT INTO intake.service_intake(id,intake_no,source_channel,source_provider,source_bot_id,source_chat_type,
       source_chat_id,reporter_wecom_userid,privacy_class,retention_until,request_type,summary,reported_location_text,status,
       primary_message_id,message_count,last_message_at,version,created_at,updated_at)
     SELECT ('00000000-0000-4000-8000-'||lpad(to_hex(g),12,'0'))::uuid,
       'INT-20261125-'||lpad(g::text,6,'0'),
       CASE WHEN g % 3 = 0 THEN 'WECOM_GROUP' ELSE 'WECOM_DIRECT' END,'WECOM_AIBOT','bot-perf',m.chat_type,m.chat_id,
       m.sender_user_id,'INTERNAL',m.retention_until,
       CASE WHEN g <= 50400 THEN 'INCIDENT' ELSE 'CHATTER' END,
       CASE WHEN g % 10 = 0 THEN '打印机故障排查（合成） #'||g ELSE '临床工作站网络波动（合成） #'||g END,
       '门诊大楼'||((g % 8) + 1)||'层（合成）',
       CASE WHEN g <= 50400 THEN 'WAITING_TRIAGE' WHEN g <= 55950 THEN 'COMPLETED' ELSE 'WAITING_TRIAGE' END,
       m.id,1,m.received_at,1,m.received_at,m.received_at
     FROM generate_series(1,$1::integer) g JOIN channel.message_inbox m ON m.msg_id='perf-'||g`,[count],
  );
  await seedIntakeHistory(client,
    `SELECT id,primary_message_id,1,created_at,'trace-perf-msg-'||intake_no FROM intake.service_intake WHERE source_bot_id='bot-perf'`,
    `SELECT id,created_at,'trace-perf-intake-'||intake_no,jsonb_build_object('status',
      CASE WHEN status='COMPLETED' AND right(intake_no,1) IN ('0','5') THEN 'WAITING_TRIAGE' ELSE status END)
      FROM intake.service_intake WHERE source_bot_id='bot-perf'`,[]);
}
/**
 * Set-based synthesis following the construction rules of the existing capacity fixture
 * (tests/helpers/p2-015-postgres-harness.mjs seedCapacityDataset) and of the Ticket core:
 * every WeCom intake has its primary channel message, intake.received event and PRIMARY relation;
 * every ticket is paired with its intake inside one transaction (the pair triggers are deferred to commit);
 * every DISMISSED ticket has its ticket.dismissed event and an active closure record linked to that event,
 * honouring the reason/notify matrix. All visible text carries 「（合成）」.
 */
async function seedAnnualBoard(pool: PostgresPool, adminId: string, handlerId: string): Promise<SeedResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET CONSTRAINTS ALL DEFERRED');
    const epoch=await capacityEpoch(client);
    await seedAnnualBoardIntakes(client,epoch,56000);
    // 50,400 tickets matching the Card 42 §1 ratio: COMPLETED 46,667 / DISMISSED 3,356 / RESOLVED 317 / open 60.
    // Terminal times are whole seconds (075 CHECK); 200 of them fall inside today's handled range.
    await client.query(
      `WITH rows AS (
         SELECT g,('10000000-0000-4000-8000-'||lpad(to_hex(g),12,'0'))::uuid AS ticket_id,
                ('00000000-0000-4000-8000-'||lpad(to_hex(g),12,'0'))::uuid AS intake_id,
                CASE WHEN g <= 35 THEN 'QUEUED' WHEN g <= 60 THEN 'IN_PROGRESS' WHEN g <= 377 THEN 'RESOLVED'
                     WHEN g <= 3733 THEN 'DISMISSED' ELSE 'COMPLETED' END AS status,
                CASE WHEN g <= 60 THEN NULL::timestamp
                     WHEN g <= 260 THEN date_trunc('second',platform.local_from_epoch_ms($2::bigint)) - ((g % 18)||' hours')::interval - ((g % 60)||' minutes')::interval
                     ELSE date_trunc('second',platform.local_from_epoch_ms($2::bigint)) - ((2 + (g % 350))||' days')::interval - ((g % 80000)||' seconds')::interval END AS term_at
           FROM generate_series(1,50400) g)
       INSERT INTO pilot_ticket.ticket(id,ticket_no,source_intake_id,title,request_type,status,priority,resolver_team_id,
         assignee_id,reported_location_text,version,created_at,updated_at,terminal_at)
       SELECT r.ticket_id,'IT-20261125-'||lpad(r.g::text,6,'0'),r.intake_id,
         CASE WHEN r.g % 10 = 0 THEN '打印机脱机故障（合成） #'||r.g ELSE '系统终端异常处理（合成） #'||r.g END,
         'INCIDENT',r.status,CASE WHEN r.g % 5 = 0 THEN 'HIGH' ELSE 'NORMAL' END,'PILOT_IT',
         CASE WHEN r.status='QUEUED' THEN NULL::uuid ELSE $1::uuid END,
         '住院部'||((r.g % 12) + 1)||'病区（合成）',
         CASE r.status WHEN 'QUEUED' THEN 2 WHEN 'IN_PROGRESS' THEN 5 ELSE 6 END,
         i.created_at,
         CASE WHEN r.term_at IS NULL THEN GREATEST(i.created_at,date_trunc('second',platform.local_from_epoch_ms($2::bigint)) - ((r.g % 12)||' minutes')::interval)
              ELSE GREATEST(i.created_at,r.term_at) END,
         CASE WHEN r.term_at IS NULL THEN NULL ELSE GREATEST(date_trunc('second',i.created_at),r.term_at) END
       FROM rows r JOIN intake.service_intake i ON i.id=r.intake_id`,
      [handlerId, epoch],
    );
    await client.query(
      `UPDATE intake.service_intake i SET pilot_ticket_id=t.id,status='TICKET_CREATED',version=2
         FROM pilot_ticket.ticket t WHERE t.source_intake_id=i.id AND t.ticket_no LIKE 'IT-20261125-%'`,
    );
    await client.query(
      `INSERT INTO intake.service_intake_event(event_type,intake_id,aggregate_version,event_ordinal,occurred_at,trace_id,payload)
       SELECT 'intake.ticket_created',i.id,i.version,2,t.created_at,'perf-seed:'||t.ticket_no||':1',
         jsonb_build_object('intake_id',i.id,'ticket_id',t.id,'ticket_no',t.ticket_no,'external_status',$1::text)
         FROM pilot_ticket.ticket t JOIN intake.service_intake i ON i.pilot_ticket_id=t.id
         WHERE i.source_bot_id='bot-perf'`,
      [EXTERNAL_TICKET_STATUS.QUEUED],
    );
    // Generate precisely the event sequence represented by the persisted ticket version.
    await client.query(
      `INSERT INTO pilot_ticket.ticket_event(event_id,ticket_id,event_type,old_status,new_status,aggregate_version,event_ordinal,
         operator_type,operator_id,internal_note,trace_id,created_at)
       SELECT uuidv7(),t.id,
         CASE ord WHEN 1 THEN 'ticket.created' WHEN 2 THEN 'ticket.queued' WHEN 3 THEN 'ticket.accepted' WHEN 4 THEN 'ticket.started'
           WHEN 5 THEN 'ticket.note_added'
           ELSE CASE t.status WHEN 'RESOLVED' THEN 'ticket.resolved' WHEN 'DISMISSED' THEN 'ticket.dismissed' WHEN 'COMPLETED' THEN 'ticket.completed' ELSE 'ticket.note_added' END END,
         CASE ord WHEN 1 THEN NULL WHEN 2 THEN 'NEW' WHEN 3 THEN 'QUEUED' WHEN 4 THEN 'ACCEPTED' WHEN 5 THEN 'IN_PROGRESS'
           ELSE 'IN_PROGRESS' END,
         CASE ord WHEN 1 THEN 'NEW' WHEN 2 THEN 'QUEUED' WHEN 3 THEN 'ACCEPTED' WHEN 4 THEN 'IN_PROGRESS' WHEN 5 THEN 'IN_PROGRESS'
           ELSE CASE WHEN t.status IN ('RESOLVED','COMPLETED','DISMISSED') THEN t.status ELSE 'IN_PROGRESS' END END,
         CASE WHEN ord = 1 THEN 1 ELSE ord END,ord,
         CASE WHEN ord <= 2 THEN 'SYSTEM' ELSE 'PILOT_USER' END,CASE WHEN ord <= 2 THEN NULL ELSE $1 END,
         CASE WHEN ord = 5 THEN '合成排查记录（合成）' WHEN ord = 6 AND t.status IN ('RESOLVED','COMPLETED') THEN '合成排查完成说明（合成）' END,
         'perf-seed:'||t.ticket_no||':'||ord,
         CASE WHEN ord = 6 AND t.terminal_at IS NOT NULL THEN t.terminal_at
              ELSE LEAST(t.created_at + (ord||' minutes')::interval,COALESCE(t.terminal_at,t.updated_at)) END
       FROM pilot_ticket.ticket t CROSS JOIN LATERAL generate_series(1,t.version) ord
       WHERE t.ticket_no LIKE 'IT-20261125-%'`,
      [handlerId],
    );
    // Active closure records for every DISMISSED ticket, linked to its ticket.dismissed event (071 closure_subject).
    await client.query(
      `INSERT INTO pilot_ticket.closure_record(subject_type,ticket_id,reason_code,note,duplicate_of_ref,notify_reporter,
         before_status,before_assignee_id,before_team_id,before_version,before_cycle_id,before_snapshot,ended_by,source,ended_at,closure_ticket_event_id)
       SELECT 'TICKET',t.id,reason.code,NULL,NULL,reason.code<>'FALSE_REPORT_OR_TEST',
         e.old_status,t.assignee_id,t.resolver_team_id,e.aggregate_version-1,t.current_handling_cycle_id,
         jsonb_build_object('status',e.old_status,'assignee_id',t.assignee_id,'resolver_team_id',t.resolver_team_id,
           'version',e.aggregate_version-1,'cycle_id',t.current_handling_cycle_id),e.operator_id,'MANUAL',t.terminal_at,e.event_id
         FROM pilot_ticket.ticket t
         JOIN pilot_ticket.ticket_event e ON e.ticket_id=t.id AND e.event_type='ticket.dismissed'
         CROSS JOIN LATERAL (SELECT CASE WHEN right(t.ticket_no,1) IN ('0','3','6') THEN 'FALSE_REPORT_OR_TEST' ELSE 'REPORTER_WITHDREW' END AS code) reason
        WHERE t.status='DISMISSED' AND t.ticket_no LIKE 'IT-20261125-%'`,
    );
    await seedJourneyHistory(client,adminId);
    const inconsistent = await client.query(
      `SELECT t.id FROM pilot_ticket.ticket t
       JOIN intake.service_intake i ON i.id=t.source_intake_id
       LEFT JOIN (SELECT ticket_id,max(aggregate_version) AS version FROM pilot_ticket.ticket_event GROUP BY ticket_id) e
         ON e.ticket_id=t.id
       WHERE t.version IS DISTINCT FROM e.version OR (t.status='DISMISSED' AND NOT EXISTS (
         SELECT 1 FROM pilot_ticket.closure_record c JOIN pilot_ticket.ticket_event ev ON ev.event_id=c.closure_ticket_event_id
         WHERE c.ticket_id=t.id AND c.restored_at IS NULL AND ev.ticket_id=t.id AND ev.event_type='ticket.dismissed'
           AND c.ended_by=ev.operator_id AND c.ended_by=$2::text
           AND ev.aggregate_version=t.version AND c.before_status='IN_PROGRESS' AND c.before_status=ev.old_status AND c.before_version=t.version-1
           AND c.before_assignee_id=t.assignee_id AND c.before_assignee_id=$2::uuid AND c.before_team_id=t.resolver_team_id
           AND c.before_cycle_id IS NOT DISTINCT FROM t.current_handling_cycle_id
           AND c.before_snapshot=jsonb_build_object('status',ev.old_status,'assignee_id',t.assignee_id,
             'resolver_team_id',t.resolver_team_id,'version',t.version-1,'cycle_id',t.current_handling_cycle_id))) OR NOT EXISTS (
         SELECT 1 FROM intake.service_intake_event link WHERE link.intake_id=i.id
           AND link.event_type='intake.ticket_created' AND link.aggregate_version=i.version AND link.event_ordinal=2
           AND link.payload=jsonb_build_object('intake_id',i.id,'ticket_id',t.id,'ticket_no',t.ticket_no,'external_status',$1::text))
       LIMIT 1`,[EXTERNAL_TICKET_STATUS.QUEUED,handlerId],
    );
    if(inconsistent.rows.length)throw new Error('PERF_BOARD_SEED_HISTORY_MISMATCH');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  await pool.query('ANALYZE');
  return {
    sampleTicketId: '10000000-0000-4000-8000-' + (400).toString(16).padStart(12, '0'),
    sampleHandledTicketId: '10000000-0000-4000-8000-' + (100).toString(16).padStart(12, '0'),
  };
}

// One Journey and origin leg per Intake. Every fifth case needs human review, as in the worker dataset.
// Historical cases carry the original decision and a distinct human override. Pending cases keep only the first.
export async function seedAnnualBoardJourneys(tx:PostgresTransaction){
  await tx.query(`INSERT INTO intake.contact_journey(creation_key,origin_intake_id,linked_ticket_id,entry_mode,origin_channel,current_channel,
    reporter_identity_hash,profile_resolution_status,profile_snapshot,profile_snapshot_hash,status,evaluation_due_at,evaluation_due_epoch_ms,
    reported_at,last_activity_at,ended_at,privacy_class,retention_until,retention_until_epoch_ms)
    SELECT 'capacity-journey:'||i.id,i.id,i.pilot_ticket_id,
      CASE WHEN i.source_chat_type='group' THEN 'GROUP_MENTION_INLINE' ELSE 'DIRECT_ORGANIC' END,i.source_channel,i.source_channel,
      encode(sha256(convert_to(i.reporter_wecom_userid,'UTF8')),'hex'),'RESOLVED',p.snapshot,
      encode(sha256(convert_to(p.snapshot::text,'UTF8')),'hex'),
      CASE WHEN i.pilot_ticket_id IS NOT NULL THEN 'TICKET_LINKED' WHEN i.status='COMPLETED' THEN 'ENDED'
        WHEN right(i.intake_no,1) IN ('0','5') THEN 'WAITING_REVIEW' ELSE 'OPEN' END,
      i.created_at,(extract(epoch FROM i.created_at AT TIME ZONE 'Asia/Shanghai')*1000)::bigint,i.created_at,i.updated_at,CASE WHEN i.status='COMPLETED' THEN i.updated_at END,
      i.privacy_class,i.retention_until,i.retention_until_epoch_ms
    FROM intake.service_intake i CROSS JOIN LATERAL (SELECT jsonb_build_object('source','WECOM_DIRECTORY','version','1',
      'contact',jsonb_build_object('name','报修人（合成）'||i.reporter_wecom_userid),
      'memberships',jsonb_build_array(jsonb_build_object('name','信息科（合成）'))) AS snapshot) p WHERE i.source_bot_id='bot-perf'`);
  await tx.query(`INSERT INTO intake.channel_leg(journey_id,leg_ordinal,leg_type,source_intake_id,origin_channel_message_id,
    provider_context_hash,channel_identity_hash,reporter_identity_hash,status,opened_at)
    SELECT j.id,1,CASE WHEN i.source_chat_type='group' THEN 'GROUP_ORIGIN' ELSE 'DIRECT_ORGANIC' END,i.id,i.primary_message_id,
      encode(sha256(convert_to(i.source_bot_id,'UTF8')),'hex'),encode(sha256(convert_to(COALESCE(i.source_chat_id,i.reporter_wecom_userid),'UTF8')),'hex'),
      j.reporter_identity_hash,'OPEN',i.created_at FROM intake.contact_journey j JOIN intake.service_intake i ON i.id=j.origin_intake_id
    WHERE i.source_bot_id='bot-perf'`);
}
async function seedJourneyHistory(tx:PostgresTransaction,adminId:string){
  await seedAnnualBoardJourneys(tx);
  await tx.query(`INSERT INTO intake.deterministic_decision(journey_id,channel_leg_id,service_intake_id,linked_ticket_id,
    decision_ordinal,decision_key,source_window_start_sequence,source_window_end_sequence,source_message_count,source_hash,
    catalog_version,rule_set_version,engine_version,decision_policy_version,result_code,reason_code,input_hash,result_hash,
    safe_result,requires_manual_review,ticket_creation_recommended,incident_review_candidate,status,observed_at)
    SELECT j.id,l.id,i.id,i.pilot_ticket_id,n,'capacity-decision:'||i.id||':'||n,1,1,1,l.channel_identity_hash,
      'capacity','capacity','capacity','capacity',
      CASE WHEN n=1 THEN 'MANUAL_REVIEW_REQUIRED' WHEN i.pilot_ticket_id IS NOT NULL THEN 'TICKET_ELIGIBLE' ELSE 'ACKNOWLEDGEMENT' END,
      CASE WHEN n=2 AND i.status='COMPLETED' THEN 'ACKNOWLEDGED' ELSE 'CAPACITY_REVIEW' END,l.channel_identity_hash,j.profile_snapshot_hash,
      CASE WHEN n=1 THEN '{}'::jsonb ELSE jsonb_build_object('human_override',jsonb_build_object('principal_id',$1::text)) END,
      n=1,n=2 AND i.pilot_ticket_id IS NOT NULL,false,CASE WHEN n=1 THEN 'RECORDED' ELSE 'HUMAN_OVERRIDDEN' END,i.created_at
    FROM intake.service_intake i JOIN intake.contact_journey j ON j.origin_intake_id=i.id JOIN intake.channel_leg l ON l.source_intake_id=i.id
    LEFT JOIN pilot_ticket.ticket t ON t.id=i.pilot_ticket_id
    CROSS JOIN LATERAL generate_series(1,CASE WHEN i.status='WAITING_TRIAGE' OR t.status IN ('QUEUED','IN_PROGRESS') THEN 1 ELSE 2 END) n
    WHERE i.source_bot_id='bot-perf' AND right(i.intake_no,1) IN ('0','5')`,[adminId]);
  await tx.query(`INSERT INTO intake.manual_review_item(review_key,journey_id,decision_id,service_intake_id,linked_ticket_id,review_reason_code,
    priority,status,row_version,resolution_command_id,resolution_command_hash,resolution_code,resolution_reason_code,resolved_by_principal_id,resolution_decision_id,resolved_at,created_at,updated_at)
    SELECT 'capacity-review:'||d.id,d.journey_id,d.id,d.service_intake_id,d.linked_ticket_id,'CAPACITY_REVIEW','NORMAL',
      CASE WHEN h.id IS NULL THEN 'PENDING' ELSE 'RESOLVED' END,CASE WHEN h.id IS NULL THEN 1 ELSE 2 END,CASE WHEN h.id IS NOT NULL THEN uuidv7() END,h.result_hash,
      CASE WHEN h.linked_ticket_id IS NOT NULL THEN 'CONFIRM_TICKET_ELIGIBLE' WHEN h.id IS NOT NULL THEN 'ACKNOWLEDGE' END,h.reason_code,
      CASE WHEN h.id IS NOT NULL THEN $1::uuid END,h.id,h.observed_at,d.observed_at,d.observed_at
    FROM intake.deterministic_decision d LEFT JOIN intake.deterministic_decision h ON h.journey_id=d.journey_id AND h.decision_ordinal=2
    WHERE d.decision_ordinal=1 AND d.reason_code='CAPACITY_REVIEW'`,[adminId]);
  await tx.query(`WITH reviewed AS (
    UPDATE intake.service_intake i SET version=i.version+1 FROM intake.deterministic_decision d
    WHERE d.service_intake_id=i.id AND d.decision_ordinal=2 AND d.status='HUMAN_OVERRIDDEN' AND i.status='COMPLETED'
    RETURNING i.id,i.version,i.request_type,d.id AS decision_id,d.observed_at,d.reason_code,d.catalog_version,d.rule_set_version
  ) INSERT INTO intake.service_intake_event(event_type,intake_id,aggregate_version,event_ordinal,occurred_at,trace_id,payload)
    SELECT 'intake.rule_decision_applied',id,version,2,observed_at,'capacity-close:'||id,jsonb_build_object('intake_id',id,'decision_id',decision_id,
      'old_request_type',request_type,'new_request_type',request_type,'old_status','WAITING_TRIAGE','new_status','COMPLETED',
      'reason_code',reason_code,'catalog_version',catalog_version,'rule_set_version',rule_set_version) FROM reviewed`);
}
