import type { PostgresTransaction } from './platform/postgres-pool.mjs';
import type { WorkbenchPrincipal, WorkbenchAuthorizationAdapter } from './p2-006-workbench-authorization.mjs';
import type { CandidateReview, Incident, IncidentPublicView, CandidateCommandReceipt } from '../contracts/p2_012_contracts.js';
import type {IncidentFollowupReceipt} from '../contracts/workbench_incident_followup_contracts.js';
type Kind = 'candidate' | 'incident';
export type CandidateQueryRow = Omit<CandidateReview, 'source_versions' | 'reason_codes' | 'evidence_fact_ids' | 'roles' | 'source_decision' | 'manual_review' | 'eligible_owners' | 'report_sources'> & { source_versions: unknown; reason_codes: unknown; evidence_fact_ids: unknown };
type ResourceRow = CandidateQueryRow | Incident;
export type IncidentNarrowDetail = IncidentPublicView & { roles: readonly string[] };
export type IncidentBroadDetail = IncidentNarrowDetail & { owner_principal_id: string; owner_team_id: string | null; primary_ticket_id: string | null; owner_display_name: string | null; primary_ticket_no: string | null };
export interface IncidentSource { id: string; journey_id: string; service_intake_id: string; ticket_id: string | null; channel_leg_id: string; ticket_no: string | null; reporter_identity_hash: string; origin_intake_id: string; assignee_id: string | null; resolver_team_id: string | null }
type ReadInput = { authContext: unknown; id: string; kind?: Kind; tx?: PostgresTransaction; lock?: boolean };
type PageInput = { authContext: unknown; kind?: Kind; state?: string | null; after?: string | null; pageLimit?: unknown };
export type CandidateDetail = CandidateQueryRow & { source_decision: { id: string; result_code: string; reason_code: string; catalog_version: string; rule_set_version: string; engine_version: string; decision_policy_version: string; input_hash: string; result_hash: string; source_refs: string[] }; manual_review: unknown; report_sources: { source_decision_id: string; journey_id: string; ticket_id: string | null; ticket_no: string | null; service_intake_id: string }[]; visible_report_source_count:number;report_sources_truncated:boolean;eligible_owners:CandidateOwner[];eligible_owners_truncated:boolean;materials:CandidateMaterial[];material_basis:string|null;allowed_actions:CandidateAction[];allowed_scopes:Incident['confirmed_scope'][];roles:readonly string[] };
export type P2012IncidentQuery = ReturnType<typeof createP2012IncidentQuery>;
import { createPilotWorkbenchAuthorizationAdapter } from './p2-006-workbench-authorization.mjs';
import { ticketPredicateP2016 } from './p2-016-ticket-query.mjs';
import { guard,uuid,limit,cursor,decodeCursor,frozen,fail,assertLocalDateTime,version,CANDIDATE_STATES,INCIDENT_STATES,allowedIncidentScopes,ERROR_CODES,safeCandidateSourceRefs } from './p2-012-domain-contracts.mjs';
import {readCandidateMaterial} from './p2-012-candidate-material.mjs';
import type {CandidateMaterial} from './p2-012-candidate-material.mjs';
export interface CandidateOwner {id:string;display_name:string;teams:{team_id:string;display_name:string}[];teams_truncated:boolean}
export type CandidateAction='START_REVIEW'|'REJECT_CANDIDATE'|'CONFIRM_INCIDENT';

export const broad=(p: WorkbenchPrincipal)=>p.roles.some(r=>['ADMIN','DISPATCHER'].includes(r));
function publicCandidate(row:CandidateQueryRow,p:WorkbenchPrincipal):CandidateQueryRow {
  const safe=Object.fromEntries(['id','candidate_key','source_decision_id','source_manual_review_id','cluster_key_hash','source_result_hash','service_family','symptom_family','scope_candidate','clinical_severity_candidate','distinct_reporters','distinct_departments','distinct_locations','correlation_window_ms','first_seen_at','last_seen_at','reason_codes','evidence_fact_ids','source_versions','status','row_version','event_ordinal','opened_by_principal_id','opened_at','confirmed_incident_id','created_at','updated_at','expires_at','expires_epoch_ms'].map(key=>[key,row[key as keyof CandidateQueryRow]])) as CandidateQueryRow;
  if(broad(p))return safe;
  return {...safe,cluster_key_hash:null,distinct_reporters:null,distinct_departments:null,distinct_locations:null,correlation_window_ms:null,first_seen_at:null,last_seen_at:null,evidence_fact_ids:[],opened_by_principal_id:null,confirmed_incident_id:null};
}
export function createP2012IncidentQuery({pool,enabled=false,allowDispatcherCampus=false,authorization=createPilotWorkbenchAuthorizationAdapter({pool})}: { pool: PostgresTransaction; enabled?: boolean; allowDispatcherCampus?:boolean;authorization?: Pick<WorkbenchAuthorizationAdapter, 'resolvePrincipal'> }){
  async function principal(authContext: unknown,tx: PostgresTransaction=pool){guard(enabled);const p=await authorization.resolvePrincipal(authContext,{queryable:tx});if(!p)fail('FORBIDDEN',403);return p;}
  function access(p: WorkbenchPrincipal,kind: Kind,start=2){const pred=ticketPredicateP2016(p,start);return {values:pred.values,sql:kind==='candidate'?
    `EXISTS(SELECT 1 FROM intake.deterministic_decision d LEFT JOIN pilot_ticket.ticket t ON t.id=d.linked_ticket_id WHERE d.id=c.source_decision_id AND ${pred.sql})`:
    `($${start}::boolean OR EXISTS(SELECT 1 FROM incident.incident_report r JOIN pilot_ticket.ticket t ON t.id=r.ticket_id WHERE r.incident_id=c.id AND r.link_state='LINKED' AND ${pred.sql}))`};}
  async function resource({authContext,id,kind,tx=pool,lock=false}: ReadInput & { kind: Kind }){
    const p=await principal(authContext,tx),a=access(p,kind);
    const r=await tx.query<ResourceRow>(`SELECT c.* FROM incident.${kind==='candidate'?'candidate_review':'incident'} c WHERE c.id=$1::uuid AND ${a.sql}${lock?' FOR UPDATE OF c':''}`,[uuid(id),...a.values]);
    if(r.rowCount!==1)fail('NOT_FOUND',404);return {principal:p,row:(r.rows[0] as ResourceRow)};
  }
  async function source({tx=pool,principal:p,id}: { tx?: PostgresTransaction; principal: WorkbenchPrincipal; id: unknown }){
    const pred=ticketPredicateP2016(p,2);
    const q=await tx.query<IncidentSource>(`SELECT d.id::text,d.journey_id::text,d.service_intake_id::text,d.linked_ticket_id::text AS ticket_id,
      d.channel_leg_id::text,t.ticket_no,j.reporter_identity_hash,j.origin_intake_id::text,t.assignee_id::text,t.resolver_team_id
      FROM intake.deterministic_decision d JOIN intake.contact_journey j ON j.id=d.journey_id
      LEFT JOIN pilot_ticket.ticket t ON t.id=d.linked_ticket_id WHERE d.id=$1::uuid AND ${pred.sql}`,[uuid(id),...pred.values]);
    if(q.rowCount!==1)fail('SOURCE_NOT_FOUND',404);return (q.rows[0] as IncidentSource);
  }
  const publicIncident=(r: Incident): IncidentPublicView=>Object.fromEntries(['id','incident_no','status','confirmed_scope','service_family','symptom_family','severity','safe_title','row_version','confirmed_at','investigating_at','resolved_at','closed_at','created_at','updated_at'].map(k=>[k,r[k as keyof Incident]])) as IncidentPublicView;
  return Object.freeze({principal,resource,source,
    async incidentCommandReceipt({authContext,id,commandId}:{authContext:unknown;id:string;commandId:string}):Promise<IncidentFollowupReceipt>{
      const {principal:p,row}=await resource({authContext,id,kind:'incident'}),clientId=uuid(commandId),base={incident_id:row.id,client_command_id:clientId};
      if(!broad(p)&&!p.roles.includes('HANDLER'))fail('FORBIDDEN',403);
      // Only identity metadata is read first. Original-purpose authorization
      // precedes every outcome read from the existing principal-bound ledger.
      const identity=(await pool.query<{id:string;command_type:string;incident_report_id:string|null}>(`SELECT id::text,command_type,incident_report_id::text FROM incident.command_receipt
        WHERE command_scope=$1 AND client_command_id=$2::uuid AND actor_principal_id=$3::uuid AND incident_id=$4::uuid
        AND command_type IN ('START_INVESTIGATING','CORRECT_SCOPE','SET_PRIMARY_TICKET','LINK_REPORT','UNLINK_REPORT','MARK_REPORTER_RECOVERED','PAUSE_SUBSCRIPTION','RESUME_SUBSCRIPTION','RESOLVE_INCIDENT','CLOSE_INCIDENT')`,['P2_012:'+p.principal_id,clientId,p.principal_id,row.id])).rows[0];
      // An absent command has no recorded purpose or outcome. UNKNOWN grants
      // no right to replay: a POST always rechecks its actual action and target.
      if(!identity)return frozen({...base,state:'UNKNOWN'});
      if(['CORRECT_SCOPE','CLOSE_INCIDENT','PAUSE_SUBSCRIPTION','RESUME_SUBSCRIPTION'].includes(identity.command_type)&&!p.roles.includes('ADMIN'))fail('FORBIDDEN',403);
      if(!broad(p)){
        if(identity.command_type!=='MARK_REPORTER_RECOVERED'||!identity.incident_report_id)fail('FORBIDDEN',403);
        const target=await pool.query('SELECT 1 FROM incident.incident_report r JOIN pilot_ticket.ticket t ON t.id=r.ticket_id WHERE r.id=$1::uuid AND r.incident_id=$2::uuid AND t.assignee_id=$3::uuid',[identity.incident_report_id,row.id,p.principal_id]);
        if(target.rowCount!==1)fail('FORBIDDEN',403);
      }
      const receipt=(await pool.query<{state:string;result_ref_type:string|null;result_ref_id:string|null;result_row_version:string|null;result_event_id:string|null;error_code:string|null;retryable:boolean|null}>(`SELECT state,result_ref_type,result_ref_id::text,result_row_version::text,result_event_id::text,error_code,retryable
        FROM incident.command_receipt WHERE id=$1::uuid AND command_scope=$2 AND client_command_id=$3::uuid AND incident_id=$4::uuid AND actor_principal_id=$5::uuid`,[identity.id,'P2_012:'+p.principal_id,clientId,row.id,p.principal_id])).rows[0];
      if(!receipt||receipt.state==='STARTED')return frozen({...base,state:'UNKNOWN'});
      if(receipt.state==='FAILED'){if(!receipt.error_code||!ERROR_CODES.includes(receipt.error_code)||receipt.retryable!==false)fail('COMMAND_FAILED',503);return frozen({...base,state:'FAILED',error:{code:receipt.error_code,retryable:false}});}
      if(receipt.state!=='COMMITTED'||receipt.result_ref_type!=='INCIDENT'||receipt.result_ref_id!==row.id||!receipt.result_row_version||!receipt.result_event_id)fail('COMMAND_FAILED',503);
      return frozen({...base,state:'COMMITTED',result:{ok:true,result_ref_type:'INCIDENT',result_ref_id:row.id,result_row_version:version(receipt.result_row_version),result_event_id:uuid(receipt.result_event_id),replayed:true}});
    },
    async candidateCommandReceipt({authContext,id,commandId}: {authContext:unknown;id:string;commandId:string}):Promise<CandidateCommandReceipt>{
      // Current object and purpose authority precede every principal-scoped ledger read.
      const {principal:p,row}=await resource({authContext,id,kind:'candidate'});
      if(!broad(p))fail('FORBIDDEN',403);
      const clientId=uuid(commandId),base={candidate_review_id:row.id,client_command_id:clientId};
      const q=await pool.query<{state:string;command_type:string;result_ref_type:string|null;result_ref_id:string|null;result_row_version:string|null;result_event_id:string|null;error_code:string|null;retryable:boolean|null}>(`SELECT state,command_type,result_ref_type,result_ref_id::text,result_row_version::text,result_event_id::text,error_code,retryable
        FROM incident.command_receipt WHERE command_scope=$1 AND client_command_id=$2::uuid AND candidate_review_id=$3::uuid
        AND actor_principal_id=$4::uuid AND command_type IN ('START_REVIEW','REJECT_CANDIDATE','CONFIRM_INCIDENT')`,['P2_012:'+p.principal_id,clientId,row.id,p.principal_id]);
      const receipt=q.rows[0];
      if(!receipt||receipt.state==='STARTED')return frozen({...base,state:'UNKNOWN'});
      if(receipt.state==='FAILED'){
        if(!receipt.error_code||!ERROR_CODES.includes(receipt.error_code)||receipt.retryable!==false)fail('COMMAND_FAILED',503);
        return frozen({...base,state:'FAILED',error:{code:receipt.error_code,retryable:false}});
      }
      const confirmation=receipt.command_type==='CONFIRM_INCIDENT';
      if(receipt.state!=='COMMITTED'||receipt.result_ref_type!==(confirmation?'INCIDENT':'CANDIDATE')||!receipt.result_ref_id||!receipt.result_row_version||!receipt.result_event_id)fail('COMMAND_FAILED',503);
      const ref=uuid(receipt.result_ref_id);
      if(confirmation)await resource({authContext,id:ref,kind:'incident'});
      else if(ref!==row.id)fail('COMMAND_FAILED',503);
      return frozen({...base,state:'COMMITTED',result:{ok:true,result_ref_type:confirmation?'INCIDENT':'CANDIDATE',result_ref_id:ref,result_row_version:version(receipt.result_row_version),result_event_id:uuid(receipt.result_event_id),replayed:true}});
    },
    async list({authContext,kind='incident',state=null,after=null,pageLimit}: PageInput){
      const p=await principal(authContext),n=limit(pageLimit),a=access(p,kind,1),allowed=kind==='candidate'?CANDIDATE_STATES:INCIDENT_STATES;
      if(state!==null&&!allowed.includes(state)&&!['ACTIVE','FINISHED'].includes(state))fail();
      const c=after?decodeCursor(after,['kind','state','at','id']):null;
      if(c&&(c.kind!==kind||c.state!==state))fail('CURSOR_INVALID');
      if(c){uuid(c.id);assertLocalDateTime(c.at);}
      const states=state==='ACTIVE'?INCIDENT_STATES.filter(s=>!['RESOLVED','CLOSED'].includes(s)):state==='FINISHED'?['RESOLVED','CLOSED']:state?[state]:null;
      const q=await pool.query<ResourceRow>(`SELECT c.* FROM incident.${kind==='candidate'?'candidate_review':'incident'} c WHERE ${a.sql}
        AND ($4::text[] IS NULL OR c.status=ANY($4::text[])) AND ($5::timestamp without time zone IS NULL OR (c.created_at,c.id)>($5::timestamp without time zone,$6::uuid))
        ORDER BY c.created_at,c.id LIMIT $7`,[...a.values,states,c?.at??null,c?.id??null,n+1]);
      const items=q.rows.slice(0,n).map(r=>kind==='candidate'?publicCandidate(r as CandidateQueryRow,p):publicIncident(r as Incident)),last=items.at(-1);
      return frozen({items,next_cursor:q.rows.length>n?cursor({kind,state,at:(last as CandidateReview | IncidentPublicView).created_at,id:(last as CandidateReview | IncidentPublicView).id}):null});
    },
    async detail({authContext,id,kind='incident'}: ReadInput): Promise<IncidentNarrowDetail | IncidentBroadDetail | CandidateDetail>{
      const {principal:p,row}=await resource({authContext,id,kind});
      if(kind==='incident'){
        const refs=broad(p)?(await pool.query<{ owner_display_name: string | null; primary_ticket_no: string | null }>('SELECT owner.display_name AS owner_display_name,t.ticket_no AS primary_ticket_no FROM pilot_ticket.pilot_principal owner LEFT JOIN pilot_ticket.ticket t ON t.id=$2::uuid WHERE owner.id=$1::uuid',[(row as Incident).owner_principal_id,(row as Incident).primary_ticket_id])).rows[0]:null;
        return frozen({...publicIncident(row as Incident),...(broad(p)?{owner_principal_id:(row as Incident).owner_principal_id,owner_display_name:refs?.owner_display_name??null,owner_team_id:(row as Incident).owner_team_id,primary_ticket_id:(row as Incident).primary_ticket_id,primary_ticket_no:refs?.primary_ticket_no??null}:{}),roles:p.roles});
      }
      const d=((await pool.query<{ id: string; result_code: string; reason_code: string; catalog_version: string; rule_set_version: string; engine_version: string; decision_policy_version: string; input_hash: string; result_hash: string; safe_result: unknown }>('SELECT id,result_code,reason_code,catalog_version,rule_set_version,engine_version,decision_policy_version,input_hash,result_hash,safe_result FROM intake.deterministic_decision WHERE id=$1::uuid',[(row as CandidateReview).source_decision_id])).rows[0] as { id: string; result_code: string; reason_code: string; catalog_version: string; rule_set_version: string; engine_version: string; decision_policy_version: string; input_hash: string; result_hash: string; safe_result: { incident_report_decision_ids?: unknown[]; source_refs?: unknown; }; });
      const refs=[...new Set(((d.safe_result as { incident_report_decision_ids?: unknown[] }).incident_report_decision_ids??[(row as CandidateReview).source_decision_id]).map(uuid))];const sources=[];
      for(const ref of refs.slice(0,100)){try{const s=await source({principal:p,id:ref});sources.push({source_decision_id:s.id,journey_id:s.journey_id,ticket_id:s.ticket_id,ticket_no:s.ticket_no,service_intake_id:s.service_intake_id});}catch(e){if((e as { code?: unknown }).code!=='P2_012_SOURCE_NOT_FOUND')throw e;}}
      const sourceAccess=ticketPredicateP2016(p,2);
      const population=await pool.query<{count:number}>(`SELECT count(DISTINCT d.id)::integer AS count FROM intake.deterministic_decision d
        LEFT JOIN pilot_ticket.ticket t ON t.id=d.linked_ticket_id WHERE d.id=ANY($1::uuid[]) AND ${sourceAccess.sql}`,[refs,...sourceAccess.values]);
      const visibleCount=population.rows[0]?.count??0;
      const manual=(row as CandidateReview).source_manual_review_id?(await pool.query('SELECT id,status,priority,review_reason_code,row_version,resolution_code,created_at,resolved_at FROM intake.manual_review_item WHERE id=$1::uuid',[(row as CandidateReview).source_manual_review_id])).rows[0]??null:null;
      const suppliedRefs=Array.isArray((d.safe_result as { source_refs?: unknown } | null)?.source_refs)?(d.safe_result as { source_refs: unknown[] }).source_refs:[];
      let safeRefs=suppliedRefs.filter((x): x is string=>typeof x==='string'&&/^(?:channel:[1-9][0-9]{0,18}|intake:[a-f0-9-]{36})$/iu.test(x)).slice(0,100);
      const ownerRows=broad(p)?(await pool.query<{id:string;display_name:string}>("SELECT p.id::text,p.display_name FROM pilot_ticket.pilot_principal p WHERE p.is_active AND EXISTS(SELECT 1 FROM pilot_ticket.pilot_principal_role r WHERE r.principal_id=p.id AND r.role IN ('ADMIN','DISPATCHER','HANDLER')) ORDER BY p.id LIMIT 101")).rows:[];
      const owners:CandidateOwner[]=[];
      for(const owner of ownerRows.slice(0,100)){
        const teams=(await pool.query<{team_id:string;display_name:string}>(`SELECT team.team_id,team.display_name FROM pilot_ticket.pilot_team_member m
          JOIN pilot_ticket.resolver_team team ON team.team_id=m.team_id AND team.is_active WHERE m.principal_id=$1::uuid ORDER BY team.team_id LIMIT 21`,[owner.id])).rows;
        owners.push({...owner,teams:teams.slice(0,20),teams_truncated:teams.length>20});
      }
      const material=await readCandidateMaterial(pool,[...new Set([...(broad(p)?refs:sources.map(s=>s.source_decision_id)),(row as CandidateReview).source_decision_id])]);
      const rootMaterial=material.items.find(item=>item.source_decision_id===d.id);
      const suppliedWebRefs=rootMaterial?.source_kind==='WEB'&&rootMaterial.status!=='EXPIRED'?safeCandidateSourceRefs(suppliedRefs).filter(ref=>/^web:/iu.test(ref)):[];
      if(suppliedWebRefs.length){
        // A Web hint names a persisted submission in the root's original capture,
        // never a guessed Intake, request token or Reporter identifier.
        const webAccess=ticketPredicateP2016(p,3);
        const retained=await pool.query<{id:string}>(`SELECT s.id::text FROM intake.deterministic_decision d
          JOIN intake.service_intake i ON i.id=d.service_intake_id
          JOIN intake.contact_journey j ON j.id=d.journey_id AND j.origin_intake_id=i.id
          JOIN intake.web_request_binding b ON b.intake_id=i.id
            AND b.source_app_scope=j.source_app_scope AND b.canonical_reporter_binding=j.reporter_identity_hash
          JOIN intake.web_submission s ON s.intake_id=i.id
          LEFT JOIN pilot_ticket.ticket t ON t.id=d.linked_ticket_id
          WHERE d.id=$1::uuid AND d.source_kind='WEB' AND s.id=ANY($2::uuid[]) AND ${webAccess.sql}
            AND s.input_revision BETWEEN d.source_window_start_sequence AND d.source_window_end_sequence
            AND b.revoked_at IS NULL AND b.retention_until>platform.local_now() AND s.retention_until>platform.local_now()
            AND i.retention_until_epoch_ms>platform.physical_epoch_ms() AND j.retention_until_epoch_ms>platform.physical_epoch_ms()
          ORDER BY s.input_revision LIMIT 100`,[d.id,suppliedWebRefs.map(ref=>uuid(ref.slice(4))),...webAccess.values]);
        const supplied=new Set(suppliedWebRefs),available=new Set(retained.rows.map(item=>item.id));
        safeRefs=suppliedRefs.filter((ref):ref is string=>typeof ref==='string'&&(/^(?:channel:[1-9][0-9]{0,18}|intake:[a-f0-9-]{36})$/iu.test(ref)||(supplied.has(ref)&&available.has(ref.slice(4).toLowerCase())))).slice(0,100);
      }
      const decision={id:d.id,result_code:d.result_code,reason_code:d.reason_code,catalog_version:d.catalog_version,rule_set_version:d.rule_set_version,engine_version:d.engine_version,decision_policy_version:d.decision_policy_version,input_hash:d.input_hash,result_hash:d.result_hash,source_refs:safeRefs};
      const expired=(await pool.query<{expired:boolean}>('SELECT $1::bigint<=platform.physical_epoch_ms() AS expired',[(row as CandidateReview).expires_epoch_ms])).rows[0]?.expired!==false;
      const actions:CandidateAction[]=[];
      if(broad(p)){
        if(row.status==='CANDIDATE'&&!expired)actions.push('START_REVIEW');
        if(['CANDIDATE','UNDER_REVIEW'].includes(row.status))actions.push('REJECT_CANDIDATE');
        if(row.status==='UNDER_REVIEW'&&!expired&&material.items.every(m=>m.status==='CURRENT'))actions.push('CONFIRM_INCIDENT');
      }
      return frozen({...publicCandidate(row as CandidateQueryRow,p),source_decision:decision,manual_review:manual,report_sources:sources,
        visible_report_source_count:visibleCount,report_sources_truncated:visibleCount>sources.length,eligible_owners:owners,eligible_owners_truncated:ownerRows.length>100,
        materials:material.items,material_basis:broad(p)?material.basis:null,allowed_actions:actions,allowed_scopes:allowedIncidentScopes(p.roles,allowDispatcherCampus),roles:p.roles});
    },
    async children({authContext,id,part,after=null,pageLimit}: { authContext: unknown; id: string; part: string; after?: string | null; pageLimit?: unknown }){
      const {principal:p,row}=await resource({authContext,id,kind:'incident'}),n=limit(pageLimit,part==='events'?200:100);
      const c=after?decodeCursor(after,part==='events'?['incident','part','id','ordinal']:['incident','part','id']):null;if(c&&(c.incident!==id||c.part!==part))fail('CURSOR_INVALID');if(c){uuid(c.id);if(part==='events')version(c.ordinal);}
      const directSubscription=/^subscriptions\/([a-f0-9-]{36})\/direct-destinations$/iu.exec(part);
      let sql: string,values: unknown[]=[row.id,c?.id??null,n+1];
      if(part==='events'){
        sql=`SELECT id,event_type,event_ordinal,old_status,new_status,old_scope,new_scope,occurred_at FROM incident.incident_event WHERE incident_id=$1::uuid AND ($2::bigint IS NULL OR event_ordinal>$2::bigint) AND ($4::boolean OR event_type IN ('incident.confirmed','incident.investigating','incident.resolved','incident.closed')) ORDER BY event_ordinal,id LIMIT $3`;values[1]=c?.ordinal??null;values.push(broad(p));
      }else if(part==='reports'){
        const pred=ticketPredicateP2016(p,4);values.push(...pred.values);
        sql=`SELECT r.id,r.ticket_id,t.ticket_no,r.service_intake_id,r.link_state,r.impact_state,r.row_version,r.linked_at,r.unlinked_at,r.recovered_at FROM incident.incident_report r LEFT JOIN pilot_ticket.ticket t ON t.id=r.ticket_id WHERE r.incident_id=$1::uuid AND ($2::uuid IS NULL OR r.id>$2::uuid) AND ${pred.sql} ORDER BY r.id LIMIT $3`;
      }else if(part==='linkable-reports'){
        if(!broad(p))fail('FORBIDDEN',403);
        sql=`SELECT d.id AS source_decision_id,d.id,t.ticket_no FROM intake.deterministic_decision d
          JOIN pilot_ticket.ticket t ON t.id=d.linked_ticket_id WHERE ($2::uuid IS NULL OR d.id>$2::uuid)
          AND NOT EXISTS(SELECT 1 FROM incident.incident_report r JOIN incident.incident i ON i.id=r.incident_id
            WHERE r.ticket_id=t.id AND r.link_state='LINKED' AND i.status<>'CLOSED')
          AND $1::uuid IS NOT NULL ORDER BY d.id LIMIT $3`;
      }else if(part==='direct-destinations'||directSubscription){
        if(!p.roles.includes('ADMIN'))fail('FORBIDDEN',403);
        values.push(directSubscription?uuid(directSubscription[1]):null);
        sql=`SELECT l.id,s.id AS subscription_id,i.intake_no AS source_intake_no FROM incident.reporter_subscription s
          JOIN intake.channel_leg l ON l.reporter_identity_hash=s.reporter_identity_hash
          JOIN intake.contact_journey j ON j.id=l.journey_id AND j.reporter_identity_hash=l.reporter_identity_hash AND j.retention_until_epoch_ms>platform.physical_epoch_ms()
          JOIN intake.service_intake i ON i.id=l.source_intake_id
          WHERE s.incident_id=$1::uuid AND ($4::uuid IS NULL OR s.id=$4::uuid) AND s.status<>'ENDED' AND l.leg_type IN ('DIRECT_GUIDED','DIRECT_ORGANIC')
            AND i.source_chat_type='single' AND ($2::uuid IS NULL OR l.id>$2::uuid) ORDER BY l.id LIMIT $3`;
      }else if(part==='subscriptions'){
        if(!broad(p))fail('FORBIDDEN',403);
        sql=`SELECT id,representative_report_id,status,impact_state,row_version,last_notified_incident_version,created_at,updated_at FROM incident.reporter_subscription WHERE incident_id=$1::uuid AND ($2::uuid IS NULL OR id>$2::uuid) ORDER BY id LIMIT $3`;
      }else if(part==='notifications'){
        if(!broad(p))fail('FORBIDDEN',403);
        sql=`SELECT b.id,b.audience_type,b.template_code,d.id AS delivery_id,d.status,d.side_effect_state,d.attempt_count,b.created_at FROM communication.incident_notification_binding b JOIN communication.outbox o ON o.message_id=b.communication_message_id JOIN communication.delivery d ON d.outbox_id=o.id WHERE b.incident_id=$1::uuid AND ($2::uuid IS NULL OR b.id>$2::uuid) ORDER BY b.id LIMIT $3`;
      }else fail();
      const q=await pool.query(sql,values),items=q.rows.slice(0,n);return frozen({items,next_cursor:q.rows.length>n?cursor({incident:id,part,id:(items.at(-1) as Record<string, unknown>).id,...(part==='events'?{ordinal:String((items.at(-1) as Record<string, unknown>).event_ordinal)}:{})}):null});
    },
  });
}
