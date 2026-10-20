import {createHmac,timingSafeEqual} from 'node:crypto';
import type {PostgresPool,PostgresTransaction} from './platform/postgres-pool.mjs';
import type {YxxMemberScope} from './yxx-self-service-authorization.mjs';
import type {H5Profile,H5DepartmentPage,H5DepartmentReport,H5PublicProgress,H5BootstrapExtension,H5ReportFilters} from '../contracts/yxx_h5_v2_contracts.js';
import type {H5MemberContext} from './yxx-h5-v2-lifecycle.mjs';
import {hashP2016,transactionP2016} from './p2-016-domain-contracts.mjs';
import {shanghaiLocalToEpochMs} from './platform/time-contract.mjs';
import {H5_LIMITS,h5Fail,h5Uuid,parseH5ReportFilters} from './yxx-h5-v2-contracts.mjs';

interface ProfileRow {name:string|null;phone:string|null;avatar_url:string|null;account_status:string;provider_user_id:string;snapshot_version:string;departments:{department_ref:string;name:string}[]}
interface DepartmentRow {id:string;ticket_no:string;service_category:string|null;status:string;created_at:string;summary:string|null;estimated_at:string|null;estimated_epoch_ms:string|null;progress_version:number|null;progress_at:string|null;progress_epoch:string|null}
interface Options {pool:PostgresPool;scopeSecret:string;enabled?:boolean;sourceScope?:string;maximumDirectoryAgeMs?:number}
export function createYxxH5Profile({pool,scopeSecret,enabled=false,sourceScope='FORMAL',maximumDirectoryAgeMs=86400000}:Options){
  if(typeof enabled!=='boolean'||Buffer.byteLength(scopeSecret)<32||!Number.isSafeInteger(maximumDirectoryAgeMs)||maximumDirectoryAgeMs<1||maximumDirectoryAgeMs>604800000)h5Fail('YXX_UNAVAILABLE',503);
  async function resolveInTransaction(tx:PostgresTransaction,scope:YxxMemberScope){
    const row=(await tx.query<ProfileRow>(`SELECT m.nickname AS name,m.phone,m.avatar_url,m.account_status,m.provider_user_id,m.snapshot_version,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('department_ref',d.provider_department_id,'name',d.name) ORDER BY d.provider_department_id)
       FROM directory.membership_current x JOIN directory.department_current d ON d.source_scope=x.source_scope AND d.provider_department_id=x.provider_department_id
        AND d.snapshot_version=m.snapshot_version WHERE x.source_scope=m.source_scope AND x.provider_user_id=m.provider_user_id AND x.snapshot_version=m.snapshot_version),'[]'::jsonb) AS departments
      FROM directory.identity_binding b JOIN directory.member_current m ON m.source_scope=b.source_scope AND m.provider_user_id=b.provider_user_id
      JOIN directory.current_snapshot s ON s.source_scope=m.source_scope AND s.snapshot_version=m.snapshot_version AND s.snapshot_version=b.bound_snapshot_version
      WHERE b.source_scope=$1 AND b.reporter_identity_hash=$2 AND b.binding_status='ACTIVE' AND m.account_status<>'INACTIVE'
       AND s.fetched_at>=platform.local_from_epoch_ms(platform.physical_epoch_ms()-$3::bigint)
      LIMIT 1`,[sourceScope,scope.scopeHash,maximumDirectoryAgeMs])).rows[0];
    const departments=row&&Array.isArray(row.departments)?row.departments:[];
    const profile:H5Profile={name:row?.name??null,phone:row?.phone??null,avatar_url:row?.avatar_url??null,department:departments.length?departments.map(d=>d.name).join('、'):null};
    return {profile,can_view_department:row?.account_status==='ACTIVE'&&departments.length>0,
      membership_hash:hashP2016([sourceScope,row?.provider_user_id??null,row?.snapshot_version??null,departments.map(d=>d.department_ref)])};
  }
  async function resolve(scope:YxxMemberScope){return transactionP2016(pool,tx=>resolveInTransaction(tx,scope));}
  async function bootstrap(member:H5MemberContext,sdk:H5BootstrapExtension['sdk']={enabled:false,corp_id:null,agent_id:null}):Promise<H5BootstrapExtension>{
    if(!enabled)h5Fail('YXX_UNAVAILABLE',503);
    const data=await resolve(member.scope),write=enabled&&member.write_flag&&member.flags.YIXIAOXIU_SELF_SERVICE_ENABLED&&member.flags.YIXIAOXIU_MY_REPORTS_ENABLED;
    return {profile:data.profile,can_view_department:data.can_view_department,can_upload:write,can_urge:write,can_evaluate:write,sdk,
      support:{emergency_phone:'18117887318',service_phone:'61318500'},limits:{...H5_LIMITS}};
  }
  const token=(body:unknown)=>{const d=Buffer.from(JSON.stringify(body)).toString('base64url');return d+'.'+createHmac('sha256',scopeSecret).update(d).digest('base64url');};
  function cursor(value:string,scope:YxxMemberScope,membership:string,filters:Required<H5ReportFilters>){
    const [data,signature,extra]=value.split('.');if(!data||!signature||extra!==undefined||value.length>2048)h5Fail('YXX_CURSOR_INVALID');
    const expected=Buffer.from(createHmac('sha256',scopeSecret).update(data).digest('base64url')),actual=Buffer.from(signature);if(expected.length!==actual.length||!timingSafeEqual(expected,actual))h5Fail('YXX_CURSOR_INVALID');
    let v:Record<string,unknown>;try{v=JSON.parse(Buffer.from(data,'base64url').toString('utf8'));}catch{h5Fail('YXX_CURSOR_INVALID');}
    if(!v||typeof v!=='object'||Array.isArray(v)||v.purpose!=='H5_DEPARTMENT'||v.scope!==hashP2016(scope)||v.membership!==membership||v.filters!==hashP2016(filters)||typeof v.at!=='string')h5Fail('YXX_CURSOR_INVALID');
    try{shanghaiLocalToEpochMs(v.at);}catch{h5Fail('YXX_CURSOR_INVALID');}return {at:v.at,id:h5Uuid(v.id)};
  }
  async function departmentInTransaction(tx:PostgresTransaction,scope:YxxMemberScope,{limit=20,cursor:rawCursor=null,...rawFilters}:{limit?:number;cursor?:string|null}&H5ReportFilters={}):Promise<H5DepartmentPage>{
    if(!enabled)h5Fail('YXX_UNAVAILABLE',503);
    if(!Number.isSafeInteger(limit)||limit<1||limit>50)h5Fail();const filters=parseH5ReportFilters(rawFilters),member=await resolveInTransaction(tx,scope);
    if(!member.can_view_department)h5Fail('YXX_FORBIDDEN',403);const after=rawCursor?cursor(rawCursor,scope,member.membership_hash,filters):null;
    const args:unknown[]=[scope.scopeHash,sourceScope,scope.sourceCorpScope,scope.sourceAppScope,maximumDirectoryAgeMs,filters.search,filters.status];
    const sql=`WITH current_member AS (
      SELECT m.provider_user_id,m.source_scope FROM directory.identity_binding b JOIN directory.member_current m ON m.source_scope=b.source_scope AND m.provider_user_id=b.provider_user_id
      JOIN directory.current_snapshot s ON s.source_scope=m.source_scope AND s.snapshot_version=m.snapshot_version AND s.snapshot_version=b.bound_snapshot_version
      WHERE b.reporter_identity_hash=$1 AND b.source_scope=$2 AND b.binding_status='ACTIVE' AND m.account_status='ACTIVE'
       AND s.fetched_at>=platform.local_from_epoch_ms(platform.physical_epoch_ms()-$5::bigint)
    ), reports AS (
      SELECT t.id,t.ticket_no,t.status,to_char(t.created_at,'YYYY-MM-DD HH24:MI:SS') AS created_at,
       initial.safe_content->>'service_code' AS service_category,p.summary,to_char(p.estimated_at,'YYYY-MM-DD HH24:MI:SS') AS estimated_at,p.estimated_epoch_ms::text,
       p.ticket_version AS progress_version,to_char(p.occurred_at,'YYYY-MM-DD HH24:MI:SS') AS progress_at,p.occurred_epoch_ms::text AS progress_epoch
      FROM intake.web_request_binding wb JOIN intake.service_intake i ON i.id=wb.intake_id AND i.canonical_reporter_binding=wb.canonical_reporter_binding AND i.source_app_scope=wb.source_app_scope
      JOIN pilot_ticket.ticket t ON t.id=i.pilot_ticket_id
      JOIN directory.identity_binding rb ON rb.source_scope=$2 AND rb.reporter_identity_hash=wb.canonical_reporter_binding AND rb.binding_status='ACTIVE'
      JOIN directory.member_current rm ON rm.source_scope=rb.source_scope AND rm.provider_user_id=rb.provider_user_id AND rm.account_status='ACTIVE'
      JOIN directory.current_snapshot rs ON rs.source_scope=rm.source_scope AND rs.snapshot_version=rm.snapshot_version AND rs.snapshot_version=rb.bound_snapshot_version
      LEFT JOIN LATERAL(SELECT safe_content FROM intake.web_submission s WHERE s.intake_id=i.id AND s.kind='SUBMIT' AND s.retention_until_epoch_ms>platform.physical_epoch_ms() ORDER BY s.input_revision LIMIT 1) initial ON TRUE
      LEFT JOIN LATERAL(SELECT * FROM pilot_ticket.ticket_public_progress p WHERE p.ticket_id=t.id ORDER BY p.ticket_version DESC LIMIT 1)p ON TRUE
      WHERE wb.source_corp_scope=$3 AND wb.source_app_scope=$4 AND i.source_provider='YIXIAOXIU_WEB'
       AND wb.revoked_at IS NULL AND wb.retention_until_epoch_ms>platform.physical_epoch_ms() AND i.retention_until_epoch_ms>platform.physical_epoch_ms()
       AND rs.fetched_at>=platform.local_from_epoch_ms(platform.physical_epoch_ms()-$5::bigint)
       AND EXISTS(SELECT 1 FROM current_member cm JOIN directory.membership_current mine ON mine.source_scope=cm.source_scope AND mine.provider_user_id=cm.provider_user_id
         JOIN directory.membership_current theirs ON theirs.source_scope=mine.source_scope AND theirs.provider_department_id=mine.provider_department_id
          AND theirs.snapshot_version=mine.snapshot_version WHERE theirs.provider_user_id=rm.provider_user_id AND theirs.snapshot_version=rm.snapshot_version)
    ), filtered AS(SELECT * FROM reports WHERE ($6::text IS NULL OR strpos(lower(ticket_no||' '||COALESCE(service_category,'')||' '||COALESCE(summary,'')),lower($6))>0)
      AND ($7::text IS NULL OR CASE WHEN $7='COMPLETED' THEN status IN ('CLOSED','CANCELLED','DUPLICATE_LINKED','RESOLVED') WHEN $7='ACTIVE' THEN status IN ('IN_PROGRESS','WAITING_REQUESTER','WAITING_VENDOR') ELSE status IN ('NEW','QUEUED','ACCEPTED','REOPENED') END))`;
    const counts=(await tx.query<{total:number;active_count:number}>(sql+` SELECT count(*)::integer AS total,count(*) FILTER(WHERE status NOT IN ('CLOSED','CANCELLED','DUPLICATE_LINKED','RESOLVED'))::integer AS active_count FROM filtered`,args)).rows[0];
    const rows=(await tx.query<DepartmentRow>(sql+` SELECT * FROM filtered WHERE ($8::timestamp without time zone IS NULL OR (created_at::timestamp without time zone,id)<($8::timestamp without time zone,$9::uuid)) ORDER BY created_at DESC,id DESC LIMIT $10`,[...args,after?.at??null,after?.id??null,limit+1])).rows;
    const page=rows.slice(0,limit),items:H5DepartmentReport[]=page.map(row=>({ticket_no:row.ticket_no,service_category:row.service_category,status:row.status,created_at:row.created_at,
      public_progress:row.summary&&row.progress_version!==null&&row.progress_at&&row.progress_epoch?{summary:row.summary,estimated_at:row.estimated_at,estimated_epoch_ms:row.estimated_epoch_ms,version:row.progress_version,updated_at:row.progress_at,updated_epoch_ms:row.progress_epoch} satisfies H5PublicProgress:null}));
    const last=page.at(-1),next=rows.length>limit&&last?token({purpose:'H5_DEPARTMENT',scope:hashP2016(scope),membership:member.membership_hash,filters:hashP2016(filters),at:last.created_at,id:last.id}):null;
    // Organization data can change while a query waits. Revalidate this membership before returning anything.
    const latest=await resolveInTransaction(tx,scope);if(!latest.can_view_department||latest.membership_hash!==member.membership_hash)h5Fail('YXX_FORBIDDEN',403);
    return {items,next_cursor:next,total:counts?.total??0,active_count:counts?.active_count??0};
  }
  return Object.freeze({resolve,resolveInTransaction,bootstrap,departmentInTransaction,department:(scope:YxxMemberScope,input?:Parameters<typeof departmentInTransaction>[2])=>transactionP2016(pool,tx=>departmentInTransaction(tx,scope,input))});
}
export type YxxH5Profile=ReturnType<typeof createYxxH5Profile>;
