import {randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {limitedTemplate,databaseIdentity,digest} from '../../src/yxx-limited-write-contract.mjs';
import {formatEpochMsToShanghaiLocal} from '../../src/platform/time-contract.mjs';
import {createPilotAccessService} from '../../src/p1-009-pilot-access-workbench.mjs';
import {migrateCurrentBaselineWithYxx} from '../../scripts/migrate-current-baseline.mjs';
import {config,secret} from './yxx-ss-009-http-fixture.mjs';
import {browser} from './yxx-ss-009-http-fixture.mjs';

export function scopedBrowser(server,origin,cookie){const raw=browser(server,cookie);return {request:(url,options={})=>raw.request(url,{...options,headers:{...options.headers,host:new URL(origin).host,origin}})};}

export async function freePort(){const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));return port;}
export function manifestFixture({databaseUrl='postgres://synthetic@127.0.0.1/p2_015_ss010_abcd',oid='1234',port=43129,now=Date.now()}={}){
  const start=String(Math.floor((now-1000)/1000)*1000),end=String(Math.floor((now+20*60_000)/1000)*1000);
  return {...limitedTemplate(),kind:'OWNER_APPROVED_LIMITED_WRITE',status:'APPROVED',run_id:'ss011-'+randomUUID(),
    candidate_commit:'a'.repeat(40),candidate_tree:'b'.repeat(40),candidate_fingerprint:'c'.repeat(64),app_version:'a'.repeat(40),config_sha256:'d'.repeat(64),
    identity_proof_ref:config.proofRef,database:{...databaseIdentity(databaseUrl),oid,dedicated_test_only:true},
    principal_ids:[randomUUID(),randomUUID()],window:{starts_at:formatEpochMsToShanghaiLocal(start),starts_epoch_ms:start,ends_at:formatEpochMsToShanghaiLocal(end),ends_epoch_ms:end},
    limits:{max_new_intakes:6,max_supplements:8,max_new_tickets:6,per_member_intakes:4,per_member_supplements:5},
    permissions:{...limitedTemplate().permissions,database_connect:true,real_oauth_identity:true,background_processing:true,web_submit:true,web_supplement:true,internal_review_ticket_actions:true},
    owner:'synthetic-owner',approver:'synthetic-approver',approval_record_ref:'tests/synthetic-approval',approval_record_sha256:'e'.repeat(64),
    backup_ref:'synthetic-backup',rollback_ref:'synthetic-readonly',public_origin:'https://127.0.0.1',listen_port:port};
}
export async function runtimeFixture({pool,databaseUrl}){
  await migrateCurrentBaselineWithYxx({databaseUrl});
  const manifest=manifestFixture({databaseUrl,oid:(await pool.query('SELECT oid::text FROM pg_database WHERE datname=current_database()')).rows[0].oid,port:await freePort()});
  const access=createPilotAccessService({pool});manifest.principal_ids=[];
  for(const suffix of ['a','b'])manifest.principal_ids.push((await access.upsertPrincipal({wecomUserId:'ss010-staff-'+suffix,displayName:'Synthetic Staff',roles:['ADMIN'],resolverTeamIds:['PILOT_IT']})).id);
  const env={PILOT_DATABASE_URL:databaseUrl,APP_SECRET:'synthetic-app-secret',P2_G2_REPORTER_HMAC_SECRET:secret,PILOT_LOG_IDENTITY_HASH_KEY:'synthetic-identity-key-at-least-32'};
  return {manifest,configuration:{env,member:config}};
}
