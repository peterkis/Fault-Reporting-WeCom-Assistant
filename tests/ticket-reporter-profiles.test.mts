import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {PostgresPool,PostgresTransaction,PostgresQueryRow} from '../app/server/src/platform/postgres-pool.mjs';
import type {ReporterDirectoryPort} from '../contracts/p2_015_contracts.js';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {createWorkbenchReporterDirectory} from '../app/server/src/workbench-reporter-directory.mjs';
import {reporterIdentityHash} from '../app/server/src/p2-015-contact-journey.mjs';
import {createTicketReporterProfileWorker,readTicketReporterProfiles,ticketReporterProfilesSchemaReady} from '../app/server/src/ticket-reporter-profiles.mjs';
import {migrateTicketReporterProfiles} from '../app/server/scripts/ticket-reporter-profiles-migrate.mjs';
import {createP2016TicketQuery} from '../app/server/src/p2-016-ticket-query.mjs';
import {createWeb01WorkbenchQuery} from '../app/server/src/web01-workbench-query.mjs';

const key='web01-only-synthetic-identity-key',botId='bot-test',sender='user-test';
const input={source:'WECOM_DIRECTORY',source_provider:'WECOM_AIBOT',source_namespace:'WECOM_AIBOT',bot_id:botId,reporter_external_id:sender,
 reporter_identity_hash:reporterIdentityHash({provider:'WECOM_AIBOT',bot_id:botId,reporter_external_id:sender,hmac_key:key})};
const snapshot=(name='补全合成报修人')=>({source:'WECOM_DIRECTORY',version:'test/1',contact:{name},memberships:[{name:'合成信息科',role:'MEMBER'}],fetched_at:'2036-01-01 08:00:00'});
interface Fixture {pool:PostgresPool;databaseUrl:string;databaseName:string;origin:string;cookies:string[];principals:{id:string}[];tickets:{ticket:{id:string};intake:{intakeId:string}}[]}
const worker=(pool:PostgresPool,directoryPort:ReporterDirectoryPort)=>createTicketReporterProfileWorker({pool,botId,identityHmacKey:key,directoryPort,enabled:true});
async function clock(pool:PostgresPool,epoch:number){
 assert.ok(Number.isSafeInteger(epoch));
 // Only this isolated synthetic database's clock is moved; source rows and immutable snapshots stay intact.
 await pool.query(`CREATE OR REPLACE FUNCTION platform.physical_epoch_ms() RETURNS bigint LANGUAGE sql VOLATILE AS 'SELECT ${epoch}::bigint'`);
 await pool.query(`CREATE OR REPLACE FUNCTION platform.local_now() RETURNS timestamp without time zone LANGUAGE sql STABLE AS 'SELECT platform.local_from_epoch_ms(${epoch}::bigint)'`);
}
async function installed(run:(fixture:Fixture)=>Promise<void>){await withWeb01Fixture(async(f:Fixture)=>{
 await migrateTicketReporterProfiles({databaseUrl:f.databaseUrl,expectedDatabase:f.databaseName,mode:'apply'});await run(f);
});}

test('Bot directory converts the exact source identity and only retains name and department',async()=>{
 const paths:string[]=[];let foreign=false;
 const fetchImpl:typeof fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));assert.equal(url.origin,'https://qyapi.weixin.qq.com');assert.equal(init?.redirect,'error');assert.ok(init?.signal);paths.push(url.pathname);
  if(url.pathname.endsWith('/userid_to_openuserid')){assert.deepEqual(JSON.parse(String(init?.body)),{userid_list:[sender]});return Response.json({errcode:0,open_userid_list:[{userid:foreign?'other':sender,open_userid:'open-synthetic'}]});}
  if(url.pathname.endsWith('/user/get')){assert.equal(url.searchParams.get('userid'),'open-synthetic');return Response.json({errcode:0,userid:'open-synthetic',status:1,enable:1,name:'合成报修人',department:[7],main_department:7,mobile:'must-not-store'});}
  assert.equal(url.pathname,'/cgi-bin/department/get');return Response.json({errcode:0,department:{id:7,name:'合成科室'}});
 };
 const directory=createWorkbenchReporterDirectory({botId,identityHmacKey:key,accessTokenProvider:async()=> 'test-token',fetchImpl});
 const result=await directory.resolve(input);assert.equal(result.status,'RESOLVED');assert.deepEqual(result.snapshot.contact,{name:'合成报修人'});
 assert.deepEqual(result.snapshot.memberships,[{name:'合成科室',role:'MEMBER'}]);assert.equal(JSON.stringify(result).includes('must-not-store'),false);assert.equal(JSON.stringify(result).includes('open-synthetic'),false);
 assert.deepEqual(paths,['/cgi-bin/batch/userid_to_openuserid','/cgi-bin/user/get','/cgi-bin/department/get']);
 for(const altered of [{...input,bot_id:'other-bot'},{...input,source_namespace:'APP_OPEN_USERID'},{...input,reporter_identity_hash:'0'.repeat(64)}])assert.equal((await directory.resolve(altered)).status,'NOT_FOUND');
 assert.equal(paths.length,3);foreign=true;assert.equal((await directory.resolve(input)).status,'NOT_FOUND');assert.equal(paths.length,4);
});

test('a late personnel Provider cannot release the actual directory slot at its caller deadline',{timeout:7000},async()=>{
 let calls=0,settle:((r:Response)=>void)|undefined;
 const directory=createWorkbenchReporterDirectory({botId,identityHmacKey:key,accessTokenProvider:async()=> 'test-token',fetchImpl:async()=>{calls++;return new Promise<Response>(resolve=>{settle=resolve;});}});
 const first=await directory.resolve(input);assert.equal(first.status,'DEFERRED');assert.equal((await directory.resolve(input)).status,'DEFERRED');assert.equal(calls,1);
 assert.ok(settle);settle(Response.json({errcode:0,open_userid_list:[]}));await new Promise<void>(resolve=>setImmediate(resolve));
});

test('067 checks the exact database and rejects unreceipted or damaged schema',async()=>{
 await withWeb01Fixture(async(f:Fixture)=>{
  assert.equal(await ticketReporterProfilesSchemaReady(f.pool),false);
  await assert.rejects(migrateTicketReporterProfiles({databaseUrl:f.databaseUrl,expectedDatabase:'wrong',mode:'apply'}),/MIGRATION_INVALID/u);
  assert.equal((await migrateTicketReporterProfiles({databaseUrl:f.databaseUrl,expectedDatabase:f.databaseName})).status,'PENDING');
  assert.equal((await migrateTicketReporterProfiles({databaseUrl:f.databaseUrl,expectedDatabase:f.databaseName,mode:'apply'})).status,'APPLIED');
  assert.equal((await migrateTicketReporterProfiles({databaseUrl:f.databaseUrl,expectedDatabase:f.databaseName,mode:'apply'})).status,'NOOP_ALREADY_APPLIED');
  await f.pool.query('DROP TRIGGER ticket_reporter_profile_source_immutable ON intake.ticket_reporter_profile');
  assert.equal(await ticketReporterProfilesSchemaReady(f.pool),false);
  await assert.rejects(migrateTicketReporterProfiles({databaseUrl:f.databaseUrl,expectedDatabase:f.databaseName,mode:'apply'}),/MIGRATION_INVALID/u);
 });
});

test('deferred Bot details recover after restart and remain authorized years after source expiry and Ticket closure',async()=>{
 await installed(async f=>{
  const ticket=f.tickets[0],principal=f.principals[0];assert.ok(ticket&&principal);const id=ticket.ticket.id;
  const original=(await f.pool.query('SELECT profile_snapshot,profile_snapshot_hash FROM intake.contact_journey WHERE origin_intake_id=$1',[ticket.intake.intakeId])).rows[0];
  const epoch=Date.UTC(2036,0,1);await clock(f.pool,epoch);let calls=0;
  const port:ReporterDirectoryPort={resolve:async()=>++calls===1?{status:'DEFERRED',snapshot:{}}:{status:'RESOLVED',snapshot:snapshot()}};
  await worker(f.pool,port).runOnce();assert.equal(calls,1);
  await worker(f.pool,port).runOnce();assert.equal(calls,1,'restart preserves the next attempt time');
  await clock(f.pool,epoch+600000);await worker(f.pool,port).runOnce();assert.equal(calls,2);
  let retained=(await readTicketReporterProfiles(f.pool,[id])).get(id);assert.ok(retained);assert.equal(retained.name,'补全合成报修人');assert.equal(retained.department,'合成信息科');assert.equal(retained.source,'LATER_LOOKUP');
  assert.deepEqual((await f.pool.query('SELECT profile_snapshot,profile_snapshot_hash FROM intake.contact_journey WHERE origin_intake_id=$1',[ticket.intake.intakeId])).rows[0],original);
  const query=createP2016TicketQuery({pool:f.pool,enabled:true,workbenchReporterProfilesEnabled:true}),cards=createWeb01WorkbenchQuery({pool:f.pool,query,reporterProfilesEnabled:true});
  const authContext={principal_id:principal.id};
  let detail=await cards.detail({authContext,kind:'ticket',id,cursor:null,limit:10});assert.equal(detail.item.reporter_name,retained.name);assert.equal(detail.item.source,'WECOM_GROUP');
  await f.pool.query("UPDATE pilot_ticket.ticket SET status='CLOSED' WHERE id=$1",[id]);
  await clock(f.pool,Date.UTC(2046,0,1));await worker(f.pool,port).runOnce();assert.equal(calls,2,'completed material is not reacquired or cleared');
  retained=(await readTicketReporterProfiles(f.pool,[id])).get(id);assert.equal(retained?.name,'补全合成报修人');
  detail=await cards.detail({authContext,kind:'ticket',id,cursor:null,limit:10});assert.equal(detail.item.reporter_department,'合成信息科');
  const contact=await query.reporterContact({authContext,ticketId:id});assert.ok('retained_profile' in contact);
  assert.deepEqual(contact.retained_profile,{name:'补全合成报修人',department:'合成信息科',captured_at:'2036-01-01 08:00:00',source:'LATER_LOOKUP'});
  await f.pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=false WHERE id=$1',[principal.id]);
  await assert.rejects(cards.detail({authContext,kind:'ticket',id,cursor:null,limit:10}),/FORBIDDEN/u);
  await assert.rejects(query.reporterContact({authContext,ticketId:id}),/FORBIDDEN/u);
 });
});

test('manual Ticket name, department and source persist without retaining contact numbers or requesting a Provider',async()=>{
 await withWeb01Fixture(async(f:Fixture)=>{
  await migrateTicketReporterProfiles({databaseUrl:f.databaseUrl,expectedDatabase:f.databaseName,mode:'apply'});
  const cookie=f.cookies[0];assert.ok(cookie);
  const response=await fetch(f.origin+'/api/lifecycle/bootstrap',{headers:{cookie}}),bootstrap:unknown=await response.json();
  assert.ok(bootstrap&&typeof bootstrap==='object'&&'csrf_token' in bootstrap&&typeof bootstrap.csrf_token==='string');
  const command={schema_version:1,client_command_id:randomUUID(),source:'PHONE',description:'合成电话故障',location:{text:null,unknown:true},reporter:{verification:'UNVERIFIED',name:'永久合成报修人',contact:'合成内线不可复制',department:'永久合成科室'}};
  const admitted=await fetch(f.origin+'/api/workbench/reports',{method:'POST',headers:{cookie,origin:f.origin,'content-type':'application/json','idempotency-key':command.client_command_id,'x-csrf-token':bootstrap.csrf_token},body:JSON.stringify(command)});
  assert.equal(admitted.status,202);await admitted.arrayBuffer();
  const ticket=(await f.pool.query<{id:string}>("SELECT t.id::text FROM pilot_ticket.ticket t JOIN intake.service_intake i ON i.id=t.source_intake_id WHERE i.source_provider='STAFF_MANUAL_REPORT'")).rows[0];assert.ok(ticket);
  let calls=0;const run=worker(f.pool,{resolve:async()=>{calls++;return {status:'DEFERRED',snapshot:{}};}});
  await run.runOnce();assert.equal(calls,0);
  await f.pool.query("UPDATE pilot_ticket.ticket SET status='CLOSED' WHERE id=$1",[ticket.id]);await clock(f.pool,Date.UTC(2046,0,1));
  const retained=(await readTicketReporterProfiles(f.pool,[ticket.id])).get(ticket.id);assert.ok(retained);
  assert.equal(retained.name,'永久合成报修人（身份未核实）');assert.equal(retained.department,'永久合成科室');assert.equal(retained.source_channel,'MANUAL');assert.equal(retained.source_label,'电话代录');
  assert.equal(JSON.stringify((await f.pool.query('SELECT * FROM intake.ticket_reporter_profile WHERE ticket_id=$1',[ticket.id])).rows).includes('合成内线不可复制'),false);
 },{workbenchManualReportsEnabled:true});
});

test('retained profile reads recheck current READ after the database wait, including an empty profile',async()=>{
 await installed(async f=>{
  const ticket=f.tickets[0],principal=f.principals[0];assert.ok(ticket&&principal);
  const id=ticket.ticket.id,authContext={principal_id:principal.id};let revoke=false,source=false;
  const delayed:PostgresTransaction={async query<R extends PostgresQueryRow=Record<string,unknown>>(sql:string,values?:unknown[]){
   const result=await f.pool.query<R>(sql,values);
   if(revoke&&sql.includes(source?'FROM intake.channel_leg l':'FROM intake.ticket_reporter_profile p')){revoke=false;await f.pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=false WHERE id=$1',[principal.id]);}
   return result;
  }};
  const query=createP2016TicketQuery({pool:delayed,enabled:true,workbenchReporterProfilesEnabled:true});
  source=true;revoke=true;await assert.rejects(createP2016TicketQuery({pool:delayed,enabled:true}).reporterContact({authContext,ticketId:id}),/FORBIDDEN/u);
  await f.pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=true WHERE id=$1',[principal.id]);source=false;
  revoke=true;await assert.rejects(query.reporterContact({authContext,ticketId:id}),/FORBIDDEN/u);
  await f.pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=true WHERE id=$1',[principal.id]);
  await clock(f.pool,Date.UTC(2036,0,1));await worker(f.pool,{resolve:async()=>({status:'RESOLVED',snapshot:snapshot()})}).runOnce();
  revoke=true;await assert.rejects(createWeb01WorkbenchQuery({pool:delayed,query,reporterProfilesEnabled:true}).detail({authContext,kind:'ticket',id,cursor:null,limit:10}),/FORBIDDEN/u);
 });
});

test('persistent attempt limits and claim tokens fence restarts and stale profile completions',async()=>{
 await installed(async f=>{
  const ticket=f.tickets[0];assert.ok(ticket);const id=ticket.ticket.id,epoch=Date.UTC(2036,0,1);await clock(f.pool,epoch);
  let enteredResolve:(()=>void)|undefined,settle:((v:Awaited<ReturnType<ReporterDirectoryPort['resolve']>>)=>void)|undefined;
  const entered=new Promise<void>(resolve=>{enteredResolve=resolve;});
  const old=worker(f.pool,{resolve:async()=>{enteredResolve?.();return new Promise(resolve=>{settle=resolve;});}}).runOnce();
  await entered;await clock(f.pool,epoch+600000);
  try{
   await worker(f.pool,{resolve:async()=>({status:'RESOLVED',snapshot:snapshot('新领取结果')})}).runOnce();
  }finally{settle?.({status:'RESOLVED',snapshot:snapshot('迟到结果')});await old;}
  assert.equal((await readTicketReporterProfiles(f.pool,[id])).get(id)?.name,'新领取结果');
  await f.pool.query("UPDATE intake.ticket_reporter_profile SET state='PARTIAL',reporter_department=NULL,attempts=7,next_attempt_epoch_ms=0 WHERE ticket_id=$1",[id]);
  let calls=0;const unavailable:ReporterDirectoryPort={resolve:async()=>{calls++;return {status:'DEFERRED',snapshot:{}};}};
  await worker(f.pool,unavailable).runOnce();await clock(f.pool,Date.UTC(2046,0,1));await worker(f.pool,unavailable).runOnce();
  assert.equal(calls,1);const row=(await f.pool.query<{attempts:number;state:string}>('SELECT attempts,state FROM intake.ticket_reporter_profile WHERE ticket_id=$1',[id])).rows[0];
  assert.deepEqual(row,{attempts:8,state:'UNAVAILABLE'});assert.equal((await readTicketReporterProfiles(f.pool,[id])).get(id)?.name,'新领取结果');
 });
});
