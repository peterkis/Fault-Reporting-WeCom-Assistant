import {createHmac} from 'node:crypto';
import type {PostgresPool,PostgresTransaction} from './platform/postgres-pool.mjs';
import type {YxxMemberScope,YxxMemberFlags} from './yxx-self-service-authorization.mjs';
import type {H5UrgeSummary,H5EvaluationContext,H5RequestExtension,H5LifecycleResult,H5LifecycleReceipt,H5PublicProgress,H5PublicProgressResult,H5PublicProgressReceipt,H5UrgeInput,H5EvaluationInput} from '../contracts/yxx_h5_v2_contracts.js';
import type {CompletedTicketRound} from './ticket-reopen-rounds.mjs';
import type {TicketStatus} from './p1-005-pilot-ticket-core.mjs';
import type {PublicTicketEvent} from './p1-006-ticket-state-actions.mjs';
import {appendTicketEvent} from './p1-006-ticket-state-actions.mjs';
import {completedTicketRound} from './ticket-reopen-rounds.mjs';
import {hashP2016,transactionP2016} from './p2-016-domain-contracts.mjs';
import {lockP2016Realtime} from './p2-016-realtime-appender.mjs';
import {formatEpochMsToShanghaiLocal,shanghaiLocalToEpochMs} from './platform/time-contract.mjs';
import {h5Fail,h5Uuid,h5RequestRef,parseH5UrgeInput,parseH5EvaluationInput,parseH5PublicProgressInput} from './yxx-h5-v2-contracts.mjs';

export interface H5MemberContext {scope:YxxMemberScope;write_flag:boolean;flags:YxxMemberFlags}
export interface H5LifecycleHooks {
  onNewCommand?:(input:{value:H5UrgeInput|H5EvaluationInput;transaction:PostgresTransaction})=>Promise<boolean>;
  onBeforeCommit?:(input:{transaction:PostgresTransaction})=>Promise<boolean>;
}
export interface H5LifecycleInput extends H5LifecycleHooks {scope:YxxMemberScope;requestRef:string;input:unknown;transaction?:PostgresTransaction}
export interface H5UrgeFact {transaction:PostgresTransaction;urgeId:string;sequenceNo:string;ticketId:string;ticketVersion:number;sourceIntakeId:string;cycleId:string|null;occurredAt:string;occurredEpochMs:string;retentionUntilEpochMs:string}
export interface H5PublicProgressOptions {ticketId:string;actorPrincipalId:string;input:unknown;onAuthorize:(tx:PostgresTransaction)=>Promise<boolean>;transaction?:PostgresTransaction}
interface SourceRow {intake_id:string;ticket_id:string|null;input_revision:string;retention_epoch:string;ticket_version:number|null;ticket_status:TicketStatus|null;cycle_id:string|null;intent:'FAULT'|'CONTACT_REQUEST';handler_name:string|null;team_name:string|null}
interface UrgeRow {ticket_id:string;count:number;last_epoch:string|null;active:boolean}
interface EvaluationRow {rating:number;comment:string|null;occurred_at:string;occurred_epoch_ms:string}
interface ProgressRow {summary:string;estimated_at:string|null;estimated_epoch_ms:string|null;ticket_version:number;occurred_at:string;occurred_epoch_ms:string}
/** Only a query that has checked the current Web Request binding may construct this projection. */
export interface H5LifecycleReadProjection {source:SourceRow;round:CompletedTicketRound|null;urge:UrgeRow|null;epoch:string;progress:ProgressRow|null;evaluation:EvaluationRow|null}
const OPEN_STATUSES=['NEW','QUEUED','ACCEPTED','IN_PROGRESS','WAITING_REQUESTER','WAITING_VENDOR','REOPENED'];
/** A pre-assignment urge belongs to the initial round when its first cycle is established. */
export const H5_CURRENT_URGE_SQL=`(u.cycle_id IS NOT DISTINCT FROM t.current_handling_cycle_id OR
 (u.cycle_id IS NULL AND EXISTS(SELECT 1 FROM pilot_ticket.ticket_handling_cycle first_cycle
  WHERE first_cycle.id=t.current_handling_cycle_id AND first_cycle.ticket_id=t.id AND first_cycle.cycle_no=1)))`;
const emptyUrge=():H5UrgeSummary=>({active:false,count:0,last_urged_at:null,last_urged_epoch_ms:null,next_allowed_at:null,next_allowed_epoch_ms:null,can_urge:false});
const emptyEvaluation=():H5EvaluationContext=>({can_evaluate:false,completed_round_ref:null,completed_round_no:null,ticket_version:null,rating:null,comment:null,evaluated_at:null,evaluated_epoch_ms:null});
const writeEnabled=(m:H5MemberContext)=>m.write_flag&&m.flags.YIXIAOXIU_SELF_SERVICE_ENABLED&&m.flags.YIXIAOXIU_MY_REPORTS_ENABLED;
function publicProgress(row:ProgressRow|undefined):H5PublicProgress|null{return row?{summary:row.summary,estimated_at:row.estimated_at,estimated_epoch_ms:row.estimated_epoch_ms,version:row.ticket_version,updated_at:row.occurred_at,updated_epoch_ms:row.occurred_epoch_ms}:null;}

export function createYxxH5Lifecycle({pool,scopeSecret,enabled=false,onUrge=null,onPublicProgress=null}:{pool:PostgresPool;scopeSecret:string;enabled?:boolean;onUrge?:((fact:H5UrgeFact)=>Promise<void>)|null;onPublicProgress?:((input:{transaction:PostgresTransaction;ticket:{id:string;intake_id:string;status:TicketStatus;version:number};event:PublicTicketEvent})=>Promise<void>)|null}){
  if(typeof scopeSecret!=='string'||Buffer.byteLength(scopeSecret)<32||typeof enabled!=='boolean')h5Fail('YXX_UNAVAILABLE',503);
  async function source(tx:PostgresTransaction,scope:YxxMemberScope,requestRef:string,lock=false):Promise<SourceRow>{
    h5RequestRef(requestRef);
    const result=await tx.query<SourceRow>(`SELECT b.intake_id::text,i.pilot_ticket_id::text AS ticket_id,b.input_revision::text,
      LEAST(b.retention_until_epoch_ms,i.retention_until_epoch_ms)::text AS retention_epoch,
      t.version AS ticket_version,t.status AS ticket_status,t.current_handling_cycle_id::text AS cycle_id,
      CASE WHEN initial.safe_content->>'intent'='CONTACT_REQUEST' THEN 'CONTACT_REQUEST' ELSE 'FAULT' END AS intent,
      p.display_name AS handler_name,rt.display_name AS team_name
      FROM intake.web_request_binding b JOIN intake.service_intake i ON i.id=b.intake_id
      LEFT JOIN pilot_ticket.ticket t ON t.id=i.pilot_ticket_id LEFT JOIN pilot_ticket.pilot_principal p ON p.id=t.assignee_id AND p.is_active
      LEFT JOIN pilot_ticket.resolver_team rt ON rt.team_id=t.resolver_team_id AND rt.is_active
      LEFT JOIN LATERAL(SELECT safe_content FROM intake.web_submission s WHERE s.intake_id=i.id AND s.kind='SUBMIT' AND s.retention_until_epoch_ms>platform.physical_epoch_ms() ORDER BY s.input_revision LIMIT 1) initial ON TRUE
      WHERE b.request_ref=$1 AND b.canonical_reporter_binding=$2 AND b.source_corp_scope=$3 AND b.source_app_scope=$4 AND b.proof_ref=$5
       AND i.source_provider='YIXIAOXIU_WEB' AND i.canonical_reporter_binding=b.canonical_reporter_binding AND i.source_app_scope=b.source_app_scope
       AND b.revoked_at IS NULL AND b.retention_until_epoch_ms>platform.physical_epoch_ms() AND i.retention_until_epoch_ms>platform.physical_epoch_ms()
      ${lock?'FOR UPDATE OF b,i':''}`,[requestRef,scope.scopeHash,scope.sourceCorpScope,scope.sourceAppScope,scope.proofRef]);
    return result.rows[0]??h5Fail('YXX_NOT_FOUND',404);
  }
  function roundRef(scope:YxxMemberScope,requestRef:string,round:CompletedTicketRound){
    return createHmac('sha256',scopeSecret).update(JSON.stringify(['WEB_FEEDBACK',scope.scopeHash,scope.sourceCorpScope,scope.sourceAppScope,requestRef,round.id,round.staff_completion_event_id])).digest().subarray(0,24).toString('base64url');
  }
  async function clock(tx:PostgresTransaction){const row=(await tx.query<{epoch:string}>('SELECT platform.physical_epoch_ms()::text AS epoch')).rows[0];if(!row)h5Fail('YXX_UNAVAILABLE',503);return {epoch:row.epoch,local:formatEpochMsToShanghaiLocal(row.epoch)};}
  async function urgeSummaries(tx:PostgresTransaction,ids:readonly string[],mayWrite=false):Promise<Map<string,H5UrgeSummary>>{
    if(ids.length>100)h5Fail();const selected=[...new Set(ids.map(h5Uuid))];const map=new Map<string,H5UrgeSummary>();if(!selected.length)return map;
    const rows=(await tx.query<UrgeRow>(`SELECT t.id::text AS ticket_id,count(u.id)::integer AS count,max(u.occurred_epoch_ms)::text AS last_epoch,
      (t.status=ANY($2::text[])) AS active FROM pilot_ticket.ticket t
      LEFT JOIN intake.web_report_urge u ON u.ticket_id=t.id AND ${H5_CURRENT_URGE_SQL}
       AND u.retention_until_epoch_ms>platform.physical_epoch_ms()
       AND EXISTS(SELECT 1 FROM intake.web_request_binding b JOIN intake.service_intake i ON i.id=b.intake_id
         WHERE b.intake_id=u.source_intake_id AND b.canonical_reporter_binding=u.scope_hash AND b.revoked_at IS NULL
          AND b.retention_until_epoch_ms>platform.physical_epoch_ms() AND i.retention_until_epoch_ms>platform.physical_epoch_ms()
          AND i.pilot_ticket_id=t.id AND i.source_provider='YIXIAOXIU_WEB' AND i.canonical_reporter_binding=b.canonical_reporter_binding AND i.source_app_scope=b.source_app_scope)
      WHERE t.id=ANY($1::uuid[]) GROUP BY t.id,t.status`,[selected,OPEN_STATUSES])).rows;
    const now=await clock(tx);
    for(const row of rows){const next=row.last_epoch===null?null:String(BigInt(row.last_epoch)+600000n);map.set(row.ticket_id,{active:row.active&&row.count>0,count:row.count,
      last_urged_at:row.last_epoch===null?null:formatEpochMsToShanghaiLocal(row.last_epoch),last_urged_epoch_ms:row.last_epoch,
      next_allowed_at:next===null?null:formatEpochMsToShanghaiLocal(next),next_allowed_epoch_ms:next,can_urge:mayWrite&&row.active&&(next===null||BigInt(next)<=BigInt(now.epoch))});}
    return map;
  }
  async function progress(tx:PostgresTransaction,ticketId:string):Promise<H5PublicProgress|null>{
    return publicProgress((await tx.query<ProgressRow>(`SELECT p.summary,to_char(p.estimated_at,'YYYY-MM-DD HH24:MI:SS') AS estimated_at,p.estimated_epoch_ms::text,p.ticket_version,
      to_char(p.occurred_at,'YYYY-MM-DD HH24:MI:SS') AS occurred_at,p.occurred_epoch_ms::text FROM pilot_ticket.ticket_public_progress p
      JOIN pilot_ticket.ticket t ON t.id=p.ticket_id JOIN intake.service_intake i ON i.id=t.source_intake_id
      WHERE p.ticket_id=$1::uuid AND i.retention_until_epoch_ms>platform.physical_epoch_ms() ORDER BY p.ticket_version DESC LIMIT 1`,[ticketId])).rows[0]);
  }
  async function evaluation(tx:PostgresTransaction,ticketId:string):Promise<EvaluationRow|null>{
    return (await tx.query<EvaluationRow>(`SELECT e.rating,e.comment,to_char(e.occurred_at,'YYYY-MM-DD HH24:MI:SS') AS occurred_at,e.occurred_epoch_ms::text
      FROM intake.web_report_evaluation e JOIN pilot_ticket.ticket t ON t.id=e.ticket_id AND t.current_handling_cycle_id=e.completed_cycle_id
      WHERE e.ticket_id=$1::uuid AND e.retention_until_epoch_ms>platform.physical_epoch_ms() LIMIT 1`,[ticketId])).rows[0]??null;
  }
  async function context(tx:PostgresTransaction,member:H5MemberContext,requestRef:string):Promise<H5RequestExtension>{
    const s=await source(tx,member.scope,requestRef);let e=emptyEvaluation();let u=emptyUrge();let p:H5PublicProgress|null=null;
    if(s.ticket_id){
      u=(await urgeSummaries(tx,[s.ticket_id],enabled&&writeEnabled(member))).get(s.ticket_id)??u;p=await progress(tx,s.ticket_id);
      const rating=await evaluation(tx,s.ticket_id),round=await completedTicketRound(tx,s.ticket_id);
      if(round&&round.source_intake_id===s.intake_id)e={can_evaluate:enabled&&writeEnabled(member)&&rating===null,completed_round_ref:roundRef(member.scope,requestRef,round),completed_round_no:round.cycle_no,ticket_version:round.version,
        rating:rating?.rating??null,comment:rating?.comment??null,evaluated_at:rating?.occurred_at??null,evaluated_epoch_ms:rating?.occurred_epoch_ms??null};
    }
    return {ticket_version:s.ticket_version,media:[],handler:s.handler_name||s.team_name?{name:s.handler_name,team_name:s.team_name,phone:null,avatar_url:null,chat_url:null}:null,public_progress:p,urge:u,evaluation:e,intent:s.intent};
  }
  function contextFromAuthorizedProjection(member:H5MemberContext,requestRef:string,value:H5LifecycleReadProjection):H5RequestExtension{
    const s=value.source,mayWrite=enabled&&writeEnabled(member);let e=emptyEvaluation(),u=emptyUrge();
    if(s.ticket_id){
      const urge=value.urge;
      if(urge){const next=urge.last_epoch===null?null:String(BigInt(urge.last_epoch)+600000n);u={active:urge.active&&urge.count>0,count:urge.count,
        last_urged_at:urge.last_epoch===null?null:formatEpochMsToShanghaiLocal(urge.last_epoch),last_urged_epoch_ms:urge.last_epoch,
        next_allowed_at:next===null?null:formatEpochMsToShanghaiLocal(next),next_allowed_epoch_ms:next,
        can_urge:mayWrite&&urge.active&&(next===null||BigInt(next)<=BigInt(value.epoch))};}
      const round=value.round,rating=value.evaluation;
      if(round&&round.source_intake_id===s.intake_id)e={can_evaluate:mayWrite&&rating===null,completed_round_ref:roundRef(member.scope,requestRef,round),completed_round_no:round.cycle_no,ticket_version:round.version,
        rating:rating?.rating??null,comment:rating?.comment??null,evaluated_at:rating?.occurred_at??null,evaluated_epoch_ms:rating?.occurred_epoch_ms??null};
    }
    return {ticket_version:s.ticket_version,media:[],handler:s.handler_name||s.team_name?{name:s.handler_name,team_name:s.team_name,phone:null,avatar_url:null,chat_url:null}:null,
      public_progress:publicProgress(value.progress??undefined),urge:u,evaluation:e,intent:s.intent};
  }
  async function beforeCommit(tx:PostgresTransaction,input:H5LifecycleInput){await source(tx,input.scope,input.requestRef);if(input.onBeforeCommit&&await input.onBeforeCommit({transaction:tx})!==true)h5Fail('YXX_AUTH_RECHECK_FAILED',403);}
  async function acceptInTransaction(input:H5LifecycleInput&{transaction:PostgresTransaction},purpose:'URGE'|'EVALUATION'):Promise<H5LifecycleResult>{
    if(!enabled)h5Fail('YXX_MEMBER_WRITE_DISABLED',403);const tx=input.transaction;
    const value=purpose==='URGE'?parseH5UrgeInput(input.input):parseH5EvaluationInput(input.input);
    await lockP2016Realtime(tx);await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',[input.scope.scopeHash+':'+value.client_command_id]);
    const original=await source(tx,input.scope,input.requestRef,true),hash=hashP2016({kind:purpose,request_ref:input.requestRef,...value});
    const previous=(await tx.query<{command_hash:string;command_kind:string;result_request_ref:string|null;h5_result:H5LifecycleResult|null}>(`SELECT command_hash,command_kind,result_request_ref,h5_result
      FROM intake.web_command_receipt WHERE scope_hash=$1 AND client_command_id=$2::uuid`,[input.scope.scopeHash,value.client_command_id])).rows[0];
    if(previous){if(previous.command_hash!==hash||previous.command_kind!==purpose||previous.result_request_ref!==input.requestRef||previous.h5_result===null)h5Fail('YXX_COMMAND_CONFLICT',409);await beforeCommit(tx,input);return {...previous.h5_result,replayed:true};}
    if(!original.ticket_id)h5Fail('YXX_CONFLICT',409);
    await tx.query('SELECT id FROM pilot_ticket.ticket WHERE id=$1::uuid FOR UPDATE',[original.ticket_id]);
    const current=await source(tx,input.scope,input.requestRef);if(current.ticket_version!==value.expected_ticket_version)h5Fail('YXX_VERSION_CONFLICT',409);
    if(input.onNewCommand&&await input.onNewCommand({value,transaction:tx})!==true)h5Fail('YXX_MEMBER_QUOTA_EXCEEDED',429);
    const now=await clock(tx);let urgeFact:H5UrgeFact|null=null;
    if(purpose==='URGE'){
      if(!OPEN_STATUSES.includes(current.ticket_status??''))h5Fail('YXX_CONFLICT',409);
      const last=(await tx.query<{epoch:string}>(`SELECT max(u.occurred_epoch_ms)::text AS epoch FROM intake.web_report_urge u JOIN pilot_ticket.ticket t ON t.id=u.ticket_id
        WHERE t.id=$1::uuid AND ${H5_CURRENT_URGE_SQL} AND u.retention_until_epoch_ms>platform.physical_epoch_ms()`,[current.ticket_id])).rows[0]?.epoch??null;
      if(last!==null&&BigInt(last)+600000n>BigInt(now.epoch))h5Fail('YXX_URGE_RATE_LIMITED',429);
      const fact=(await tx.query<{id:string;sequence_no:string}>(`INSERT INTO intake.web_report_urge(ticket_id,cycle_id,source_intake_id,scope_hash,client_command_id,occurred_at,occurred_epoch_ms,retention_until_epoch_ms)
       VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5::uuid,$6::timestamp without time zone,$7::bigint,$8::bigint) RETURNING id::text,sequence_no::text`,[current.ticket_id,current.cycle_id,current.intake_id,input.scope.scopeHash,value.client_command_id,now.local,now.epoch,current.retention_epoch])).rows[0];if(!fact)h5Fail('YXX_UNAVAILABLE',503);
      urgeFact={transaction:tx,urgeId:fact.id,sequenceNo:fact.sequence_no,ticketId:original.ticket_id,ticketVersion:current.ticket_version as number,sourceIntakeId:current.intake_id,cycleId:current.cycle_id,occurredAt:now.local,occurredEpochMs:now.epoch,retentionUntilEpochMs:current.retention_epoch};
    }else{
      const v=value as H5EvaluationInput,round=await completedTicketRound(tx,original.ticket_id);
      if(!round||round.source_intake_id!==current.intake_id||round.version!==v.expected_ticket_version||roundRef(input.scope,input.requestRef,round)!==v.completed_round_ref)h5Fail('YXX_ROUND_CONFLICT',409);
      if((await tx.query('SELECT id FROM intake.web_report_evaluation WHERE completed_cycle_id=$1::uuid',[round.id])).rowCount)h5Fail('YXX_EVALUATION_ALREADY_SUBMITTED',409);
      await tx.query(`INSERT INTO intake.web_report_evaluation(ticket_id,completed_cycle_id,completion_event_id,source_intake_id,scope_hash,client_command_id,rating,comment,occurred_at,occurred_epoch_ms,retention_until_epoch_ms)
       VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::uuid,$7,$8,$9::timestamp without time zone,$10::bigint,$11::bigint)`,[original.ticket_id,round.id,round.staff_completion_event_id,current.intake_id,input.scope.scopeHash,value.client_command_id,v.rating,v.comment,now.local,now.epoch,current.retention_epoch]);
    }
    const result:H5LifecycleResult={ok:true,replayed:false,client_command_id:value.client_command_id,request_ref:input.requestRef,purpose,accepted_at:now.local,accepted_epoch_ms:now.epoch};
    await tx.query(`INSERT INTO intake.web_command_receipt(scope_hash,client_command_id,command_kind,command_hash,schema_version,result_intake_id,result_request_ref,accepted_revision,accepted_at,accepted_epoch_ms,created_at,h5_result)
      VALUES($1,$2::uuid,$3,$4,1,$5::uuid,$6,$7::bigint,$8::timestamp without time zone,$9::bigint,$8::timestamp without time zone,$10::jsonb)`,[input.scope.scopeHash,value.client_command_id,purpose,hash,current.intake_id,input.requestRef,current.input_revision,now.local,now.epoch,JSON.stringify(result)]);
    if(urgeFact)await onUrge?.(urgeFact);await beforeCommit(tx,input);return result;
  }
  async function receipt(tx:PostgresTransaction,scope:YxxMemberScope,requestRef:string,clientCommandId:unknown,purpose:'URGE'|'EVALUATION'):Promise<H5LifecycleReceipt>{
    if(purpose!=='URGE'&&purpose!=='EVALUATION')h5Fail();const id=h5Uuid(clientCommandId);await source(tx,scope,requestRef);
    const row=(await tx.query<{h5_result:H5LifecycleResult}>(`SELECT h5_result FROM intake.web_command_receipt WHERE scope_hash=$1 AND client_command_id=$2::uuid AND result_request_ref=$3 AND command_kind=$4`,[scope.scopeHash,id,requestRef,purpose])).rows[0];
    await source(tx,scope,requestRef);const base={client_command_id:id,request_ref:requestRef,purpose};return row?{...base,state:'COMMITTED',result:{...row.h5_result,replayed:true}}:{...base,state:'UNKNOWN'};
  }
  async function publishPublicProgress({ticketId:rawId,actorPrincipalId:rawActor,input,onAuthorize,transaction}:H5PublicProgressOptions):Promise<H5PublicProgressResult>{
    if(!enabled)h5Fail('YXX_MEMBER_WRITE_DISABLED',403);const ticketId=h5Uuid(rawId),actor=h5Uuid(rawActor),v=parseH5PublicProgressInput(input);
    const execute=async(tx:PostgresTransaction):Promise<H5PublicProgressResult>=>{
      if(await onAuthorize(tx)!==true)h5Fail('YXX_FORBIDDEN',403);
      await lockP2016Realtime(tx);await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',['H5_PUBLIC_PROGRESS:'+actor+':'+v.client_command_id]);
      const ticket=(await tx.query<{id:string;source_intake_id:string;status:TicketStatus;version:number;assignee_id:string|null}>(`SELECT t.id::text,t.source_intake_id::text,t.status,t.version,t.assignee_id::text
        FROM pilot_ticket.ticket t JOIN intake.service_intake i ON i.id=t.source_intake_id WHERE t.id=$1::uuid AND i.retention_until_epoch_ms>platform.physical_epoch_ms() FOR UPDATE OF t`,[ticketId])).rows[0];
      if(!ticket)h5Fail('YXX_NOT_FOUND',404);if(await onAuthorize(tx)!==true||ticket.assignee_id!==actor||!OPEN_STATUSES.includes(ticket.status))h5Fail('YXX_FORBIDDEN',403);
      const hash=hashP2016({purpose:'H5_PUBLIC_PROGRESS',ticket_id:ticketId,...v});
      const prior=(await tx.query<{command_hash:string;ticket_id:string;result_snapshot:H5PublicProgressResult}>(`SELECT command_hash,ticket_id::text,result_snapshot FROM pilot_ticket.ticket_public_progress WHERE actor_principal_id=$1::uuid AND client_command_id=$2::uuid`,[actor,v.client_command_id])).rows[0];
      if(prior){if(prior.command_hash!==hash||prior.ticket_id!==ticketId)h5Fail('YXX_COMMAND_CONFLICT',409);if(await onAuthorize(tx)!==true)h5Fail('YXX_FORBIDDEN',403);return {...prior.result_snapshot,replayed:true};}
      if(ticket.version!==v.expected_version)h5Fail('YXX_VERSION_CONFLICT',409);const now=await clock(tx);
      const updated=await tx.query<{version:number}>('UPDATE pilot_ticket.ticket SET version=version+1,updated_at=GREATEST(updated_at,$3::timestamp without time zone) WHERE id=$1::uuid AND version=$2 RETURNING version',[ticketId,v.expected_version,now.local]);
      const version=updated.rows[0]?.version;if(version===undefined)h5Fail('YXX_VERSION_CONFLICT',409);
      const current={id:ticketId,intake_id:ticket.source_intake_id,status:ticket.status,version};
      const event=await appendTicketEvent({transaction:tx,ticket:current,eventType:'ticket.information_added',oldStatus:ticket.status,newStatus:ticket.status,actor:{type:'PILOT_USER',id:actor},externalNote:v.summary,reasonCode:'H5_PUBLIC_PROGRESS',traceId:'h5-progress:'+v.client_command_id});
      const p:H5PublicProgress={summary:v.summary,estimated_at:v.estimated_at,estimated_epoch_ms:v.estimated_at===null?null:String(shanghaiLocalToEpochMs(v.estimated_at)),version,updated_at:now.local,updated_epoch_ms:now.epoch};
      const result:H5PublicProgressResult={ok:true,replayed:false,client_command_id:v.client_command_id,ticket_id:ticketId,ticket_version:version,public_progress:p};
      await tx.query(`INSERT INTO pilot_ticket.ticket_public_progress(ticket_id,ticket_version,ticket_event_id,actor_principal_id,client_command_id,command_hash,summary,estimated_at,estimated_epoch_ms,occurred_at,occurred_epoch_ms,result_snapshot)
        VALUES($1::uuid,$2,$3::uuid,$4::uuid,$5::uuid,$6,$7,$8::timestamp without time zone,$9::bigint,$10::timestamp without time zone,$11::bigint,$12::jsonb)`,[ticketId,version,event.event_id,actor,v.client_command_id,hash,v.summary,p.estimated_at,p.estimated_epoch_ms,now.local,now.epoch,JSON.stringify(result)]);
      await onPublicProgress?.({transaction:tx,ticket:current,event});if(await onAuthorize(tx)!==true)h5Fail('YXX_FORBIDDEN',403);return result;
    };return transaction?execute(transaction):transactionP2016(pool,execute);
  }
  async function publicProgressReceipt({ticketId:rawId,actorPrincipalId:rawActor,clientCommandId,onAuthorize}:{ticketId:string;actorPrincipalId:string;clientCommandId:unknown;onAuthorize:(tx:PostgresTransaction)=>Promise<boolean>}):Promise<H5PublicProgressReceipt>{
    const ticketId=h5Uuid(rawId),actor=h5Uuid(rawActor),id=h5Uuid(clientCommandId);
    return transactionP2016(pool,async tx=>{if(await onAuthorize(tx)!==true)h5Fail('YXX_FORBIDDEN',403);
      const row=(await tx.query<{result_snapshot:H5PublicProgressResult}>(`SELECT p.result_snapshot FROM pilot_ticket.ticket_public_progress p JOIN pilot_ticket.ticket t ON t.id=p.ticket_id
        JOIN intake.service_intake i ON i.id=t.source_intake_id WHERE p.ticket_id=$1::uuid AND p.actor_principal_id=$2::uuid AND p.client_command_id=$3::uuid AND i.retention_until_epoch_ms>platform.physical_epoch_ms()`,[ticketId,actor,id])).rows[0];
      if(await onAuthorize(tx)!==true)h5Fail('YXX_FORBIDDEN',403);return row?{state:'COMMITTED',ticket_id:ticketId,client_command_id:id,result:{...row.result_snapshot,replayed:true}}:{state:'UNKNOWN',ticket_id:ticketId,client_command_id:id};});
  }
  return Object.freeze({context,contextFromAuthorizedProjection,receipt,publishPublicProgress,publicProgressReceipt,
    urgeInTransaction:(input:H5LifecycleInput&{transaction:PostgresTransaction})=>acceptInTransaction(input,'URGE'),
    evaluateInTransaction:(input:H5LifecycleInput&{transaction:PostgresTransaction})=>acceptInTransaction(input,'EVALUATION'),
    urge:(input:H5LifecycleInput)=>transactionP2016(pool,tx=>acceptInTransaction({...input,transaction:tx},'URGE')),
    evaluate:(input:H5LifecycleInput)=>transactionP2016(pool,tx=>acceptInTransaction({...input,transaction:tx},'EVALUATION')),
    activeForAuthorizedTickets:(ticketIds:readonly string[])=>transactionP2016(pool,tx=>urgeSummaries(tx,ticketIds)),
    publicForAuthorizedTicket:(ticketId:string)=>transactionP2016(pool,async tx=>({public_progress:await progress(tx,h5Uuid(ticketId)),evaluation:await evaluation(tx,ticketId),urge:(await urgeSummaries(tx,[ticketId])).get(ticketId)??emptyUrge()})),
  });
}
export type YxxH5Lifecycle=ReturnType<typeof createYxxH5Lifecycle>;
