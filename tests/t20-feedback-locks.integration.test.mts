import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withT20FeedbackFixture,t20Object} from './helpers/t20-feedback-fixture.mjs';
import {origin} from './helpers/yxx-ss-009-http-fixture.mjs';

async function waitUntil(run:()=>Promise<boolean>,budget=10000){const end=Date.now()+budget;while(Date.now()<end){if(await run())return;await new Promise(r=>setTimeout(r,20));}throw Error('T20_LOCK_OBSERVATION_TIMEOUT');}
test('feedback rechecks source retention after a real Ticket lock wait before committing the new round',async()=>{
 await withT20FeedbackFixture(async f=>{
  const expiry=(await f.context.pool.query<{epoch:string}>('SELECT (platform.physical_epoch_ms()+4000)::text AS epoch')).rows[0]?.epoch;assert.ok(expiry);
  await f.context.pool.query('UPDATE intake.web_request_binding SET retention_until_epoch_ms=$2::bigint,retention_until=platform.local_from_epoch_ms($2::bigint) WHERE request_ref=$1',[f.requestRef,expiry]);
  await f.context.pool.query('UPDATE intake.service_intake i SET retention_until_epoch_ms=$2::bigint,retention_until=platform.local_from_epoch_ms($2::bigint) FROM intake.web_request_binding b WHERE b.intake_id=i.id AND b.request_ref=$1',[f.requestRef,expiry]);
  const lock=await f.context.pool.connect();let pending:ReturnType<typeof f.send>|undefined;
  try{
   await lock.query('BEGIN');await lock.query('SELECT id FROM pilot_ticket.ticket WHERE id=$1::uuid FOR UPDATE',[f.ticketId]);pending=f.send();
   await waitUntil(async()=>Boolean((await f.context.pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT id FROM pilot_ticket.ticket%'")).rowCount));
   assert.equal((await f.context.pool.query<{live:boolean}>('SELECT platform.physical_epoch_ms()<$1::bigint AS live',[expiry])).rows[0]?.live,true,'request actually passed its initial source check before expiry');
   await waitUntil(async()=>Boolean((await f.context.pool.query<{expired:boolean}>('SELECT platform.physical_epoch_ms()>=$1::bigint AS expired',[expiry])).rows[0]?.expired));
   await lock.query('COMMIT');const result=await pending;assert.equal(result.status,404,result.text);
   const facts=(await f.context.pool.query<{status:string;version:number;cycles:number;feedback:number}>(`SELECT t.status,t.version,(SELECT count(*)::int FROM pilot_ticket.ticket_handling_cycle c WHERE c.ticket_id=t.id) AS cycles,(SELECT count(*)::int FROM intake.web_command_receipt WHERE command_kind='FEEDBACK') AS feedback FROM pilot_ticket.ticket t WHERE t.id=$1::uuid`,[f.ticketId])).rows[0];
   assert.deepEqual(facts,{status:'CLOSED',version:f.completed.version,cycles:1,feedback:0});
  }finally{await lock.query('ROLLBACK');lock.release();await pending;}
 });
});

for(const mode of ['logout','write-off','revocation'] as const){
 test('feedback '+mode+' during its actual source lock wait leaves no committed round or receipt',async()=>{
  await withT20FeedbackFixture(async f=>{
   const lock=await f.context.pool.connect();let pending:ReturnType<typeof f.send>|undefined;
   try{
    await lock.query('BEGIN');await lock.query('SELECT i.id FROM intake.service_intake i JOIN intake.web_request_binding b ON b.intake_id=i.id WHERE b.request_ref=$1 FOR UPDATE OF b,i',[f.requestRef]);pending=f.send();
    await waitUntil(async()=>Boolean((await f.context.pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'")).rowCount));
    if(mode==='logout')assert.equal((await f.member.request('/wecom/yixiaoxiu/logout',{method:'POST',body:{},headers:{origin,'content-type':'application/json'}})).status,200);
    else if(mode==='write-off')f.options.featureFlags.YIXIAOXIU_SELF_SERVICE_ENABLED=false;
    else await lock.query('UPDATE intake.web_request_binding SET revoked_at=platform.local_now() WHERE request_ref=$1',[f.requestRef]);
    await lock.query('COMMIT');const result=await pending;assert.equal(result.status,{logout:503,'write-off':403,revocation:404}[mode],result.text);
    assert.equal((await f.context.pool.query<{status:string}>('SELECT status FROM pilot_ticket.ticket WHERE id=$1::uuid',[f.ticketId])).rows[0]?.status,'CLOSED');
    assert.equal((await f.context.pool.query<{n:number}>('SELECT count(*)::int AS n FROM pilot_ticket.ticket_cycle_reopen WHERE ticket_id=$1::uuid',[f.ticketId])).rows[0]?.n,0);
   }finally{await lock.query('ROLLBACK');lock.release();await pending;}
  });
 });
}

test('feedback failure after Core reopen or after its receipt insert rolls back all new facts',async()=>{
 await withT20FeedbackFixture(async f=>{
  for(const [table,event,condition] of [['pilot_ticket.ticket_handling_cycle','INSERT','NEW.cycle_no>1'],['intake.web_command_receipt','INSERT',"NEW.command_kind='FEEDBACK'"]] as const){
   await f.context.pool.query("CREATE FUNCTION public.t20_feedback_fail() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'T20_FEEDBACK_ROLLBACK_CANARY'; END$$");
   await f.context.pool.query('CREATE TRIGGER t20_feedback_fail BEFORE '+event+' ON '+table+' FOR EACH ROW WHEN ('+condition+') EXECUTE FUNCTION public.t20_feedback_fail()');
   try{
    const response=await f.send();assert.equal(response.status,503,response.text);
    assert.equal((await f.context.pool.query<{status:string;version:number}>('SELECT status,version FROM pilot_ticket.ticket WHERE id=$1::uuid',[f.ticketId])).rows[0]?.status,'CLOSED');
    assert.equal((await f.context.pool.query<{n:number}>('SELECT count(*)::int AS n FROM pilot_ticket.ticket_cycle_reopen WHERE ticket_id=$1::uuid',[f.ticketId])).rows[0]?.n,0);
    const receipt=await f.member.request(f.path+'/feedback/commands/'+f.command.client_command_id);assert.equal(receipt.status,200);assert.equal(t20Object(receipt.json()).state,'UNKNOWN');
   }finally{await f.context.pool.query('DROP TRIGGER t20_feedback_fail ON '+table);await f.context.pool.query('DROP FUNCTION public.t20_feedback_fail()');}
  }
  assert.equal((await f.send()).status,200);
 });
});
