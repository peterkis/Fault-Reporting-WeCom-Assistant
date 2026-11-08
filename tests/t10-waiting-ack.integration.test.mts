import {seedPersistedIntake} from './helpers/p2-015-postgres-harness.mjs';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {setTimeout as delay} from 'node:timers/promises';
import {createP2G1TestAuthentication} from '../app/server/src/p2-g1-test-authentication.mjs';
import {createPilotAccessService} from '../app/server/src/p1-009-pilot-access-workbench.mjs';
import {formatEpochMsToShanghaiLocal} from '../app/server/src/platform/time-contract.mjs';
import {createPostgresClient,type PostgresPool} from '../app/server/src/platform/postgres-pool.mjs';
import type {G1AuthenticationPort} from '../app/server/src/p2-g1-runtime.mjs';
import {closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withT10Fixture} from './helpers/t10-waiting-fixture.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';
import {createP2016Runtime} from '../app/server/src/p2-016-runtime.mjs';

test('original waiting ACK is a minimal current Ticket READ independent of write and raw recovery capabilities',async()=>{
  await withT10Fixture(async context=>{
    const handler=await t11Http(context,2,{closeConnections:true}),target=context.tickets[0];assert.ok(target);
    const current=await handler.start(target.ticket.id),command={client_command_id:randomUUID(),expected_version:current.version,reason_code:'WAITING_REPORTER',note:'INTERNAL_T10_ACK_CANARY：原等待正文仅在内部。',external_visible:false};
    const posted=await handler.post(target.ticket.id,'request-information',command);assert.equal(posted.status,200);
    const result=await posted.json() as {ticket_version:number;ticket_event_id:string};
    const path='/api/tickets/'+target.ticket.id,ack=path+'/request-information/commands/'+command.client_command_id;
    const counts=async()=>(await context.pool.query('SELECT (SELECT count(*)::integer FROM pilot_ticket.ticket_command_receipt) AS receipts,(SELECT count(*)::integer FROM pilot_ticket.ticket_event) AS events,(SELECT count(*)::integer FROM communication.delivery) AS deliveries')).rows;
    const before=await counts(),response=await handler.get(ack);assert.equal(response.status,200,'the current original actor must reach the dedicated safe ACK');
    const expected={state:'COMMITTED',ticket_id:target.ticket.id,ticket_version:result.ticket_version,ticket_event_id:result.ticket_event_id};assert.deepEqual(await response.json(),expected);
    assert.deepEqual(await (await handler.get(path+'/wait-vendor/commands/'+command.client_command_id)).json(),{state:'UNKNOWN'},'a different action purpose cannot borrow this receipt');
    const other=await t11Http(context,0,{closeConnections:true});assert.deepEqual(await (await other.get(ack)).json(),{state:'UNKNOWN'},'another readable actor cannot inspect the original operation');
    console.log('T10_ACK_STAGE '+JSON.stringify({stage:'ORIGINAL_ACK_AND_PURPOSE_ACTOR_CHECKS',pass:true}));
    await context.runtime.stop();
    const runtime=createP2016Runtime({pool:context.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:context.origin,listenPort:Number(new URL(context.origin).port),principalIds:[context.principals[0]?.id??'',context.outsider.id,context.principals[1]?.id??''],externalSendEnabled:false,ticketSelfHandlingEnabled:true,ticketWaitingActionsEnabled:false,workbenchInternalNotesEnabled:false,workbenchDraftRecoveryEnabled:false});
    try{
      const started=await runtime.start();assert.ok(started.cookies);
      console.log('T10_ACK_STAGE '+JSON.stringify({stage:'CLOSED_HOST_STARTED',listening:runtime.server.listening,port:Number(new URL(context.origin).port)}));
      const read=await t11Http({...context,runtime,cookies:started.cookies.map(cookie=>cookie.name+'='+cookie.value)},2,{closeConnections:true});
      console.log('T10_ACK_STAGE '+JSON.stringify({stage:'CLOSED_AUTH_BOOTSTRAP_READ',pass:true}));
      const bootstrap=await (await read.get('/api/lifecycle/bootstrap')).json() as {ticket_waiting_actions_enabled:boolean;ticket_waiting_action_draft_recovery_enabled:boolean};assert.equal(bootstrap.ticket_waiting_actions_enabled,false);assert.equal(bootstrap.ticket_waiting_action_draft_recovery_enabled,false);
      const recovered=await read.get(ack);assert.equal(recovered.status,200);assert.deepEqual(await recovered.json(),expected);assert.deepEqual(await counts(),before);
      assert.ok(!JSON.stringify(expected).includes('INTERNAL_T10_ACK_CANARY'));
    }finally{await runtime.stop();assert.equal(runtime.server.listening,false);}
  });
});

async function observeRestoreReceiptWait(pool:PostgresPool,blockerPid:number){
  for(let attempt=0;attempt<200;attempt++){
    const waiting=await pool.query<{query:string}>(`SELECT query FROM pg_stat_activity
      WHERE datname=current_database() AND wait_event_type='Lock' AND $1::integer=ANY(pg_blocking_pids(pid))
        AND strpos(query,'SELECT state,result_ticket_version AS version')>0
        AND strpos(query,'FROM pilot_ticket.ticket_command_receipt WHERE command_scope')>0`,[blockerPid]);
    if(waiting.rows[0])return;
    await delay(25);
  }
  assert.fail('the genuine restore receipt SELECT did not reach the owned table lock after initial READ');
}

test('Card 27C-A restore ACK rechecks current READ and absolute TTL after its receipt SELECT for every safe state',{timeout:240000},async t=>{
  await withT10Fixture(async context=>{
    await context.runtime.stop();
    const principalIds=[context.principals[0]?.id??'',context.outsider.id,context.principals[1]?.id??''];
    const originalAuthentication=createP2G1TestAuthentication({pool:context.pool,principalIds,publicOrigin:context.origin});
    let expiry:string|null=null;
    const workbenchAuthentication:G1AuthenticationPort={browserCookies:originalAuthentication.browserCookies,authenticate:async request=>{
      const auth=await originalAuthentication.authenticate(request);
      return auth&&expiry!==null?{...auth,expires_epoch_ms:expiry,expires_at:formatEpochMsToShanghaiLocal(expiry)}:auth;
    }};
    const runtime=createP2016Runtime({pool:context.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:context.origin,
      listenPort:Number(new URL(context.origin).port),principalIds,workbenchAuthentication,externalSendEnabled:false,
      ticketSelfHandlingEnabled:true,ticketWaitingActionsEnabled:true});
    try{
      const started=await runtime.start();assert.ok(started.cookies);
      const http=await t11Http({...context,runtime,cookies:started.cookies.map(cookie=>cookie.name+'='+cookie.value)},2,{closeConnections:true});
      const target=context.tickets[0],actor=context.principals[1]?.id;assert.ok(target&&actor);
      const before=await http.detail(target.ticket.id);assert.equal(before.assignee_id,null,'only current team membership grants this actor Ticket READ');
      const closed=await http.post(target.ticket.id,'dismiss',{client_command_id:randomUUID(),expected_version:before.version,reason_code:'OTHER',note:'回执终检（合成）'});
      assert.equal(closed.status,200);await closed.json();
      const current=await http.detail(target.ticket.id),restoredId=randomUUID();
      const restored=await http.post(target.ticket.id,'restore',{client_command_id:restoredId,expected_version:current.version,reason_code:'RESTORE_CLOSED'});
      assert.equal(restored.status,200);await restored.json();
      const failedId=randomUUID(),failed=await http.post(target.ticket.id,'restore',{client_command_id:failedId,expected_version:current.version,reason_code:'RESTORE_CLOSED'});
      assert.equal(failed.status,409);await failed.json();
      const original=(await context.pool.query<{wecom_user_id:string;display_name:string}>('SELECT wecom_user_id,display_name FROM pilot_ticket.pilot_principal WHERE id=$1::uuid',[actor])).rows[0];assert.ok(original);
      const setTeams=async(resolverTeamIds:string[])=>{const changed=await createPilotAccessService({pool:context.pool}).upsertPrincipal({wecomUserId:original.wecom_user_id,displayName:original.display_name,roles:['HANDLER'],resolverTeamIds});assert.equal(changed.id,actor);};
      const cases=[{state:'COMMITTED',id:restoredId},{state:'FAILED',id:failedId},{state:'UNKNOWN',id:randomUUID()}];
      for(const loss of ['TEAM','TTL'] as const)for(const receipt of cases)await t.test(loss+' / '+receipt.state,async()=>{
        const path='/api/tickets/'+target.ticket.id+'/restore/commands/'+receipt.id,initial=await http.get(path);assert.equal(initial.status,200);
        const body=await initial.json() as {state:string};assert.equal(body.state,receipt.state);
        const counts=async()=>(await context.pool.query('SELECT (SELECT count(*)::integer FROM pilot_ticket.ticket_command_receipt) AS receipts,(SELECT count(*)::integer FROM pilot_ticket.ticket_event) AS events')).rows;
        const baseline=await counts(),blocker=await context.pool.connect();let open=false,pending:Promise<Response>|undefined,primary:unknown;
        try{
          await blocker.query('BEGIN');open=true;await blocker.query('LOCK TABLE pilot_ticket.ticket_command_receipt IN ACCESS EXCLUSIVE MODE');
          const pid=(await blocker.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid;assert.ok(pid);
          if(loss==='TTL')expiry=String(Date.now()+4000);
          pending=http.get(path);await observeRestoreReceiptWait(context.pool,pid);
          if(loss==='TEAM')await setTeams([]);
          else{
            assert.ok(expiry);assert.ok(BigInt(expiry)>BigInt(Date.now()),'the request passed initial authentication and reached the real SELECT while unexpired');
            let expired=false;
            for(let attempt=0;attempt<240;attempt++){
              const clock=(await context.pool.query<{expired:boolean}>('SELECT platform.physical_epoch_ms()>=$1::bigint AS expired',[expiry])).rows[0];
              if(clock?.expired&&BigInt(Date.now())>=BigInt(expiry)){expired=true;break;}
              await delay(25);
            }
            assert.equal(expired,true,'release follows actual physical expiry, without changing the clock or bypassing the original deadline');
          }
          await blocker.query('COMMIT');open=false;
          const response=await pending;assert.equal(response.status,loss==='TEAM'?404:403);
          const denied=await response.json() as Record<string,unknown>;assert.equal(Object.hasOwn(denied,'state'),false);assert.equal(Object.hasOwn(denied,'ticket_event_id'),false);
          assert.deepEqual(await counts(),baseline,'safe receipt reads and rejected final checks create no business facts');
        }catch(error){primary=error;}
        await closeBrowserTestResources([async()=>{if(open)await blocker.query('ROLLBACK');},()=>blocker.release(),async()=>{await pending;},async()=>{expiry=null;if(loss==='TEAM')await setTeams(['PILOT_IT']);}],primary);
      });
    }finally{expiry=null;await runtime.stop();assert.equal(runtime.server.listening,false);}
  });
});

async function observeClosureReadWait(pool:PostgresPool,pid:number,fragment:string,count=1){
  for(let attempt=0;attempt<200;attempt++){
    const waiting=await pool.query<{n:number}>(`SELECT count(*)::integer AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND $1::integer=ANY(pg_blocking_pids(pid)) AND strpos(query,$2)>0`,[pid,fragment]);
    if(waiting.rows[0]?.n===count)return;
    await delay(25);
  }
  assert.fail('every actual data SELECT must be waiting after successful authentication');
}

interface ClosureCookieFixture {
  pool:PostgresPool;databaseUrl:string;origin:string;backendOrigin?:string;cookies:string[];sessionId?:string;
  principals:{id:string}[];tickets:{ticket:{id:string}}[];waiting:{intakeId:string};
}
function cookieObject(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function cookieVersion(value:unknown):number{assert.ok(typeof value==='number');assert.ok(Number.isSafeInteger(value));return value;}

for(const purpose of ['ticket-restore','intake-close','intake-restore','intake-context','ticket-history','intake-history'] as const)test('Card 27C-A real Cookie '+purpose+' rejects official logout during its actual read wait',{timeout:240000},async t=>{
  await withWeb01Fixture(async(f:ClosureCookieFixture)=>{
    assert.ok(f.sessionId);const principal=f.principals[0];assert.ok(principal);
    const request=(path:string,init:RequestInit={})=>{const headers=new Headers(init.headers);headers.set('cookie',f.cookies[0]??'');headers.set('connection','close');return fetch((f.backendOrigin??f.origin)+path,{...init,headers,signal:AbortSignal.timeout(20000)});};
    const read=async(path:string)=>{const response=await request(path);assert.equal(response.status,200,await response.clone().text());return cookieObject(await response.json());};
    const bootstrap=await read('/api/lifecycle/bootstrap');assert.equal(typeof bootstrap.csrf_token,'string');
    const post=async(path:string,body:{client_command_id:string;expected_version:number;reason_code:string;note?:string},status=200)=>{
      const response=await request(path,{method:'POST',headers:{origin:f.origin,'content-type':'application/json','x-csrf-token':String(bootstrap.csrf_token),'idempotency-key':body.client_command_id,'if-match':'"'+body.expected_version+'"'},body:JSON.stringify(body)});
      assert.equal(response.status,status,await response.clone().text());return cookieObject(await response.json());
    };
    let paths:{state:string;path:string}[]=[];
    if(purpose==='ticket-restore'||purpose==='ticket-history'){
      const target=f.tickets[0];assert.ok(target);const path='/api/tickets/'+target.ticket.id,before=await read(path);
      await post(path+'/dismiss',{client_command_id:randomUUID(),expected_version:cookieVersion(before.version),reason_code:'OTHER',note:'Cookie当前会话回执（合成）'});
      const closed=await read(path),committed=randomUUID();await post(path+'/restore',{client_command_id:committed,expected_version:cookieVersion(closed.version),reason_code:'RESTORE_CLOSED'});
      const failed=randomUUID();await post(path+'/restore',{client_command_id:failed,expected_version:cookieVersion(closed.version),reason_code:'RESTORE_CLOSED'},409);
      paths=purpose==='ticket-history'?[{state:'HISTORY',path:path+'/closure-history'}]:[{state:'COMMITTED',path:path+'/restore/commands/'+committed},{state:'FAILED',path:path+'/restore/commands/'+failed},{state:'UNKNOWN',path:path+'/restore/commands/'+randomUUID()}];
    }else{
      const path='/api/intakes/'+f.waiting.intakeId,before=await read(path+'/closure-context'),closedId=randomUUID();
      await post(path+'/close',{client_command_id:closedId,expected_version:cookieVersion(before.version),reason_code:'OTHER',note:'Cookie当前受理读取（合成）'});
      const closed=await read(path+'/closure-context');assert.equal(typeof closed.closure_id,'string');
      if(purpose==='intake-history')paths=[{state:'HISTORY',path:path+'/closure-history'}];
      else if(purpose==='intake-context')paths=[{state:'CONTEXT',path:path+'/closure-context'}];
      else if(purpose==='intake-close'){
        const failed=randomUUID();await post(path+'/close',{client_command_id:failed,expected_version:cookieVersion(before.version),reason_code:'OTHER',note:'过期版本关闭（合成）'},409);
        paths=[{state:'COMMITTED',path:path+'/close/commands/'+closedId},{state:'FAILED',path:path+'/close/commands/'+failed},{state:'UNKNOWN',path:path+'/close/commands/'+randomUUID()}];
      }else{
        const restoredId=randomUUID();await post(path+'/restore',{client_command_id:restoredId,expected_version:cookieVersion(closed.version),reason_code:'RESTORE_CLOSED'});
        const failed=randomUUID();await post(path+'/restore',{client_command_id:failed,expected_version:cookieVersion(closed.version),reason_code:'RESTORE_CLOSED'},409);
        paths=[{state:'COMMITTED',path:path+'/restore/commands/'+restoredId},{state:'FAILED',path:path+'/restore/commands/'+failed},{state:'UNKNOWN',path:path+'/restore/commands/'+randomUUID()}];
      }
    }
    for(const item of paths){const initial=await read(item.path);if(item.state==='HISTORY'){assert.ok(Array.isArray(initial.items));assert.equal(initial.items.length,1);}else if(item.state==='CONTEXT'){assert.equal(typeof initial.closure_id,'string');assert.equal(typeof initial.version,'number');}else assert.equal(initial.state,item.state);}
    const authority=async()=>(await f.pool.query('SELECT p.id::text,p.is_active,array_agg(DISTINCT r.role ORDER BY r.role) AS roles,array_agg(DISTINCT m.team_id ORDER BY m.team_id) AS teams FROM pilot_ticket.pilot_principal p LEFT JOIN pilot_ticket.pilot_principal_role r ON r.principal_id=p.id LEFT JOIN pilot_ticket.pilot_team_member m ON m.principal_id=p.id WHERE p.id=$1::uuid GROUP BY p.id,p.is_active',[principal.id])).rows;
    const counts=async()=>(await f.pool.query('SELECT (SELECT count(*)::integer FROM pilot_ticket.ticket_command_receipt) AS receipts,(SELECT count(*)::integer FROM pilot_ticket.ticket_event) AS events,(SELECT count(*)::integer FROM pilot_ticket.closure_record) AS closures')).rows;
    const originalAuthority=await authority(),originalCounts=await counts();
    // Three independent real GET transactions use the fixture's four-slot pool;
    // the dedicated existing Client keeps one pool slot available for logout/observation.
    const gate=createPostgresClient({connectionString:f.databaseUrl,connectionTimeoutMillis:5000,application_name:'p2_015_ack_cookie_gate'});
    let held=false,primary:unknown;const pending:Promise<Response>[]=[];
    try{
      await gate.connect();await gate.query('BEGIN');held=true;
      await gate.query(purpose==='intake-context'||purpose.endsWith('-history')?'LOCK TABLE pilot_ticket.closure_record IN ACCESS EXCLUSIVE MODE':'LOCK TABLE pilot_ticket.ticket_command_receipt IN ACCESS EXCLUSIVE MODE');
      const pid=(await gate.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid;assert.ok(pid);
      for(const item of paths){const response=request(item.path);void response.catch(()=>undefined);pending.push(response);}
      const fragment=purpose.endsWith('-history')?'SELECT c.id::text,c.before_version':purpose==='intake-context'?'SELECT id::text FROM pilot_ticket.closure_record WHERE intake_id':purpose==='ticket-restore'?'SELECT state,result_ticket_version AS version':'SELECT state,result_snapshot,error_code,retryable FROM pilot_ticket.ticket_command_receipt';
      await observeClosureReadWait(f.pool,pid,fragment,paths.length);
      const logout=await request('/workbench/logout',{method:'POST',headers:{origin:f.origin,'x-csrf-token':String(bootstrap.csrf_token)}});assert.equal(logout.status,200);assert.deepEqual(await logout.json(),{logged_out:true});
      const session=(await f.pool.query<{state:string;unexpired:boolean}>('SELECT state,expires_epoch_ms>platform.physical_epoch_ms() AS unexpired FROM pilot_ticket.workbench_auth_session WHERE session_id=$1::uuid',[f.sessionId])).rows[0];assert.ok(session);assert.equal(session.state,'REVOKED');assert.equal(session.unexpired,true);
      assert.deepEqual(await authority(),originalAuthority,'logout invalidates the stored session without changing Principal role or team authority');
      await gate.query('COMMIT');held=false;
      for(const [index,item] of paths.entries())await t.test(item.state,async()=>{
        const response=await pending[index];assert.ok(response);assert.equal(response.status,401,await response.clone().text());const denied=cookieObject(await response.json());assert.equal(cookieObject(denied.error).code,'WORKBENCH_UNAUTHENTICATED');
        for(const key of ['state','result','version','closure_id','subject_id','ticket_version','ticket_event_id','pending_review','items','restore_target'])assert.equal(Object.hasOwn(denied,key),false,'revoked Cookie cannot receive '+key);
      });
      assert.deepEqual(await counts(),originalCounts,'the read/logout sequence cannot create or change Ticket/closure/receipt facts');
    }catch(error){primary=error;}
    await closeBrowserTestResources([async()=>{if(held)await gate.query('ROLLBACK');},async()=>{await Promise.allSettled(pending);},async()=>{await gate.end();}],primary);
  },{realWorkbenchAuthentication:true});
});


test('Card 27C-A Intake close restore ACK and context reject physical expiry in the existing nonpersistent auth profile',{timeout:240000},async t=>{
  await withWeb01Fixture(async(f:ClosureCookieFixture&{runtime:ReturnType<typeof createP2016Runtime>;outsider:{id:string}})=>{
    await f.runtime.stop();const principalIds=[f.principals[0]?.id??'',f.outsider.id,f.principals[1]?.id??''];
    const originalAuthentication=createP2G1TestAuthentication({pool:f.pool,principalIds,publicOrigin:f.origin});let expiry:string|null=null;
    const workbenchAuthentication:G1AuthenticationPort={browserCookies:originalAuthentication.browserCookies,authenticate:async request=>{
      const auth=await originalAuthentication.authenticate(request);return auth&&expiry!==null?{...auth,expires_epoch_ms:expiry,expires_at:formatEpochMsToShanghaiLocal(expiry)}:auth;
    }};
    const runtime=createP2016Runtime({pool:f.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:f.origin,listenPort:Number(new URL(f.origin).port),principalIds,workbenchAuthentication,externalSendEnabled:false});
    try{
      const started=await runtime.start();assert.ok(started.cookies);const cookie=started.cookies[0];assert.ok(cookie);
      const request=(path:string,init:RequestInit={})=>{const headers=new Headers(init.headers);headers.set('cookie',cookie.name+'='+cookie.value);headers.set('connection','close');return fetch(f.origin+path,{...init,headers,signal:AbortSignal.timeout(20000)});};
      const read=async(path:string)=>{const response=await request(path);assert.equal(response.status,200,await response.clone().text());return cookieObject(await response.json());};
      const bootstrap=await read('/api/lifecycle/bootstrap');assert.equal(typeof bootstrap.csrf_token,'string');
      const post=async(path:string,body:{client_command_id:string;expected_version:number;reason_code:string;note?:string})=>{
        const response=await request(path,{method:'POST',headers:{origin:f.origin,'content-type':'application/json','x-csrf-token':String(bootstrap.csrf_token),'idempotency-key':body.client_command_id,'if-match':'"'+body.expected_version+'"'},body:JSON.stringify(body)});assert.equal(response.status,200,await response.clone().text());await response.json();
      };
      for(const purpose of ['close','restore','context'] as const)await t.test(purpose,async()=>{
        expiry=null;
        const seed=await seedPersistedIntake({pool:f.pool,text:'静态认证寿命关闭读取（合成）',status:'WAITING_DESCRIPTION'}),path='/api/intakes/'+seed.intakeId;
        const before=await read(path+'/closure-context'),closeId=randomUUID();await post(path+'/close',{client_command_id:closeId,expected_version:cookieVersion(before.version),reason_code:'OTHER',note:'绝对寿命终检（合成）'});
        let readPath=path+'/close/commands/'+closeId;
        if(purpose==='restore'){const closed=await read(path+'/closure-context'),restoreId=randomUUID();await post(path+'/restore',{client_command_id:restoreId,expected_version:cookieVersion(closed.version),reason_code:'RESTORE_CLOSED'});readPath=path+'/restore/commands/'+restoreId;}
        if(purpose==='context')readPath=path+'/closure-context';
        const initial=await read(readPath);if(purpose==='context')assert.equal(typeof initial.closure_id,'string');else assert.equal(initial.state,'COMMITTED');
        const gate=await f.pool.connect();let held=false,pending:Promise<Response>|undefined,primary:unknown;
        try{
          await gate.query('BEGIN');held=true;await gate.query(purpose==='context'?'LOCK TABLE pilot_ticket.closure_record IN ACCESS EXCLUSIVE MODE':'LOCK TABLE pilot_ticket.ticket_command_receipt IN ACCESS EXCLUSIVE MODE');
          const pid=(await gate.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid;assert.ok(pid);
          expiry=String(Date.now()+4000);pending=request(readPath);void pending.catch(()=>undefined);
          await observeClosureReadWait(f.pool,pid,purpose==='context'?'SELECT id::text FROM pilot_ticket.closure_record WHERE intake_id':'SELECT state,result_snapshot,error_code,retryable FROM pilot_ticket.ticket_command_receipt');
          assert.ok(BigInt(expiry)>BigInt(Date.now()),'the real read passed initial authentication and reached its SELECT before the original TTL elapsed');
          let expired=false;for(let attempt=0;attempt<240;attempt++){
            const time=(await f.pool.query<{expired:boolean}>('SELECT platform.physical_epoch_ms()>=$1::bigint AS expired',[expiry])).rows[0];if(time?.expired&&BigInt(Date.now())>=BigInt(expiry)){expired=true;break;}await delay(25);
          }
          assert.equal(expired,true);await gate.query('COMMIT');held=false;
          const response=await pending;assert.equal(response.status,403,await response.clone().text());const denied=cookieObject(await response.json());assert.equal(cookieObject(denied.error).code,'P2_016_FORBIDDEN');
          for(const key of ['state','result','version','closure_id','pending_review'])assert.equal(Object.hasOwn(denied,key),false);
        }catch(error){primary=error;}
        await closeBrowserTestResources([async()=>{if(held)await gate.query('ROLLBACK');},()=>gate.release(),async()=>{await pending;},()=>{expiry=null;}],primary);
      });
    }finally{expiry=null;await runtime.stop();assert.equal(runtime.server.listening,false);}
  });
});
