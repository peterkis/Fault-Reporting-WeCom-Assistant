import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createPilotTicketCore } from '../src/p1-005-pilot-ticket-core.mjs';
import { appendTicketEvent } from '../src/p1-006-ticket-state-actions.mjs';
import { createPilotAccessService } from '../src/p1-009-pilot-access-workbench.mjs';
import { createP2016ReporterAccess } from '../src/p2-016-reporter-access.mjs';
import { createP2016TicketNotificationProjector } from '../src/p2-016-ticket-notification-projector.mjs';
import { createP2016ReporterTimeline } from '../src/p2-016-reporter-timeline.mjs';
import { transactionP2016 } from '../src/p2-016-domain-contracts.mjs';
import { seedPersistedIntake } from './helpers/p2-015-postgres-harness.mjs';
import { withP2016IsolatedDatabase,applyThrough030 } from './helpers/p2-016-postgres-harness.mjs';
import { migrateP2016 } from '../scripts/p2-016-migrate.mjs';
test('Reporter grant expiry, HMAC rotation, one-consume concurrency, session expiry/revocation and cross-ticket isolation',async()=>{
  await withP2016IsolatedDatabase({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'p2016access',run:async({pool,databaseUrl})=>{
    await applyThrough030({pool,databaseUrl});await migrateP2016({databaseUrl});
    let clock=String(Date.now());const key='synthetic-only-p2016-hmac-test-key-32-bytes';
    const access=createP2016ReporterAccess({pool,enabled:true,hmacSecret:key,now:()=>clock,grantTtlMs:1000,sessionTtlMs:2000});
    const projector=createP2016TicketNotificationProjector({enabled:true,cardEnabled:true,reporterAccess:access,now:()=>clock});
    const timeline=createP2016ReporterTimeline({pool,access,enabled:true});
    async function seed(){
      const intake=await seedPersistedIntake({pool,text:'synthetic patient-name 10.0.0.1',requestType:'INCIDENT',status:'RECEIVED'});
      const ticket=(await createPilotTicketCore({pool}).createForIntake({intakeId:intake.intakeId,occurredAt:intake.receivedAt,traceId:'synthetic-access'})).ticket;
      const n=await transactionP2016(pool,async tx=>{const event=await appendTicketEvent({transaction:tx,ticket,eventType:'ticket.created',actor:{type:'SYSTEM',id:null},traceId:'synthetic-access'});return projector.project({transaction:tx,ticket,event});});
      return {ticket,grant:await access.deliveryGrant({deliveryId:n.delivery_id})};
    }
    const first=await seed(),other=await seed();assert.notEqual(first.grant.public_ref,other.grant.public_ref);assert.equal(Buffer.from(first.grant.public_ref,'base64url').length,24);
    const rotated=createP2016ReporterAccess({pool,enabled:true,hmacSecret:'different-synthetic-test-hmac-key-32-bytes',now:()=>clock});
    await assert.rejects(rotated.exchange(first.grant.token),{code:'P2_016_GRANT_INVALID'});
    const attempts=await Promise.allSettled(Array.from({length:12},()=>access.exchange(first.grant.token)));assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
    const session=attempts.find(r=>r.status==='fulfilled').value;
    const detail=await timeline.detail({sessionToken:session.sessionToken,publicRef:first.grant.public_ref});assert.doesNotMatch(JSON.stringify(detail),/patient-name|10\.0\.0\.1|user-test|provider_error/u);
    await assert.rejects(timeline.detail({sessionToken:session.sessionToken,publicRef:other.grant.public_ref}),{code:'P2_016_REPORTER_UNAUTHENTICATED'});
    clock=String(BigInt(clock)+1001n);await assert.rejects(access.exchange(other.grant.token),{code:'P2_016_GRANT_INVALID'});
    clock=String(BigInt(clock)+1000n);await assert.rejects(timeline.bootstrap({sessionToken:session.sessionToken}),{code:'P2_016_REPORTER_UNAUTHENTICATED'});
    const fresh=await seed(),active=await access.exchange(fresh.grant.token);
    const admin=await createPilotAccessService({pool}).upsertPrincipal({wecomUserId:'synthetic-access-admin',displayName:'合成管理员',roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});
    await assert.rejects(transactionP2016(pool,tx=>access.revokeInTransaction({transaction:tx,ticketId:fresh.ticket.id,actorPrincipalId:randomUUID()})),{code:'P2_016_FORBIDDEN'});
    await transactionP2016(pool,tx=>access.revokeInTransaction({transaction:tx,ticketId:fresh.ticket.id,actorPrincipalId:admin.id}));
    await assert.rejects(timeline.bootstrap({sessionToken:active.sessionToken}),{code:'P2_016_REPORTER_UNAUTHENTICATED'});
    await assert.rejects(access.exchange(fresh.grant.token),{code:'P2_016_GRANT_INVALID'});
    const dump=(await pool.query('SELECT (SELECT jsonb_agg(g) FROM pilot_ticket.reporter_access_grant g) AS grants,(SELECT jsonb_agg(s) FROM pilot_ticket.reporter_access_session s) AS sessions')).rows[0];
    for(const secret of [first.grant.token,session.sessionToken,fresh.grant.token,active.sessionToken,key])assert.equal(JSON.stringify(dump).includes(secret),false);
  }});
});
