import {createHmac,timingSafeEqual} from 'node:crypto';
import type {PostgresPool,PostgresTransaction} from './platform/postgres-pool.mjs';
import type {YxxMemberScope} from './yxx-self-service-authorization.mjs';
import type {H5Profile,H5DepartmentPage,H5DepartmentReport,H5PublicProgress,H5BootstrapExtension,H5ReportFilters} from '../contracts/yxx_h5_v2_contracts.js';
import type {H5MemberContext} from './yxx-h5-v2-lifecycle.mjs';
import type {H5DepartmentSummary} from '../contracts/yxx_h5_entry_contracts.js';
import {hashP2016,transactionP2016} from './p2-016-domain-contracts.mjs';
import {shanghaiLocalToEpochMs} from './platform/time-contract.mjs';
import {H5_LIMITS,h5Fail,h5Uuid,parseH5ReportFilters} from './yxx-h5-v2-contracts.mjs';
import {h5DepartmentReportsSql,h5DepartmentPageSql,type H5BatchMembershipProof,type H5BatchSqlInput} from './yxx-h5-batch-sql.mjs';

// ADR-0036 / ARCH-005: reuse the qualified expression, never a
// clock value. Every department read guard still obtains its own physical epoch.


interface ProfileRow {name:string|null;phone:string|null;avatar_url:string|null;account_status:string;provider_user_id:string;snapshot_version:string;departments:{department_ref:string;name:string}[]}
interface DepartmentRow {id:string;ticket_no:string;service_category:string|null;status:string;created_at:string;summary:string|null;estimated_at:string|null;estimated_epoch_ms:string|null;progress_version:number|null;progress_at:string|null;progress_epoch:string|null}
interface Options {pool:PostgresPool;scopeSecret:string;enabled?:boolean;sourceScope?:string;maximumDirectoryAgeMs?:number}
export interface H5ResolvedProfile {profile:H5Profile;can_view_department:boolean;membership_hash:string;membership_proof:H5BatchMembershipProof|null}
export function createYxxH5Profile({pool,scopeSecret,enabled=false,sourceScope='FORMAL',maximumDirectoryAgeMs=86400000}:Options){
  if(typeof enabled!=='boolean'||Buffer.byteLength(scopeSecret)<32||!Number.isSafeInteger(maximumDirectoryAgeMs)||maximumDirectoryAgeMs<1||maximumDirectoryAgeMs>604800000)h5Fail('YXX_UNAVAILABLE',503);
  async function resolveInTransaction(tx:PostgresTransaction,scope:YxxMemberScope):Promise<H5ResolvedProfile>{
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
      membership_hash:hashP2016([sourceScope,row?.provider_user_id??null,row?.snapshot_version??null,departments.map(d=>d.department_ref)]),
      membership_proof:row?{source_scope:sourceScope,provider_user_id:row.provider_user_id,snapshot_version:row.snapshot_version,department_refs:departments.map(d=>d.department_ref)}:null};
  }
  async function resolve(scope:YxxMemberScope){return transactionP2016(pool,tx=>resolveInTransaction(tx,scope));}
  function bootstrapFromResolved(member:H5MemberContext,data:H5ResolvedProfile,sdk:H5BootstrapExtension['sdk']={enabled:false,corp_id:null,agent_id:null}):H5BootstrapExtension{
    if(!enabled)h5Fail('YXX_UNAVAILABLE',503);
    const write=member.write_flag&&member.flags.YIXIAOXIU_SELF_SERVICE_ENABLED&&member.flags.YIXIAOXIU_MY_REPORTS_ENABLED;
    return {profile:data.profile,can_view_department:data.can_view_department,can_upload:write,can_urge:write,can_evaluate:write,sdk,
      support:{emergency_phone:'18117887318',service_phone:'61318500'},limits:{...H5_LIMITS}};
  }
  async function bootstrap(member:H5MemberContext,sdk:H5BootstrapExtension['sdk']={enabled:false,corp_id:null,agent_id:null}):Promise<H5BootstrapExtension>{
    if(!enabled)h5Fail('YXX_UNAVAILABLE',503);
    return bootstrapFromResolved(member,await resolve(member.scope),sdk);
  }
  const token=(body:unknown)=>{const d=Buffer.from(JSON.stringify(body)).toString('base64url');return d+'.'+createHmac('sha256',scopeSecret).update(d).digest('base64url');};
  function cursor(value:string,scope:YxxMemberScope,membership:string,filters:Required<H5ReportFilters>){
    const [data,signature,extra]=value.split('.');if(!data||!signature||extra!==undefined||value.length>2048)h5Fail('YXX_CURSOR_INVALID');
    const expected=Buffer.from(createHmac('sha256',scopeSecret).update(data).digest('base64url')),actual=Buffer.from(signature);if(expected.length!==actual.length||!timingSafeEqual(expected,actual))h5Fail('YXX_CURSOR_INVALID');
    let v:Record<string,unknown>;try{v=JSON.parse(Buffer.from(data,'base64url').toString('utf8'));}catch{h5Fail('YXX_CURSOR_INVALID');}
    if(!v||typeof v!=='object'||Array.isArray(v)||v.purpose!=='H5_DEPARTMENT'||v.scope!==hashP2016(scope)||v.membership!==membership||v.filters!==hashP2016(filters)||typeof v.at!=='string')h5Fail('YXX_CURSOR_INVALID');
    try{shanghaiLocalToEpochMs(v.at);}catch{h5Fail('YXX_CURSOR_INVALID');}return {at:v.at,id:h5Uuid(v.id)};
  }
  async function revalidateInTransaction(tx:PostgresTransaction,scope:YxxMemberScope,member:H5ResolvedProfile){
    const latest=await resolveInTransaction(tx,scope);
    if(latest.membership_hash!==member.membership_hash||latest.can_view_department!==member.can_view_department)h5Fail('YXX_FORBIDDEN',403);
  }
  async function prepareDepartmentReadInTransaction(tx:PostgresTransaction){
    if(!enabled)h5Fail('YXX_UNAVAILABLE',503);
    await tx.query("SET LOCAL work_mem='16MB'");
    await tx.query('SET LOCAL hash_mem_multiplier=2');
    await tx.query('SET LOCAL max_parallel_workers_per_gather=0');
  }
  const departmentReportsSql=h5DepartmentReportsSql;
  function departmentSummaryStatement(scope:YxxMemberScope,member:H5ResolvedProfile){
    if(!enabled)h5Fail('YXX_UNAVAILABLE',503);if(!member.can_view_department)h5Fail('YXX_FORBIDDEN',403);
    return {text:departmentReportsSql(false)+`
      SELECT count(*)::integer AS total,count(*) FILTER(WHERE status NOT IN ('CLOSED','CANCELLED','DUPLICATE_LINKED','RESOLVED'))::integer AS active_count FROM reports`,
      values:[scope.scopeHash,sourceScope,scope.sourceCorpScope,scope.sourceAppScope,maximumDirectoryAgeMs]};
  }
  async function departmentSummaryInTransaction(tx:PostgresTransaction,scope:YxxMemberScope,member?:H5ResolvedProfile):Promise<H5DepartmentSummary>{
    if(!enabled)h5Fail('YXX_UNAVAILABLE',503);
    const current=member??await resolveInTransaction(tx,scope),statement=departmentSummaryStatement(scope,current);
    await prepareDepartmentReadInTransaction(tx);
    const counts=(await tx.query<{total:number;active_count:number}>(statement.text,statement.values)).rows[0];
    await revalidateInTransaction(tx,scope,current);
    return {total:counts?.total??0,active_count:counts?.active_count??0,membership_revision:current.membership_hash};
  }
  async function departmentInTransaction(tx:PostgresTransaction,scope:YxxMemberScope,{limit=20,cursor:rawCursor=null,resolved,...rawFilters}:{limit?:number;cursor?:string|null;resolved?:H5ResolvedProfile}&H5ReportFilters={}):Promise<H5DepartmentPage>{
    if(!enabled)h5Fail('YXX_UNAVAILABLE',503);
    if(!Number.isSafeInteger(limit)||limit<1||limit>50)h5Fail();const filters=parseH5ReportFilters(rawFilters),member=resolved??await resolveInTransaction(tx,scope);
    if(!member.can_view_department)h5Fail('YXX_FORBIDDEN',403);const after=rawCursor?cursor(rawCursor,scope,member.membership_hash,filters):null;
    await prepareDepartmentReadInTransaction(tx);
    const args:unknown[]=[scope.scopeHash,sourceScope,scope.sourceCorpScope,scope.sourceAppScope,maximumDirectoryAgeMs,filters.search,filters.status];
    const result=(await tx.query<{total:number;active_count:number;items:DepartmentRow[]}>(h5DepartmentPageSql(),[...args,after?.at??null,after?.id??null,limit+1])).rows[0];
    const page=departmentPageFromRows(scope,member,result??{items:[],total:0,active_count:0},limit,filters);
    // A new statement must observe relationship changes after the page read.
    await revalidateInTransaction(tx,scope,member);return page;
  }
  function departmentPageFromRows(scope:YxxMemberScope,member:H5ResolvedProfile,result:{items:DepartmentRow[];total:number;active_count:number},limit:number,filters:Required<H5ReportFilters>):H5DepartmentPage{
    const rows=result?.items??[];
    const page=rows.slice(0,limit),items:H5DepartmentReport[]=page.map(row=>({ticket_no:row.ticket_no,service_category:row.service_category,status:row.status,created_at:row.created_at,
      public_progress:row.summary&&row.progress_version!==null&&row.progress_at&&row.progress_epoch?{summary:row.summary,estimated_at:row.estimated_at,estimated_epoch_ms:row.estimated_epoch_ms,version:row.progress_version,updated_at:row.progress_at,updated_epoch_ms:row.progress_epoch} satisfies H5PublicProgress:null}));
    const last=page.at(-1),next=rows.length>limit&&last?token({purpose:'H5_DEPARTMENT',scope:hashP2016(scope),membership:member.membership_hash,filters:hashP2016(filters),at:last.created_at,id:last.id}):null;
    return {items,next_cursor:next,total:result?.total??0,active_count:result?.active_count??0};
  }
  function batchInput(scope:YxxMemberScope,member:H5ResolvedProfile,recent:readonly (string|number|null)[]=[]):H5BatchSqlInput{
    const proof=member.membership_proof;if(!enabled||!member.can_view_department||!proof)h5Fail('YXX_FORBIDDEN',403);
    return Object.freeze({scope_hash:scope.scopeHash,source_scope:sourceScope,source_corp_scope:scope.sourceCorpScope,source_app_scope:scope.sourceAppScope,maximum_directory_age_ms:maximumDirectoryAgeMs,
      expected_provider_user_id:proof.provider_user_id,expected_snapshot_version:proof.snapshot_version,expected_department_refs:Object.freeze([...proof.department_refs]),recent:Object.freeze([...recent])});
  }
  function verifyBatchProof(member:H5ResolvedProfile,value:unknown){
    if(!value||typeof value!=='object'||Array.isArray(value))h5Fail('YXX_QUERY_ROW_INVALID',503);
    if(!('source_scope' in value)||!('provider_user_id' in value)||!('snapshot_version' in value)||!('department_refs' in value)||value.source_scope!==sourceScope||typeof value.provider_user_id!=='string'||typeof value.snapshot_version!=='string'||!Array.isArray(value.department_refs)||value.department_refs.some(item=>typeof item!=='string'))h5Fail('YXX_QUERY_ROW_INVALID',503);
    if(hashP2016([sourceScope,value.provider_user_id,value.snapshot_version,value.department_refs])!==member.membership_hash)h5Fail('YXX_FORBIDDEN',403);
  }
  function departmentPageFromBatch(scope:YxxMemberScope,member:H5ResolvedProfile,value:unknown){
    if(!value||typeof value!=='object'||Array.isArray(value)||!('items' in value)||!Array.isArray(value.items)||value.items.length>21||!('total' in value)||typeof value.total!=='number'||!Number.isSafeInteger(value.total)||value.total<0||!('active_count' in value)||typeof value.active_count!=='number'||!Number.isSafeInteger(value.active_count)||value.active_count<0||value.active_count>value.total)h5Fail('YXX_QUERY_ROW_INVALID',503);
    const nullable=(data:unknown)=>{if(data===null||typeof data==='string')return data;return h5Fail('YXX_QUERY_ROW_INVALID',503);};
    const text=(data:unknown)=>{if(typeof data==='string')return data;return h5Fail('YXX_QUERY_ROW_INVALID',503);};
    const items:DepartmentRow[]=value.items.map((item:unknown)=>{
      if(!item||typeof item!=='object'||Array.isArray(item)||!('id' in item)||!('ticket_no' in item)||!('status' in item)||!('created_at' in item)||!('service_category' in item)||!('summary' in item)||!('estimated_at' in item)||!('estimated_epoch_ms' in item)||!('progress_version' in item)||!('progress_at' in item)||!('progress_epoch' in item))h5Fail('YXX_QUERY_ROW_INVALID',503);
      if(item.progress_version!==null&&(typeof item.progress_version!=='number'||!Number.isSafeInteger(item.progress_version)))h5Fail('YXX_QUERY_ROW_INVALID',503);
      return {id:h5Uuid(item.id),ticket_no:text(item.ticket_no),status:text(item.status),created_at:text(item.created_at),service_category:nullable(item.service_category),summary:nullable(item.summary),estimated_at:nullable(item.estimated_at),estimated_epoch_ms:nullable(item.estimated_epoch_ms),progress_version:item.progress_version,progress_at:nullable(item.progress_at),progress_epoch:nullable(item.progress_epoch)};
    });
    return departmentPageFromRows(scope,member,{items,total:value.total,active_count:value.active_count},20,parseH5ReportFilters({}));
  }
  return Object.freeze({resolve,resolveInTransaction,revalidateInTransaction,bootstrap,bootstrapFromResolved,departmentInTransaction,prepareDepartmentReadInTransaction,departmentSummaryStatement,departmentSummaryInTransaction,batchInput,verifyBatchProof,departmentPageFromBatch,
    departmentSummary:(scope:YxxMemberScope)=>transactionP2016(pool,tx=>departmentSummaryInTransaction(tx,scope)),
    department:(scope:YxxMemberScope,input?:Parameters<typeof departmentInTransaction>[2])=>transactionP2016(pool,tx=>departmentInTransaction(tx,scope,input))});
}
export type YxxH5Profile=ReturnType<typeof createYxxH5Profile>;
