import type { PostgresPool, PostgresTransaction } from './platform/postgres-pool.mjs';
import type { WeComOAuth, EnabledWeComOAuth, OAuthMember, OAuthMemberId, InternalMemberId, SessionToken } from './p2-g2-wecom-web-oauth.mjs';
import type { YxxIdentityMapping } from './p2-g2-yixiaoxiu-delegated-identity.mjs';
import type { ReporterAccess, ReporterScope } from './p2-016-reporter-access.mjs';
export interface VerifiedYxxMember {corpId:string;userid:InternalMemberId}
export interface YxxAuthorizerOptions {pool: PostgresPool; oauth: WeComOAuth; config: unknown; identityMapping?: YxxIdentityMapping | null | undefined}
export interface YxxAuthorizerInput {sessionToken?: unknown; publicRef?: unknown; locator?: Parameters<ReporterAccess['locateLegacyInTransaction']>[0]['locator'] | null; access?: Pick<ReporterAccess, 'locateLegacyInTransaction'> | null}
interface OwnershipRow extends Record<string, unknown> { ticket_id: string; public_ref: string; reporter_binding_hash: string; source_provider: string; source_bot_id: string; reporter_wecom_userid: string }
import {textHashP2016,transactionP2016} from './p2-016-domain-contracts.mjs';
import {failYxx,publicRefYxx,validateYxxEntryConfig} from './p2-g2-yixiaoxiu-contract.mjs';
import {yxxIdentityConfigHash} from './p2-g2-yixiaoxiu-delegated-identity.mjs';

export function createYxxMemberAuthorizer({pool,oauth,config,identityMapping=null}: YxxAuthorizerOptions){
  const c=validateYxxEntryConfig(config);
  if(!c.enabled||!oauth?.enabled||typeof oauth.authenticate!=='function'
    ||(oauth as EnabledWeComOAuth).scope?.corpId!==c.corpId||(oauth as EnabledWeComOAuth).scope?.agentId!==c.agentId)failYxx('CONFIG_INVALID');
  if(c.identityMode==='VERIFIED_DELEGATED_MAPPING'
    &&(typeof identityMapping?.resolve!=='function'||identityMapping.configHash!==yxxIdentityConfigHash(c)))failYxx('IDENTITY_NAMESPACE_UNVERIFIED');
  let inFlight=0,closed=false;
  function authenticate(sessionToken: SessionToken | null | undefined): VerifiedYxxMember{
    if(closed)failYxx('UNAVAILABLE');
    // Canonical namespace is established by the verified mode/mapping checks below.
    let member: {corpId:string;userid:string};try{member=(oauth as EnabledWeComOAuth).authenticate(sessionToken as SessionToken | null);}catch{failYxx('AUTH_REQUIRED');}
    if(member.corpId!==c.corpId)failYxx('MEMBER_REQUIRED');
    if(c.identityMode==='VERIFIED_DELEGATED_MAPPING'){
      const userid=(identityMapping as YxxIdentityMapping).resolve(member.userid as OAuthMemberId);if(!userid)failYxx('MEMBER_REQUIRED');
      return {...member,userid};
    }
    if(c.identityMode!=='VERIFIED_SAME_NAMESPACE')failYxx('IDENTITY_NAMESPACE_UNVERIFIED');
    return member as VerifiedYxxMember;
  }
  async function authorize(tx: PostgresTransaction,member: VerifiedYxxMember,publicRef: unknown){
    publicRefYxx(publicRef);
    const q=await tx.query<OwnershipRow>(`SELECT r.ticket_id::text,r.public_ref,r.reporter_binding_hash,
      i.source_provider,i.source_bot_id,i.reporter_wecom_userid
      FROM pilot_ticket.reporter_public_ref r JOIN pilot_ticket.ticket t ON t.id=r.ticket_id
      JOIN intake.service_intake i ON i.id=t.source_intake_id
      LEFT JOIN intake.contact_journey j ON j.id=r.journey_id
      WHERE r.public_ref=$1 AND r.status='ACTIVE' AND i.retention_until_epoch_ms>platform.physical_epoch_ms()
        AND (r.journey_id IS NULL OR j.retention_until_epoch_ms>platform.physical_epoch_ms())
      FOR SHARE OF r,t,i`,[publicRef]);
    const row=(q.rows[0] as OwnershipRow);
    if(!row||row.source_provider!=='WECOM_AIBOT'||row.source_bot_id!==c.botId||row.reporter_wecom_userid!==member.userid
      ||row.reporter_binding_hash!==textHashP2016(JSON.stringify(['WECOM_AIBOT',c.botId,member.userid])))return null;
    return Object.freeze({ticket_id:row.ticket_id,public_ref:row.public_ref,session_id:null});
  }
  async function run<T>({sessionToken,publicRef=null,locator=null,access=null}: YxxAuthorizerInput,reader: (tx: PostgresTransaction, scope: Pick<ReporterScope, 'ticket_id' | 'public_ref' | 'session_id'>) => Promise<T>): Promise<T>{
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
        const value=await reader(tx,scope);
        authenticate(sessionToken as SessionToken | null); // Reject an identity revoked while the transaction awaited I/O.
        return {value};
      });
      authenticate(sessionToken as SessionToken | null);
      if(!result)failYxx('NOT_FOUND');return result.value;
    }finally{inFlight--;}
  }
  return Object.freeze({authenticate,read:<T,>(input: YxxAuthorizerInput,reader: (tx: PostgresTransaction,scope: Pick<ReporterScope, 'ticket_id' | 'public_ref' | 'session_id'>)=>Promise<T>)=>run(input,reader),
    locate:(input: YxxAuthorizerInput)=>run(input,async(_tx,scope)=>scope.public_ref),close(){closed=true;}});
}
