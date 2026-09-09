import {randomUUID} from 'node:crypto';
import {withP2012Database,applyThrough031} from './p2-012-postgres-harness.mjs';
import {migrateP2012} from '../../scripts/p2-012-migrate.mjs';
import {createPilotAccessService} from '../../src/p1-009-pilot-access-workbench.mjs';
import {createP2012Runtime} from '../../src/p2-012-workbench-assembly.mjs';
import {createP2016OrchestrationWorker} from '../../src/p2-016-orchestration-adapters.mjs';
import {createP2G1HumanOnlyAssembly} from '../../src/p2-g1-human-only-assembly.mjs';
import {createChannelMessageInbox} from '../../src/p1-003-channel-message-inbox.mjs';
import {createP2016DirectIntakeProcessor} from '../../src/p2-016-direct-intake.mjs';

export async function withLateBindingFixture(run){
  await withP2012Database({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'g2bindaudit',run:async({pool,databaseUrl})=>{
    await applyThrough031({pool,databaseUrl});await migrateP2012({databaseUrl});
    const admin=await createPilotAccessService({pool}).upsertPrincipal({wecomUserId:'synthetic-bind-admin',displayName:'模拟坐席',roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});
    const identityHmacKey='synthetic-binding-audit-key',runtime=createP2012Runtime({pool,principalId:admin.id,publicOrigin:'http://127.0.0.1:43129',flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true}});
    const inbox=createChannelMessageInbox({pool}),processor=createP2016DirectIntakeProcessor();
    const assembly=createP2G1HumanOnlyAssembly({operationalIntake:{accept:input=>inbox.accept(input,processor)},projectAfterCommit:false});
    const worker=createP2016OrchestrationWorker({pool,identityHmacKey,notifications:runtime.notifications,realtime:runtime.realtimeProjector});
    const flags={RULE_FIRST_ORCHESTRATION_ENABLED:true,MANUAL_REVIEW_QUEUE_ENABLED:true};
    const submit=(index,chatType='single',text='打印机卡纸')=>assembly.handleFrame({cmd:'aibot_msg_callback',headers:{req_id:randomUUID()},body:{msgid:randomUUID(),aibotid:'synthetic-bind-bot',
      chattype:chatType,...(chatType==='group'?{chatid:'synthetic-bind-group'}:{}),from:{userid:'synthetic-bind-reporter-'+index},msgtype:'text',text:{content:text}}});
    const pump=()=>worker.processDueBatch({feature_flags:flags,now_epoch_ms:String(Date.now()+15000)});
    try{await run({pool,runtime,worker,flags,identityHmacKey,submit,pump});}
    finally{await worker.stop();await runtime.stop();}
  }});
}
