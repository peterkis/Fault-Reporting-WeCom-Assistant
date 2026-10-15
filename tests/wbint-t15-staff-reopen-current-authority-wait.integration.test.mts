// SOURCE PROPOSAL / NOT_RUN. Future placement: tests/; register only in the
// granted T15 WHOLE after the immutable original HTTP tracer reaches GREEN.
// Public seam: existing W Cookie Ticket reopen + official current Access service.
// The isolated Ticket lock is only a timing gate, never a replacement command.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {withT11Fixture,t11Http,t11NewTicket} from './helpers/t11-completion-fixture.mjs';
import {createP2016Runtime} from '../src/p2-016-runtime.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';

interface Identity {wecom_user_id:string;display_name:string;team_ids:string[]}
function object(value:unknown):Record<string,unknown>{
  assert.ok(value&&typeof value==='object'&&!Array.isArray(value));
  return value as Record<string,unknown>;
}

test('STAFF_REOPEN rejects a role revoked while its original command waits for the current Ticket row',
  {timeout:240000},async()=>{
  await withT11Fixture(async context=>{
    await context.runtime.stop();
    const runtime=createP2016Runtime({pool:context.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},
      publicOrigin:context.origin,listenPort:Number(new URL(context.origin).port),
      principalIds:[context.principals[0]?.id??'',context.outsider.id,context.principals[1]?.id??''],
      externalSendEnabled:false,ticketSelfHandlingEnabled:true,ticketStaffCompletionEnabled:true,
      ticketReopenRoundsEnabled:true,workbenchDraftRecoveryEnabled:false});
    if('disabled' in runtime)throw Error('T15_REOPEN_RUNTIME_DISABLED');
    try{
      const started=await runtime.start();assert.ok(started.cookies);
      const current={...context,runtime,cookies:started.cookies.map(cookie=>cookie.name+'='+cookie.value)};
      const handler=await t11Http(current,2),administrator=await t11Http(current,0);
      const bootstrap=await handler.get('/api/lifecycle/bootstrap');assert.equal(bootstrap.status,200);
      assert.deepEqual(object(await bootstrap.json()).roles,['HANDLER']);
      const actor=context.principals[1];assert.ok(actor);
      const ticketId=await t11NewTicket(current),active=await handler.start(ticketId);
      const complete=await handler.post(ticketId,'complete',handler.command(active));
      assert.equal(complete.status,200,await complete.clone().text());
      const closed=await handler.detail(ticketId);
      assert.equal(closed.status,'CLOSED');assert.equal(closed.assignee_id,actor.id);
      assert.ok(closed.handling_cycle?.staff_completion_event_id);
      assert.ok(closed.allowed_actions.includes('reopen'),'real current staff purpose before the wait');
      const command={client_command_id:randomUUID(),expected_version:closed.version,
        reason_code:'STAFF_REOPEN',note:'INTERNAL_T15_ROLE_WAIT：工作人员在锁等待中失去原操作角色'};
      const path='/api/tickets/'+ticketId,receiptPath=path+'/reopen/commands/'+command.client_command_id;
      const unknown=await handler.get(receiptPath);assert.equal(unknown.status,200);
      assert.deepEqual(await unknown.json(),{client_command_id:command.client_command_id,ticket_id:ticketId,state:'UNKNOWN'});
      const snapshot=async()=>({ticket:await administrator.detail(ticketId),
        events:await (await administrator.get(path+'/events')).json() as unknown,
        responsibility:await (await administrator.get(path+'/responsibility')).json() as unknown});
      const before=await snapshot();
      const identity=(await context.pool.query<Identity>(`SELECT p.wecom_user_id,p.display_name,
        COALESCE(array_agg(m.team_id ORDER BY m.team_id) FILTER(WHERE m.team_id IS NOT NULL),'{}') AS team_ids
        FROM pilot_ticket.pilot_principal p LEFT JOIN pilot_ticket.pilot_team_member m ON m.principal_id=p.id
        WHERE p.id=$1::uuid GROUP BY p.id,p.wecom_user_id,p.display_name`,[actor.id])).rows[0];assert.ok(identity);
      const access=createPilotAccessService({pool:context.pool});
      const gate=await context.pool.connect();let held=false,roleChanged=false,pending:Promise<Response>|undefined;
      try{
        await gate.query('BEGIN');held=true;
        assert.equal((await gate.query('SELECT id FROM pilot_ticket.ticket WHERE id=$1::uuid FOR NO KEY UPDATE',[ticketId])).rowCount,1);
        const blocker=(await gate.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid;assert.ok(blocker);
        pending=handler.post(ticketId,'reopen',command);void pending.catch(()=>undefined);
        let blocked=false;const until=performance.now()+5000;
        do{
          const waiting=await context.pool.query<{query:string}>(`SELECT query FROM pg_stat_activity
            WHERE datname=current_database() AND wait_event_type='Lock' AND $1::integer=ANY(pg_blocking_pids(pid))
            AND query LIKE 'SELECT%pilot_ticket.ticket t%FOR UPDATE OF t'`,[blocker]);
          if(waiting.rowCount===1){blocked=true;break;}await delay(10);
        }while(performance.now()<until);
        assert.equal(blocked,true,'this actual HTTP command has passed initial authorization and is waiting at its Ticket row');
        // Official role update; keep active identity and original team membership.
        // REPORTER is not a Workbench staff grant, and no Reporter feedback is called.
        const changed=await access.upsertPrincipal({wecomUserId:identity.wecom_user_id,displayName:identity.display_name,
          roles:['REPORTER'],resolverTeamIds:identity.team_ids});
        assert.equal(changed.id,actor.id);roleChanged=true;
        const roles=await context.pool.query<{role:string}>('SELECT role FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid ORDER BY role',[actor.id]);
        assert.deepEqual(roles.rows.map(row=>row.role),['REPORTER']);
        await gate.query('COMMIT');held=false;
        const response=await pending;
        console.log('T15_STAFF_REOPEN_ROLE_WAIT '+JSON.stringify({status:response.status,body:await response.clone().json(),
          command_id:command.client_command_id,role_removed_before_ticket_release:true}));
        assert.equal(response.status,403,'old HANDLER authorization must not survive the row wait');
        assert.deepEqual(await snapshot(),before,'no reopened round, Ticket version or append event on current-purpose rejection');
        // Existing owned ledger diagnostic, not a new receipt source or API.
        // A lawful durable FAILED rejection may exist; a COMMITTED ACK may not.
        const committed=await context.pool.query<{n:number}>(`SELECT count(*)::int AS n FROM pilot_ticket.ticket_command_receipt
          WHERE command_scope=$1 AND client_command_id=$2::uuid AND ticket_id=$3::uuid
            AND command_type='reopen' AND state='COMMITTED'`,['P2_016:'+actor.id,command.client_command_id,ticketId]);
        assert.equal(committed.rows[0]?.n,0);
        assert.ok(!(await response.text()).includes('INTERNAL_T15_ROLE_WAIT'));
      }finally{
        if(held)await gate.query('ROLLBACK');
        await pending?.catch(()=>undefined);gate.release();
        if(roleChanged)await access.upsertPrincipal({wecomUserId:identity.wecom_user_id,displayName:identity.display_name,
          roles:['HANDLER'],resolverTeamIds:identity.team_ids});
      }
    }finally{await runtime.stop();assert.equal(runtime.server.listening,false);}
  });
});
