import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
import {t31Http,record,text} from './helpers/t31-public-progress-fixture.mjs';
import {withT26Fixture,t26Group,t26Object} from './helpers/t26-group-notification-fixture.mjs';
import {closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

async function observeWait(pool:PostgresPool,pid:number){
 for(let attempt=0;attempt<100;attempt++){
  const result=await pool.query<{query:string}>("SELECT query FROM pg_stat_activity WHERE datname=current_database() AND $1::integer=ANY(pg_blocking_pids(pid)) AND wait_event_type='Lock'",[pid]);
  if(result.rows[0])return result.rows[0].query;
  await delay(30);
 }
 assert.fail('the real public command must reach the owned lock after entry authorization');
}
async function configure(pool:PostgresPool,id:string,roles:('ADMIN'|'HANDLER')[]){
 const principal=(await pool.query<{wecom_user_id:string;display_name:string}>('SELECT wecom_user_id,display_name FROM pilot_ticket.pilot_principal WHERE id=$1::uuid',[id])).rows[0];assert.ok(principal);
 const updated=await createPilotAccessService({pool}).upsertPrincipal({wecomUserId:principal.wecom_user_id,displayName:principal.display_name,roles,resolverTeamIds:['PILOT_IT']});assert.equal(updated.id,id);
}

for(const purpose of ['internal-notes','public-progress'] as const)test('ALL43 Incident '+purpose+' rechecks caller purpose after a real parent wait',{timeout:120000},async()=>{
 await t31Http({purpose:'all43incidentwait',notes:true,publication:true},async({pool,f,confirm,post,get})=>{
  const id=await confirm(),path='/api/incidents/'+id,actor=text(record(f.admin).id),base={client_command_id:randomUUID(),expected_row_version:'1'},command=purpose==='internal-notes'?{...base,reason_code:'WORKBENCH_INTERNAL_DISPOSITION',audience:'INTERNAL',text:'仅供最终审查竞争回归的独立合成正文'}:{...base,reason_code:'WORKBENCH_PUBLIC_PROGRESS',summary:'最终审查竞争回归的独立合成公开摘要',preview_confirmed:true};
  const before=(await get(path)).body,events=(await pool.query('SELECT * FROM incident.incident_event WHERE incident_id=$1::uuid ORDER BY event_ordinal',[id])).rows;
  const blocker=await pool.connect();let open=false,pending:ReturnType<typeof post>|undefined,primary:unknown;
  try{
   await blocker.query('BEGIN');open=true;await blocker.query('SELECT id FROM incident.incident WHERE id=$1::uuid FOR UPDATE',[id]);
   const pid=(await blocker.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid;assert.ok(pid);
   pending=post(path+'/'+(purpose==='internal-notes'?purpose:'publish-update'),command);const waitingQuery=await observeWait(pool,pid);assert.match(waitingQuery,/incident\.(?:command_receipt|incident)/u);
   await configure(pool,actor,['HANDLER']);assert.equal((await get('/api/lifecycle/bootstrap')).status,200);assert.equal((await get(path)).status,200);
   await blocker.query('COMMIT');open=false;const response=await pending;
   console.log('ALL43_INCIDENT_CURRENT_ACTOR '+JSON.stringify({purpose,wait_observed:true,official_role_change_committed:true,status:response.status,error:response.body.error??null}));
   assert.equal(response.status,403,'loss of the exact write purpose while waiting must reject');
   assert.equal((await get(path)).body.row_version,before.row_version);
   assert.deepEqual((await pool.query('SELECT * FROM incident.incident_event WHERE incident_id=$1::uuid ORDER BY event_ordinal',[id])).rows,events);
   assert.equal((await pool.query("SELECT 1 FROM communication.incident_notification_binding WHERE incident_id=$1::uuid AND template_code='INCIDENT_PUBLIC_PROGRESS_DIRECT'",[id])).rowCount,0);
  }catch(error){primary=error;}
  await closeBrowserTestResources([async()=>{if(open)await blocker.query('ROLLBACK');},()=>blocker.release(),async()=>{await pending;}],primary);
 });
});

test('ALL43 source-group NAME wait and stored-command replay both require current ADMIN',{timeout:240000},async()=>{
 await withT26Fixture(async context=>{
  const source=await t26Group(context,'all43-admin-wait'),response=await source.http.get('/api/workbench/items/ticket/'+source.id);assert.equal(response.status,200);
  const group=t26Object(t26Object(t26Object(await response.json()).item).source_group),ref=text(group.ref),actor=context.principals[0]?.id,cookie=context.cookies[0];assert.ok(actor&&cookie);
  const boot=t26Object(await (await source.http.get('/api/lifecycle/bootstrap')).json()),path=context.origin+'/api/workbench/source-groups/'+ref+'/name';
  const post=(body:{client_command_id:string;expected_row_version:string;display_name:string})=>fetch(path,{method:'POST',headers:{cookie,origin:context.origin,'content-type':'application/json','x-csrf-token':text(boot.csrf_token),'idempotency-key':body.client_command_id,'if-match':'"'+body.expected_row_version+'"'},body:JSON.stringify(body)});
  for(const phase of ['NAME','COMMAND_REPLAY'] as const){
   const command={client_command_id:randomUUID(),expected_row_version:'0',display_name:'最终审查合成登记名称'};
   if(phase==='COMMAND_REPLAY'){const saved=await post(command);assert.equal(saved.status,200);await saved.json();}
   const before=(await context.pool.query('SELECT * FROM workbench.source_group_name ORDER BY ref')).rows,changes=(await context.pool.query('SELECT * FROM workbench.source_group_name_change ORDER BY id')).rows;
   const blocker=await context.pool.connect();let open=false,pending:Promise<Response>|undefined,primary:unknown;
   try{
    await blocker.query('BEGIN');open=true;await blocker.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[phase==='NAME'?'SOURCE_GROUP_NAME:'+ref:'SOURCE_GROUP_COMMAND:'+actor+':'+command.client_command_id]);
    const pid=(await blocker.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid;assert.ok(pid);
    pending=post(command);assert.match(await observeWait(context.pool,pid),/pg_advisory_xact_lock/u);await configure(context.pool,actor,['HANDLER']);
    await blocker.query('COMMIT');open=false;const result=await pending;await result.json();
    console.log('ALL43_SOURCE_GROUP_CURRENT_ADMIN '+JSON.stringify({phase,status:result.status,official_role_change_committed:true}));
    assert.equal(result.status,403,'a stale ADMIN cannot write or read back a stored privileged result');
    assert.deepEqual((await context.pool.query('SELECT * FROM workbench.source_group_name ORDER BY ref')).rows,before);
    assert.deepEqual((await context.pool.query('SELECT * FROM workbench.source_group_name_change ORDER BY id')).rows,changes);
   }catch(error){primary=error;}
   await closeBrowserTestResources([async()=>{if(open)await blocker.query('ROLLBACK');},()=>blocker.release(),async()=>{await pending;},()=>configure(context.pool,actor,['ADMIN'])],primary);
  }
 },{sourceGroups:true});
});
