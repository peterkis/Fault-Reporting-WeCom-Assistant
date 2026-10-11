import assert from 'node:assert/strict';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import type {T11Fixture} from './t11-completion-fixture.mjs';
import {t11Http} from './t11-completion-fixture.mjs';
import {entryConfig,entryKey} from './p2-g2-yixiaoxiu-fixture.mjs';
import {createYxxSelfServiceAuthorization} from '../../src/yxx-self-service-authorization.mjs';
import {createYxxSelfServiceStore} from '../../src/yxx-self-service-store.mjs';
import {createPilotTicketCore} from '../../src/p1-005-pilot-ticket-core.mjs';
import {createTicketRoundNotifications} from '../../src/workbench-ticket-round-notifications.mjs';
import {assertLocalDateTime,assertEpochMsString,formatEpochMsToShanghaiLocal} from '../../src/platform/time-contract.mjs';
import type {TicketAppNotificationAuthority,EligibleTicketAppNotificationTarget,TicketAppNotificationOptions,TicketAppNotificationTargetResolver} from '../../contracts/workbench_app_notification_contracts.js';

/** Real original Web Store/Core/staff HTTP and round Port; only the configured local identity authority is synthetic. */
export async function t25WebOrigin(context:T11Fixture,{memberId='T25_SYNTHETIC_INTERNAL_MEMBER_A',start=true}:{memberId?:string;start?:boolean}={}){
 const flags={YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true};
 const canonical=createHmac('sha256',entryKey).update(JSON.stringify(['member',entryConfig.corpId,entryConfig.agentId,memberId])).digest('hex');
 const authenticate=()=>({profile:'MEMBER_SELF_SERVICE',flags,write_flag:true,canonical_reporter_binding:canonical,source_corp_scope:entryConfig.corpId,source_app_scope:entryConfig.agentId,proof_ref:entryConfig.proofRef});
 const authorization=createYxxSelfServiceAuthorization<Record<string,never>>({profile:'MEMBER_SELF_SERVICE',flags,authenticate,recheck:Object.assign(authenticate,{localOnly:true as const})});
 const member=await authorization.authenticate({});assert.ok(member.scope);const scope=member.scope,store=createYxxSelfServiceStore({pool:context.pool,scopeSecret:entryKey});
 const accepted=await store.accept({scope,input:{schema_version:1,client_command_id:randomUUID(),description:'T25_PRIVATE_REPORT：合成打印机无法打印，请协助处理。',location:{text:'合成门诊',unknown:false},service_code:null,impact_scope:'SELF',reported_department_text:null,extension:null}});
 const intake=(await context.pool.query<{intake_id:string}>('SELECT intake_id::text FROM intake.web_request_binding WHERE request_ref=$1',[accepted.receipt.request_ref])).rows[0];assert.ok(intake);
 const created=await createPilotTicketCore({pool:context.pool}).createForIntake({intakeId:intake.intake_id,occurredAt:assertLocalDateTime(accepted.receipt.accepted_at),traceId:'t25-real-web-origin'});assert.ok(created.ticket);
 const ticketId=created.ticket.id,http=await t11Http(context),started=start?await http.start(ticketId):await http.detail(ticketId);
 const authority:TicketAppNotificationAuthority={sourceCorpScope:entryConfig.corpId,sourceAppScope:entryConfig.agentId,channelAccountId:'T25_SYNTHETIC_APP_ACCOUNT',mappingConfigHash:createHash('sha256').update('T25_CURRENT_SYNTHETIC_MAPPING').digest('hex'),mappingProofRef:entryConfig.proofRef,proofKind:'SYNTHETIC',validationProfile:'ISOLATED_TEST'};
 const resolver:TicketAppNotificationTargetResolver={localOnly:true,async resolveCurrentTarget(input){
  assert.equal(input.source_kind,'WEB_REQUEST');assert.deepEqual(input.scope,scope);input.signal.throwIfAborted();const checked=assertEpochMsString(String(Date.now()));
  const result:EligibleTicketAppNotificationTarget={schema_version:1,state:'ELIGIBLE',source_kind:'WEB_REQUEST',scope,checked_at:formatEpochMsToShanghaiLocal(checked),checked_at_epoch_ms:checked,
   target:{provider:'WECOM_APP',channel_account_id:authority.channelAccountId,target_type:'PERSON',target_id:memberId},verification:{mapping_config_hash:authority.mappingConfigHash,mapping_proof_ref:authority.mappingProofRef,binding_proof_ref:scope.proofRef,proof_kind:'SYNTHETIC',account_status:'ACTIVE',binding_state:'VERIFIED',message_reachability:'REACHABLE'}};return result;
 }};
 const appNotifications:TicketAppNotificationOptions={enabled:true,authority,targetResolver:resolver};
 const round=createTicketRoundNotifications({pool:context.pool,enabled:true,botId:entryConfig.botId,reporterAccess:context.runtime.reporterAccess,appNotifications});
 return {memberId,scope,store,requestRef:accepted.receipt.request_ref,intakeId:intake.intake_id,ticketId,http,started,authority,appNotifications,round};
}
export function t25Object(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
export async function t25Deliveries(http:Awaited<ReturnType<typeof t11Http>>,ticketId:string){const response=await http.get('/api/tickets/'+ticketId+'/deliveries');assert.equal(response.status,200);const data=t25Object(await response.json());assert.ok(Array.isArray(data.items));return data.items.map(t25Object);}
