import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {PostgresPool} from '../../app/server/src/platform/postgres-pool.mjs';
import {buildConversationThreadIdentity,buildConversationSessionScope} from '../../app/server/src/p2-001-conversation-contracts.mjs';
import {seedPersistedIntake} from './p2-015-postgres-harness.mjs';
import {appendT22Item} from './wbint-t22-fixture.mjs';
import type {T22Fixture} from './wbint-t22-fixture.mjs';
import {createContactJourneyStore,MockResolvedDirectory,reporterIdentityHash} from '../../app/server/src/p2-015-contact-journey.mjs';
import {snapshotReporterProfile} from '../../app/server/src/p2-015-reporter-profile.mjs';
import {createPilotAccessService} from '../../app/server/src/p1-009-pilot-access-workbench.mjs';
import {hmacIdentity,safeHash} from '../../app/server/src/p2-015-domain-contracts.mjs';
import {transactionP2016} from '../../app/server/src/p2-016-domain-contracts.mjs';
export const INBOX_IDENTITY_KEY='conversation-inbox-synthetic-key-v1';
export interface InboxSession {id:string;intakeId:string;ticketId:string;reporter:string;rowVersion:number;threadId:string;bot:string;group:string|null;chatType:'group'|'single'}
export async function addInboxSession(pool:PostgresPool,{reporter,group,bot='t22-synthetic-bot',text='合成独立服务主题',status='OPEN'}:{reporter:string;group:string|null;bot?:string;text?:string;status?:'OPEN'|'ENDED'}):Promise<InboxSession>{
  const clock=(await pool.query<{at:string;until:string}>("SELECT platform.local_now() AS at,platform.local_now()+interval '30 days' AS until")).rows[0];assert.ok(clock);
  const intake=await seedPersistedIntake({pool,text,chatType:group===null?'single':'group'});
  await pool.query(`UPDATE intake.service_intake SET source_bot_id=$2,source_chat_id=$3,reporter_wecom_userid=$4 WHERE id=$1::uuid`,[intake.intakeId,bot,group,reporter]);
  await pool.query(`UPDATE channel.message_inbox SET bot_id=$2,chat_id=$3,sender_user_id=$4 WHERE id=$1::bigint`,[intake.messageId,bot,group,reporter]);
  const identity=buildConversationThreadIdentity({provider:'WECOM_AIBOT',botId:bot,chatType:group===null?'single':'group',chatId:group,senderUserId:reporter});
  const thread=(await pool.query<{id:string}>(`INSERT INTO conversation.thread(provider,channel_account_id,chat_type,external_thread_key,thread_key,last_activity_at)
    VALUES($1,$2,$3,$4,$5,platform.local_now()) ON CONFLICT(thread_key) DO UPDATE SET thread_key=EXCLUDED.thread_key RETURNING id::text`,[identity.provider,identity.channel_account_id,identity.chat_type,identity.external_thread_key,identity.thread_key])).rows[0];assert.ok(thread);
  const scope=buildConversationSessionScope({threadKey:identity.thread_key,participantKey:reporter,serviceIntakeId:intake.intakeId,creationIdempotencyKey:'P2-G1:CHANNEL_MESSAGE:'+intake.messageId});
  const row=(await pool.query<{id:string}>(`INSERT INTO conversation.session(thread_id,participant_key,service_intake_id,session_scope_key,creation_idempotency_key,status,control_mode,last_activity_at,ended_at,close_reason)
    VALUES($1::uuid,$2,$3::uuid,$4,$5,$6,'HUMAN',platform.local_now(),CASE WHEN $6='ENDED' THEN platform.local_now() END,CASE WHEN $6='ENDED' THEN 'SYNTHETIC_ENDED' END) RETURNING id::text`,[thread.id,reporter,intake.intakeId,scope.session_scope_key,scope.creation_idempotency_key,status])).rows[0];assert.ok(row);
  await appendT22Item(pool,row.id,1,text);
  return {id:row.id,intakeId:intake.intakeId,ticketId:'',reporter,rowVersion:1,threadId:thread.id,bot,group,chatType:group===null?'single':'group'};
}
export async function attachInboxJourney(pool:PostgresPool,session:InboxSession,{journeyId,name='同名报修人',department='合成信息科'}:{journeyId?:string;name?:string;department?:string}={}):Promise<string>{
  return transactionP2016(pool,async tx=>{
    const clock=(await tx.query<{at:string;epoch:string;until:string;until_epoch:string}>(`WITH clock AS MATERIALIZED (SELECT platform.physical_epoch_ms() AS epoch)
      SELECT platform.local_from_epoch_ms(epoch) AS at,epoch::text,
        platform.local_from_epoch_ms(epoch+2592000000) AS until,(epoch+2592000000)::text AS until_epoch FROM clock`)).rows[0];assert.ok(clock);
    const reporterHash=reporterIdentityHash({provider:'WECOM_AIBOT',bot_id:session.bot,reporter_external_id:session.reporter,hmac_key:INBOX_IDENTITY_KEY}),store=createContactJourneyStore();
    let id=journeyId;
    if(!id){const resolved=await MockResolvedDirectory({contact:{name},memberships:[{department_ref:'synthetic-dept',name:department}]}).resolve({});assert.equal(resolved.status,'RESOLVED');
      const journey=await store.ensureJourney({transaction:tx,input:{entry_mode:session.chatType==='group'?'GROUP_MENTION_TO_DIRECT_GUIDED':'DIRECT_ORGANIC',origin_intake_id:session.intakeId,session_id:session.id,reporter_identity_hash:reporterHash,profile_resolution_status:'RESOLVED',profile_snapshot:snapshotReporterProfile(resolved.snapshot),evaluation_due_at:clock.at,evaluation_due_epoch_ms:clock.epoch,reported_at:clock.at,privacy_class:'INTERNAL',retention_until:clock.until,retention_until_epoch_ms:clock.until_epoch}});id=journey.id;}
    await store.ensureLeg({transaction:tx,input:{journey_id:id,source_intake_id:session.intakeId,leg_type:journeyId?'DIRECT_GUIDED':session.chatType==='group'?'GROUP_ORIGIN':'DIRECT_ORGANIC',conversation_thread_id:session.threadId,conversation_session_id:session.id,provider_context_hash:safeHash({intake:session.intakeId}),channel_identity_hash:hmacIdentity(session.bot+'\0'+session.chatType+'\0'+(session.group??reporterHash),INBOX_IDENTITY_KEY),reporter_identity_hash:reporterHash,opened_at:clock.at}});
    return id;
  });
}
export async function conversationPost(origin:string,cookie:string,sessionId:string,action:string,body:Record<string,unknown>){
  const bootstrap=await (await fetch(origin+'/api/workbench/bootstrap',{headers:{cookie}})).json() as {csrf_token:string};
  return fetch(origin+'/api/workbench/conversations/'+sessionId+'/'+action,{method:'POST',headers:{cookie,origin,'x-csrf-token':bootstrap.csrf_token,'content-type':'application/json','idempotency-key':String(body.client_command_id),'if-match':'"'+String(body.expected_row_version)+'"'},body:JSON.stringify(body)});
}
export const freshCommand=(version=1)=>({client_command_id:randomUUID(),expected_row_version:version});

/** C1–C3: opt-in evidence using the same persisted fixture and real conversation commands. */
export async function seedCard21Conversation(f:T22Fixture){
  const session=await addInboxSession(f.pool,{reporter:'v212-synthetic-reporter',group:'v212-synthetic-group',text:'护士站打印设备连接异常，请协助排查（合成）。'});
  const ticket=f.tickets[0];assert.ok(ticket);session.ticketId=ticket.ticket.id;
  await f.pool.query("UPDATE pilot_ticket.ticket SET title=$2,created_at=platform.local_now()-interval '45 minutes' WHERE id=$1::uuid",[session.ticketId,'护士站打印设备与护理系统连接异常（合成）']);
  const journey=await attachInboxJourney(f.pool,session,{name:'欧阳慧敏（合成）',department:'心血管内科第二病区护士站（合成）'});
  await f.pool.query('UPDATE intake.contact_journey SET linked_ticket_id=$2::uuid WHERE id=$1::uuid',[journey,session.ticketId]);
  await f.pool.query('UPDATE pilot_ticket.pilot_principal SET display_name=$2 WHERE id=$1::uuid',[f.principals[0]?.id,'林舟（合成）']);
  const dates=(await f.pool.query<{today:string;yesterday:string}>("SELECT to_char(platform.local_now(),'YYYY-MM-DD') AS today,to_char(platform.local_now()-interval '1 day','YYYY-MM-DD') AS yesterday")).rows[0];assert.ok(dates);
  await f.runtime.coordinator.runOnce();
  await f.pool.query('UPDATE conversation.item SET text=$2,occurred_at=$3::timestamp WHERE session_id=$1::uuid AND sequence_no=1',[session.id,'护士站打印设备连接异常，请协助排查（合成）。',dates.yesterday+' 16:40:00']);
  await f.pool.query('UPDATE conversation.item SET text=$3,occurred_at=$2::timestamp WHERE session_id=$1::uuid AND sequence_no=2',[session.id,dates.yesterday+' 16:52:00','已重启打印机和电脑，仍然无法输出交接班记录（合成）。']);
  assert.equal((await conversationPost(f.origin,f.cookie,session.id,'takeover',freshCommand())).status,200);
  const sent:string[]=[];
  for(const text of ['我先核对终端和打印队列，后续通过 Bot 私聊联系您（合成）。','排查记录（合成）：已经核对终端网络、打印队列和设备连接，接下来需要继续检查驱动配置与打印服务状态，确认各项配置后再逐一尝试输出交接班记录，请先保留当前文件并等待处理结果。']){
    const entry=await (await fetch(f.origin+'/api/workbench/conversations/'+session.id+'?view=chat',{headers:{cookie:f.cookie}})).json() as {session:{row_version:number}};
    const response=await conversationPost(f.origin,f.cookie,session.id,'messages',{...freshCommand(entry.session.row_version),text});assert.equal(response.status,202);
    sent.push(String((await response.json() as {message_id:string}).message_id));
  }
  const current=await (await fetch(f.origin+'/api/workbench/conversations/'+session.id+'?view=chat',{headers:{cookie:f.cookie}})).json() as {session:{row_version:number}};
  assert.equal((await conversationPost(f.origin,f.cookie,session.id,'internal-notes',{...freshCommand(current.session.row_version),text:'已联系同事协助检查打印服务，待核对配置后继续处理（合成）。本次需要同步检查网络连接、设备驱动和打印队列，逐项记录排查结果，确认恢复后再通知报修人验收，避免重复操作影响现场工作。'})).status,201);
  await f.runtime.coordinator.runOnce();
  await f.pool.query("UPDATE conversation.item SET occurred_at=CASE WHEN source_id=$2 THEN $4::timestamp WHEN source_id=$3 THEN $5::timestamp WHEN item_type='INTERNAL_NOTE' THEN $6::timestamp ELSE $7::timestamp END WHERE session_id=$1::uuid AND sequence_no>2",[session.id,sent[0],sent[1],dates.today+' 09:10:00',dates.today+' 09:30:00',dates.today+' 09:35:00',dates.today+' 09:40:00']);
  return {session,dates,sent};
}

/** R4: both accounts retain the real per-session capability projection. */
export async function seedCard22Conversation(f:T22Fixture){
  const data=await seedCard21Conversation(f);
  const handler=f.principals[1];assert.ok(handler);
  await createPilotAccessService({pool:f.pool}).upsertPrincipal({wecomUserId:'web01-synthetic-1',displayName:'只读值班（合成）',roles:['DISPATCHER'],resolverTeamIds:['PILOT_IT']});
  return data;
}
