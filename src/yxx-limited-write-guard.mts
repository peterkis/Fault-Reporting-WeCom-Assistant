import type { ApprovedLimitedManifest, LimitedMemberConfig } from './yxx-limited-write-contract.mjs';
import type { PostgresTransaction, PostgresPool, PostgresPoolClient } from './platform/postgres-pool.mjs';
import type { QueryConfig, QueryResult } from 'pg';
import type { YxxQuota } from './yxx-self-service-command.mjs';
export interface LimitedCounts {intakes:number;supplements:number;tickets:number}
export interface LimitedGuardOptions {manifest:ApprovedLimitedManifest;member:LimitedMemberConfig;secret:string;stopFile?:string|undefined;isStopped?:()=>boolean;now?:()=>number}
import {existsSync} from 'node:fs';
import {reject,memberBindings} from './yxx-limited-write-contract.mjs';

const forbidden=['channel.message_inbox','conversation.session','communication.message','communication.outbox','communication.delivery','notification.outbox','pilot_ticket.reporter_access_grant','incident.incident','incident.candidate_review'];
export function createLimitedGuard({manifest,member,secret,stopFile,isStopped=()=>false,now=Date.now}: LimitedGuardOptions){
  const bindings=memberBindings(member,secret),limits=manifest.limits;
  function active(){if(isStopped()||stopFile&&existsSync(stopFile)||now()<Number(manifest.window.starts_epoch_ms)||now()>=Number(manifest.window.ends_epoch_ms))reject('WINDOW_CLOSED');}
  async function inspect(tx: PostgresTransaction,{empty=false}={}): Promise<LimitedCounts>{
    const rows=(await tx.query<{binding:string;corp:string;app:string;proof_ref:string;supplements:number}>(`SELECT canonical_reporter_binding AS binding,source_corp_scope AS corp,source_app_scope AS app,proof_ref,
      (SELECT count(*)::int FROM intake.web_submission s WHERE s.intake_id=b.intake_id AND s.kind='SUPPLEMENT') AS supplements
      FROM intake.web_request_binding b`)).rows;
    if(empty&&rows.length||rows.some(row=>!bindings.includes(row.binding)||row.corp!==member.corpId||row.app!==member.agentId||row.proof_ref!==member.proofRef))reject('DATABASE_SCOPE');
    const count=async (table:string)=>((await tx.query<{n:number}>('SELECT count(*)::int AS n FROM '+table)).rows[0] as {n:number}).n;
    if(await count('intake.service_intake')!==rows.length)reject('DATABASE_SCOPE');
    if((await tx.query("SELECT 1 FROM intake.service_intake WHERE source_channel<>'PORTAL' OR source_provider<>'YIXIAOXIU_WEB' LIMIT 1")).rowCount
      ||(await tx.query("SELECT 1 FROM intake.channel_leg WHERE leg_type<>'WEB_FORM' LIMIT 1")).rowCount)reject('DATABASE_SCOPE');
    for(const table of forbidden)if(await count(table)!==0)reject('FORBIDDEN_ARTIFACT');
    const orphanTickets=await tx.query<{n:number}>(`SELECT count(*)::int AS n FROM pilot_ticket.ticket t WHERE NOT EXISTS
      (SELECT 1 FROM intake.service_intake i JOIN intake.web_request_binding b ON b.intake_id=i.id WHERE i.pilot_ticket_id=t.id)`);
    if((orphanTickets.rows[0] as {n:number}).n!==0)reject('DATABASE_SCOPE');
    const tickets=await count('pilot_ticket.ticket'),supplements=rows.reduce((sum,r)=>sum+r.supplements,0);
    if(rows.length>limits.max_new_intakes||tickets>limits.max_new_tickets||supplements>limits.max_supplements)reject('QUOTA_EXCEEDED');
    for(const binding of bindings){const own=rows.filter(r=>r.binding===binding);if(own.length>limits.per_member_intakes||own.reduce((sum,r)=>sum+r.supplements,0)>limits.per_member_supplements)reject('QUOTA_EXCEEDED');}
    return {intakes:rows.length,supplements,tickets};
  }
  const quota=Object.assign(async({scope,kind,transaction}: Parameters<YxxQuota>[0])=>{
    active();if(!bindings.includes(scope.scopeHash))return false;
    const counts=await inspect(transaction);
    const own=((await transaction.query<{n:number}>(`SELECT count(*)::int AS n FROM intake.web_submission WHERE canonical_reporter_binding=$1 AND kind=$2`,[scope.scopeHash,kind])).rows[0] as {n:number}).n;
    return kind==='SUBMIT'?counts.intakes<limits.max_new_intakes&&own<limits.per_member_intakes:counts.supplements<limits.max_supplements&&own<limits.per_member_supplements;
  },{localOnly:true as const});
  // ponytail: one lock serializes this two-person test window, never a general production limiter.
  function protectPool(pool: PostgresPool): PostgresPool{
    async function connect(){
      const client=await pool.connect();let transaction=false;
      const query=async(sql: string|QueryConfig,values?:unknown[]): Promise<QueryResult<Record<string,unknown>>>=>{
        const text=typeof sql==='string'?sql:sql?.text,command=text?.trim().toUpperCase();
        if(command==='BEGIN'){
          active();const result=await client.query(sql,values);transaction=true;
          await client.query("SELECT pg_advisory_xact_lock(hashtextextended('SS010_BUSINESS',0))");active();await inspect(client);return result;
        }
        if(command==='COMMIT'){
          active();await inspect(client);active();const result=await client.query(sql,values);transaction=false;return result;
        }
        if(command==='ROLLBACK'){const result=await client.query(sql,values);transaction=false;return result;}
        if(!transaction&&!/^\s*(SELECT|SHOW)\b/iu.test(text??'')){
          try{await query('BEGIN');const result=await client.query(sql,values);await query('COMMIT');return result;}catch(error){await query('ROLLBACK').catch(()=>{});throw error;}
        }
        return client.query(sql,values);
      };
      return {query,release:(destroy?:boolean|Error)=>client.release(destroy||transaction),on:client.on.bind(client)};
    }
    return {connect,options:pool.options,end:pool.end.bind(pool),on:pool.on.bind(pool),
      get totalCount(){return pool.totalCount;},get idleCount(){return pool.idleCount;},get waitingCount(){return pool.waitingCount;},
      async query(...args: [sql:string|QueryConfig,values?:unknown[]]){const client=await connect();try{return await client.query(...args);}finally{client.release();}}} as PostgresPool;
  }
  return {active,inspect,quota,protectPool,bindings};
}
