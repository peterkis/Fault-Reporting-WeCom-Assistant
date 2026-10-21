import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac,randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {IncomingMessage} from 'node:http';
import {Socket} from 'node:net';
import {withT24Fixture} from './helpers/t24-round-notification-fixture.mjs';
import {seedPersistedIntake} from './helpers/p2-015-postgres-harness.mjs';
import {sourceFile} from './helpers/migration-roots.mjs';
import {createYxxSelfServiceStore} from '../src/yxx-self-service-store.mjs';
import {createYxxSelfServiceOrchestrator} from '../src/yxx-self-service-orchestrator.mjs';
import {createYxxSelfServiceQuery} from '../src/yxx-self-service-query.mjs';
import {createYxxSelfServiceAuthorization} from '../src/yxx-self-service-authorization.mjs';
import type {YxxMemberScope} from '../src/yxx-self-service-authorization.mjs';
import {createYxxH5Lifecycle} from '../src/yxx-h5-v2-lifecycle.mjs';
import {createYxxH5Profile} from '../src/yxx-h5-v2-profile.mjs';
import {createYxxSelfServiceFeedback} from '../src/yxx-self-service-feedback.mjs';
import {createPilotTicketCore} from '../src/p1-005-pilot-ticket-core.mjs';
import {createThirdPartyStaffDirectoryStore} from '../src/p2-007-staff-directory-store.mjs';
import {migrateWorkbenchAuth} from '../scripts/p2-016-workbench-auth-migrate.mjs';
import {migrateThirdPartyStaffDirectory} from '../scripts/p2-007-migrate.mjs';
import type {YxxSelfServiceBootstrap} from '../contracts/yxx_self_service_contracts.js';
import type {PostgresPool,PostgresPoolClient,PostgresTransaction} from '../src/platform/postgres-pool.mjs';

const secret='h5-entry-integration-synthetic-secret-over-thirty-two-bytes';
const flags={YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true};
function scope():YxxMemberScope{return {scopeHash:createHash('sha256').update(randomUUID()).digest('hex') as YxxMemberScope['scopeHash'],sourceCorpScope:'entry-synthetic-corp',sourceAppScope:'entry-synthetic-app',proofRef:'tests/yxx-h5-entry'};}
const auth=(s:YxxMemberScope)=>({profile:'MEMBER_SELF_SERVICE',flags,write_flag:true,csrf_token:'entry-synthetic-csrf',canonical_reporter_binding:s.scopeHash,source_corp_scope:s.sourceCorpScope,source_app_scope:s.sourceAppScope,proof_ref:s.proofRef,bot_owner:{botId:'entry-synthetic-bot',userId:'entry-synthetic-bot-user'}});
const bootstrap:YxxSelfServiceBootstrap={authenticated:true,identity_mode:'MEMBER_SELF_SERVICE',read_only:false,can_submit:true,can_supplement:true,csrf_token:'entry-synthetic-csrf',recovery_scope:'entry-synthetic-recovery-scope'};
const submit=(text:string)=>({schema_version:2,client_command_id:randomUUID(),intent:'FAULT',description:text,location:{text:null,unknown:true},media_refs:[]});

async function captureActualSql<T>(pool:PostgresPool,run:()=>Promise<T>,connected?:(client:PostgresPoolClient)=>void,rewrite?:(sql:string)=>string){
 const sql:string[]=[],clients=new Map<PostgresPoolClient,PropertyDescriptor|undefined>(),connect=pool.connect,connectDescriptor=Object.getOwnPropertyDescriptor(pool,'connect');
 function client(value:unknown){
  assert.ok(value&&typeof value==='object'&&'query' in value&&typeof value.query==='function'&&'release' in value&&typeof value.release==='function');
  const actual=value as PostgresPoolClient;if(clients.has(actual))return actual;
  clients.set(actual,Object.getOwnPropertyDescriptor(actual,'query'));connected?.(actual);const original=actual.query;
  const query=function(...args:unknown[]){if(typeof args[0]==='string'){args[0]=rewrite?.(args[0])??args[0];if(typeof args[0]==='string')sql.push(args[0]);}return Reflect.apply(original,actual,args);};
  if(Object.getOwnPropertyDescriptor(original,'__arch005Guarded')?.value===true)Object.defineProperty(query,'__arch005Guarded',{value:true});
  Object.defineProperty(actual,'query',{value:query,writable:true,configurable:true});return actual;
 }
 Object.defineProperty(pool,'connect',{writable:true,configurable:true,value:function(...args:unknown[]):unknown{
  const callback=args[0];if(typeof callback==='function')return Reflect.apply(connect,pool,[function(this:unknown,...received:unknown[]){if(received[1])received[1]=client(received[1]);return Reflect.apply(callback,this,received);},...args.slice(1)]);
  const result:unknown=Reflect.apply(connect,pool,args);return result instanceof Promise?result.then(client):result;
 }});
 try{return {result:await run(),sql,connections:[...clients.keys()]};}finally{
  if(connectDescriptor)Object.defineProperty(pool,'connect',connectDescriptor);else Reflect.deleteProperty(pool,'connect');
  for(const [actual,descriptor] of clients)if(descriptor)Object.defineProperty(actual,'query',descriptor);else Reflect.deleteProperty(actual,'query');
 }
}
async function readSettings(tx:PostgresTransaction){
 const row=(await tx.query<{work_mem:string;hash_mem_multiplier:string;max_parallel_workers_per_gather:string}>("SELECT current_setting('work_mem') AS work_mem,current_setting('hash_mem_multiplier') AS hash_mem_multiplier,current_setting('max_parallel_workers_per_gather') AS max_parallel_workers_per_gather")).rows[0];
 assert.ok(row);return row;
}

test('H5 entry real PostgreSQL aggregation, bounded history, department privacy and terminal fences',{timeout:240000},async t=>{
 assert.ok(process.env.PILOT_DATABASE_URL,'owned PostgreSQL 18 is required');
 await withT24Fixture(async f=>{
  // This test drives query Ports. Stop this fixture's unrelated background loops
  // so the exact returned native connection can be checked on its next lease.
  await f.runtime.stop();
  await f.pool.query(await readFile(sourceFile('database/migrations/064_yixiaoxiu_h5_member_service.sql'),'utf8'));
  await migrateWorkbenchAuth({...{databaseUrl:f.databaseUrl},mode:'apply'});await migrateThirdPartyStaffDirectory({...{databaseUrl:f.databaseUrl},mode:'apply'});
  const a=scope(),b=scope(),store=createYxxSelfServiceStore({pool:f.pool,scopeSecret:secret,h5Enabled:true});
  const first=await store.accept({scope:a,input:submit('entry-owned synthetic description')}),ref=first.receipt.request_ref;
  for(let revision=1;revision<=25;revision++)await store.accept({scope:a,kind:'SUPPLEMENT',requestRef:ref,input:{schema_version:1,client_command_id:randomUUID(),expected_input_revision:String(revision),text:'supplement '+String(revision+1)}});
  for(let index=0;index<3;index++)await store.accept({scope:a,input:submit('other-own '+String(index))});
  const peer=await store.accept({scope:b,input:submit('PEER_PRIVATE_DESCRIPTION_MUST_NOT_LEAK')});
  const orchestrator=createYxxSelfServiceOrchestrator({pool:f.pool,profile:'MEMBER_SELF_SERVICE',featureFlags:flags,ruleEngine:{evaluate(){throw Error('DECLARED_INTENT_MUST_NOT_CALL_RULE_ENGINE');}}});
  for(const requestRef of [ref,peer.receipt.request_ref])assert.equal((await orchestrator.processOne({requestRef})).processed,true);
  const botIntake=await seedPersistedIntake({pool:f.pool,text:'synthetic independent Bot source',requestType:'INCIDENT',status:'RECEIVED',tag:'h5-entry-mixed-source'});
  await f.pool.query('UPDATE intake.service_intake SET source_bot_id=$2,reporter_wecom_userid=$3 WHERE id=$1::uuid',[botIntake.intakeId,'entry-synthetic-bot','entry-synthetic-bot-user']);
  const botTicket=(await createPilotTicketCore({pool:f.pool}).createForIntake({intakeId:botIntake.intakeId,occurredAt:botIntake.receivedAt,traceId:'h5-entry-mixed-source'})).ticket;assert.ok(botTicket);
  const botRef=randomBytes(24).toString('base64url'),botBinding=createHash('sha256').update(JSON.stringify(['WECOM_AIBOT','entry-synthetic-bot','entry-synthetic-bot-user'])).digest('hex');
  await f.pool.query('INSERT INTO pilot_ticket.reporter_public_ref(ticket_id,public_ref,reporter_binding_hash) VALUES($1::uuid,$2,$3)',[botTicket.id,botRef,botBinding]);
  const sharedTime=(await f.pool.query<{at:string}>("SELECT to_char(platform.local_now()-interval '1 minute','YYYY-MM-DD HH24:MI:SS') AS at")).rows[0]?.at;assert.ok(sharedTime);
  await f.pool.query('UPDATE intake.web_request_binding SET created_at=$2::timestamp without time zone WHERE canonical_reporter_binding=$1',[a.scopeHash,sharedTime]);
  await f.pool.query('UPDATE pilot_ticket.ticket SET created_at=$2::timestamp without time zone WHERE id=$1::uuid',[botTicket.id,sharedTime]);
  const directory=createThirdPartyStaffDirectoryStore({pool:f.pool}),version='e'.repeat(64);
  const members=[['provider-a','ENTRY-A'],['provider-b','ENTRY-B']].map(([id,employee])=>({provider_user_id:id??'',employee_id:employee??'',nickname:'synthetic member',phone:null,provider_wecom_id:null}));
  await directory.publishSnapshot({source_scope:'FORMAL',root_ref:'synthetic-entry-root',snapshot:{snapshot_version:version,
   departments:[{provider_department_id:'entry-dept',parent_provider_department_id:null,name:'synthetic department',provider_gid:null,provider_gid_type:null,depth:0}],members,
   memberships:members.map(member=>({provider_user_id:member.provider_user_id,provider_department_id:'entry-dept'})),protocol_warnings:[],counts:{departments:1,members:2,memberships:2,max_depth:0}}});
  for(const [index,s] of [a,b].entries()){
   const member=members[index];assert.ok(member);const current=await directory.findMemberByProviderUserId({source_scope:'FORMAL',provider_user_id:member.provider_user_id});assert.ok(current);
   await directory.saveResolvedProfile({source_scope:'FORMAL',reporter_identity_hash:s.scopeHash,source_namespace:'WECOM_APP_OPENID',resolution_method:'SYNTHETIC_VERIFIED_UID',member:current,
    profile:{provider_user_id:member.provider_user_id,employee_id:member.employee_id,display_name:member.nickname,phone:null,sex:null,avatar_url:null}});
  }
  await f.pool.query("UPDATE directory.member_current SET account_status='ACTIVE'");
  const lifecycle=createYxxH5Lifecycle({pool:f.pool,scopeSecret:secret,enabled:true}),profile=createYxxH5Profile({pool:f.pool,scopeSecret:secret,enabled:true}),feedbackStore=createYxxSelfServiceFeedback({pool:f.pool,scopeSecret:secret});
  let readable=true;
  const authorization=createYxxSelfServiceAuthorization({profile:'MEMBER_SELF_SERVICE',flags,authenticate:async()=>auth(a),recheck:Object.assign(async()=>readable?auth(a):null,{localOnly:true as const})});
  const options={pool:f.pool,authorization,store,scopeSecret:secret,h5Lifecycle:lifecycle,h5Profile:profile,feedbackStore};
  const query=createYxxSelfServiceQuery(options),request=new IncomingMessage(new Socket());
  try{
   const originalSettings=await readSettings(f.pool);
   const observedHome=await captureActualSql(f.pool,()=>query.h5Entry({request,input:{view:'home'},bootstrap})),home=observedHome.result;
   assert.ok(home.view==='home');assert.equal(home.data.recent_reports.length,3);assert.ok(home.membership_revision);
   const homeSelects=observedHome.sql.filter(sql=>/^\s*(SELECT|WITH)\b/iu.test(sql));assert.equal(homeSelects.length,3,'home includes current profile, one aggregate and fresh terminal profile');
   const homeAggregate=homeSelects.find(sql=>sql.startsWith('WITH batch_input AS MATERIALIZED ('));assert.ok(homeAggregate);
   const rawBoundary=homeAggregate.indexOf('), raw_rows AS MATERIALIZED (');assert.ok(rawBoundary>0);
   const departmentCountsSql=homeAggregate.slice(0,rawBoundary);
   assert.equal(departmentCountsSql.includes('platform.physical_epoch_ms()'),false);assert.equal(departmentCountsSql.split('pg_catalog.clock_timestamp()').length-1,4,'every original department summary guard retains a fresh clock');
   assert.ok(departmentCountsSql.includes('JOIN (SELECT id,status FROM pilot_ticket.ticket OFFSET 0) t ON t.id=i.pilot_ticket_id'));
   assert.ok(departmentCountsSql.includes('CASE WHEN i.canonical_reporter_binding=wb.canonical_reporter_binding AND i.source_app_scope=wb.source_app_scope THEN TRUE ELSE FALSE END'));
   assert.equal(departmentCountsSql.includes('reports AS MATERIALIZED'),false);assert.equal(departmentCountsSql.includes('authorized_source_keys'),false);
   const localSettings=["SET LOCAL work_mem='16MB'",'SET LOCAL hash_mem_multiplier=2','SET LOCAL max_parallel_workers_per_gather=0'];
   assert.deepEqual(observedHome.sql.filter(sql=>localSettings.includes(sql)),localSettings,'resource settings are three honest, sequential SQL operations');
   assert.equal(observedHome.connections.length,1);
   const committed=await f.pool.connect();let open=false;
   try{
    assert.equal(committed,observedHome.connections[0],'the actual native home connection is returned to the pool');assert.deepEqual(await readSettings(committed),originalSettings);
    await committed.query('BEGIN');open=true;await profile.departmentInTransaction(committed,a,{limit:1});
    assert.deepEqual(await readSettings(committed),{work_mem:'16MB',hash_mem_multiplier:'2',max_parallel_workers_per_gather:'0'});
    await committed.query('COMMIT');open=false;assert.deepEqual(await readSettings(committed),originalSettings,'successful commit restores every transaction-local setting');
   }finally{if(open)await committed.query('ROLLBACK');committed.release();}
   const failedConnections:PostgresPoolClient[]=[];
   await assert.rejects(captureActualSql(f.pool,()=>query.h5Entry({request,input:{view:'home'},bootstrap}),client=>failedConnections.push(client),
    sql=>sql.startsWith('WITH batch_input AS MATERIALIZED (')?`SELECT (1/0)::integer AS failed FROM (${sql}) actual_batch`:sql),{code:'22012'});
   const reused=await f.pool.connect();
   try{assert.equal(failedConnections.length,1);assert.equal(reused,failedConnections[0]);assert.deepEqual(await readSettings(reused),originalSettings,'error rollback restores the same connection before its next lease');}finally{reused.release();}
   const formula=departmentCountsSql.match(/pg_catalog\.floor\(EXTRACT\(epoch FROM pg_catalog\.clock_timestamp\(\)\) OPERATOR\(pg_catalog\.\*\) 1000::pg_catalog\.numeric\)::pg_catalog\.int8/u)?.[0];assert.ok(formula);
   assert.deepEqual(home.data.department_summary,{total:2,active_count:2,membership_revision:home.membership_revision});
   assert.equal(JSON.stringify(home).includes('PEER_PRIVATE_DESCRIPTION_MUST_NOT_LEAK'),false);
   await f.pool.query("UPDATE directory.member_current SET account_status='UNKNOWN' WHERE provider_user_id='provider-a'");
   const observedNoDepartment=await captureActualSql(f.pool,()=>query.h5Entry({request,input:{view:'home'},bootstrap})),noDepartment=observedNoDepartment.result;assert.ok(noDepartment.view==='home');
   assert.deepEqual(observedNoDepartment.sql.filter(sql=>localSettings.includes(sql)),[],'no department READ means no department workload or resource lease');
   assert.equal(noDepartment.bootstrap.h5.can_view_department,false);assert.equal(noDepartment.data.department_summary,null);assert.deepEqual(noDepartment.data.recent_reports,home.data.recent_reports);
   await f.pool.query("UPDATE directory.member_current SET account_status='ACTIVE' WHERE provider_user_id='provider-a'");
   const originalExpiry=(await f.pool.query<{epoch:string}>('SELECT retention_until_epoch_ms::text AS epoch FROM intake.web_request_binding WHERE request_ref=$1',[ref])).rows[0];assert.ok(originalExpiry);
   const held=await f.pool.connect();let holding=false,pending:ReturnType<typeof query.h5Entry>|null=null,reservedHome:PostgresPoolClient|null=null,homeReleased=false;
   try{
    const trackActivityQuerySize=(await held.query<{track_activity_query_size:string}>('SHOW track_activity_query_size')).rows[0]?.track_activity_query_size;assert.ok(trackActivityQuerySize);
    const expiry=(await f.pool.query<{epoch:string}>(`WITH deadline AS MATERIALIZED(SELECT platform.physical_epoch_ms()+1000 AS epoch)
      UPDATE intake.web_request_binding SET retention_until_epoch_ms=deadline.epoch,retention_until=platform.local_from_epoch_ms(deadline.epoch)
      FROM deadline WHERE request_ref=$1 RETURNING retention_until_epoch_ms::text AS epoch`,[ref])).rows[0];assert.ok(expiry);
    await held.query('BEGIN');holding=true;await held.query('LOCK TABLE intake.web_request_binding IN ACCESS EXCLUSIVE MODE');
    reservedHome=await f.pool.connect();const homeConnection=reservedHome;
    const homePid=(await homeConnection.query<{pid:number}>('SELECT pg_catalog.pg_backend_pid() AS pid')).rows[0]?.pid;
    const holderPid=(await held.query<{pid:number}>('SELECT pg_catalog.pg_backend_pid() AS pid')).rows[0]?.pid;
    assert.ok(homePid&&holderPid&&homePid!==holderPid);assert.equal(f.pool.waitingCount,0,'the reserved native home connection is available, not queued in the pool');
    interface Activity {pid:number;state:string|null;wait_event_type:string|null;wait_event:string|null;query:string}
    const activity=async()=>(await held.query<Activity>('SELECT pid,state,wait_event_type,wait_event,query FROM pg_catalog.pg_stat_activity WHERE pid=$1',[homePid])).rows[0]??null;
    const safeActivity=(row:Activity|null)=>row?{pid:row.pid,state:row.state,wait_event_type:row.wait_event_type,wait_event:row.wait_event,query_sha256:createHash('sha256').update(row.query).digest('hex'),query_bytes:Buffer.byteLength(row.query)}:null;
    // Deliberately preserve the pre-request statistics snapshot. Live lock-manager
    // evidence below can then distinguish a stale observer from a missing lock.
    const primed=await activity();assert.ok(primed);homeConnection.release();homeReleased=true;
    let actualHome:PostgresPoolClient|null=null,pendingCode:string|null=null;const capturedBatch:{text:string|null;count:number}={text:null,count:0};
    pending=captureActualSql(f.pool,()=>query.h5Entry({request,input:{view:'home'},bootstrap}),client=>{actualHome=client;},sql=>{
     if(sql.startsWith('WITH batch_input AS MATERIALIZED (')){capturedBatch.text=sql;capturedBatch.count++;}return sql;
    }).then(observed=>observed.result);
    void pending.catch((error:unknown)=>{pendingCode=error&&typeof error==='object'&&'code' in error&&typeof error.code==='string'&&/^[A-Z0-9_]+$/u.test(error.code)?error.code:'UNCLASSIFIED';});
    let blocked=false,cached:Activity|null=null,fresh:Activity|null=null,blockers:number[]=[],relationWaiting=false;const until=performance.now()+5000;
    while(performance.now()<until){
     const live=(await held.query<{blockers:number[];relation_waiting:boolean}>(`SELECT pg_catalog.pg_blocking_pids($1::integer) AS blockers,
       EXISTS(SELECT 1 FROM pg_catalog.pg_locks WHERE pid=$1::integer AND locktype='relation'
        AND relation='intake.web_request_binding'::pg_catalog.regclass AND mode='AccessShareLock' AND NOT granted) AS relation_waiting`,[homePid])).rows[0];
     blockers=live?.blockers??[];relationWaiting=live?.relation_waiting===true;
     if(blockers.includes(holderPid)&&relationWaiting){
      cached=await activity();await held.query('SELECT pg_catalog.pg_stat_clear_snapshot()');fresh=await activity();
      blocked=fresh?.wait_event_type==='Lock'&&fresh.query.startsWith('WITH batch_input AS MATERIALIZED (')
       &&capturedBatch.text!==null&&capturedBatch.text.startsWith(fresh.query);if(blocked)break;
     }
     if(pendingCode)break;await new Promise<void>(resolve=>setTimeout(resolve,10));
    }
    t.diagnostic(JSON.stringify({phase:'H5_ENTRY_EXPIRY_LOCK',home_pid:homePid,holder_pid:holderPid,pool_waiting:f.pool.waitingCount,native_connection_confirmed:actualHome===homeConnection,
      blocking_pids:blockers,waiting_for_binding:relationWaiting,cached:safeActivity(cached),fresh:safeActivity(fresh),
      track_activity_query_size:trackActivityQuerySize,captured_batch_statements:capturedBatch.count,
      full_query_sha256:capturedBatch.text===null?null:createHash('sha256').update(capturedBatch.text).digest('hex'),full_query_bytes:capturedBatch.text===null?null:Buffer.byteLength(capturedBatch.text),
      activity_is_actual_prefix:capturedBatch.text!==null&&fresh!==null&&capturedBatch.text.startsWith(fresh.query),
      activity_truncated:capturedBatch.text!==null&&fresh!==null&&Buffer.byteLength(fresh.query)<Buffer.byteLength(capturedBatch.text),
      cached_activity_lagged:cached!==null&&fresh!==null&&(cached.query!==fresh.query||cached.state!==fresh.state||cached.wait_event_type!==fresh.wait_event_type||cached.wait_event!==fresh.wait_event),pending_error_code:pendingCode}));
    assert.equal(blocked,true,'actual home aggregate must be waiting for the table lock');
    assert.equal(capturedBatch.count,1,'activity belongs to the one actual shared SQL dispatched by this entry');
    assert.equal(actualHome,homeConnection);assert.ok(blockers.includes(holderPid));assert.equal(relationWaiting,true);
    assert.equal((await held.query<{future:boolean}>('SELECT $1::bigint>platform.physical_epoch_ms() AS future',[expiry.epoch])).rows[0]?.future,true,'deadline was still live when the query began waiting');
    await held.query('SELECT pg_catalog.pg_sleep(GREATEST(($1::bigint-platform.physical_epoch_ms()+5)::numeric/1000,0))',[expiry.epoch]);
    assert.equal((await held.query<{expired:boolean}>('SELECT platform.physical_epoch_ms()>=$1::bigint AS expired',[expiry.epoch])).rows[0]?.expired,true);
    await held.query('COMMIT');holding=false;const afterWait=await pending;assert.ok(afterWait.view==='home');
    assert.ok(afterWait.data.recent_reports.every(item=>item.ref!==ref));assert.deepEqual(afterWait.data.department_summary,{total:1,active_count:1,membership_revision:afterWait.membership_revision});
   }finally{
    if(reservedHome&&!homeReleased)reservedHome.release();
    if(holding)await held.query('ROLLBACK');held.release();await pending?.catch(()=>undefined);
    await f.pool.query('UPDATE intake.web_request_binding SET retention_until_epoch_ms=$2::bigint,retention_until=platform.local_from_epoch_ms($2::bigint) WHERE request_ref=$1',[ref,originalExpiry.epoch]);
   }
   await f.pool.query('CREATE SCHEMA h5_entry_clock_shadow');
   await f.pool.query('CREATE FUNCTION h5_entry_clock_shadow.floor(numeric) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$SELECT -777::pg_catalog.numeric$$');
   await f.pool.query("CREATE FUNCTION h5_entry_clock_shadow.clock_timestamp() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT '1900-01-01 00:00:00+00'::pg_catalog.timestamptz$$");
   await f.pool.query('CREATE FUNCTION h5_entry_clock_shadow.multiply(numeric,numeric) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$SELECT -777::pg_catalog.numeric$$');
   await f.pool.query('CREATE OPERATOR h5_entry_clock_shadow.*(LEFTARG=pg_catalog.numeric,RIGHTARG=pg_catalog.numeric,FUNCTION=h5_entry_clock_shadow.multiply)');
   const shadow=await f.pool.connect();
   try{
    await shadow.query('BEGIN');await shadow.query('SET LOCAL search_path=h5_entry_clock_shadow,pg_catalog,platform,public');await shadow.query("SET LOCAL TimeZone='Pacific/Kiritimati'");
    assert.equal((await shadow.query<{value:string}>('SELECT floor(1.9::numeric)::text AS value')).rows[0]?.value,'-777','hostile function really precedes pg_catalog');
    assert.equal((await shadow.query<{shadow:boolean}>("SELECT clock_timestamp()='1900-01-01 00:00:00+00'::pg_catalog.timestamptz AS shadow")).rows[0]?.shadow,true);
    assert.equal((await shadow.query<{value:string}>('SELECT (1::numeric*2::numeric)::text AS value')).rows[0]?.value,'-777','hostile multiplication operator really precedes pg_catalog');
    const brackets=(await shadow.query<{before:string;current:string;after:string}>(`WITH first AS MATERIALIZED(SELECT platform.physical_epoch_ms() AS epoch),
      middle AS MATERIALIZED(SELECT first.epoch AS before,${formula} AS current FROM first),
      last AS MATERIALIZED(SELECT middle.*,platform.physical_epoch_ms() AS after FROM middle)
      SELECT before::text,current::text,after::text FROM last`)).rows[0];assert.ok(brackets);
    assert.ok(BigInt(brackets.before)<=BigInt(brackets.current)&&BigInt(brackets.current)<=BigInt(brackets.after));
    const fixedFormula=formula.replace('pg_catalog.clock_timestamp()','boundary.stamp');
    const floors=(await shadow.query<{epoch:string}>(`SELECT (${fixedFormula})::text AS epoch FROM (VALUES
      ('1969-12-31 23:59:59.999999+00'::pg_catalog.timestamptz),('1970-01-01 00:00:00+00'::pg_catalog.timestamptz),
      ('1970-01-01 00:00:00.000999+00'::pg_catalog.timestamptz),('1970-01-01 00:00:00.001+00'::pg_catalog.timestamptz),
      ('2000-01-01 00:00:00.999999+00'::pg_catalog.timestamptz)) AS boundary(stamp)`)).rows;
    assert.deepEqual(floors.map(row=>row.epoch),['-1','0','0','1','946684800999']);await shadow.query('ROLLBACK');
   }finally{await shadow.query('ROLLBACK').catch(()=>undefined);shadow.release();}
   const hostile=await f.pool.connect();
   await hostile.query('SET search_path=h5_entry_clock_shadow,pg_catalog,platform,public');await hostile.query("SET TimeZone='America/Los_Angeles'");hostile.release();
   try{
    const hostileHome=await captureActualSql(f.pool,()=>query.h5Entry({request,input:{view:'home'},bootstrap}));
    assert.deepEqual(hostileHome.connections,[hostile],'initial, shared and final transactions really use the hostile native session');
    assert.deepEqual(hostileHome.result,home,'actual aggregate is independent of session timezone and shadowed clock/floor/operator names');
   }finally{const clean=await f.pool.connect();try{assert.equal(clean,hostile);await clean.query('RESET search_path');await clean.query("SET TimeZone='Asia/Shanghai'");}finally{clean.release();}}
   const report=await query.h5Entry({request,input:{view:'report'},bootstrap});assert.equal(report.data,null);
   const reports=await query.h5Entry({request,input:{view:'reports',search:'absent'},bootstrap});assert.ok(reports.view==='reports');assert.equal(reports.data.reports.items.length,0);
   const mixed=await query.list({request,v2:true,limit:50}),mixedPages:typeof mixed.items=[];let reportCursor:string|null=null;
   do{const page=await query.list({request,v2:true,limit:2,cursor:reportCursor});mixedPages.push(...page.items);reportCursor=page.next_cursor;}while(reportCursor);
   assert.equal(mixed.items.length,5);assert.equal(mixed.items.at(-1)?.ref,botRef);assert.deepEqual(mixedPages,mixed.items,'bounded WEB/BOT candidates preserve same-second kind ordering across page cursors');
   assert.equal((await query.list({request,v2:true,source:'WEB'})).items.length,4);assert.equal((await query.list({request,v2:true,source:'BOT'})).items[0]?.ref,botRef);
   const detail=await query.h5Entry({request,input:{view:'request',request_ref:ref},bootstrap});assert.ok(detail.view==='request');
   assert.equal(detail.data.detail.supplements.length,20);assert.equal(detail.data.detail.supplements[0]?.input_revision,'7');assert.equal(detail.data.detail.supplements.at(-1)?.input_revision,'26');
   assert.ok(detail.data.detail.supplements_cursor);assert.equal(detail.data.timeline.status,'READY');
   if(detail.data.timeline.status==='READY'){assert.equal(detail.data.timeline.data.items.length,20);assert.ok(detail.data.timeline.data.next_cursor);}
   const allEvents=await store.timeline({scope:a,requestRef:ref,limit:100}),pagedEvents:typeof allEvents.items=[];
   let timelineCursor:string|null=null;
   do{const page=await store.timeline({scope:a,requestRef:ref,limit:5,cursor:timelineCursor});pagedEvents.push(...page.items);timelineCursor=page.next_cursor;}while(timelineCursor);
   assert.deepEqual(pagedEvents,allEvents.items,'initial top-N and historical key-only windows preserve page order and public payloads');
   const older=await query.supplements({request,requestRef:ref,cursor:detail.data.detail.supplements_cursor});assert.deepEqual(older.items.map(item=>item.input_revision),['2','3','4','5','6']);assert.equal(older.next_cursor,null);
   const legacy=await query.getWebRequest({request,requestRef:ref,v2:true});assert.equal(legacy.supplements.length,25);assert.equal(Object.hasOwn(legacy,'supplements_cursor'),false);
   const summary=await query.departmentSummary({request}),observedDepartment=await captureActualSql(f.pool,()=>query.h5Entry({request,input:{view:'department'},bootstrap})),department=observedDepartment.result;assert.ok(department.view==='department');
   const departmentSql=observedDepartment.sql.find(sql=>sql.includes('page AS MATERIALIZED(SELECT * FROM reports'));assert.ok(departmentSql);
   assert.equal(departmentSql.includes('platform.physical_epoch_ms()'),false);assert.equal(departmentSql.split('pg_catalog.clock_timestamp()').length-1,6,'page, retained submissions and all source guards still evaluate physical time freshly');
   assert.ok(departmentSql.includes('authorized_source_keys AS MATERIALIZED'));assert.deepEqual(observedDepartment.sql.filter(sql=>localSettings.includes(sql)),localSettings);
   assert.equal(summary.total,2);assert.equal(department.data.department.total,2);assert.equal(summary.membership_revision,department.membership_revision);assert.deepEqual(summary,home.data.department_summary);
   const ownedTicket=department.data.department.items[0];assert.ok(ownedTicket);
   const filteredDepartment=await query.department({request,search:ownedTicket.ticket_no});assert.equal(filteredDepartment.total,1);assert.deepEqual(filteredDepartment.items,[ownedTicket]);
   const openDepartment=await query.department({request,status:'OPEN'});assert.equal(openDepartment.total,2);assert.equal(openDepartment.active_count,2);
   const completedDepartment=await query.department({request,status:'COMPLETED'});assert.equal(completedDepartment.total,0);assert.deepEqual(completedDepartment.items,[]);
   assert.equal(JSON.stringify(department).includes('PEER_PRIVATE_DESCRIPTION_MUST_NOT_LEAK'),false);
   const page=await query.department({request,limit:1});assert.ok(page.next_cursor);
   const raw=JSON.parse(Buffer.from(page.next_cursor.split('.')[0]??'','base64url').toString('utf8')) as Record<string,unknown>;raw.at='2000-01-01 00:00:00';
   const encoded=Buffer.from(JSON.stringify(raw)).toString('base64url'),empty=await query.department({request,limit:1,cursor:encoded+'.'+createHmac('sha256',secret).update(encoded).digest('base64url')});
   assert.equal(empty.items.length,0);assert.equal(empty.total,2);
   const timed=createYxxSelfServiceQuery({...options,store:{...store,async timelineInTransaction(input){await input.transaction.query('SELECT pg_sleep(0.35)');return store.timelineInTransaction(input);}}});
   const slow=await timed.h5Entry({request,input:{view:'request',request_ref:ref},bootstrap});assert.ok(slow.view==='request');assert.deepEqual(slow.data.timeline,{status:'UNAVAILABLE',code:'YXX_UNAVAILABLE'});assert.equal(slow.data.detail.request_ref,ref);
   const broken=createYxxSelfServiceQuery({...options,store:{...store,async timelineInTransaction(input){await input.transaction.query('SELECT 1/0');return store.timelineInTransaction(input);}}});
   await assert.rejects(broken.h5Entry({request,input:{view:'request',request_ref:ref},bootstrap}),{code:'22012'});
   const changed=createYxxSelfServiceQuery({...options,h5MediaEntry:async()=>{readable=false;return [];}});
   await assert.rejects(changed.h5Entry({request,input:{view:'request',request_ref:ref},bootstrap}),{code:'YXX_MEMBER_AUTH_REQUIRED'});readable=true;
   const homeRevoked=createYxxSelfServiceQuery({...options,h5Profile:{...profile,async revalidateInTransaction(tx,currentScope,member){
    await profile.revalidateInTransaction(tx,currentScope,member);readable=false;
   }}});
   await assert.rejects(homeRevoked.h5Entry({request,input:{view:'home'},bootstrap}),{code:'YXX_MEMBER_AUTH_REQUIRED'});readable=true;
   const homeOrgChanged=createYxxSelfServiceQuery({...options,h5Profile:{...profile,async revalidateInTransaction(tx,currentScope,member){
    await f.pool.query("UPDATE directory.member_current SET account_status='UNKNOWN' WHERE provider_user_id='provider-a'");
    await profile.revalidateInTransaction(tx,currentScope,member);
   }}});
   await assert.rejects(homeOrgChanged.h5Entry({request,input:{view:'home'},bootstrap}),{code:'YXX_FORBIDDEN'});
   await f.pool.query("UPDATE directory.member_current SET account_status='ACTIVE' WHERE provider_user_id='provider-a'");
   const orgChanged=createYxxSelfServiceQuery({...options,h5MediaEntry:async()=>{await f.pool.query("UPDATE directory.member_current SET account_status='UNKNOWN' WHERE provider_user_id='provider-a'");return [];}});
   await assert.rejects(orgChanged.h5Entry({request,input:{view:'request',request_ref:ref},bootstrap}),{code:'YXX_FORBIDDEN'});
   await f.pool.query("UPDATE directory.member_current SET account_status='ACTIVE' WHERE provider_user_id='provider-a'");
   const revoked=createYxxSelfServiceQuery({...options,h5MediaEntry:async()=>{await f.pool.query('UPDATE intake.web_request_binding SET revoked_at=platform.local_now() WHERE request_ref=$1',[ref]);return [];}});
   await assert.rejects(revoked.h5Entry({request,input:{view:'request',request_ref:ref},bootstrap}),{code:'YXX_NOT_FOUND'});
  }finally{await query.closeH5Reads();request.destroy();}
 },{ticketReopenRoundsEnabled:true});
});
