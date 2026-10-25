// Source-only T33 compatibility: the original G1 migration/runtime require explicit 061
// for public UUID delivery control. All business/runtime checks are NOT_RUN here.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {test} from 'node:test';
import type {PostgresPool} from '../app/server/src/platform/postgres-pool.mjs';
import {applyP2G1Migrations} from '../app/server/src/p2-g1-migrations.mjs';
import {createP2G1Runtime} from '../app/server/src/p2-g1-runtime.mjs';
import {createP2G1PilotOperationalIntake} from '../app/server/src/p2-g1-human-only-assembly.mjs';
import {createPilotAccessService} from '../app/server/src/p1-009-pilot-access-workbench.mjs';
import {buildConversationThreadIdentity,buildConversationSessionScope} from '../app/server/src/p2-001-conversation-contracts.mjs';
import {createCommunicationDeliveryWorker} from '../app/server/src/p2-004-communication-delivery-worker.mjs';
import {createMockCommunicationSender} from '../app/server/src/p2-004-communication-sender-port.mjs';
import {CONVERSATION_DELIVERY_MIGRATION_ID,conversationDeliveryReceiptSchemaShape} from '../app/server/src/p2-006-delivery-command-schema.mjs';
import {migrateConversationDeliveryCommands} from '../app/server/scripts/conversation-delivery-commands-migrate.mjs';
import {catalogSnapshot,withP2006IsolatedDatabase} from './helpers/p2-006-postgres-harness.mjs';

function isRecord(value:unknown):value is Record<string,unknown>{
  return typeof value==='object'&&value!==null&&!Array.isArray(value);
}
function record(value:unknown):Record<string,unknown>{
  assert.ok(isRecord(value),'a real HTTP/PG object is required');
  return value;
}
function text(value:unknown):string{
  assert.ok(typeof value==='string'&&value.length>0);
  return value;
}
function positiveVersion(value:unknown):number{
  assert.ok(typeof value==='number'&&Number.isSafeInteger(value)&&value>=1);
  return value;
}
function rows(value:unknown):Record<string,unknown>[]{
  assert.ok(Array.isArray(value));
  return value.map(record);
}
async function reservePort():Promise<number>{
  const probe=createServer();
  await new Promise<void>((resolve,reject)=>{
    probe.once('error',reject);
    probe.listen(0,'127.0.0.1',()=>resolve());
  });
  const address=probe.address();
  assert.ok(address&&typeof address!=='string');
  const port=address.port;
  await new Promise<void>((resolve,reject)=>probe.close(error=>error?reject(error):resolve()));
  return port;
}
async function migrationMarkers(pool:PostgresPool):Promise<Record<string,unknown>[]>{
  return (await pool.query('SELECT migration_id,checksum_sha256 FROM platform.schema_migration ORDER BY migration_id')).rows.map(record);
}
function markerIds(markers:Record<string,unknown>[]):string[]{
  return markers.map(marker=>text(marker.migration_id));
}
async function ticketCount(pool:PostgresPool):Promise<unknown>{
  const result=(await pool.query('SELECT count(*)::integer AS count FROM pilot_ticket.ticket')).rows[0];
  assert.ok(result);
  return result.count;
}

const databaseUrl=process.env.PILOT_DATABASE_URL;
if(typeof databaseUrl!=='string'||databaseUrl.length===0)throw Error('P2_G1_UUID_COMPAT_DATABASE_REQUIRED');

test('T33 original G1 Cookie HTTP retains READ/reply without 061 and reconciles one UUID only after explicit 061',{timeout:180000},async t=>{
  await withP2006IsolatedDatabase({
    databaseUrl,purpose:'g1uuid061',max:2,
    run:async({pool,databaseUrl:isolatedDatabaseUrl}:{pool:PostgresPool;databaseUrl:string})=>{
      // The official original G1 migrator has the same base chain as the frozen
      // G1 test: legacy 001..021 -> current baseline 022/030/031/032.
      // No T33Whole, T31, 055, 058 or 060 fixture/schema is installed.
      await applyP2G1Migrations({pool,databaseUrl:isolatedDatabaseUrl});
      const originalMarkers=await migrationMarkers(pool);
      const ids=markerIds(originalMarkers);
      t.diagnostic(JSON.stringify({observation:'T33_G1_ORIGINAL_MIGRATION_PRECONDITION',migration_ids:ids}));
      assert.equal(ids.filter(id=>id.startsWith('030_')).length,1);
      assert.ok(ids.includes('031_p2_016_ticket_lifecycle_workbench_notifications'));
      assert.ok(ids.includes('032_p2_012_human_confirmed_incident'));
      assert.equal(ids.some(id=>/^(055|058|060|061)_/u.test(id)),false,
        'if the official G1 chain already installed 061, the missing-061 branch is NOT_REACHED; do not remove a real marker');
      assert.equal(await conversationDeliveryReceiptSchemaShape(pool,'before'),'BASE');
      assert.equal(await conversationDeliveryReceiptSchemaShape(pool),null);
      assert.equal(await ticketCount(pool),0);
      const originalCatalog:unknown=await catalogSnapshot(pool);

      const label=randomUUID();
      const admin=await createPilotAccessService({pool}).upsertPrincipal({
        wecomUserId:'synthetic-g1-uuid-admin-'+label,
        displayName:'Synthetic G1 UUID Admin',roles:['ADMIN'],resolverTeamIds:[],
      });
      const adminId=text(admin.id);
      // Persist only the original no-Ticket Thread/Session fixture seam.
      // The real Cookie reply/Communication Service creates every Delivery.
      const identity=buildConversationThreadIdentity({
        provider:'WECOM_AIBOT',botId:'synthetic-g1-uuid-bot-'+label,
        chatType:'group',chatId:'synthetic-g1-uuid-group-'+label,
        senderUserId:'synthetic-g1-uuid-participant-'+label,
      });
      const thread=(await pool.query(
        'INSERT INTO conversation.thread(provider,channel_account_id,chat_type,external_thread_key,thread_key,last_activity_at) VALUES($1,$2,$3,$4,$5,platform.local_now()) RETURNING id::text',
        [identity.provider,identity.channel_account_id,identity.chat_type,identity.external_thread_key,identity.thread_key],
      )).rows[0];
      assert.ok(thread);
      const scope=buildConversationSessionScope({
        threadKey:identity.thread_key,participantKey:identity.participant_key,
        creationIdempotencyKey:'G1_UUID_COMPAT:'+label,
      });
      const session=(await pool.query(
        "INSERT INTO conversation.session(thread_id,participant_key,session_scope_key,creation_idempotency_key,status,control_mode,last_activity_at) VALUES($1::uuid,$2,$3,$4,'OPEN','HUMAN',platform.local_now()) RETURNING id::text,service_intake_id",
        [text(thread.id),scope.participant_key,scope.session_scope_key,scope.creation_idempotency_key],
      )).rows[0];
      assert.ok(session);
      assert.equal(session.service_intake_id,null);
      const sessionId=text(session.id);
      const port=await reservePort(),origin='http://127.0.0.1:'+port;
      const runtime=createP2G1Runtime({
        pool,operationalIntake:createP2G1PilotOperationalIntake({
          pool,identityHashKey:'synthetic-g1-uuid-identity-hash-key',
        }),
        principalId:adminId,publicOrigin:origin,listenPort:port,
        allowedTargetHashes:[],gatewayEnabled:false,senderEnabled:false,
        externalSendEnabled:true,closePoolOnStop:false,
        projectionIntervalMs:3600000,communicationIntervalMs:3600000,
      });
      // Runtime's automatic Sender/Worker remain disabled. There is one manual
      // original Worker and only this explicit synthetic UNKNOWN boundary.
      const sender=createMockCommunicationSender({behavior:async()=>({
        outcome:'UNKNOWN',provider_message_id:null,error_code:'SYNTHETIC_UNKNOWN',retryable:false,
      })});
      const worker=createCommunicationDeliveryWorker({pool,sender,enabled:true,batchSize:1});
      try{
        const started=await runtime.start();
        assert.equal(started.address.address,'127.0.0.1');
        assert.ok(started.cookie);
        assert.equal(started.cookie.httpOnly,true);
        assert.equal(started.cookie.sameSite,'Strict');
        const cookie=text(started.cookie.name)+'='+text(started.cookie.value);
        const get=async(path:string)=>{
          const response=await fetch(origin+path,{headers:{cookie},signal:AbortSignal.timeout(10000)});
          const payload:unknown=await response.json();
          return {status:response.status,body:record(payload)};
        };
        const bootstrap=await get('/api/workbench/bootstrap');
        assert.equal(bootstrap.status,200,JSON.stringify(bootstrap.body));
        assert.equal(bootstrap.body.authenticated,true);
        const csrf=text(bootstrap.body.csrf_token);
        const post=async(path:string,body:Record<string,unknown>)=>{
          const headers:Record<string,string>={
            cookie,origin,'content-type':'application/json','x-csrf-token':csrf,
            'idempotency-key':text(body.client_command_id),
          };
          if(Object.hasOwn(body,'expected_row_version')){
            headers['if-match']='"'+positiveVersion(body.expected_row_version)+'"';
          }
          const response=await fetch(origin+path,{
            method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(10000),
          });
          const payload:unknown=await response.json();
          return {status:response.status,body:record(payload)};
        };
        const parent='/api/conversations/'+sessionId;
        const detail=async()=>{
          const response=await get(parent);
          assert.equal(response.status,200,JSON.stringify(response.body));
          assert.equal(record(response.body.session).session_id,sessionId);
          assert.equal(response.body.ticket,null);
          return response.body;
        };
        const before=await detail();
        assert.deepEqual(await catalogSnapshot(pool),originalCatalog,'runtime start/READ must not apply DDL');
        assert.deepEqual(await migrationMarkers(pool),originalMarkers);

        const takeover=await post(parent+'/takeover',{
          client_command_id:randomUUID(),expected_row_version:positiveVersion(record(before.session).row_version),
          target_principal_id:adminId,reason_code:'WORKBENCH_TAKEOVER',
        });
        assert.equal(takeover.status,200,JSON.stringify(takeover.body));
        assert.equal(takeover.body.ok,true);
        const reply=async(message:string):Promise<string>=>{
          const owned=await detail();
          const response=await post(parent+'/messages',{
            client_command_id:randomUUID(),expected_row_version:positiveVersion(record(owned.session).row_version),
            message_type:'text',text:message,
          });
          assert.equal(response.status,202,JSON.stringify(response.body));
          assert.equal(response.body.command_status,'COMMITTED');
          assert.ok(Array.isArray(response.body.delivery_ids));
          assert.equal(response.body.delivery_ids.length,1);
          return text(response.body.delivery_ids[0]);
        };
        const deliveryId=await reply('Synthetic G1 UUID reply before explicit delivery-command DDL');
        const deliveryRow=async(id:string):Promise<Record<string,unknown>>=>{
          const response=await get(parent+'/deliveries');
          assert.equal(response.status,200,JSON.stringify(response.body));
          const matching=rows(response.body.items).filter(row=>row.delivery_id===id);
          assert.equal(matching.length,1);
          const selected=matching[0];assert.ok(selected);return selected;
        };
        const pending=await deliveryRow(deliveryId);
        assert.equal(pending.status,'PENDING');assert.equal(pending.side_effect_state,'NOT_ATTEMPTED');
        assert.equal(pending.attempt_count,0);assert.equal(sender.callCount,0);
        const workerResult:unknown=await worker.deliver({deliveryId});
        assert.equal(record(workerResult).status,'RECONCILIATION_REQUIRED');
        const unknown=await deliveryRow(deliveryId);
        assert.equal(unknown.status,'RECONCILIATION_REQUIRED');
        assert.equal(unknown.side_effect_state,'UNKNOWN');assert.equal(unknown.attempt_count,1);
        assert.equal(sender.callCount,1);
        assert.equal(sender.calls.length,1);
        assert.equal(sender.calls[0]?.delivery_id,deliveryId);
        assert.equal(sender.calls[0]?.target_type,'GROUP');
        const command={
          client_command_id:randomUUID(),resolution:'CONFIRMED_NOT_SENT_REQUEUE',
          reason_code:'OPERATOR_CONFIRMED_NOT_SENT',
        };
        const controlPath='/api/deliveries/'+deliveryId+'/reconcile';
        // Original public v1 body: exact UUID/reason/resolution, no If-Match or v2.
        const blocked=await post(controlPath,command);
        const afterBlocked=await deliveryRow(deliveryId);
        t.diagnostic(JSON.stringify({
          observation:'T33_G1_UUID_WITHOUT_061',http_status:blocked.status,
          state:afterBlocked.status,side_effect_state:afterBlocked.side_effect_state,
          attempt_count:afterBlocked.attempt_count,sender_calls:sender.callCount,
        }));
        assert.equal(blocked.status,503,JSON.stringify(blocked.body));
        assert.equal(record(blocked.body.error).code,'WORKBENCH_DISABLED');
        assert.deepEqual(afterBlocked,unknown);
        assert.equal(sender.callCount,1);
        const blockedReceipt=(await pool.query(
          'SELECT count(*)::integer AS count FROM pilot_ticket.ticket_command_receipt WHERE client_command_id=$1::uuid',
          [command.client_command_id],
        )).rows[0];
        assert.ok(blockedReceipt);assert.equal(blockedReceipt.count,0);
        // READ and an additional real HTTP reply remain usable on the original schema.
        await detail();
        const siblingId=await reply('Synthetic G1 UUID reply while explicit 061 is still absent');
        assert.notEqual(siblingId,deliveryId);
        const sibling=await deliveryRow(siblingId);
        assert.equal(sibling.status,'PENDING');assert.equal(sibling.side_effect_state,'NOT_ATTEMPTED');
        assert.equal(sibling.attempt_count,0);assert.equal(sender.callCount,1);
        assert.deepEqual(await deliveryRow(deliveryId),unknown);
        assert.deepEqual(await migrationMarkers(pool),originalMarkers);
        assert.deepEqual(await catalogSnapshot(pool),originalCatalog,'UUID refusal/READ/reply must not apply DDL');
        assert.equal(await ticketCount(pool),0);

        // Only this explicit real migrator applies 061; the App remains the same.
        const migrated=await migrateConversationDeliveryCommands({databaseUrl:isolatedDatabaseUrl,mode:'apply'});
        assert.equal(migrated.status,'APPLIED');assert.equal(migrated.migration_id,CONVERSATION_DELIVERY_MIGRATION_ID);
        assert.equal(await conversationDeliveryReceiptSchemaShape(pool),'BASE');
        const afterMarkers=await migrationMarkers(pool);
        assert.deepEqual(afterMarkers.filter(marker=>marker.migration_id!==CONVERSATION_DELIVERY_MIGRATION_ID),originalMarkers,
          'explicit 061 must retain all actual original migration IDs/checksums');
        assert.equal(afterMarkers.filter(marker=>marker.migration_id===CONVERSATION_DELIVERY_MIGRATION_ID).length,1);
        assert.deepEqual(await deliveryRow(deliveryId),unknown);
        assert.deepEqual(await deliveryRow(siblingId),sibling);
        const first=await post(controlPath,command);
        assert.equal(first.status,200,JSON.stringify(first.body));
        assert.deepEqual(first.body,{
          ok:true,session_id:sessionId,delivery_id:deliveryId,client_command_id:command.client_command_id,
          status:'PENDING',side_effect_state:'NOT_ATTEMPTED',attempt_count:2,replayed:false,
        });
        const requeued=await deliveryRow(deliveryId);
        assert.equal(requeued.status,'PENDING');assert.equal(requeued.side_effect_state,'NOT_ATTEMPTED');
        assert.equal(requeued.attempt_count,2);assert.equal(sender.callCount,1);
        const replay=await post(controlPath,command);
        assert.equal(replay.status,200,JSON.stringify(replay.body));
        assert.deepEqual(replay.body,{...first.body,replayed:true});
        assert.deepEqual(await deliveryRow(deliveryId),requeued);
        assert.deepEqual(await deliveryRow(siblingId),sibling);
        assert.equal(sender.callCount,1);
        const receipts=(await pool.query(
          'SELECT command_type,state,conversation_session_id::text,ticket_id,review_id,result_ticket_event_id,result_control_event_id FROM pilot_ticket.ticket_command_receipt WHERE client_command_id=$1::uuid',
          [command.client_command_id],
        )).rows;
        assert.equal(receipts.length,1);
        assert.deepEqual(receipts[0],{
          command_type:'CONVERSATION_DELIVERY_RECONCILE',state:'COMMITTED',conversation_session_id:sessionId,
          ticket_id:null,review_id:null,result_ticket_event_id:null,result_control_event_id:null,
        });
        await detail();assert.equal(await ticketCount(pool),0);
        t.diagnostic(JSON.stringify({
          observation:'T33_G1_UUID_AFTER_EXPLICIT_061',migration_id:migrated.migration_id,
          initial_http_status:first.status,replay_http_status:replay.status,replayed:replay.body.replayed,
          status:requeued.status,attempt_count:requeued.attempt_count,sender_calls:sender.callCount,
          original_read_reply_observed:true,runtime_auto_ddl:false,
          public_uuid_control_requires_061:true,no_ticket:true,
        }));
      }finally{await runtime.stop();}
    },
  });
});
