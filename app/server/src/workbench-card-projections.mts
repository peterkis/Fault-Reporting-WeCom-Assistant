import type {WorkbenchSessionPredicate} from './p2-016-workbench-wecom-auth.mjs';
import {WorkbenchError,WORKBENCH_ERROR_CODES} from './p2-006-workbench-query.mjs';
import type {WorkbenchCard, WorkbenchService, WorkbenchServiceCatalog} from '../../../contracts/web01_workbench_contracts.js';
import type {WorkbenchPrincipal} from './p2-006-workbench-authorization.mjs';
import {ticketActionAllowedP2016} from './p2-016-ticket-query.mjs';
import type {ServiceCatalog} from './p2-007-service-catalog.mjs';
import type {PostgresTransaction} from './platform/postgres-pool.mjs';
import {failP2016, localP2016} from './p2-016-domain-contracts.mjs';
import {CLOSURE_REASONS,CLOSURE_SECONDARY_REASONS} from './service-closure-records.mjs';

/** Existing terminal-event evidence, selected only through the canonical READ relation. */
export interface ClosureEvidence {
  source:'MANUAL'|'SYSTEM'|null; reason_code:string|null; reason_note:string|null;
  ended_by_display_name:string|null; ended_at:string|null;
  resolver_team_id?:string; assignee_id?:string|null;
  record_id?:string;secondary_reason_code?:string|null;duplicate_of_ref?:string|null;
}
export function projectWorkbenchClosure(status:string,evidence:ClosureEvidence|null,canRestore=false):WorkbenchCard['closure'] {
  const completed=['RESOLVED','COMPLETED'].includes(status),dismissed=status==='DISMISSED';
  if(!completed&&!dismissed)return null;
  if(dismissed&&(!evidence?.record_id||!evidence.ended_at||!evidence.reason_code||!Object.hasOwn(CLOSURE_REASONS,evidence.reason_code)))failP2016('ACTION_FAILED',503);
  const source=evidence?.source??null,reason=evidence?.reason_code;
  // Legacy commands accept nonempty whitespace. It carries no displayable
  // reason/name; retain the original Event while keeping the read DTO valid.
  const note=evidence?.reason_note?.trim()?evidence.reason_note:null;
  const actor=evidence?.ended_by_display_name?.trim()?evidence.ended_by_display_name:null;
  const labels:Readonly<Record<string,string>>=completed?CLOSURE_SECONDARY_REASONS:CLOSURE_REASONS;
  const reasonCode=typeof reason==='string'&&Object.hasOwn(labels,reason)?reason:null;
  const secondary=evidence?.secondary_reason_code;
  return {kind:completed?'COMPLETED':'DISMISSED',source,reason_code:reasonCode,
    reason_label:reasonCode?labels[reasonCode]??null:completed?'已完成':'已关闭',
    secondary_reason:reasonCode==='NOT_IT_SCOPE'&&typeof secondary==='string'&&Object.hasOwn(CLOSURE_SECONDARY_REASONS,secondary)?{code:secondary,label:CLOSURE_SECONDARY_REASONS[secondary as keyof typeof CLOSURE_SECONDARY_REASONS]}:null,
    reason_note:note,ended_by_display_name:source==='MANUAL'?actor:null,
    ended_at:evidence?.ended_at==null?null:localP2016(evidence.ended_at),duplicate_of:evidence?.duplicate_of_ref?{display_no:evidence.duplicate_of_ref}:null,
    can_restore:dismissed?canRestore:['RESOLVED','COMPLETED'].includes(status)&&canRestore};
}
export function workbenchCanRestore(kind:string,status:string,evidence:ClosureEvidence|null,principal?:WorkbenchPrincipal):boolean {
  if(status==='DISMISSED')return Boolean(evidence?.record_id&&principal?.is_active&&principal.roles.some(role=>['ADMIN','DISPATCHER','HANDLER'].includes(role))
    &&(kind!=='ticket'||typeof evidence.resolver_team_id==='string'&&ticketActionAllowedP2016(principal,{status,resolver_team_id:evidence.resolver_team_id,assignee_id:evidence.assignee_id??null},'restore')));
  return kind==='ticket'&&['RESOLVED','COMPLETED'].includes(status)&&typeof evidence?.resolver_team_id==='string'
    &&ticketActionAllowedP2016(principal,{status,resolver_team_id:evidence.resolver_team_id,assignee_id:evidence.assignee_id??null},'reopen');
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function bounded(value: unknown, max: number): string {
  if(typeof value !== 'string' || !value.trim() || Array.from(value).length > max) failP2016('ACTION_FAILED',503);
  return value;
}
/** Whitelist only public directory fields; lookupService itself includes disabled entries. */
export function projectWorkbenchCatalog(catalog: ServiceCatalog | null): WorkbenchServiceCatalog {
  if(!catalog) failP2016('ACTION_FAILED',503);
  const catalog_version=bounded(catalog.catalog_version,64), enabled=catalog.listServices({enabledOnly:true}).filter(s=>s.enabled);
  if(enabled.length>200) failP2016('ACTION_FAILED',503);
  const groups=new Map<string,WorkbenchServiceCatalog['categories'][number]>();
  for(const service of enabled){
    const category=bounded(service.category,64),category_name_zh=bounded(service.category_name_zh,80);
    const service_code=bounded(service.service_code,64),name_zh=bounded(service.name_zh,80);
    if(!/^[A-Z][A-Z0-9_]*$/u.test(category)||!/^[A-Z][A-Z0-9_]*(?:\.[A-Z][A-Z0-9_]*)*$/u.test(service_code))failP2016('ACTION_FAILED',503);
    const group=groups.get(category)??{category,category_name_zh,services:[]};
    group.services.push({service_code,name_zh});groups.set(category,group);
  }
  if(groups.size>200)failP2016('ACTION_FAILED',503);
  return {schema_version:1,catalog_version,categories:[...groups.values()]};
}

export interface ServiceEvidence {
  explicit_code: unknown; safe_result: unknown; current: boolean;
  decision_status: string | null; resolved_by: string | null; journey_id?: string | null;
}
/** This interprets persisted evidence, never evaluates rules or confirms a suggestion. */
export function projectWorkbenchService(evidence: readonly ServiceEvidence[], catalog: ServiceCatalog | null): WorkbenchService | null {
  if(!catalog||evidence.length>100)return null;
  // Retirement belongs to the current Journey decision, even across its Intake/Leg rows.
  const retiredByJourney=new Map<string,Set<unknown>>();
  for(const row of evidence){
    const result=object(row.safe_result);
    if(!row.current)return null;
    if(typeof row.journey_id!=='string'||!Array.isArray(result?.fact_provenance))continue;
    const retired=retiredByJourney.get(row.journey_id)??new Set<unknown>();
    for(const value of result.fact_provenance){const fact=object(value);
      if(fact?.field_path==='service.selected_service_code'&&(fact.status==='SUPERSEDED'||fact.status==='REJECTED'))retired.add(fact.normalized_value);
    }
    retiredByJourney.set(row.journey_id,retired);
  }
  const candidates:{code:string;source:WorkbenchService['source'];rank:number}[]=[];
  for(const row of evidence){
    if(!row.current)return null;
    let explicitAllowed=!(row.journey_id&&retiredByJourney.get(row.journey_id)?.has(row.explicit_code));
    const result=object(row.safe_result),known=object(result?.known_fields);
    if(result){
      if(!Array.isArray(result.fact_provenance)||result.fact_provenance.length>100||!Array.isArray(result.conflicts))return null;
      if(result.conflicts.some(value=>{const conflict=object(value);return !conflict||typeof conflict.field_path!=='string'||conflict.field_path.startsWith('service.');}))return null;
      const facts=result.fact_provenance.map(object).filter((v):v is Record<string,unknown>=>v!==null&&v.field_path==='service.selected_service_code');
      if(facts.some(f=>f.status==='CONFLICTED'||f.status==='ACTIVE'&&f.assertion!=='AFFIRMED'))return null;
      explicitAllowed=explicitAllowed&&!facts.some(f=>f.normalized_value===row.explicit_code&&(f.status==='SUPERSEDED'||f.status==='REJECTED'));
      const active=facts.filter(f=>f.status==='ACTIVE'&&f.assertion==='AFFIRMED');
      if(new Set(active.map(f=>f.normalized_value)).size>1)return null;
      const code=known?.selected_service_code;
      if(typeof code==='string'){
        const matching=active.filter(f=>f.normalized_value===code);
        if(!matching.length)return null;
        const human=object(result.human_override);
        const confirmed=row.decision_status==='HUMAN_OVERRIDDEN'&&row.resolved_by!==null&&human?.principal_id===row.resolved_by
          &&matching.some(f=>f.source_kind==='HUMAN_OPERATOR_CONFIRMED'&&f.source_ref==='principal:'+row.resolved_by);
        if(confirmed)candidates.push({code,source:'MANUAL_CONFIRMED',rank:0});
        else if(matching.some(f=>f.source_kind==='DETERMINISTIC_RULE'||f.source_kind==='REPORTER_EXPLICIT'))candidates.push({code,source:'RULE_DETERMINISTIC',rank:2});
        else return null;
      }
    }
    if(explicitAllowed&&typeof row.explicit_code==='string')candidates.push({code:row.explicit_code,source:'REPORTER_EXPLICIT',rank:1});
  }
  // A priority is not permission to hide a still-active contrary assertion.
  if(new Set(candidates.map(c=>c.code)).size!==1)return null;
  const selected=candidates.sort((a,b)=>a.rank-b.rank)[0];if(!selected)return null;
  const service=catalog.lookupService(selected.code);
  if(service?.enabled!==true)return null;
  try{
    return {code:bounded(service.service_code,64),name_zh:bounded(service.name_zh,80),category:bounded(service.category,64),category_name_zh:bounded(service.category_name_zh,80),source:selected.source};
  }catch{return null;}
}

interface ProjectionRow {kind:string;id:string;status:string;evidence:ServiceEvidence[];safety_signature:string}
export interface WorkbenchReadAuthority {values:unknown[];roles:readonly string[];teams:readonly string[];principal?:WorkbenchPrincipal}
export interface WorkbenchReadAccess {
  authority:()=>Promise<WorkbenchReadAuthority>;
  session?:(start:number)=>WorkbenchSessionPredicate;
  finalRouteCheck?:()=>Promise<void>;
  /** Same final snapshot as card READ; parameters after the canonical first three. */
  groupCounts?:{predicate:string;pageSql:string;values:unknown[];expectedPage:{kind:string;id:string;order_group:number;order_at:string}[];value:{completed:number;dismissed:number}|null};
}
interface ReadProof {principal_valid:boolean;scope_valid:boolean;session_valid:boolean}
function proofColumns(roles:number,teams:number,session:string,principal=2):string {
  return `EXISTS(SELECT 1 FROM pilot_ticket.pilot_principal p WHERE p.id=$${principal}::uuid AND p.is_active) AS principal_valid,
    EXISTS(SELECT 1 FROM pilot_ticket.pilot_principal p
      CROSS JOIN LATERAL (SELECT
        ARRAY(SELECT DISTINCT r.role::text FROM pilot_ticket.pilot_principal_role r WHERE r.principal_id=p.id) AS roles,
        ARRAY(SELECT DISTINCT m.team_id::text FROM pilot_ticket.pilot_team_member m WHERE m.principal_id=p.id) AS teams) current_scope
      WHERE p.id=$${principal}::uuid AND p.is_active
        AND current_scope.roles @> $${roles}::text[] AND current_scope.roles <@ $${roles}::text[]
        AND current_scope.teams @> $${teams}::text[] AND current_scope.teams <@ $${teams}::text[]) AS scope_valid,
    (${session}) AS session_valid`;
}
function checkReadProof(proof:ReadProof|undefined):asserts proof is ReadProof {
  if(!proof)failP2016('ACTION_FAILED',503);
  if(proof.principal_valid!==true)failP2016('FORBIDDEN',403);
  if(proof.session_valid!==true)throw new WorkbenchError(WORKBENCH_ERROR_CODES.unauthenticated,401);
  if(proof.scope_valid!==true)failP2016('FORBIDDEN',403);
}
/** Final read-only snapshot; never authenticate again or refresh last_seen. */
export async function verifyWorkbenchReadAccess(pool:PostgresTransaction,access:WorkbenchReadAccess):Promise<void>{
  const scope=await access.authority(),session=access.session?.(4)??{sql:'TRUE',values:[]};
  const proof=(await pool.query<ReadProof>('SELECT '+proofColumns(2,3,session.sql,1),[scope.values[1],[...scope.roles],[...scope.teams],...session.values])).rows[0];
  checkReadProof(proof);
}
/** One page-wide source read, joined to the current authorized canonical relation. */
export async function readWorkbenchCardProjections(pool:PostgresTransaction,authorizedCardsSql:string,access:WorkbenchReadAccess,items:WorkbenchCard[],catalog:ServiceCatalog|null,manualReportsEnabled:boolean,finalRouteCheck?:()=>Promise<void>):Promise<WorkbenchCard[]> {
  if(!items.length&&!access.groupCounts){await verifyWorkbenchReadAccess(pool,access);return items;}
  const schema=await pool.query<{web:boolean}>("SELECT to_regclass('intake.web_submission') IS NOT NULL AND to_regclass('intake.web_request_binding') IS NOT NULL AS web");
  const web=schema.rows[0]?.web===true;
  const webJoins=web?`LEFT JOIN intake.web_request_binding b ON b.intake_id=i.id AND b.revoked_at IS NULL AND b.retention_until>platform.local_now()
    LEFT JOIN LATERAL (SELECT s.id::text AS submission_id,s.safe_content->>'service_code' AS code FROM intake.web_submission s
      WHERE s.intake_id=i.id AND s.kind='SUBMIT' AND s.retention_until>platform.local_now() ORDER BY s.input_revision LIMIT 1) initial ON TRUE`:'';
  const webCurrent=web?`b.intake_id IS NOT NULL AND to_jsonb(d)->>'basis_input_revision'=b.input_revision::text`:'false';
  const currentAuthority=await access.authority();
  const projectionSql=authorizedCardsSql+`, selected AS (
    SELECT c.* FROM cards c JOIN jsonb_to_recordset($4::jsonb) AS requested(kind text,id text,intake_id text)
      ON c.kind=requested.kind AND c.id=requested.id AND c.intake_id=requested.intake_id
  ), projected_sources AS (SELECT c.kind,c.id,c.status,
    COALESCE(material.evidence,'[]'::jsonb) AS evidence,encode(sha256(convert_to(COALESCE(material.evidence,'[]'::jsonb)::text,'UTF8')),'hex') AS safety_signature
  FROM selected c
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object('source_intake_id',source.source_intake_id,'decision_id',source.decision_id,'web_revision',source.web_revision,'submission_id',source.submission_id,'explicit_code',source.explicit_code,'safe_result',source.safe_result,
      'current',source.current,'journey_id',source.journey_id,'decision_status',source.decision_status,'resolved_by',source.resolved_by)) AS evidence
    FROM (
      SELECT i.id::text AS source_intake_id,d.id::text AS decision_id,${web?'b.input_revision::text':'NULL::text'} AS web_revision,${web?'initial.submission_id':'NULL::text'} AS submission_id,${web?"CASE WHEN i.source_provider='YIXIAOXIU_WEB' THEN initial.code END":'NULL::text'} AS explicit_code,
        CASE WHEN d.id IS NOT NULL THEN jsonb_build_object(
          'known_fields',jsonb_build_object('selected_service_code',d.safe_result->'known_fields'->'selected_service_code'),
          'human_override',jsonb_build_object('principal_id',d.safe_result->'human_override'->'principal_id'),
          'fact_provenance',(SELECT COALESCE(jsonb_agg(jsonb_build_object('field_path',fact->'field_path','normalized_value',fact->'normalized_value',
            'status',fact->'status','assertion',fact->'assertion','source_kind',fact->'source_kind','source_ref',fact->'source_ref')),'[]'::jsonb)
            FROM (SELECT fact FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d.safe_result->'fact_provenance')='array' THEN d.safe_result->'fact_provenance' ELSE '[]'::jsonb END) fact
              WHERE fact->>'field_path'='service.selected_service_code' LIMIT 101) service_facts),
          'conflicts',CASE WHEN jsonb_typeof(d.safe_result->'conflicts') IS DISTINCT FROM 'array' THEN 'null'::jsonb
            WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(d.safe_result->'conflicts') conflict
              WHERE jsonb_typeof(conflict->'field_path') IS DISTINCT FROM 'string' OR conflict->>'field_path' LIKE 'service.%') THEN '[{}]'::jsonb ELSE '[]'::jsonb END
        ) END AS safe_result,d.status AS decision_status,r.resolved_by_principal_id::text AS resolved_by,
        COALESCE(d.journey_id::text,(SELECT CASE WHEN count(DISTINCT j.id)=1 THEN min(j.id::text) END
          FROM intake.contact_journey j WHERE j.retention_until_epoch_ms>platform.physical_epoch_ms()
            AND (j.origin_intake_id=i.id OR EXISTS(SELECT 1 FROM intake.channel_leg l WHERE l.journey_id=j.id AND l.source_intake_id=i.id)))) AS journey_id,
        CASE WHEN d.id IS NULL THEN true
          WHEN to_jsonb(d)->>'source_kind'='WEB' THEN ${webCurrent}
          WHEN to_jsonb(d)->>'source_kind'='MANUAL' THEN $5::boolean
          ELSE d.source_window_start_sequence=message_window.first AND d.source_window_end_sequence=message_window.last
            AND d.source_message_count=message_window.count AND message_window.retained END AS current
      FROM intake.service_intake i
      ${webJoins}
      LEFT JOIN LATERAL (SELECT DISTINCT ON (decision.journey_id) decision.* FROM intake.deterministic_decision decision
        JOIN intake.contact_journey j ON j.id=decision.journey_id
        WHERE decision.service_intake_id=i.id AND j.retention_until_epoch_ms>platform.physical_epoch_ms()
          AND NOT EXISTS(SELECT 1 FROM intake.deterministic_decision newer
            WHERE newer.journey_id=decision.journey_id AND newer.decision_ordinal>decision.decision_ordinal)
        ORDER BY decision.journey_id,decision.decision_ordinal DESC) d ON TRUE
      LEFT JOIN intake.manual_review_item r ON r.resolution_decision_id=d.id AND r.status='RESOLVED'
      LEFT JOIN LATERAL (SELECT min(rel.sequence_no) AS first,max(rel.sequence_no) AS last,count(*)::integer AS count,
        bool_and(m.retention_until>platform.local_now()) AS retained
        FROM intake.service_intake_message rel JOIN channel.message_inbox m ON m.id=rel.channel_message_id
        WHERE rel.intake_id=i.id) message_window ON TRUE
      WHERE i.retention_until>platform.local_now() AND (i.source_provider<>'YIXIAOXIU_WEB' OR ${web?'b.intake_id IS NOT NULL':'false'})
        AND (i.source_provider<>'STAFF_MANUAL_REPORT' OR $5::boolean)
        AND i.id IN (SELECT c.intake_id::uuid UNION
          SELECT l.source_intake_id FROM intake.contact_journey j JOIN intake.channel_leg l ON l.journey_id=j.id
          WHERE c.kind='ticket' AND j.linked_ticket_id=c.id::uuid
            AND l.reporter_identity_hash=j.reporter_identity_hash AND j.retention_until_epoch_ms>platform.physical_epoch_ms())
        AND NOT EXISTS(SELECT 1 FROM pilot_ticket.ticket other WHERE other.source_intake_id=i.id AND (c.kind<>'ticket' OR other.id<>c.id::uuid))
      ORDER BY i.id,d.journey_id,d.id LIMIT 101
    ) source
  ) material ON TRUE)`;
  const requested=JSON.stringify(items.map(({kind,id,intake_id})=>({kind,id,intake_id})));
  const result=await pool.query<ProjectionRow>(projectionSql+' SELECT * FROM projected_sources',[...currentAuthority.values,requested,manualReportsEnabled]);
  await access.finalRouteCheck?.();
  const current=await access.authority(),session=access.session?.(8)??{sql:'TRUE',values:[]};
  const counts=access.groupCounts;
  const pageParameters=(sql:string)=>sql.replace(/\$(\d+)/gu,(token,index:string)=>Number(index)<=3?token:'$'+(8+session.values.length+Number(index)-4));
  const countsPredicate=counts?pageParameters(counts.predicate):null;
  const expectedPageParameter=8+session.values.length+(counts?.values.length??0);
  const countsSql=counts&&countsPredicate?`,(SELECT jsonb_build_object(
    'completed',count(*) FILTER(WHERE status IN ('RESOLVED','COMPLETED'))::integer,
    'dismissed',count(*) FILTER(WHERE status IN ('DISMISSED'))::integer)
    FROM cards WHERE ${countsPredicate}) AS group_counts,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('kind',page.kind,'id',page.id,'order_group',page.order_group,'order_at',page.order_at)
      ORDER BY page.order_group DESC,page.order_at DESC,page.kind DESC,page.id DESC)
      FROM (${pageParameters(counts.pageSql)}) page),'[]'::jsonb)=$${expectedPageParameter}::jsonb AS page_matches`:'';
  // Current session, role/team snapshot and canonical item READ share the last
  // statement, after all source and detail-route waits. Nothing async follows.
  const proof=(await pool.query<ReadProof&{group_counts?:{completed:number;dismissed:number};page_matches?:boolean;items:{kind:string;id:string;status:string;stage_entered_at:string|null;safety_signature:string;closure_evidence:ClosureEvidence|null}[]}>(projectionSql+`
    SELECT ${proofColumns(6,7,session.sql)},COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'kind',c.kind,'id',c.id,'status',c.status,'safety_signature',c.safety_signature,'closure_evidence',selected.closure_evidence,'stage_entered_at',
      CASE WHEN state.new_status=c.status THEN to_char(state.created_at,'YYYY-MM-DD HH24:MI:SS') END))
      FROM projected_sources c JOIN selected ON selected.kind=c.kind AND selected.id=c.id
      LEFT JOIN LATERAL(SELECT e.new_status,e.created_at FROM pilot_ticket.ticket_event e
        WHERE c.kind='ticket' AND e.ticket_id=c.id::uuid AND e.old_status IS DISTINCT FROM e.new_status
        ORDER BY e.aggregate_version DESC,e.event_ordinal DESC LIMIT 1) state ON TRUE),'[]'::jsonb) AS items${countsSql}`,
  [...current.values,requested,manualReportsEnabled,[...current.roles],[...current.teams],...session.values,...(counts?.values??[]),...(counts?[JSON.stringify(counts.expectedPage)]:[])])).rows[0];
  checkReadProof(proof);
  const visible=new Map(proof.items.map(row=>[row.kind+':'+row.id,row]));
  const byId=new Map(result.rows.map(row=>[row.kind+':'+row.id,row]));
  const projected=items.map(item=>{
    const row=byId.get(item.kind+':'+item.id),live=visible.get(item.kind+':'+item.id);
    if(!row||!live)failP2016('NOT_FOUND',404);
    if(row.status!==item.status||live.status!==item.status)failP2016('VERSION_CONFLICT',409);
    return {...item,closure:projectWorkbenchClosure(item.status,live.closure_evidence,workbenchCanRestore(item.kind,item.status,live.closure_evidence,current.principal)),
      service:row.safety_signature===live.safety_signature?projectWorkbenchService(row.evidence,catalog):null,stage_entered_at:live.stage_entered_at===null?null:localP2016(live.stage_entered_at)};
  });
  if(counts){
    if(!proof.group_counts)failP2016('ACTION_FAILED',503);
    if(proof.page_matches!==true)failP2016('VERSION_CONFLICT',409);
    counts.value=proof.group_counts;
  }
  return projected;
}
