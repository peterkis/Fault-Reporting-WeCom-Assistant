import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import type {PostgresPool,PostgresTransaction} from './platform/postgres-pool.mjs';
import type {P2016TicketQuery} from './p2-016-ticket-query.mjs';
import type {WorkbenchReminderItem,WorkbenchReminderPage,WorkbenchReminderReason} from '../contracts/workbench_reminder_contracts.js';
import {CARD_SQL,RELATED_CARD_SQL,FOLLOW_CARD_SQL} from './web01-workbench-query.mjs';
import {ticketPredicateP2016} from './p2-016-ticket-query.mjs';
import {failP2016,guardP2016,transactionP2016,uuidP2016} from './p2-016-domain-contracts.mjs';
import {assertLocalDateTime} from './platform/time-contract.mjs';
import {REALTIME_STREAM_NAME} from './p2-003-realtime-event-log.mjs';

const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const decimal=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,18})$/u.test(v)&&BigInt(v)<=9223372036854775807n;
interface Baseline {s:string;f:string;e:number;b:string}
interface Cursor {s:string;t:string;a:string;h:string;l:number;i:string;r:string}
interface Fact {event_id:string;kind:'ticket'|'review'|'intake';id:string;reason:WorkbenchReminderReason;source_key:string;source_revision:string;occurred_at:string;reminder_id:string}
interface Clock {high:string;floor:string;now:string}

/** Read projection only. Original facts, current authorization and canonical cards remain authoritative. */
export function createWorkbenchReminders({pool,query,enabled=false,followEnabled=false}:{pool:PostgresPool;query:P2016TicketQuery;enabled?:boolean;followEnabled?:boolean}){
  if(typeof enabled!=='boolean'||typeof followEnabled!=='boolean')failP2016('FLAG_INVALID',503);
  const secret=randomBytes(32);
  function seal(value:Baseline|Cursor):string{
    const body=Buffer.from(JSON.stringify(value)).toString('base64url');
    const mac=createHmac('sha256',secret).update(body).digest('base64url');
    const result=body+'_'+mac;if(result.length>512)failP2016('ACTION_FAILED',503);return result;
  }
  function open(value:string|null):Record<string,unknown>|null{
    if(value===null)return null;
    if(value.length<1||value.length>512||!/^[A-Za-z0-9_-]+$/u.test(value))failP2016();
    // SHA256 base64url is always 43 characters; underscores may also occur in the body.
    const body=value.slice(0,-44),mac=value.slice(-43),expected=createHmac('sha256',secret).update(body).digest();
    if(value.at(-44)!=='_')return null;
    const supplied=Buffer.from(mac,'base64url');if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return null;
    try{const parsed:unknown=JSON.parse(Buffer.from(body,'base64url').toString());return parsed!==null&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed as Record<string,unknown>:null;}catch{return null;}
  }
  async function clock(tx:PostgresTransaction):Promise<Clock>{
    const row=(await tx.query<Clock>(`SELECT COALESCE((SELECT max(event_id) FROM conversation.realtime_event WHERE stream_name=$1),0)::text AS high,
      COALESCE((SELECT retention_floor_event_id FROM conversation.realtime_stream_state WHERE stream_name=$1),0)::text AS floor,
      to_char(clock_timestamp() AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS.US') AS now`,[REALTIME_STREAM_NAME])).rows[0];
    if(!row||!decimal(row.high)||!decimal(row.floor))failP2016('ACTION_FAILED',503);return row;
  }
  return Object.freeze({
    async page({authContext,parameters}:{authContext:unknown;parameters:URLSearchParams}):Promise<WorkbenchReminderPage>{
      guardP2016(enabled);
      const keys=['after_event_id','baseline_token','cursor','limit'];
      if([...parameters.keys()].some(k=>!keys.includes(k))||keys.some(k=>parameters.getAll(k).length>1))failP2016();
      const after=parameters.get('after_event_id'),token=parameters.get('baseline_token'),cursor=parameters.get('cursor'),rawLimit=parameters.get('limit')??'50';
      if(!/^(?:[1-9]|[1-4][0-9]|50)$/u.test(rawLimit)||after!==null&&!decimal(after))failP2016();
      const limit=Number(rawLimit);
      return transactionP2016(pool,async tx=>{
        await tx.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED, READ ONLY');
        let principal=await query.principal(authContext,tx),scope=ticketPredicateP2016(principal);
        let identity=digest([principal.principal_id,principal.roles,principal.team_ids,authContext]),current=await clock(tx);
        const confirmCurrent=async()=>{
          if(!authContext||typeof authContext!=='object')failP2016('UNAUTHENTICATED',401);
          const expiry:unknown=Reflect.get(authContext,'expires_epoch_ms'),session:unknown=Reflect.get(authContext,'session_id');
          if(!decimal(expiry)||BigInt(expiry)<=BigInt(Date.now()))failP2016('UNAUTHENTICATED',401);
          // The original HTTP authenticator supplied this session. Re-read that same authority fact without nesting a pool checkout.
          if(session!==undefined){
            const active=await tx.query(`SELECT session_id FROM pilot_ticket.workbench_auth_session WHERE session_id=$1::uuid
              AND principal_id=$2::uuid AND state='ACTIVE' AND expires_epoch_ms>platform.physical_epoch_ms()`,[uuidP2016(session),principal.principal_id]);
            if(active.rowCount!==1)failP2016('UNAUTHENTICATED',401);
          }
          const latest=await query.principal(authContext,tx),latestIdentity=digest([latest.principal_id,latest.roles,latest.team_ids,authContext]);
          const changed=latestIdentity!==identity;principal=latest;scope=ticketPredicateP2016(principal);identity=latestIdentity;current=await clock(tx);return changed;
        };
        const empty=(reset:boolean):WorkbenchReminderPage=>({schema_version:1,items:[],as_of_event_id:current.high,
          baseline_token:seal({s:identity,f:current.now,e:Date.now()+600_000,b:current.high}),next_cursor:null,reset_required:reset});
        if(after===null&&token===null&&cursor===null){await confirmCurrent();return empty(false);}
        await confirmCurrent();
        const baseline=open(token),next=open(cursor);
        if(!baseline||Object.keys(baseline).sort().join(',')!=='b,e,f,s'||baseline.s!==identity||typeof baseline.f!=='string'
          ||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/u.test(baseline.f)||typeof baseline.e!=='number'||baseline.e<=Date.now()
          ||!decimal(baseline.b)||after===null||BigInt(after)<BigInt(baseline.b)||BigInt(after)<BigInt(current.floor)||BigInt(after)>BigInt(current.high))return empty(true);
        if(cursor!==null&&(!next||Object.keys(next).sort().join(',')!=='a,h,i,l,r,s,t'||next.s!==identity||next.t!==digest(token)
          ||next.a!==after||next.l!==limit||!decimal(next.h)||!decimal(next.i)||typeof next.r!=='string'||!/^[a-f0-9]{64}$/u.test(next.r)
          ||BigInt(next.h)>BigInt(current.high)||BigInt(next.h)<BigInt(after)||BigInt(next.i)>BigInt(next.h)))return empty(true);
        const high=next?String(next.h):current.high;
        // READ and the related union are evaluated in SQL before canonical deduplication, ordering and LIMIT.
        // No payload text, directory identity or communication target is projected.
        const sql=CARD_SQL+`, eligible AS (
          SELECT cards.*,(${RELATED_CARD_SQL}${followEnabled?` OR ${FOLLOW_CARD_SQL}`:''}) AS related FROM cards
        ), anchors AS (
          SELECT c.kind,c.id,c.intake_id,c.related,i.created_at AS initial_at,i.id AS original_id
          FROM eligible c JOIN intake.service_intake i ON i.id=c.intake_id::uuid AND i.retention_until_epoch_ms>platform.physical_epoch_ms()
          WHERE i.source_provider<>'YIXIAOXIU_WEB' OR EXISTS(SELECT 1 FROM intake.web_request_binding binding
            WHERE binding.intake_id=i.id AND binding.revoked_at IS NULL AND binding.retention_until_epoch_ms>platform.physical_epoch_ms())
        ), readable_material AS (
          SELECT a.*,material.id AS material_id FROM anchors a JOIN intake.service_intake material
            ON material.id=a.original_id OR (a.kind='ticket' AND EXISTS(
              SELECT 1 FROM intake.channel_leg leg JOIN intake.contact_journey journey ON journey.id=leg.journey_id
              WHERE leg.source_intake_id=material.id AND journey.linked_ticket_id::text=a.id
                AND journey.retention_until_epoch_ms>platform.physical_epoch_ms()))
          WHERE material.retention_until_epoch_ms>platform.physical_epoch_ms()
        ), facts AS (
          SELECT a.kind,a.id,'AUTHORIZED_TEAM_NEW_REPORT'::text AS reason,'intake:'||a.original_id::text AS source_identity,
            '1'::text AS source_revision,a.initial_at AS fact_at,e.event_id
          FROM anchors a JOIN conversation.realtime_event e ON
            (e.aggregate_type='TICKET' AND a.kind='ticket' AND e.aggregate_id=a.id
             OR e.aggregate_type='MANUAL_REVIEW' AND a.kind='review' AND e.aggregate_id=a.id
             OR e.aggregate_type='CONVERSATION_SESSION' AND EXISTS(SELECT 1 FROM conversation.session s WHERE s.id::text=e.aggregate_id AND s.service_intake_id=a.original_id))
          WHERE a.initial_at>$4::timestamp AND (
            e.source_type='TICKET_EVENT' AND EXISTS(SELECT 1 FROM pilot_ticket.ticket_event first_event WHERE first_event.event_id::text=e.source_id AND first_event.event_type='ticket.created')
            OR e.source_type='MANUAL_REVIEW' AND e.event_type='manual_review.created'
            OR e.source_type='CONVERSATION_SESSION' AND e.event_type='conversation.session.created')
          UNION ALL
          SELECT a.kind,a.id,'RELATED_REOPEN',
            'ticket-event:'||te.event_id::text,te.aggregate_version::text,te.created_at,e.event_id
          FROM anchors a JOIN pilot_ticket.ticket_event te ON a.kind='ticket' AND te.ticket_id::text=a.id
          JOIN conversation.realtime_event e ON e.source_type='TICKET_EVENT' AND e.source_id=te.event_id::text AND e.aggregate_id=a.id
          WHERE a.related AND te.event_type='ticket.reopened' AND te.created_at>$4::timestamp
          UNION ALL
          SELECT a.kind,a.id,'RELATED_NEW_MATERIAL','web:'||submission.id::text,submission.input_revision::text,submission.received_at,e.event_id
          FROM readable_material a JOIN intake.web_submission submission ON submission.intake_id=a.material_id AND submission.kind='SUPPLEMENT'
          JOIN intake.web_request_binding binding ON binding.intake_id=a.material_id AND binding.revoked_at IS NULL
          JOIN pilot_ticket.ticket_event te ON a.kind='ticket' AND te.ticket_id::text=a.id
            AND te.event_type IN ('ticket.information_added','ticket.resumed') AND te.reason_code IN ('WEB_SUPPLEMENT_RECEIVED','WEB_SUPPLEMENT_RESUME')
          JOIN conversation.realtime_event e ON e.source_type='TICKET_EVENT' AND e.source_id=te.event_id::text AND e.aggregate_id=a.id
          WHERE a.related AND submission.received_at>$4::timestamp AND submission.received_at<=te.created_at
            AND submission.input_revision<=binding.processed_revision AND binding.retention_until_epoch_ms>platform.physical_epoch_ms()
            AND submission.retention_until_epoch_ms>platform.physical_epoch_ms()
          UNION ALL
          SELECT a.kind,a.id,'RELATED_NEW_MATERIAL','channel:'||m.id::text,rel.sequence_no::text,m.received_at,e.event_id
          FROM readable_material a JOIN intake.service_intake_message rel ON rel.intake_id=a.material_id
          JOIN channel.message_inbox m ON m.id=rel.channel_message_id AND m.retention_until_epoch_ms>platform.physical_epoch_ms()
          JOIN conversation.item ci ON ci.source_type='CHANNEL_MESSAGE' AND ci.source_id=m.id::text AND ci.item_type='USER_MESSAGE'
          JOIN conversation.realtime_event e ON e.source_type='CONVERSATION_ITEM' AND e.source_id=ci.id::text
          WHERE a.related AND m.received_at>$4::timestamp AND ci.retention_until_epoch_ms>platform.physical_epoch_ms()
            AND (rel.relation_type='SUPPLEMENT' OR (a.kind='ticket' AND rel.relation_type='PRIMARY' AND EXISTS(
              SELECT 1 FROM intake.channel_leg later JOIN intake.channel_leg basis ON basis.journey_id=later.journey_id
              JOIN intake.contact_journey journey ON journey.id=later.journey_id
              WHERE later.source_intake_id=a.material_id AND basis.source_intake_id=a.original_id
                AND later.leg_ordinal>basis.leg_ordinal AND journey.linked_ticket_id::text=a.id
                AND journey.retention_until_epoch_ms>platform.physical_epoch_ms())))
          UNION ALL
          SELECT a.kind,a.id,'RELATED_FOLLOW_UP_DUE','follow-up:'||a.id,signal.schedule_version::text,signal.published_at,e.event_id
          FROM anchors a JOIN pilot_ticket.follow_up_due_signal signal ON a.kind='ticket' AND signal.ticket_id::text=a.id
          JOIN pilot_ticket.follow_up_schedule schedule ON schedule.ticket_id=signal.ticket_id AND schedule.schedule_version=signal.schedule_version
          JOIN pilot_ticket.ticket t ON t.id=signal.ticket_id
          JOIN conversation.realtime_event e ON e.publisher_name='P2_016_FOLLOW_UP' AND e.event_variant='FOLLOW_UP_DUE'
            AND e.source_id=schedule.scheduled_event_id::text AND e.aggregate_id=a.id
          WHERE a.related AND signal.published_at>$4::timestamp AND schedule.scheduled_event_id IS NOT NULL
            AND schedule.due_epoch_ms<=platform.physical_epoch_ms() AND t.status NOT IN ('CLOSED','CANCELLED','DUPLICATE_LINKED')
            AND NOT EXISTS(SELECT 1 FROM pilot_ticket.ticket_event ended JOIN pilot_ticket.ticket_event scheduled ON scheduled.event_id=schedule.scheduled_event_id
              WHERE ended.ticket_id=t.id AND ended.event_ordinal>scheduled.event_ordinal AND (ended.new_status IN ('CLOSED','CANCELLED') OR ended.event_type='ticket.reopened'))
        ), retained AS (
          SELECT facts.* FROM facts JOIN conversation.realtime_event e ON e.event_id=facts.event_id
          WHERE e.stream_name=$5 AND e.visibility_scope='WORKBENCH' AND e.expires_epoch_ms>platform.physical_epoch_ms()
            AND e.event_id>$6::bigint AND e.event_id<=$7::bigint
        ), canonical AS (
          SELECT kind,id,reason,encode(sha256(convert_to(source_identity,'UTF8')),'hex') AS source_key,source_revision,
            min(event_id) AS event_id,min(fact_at) AS fact_at
          FROM retained GROUP BY kind,id,reason,source_identity,source_revision
        ), identified AS (
          SELECT *,encode(sha256(convert_to(jsonb_build_array(reason,source_key,source_revision)::text,'UTF8')),'hex') AS reminder_id FROM canonical
        ) SELECT kind,id,reason,source_key,source_revision,event_id::text,reminder_id,to_char(fact_at,'YYYY-MM-DD HH24:MI:SS') AS occurred_at
          FROM identified WHERE ($8::bigint IS NULL OR (event_id,reminder_id)>($8::bigint,$9::text))
          ORDER BY event_id,reminder_id LIMIT $10`;
        const read=()=>tx.query<Fact>(sql,[...scope.values,baseline.f,REALTIME_STREAM_NAME,after,high,next?.i??null,next?.r??null,limit+1]);
        // A table-lock wait may outlive a Cookie, membership or retention deadline.
        // Discard that statement snapshot, recheck the original session and principal, then reuse the same bounded projection in a fresh snapshot.
        await read();
        if(await confirmCurrent()||baseline.e<=Date.now()||BigInt(after)<BigInt(current.floor))return empty(true);
        const result=await read();
        const rows=result.rows.slice(0,limit),last=rows.at(-1);
        const items:WorkbenchReminderItem[]=rows.map(row=>({reminder_id:row.reminder_id,event_id:row.event_id,reason:row.reason,
          canonical_item:{kind:row.kind,id:uuidP2016(row.id)},source_key:row.source_key,source_revision:row.source_revision,occurred_at:assertLocalDateTime(row.occurred_at)}));
        return {schema_version:1,items,as_of_event_id:high,baseline_token:token!,next_cursor:result.rows.length>limit&&last?
          seal({s:identity,t:digest(token),a:after,h:high,l:limit,i:last.event_id,r:last.reminder_id}):null,reset_required:false};
      });
    },
  });
}
