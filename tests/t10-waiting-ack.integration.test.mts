import {setTimeout as delay} from 'node:timers/promises';
import {createP2G1TestAuthentication} from '../app/server/src/p2-g1-test-authentication.mjs';
import {createPilotAccessService} from '../app/server/src/p1-009-pilot-access-workbench.mjs';
import {formatEpochMsToShanghaiLocal} from '../app/server/src/platform/time-contract.mjs';
import type {PostgresPool} from '../app/server/src/platform/postgres-pool.mjs';
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
      const closed=await http.post(target.ticket.id,'cancel',{client_command_id:randomUUID(),expected_version:before.version,reason_code:'OTHER',note:'回执终检（合成）'});
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
