import {createHmac,timingSafeEqual} from 'node:crypto';
import type {PostgresPool,PostgresTransaction} from './platform/postgres-pool.mjs';
import type {createYxxMemberAuthorizer,YxxBotMemberScope} from './p2-g2-yixiaoxiu-authorizer.mjs';
import type {YxxMemberFlags} from './yxx-self-service-authorization.mjs';
import type {BotReporterFeedbackInput,BotReporterFeedbackBootstrap,BotReporterFeedbackContext,BotReporterFeedbackResult,BotReporterFeedbackReceipt} from '../contracts/bot_reporter_feedback_contracts.js';
import {hashP2016,transactionP2016,uuidP2016,publicP2016} from './p2-016-domain-contracts.mjs';
import {lockP2016Realtime} from './p2-016-realtime-appender.mjs';
import {completedTicketRound,reopenCompletedRound} from './ticket-reopen-rounds.mjs';
import type {CompletedTicketRound} from './ticket-reopen-rounds.mjs';
import {parseYxxFeedbackInput} from './yxx-self-service-feedback.mjs';
import {readBotFeedbackCommandInTransaction,commitBotFeedbackCommandInTransaction} from './p2-016-ticket-command-ledger.mjs';

export class BotReporterFeedbackError extends Error{
  constructor(public readonly code:string,public readonly status:number){super(code);}
}
function fail(code:string,status=409):never{throw new BotReporterFeedbackError('BOT_FEEDBACK_'+code,status);}
interface BotFeedbackReadInput{sessionToken:unknown;publicRef:unknown}
interface BotFeedbackOptions{pool:PostgresPool;authorizer:ReturnType<typeof createYxxMemberAuthorizer>;scopeSecret:string;enabled?:boolean;featureFlags?:Partial<YxxMemberFlags>}
export async function botFeedbackSchemaReady(tx:PostgresTransaction){
  try{return (await tx.query("SELECT 1 FROM platform.schema_migration WHERE migration_id='050_bot_reporter_feedback'")).rowCount===1;}catch{return false;}
}
// The trusted member authorizer supplies current approved App/Bot and mapped user.
// It does not assert that the original Bot message has a historical App pin.
export function createBotReporterFeedback({pool,authorizer,scopeSecret,enabled=false,featureFlags={}}:BotFeedbackOptions){
  if(typeof enabled!=='boolean'||typeof scopeSecret!=='string'||Buffer.byteLength(scopeSecret)<32||enabled&&(pool.options.max??4)>4
    ||Object.keys(featureFlags).some(key=>key!=='YIXIAOXIU_SELF_SERVICE_ENABLED'&&key!=='YIXIAOXIU_MY_REPORTS_ENABLED')
    ||Object.values(featureFlags).some(value=>typeof value!=='boolean'))fail('CONFIG_INVALID',503);
  const writesEnabled=()=>enabled&&featureFlags.YIXIAOXIU_SELF_SERVICE_ENABLED===true&&featureFlags.YIXIAOXIU_MY_REPORTS_ENABLED===true;
  const digest=(purpose:string,values:unknown[])=>createHmac('sha256',scopeSecret).update(JSON.stringify([purpose,...values])).digest();
  const commandScope=(member:Readonly<YxxBotMemberScope>)=>'BOT_REPORTER_FEEDBACK:'+digest('BOT_REPORTER_FEEDBACK',[member.corpId,member.agentId,member.botId,member.userid]).toString('hex');
  const csrf=(sessionToken:unknown,member:Readonly<YxxBotMemberScope>)=>digest('BOT_FEEDBACK_CSRF',[sessionToken,commandScope(member)]).toString('hex');
  let inFlight=0,closed=false;
  function identity(token:unknown){if(closed)fail('UNAVAILABLE',503);return authorizer.currentScope(token);}
  async function ready(tx:PostgresTransaction){if(!await botFeedbackSchemaReady(tx))fail('UNAVAILABLE',503);}
  async function epoch(tx:PostgresTransaction){
    const value=(await tx.query<{epoch:string}>('SELECT platform.physical_epoch_ms()::text AS epoch')).rows[0]?.epoch;
    if(typeof value!=='string'||!/^\d{1,16}$/u.test(value))fail('UNAVAILABLE',503);return BigInt(value);
  }
  function credential(scope:string,publicRef:string,round:CompletedTicketRound,issued:bigint){
    const stamp=Buffer.alloc(8);stamp.writeBigUInt64BE(issued);
    const mac=digest('BOT_FEEDBACK_ROUND',[scope,publicRef,round.id,round.source_intake_id,round.staff_completion_event_id,issued.toString()]);
    return Buffer.concat([stamp,mac.subarray(0,16)]).toString('base64url');
  }
  function verifyCredential(value:string,scope:string,publicRef:string,round:CompletedTicketRound,now:bigint){
    const bytes=Buffer.from(value,'base64url');if(bytes.length!==24||bytes.toString('base64url')!==value)fail('ROUND_CONFLICT');
    const issued=bytes.readBigUInt64BE();if(issued>now||now-issued>300000n)fail('ROUND_CONFLICT');
    if(!timingSafeEqual(bytes,Buffer.from(credential(scope,publicRef,round,issued),'base64url')))fail('ROUND_CONFLICT');
  }
  const denied=(rejection:Extract<BotReporterFeedbackContext,{can_feedback:false}>['rejection']):BotReporterFeedbackContext=>({schema_version:1,can_feedback:false,completed_round_ref:null,completed_round_no:null,ticket_version:null,rejection});
  async function context(tx:PostgresTransaction,input:BotFeedbackReadInput):Promise<BotReporterFeedbackContext>{
    const member=identity(input.sessionToken),scope=await authorizer.authorizeInTransaction({transaction:tx,...input});
    if(!writesEnabled())return denied('WRITE_DISABLED');await ready(tx);
    const round=await completedTicketRound(tx,scope.ticket_id);
    if(!round||round.source_intake_id!==scope.source_intake_id){
      const current=await tx.query<{status:string}>('SELECT status FROM pilot_ticket.ticket WHERE id=$1::uuid',[scope.ticket_id]);
      return denied(current.rows[0]?.status==='REOPENED'?'ROUND_ALREADY_REOPENED':'ROUND_NOT_COMPLETED');
    }
    const now=await epoch(tx);
    await authorizer.authorizeInTransaction({transaction:tx,...input});
    if(!writesEnabled())return denied('WRITE_DISABLED');
    return {schema_version:1,can_feedback:true,completed_round_ref:credential(commandScope(member),scope.public_ref,round,now/60000n*60000n),completed_round_no:round.cycle_no,ticket_version:round.version,rejection:null};
  }
  function bootstrap(sessionToken:unknown):BotReporterFeedbackBootstrap{
    const member=identity(sessionToken),writeEnabled=writesEnabled();return {schema_version:1,write_enabled:writeEnabled,csrf_token:writeEnabled?csrf(sessionToken,member):null};
  }
  function assertCsrf(sessionToken:unknown,value:unknown){
    const member=identity(sessionToken);if(!writesEnabled())fail('FORBIDDEN',403);
    if(typeof value!=='string'||!/^[a-f0-9]{64}$/u.test(value)||!timingSafeEqual(Buffer.from(value,'hex'),Buffer.from(csrf(sessionToken,member),'hex')))fail('CSRF_INVALID',403);
  }
  async function accept(input:BotFeedbackReadInput&{input:unknown}):Promise<BotReporterFeedbackResult>{
    const member=identity(input.sessionToken);if(!writesEnabled())fail('FORBIDDEN',403);
    let value:BotReporterFeedbackInput;try{value=parseYxxFeedbackInput(input.input);}catch{fail('INPUT_INVALID',400);}
    const scopeKey=commandScope(member),commandHash=hashP2016({purpose:'BOT_REPORTER_FEEDBACK',public_ref:input.publicRef,...value});
    if(inFlight>=32)fail('BUSY',503);inFlight++;
    try{
      const result=await transactionP2016(pool,async tx=>{
        await tx.query("SET LOCAL statement_timeout='2000ms'");await tx.query("SET LOCAL lock_timeout='2000ms'");
        // Same shared mutex as T20/staff, before source/Ticket/receipt FK locks.
        await lockP2016Realtime(tx);await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[scopeKey+':'+value.client_command_id]);
        const original=await authorizer.authorizeInTransaction({transaction:tx,...input});await ready(tx);
        const previous=await readBotFeedbackCommandInTransaction({transaction:tx,commandScope:scopeKey,commandId:value.client_command_id});
        const recheck=async()=>{
          if(!writesEnabled())fail('FORBIDDEN',403);
          const current=await authorizer.authorizeInTransaction({transaction:tx,...input});
          if(current.ticket_id!==original.ticket_id||current.source_intake_id!==original.source_intake_id||commandScope(identity(input.sessionToken))!==scopeKey)fail('NOT_FOUND',404);
        };
        if(previous){
          if(previous.command_hash!==commandHash||previous.ticket_id!==original.ticket_id||previous.result.public_ref!==original.public_ref)fail('COMMAND_CONFLICT');
          await recheck();return {...previous.result,replayed:true};
        }
        await tx.query('SELECT id FROM pilot_ticket.ticket WHERE id=$1::uuid FOR UPDATE',[original.ticket_id]);
        const round=await completedTicketRound(tx,original.ticket_id);
        if(!round||round.source_intake_id!==original.source_intake_id)fail('ROUND_CONFLICT');
        if(round.version!==value.expected_ticket_version)fail('VERSION_CONFLICT');
        verifyCredential(value.completed_round_ref,scopeKey,original.public_ref,round,await epoch(tx));
        const reopened=await reopenCompletedRound({transaction:tx,round,actor:{type:'REPORTER',id:scopeKey.slice('BOT_REPORTER_FEEDBACK:'.length)},commandId:value.client_command_id,origin:'BOT_REPORTER',reasonCode:'REPORTER_STILL_UNRESOLVED'});
        const committed:BotReporterFeedbackResult={ok:true,replayed:false,public_ref:original.public_ref,completed_round_ref:value.completed_round_ref,reopened_round_no:reopened.handling_cycle.cycle_no,
          ticket:{ticket_no:reopened.ticket.ticket_no,status:'REOPENED',version:reopened.ticket.version}};
        await commitBotFeedbackCommandInTransaction({transaction:tx,commandScope:scopeKey,commandId:value.client_command_id,commandHash,ticketId:original.ticket_id,expectedVersion:value.expected_ticket_version,eventId:reopened.event.event_id,result:committed});
        await recheck();return committed;
      });
      identity(input.sessionToken);return publicP2016(result);
    }finally{inFlight--;}
  }
  async function receipt(input:BotFeedbackReadInput&{commandId:unknown}):Promise<BotReporterFeedbackReceipt>{
    const member=identity(input.sessionToken);let id:string;try{id=uuidP2016(input.commandId);}catch{fail('INPUT_INVALID',400);}
    return authorizer.read({sessionToken:input.sessionToken,publicRef:input.publicRef},async(tx,scope)=>{
      await ready(tx);const previous=await readBotFeedbackCommandInTransaction({transaction:tx,commandScope:commandScope(member),commandId:id});
      await authorizer.authorizeInTransaction({transaction:tx,sessionToken:input.sessionToken,publicRef:input.publicRef});
      const base={client_command_id:id,public_ref:scope.public_ref};
      // Current READ is independent of new-write flags. Other App/purpose/ref
      // commands are UNKNOWN; never expose a private ledger or another result.
      return previous&&previous.ticket_id===scope.ticket_id&&previous.result.public_ref===scope.public_ref
        ?{...base,state:'COMMITTED' as const,result:{...previous.result,replayed:true as const}}:{...base,state:'UNKNOWN' as const};
    });
  }
  return Object.freeze({context,bootstrap,assertCsrf,accept,receipt,close(){closed=true;}});
}
