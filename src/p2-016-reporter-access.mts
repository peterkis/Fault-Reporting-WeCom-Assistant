import type { PostgresPool, PostgresTransaction } from './platform/postgres-pool.mjs';
interface GrantFields { grant_id: string; nonce: string; ticket_id: string; public_ref_id: string; delivery_id: string; message_id: string; reporter_binding_hash: string; purpose: string; issued_epoch_ms: string; expires_epoch_ms: string }
interface GrantRow extends GrantFields { state: string; public_ref: string; ref_status: string; token_hash: string }
export interface ReporterScope { session_id: string | null; ticket_id: string; public_ref_id: string; public_ref: string }
interface PublicRefRow { id: string; public_ref: string; reporter_binding_hash: string; status: string }
interface DeliveryBindingRow { public_ref: string; recipient_binding_hash: string; provider: string; channel_account_id: string; target_id: string; target_hash: string; idempotency_key: string; content_hash: string; content: { public_ref?: unknown } | null; source_provider: string; source_bot_id: string; reporter_wecom_userid: string; token?: never }
interface AccessOptions { pool?: PostgresPool; enabled?: boolean; hmacSecret?: string; now?: () => string; grantTtlMs?: number; sessionTtlMs?: number }
export type ReporterAccess = ReturnType<typeof createP2016ReporterAccess>;

import { randomBytes,randomUUID,createHmac,timingSafeEqual } from 'node:crypto';
import { failP2016,guardP2016,uuidP2016,textHashP2016,stampP2016,transactionP2016 } from './p2-016-domain-contracts.mjs';
import { formatEpochMsToShanghaiLocal } from './platform/time-contract.mjs';

const hashPattern=/^[a-f0-9]{64}$/u;
const rawUuid: (id: string) => Buffer=id=>Buffer.from(id.replaceAll('-',''),'hex');
function grantIdFromToken(token: unknown) {
  if(typeof token!=='string'||!/^[A-Za-z0-9_-]{64}$/u.test(token))return null;
  const bytes=Buffer.from(token,'base64url');if(bytes.length!==48||bytes.toString('base64url')!==token)return null;
  const h=bytes.subarray(0,16).toString('hex');return [h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-');
}
function equal(a: string,b: string) {const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb);}
export function createP2016ReporterAccess({pool,enabled=false,hmacSecret,now=()=>String(Date.now()),grantTtlMs=1800000,sessionTtlMs=86400000}: AccessOptions) {
  if(enabled&&(typeof hmacSecret!=='string'||Buffer.byteLength(hmacSecret)<32))failP2016('REPORTER_SECRET_REQUIRED',503);
  if(!Number.isInteger(grantTtlMs)||grantTtlMs<1000||grantTtlMs>1800000||!Number.isInteger(sessionTtlMs)||sessionTtlMs<1000||sessionTtlMs>86400000)failP2016();
  const tokenFor: (g: GrantFields) => string=g=>Buffer.concat([rawUuid(g.grant_id),createHmac('sha256',hmacSecret as string).update(JSON.stringify([
    'P2_016_REPORTER_GRANT_V1',g.grant_id,g.nonce,g.ticket_id,g.public_ref_id,g.delivery_id,g.message_id,
    g.reporter_binding_hash,g.purpose,String(g.issued_epoch_ms),String(g.expires_epoch_ms),
  ])).digest()]).toString('base64url');
  async function audit(tx: PostgresTransaction,type: string,{ticket=null,grant=null,session=null,actor=null,reason='BOUND_ACCESS'}: { ticket?: string | null; grant?: string | null; session?: string | null; actor?: string | null; reason?: string }={}) {
    await tx.query(`INSERT INTO pilot_ticket.reporter_access_event(ticket_id,grant_id,session_id,event_type,actor_principal_id,reason_code)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5::uuid,$6)`,[ticket,grant,session,type,actor,reason]);
  }
  async function ensurePublicRefInTransaction({transaction:tx,ticketId,reporterBindingHash,journeyId=null}: { transaction: PostgresTransaction; ticketId: string; reporterBindingHash: string; journeyId?: string | null }) {
    guardP2016(enabled);uuidP2016(ticketId);if(!hashPattern.test(reporterBindingHash))failP2016();
    let ref: PublicRefRow | undefined | null=null;
    for(let n=0;n<5&&!ref;n++){
      await tx.query(`INSERT INTO pilot_ticket.reporter_public_ref(ticket_id,public_ref,reporter_binding_hash,journey_id)
        VALUES($1::uuid,$2,$3,$4::uuid) ON CONFLICT DO NOTHING`,[ticketId,randomBytes(24).toString('base64url'),reporterBindingHash,journeyId]);
      ref=(await tx.query<PublicRefRow>('SELECT id::text,public_ref,reporter_binding_hash,status FROM pilot_ticket.reporter_public_ref WHERE ticket_id=$1::uuid FOR UPDATE',[ticketId])).rows[0];
    }
    if(!ref||ref.status!=='ACTIVE'||ref.reporter_binding_hash!==reporterBindingHash)failP2016('REPORTER_BINDING_INVALID',403);
    return Object.freeze({id:ref.id,public_ref:ref.public_ref});
  }
  return Object.freeze({
    ensurePublicRefInTransaction,
    // Internal member landing adapter: retain only a locator and digest, never the raw Grant.
    legacyLocator(token: unknown){
      guardP2016(enabled);const grantId=grantIdFromToken(token);
      if(!grantId)failP2016('GRANT_INVALID',401);
      try{uuidP2016(grantId);}catch{failP2016('GRANT_INVALID',401);}
      return Object.freeze({grantId,tokenHash:textHashP2016(token as string)});
    },
    async locateLegacyInTransaction({transaction:tx,locator}: { transaction: PostgresTransaction; locator: { grantId: string; tokenHash: string } }){
      guardP2016(enabled);uuidP2016(locator.grantId);
      if(typeof locator.tokenHash!=='string'||!hashPattern.test(locator.tokenHash))failP2016('GRANT_INVALID',401);
      const q=await tx.query<GrantRow>(`SELECT g.*,r.public_ref,r.status AS ref_status FROM pilot_ticket.reporter_access_grant g
        JOIN pilot_ticket.reporter_public_ref r ON r.id=g.public_ref_id AND r.ticket_id=g.ticket_id
          AND r.reporter_binding_hash=g.reporter_binding_hash WHERE g.grant_id=$1::uuid FOR SHARE OF g,r`,[locator.grantId]);
      const g=q.rows[0];
      if(!g||!['ISSUED','CONSUMED','EXPIRED'].includes(g.state)||g.ref_status!=='ACTIVE'
        ||!equal(locator.tokenHash,g.token_hash)||!equal(textHashP2016(tokenFor(g)),g.token_hash))failP2016('GRANT_INVALID',401);
      return g.public_ref;
    },
    async issueInTransaction({transaction:tx,ticketId,deliveryId,messageId,reporterBindingHash,journeyId=null}: { transaction: PostgresTransaction; ticketId: string; deliveryId: string; messageId: string; reporterBindingHash: string; journeyId?: string | null }) {
      guardP2016(enabled);uuidP2016(ticketId);uuidP2016(deliveryId);uuidP2016(messageId);
      if(!hashPattern.test(reporterBindingHash))failP2016();
      const binding=await tx.query<{ source_bot_id: string; reporter_wecom_userid: string; channel_account_id: string; target_id: string; target_type: string; provider: string }>(`SELECT i.source_bot_id,i.reporter_wecom_userid,d.channel_account_id,d.target_id,d.target_type,d.provider
        FROM communication.delivery d JOIN communication.outbox o ON o.id=d.outbox_id
        JOIN pilot_ticket.ticket t ON t.id=$3::uuid JOIN intake.service_intake i ON i.id=t.source_intake_id
        WHERE d.id=$1::uuid AND o.message_id=$2::uuid`,[deliveryId,messageId,ticketId]);
      const b=binding.rows[0];
      if(!b||b.target_type!=='PERSON'||b.provider!=='WECOM_AIBOT'||b.source_bot_id!==b.channel_account_id
        ||b.reporter_wecom_userid!==b.target_id||textHashP2016(JSON.stringify(['WECOM_AIBOT',b.source_bot_id,b.reporter_wecom_userid]))!==reporterBindingHash)failP2016('REPORTER_BINDING_INVALID',403);
      const existing=await tx.query<{ grant_id: string }>('SELECT grant_id::text FROM pilot_ticket.reporter_access_grant WHERE delivery_id=$1::uuid AND ticket_id=$2::uuid AND message_id=$3::uuid AND reporter_binding_hash=$4',[deliveryId,ticketId,messageId,reporterBindingHash]);
      if(existing.rowCount)return {grant_id:(existing.rows[0] as (typeof existing.rows)[number]).grant_id,replayed:true};
      const ref=await ensurePublicRefInTransaction({transaction:tx,ticketId,reporterBindingHash,journeyId});
      const stamp=stampP2016(now),expiry=String(BigInt(stamp.epoch)+BigInt(grantTtlMs));
      const grant={grant_id:randomUUID(),nonce:randomBytes(32).toString('base64url'),ticket_id:ticketId,public_ref_id:ref.id,
        delivery_id:deliveryId,message_id:messageId,reporter_binding_hash:reporterBindingHash,purpose:'REPORTER_TIMELINE',
        issued_epoch_ms:stamp.epoch,expires_epoch_ms:expiry};
      await tx.query(`INSERT INTO pilot_ticket.reporter_access_grant(grant_id,ticket_id,public_ref_id,delivery_id,message_id,
        reporter_binding_hash,nonce,token_hash,purpose,issued_at,issued_epoch_ms,expires_at,expires_epoch_ms)
        VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7,$8,$9,$10::timestamp without time zone,$11::bigint,$12::timestamp without time zone,$13::bigint)`,
      [grant.grant_id,ticketId,ref.id,deliveryId,messageId,reporterBindingHash,grant.nonce,textHashP2016(tokenFor(grant)),grant.purpose,
        stamp.local,stamp.epoch,formatEpochMsToShanghaiLocal(expiry),expiry]);
      await audit(tx,'GRANT_ISSUED',{ticket:ticketId,grant:grant.grant_id});
      return {grant_id:grant.grant_id,public_ref:ref.public_ref,replayed:false};
    },
    // Sender-only authority for member cards; no capability or Grant lifecycle is involved.
    async deliveryBinding({deliveryId}: { deliveryId: string }) {
      guardP2016(enabled);uuidP2016(deliveryId);
      const stamp=stampP2016(now);
      const q=await (pool as NonNullable<typeof pool>).query<DeliveryBindingRow>(`SELECT r.public_ref,b.recipient_binding_hash,d.provider,d.channel_account_id,
        d.target_id,d.target_hash,d.idempotency_key,m.content_hash,m.content,
        i.source_provider,i.source_bot_id,i.reporter_wecom_userid
        FROM communication.ticket_notification_binding b
        JOIN communication.delivery d ON d.id=b.delivery_id AND d.outbox_id=b.outbox_id
        JOIN communication.outbox o ON o.id=b.outbox_id AND o.message_id=b.message_id
        JOIN communication.message m ON m.id=b.message_id
        JOIN pilot_ticket.ticket t ON t.id=b.ticket_id
        JOIN pilot_ticket.ticket_event e ON e.event_id=b.ticket_event_id AND e.ticket_id=t.id
        JOIN intake.service_intake i ON i.id=t.source_intake_id
        JOIN pilot_ticket.reporter_public_ref r ON r.ticket_id=t.id AND r.reporter_binding_hash=b.recipient_binding_hash
        LEFT JOIN intake.contact_journey j ON j.id=r.journey_id
        WHERE b.delivery_id=$1::uuid AND b.destination_type='PERSON' AND d.target_type='PERSON'
          AND r.status='ACTIVE' AND m.message_type='template_card' AND m.visibility='EXTERNAL'
          AND m.purpose='SYSTEM_NOTIFICATION' AND m.sender_system_code='TICKET_LIFECYCLE'
          AND o.route_policy='P2_016_REPORTER' AND m.retention_until_epoch_ms>$2::bigint
          AND i.retention_until_epoch_ms>$2::bigint
          AND (r.journey_id IS NULL OR j.retention_until_epoch_ms>$2::bigint)`,[deliveryId,stamp.epoch]);
      const b=(q.rows[0] as (typeof q.rows)[number]);
      if(q.rowCount!==1||b.provider!=='WECOM_AIBOT'||b.source_provider!==b.provider||b.source_bot_id!==b.channel_account_id
        ||b.reporter_wecom_userid!==b.target_id||b.target_hash!==textHashP2016(b.target_id)
        ||b.recipient_binding_hash!==textHashP2016(JSON.stringify([b.provider,b.channel_account_id,b.target_id]))
        ||b.public_ref!==b.content?.public_ref)failP2016('REPORTER_BINDING_INVALID',403);
      return b;
    },
    async deliveryGrant({deliveryId}: { deliveryId: string }) {
      guardP2016(enabled);uuidP2016(deliveryId);
      const q=await (pool as NonNullable<typeof pool>).query<GrantRow>(`SELECT g.*,r.public_ref,r.status AS ref_status FROM pilot_ticket.reporter_access_grant g
        JOIN pilot_ticket.reporter_public_ref r ON r.id=g.public_ref_id WHERE g.delivery_id=$1::uuid`,[deliveryId]);
      const g=q.rows[0],stamp=stampP2016(now);
      if(!g||g.state!=='ISSUED'||g.ref_status!=='ACTIVE'||BigInt(g.expires_epoch_ms)<=BigInt(stamp.epoch))failP2016('GRANT_INVALID',401);
      const token=tokenFor(g);if(!equal(textHashP2016(token as string),g.token_hash))failP2016('GRANT_INVALID',401);
      // Internal Sender-only return. Never persist or log this capability.
      return {token,public_ref:g.public_ref,recipient_binding_hash:g.reporter_binding_hash};
    },
    async exchange(token: unknown) {
      guardP2016(enabled);
      const result=await transactionP2016((pool as NonNullable<typeof pool>),async tx=>{
        const id=grantIdFromToken(token),stamp=stampP2016(now);
        const q=id?await tx.query<GrantRow>(`SELECT g.*,r.public_ref,r.status AS ref_status FROM pilot_ticket.reporter_access_grant g
          JOIN pilot_ticket.reporter_public_ref r ON r.id=g.public_ref_id WHERE g.grant_id=$1::uuid FOR UPDATE OF g,r`,[id]):{rows:[]};
        const g=q.rows[0];
        if(!g||g.state!=='ISSUED'||g.ref_status!=='ACTIVE'||BigInt(g.expires_epoch_ms)<=BigInt(stamp.epoch)
          ||!equal(token as string,tokenFor(g))||!equal(textHashP2016(token as string),g.token_hash)){
          await audit(tx,'ACCESS_DENIED',{reason:'GRANT_INVALID'});return null;
        }
        const sessionToken=randomBytes(32).toString('base64url'),expiry=String(BigInt(stamp.epoch)+BigInt(sessionTtlMs));
        const session=await tx.query<{ session_id: string }>(`INSERT INTO pilot_ticket.reporter_access_session(session_token_hash,public_ref_id,ticket_id,reporter_binding_hash,grant_id,
          issued_at,issued_epoch_ms,expires_at,expires_epoch_ms,last_seen_at,last_seen_epoch_ms)
          VALUES($1,$2::uuid,$3::uuid,$4,$5::uuid,$6::timestamp without time zone,$7::bigint,$8::timestamp without time zone,$9::bigint,$6::timestamp without time zone,$7::bigint) RETURNING session_id::text`,
        [textHashP2016(sessionToken),g.public_ref_id,g.ticket_id,g.reporter_binding_hash,g.grant_id,stamp.local,stamp.epoch,formatEpochMsToShanghaiLocal(expiry),expiry]);
        await tx.query(`UPDATE pilot_ticket.reporter_access_grant SET state='CONSUMED',row_version=row_version+1,
          consumed_at=$2::timestamp without time zone,consumed_epoch_ms=$3::bigint WHERE grant_id=$1::uuid`,[g.grant_id,stamp.local,stamp.epoch]);
        await audit(tx,'EXCHANGE_SUCCEEDED',{ticket:g.ticket_id,grant:g.grant_id,session:(session.rows[0] as (typeof session.rows)[number]).session_id});
        return {sessionToken,public_ref:g.public_ref,max_age_seconds:Math.floor(sessionTtlMs/1000)};
      });
      if(!result)failP2016('GRANT_INVALID',401);return result;
    },
    async authenticate(sessionToken: unknown,{publicRef=null}: { publicRef?: unknown }={}) {
      guardP2016(enabled);
      if(typeof sessionToken!=='string'||!/^[A-Za-z0-9_-]{43}$/u.test(sessionToken))failP2016('REPORTER_UNAUTHENTICATED',401);
      if(publicRef!==null&&(typeof publicRef!=='string'||!/^[A-Za-z0-9_-]{32}$/u.test(publicRef)))failP2016('REPORTER_UNAUTHENTICATED',401);
      const stamp=stampP2016(now);
      const q=await (pool as NonNullable<typeof pool>).query<ReporterScope>(`SELECT s.session_id::text,s.ticket_id::text,s.public_ref_id::text,r.public_ref
        FROM pilot_ticket.reporter_access_session s JOIN pilot_ticket.reporter_public_ref r ON r.id=s.public_ref_id
        WHERE s.session_token_hash=$1 AND s.state='ACTIVE' AND s.expires_epoch_ms>$2::bigint AND r.status='ACTIVE'
          AND ($3::text IS NULL OR r.public_ref=$3)`,[textHashP2016(sessionToken),stamp.epoch,publicRef]);
      if(q.rowCount!==1)failP2016('REPORTER_UNAUTHENTICATED',401);
      return Object.freeze((q.rows[0] as (typeof q.rows)[number]));
    },
    async logout(sessionToken: unknown) {
      guardP2016(enabled);const stamp=stampP2016(now);
      if(typeof sessionToken!=='string'||sessionToken.length>128)failP2016();
      await transactionP2016((pool as NonNullable<typeof pool>),async tx=>{
        const q=await tx.query<{ session_id: string; ticket_id: string }>(`UPDATE pilot_ticket.reporter_access_session SET state='REVOKED',
          revoked_at=$2::timestamp without time zone,revoked_epoch_ms=$3::bigint
          WHERE session_token_hash=$1 AND state='ACTIVE' RETURNING session_id::text,ticket_id::text`,[textHashP2016(sessionToken),stamp.local,stamp.epoch]);
        if(q.rowCount)await audit(tx,'LOGOUT',{ticket:(q.rows[0] as (typeof q.rows)[number]).ticket_id,session:(q.rows[0] as (typeof q.rows)[number]).session_id});
      });
    },
    async revokeInTransaction({transaction:tx,ticketId,actorPrincipalId}: { transaction: PostgresTransaction; ticketId: string; actorPrincipalId: string }) {
      guardP2016(enabled);uuidP2016(ticketId);uuidP2016(actorPrincipalId);const stamp=stampP2016(now);
      const actor=await tx.query(`SELECT 1 FROM pilot_ticket.pilot_principal p JOIN pilot_ticket.pilot_principal_role r ON r.principal_id=p.id
        WHERE p.id=$1::uuid AND p.is_active AND r.role='ADMIN'`,[actorPrincipalId]);
      if(actor.rowCount!==1)failP2016('FORBIDDEN',403);
      await tx.query("UPDATE pilot_ticket.reporter_public_ref SET status='REVOKED',revoked_at=$2::timestamp without time zone,row_version=row_version+1 WHERE ticket_id=$1::uuid AND status='ACTIVE'",[ticketId,stamp.local]);
      await tx.query("UPDATE pilot_ticket.reporter_access_grant SET state='REVOKED',revoked_at=$2::timestamp without time zone,revoked_epoch_ms=$3::bigint,row_version=row_version+1 WHERE ticket_id=$1::uuid AND state<>'REVOKED'",[ticketId,stamp.local,stamp.epoch]);
      await tx.query("UPDATE pilot_ticket.reporter_access_session SET state='REVOKED',revoked_at=$2::timestamp without time zone,revoked_epoch_ms=$3::bigint WHERE ticket_id=$1::uuid AND state<>'REVOKED'",[ticketId,stamp.local,stamp.epoch]);
      await audit(tx,'REVOKED',{ticket:ticketId,actor:actorPrincipalId});
    },
  });
}
