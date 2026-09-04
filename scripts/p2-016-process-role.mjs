import { pathToFileURL } from 'node:url';
import { runApp,runGateway,runWorker } from './p2-g1-process-role.mjs';
import { createP2016Runtime } from '../src/p2-016-runtime.mjs';
import { createP2016ReporterAccess } from '../src/p2-016-reporter-access.mjs';
import { createP2016TicketNotificationProjector } from '../src/p2-016-ticket-notification-projector.mjs';
import { createP2016RealtimeProjector } from '../src/p2-016-realtime-projector.mjs';
import { createP2016OrchestrationWorker } from '../src/p2-016-orchestration-adapters.mjs';
import { createP2016WeComSender } from '../src/p2-016-wecom-sender.mjs';
import { createP2016InboundScope } from '../src/p2-016-inbound-scope.mjs';
import { createChannelMessageInbox } from '../src/p1-003-channel-message-inbox.mjs';
import { createServiceIntakeProcessor } from '../src/p1-004-service-intake.mjs';
import { createTicketClosureService } from '../src/p1-010-ticket-closure.mjs';
import { createTicketActionService } from '../src/p1-006-ticket-state-actions.mjs';
import { P2016_LIVE_FUSES,P2016_TEST_FLAGS } from '../src/p2-016-live-configuration.mjs';

const access=pool=>createP2016ReporterAccess({pool,enabled:true,hmacSecret:process.env.P2_016_REPORTER_HMAC_SECRET});
export async function main(argv=process.argv.slice(2)){
  if(typeof process.send!=='function'||argv.length!==1||!['--role=app','--role=worker','--role=gateway'].includes(argv[0]))throw new Error('P2_016_ROLE_INVALID');
  if((process.env.P2_G1_GATEWAY_ENABLED==='true'||process.env.P2_G1_SENDER_ENABLED==='true')&&P2016_LIVE_FUSES.some(k=>process.env[k]!=='true')&&argv[0]==='--role=gateway')throw new Error('P2_016_LIVE_APPROVAL_REQUIRED');
  if(argv[0]==='--role=app')return runApp({runtimeFactory:options=>createP2016Runtime({...options,flags:P2016_TEST_FLAGS,
    reporterOrigin:process.env.P2_016_REPORTER_ORIGIN,reporterHmacSecret:process.env.P2_016_REPORTER_HMAC_SECRET,
    allowedHosts:process.env.P2_016_REPORTER_ALLOWED_HOSTS.split(',')})});
  if(argv[0]==='--role=gateway')return runGateway({
    intakeFactory:({pool})=>{
      const scope=createP2016InboundScope({bot_id:process.env.WECOM_BOT_ID,person_hashes:process.env.P2_016_TEST_USER_TARGET_HASHES.split(','),group_hashes:process.env.P2_016_TEST_GROUP_TARGET_HASHES.split(',')});
      const inbox=createChannelMessageInbox({pool}),processor=createServiceIntakeProcessor();
      return {accept:input=>scope.accepts(input.message)?inbox.accept(input,processor):Promise.resolve({ok:false,error:{code:'P2_016_INBOUND_SCOPE_REJECTED',retryable:false}})};
    },
    senderFactory:({pool,...options})=>createP2016WeComSender({...options,cardEnabled:true,reporterAccess:access(pool),
      origin:process.env.P2_016_REPORTER_ORIGIN,allowedHosts:process.env.P2_016_REPORTER_ALLOWED_HOSTS.split(',')}),
  });
  return runWorker({extensionFactory:({pool})=>{
    const notifications=createP2016TicketNotificationProjector({enabled:true,cardEnabled:true,reporterAccess:access(pool)});
    const realtime=createP2016RealtimeProjector({pool,enabled:true});
    const orchestrator=createP2016OrchestrationWorker({pool,notifications,realtime,identityHmacKey:process.env.PILOT_LOG_IDENTITY_HASH_KEY});
    const closure=createTicketClosureService({pool,beforeTransaction:realtime.lock,resolveReporterActor:async()=>null,outbox:{enqueueTicketEvent:async input=>{
      const n=await notifications.project(input);await realtime.ticket(input);return {...n,delivery_ids:n.delivery_id?[n.delivery_id]:[]};
    }}});
    const actions=createTicketActionService({pool,authorize:async({actor,action})=>actor.type==='SYSTEM'&&action==='auto-close',afterAction:closure.afterTicketAction});
    return {runOnce:async()=>{
      await orchestrator.processDueBatch({feature_flags:{RULE_FIRST_ORCHESTRATION_ENABLED:true,MANUAL_REVIEW_QUEUE_ENABLED:true},batch_size:20});
      await closure.runAutoCloseReminders({limit:20});await closure.runAutoClose({actionService:actions,limit:20});await realtime.runOnce();
    }};
  }});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main().catch(()=>{
  process.send?.({type:'role-failed',role:process.argv[2]?.slice(7).toUpperCase(),error_code:'P2_016_PROCESS_FAILED'});process.exitCode=1;
});
