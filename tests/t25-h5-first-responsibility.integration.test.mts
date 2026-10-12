// SOURCE_REGISTERED_NOT_RUN. Run this original tracer before any T25 production change.
import assert from 'node:assert/strict';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withT24Fixture} from './helpers/t24-round-notification-fixture.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';
import {entryConfig,entryKey} from './helpers/p2-g2-yixiaoxiu-fixture.mjs';
import {createYxxSelfServiceAuthorization} from '../src/yxx-self-service-authorization.mjs';
import {createYxxSelfServiceStore} from '../src/yxx-self-service-store.mjs';
import {createPilotTicketCore} from '../src/p1-005-pilot-ticket-core.mjs';
import {createTicketRoundNotifications} from '../src/workbench-ticket-round-notifications.mjs';
import {assertEpochMsString,assertLocalDateTime,formatEpochMsToShanghaiLocal} from '../src/platform/time-contract.mjs';
import type {EligibleTicketAppNotificationTarget,TicketAppNotificationAuthority,TicketAppNotificationOptions,TicketAppNotificationTargetResolver} from '../contracts/workbench_app_notification_contracts.js';

function object(value:unknown):Record<string,unknown>{
  assert.ok(value&&typeof value==='object'&&!Array.isArray(value));
  return value as Record<string,unknown>;
}
function rows(value:unknown):Record<string,unknown>[]{assert.ok(Array.isArray(value));return value.map(object);}

test('an original H5 report creates one pending application FIRST notification after staff accept responsibility',{timeout:240000},async()=>{
  await withT24Fixture(async context=>{
    const memberId='t25-synthetic-internal-member-A';
    const canonicalBinding=createHmac('sha256',entryKey).update(JSON.stringify(['member',entryConfig.corpId,entryConfig.agentId,memberId])).digest('hex');
    const flags={YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true};
    // This is the existing authenticated-scope boundary, with an explicit synthetic member.
    // No OAuth HTTP call, cross-namespace guess, or later rewrite of the original source.
    const authenticate=()=>({profile:'MEMBER_SELF_SERVICE',flags,write_flag:true,canonical_reporter_binding:canonicalBinding,
      source_corp_scope:entryConfig.corpId,source_app_scope:entryConfig.agentId,proof_ref:entryConfig.proofRef});
    const authorization=createYxxSelfServiceAuthorization<Record<string,never>>({profile:'MEMBER_SELF_SERVICE',flags,authenticate,
      recheck:Object.assign(authenticate,{localOnly:true as const})});
    const member=await authorization.authenticate({});assert.ok(member.scope);
    const scope=member.scope;
    const store=createYxxSelfServiceStore({pool:context.pool,scopeSecret:entryKey});
    const accepted=await store.accept({scope,input:{schema_version:1,client_command_id:randomUUID(),description:'T25 全新合成 H5 故障，请协助处理。',
      location:{text:'合成位置',unknown:false},service_code:null,impact_scope:'SELF',reported_department_text:null,extension:null}});
    assert.equal(accepted.receipt.status,'ACCEPTED');
    // Fixture arrangement only: locate the real Store-created Intake for the public Core command.
    // No fixture INSERT/UPDATE creates a cycle, event, source binding, message or Delivery.
    const located=await context.pool.query<{intake_id:string}>(
      'SELECT intake_id::text FROM intake.web_request_binding WHERE request_ref=$1',[accepted.receipt.request_ref]);
    assert.equal(located.rowCount,1);const intake=located.rows[0];assert.ok(intake);
    const created=await createPilotTicketCore({pool:context.pool}).createForIntake({intakeId:intake.intake_id,
      occurredAt:assertLocalDateTime(accepted.receipt.accepted_at),traceId:'t25-h5-first-tracer'});
    assert.ok(created.ticket);const ticketId=created.ticket.id;
    assert.equal((await store.getRequest({scope,requestRef:accepted.receipt.request_ref})).source_kind,'WEB_REQUEST');
    const http=await t11Http(context),started=await http.start(ticketId);
    assert.equal(started.status,'IN_PROGRESS');assert.equal(started.handling_cycle?.cycle_no,1);
    assert.ok(started.handling_cycle?.first_responsibility_event_id,'staff HTTP must establish the real first-responsibility basis');
    const readDeliveries=async()=>{
      const response=await http.get('/api/tickets/'+ticketId+'/deliveries');assert.equal(response.status,200);
      const body:unknown=await response.json();return object(body);
    };
    assert.deepEqual(rows((await readDeliveries()).items),[],'fixture precondition: H5 has no pre-existing intent');
    const authority:TicketAppNotificationAuthority={sourceCorpScope:entryConfig.corpId,sourceAppScope:entryConfig.agentId,
      channelAccountId:'t25-synthetic-app-account',mappingConfigHash:createHash('sha256').update('t25-synthetic-current-mapping').digest('hex'),
      mappingProofRef:entryConfig.proofRef,proofKind:'SYNTHETIC',validationProfile:'ISOLATED_TEST'};
    const resolver:TicketAppNotificationTargetResolver={localOnly:true,async resolveCurrentTarget(input){
      assert.equal(input.source_kind,'WEB_REQUEST');assert.deepEqual(input.scope,scope);
      assert.ok(input.signal instanceof AbortSignal);assert.equal(input.signal.aborted,false);
      const checked=assertEpochMsString(String(Date.now()));
      const result:EligibleTicketAppNotificationTarget={schema_version:1,state:'ELIGIBLE',source_kind:'WEB_REQUEST',scope,
        checked_at:formatEpochMsToShanghaiLocal(checked),checked_at_epoch_ms:checked,
        target:{provider:'WECOM_APP',channel_account_id:authority.channelAccountId,target_type:'PERSON',target_id:memberId},
        verification:{mapping_config_hash:authority.mappingConfigHash,mapping_proof_ref:authority.mappingProofRef,
          binding_proof_ref:scope.proofRef,proof_kind:'SYNTHETIC',account_status:'ACTIVE',binding_state:'VERIFIED',message_reachability:'REACHABLE'}};
      return result;
    }};
    const appNotifications:TicketAppNotificationOptions={enabled:true,authority,targetResolver:resolver};
    // The variable intentionally adds the frozen T25 options to the existing public boundary.
    // Structural typing does not claim the current factory recognizes or implements them.
    const options:Parameters<typeof createTicketRoundNotifications>[0]&{appNotifications:TicketAppNotificationOptions}={
      pool:context.pool,enabled:true,botId:entryConfig.botId,reporterAccess:context.runtime.reporterAccess,appNotifications};
    const worker=createTicketRoundNotifications(options);
    await worker.runOnce();
    const deliveries=await readDeliveries();
    assert.deepEqual(rows(deliveries.items).map(item=>({node:item.node,cycle_no:item.cycle_no,route_kind:item.route_kind,
      destination_type:item.destination_type,status:item.status,attempt_count:item.attempt_count,side_effect_state:item.side_effect_state,sent_at:item.sent_at})),[
      {node:'FIRST_RESPONSIBILITY',cycle_no:1,route_kind:'YIXIAOXIU_APP',destination_type:'PERSON',status:'PENDING',attempt_count:0,side_effect_state:'NOT_ATTEMPTED',sent_at:null},
    ],'T25 first seam: original H5 must expose one real application Delivery');
    const delivery=rows(deliveries.items)[0];assert.ok(delivery);assert.equal(typeof delivery.delivery_id,'string');
    const serialized=JSON.stringify(deliveries);
    for(const privateValue of [memberId,canonicalBinding,authority.channelAccountId,authority.mappingConfigHash,authority.mappingProofRef]){
      assert.equal(serialized.includes(privateValue),false,'public Delivery excludes private target/authority');
    }
    await worker.runOnce();assert.deepEqual(await readDeliveries(),deliveries,'same first milestone replay retains the original Delivery');
    assert.deepEqual(await http.detail(ticketId),started,'notification consumption does not mutate Ticket facts');
    assert.equal((await store.getRequest({scope,requestRef:accepted.receipt.request_ref})).source_kind,'WEB_REQUEST');
  },{manualRoundConsumption:true});
});
