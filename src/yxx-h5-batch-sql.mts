// Closed SQL constructors shared by the legacy read and the bounded H5 batch.
// Expressions below are selected from fixed local maps; no SQL text parsing is performed at runtime.
export const DEPARTMENT_FRESH_EPOCH_SQL='pg_catalog.floor(EXTRACT(epoch FROM pg_catalog.clock_timestamp()) OPERATOR(pg_catalog.*) 1000::pg_catalog.numeric)::pg_catalog.int8';
const departmentSingle={"p1":"$1","p2":"$2","p3":"$3","p4":"$4","p5":"$5","p6":"$6","p7":"$7","p8":"$8","p9":"$9","p10":"$10"} as const;
const departmentSlot={"p1":"input.scope_hash","p2":"input.source_scope","p3":"input.source_corp_scope","p4":"input.source_app_scope","p5":"input.maximum_directory_age_ms","p6":"NULL::text","p7":"NULL::text","p8":"NULL::timestamp without time zone","p9":"NULL::uuid","p10":"21"} as const;
const departmentGroup={"p1":"NULL::text","p2":"group_input.source_scope","p3":"group_input.source_corp_scope","p4":"group_input.source_app_scope","p5":"group_input.maximum_directory_age_ms","p6":"NULL::text","p7":"NULL::text","p8":"NULL::timestamp without time zone","p9":"NULL::uuid","p10":"21"} as const;
type DepartmentSqlParameters=Readonly<Record<keyof typeof departmentSingle,string>>;
function departmentSourcesSql(join:'original'|'uuid-residual'='original'){
  const ownership='i.canonical_reporter_binding=wb.canonical_reporter_binding AND i.source_app_scope=wb.source_app_scope';
  return `FROM eligible_reporters er JOIN intake.web_request_binding wb ON wb.canonical_reporter_binding=er.reporter_identity_hash
      JOIN intake.service_intake i ON i.id=wb.intake_id AND ${join==='original'?ownership:`CASE WHEN ${ownership} THEN TRUE ELSE FALSE END`}`;
}
function departmentRetainedSql(p:DepartmentSqlParameters){return `WHERE wb.source_corp_scope=${p.p3} AND wb.source_app_scope=${p.p4} AND i.source_provider='YIXIAOXIU_WEB'
       AND wb.revoked_at IS NULL AND wb.retention_until_epoch_ms>${DEPARTMENT_FRESH_EPOCH_SQL} AND i.retention_until_epoch_ms>${DEPARTMENT_FRESH_EPOCH_SQL}`;}
const recentSingle={"p1":"$1","p2":"$2","p3":"$3","p4":"$4","p5":"$5","p6":"$6","p7":"$7","p8":"$8","p9":"$9","p10":"$10","p11":"$11","p12":"$12"} as const;
const recentSlot={"p1":"(resolved.recent->>0)::pg_catalog.text","p2":"(resolved.recent->>1)::pg_catalog.int8","p3":"(resolved.recent->>2)::pg_catalog.text","p4":"(resolved.recent->>3)::pg_catalog.int8","p5":"(resolved.recent->>4)::pg_catalog.timestamp","p6":"(resolved.recent->>5)::pg_catalog.int4","p7":"(resolved.recent->>6)::pg_catalog.uuid","p8":"(resolved.recent->>7)::pg_catalog.text","p9":"(resolved.recent->>8)::pg_catalog.text","p10":"(resolved.recent->>9)::pg_catalog.text","p11":"(resolved.recent->>10)::pg_catalog.text","p12":"(resolved.recent->>11)::pg_catalog.text"} as const;
export function h5RecentSql(mode:'single'|'slot'='single'){const p=mode==='single'?recentSingle:recentSlot;return `WITH web_candidates AS MATERIALIZED (
      SELECT 'WEB_REQUEST'::text AS kind,b.request_ref AS ref,b.created_at::timestamp without time zone AS created_at,
        0::integer AS kind_rank,b.intake_id::text AS immutable_id,i.id AS intake_id,i.status,b.input_revision,b.processed_revision,i.pilot_ticket_id::text,
        t.ticket_no,t.status AS ticket_status,to_char(t.updated_at,'YYYY-MM-DD HH24:MI:SS') AS ticket_updated_at
      FROM intake.web_request_binding b JOIN intake.service_intake i ON i.id=b.intake_id
      LEFT JOIN pilot_ticket.ticket t ON t.id=i.pilot_ticket_id
      WHERE b.canonical_reporter_binding=${p.p1} AND b.source_corp_scope=${p.p11} AND b.source_app_scope=${p.p12}
        AND b.revoked_at IS NULL AND b.retention_until_epoch_ms>platform.physical_epoch_ms()
        AND i.retention_until_epoch_ms>platform.physical_epoch_ms() AND i.source_provider='YIXIAOXIU_WEB'
        AND (${p.p3}::text IS NULL OR ${p.p3}='WEB') AND b.created_at<=platform.local_from_epoch_ms(${p.p4}::bigint)
        AND (${p.p5}::timestamp without time zone IS NULL OR b.created_at<${p.p5}::timestamp without time zone
          OR (b.created_at=${p.p5}::timestamp without time zone AND 0>${p.p6}::integer)
          OR (b.created_at=${p.p5}::timestamp without time zone AND 0=${p.p6}::integer AND b.intake_id<${p.p7}::uuid))
      ORDER BY b.created_at DESC,b.intake_id DESC LIMIT ${p.p2}
    ), bot_candidates AS MATERIALIZED (
      SELECT 'BOT_TICKET'::text AS kind,r.public_ref AS ref,t.created_at::timestamp without time zone AS created_at,
        1::integer AS kind_rank,t.id::text AS immutable_id,i.id AS intake_id,i.status,1::bigint AS input_revision,1::bigint AS processed_revision,i.pilot_ticket_id::text,
        t.ticket_no,t.status AS ticket_status,to_char(t.updated_at,'YYYY-MM-DD HH24:MI:SS') AS ticket_updated_at
      FROM pilot_ticket.reporter_public_ref r JOIN pilot_ticket.ticket t ON t.id=r.ticket_id JOIN intake.service_intake i ON i.id=t.source_intake_id
      WHERE r.status='ACTIVE' AND r.reporter_binding_hash=${p.p10} AND i.source_provider='WECOM_AIBOT'
        AND i.source_bot_id=${p.p8} AND i.reporter_wecom_userid=${p.p9} AND i.retention_until_epoch_ms>platform.physical_epoch_ms()
        AND (r.journey_id IS NULL OR EXISTS(SELECT 1 FROM intake.contact_journey j WHERE j.id=r.journey_id AND j.retention_until_epoch_ms>platform.physical_epoch_ms()))
        AND (${p.p3}::text IS NULL OR ${p.p3}='BOT') AND t.created_at<=platform.local_from_epoch_ms(${p.p4}::bigint)
        AND (${p.p5}::timestamp without time zone IS NULL OR t.created_at<${p.p5}::timestamp without time zone
          OR (t.created_at=${p.p5}::timestamp without time zone AND 1>${p.p6}::integer)
          OR (t.created_at=${p.p5}::timestamp without time zone AND 1=${p.p6}::integer AND t.id<${p.p7}::uuid))
      ORDER BY t.created_at DESC,t.id DESC LIMIT ${p.p2}
    ), selected AS MATERIALIZED (
      SELECT * FROM (SELECT * FROM web_candidates UNION ALL SELECT * FROM bot_candidates) candidates
      ORDER BY created_at DESC,kind_rank ASC,immutable_id DESC LIMIT ${p.p2}
    )
    SELECT selected.*,CASE WHEN selected.kind='WEB_REQUEST' THEN EXISTS(SELECT 1 FROM intake.manual_review_item r WHERE r.service_intake_id=selected.intake_id AND r.status='PENDING') ELSE false END AS has_pending_review,
      NULLIF(left(initial.safe_content->>'description',120),'') AS safe_summary,
      CASE WHEN (initial.safe_content->'location'->>'unknown')::boolean THEN NULL ELSE NULLIF(left(initial.safe_content->'location'->>'text',80),'') END AS safe_location
    FROM selected LEFT JOIN LATERAL(SELECT s.safe_content FROM intake.web_submission s WHERE selected.kind='WEB_REQUEST' AND s.intake_id=selected.intake_id
      AND s.kind='SUBMIT' AND s.retention_until>platform.local_now() ORDER BY s.input_revision LIMIT 1) initial ON TRUE
    ORDER BY selected.created_at DESC,selected.kind_rank ASC,selected.immutable_id DESC`;}
export function h5DepartmentDirectorySql(mode:'single'|'slot'='single'){const p=mode==='single'?departmentSingle:departmentSlot;return `WITH current_member AS MATERIALIZED (
      SELECT m.provider_user_id,m.source_scope,m.snapshot_version FROM directory.identity_binding b JOIN directory.member_current m ON m.source_scope=b.source_scope AND m.provider_user_id=b.provider_user_id
      JOIN directory.current_snapshot s ON s.source_scope=m.source_scope AND s.snapshot_version=m.snapshot_version AND s.snapshot_version=b.bound_snapshot_version
      WHERE b.reporter_identity_hash=${p.p1} AND b.source_scope=${p.p2} AND b.binding_status='ACTIVE' AND m.account_status='ACTIVE'
       AND s.fetched_at>=platform.local_from_epoch_ms(${DEPARTMENT_FRESH_EPOCH_SQL}-${p.p5}::bigint)
    ), eligible_reporters AS MATERIALIZED (
      SELECT DISTINCT rb.reporter_identity_hash
      FROM current_member cm
      JOIN directory.membership_current mine ON mine.source_scope=cm.source_scope AND mine.provider_user_id=cm.provider_user_id AND mine.snapshot_version=cm.snapshot_version
      JOIN directory.membership_current theirs ON theirs.source_scope=mine.source_scope AND theirs.provider_department_id=mine.provider_department_id AND theirs.snapshot_version=mine.snapshot_version
      JOIN directory.member_current rm ON rm.source_scope=theirs.source_scope AND rm.provider_user_id=theirs.provider_user_id AND rm.snapshot_version=theirs.snapshot_version AND rm.account_status='ACTIVE'
      JOIN directory.identity_binding rb ON rb.source_scope=rm.source_scope AND rb.provider_user_id=rm.provider_user_id AND rb.bound_snapshot_version=rm.snapshot_version AND rb.binding_status='ACTIVE'
      JOIN directory.current_snapshot rs ON rs.source_scope=rm.source_scope AND rs.snapshot_version=rm.snapshot_version
      WHERE rs.fetched_at>=platform.local_from_epoch_ms(${DEPARTMENT_FRESH_EPOCH_SQL}-${p.p5}::bigint)
    )`;}
export function h5DepartmentReportsSql(withFilters:boolean,mode:'single'|'group'='single'){const p=mode==='single'?departmentSingle:departmentGroup;
    const sources=departmentSourcesSql(),retained=departmentRetainedSql(p);
    const tickets='JOIN (SELECT id,ticket_no,status,created_at FROM pilot_ticket.ticket OFFSET 0) t ON t.id=i.pilot_ticket_id';
    return `${mode==='single'?h5DepartmentDirectorySql():'WITH eligible_reporters AS MATERIALIZED (SELECT pg_catalog.unnest(group_input.eligible_reporters) AS reporter_identity_hash)'}${withFilters?`, authorized_source_keys AS MATERIALIZED (
      SELECT i.id AS intake_id,i.pilot_ticket_id ${sources}
      ${retained}
    )`:''}, reports AS MATERIALIZED (
      SELECT ${withFilters?"i.intake_id,t.id,t.ticket_no,date_trunc('second',t.created_at) AS created_at,":''}t.status
      ${withFilters?'FROM authorized_source_keys i':sources}
      ${tickets}
      ${withFilters?`WHERE (${p.p7}::text IS NULL OR CASE WHEN ${p.p7}='COMPLETED' THEN t.status IN ('CLOSED','CANCELLED','DUPLICATE_LINKED','RESOLVED') WHEN ${p.p7}='ACTIVE' THEN t.status IN ('IN_PROGRESS','WAITING_REQUESTER','WAITING_VENDOR') ELSE t.status IN ('NEW','QUEUED','ACCEPTED','REOPENED') END)
       AND (${p.p6}::text IS NULL OR strpos(lower(t.ticket_no||' '||COALESCE((SELECT s.safe_content->>'service_code' FROM intake.web_submission s WHERE s.intake_id=i.intake_id AND s.kind='SUBMIT'
         AND s.retention_until_epoch_ms>${DEPARTMENT_FRESH_EPOCH_SQL} ORDER BY s.input_revision LIMIT 1),'')||' '||COALESCE((SELECT p.summary FROM pilot_ticket.ticket_public_progress p WHERE p.ticket_id=t.id ORDER BY p.ticket_version DESC LIMIT 1),'')),lower(${p.p6}))>0)`:''}
      ${withFilters?'':retained}
    )`;}
export function h5DepartmentPageSql(mode:'single'|'group'='single'){const p=mode==='single'?departmentSingle:departmentGroup;return h5DepartmentReportsSql(true,mode)+`,
      counts AS(SELECT count(*)::integer AS total,count(*) FILTER(WHERE status NOT IN ('CLOSED','CANCELLED','DUPLICATE_LINKED','RESOLVED'))::integer AS active_count FROM reports),
      page AS MATERIALIZED(SELECT * FROM reports WHERE (${p.p8}::timestamp without time zone IS NULL OR (created_at,id)<(${p.p8}::timestamp without time zone,${p.p9}::uuid)) ORDER BY created_at DESC,id DESC LIMIT ${p.p10})
      SELECT counts.*,COALESCE((SELECT jsonb_agg(row_to_json(display) ORDER BY display.created_at DESC,display.id DESC) FROM (
        SELECT page.id,page.ticket_no,page.status,to_char(page.created_at,'YYYY-MM-DD HH24:MI:SS') AS created_at,
          initial.safe_content->>'service_code' AS service_category,p.summary,to_char(p.estimated_at,'YYYY-MM-DD HH24:MI:SS') AS estimated_at,p.estimated_epoch_ms::text,
          p.ticket_version AS progress_version,to_char(p.occurred_at,'YYYY-MM-DD HH24:MI:SS') AS progress_at,p.occurred_epoch_ms::text AS progress_epoch
        FROM page
        LEFT JOIN LATERAL(SELECT s.safe_content FROM intake.web_submission s WHERE s.intake_id=page.intake_id AND s.kind='SUBMIT'
          AND s.retention_until_epoch_ms>${DEPARTMENT_FRESH_EPOCH_SQL} ORDER BY s.input_revision LIMIT 1) initial ON TRUE
        LEFT JOIN LATERAL(SELECT * FROM pilot_ticket.ticket_public_progress p WHERE p.ticket_id=page.id ORDER BY p.ticket_version DESC LIMIT 1) p ON TRUE
      ) display),'[]'::jsonb) AS items FROM counts`;}
export function h5DepartmentSummarySql(mode:'single'|'group'='single'){
  if(mode==='group')return `WITH eligible_reporters AS MATERIALIZED (SELECT pg_catalog.unnest(group_input.eligible_reporters) AS reporter_identity_hash)
      SELECT count(*)::integer AS total,count(*) FILTER(WHERE t.status NOT IN ('CLOSED','CANCELLED','DUPLICATE_LINKED','RESOLVED'))::integer AS active_count
      ${departmentSourcesSql('uuid-residual')}
      JOIN (SELECT id,status FROM pilot_ticket.ticket OFFSET 0) t ON t.id=i.pilot_ticket_id
      
      ${departmentRetainedSql(departmentGroup)}`;
  return h5DepartmentReportsSql(false,mode)+`
      SELECT count(*)::integer AS total,count(*) FILTER(WHERE status NOT IN ('CLOSED','CANCELLED','DUPLICATE_LINKED','RESOLVED'))::integer AS active_count FROM reports`;
}

export type H5BatchShape='home'|'department';
export interface H5BatchMembershipProof {readonly source_scope:string;readonly provider_user_id:string;readonly snapshot_version:string;readonly department_refs:readonly string[]}
export interface H5BatchSqlInput {
  readonly scope_hash:string;readonly source_scope:string;readonly source_corp_scope:string;readonly source_app_scope:string;readonly maximum_directory_age_ms:number;
  readonly expected_provider_user_id:string;readonly expected_snapshot_version:string;readonly expected_department_refs:readonly string[];
  readonly recent:readonly (string|number|null)[];
}
export function buildH5BatchReadStatement(shape:H5BatchShape,slots:readonly (H5BatchSqlInput&{readonly slot:number})[],maximumResultBytes=4*1024*1024){
  const payload=shape==='home'?`WITH recent_rows AS MATERIALIZED (${h5RecentSql('slot')})
    SELECT jsonb_build_object('recent_reports',COALESCE((SELECT jsonb_agg(to_jsonb(recent_rows)||jsonb_build_object(
      'created_at',to_char(recent_rows.created_at,'YYYY-MM-DD HH24:MI:SS'),'input_revision',recent_rows.input_revision::text,'processed_revision',recent_rows.processed_revision::text)
      ORDER BY recent_rows.created_at DESC,recent_rows.kind_rank ASC,recent_rows.immutable_id DESC) FROM recent_rows),'[]'::jsonb),
      'department_summary',shared.data) AS data`:'SELECT shared.data AS data';
  const text=`WITH batch_input AS MATERIALIZED (
    SELECT * FROM pg_catalog.jsonb_to_recordset($1::jsonb) AS x(slot integer,scope_hash text,source_scope text,source_corp_scope text,source_app_scope text,maximum_directory_age_ms bigint,
      expected_provider_user_id text,expected_snapshot_version text,expected_department_refs text[],recent jsonb)
  ), resolved AS MATERIALIZED (
    SELECT input.*,proof.*,(proof.provider_user_id=input.expected_provider_user_id AND proof.snapshot_version=input.expected_snapshot_version
      AND proof.department_refs=input.expected_department_refs AND cardinality(proof.department_refs)>0 AND cardinality(proof.eligible_reporters)>0) AS qualified
    FROM batch_input input CROSS JOIN LATERAL (
      ${h5DepartmentDirectorySql('slot')}
      SELECT (SELECT cm.provider_user_id FROM current_member cm LIMIT 1) AS provider_user_id,
        (SELECT cm.snapshot_version FROM current_member cm LIMIT 1) AS snapshot_version,
        ARRAY(SELECT d.provider_department_id FROM current_member cm JOIN directory.membership_current mine
          ON mine.source_scope=cm.source_scope AND mine.provider_user_id=cm.provider_user_id AND mine.snapshot_version=cm.snapshot_version
          JOIN directory.department_current d ON d.source_scope=mine.source_scope AND d.provider_department_id=mine.provider_department_id AND d.snapshot_version=mine.snapshot_version ORDER BY d.provider_department_id) AS department_refs,
        ARRAY(SELECT reporter_identity_hash FROM eligible_reporters ORDER BY reporter_identity_hash) AS eligible_reporters
    ) proof
  ), exact_groups AS MATERIALIZED (
    SELECT min(slot)::integer AS group_id,array_agg(slot ORDER BY slot) AS slots,source_scope,source_corp_scope,source_app_scope,maximum_directory_age_ms,eligible_reporters
    FROM resolved WHERE qualified GROUP BY source_scope,source_corp_scope,source_app_scope,maximum_directory_age_ms,eligible_reporters
  ), group_reads AS MATERIALIZED (
    SELECT group_input.group_id,to_jsonb(raw) AS data FROM exact_groups group_input
      CROSS JOIN LATERAL (${shape==='home'?h5DepartmentSummarySql('group'):h5DepartmentPageSql('group')}) raw
  ), raw_rows AS MATERIALIZED (
    SELECT resolved.slot,resolved.qualified,
      jsonb_build_object('source_scope',resolved.source_scope,'provider_user_id',resolved.provider_user_id,'snapshot_version',resolved.snapshot_version,'department_refs',resolved.department_refs) AS proof,
      payload.data
    FROM resolved LEFT JOIN exact_groups ON resolved.slot=ANY(exact_groups.slots)
      LEFT JOIN group_reads shared ON shared.group_id=exact_groups.group_id
      LEFT JOIN LATERAL (${payload}) payload ON resolved.qualified
  ), bounded_rows AS MATERIALIZED (
    SELECT slot,CASE WHEN NOT COALESCE(qualified,false) THEN 'FORBIDDEN'
      WHEN octet_length(proof::text)>32768 OR octet_length(data::text)>262144 THEN 'TOO_LARGE' ELSE 'READY' END AS status,
      CASE WHEN qualified AND octet_length(proof::text)<=32768 AND octet_length(data::text)<=262144 THEN proof ELSE NULL END AS proof,
      CASE WHEN qualified AND octet_length(proof::text)<=32768 AND octet_length(data::text)<=262144 THEN data ELSE NULL END AS data FROM raw_rows
  ), encoded AS MATERIALIZED (SELECT slot,to_jsonb(bounded_rows) AS entry FROM bounded_rows)
  SELECT CASE WHEN COALESCE(sum(octet_length(entry::text)),0)+count(*)*2+2<=$2::bigint
    THEN COALESCE(jsonb_agg(entry ORDER BY slot),'[]'::jsonb)::text
    ELSE COALESCE(jsonb_agg(jsonb_build_object('slot',slot,'status','TOO_LARGE','proof',NULL,'data',NULL) ORDER BY slot),'[]'::jsonb)::text END AS body FROM encoded`;
  return {text,values:[JSON.stringify(slots),maximumResultBytes]};
}
