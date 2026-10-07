import type {PostgresPool,PostgresTransaction} from './platform/postgres-pool.mjs';
import type {P2016TicketQuery} from './p2-016-ticket-query.mjs';
import type {WorkbenchCard,SourceGroupDisplay,SourceGroupPage,SourceGroupNameResult} from '../contracts/web01_workbench_contracts.js';
import {failP2016,exactP2016,uuidP2016,hashP2016,publicP2016,transactionP2016,limitP2016,cursorP2016,decodeCursorP2016} from './p2-016-domain-contracts.mjs';

const GROUP_REF_SQL=`encode(sha256(convert_to(jsonb_build_array(i.source_provider,i.source_bot_id,i.source_chat_id)::text,'UTF8')),'hex')`;
const VALID_GROUP_SQL=`i.retention_until>platform.local_now() AND i.source_channel='WECOM_GROUP'
  AND i.source_chat_type='group' AND NULLIF(i.source_provider,'') IS NOT NULL
  AND NULLIF(i.source_bot_id,'') IS NOT NULL AND NULLIF(i.source_chat_id,'') IS NOT NULL`;
const OBSERVED_SQL=`WITH observed AS (SELECT DISTINCT ${GROUP_REF_SQL} AS ref FROM intake.service_intake i WHERE ${VALID_GROUP_SQL})`;
const LABELS:Readonly<Record<string,string>>={WECOM_GROUP:'群聊报修',WECOM_DIRECT:'Bot 私聊',YIXIAOXIU_WEB:'医小修',WEB_REQUEST:'医小修'};
export function sourceGroupRef(value:unknown):string {
  if(typeof value!=='string'||!/^[a-f0-9]{64}$/u.test(value))failP2016();return value;
}
export function sourceGroupSearch(value:unknown):string {
  if(value===null||value===undefined)return '';
  if(typeof value!=='string'||/[\u0000-\u001f\u007f]/u.test(value))failP2016();
  const search=value.trim();if([...search].length>128)failP2016();return search;
}
export function sourceGroupNameCommand(input:unknown) {
  const body=exactP2016(input,['client_command_id','expected_row_version','display_name']);
  if(typeof body.expected_row_version!=='string'||!/^(0|[1-9][0-9]{0,18})$/u.test(body.expected_row_version)
    ||BigInt(body.expected_row_version)>=9223372036854775807n)failP2016();
  if(typeof body.display_name!=='string')failP2016();
  const name=body.display_name.trim();
  if([...name].length<1||[...name].length>128||/[\u0000-\u001f\u007f]/u.test(name))failP2016();
  return {client_command_id:uuidP2016(body.client_command_id),expected_row_version:body.expected_row_version,display_name:name};
}
type SourceRow={id:string;kind:string;source:string|null;ref:string|null;display_name:string|null;row_version:string};
function group(row:{ref:string;display_name:string|null;row_version:string}):SourceGroupDisplay {
  return {ref:row.ref,display_name:row.display_name,row_version:row.row_version,name_source:row.display_name===null?'UNREGISTERED':'ADMIN_CONFIRMED'};
}
export function sourceLabel(source:string,displayName:string|null=null):string {
  return source==='WECOM_GROUP'?'群聊报修 · '+(displayName??'群名称未登记'):(LABELS[source]??source);
}
export function createWorkbenchSourceGroups({pool,query}:{pool:PostgresPool;query:P2016TicketQuery}) {
  async function admin(authContext:unknown,tx:PostgresTransaction=pool) {
    const principal=await query.principal(authContext,tx);
    if(!principal.roles.includes('ADMIN'))failP2016('FORBIDDEN',403);return principal;
  }
  return Object.freeze({
    async decorate(cards:WorkbenchCard[]):Promise<WorkbenchCard[]> {
      if(!cards.length)return cards;
      // The input cards have already passed Workbench scope filtering and pagination.
      // A retained Journey owns the origin; a conflicting/expired origin cannot fall back to a later leg.
      const result=await pool.query<SourceRow>(`WITH requested AS (
        SELECT * FROM jsonb_to_recordset($1::jsonb) AS r(id text,kind text,intake_id text)
      ), origins AS (
        SELECT r.*,CASE WHEN binding.count=0 THEN r.intake_id::uuid
          WHEN binding.count=1 AND binding.retained THEN binding.origin::uuid ELSE NULL END AS origin_intake_id
        FROM requested r LEFT JOIN LATERAL (
          SELECT count(DISTINCT j.origin_intake_id)::integer AS count,min(j.origin_intake_id::text) AS origin,
            bool_and(j.retention_until_epoch_ms>platform.physical_epoch_ms()) AS retained
          FROM intake.contact_journey j
          WHERE j.origin_intake_id=r.intake_id::uuid
            OR EXISTS (SELECT 1 FROM intake.channel_leg l WHERE l.journey_id=j.id AND l.source_intake_id=r.intake_id::uuid)
            OR (r.kind='review' AND EXISTS (SELECT 1 FROM intake.manual_review_item rev WHERE rev.id=r.id::uuid AND rev.journey_id=j.id))
        ) binding ON TRUE
      ) SELECT r.id,r.kind,i.source_channel AS source,
        CASE WHEN ${VALID_GROUP_SQL} THEN ${GROUP_REF_SQL} ELSE NULL END AS ref,
        n.display_name,COALESCE(n.row_version,0)::text AS row_version
      FROM origins r LEFT JOIN intake.service_intake i ON i.id=r.origin_intake_id AND i.retention_until>platform.local_now()
      LEFT JOIN workbench.source_group_name n ON ${VALID_GROUP_SQL} AND n.ref=${GROUP_REF_SQL}`,
      [JSON.stringify(cards.map(({id,kind,intake_id})=>({id,kind,intake_id})))]);
      const rows=new Map(result.rows.map(row=>[row.kind+':'+row.id,row]));
      return cards.map(card=>{
        const row=rows.get(card.kind+':'+card.id),source=row?.source??'未提供';
        const sourceGroup=row?.ref?group({ref:row.ref,display_name:row.display_name,row_version:row.row_version}):null;
        return {...card,source,source_label:row?.source?sourceLabel(source,sourceGroup?.display_name):'来源资料不可用',source_group:sourceGroup};
      });
    },
    async list({authContext,cursor,limit,q}:{authContext:unknown;cursor:unknown;limit:unknown;q?:unknown}):Promise<SourceGroupPage> {
      const principal=await admin(authContext),n=limitP2016(limit??'50'),search=sourceGroupSearch(q);
      const page=cursor?decodeCursorP2016(cursor,['principal','ref','q']):null;
      if(page&&(page.principal!==principal.principal_id||page.q!==search))failP2016('CURSOR_INVALID');
      const after=page?sourceGroupRef(page.ref):null;
      const result=await pool.query<{ref:string;display_name:string|null;row_version:string}>(OBSERVED_SQL+`
        SELECT o.ref,n.display_name,COALESCE(n.row_version,0)::text AS row_version FROM observed o
        LEFT JOIN workbench.source_group_name n ON n.ref=o.ref WHERE ($1::text IS NULL OR o.ref>$1)
          AND ($3::text='' OR strpos(lower(COALESCE(n.display_name,'')),lower($3))>0 OR strpos(o.ref,$3)>0)
        ORDER BY o.ref LIMIT $2`,[after,n+1,search]);
      const items=result.rows.slice(0,n).map(group),last=items.at(-1);
      return publicP2016({items,next_cursor:result.rows.length>n&&last?cursorP2016({principal:principal.principal_id,ref:last.ref,q:search}):null});
    },
    async save({authContext,ref,body}:{authContext:unknown;ref:unknown;body:unknown}):Promise<SourceGroupNameResult> {
      const groupRef=sourceGroupRef(ref),command=sourceGroupNameCommand(body);
      return transactionP2016(pool,async tx=>{
        const principal=await admin(authContext,tx);
        // Both locks are transaction-local; serialization covers a first insert and replay races.
        await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['SOURCE_GROUP_COMMAND:'+principal.principal_id+':'+command.client_command_id]);
        const hash=hashP2016({ref:groupRef,...command});
        const receipt=await tx.query<{command_hash:string;result_snapshot:{ok:true;group:SourceGroupDisplay}}>(
          'SELECT command_hash,result_snapshot FROM workbench.source_group_name_receipt WHERE actor_principal_id=$1::uuid AND client_command_id=$2::uuid',
          [principal.principal_id,command.client_command_id]);
        // Current authorization and current source retention apply even to a stored success.
        const observed=await tx.query(OBSERVED_SQL+' SELECT ref FROM observed WHERE ref=$1',[groupRef]);
        if(observed.rowCount!==1)failP2016('NOT_FOUND',404);
        if(receipt.rows[0]){
          if(receipt.rows[0].command_hash!==hash)failP2016('COMMAND_CONFLICT',409);
          return publicP2016({...receipt.rows[0].result_snapshot,replayed:true});
        }
        await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['SOURCE_GROUP_NAME:'+groupRef]);
        const old=(await tx.query<{display_name:string;row_version:string}>('SELECT display_name,row_version::text FROM workbench.source_group_name WHERE ref=$1 FOR UPDATE',[groupRef])).rows[0];
        if((old?.row_version??'0')!==command.expected_row_version)failP2016('VERSION_CONFLICT',409);
        const version=String(BigInt(command.expected_row_version)+1n);
        await tx.query(`INSERT INTO workbench.source_group_name(ref,display_name,row_version,updated_by) VALUES($1,$2,$3::bigint,$4::uuid)
          ON CONFLICT(ref) DO UPDATE SET display_name=EXCLUDED.display_name,row_version=EXCLUDED.row_version,updated_by=EXCLUDED.updated_by,updated_at=platform.local_now()`,
          [groupRef,command.display_name,version,principal.principal_id]);
        await tx.query(`INSERT INTO workbench.source_group_name_change(group_ref,row_version,old_name,new_name,actor_principal_id,client_command_id)
          VALUES($1,$2::bigint,$3,$4,$5::uuid,$6::uuid)`,[groupRef,version,old?.display_name??null,command.display_name,principal.principal_id,command.client_command_id]);
        const result={ok:true as const,group:group({ref:groupRef,display_name:command.display_name,row_version:version})};
        await tx.query(`INSERT INTO workbench.source_group_name_receipt(actor_principal_id,client_command_id,command_hash,result_snapshot)
          VALUES($1::uuid,$2::uuid,$3,$4::jsonb)`,[principal.principal_id,command.client_command_id,hash,JSON.stringify(result)]);
        return publicP2016({...result,replayed:false});
      });
    },
  });
}
