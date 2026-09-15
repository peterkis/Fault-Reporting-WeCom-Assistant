import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withYxxDatabase,entryKey} from './helpers/p2-g2-yixiaoxiu-fixture.mjs';
import {createTargetedTicketCreation} from '../src/p2-g2-yxx-targeted-creation.mjs';

test('targeted Bot ingestion persists four isolated tickets and bounds concurrent retries across restart',async()=>{
 await withYxxDatabase(async({pool})=>{
  const start=Date.now()-1000;
  const config={profile:'YXX_TARGETED_TICKET_CREATION',runId:'yxx-create-synthetic01',botId:'bot-test',groupId:'group-test',
   members:{A:'synthetic-A',B:'synthetic-B'},startEpochMs:String(start),endEpochMs:String(start+1800000),
   cases:[['A1','A','group'],['A2','A','single'],['B1','B','group'],['B2','B','single']]
    .map(([id,member,chatType])=>({id,member,chatType,text:`新故障：HIS无法登录，定向测试 synthetic01-${id}`}))};
  const runtime=()=>createTargetedTicketCreation({pool,config,reporterHmacSecret:entryKey});
  const frame=(item,overrides={})=>({cmd:'aibot_msg_callback',headers:{req_id:randomUUID()},body:{msgid:randomUUID(),aibotid:config.botId,
   chattype:item.chatType,...(item.chatType==='group'?{chatid:config.groupId}:{}),from:{userid:config.members[item.member]},
   msgtype:'text',text:{content:item.chatType==='group'?'@医小修 '+item.text:item.text},...overrides}});
  let r=runtime();
  assert.equal((await r.accept(frame(config.cases[0],{from:{userid:'outsider'}}))).ok,false);
  assert.equal((await r.accept(frame(config.cases[0],{chatid:'other-group'}))).ok,false);
  const pair=await Promise.all([r.accept(frame(config.cases[0])),r.accept(frame(config.cases[0]))]);
  assert.ok(pair.every(x=>x.ok),JSON.stringify(pair));
  assert.equal(pair[0].ticket_no,pair[1].ticket_no);
  r=runtime();
  assert.equal((await r.accept(frame(config.cases[0]))).ticket_no,pair[0].ticket_no);
  for(const item of config.cases.slice(1))assert.equal((await r.accept(frame(item))).ok,true);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM pilot_ticket.ticket')).rows[0].n,4);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM pilot_ticket.reporter_public_ref')).rows[0].n,4);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM pilot_ticket.ticket_event WHERE event_type='ticket.created'")).rows[0].n,4);
  const changed={...config,endEpochMs:String(BigInt(config.endEpochMs)-1n)};
  assert.equal((await createTargetedTicketCreation({pool,config:changed,reporterHmacSecret:entryKey}).accept(frame(config.cases[0]))).ok,false);
  const sideEffects=await pool.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('pilot_ticket','communication','incident','notification') AND (tablename LIKE '%outbox%' OR tablename LIKE '%delivery%' OR tablename LIKE '%grant%' OR schemaname='incident')");
  for(const name of ['notification.outbox','notification.delivery','notification.delivery_attempt'])
   assert.ok(sideEffects.rows.some(x=>x.schemaname+'.'+x.tablename===name),name);
  for(const {schemaname,tablename} of sideEffects.rows){
   assert.equal((await pool.query(`SELECT count(*)::int AS n FROM "${schemaname}"."${tablename}"`)).rows[0].n,0,tablename);
  }
  const expired=createTargetedTicketCreation({pool,config,reporterHmacSecret:entryKey,now:()=>String(BigInt(config.endEpochMs)+1n)});
  assert.equal((await expired.accept(frame(config.cases[0]))).code,'YXX_CREATION_WINDOW_CLOSED');
  r.close();assert.equal((await r.accept(frame(config.cases[1]))).ok,false);
  const blockedConfig={...config,runId:'yxx-create-blocked001'};
  const blocker=await pool.connect();
  try{
   await blocker.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[blockedConfig.runId]);
   const blocked=createTargetedTicketCreation({pool,config:blockedConfig,reporterHmacSecret:entryKey});
   const pending=blocked.accept(frame(config.cases[0]));
   let waiting=false;
   for(let i=0;i<50;i++){
    waiting=(await pool.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory') AS waiting")).rows[0].waiting;
    if(waiting)break;await new Promise(resolve=>setTimeout(resolve,20));
   }
   assert.equal(waiting,true);blocked.close();
   await blocker.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[blockedConfig.runId]);
   assert.equal((await pending).ok,false);
   assert.equal((await pool.query('SELECT count(*)::int AS n FROM channel.message_inbox WHERE trace_id=$1',[blockedConfig.runId])).rows[0].n,0);
  }finally{blocker.release();}
  await pool.query("CREATE FUNCTION public.synthetic_ref_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic'; END $$");
  await pool.query('CREATE TRIGGER synthetic_ref_failure BEFORE INSERT ON pilot_ticket.reporter_public_ref FOR EACH ROW EXECUTE FUNCTION public.synthetic_ref_failure()');
  const failedConfig={...config,runId:'yxx-create-failure001'};
  assert.equal((await createTargetedTicketCreation({pool,config:failedConfig,reporterHmacSecret:entryKey}).accept(frame(config.cases[0]))).ok,false);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM channel.message_inbox WHERE trace_id=$1',[failedConfig.runId])).rows[0].n,0);
  for(const table of ['pilot_ticket.ticket','pilot_ticket.ticket_event','intake.service_intake','pilot_ticket.reporter_public_ref'])
   assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n,4,table);
 });
});
