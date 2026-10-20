import type { PostgresPool, PostgresTransaction } from './platform/postgres-pool.mjs';
import type { WeComOAuth, EnabledWeComOAuth, OAuthMember, OAuthMemberId, InternalMemberId, SessionToken } from './p2-g2-wecom-web-oauth.mjs';
import type { YxxIdentityMapping } from './p2-g2-yixiaoxiu-delegated-identity.mjs';
import type { ReporterAccess } from './p2-016-reporter-access.mjs';
import type {ReporterReadScope} from './p2-016-reporter-timeline.mjs';
export interface VerifiedYxxMember {corpId:string;userid:InternalMemberId}
export interface YxxBotReadScope extends ReporterReadScope {source_intake_id:string}
export interface YxxBotMemberScope extends VerifiedYxxMember {agentId:string;botId:string}
export interface YxxAuthorizerOptions {pool: PostgresPool; oauth: WeComOAuth; config: unknown; identityMapping?: YxxIdentityMapping | null | undefined;appNotifications?:TicketAppNotificationOptions|null;reporterHmacSecret?:string|undefined}
export interface YxxAuthorizerInput {sessionToken?: unknown; publicRef?: unknown; locator?: Parameters<ReporterAccess['locateLegacyInTransaction']>[0]['locator'] | null; access?: Pick<ReporterAccess, 'locateLegacyInTransaction'> | null}
interface OwnershipRow extends Record<string, unknown> { ticket_id: string; source_intake_id:string; public_ref: string; journey_id:string|null; reporter_binding_hash: string; source_provider: string; source_bot_id: string; reporter_wecom_userid: string }
import {createHmac} from 'node:crypto';
import type {TicketAppNotificationOptions} from '../contracts/workbench_app_notification_contracts.js';
import {normalizeAppNotificationOptions,readOriginalAppNotificationSource} from './workbench-app-notification-target.mjs';
import {textHashP2016,transactionP2016} from './p2-016-domain-contracts.mjs';
import {failYxx,publicRefYxx,validateYxxEntryConfig} from './p2-g2-yixiaoxiu-contract.mjs';
import {yxxIdentityConfigHash} from './p2-g2-yixiaoxiu-delegated-identity.mjs';

export function createYxxMemberAuthorizer({pool,oauth,config,identityMapping=null,appNotifications=null,reporterHmacSecret}: YxxAuthorizerOptions){
  const c=validateYxxEntryConfig(config);
  if(!c.enabled||!oauth?.enabled||typeof oauth.authenticate!=='function'
    ||(oauth as EnabledWeComOAuth).scope?.corpId!==c.corpId||(oauth as EnabledWeComOAuth).scope?.agentId!==c.agentId)failYxx('CONFIG_INVALID');
  if((c.identityMode==='VERIFIED_DELEGATED_MAPPING'||c.identityMode==='VERIFIED_APP_OPENID')
    &&(typeof identityMapping?.resolve!=='function'||identityMapping.configHash!==yxxIdentityConfigHash(c)))failYxx('IDENTITY_NAMESPACE_UNVERIFIED');
  const app=normalizeAppNotificationOptions(appNotifications);
  if(app&&(typeof reporterHmacSecret!=='string'||Buffer.byteLength(reporterHmacSecret)<32
    ||app.authority.sourceCorpScope!==c.corpId||app.authority.sourceAppScope!==c.agentId||app.authority.mappingProofRef!==c.proofRef
    ||app.authority.proofKind!==c.proofKind||app.authority.validationProfile!==c.validationProfile
    ||c.identityMode==='VERIFIED_DELEGATED_MAPPING'&&app.authority.mappingConfigHash!==identityMapping?.configHash))failYxx('CONFIG_INVALID');
  const configuredScope=Object.freeze({corpId:c.corpId,agentId:c.agentId,botId:c.botId});
  let inFlight=0,closed=false;
  function authenticate(sessionToken: SessionToken | null | undefined): VerifiedYxxMember{
    if(closed)failYxx('UNAVAILABLE');
    // Canonical namespace is established by the verified mode/mapping checks below.
    let member: {corpId:string;userid:string};try{member=(oauth as EnabledWeComOAuth).authenticate(sessionToken as SessionToken | null);}catch{failYxx('AUTH_REQUIRED');}
    if(member.corpId!==c.corpId)failYxx('MEMBER_REQUIRED');
    if(c.identityMode==='VERIFIED_DELEGATED_MAPPING'||c.identityMode==='VERIFIED_APP_OPENID'){
      const userid=(identityMapping as YxxIdentityMapping).resolve(member.userid as OAuthMemberId);if(!userid)failYxx('MEMBER_REQUIRED');
      return {...member,userid};
    }
    if(c.identityMode!=='VERIFIED_SAME_NAMESPACE')failYxx('IDENTITY_NAMESPACE_UNVERIFIED');
    return member as VerifiedYxxMember;
  }
  async function authorize(tx: PostgresTransaction,member: VerifiedYxxMember,publicRef: unknown):Promise<YxxBotReadScope|null>{
    publicRefYxx(publicRef);
    const q=await tx.query<OwnershipRow>(`SELECT r.ticket_id::text,i.id::text AS source_intake_id,r.public_ref,r.journey_id::text,r.reporter_binding_hash,
      i.source_provider,i.source_bot_id,i.reporter_wecom_userid
      FROM pilot_ticket.reporter_public_ref r JOIN pilot_ticket.ticket t ON t.id=r.ticket_id
      JOIN intake.service_intake i ON i.id=t.source_intake_id
      LEFT JOIN intake.contact_journey j ON j.id=r.journey_id
      WHERE r.public_ref=$1 AND r.status='ACTIVE' AND i.retention_until_epoch_ms>platform.physical_epoch_ms()
        AND (r.journey_id IS NULL OR j.retention_until_epoch_ms>platform.physical_epoch_ms())
      FOR SHARE OF r,t,i`,[publicRef]);
    const row=(q.rows[0] as OwnershipRow);
    if(row&&row.source_provider==='STAFF_MANUAL_REPORT'&&app){
      // OAuth establishes the current member; neither card possession nor send
      // reachability grants read permission. Preserve the distinct MANUAL origin.
      const source=await readOriginalAppNotificationSource(tx,row.source_intake_id);
      const canonical=createHmac('sha256',reporterHmacSecret as string).update(JSON.stringify(['member',c.corpId,c.agentId,member.userid])).digest('hex');
      if(source?.source_kind!=='VERIFIED_MANUAL_REPORT'||source.journey_id!==row.journey_id||source.scope.scopeHash!==canonical
        ||source.scope.sourceCorpScope!==c.corpId||source.scope.sourceAppScope!==c.agentId||source.scope.proofRef!==c.proofRef
        ||row.reporter_binding_hash!==textHashP2016(JSON.stringify(['WECOM_APP',app.authority.channelAccountId,c.corpId,c.agentId,canonical,member.userid])))return null;
      return Object.freeze({ticket_id:row.ticket_id,source_intake_id:row.source_intake_id,public_ref:row.public_ref,session_id:null,original_source:'VERIFIED_MANUAL_REPORT' as const});
    }
    if(!row||row.source_provider!=='WECOM_AIBOT'||row.source_bot_id!==c.botId||row.reporter_wecom_userid!==member.userid
      ||row.reporter_binding_hash!==textHashP2016(JSON.stringify(['WECOM_AIBOT',c.botId,member.userid])))return null;
    return Object.freeze({ticket_id:row.ticket_id,source_intake_id:row.source_intake_id,public_ref:row.public_ref,session_id:null});
  }
  function currentScope(sessionToken:unknown):Readonly<YxxBotMemberScope>{return Object.freeze({...configuredScope,...authenticate(sessionToken as SessionToken|null)});}
  // Caller owns transaction and stream-before-source lock ordering. Authentication
  // remains local-only; the browser never supplies a scope or source identity.
  async function authorizeInTransaction({transaction,sessionToken,publicRef}:{transaction:PostgresTransaction;sessionToken:unknown;publicRef:unknown}):Promise<YxxBotReadScope>{
    const member=authenticate(sessionToken as SessionToken|null),scope=await authorize(transaction,member,publicRef);
    if(!scope||scope.original_source==='VERIFIED_MANUAL_REPORT')failYxx('NOT_FOUND');authenticate(sessionToken as SessionToken|null);return scope;
  }
  async function run<T>({sessionToken,publicRef=null,locator=null,access=null}: YxxAuthorizerInput,reader: (tx: PostgresTransaction, scope: ReporterReadScope) => Promise<T>): Promise<T>{
    const member=authenticate(sessionToken as SessionToken | null);
    if(inFlight>=32)failYxx('BUSY');inFlight++;
    try{
      const result=await transactionP2016(pool,async tx=>{
        await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        await tx.query("SET LOCAL statement_timeout='2000ms'");
        await tx.query("SET LOCAL lock_timeout='2000ms'");
        let ref=publicRef;
        if(locator){try{ref=await (access as Pick<ReporterAccess, 'locateLegacyInTransaction'>).locateLegacyInTransaction({transaction:tx,locator});}catch(error){
          if((error as {code?:string} | null)?.code!=='P2_016_GRANT_INVALID')throw error;
          await tx.query("INSERT INTO pilot_ticket.reporter_access_event(event_type,reason_code) VALUES('ACCESS_DENIED','MEMBER_ENTRY_DENIED')");return null;
        }}
        const scope=await authorize(tx,member,ref);
        if(!scope){await tx.query("INSERT INTO pilot_ticket.reporter_access_event(event_type,reason_code) VALUES('ACCESS_DENIED','MEMBER_ENTRY_DENIED')");return null;}
        const value=await reader(tx,{ticket_id:scope.ticket_id,public_ref:scope.public_ref,session_id:scope.session_id,...(scope.original_source?{original_source:scope.original_source}:{})});
        authenticate(sessionToken as SessionToken | null); // Reject an identity revoked while the transaction awaited I/O.
        return {value};
      });
      authenticate(sessionToken as SessionToken | null);
      if(!result)failYxx('NOT_FOUND');return result.value;
    }finally{inFlight--;}
  }
  return Object.freeze({authenticate,currentScope,authorizeInTransaction,read:<T,>(input: YxxAuthorizerInput,reader: (tx: PostgresTransaction,scope: ReporterReadScope)=>Promise<T>)=>run(input,reader),
    locate:(input: YxxAuthorizerInput)=>run(input,async(_tx,scope)=>scope.public_ref),close(){closed=true;}});
}
