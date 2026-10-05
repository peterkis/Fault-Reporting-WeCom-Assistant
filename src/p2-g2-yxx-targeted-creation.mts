import type { PostgresPool } from './platform/postgres-pool.mjs';
import type { InboxMessage } from './p1-003-channel-message-inbox.mjs';
export interface TargetedCreationConfig {profile:'YXX_TARGETED_TICKET_CREATION';runId:string;botId:string;groupId:string;members:{A:string;B:string};startEpochMs:string;endEpochMs:string;
 cases:{id:'A1'|'A2'|'B1'|'B2';member:'A'|'B';chatType:'group'|'single';text:string}[]}
type ConfigInput = Record<string,unknown> & {members:Record<string,unknown>};
import {createHash} from 'node:crypto';
import {assertEpochMsString,formatEpochMsToShanghaiLocal} from './platform/time-contract.mjs';
import {adaptWeComSdkFrame} from './p1-002-wecom-sdk-adapter.mjs';
import {createChannelMessageInbox} from './p1-003-channel-message-inbox.mjs';
import {createP2016DirectIntakeProcessor} from './p2-016-direct-intake.mjs';
import {createPilotTicketCore,createPilotTicketProcessor} from './p1-005-pilot-ticket-core.mjs';
import {appendTicketEvent} from './p1-006-ticket-state-actions.mjs';
import {createP2016ReporterAccess} from './p2-016-reporter-access.mjs';
import {g2EvidenceTime} from './p2-g2-evidence-time.mjs';

export function validateTargetedCreationConfig(input:unknown): TargetedCreationConfig{
  const fail:()=>never=()=>{throw Error('YXX_CREATION_CONFIG_INVALID');};
  const exact=(obj:unknown,keys:readonly string[])=>obj&&typeof obj==='object'&&!Array.isArray(obj)
    &&Object.keys(obj).length===keys.length&&keys.every(k=>Object.hasOwn(obj,k));
  if(!exact(input,['profile','runId','botId','groupId','members','startEpochMs','endEpochMs','cases']))fail();
  const c=structuredClone(input) as ConfigInput;
  if(c.profile!=='YXX_TARGETED_TICKET_CREATION'||!/^yxx-create-[a-z0-9]{8,32}$/u.test(c.runId as string))fail();
  if(!exact(c.members,['A','B'])||![c.botId,c.groupId,c.members.A,c.members.B]
    .every(v=>typeof v==='string'&&v.length>0&&v.length<=256&&!/[\s\u0000]/u.test(v)))fail();
  if((c.members.A as string).toLowerCase()===(c.members.B as string).toLowerCase())fail();
  try{assertEpochMsString(c.startEpochMs);assertEpochMsString(c.endEpochMs);}catch{fail();}
  const duration=BigInt(c.endEpochMs as string)-BigInt(c.startEpochMs as string);
  if(duration<=0n||duration>1800000n)fail();
  const expected=[['A1','A','group'],['A2','A','single'],['B1','B','group'],['B2','B','single']];
  if(!Array.isArray(c.cases)||c.cases.length!==4)fail();
  for(let i=0;i<4;i++){
    const item=c.cases[i];
    if(!exact(item,['id','member','chatType','text'])||item.id!==(expected[i] as string[])[0]
      ||item.member!==(expected[i] as string[])[1]||item.chatType!==(expected[i] as string[])[2]
      ||typeof item.text!=='string'||item.text.length>200||!item.text.startsWith('新故障：HIS无法登录，定向测试 ')
      ||!item.text.endsWith('-'+item.id)||/[\r\n\u0000]/u.test(item.text))fail();
    Object.freeze(item);
  }
  Object.freeze(c.members);Object.freeze(c.cases);return Object.freeze(c) as ConfigInput & TargetedCreationConfig;
}

export function targetedCreationConfigHash(config:unknown){
  const c=validateTargetedCreationConfig(config);
  return createHash('sha256').update(JSON.stringify([c.profile,c.runId,c.botId,c.groupId,
    c.members.A,c.members.B,c.startEpochMs,c.endEpochMs,c.cases.map(x=>[x.id,x.member,x.chatType,x.text])])).digest('hex');
}

export function createTargetedTicketCreation({pool,config,reporterHmacSecret,now=()=>String(Date.now())}: {pool:PostgresPool;config:unknown;reporterHmacSecret:string;now?:()=>string}){
  let closed=false;
  const c=validateTargetedCreationConfig(config),configHash=targetedCreationConfigHash(c);
  const inbox=createChannelMessageInbox({pool});
  const access=createP2016ReporterAccess({pool,enabled:true,hmacSecret:reporterHmacSecret});
  const processor=createPilotTicketProcessor({serviceIntakeProcessor:createP2016DirectIntakeProcessor(),
    ticketCore:createPilotTicketCore({pool}),onTicketCreated:async({transaction,ticket,message})=>{
      await appendTicketEvent({transaction,ticket,eventType:'ticket.created',actor:{type:'SYSTEM',id:null},traceId:c.runId});
      const hash=createHash('sha256').update(JSON.stringify(['WECOM_AIBOT',(message as InboxMessage).bot_id,(message as InboxMessage).sender_user_id])).digest('hex');
      return access.ensurePublicRefInTransaction({transaction,ticketId:ticket.id,reporterBindingHash:hash});
    }});
  const inWindow=(epoch:unknown)=>BigInt(epoch as string)>=BigInt(c.startEpochMs as string)&&BigInt(epoch as string)<BigInt(c.endEpochMs as string);
  return Object.freeze({close(){closed=true;},async accept(frame:unknown){
    const epoch=assertEpochMsString(now());
    if(closed||!inWindow(epoch))return {ok:false,code:'YXX_CREATION_WINDOW_CLOSED',...g2EvidenceTime(epoch)};
    const adapted=adaptWeComSdkFrame(frame,{receivedEpochMs:epoch});
    const m=(adapted as Extract<typeof adapted,{ok:true}>).message;
    if(!adapted.ok||m.bot_id!==c.botId||m.msg_type!=='text'||m.quote!==null||m.content.length!==1)
      return {ok:false,code:'YXX_CREATION_SCOPE_DENIED',...g2EvidenceTime(epoch)};
    const text=(m.content[0] as {text:{raw:string}}).text.raw.trim();
    const addressed=m.chat_type==='group'?text.replace(/^@[^\s@]+\s+/u,''):text;
    const item=c.cases.find(x=>x.chatType===m.chat_type&&c.members[x.member]===m.sender_user_id&&x.text===addressed
      &&(m.chat_type==='single'||(m.chat_id===c.groupId&&addressed!==text)));
    if(!item)return {ok:false,code:'YXX_CREATION_SCOPE_DENIED',...g2EvidenceTime(epoch)};
    const retained=String(BigInt(epoch)+7n*86400000n);
    const result=await inbox.accept({message:m,traceId:c.runId,privacyClass:'PERSONAL',
      retentionUntil:formatEpochMsToShanghaiLocal(retained),retentionUntilEpochMs:retained},async input=>{
      // Four cases share one short transaction lock; no new budget table or migration.
      await input.transaction.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[c.runId]);
      const physical=((await input.transaction.query('SELECT platform.physical_epoch_ms()::text AS epoch')).rows[0] as {epoch:unknown}).epoch;
      if(closed||!inWindow(physical))throw Error('YXX_CREATION_WINDOW_CLOSED');
      const previous=await input.transaction.query(`SELECT response_snapshot FROM channel.message_inbox
        WHERE trace_id=$1 AND processing_status='COMPLETED' ORDER BY id`,[c.runId]);
      if(previous.rows.some(x=>(x.response_snapshot as Record<string,unknown> | null)?.config_hash!==configHash))throw Error('YXX_CREATION_CONFIG_CHANGED');
      if((previous.rowCount as number)>=16)throw Error('YXX_CREATION_INPUT_LIMIT');
      const existing=previous.rows.find(x=>(x.response_snapshot as Record<string,unknown>).case_id===item.id);
      if(existing)return {...(existing.response_snapshot as Record<string,unknown>),duplicate:true,...g2EvidenceTime()};
      const created=await processor(input);
      if(!created.ticket||!(created.lifecycle as {public_ref?:string}|undefined)?.public_ref)throw Error('YXX_CREATION_TICKET_REQUIRED');
      const finalEpoch=((await input.transaction.query('SELECT platform.physical_epoch_ms()::text AS epoch')).rows[0] as {epoch:unknown}).epoch;
      if(closed||!inWindow(finalEpoch))throw Error('YXX_CREATION_WINDOW_CLOSED');
      return {ok:true,run_id:c.runId,config_hash:configHash,case_id:item.id,ticket_no:created.ticket.ticket_no,
        public_ref:(created.lifecycle as {public_ref:string}).public_ref,duplicate:false,...g2EvidenceTime()};
    });
    if(!result.ok)return {ok:false,code:'YXX_CREATION_TRANSACTION_FAILED',...g2EvidenceTime()};
    if((result.result as Record<string,unknown>|null)?.config_hash!==configHash||(result.result as Record<string,unknown>|null)?.case_id!==item.id)
      return {ok:false,code:'YXX_CREATION_IDEMPOTENCY_CONFLICT',...g2EvidenceTime()};
    return {...(result.result as Record<string,unknown>),duplicate:result.duplicate||(result.result as Record<string,unknown>).duplicate,...g2EvidenceTime()};
  }});
}
