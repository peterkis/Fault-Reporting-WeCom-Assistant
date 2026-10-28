import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {withT24Fixture} from './t24-round-notification-fixture.mjs';
import type {T11Fixture} from './t11-completion-fixture.mjs';
import {createYxxDelegatedIdentityMapping} from '../../app/server/src/p2-g2-yixiaoxiu-delegated-identity.mjs';
import {entryConfig,entryKey} from './p2-g2-yixiaoxiu-fixture.mjs';
import {createP2016Runtime} from '../../app/server/src/p2-016-runtime.mjs';
import type {P2016EnabledRuntime} from '../../app/server/src/p2-016-runtime.mjs';
import {closeBrowserTestResources} from './p2-006-browser-harness.mjs';
import {migrateWorkbenchAuth} from '../../app/server/scripts/p2-016-workbench-auth-migrate.mjs';
import {migrateThirdPartyStaffDirectory} from '../../app/server/scripts/p2-007-migrate.mjs';
import {migrateWorkbenchFollowUpSchedules} from '../../app/server/scripts/workbench-follow-up-schedules-migrate.mjs';
import {migrateWorkbenchFollowUpDueSignals} from '../../app/server/scripts/workbench-follow-up-due-migrate.mjs';
import {migrateYxxH5} from '../../app/server/scripts/yxx-h5-migrate.mjs';
import {migrateWorkbenchDisplayMedia} from '../../app/server/scripts/workbench-display-media-migrate.mjs';

export type DetailRestructureFixture=T11Fixture&{botTicketId:string;privateRoot:string;key:Buffer};
export async function withDetailRestructureFixture(run:(context:DetailRestructureFixture)=>Promise<void>,{actorAvatarsEnabled=false,compressionEnabled=false,employeeReadEnabled=false}:{actorAvatarsEnabled?:boolean;compressionEnabled?:boolean;employeeReadEnabled?:boolean}={}){
  await withT24Fixture(async f=>{
    await f.runtime.stop();
    const options={databaseUrl:f.databaseUrl,mode:'apply' as const};
    await migrateWorkbenchAuth(options);await migrateThirdPartyStaffDirectory(options);
    await migrateWorkbenchFollowUpSchedules(options);await migrateWorkbenchFollowUpDueSignals(options);
    await migrateYxxH5({...options,expectedDatabase:new URL(f.databaseUrl).pathname.slice(1),includePreviews:true});
    for(const target of [...(actorAvatarsEnabled?['avatars' as const]:[]),...(compressionEnabled?['media' as const]:[]),...(employeeReadEnabled?['previews' as const]:[])])await migrateWorkbenchDisplayMedia({...options,expectedDatabase:new URL(f.databaseUrl).pathname.slice(1),target});
    const parent=resolve(tmpdir()),privateRoot=await mkdtemp(join(parent,'detail-restructure-')),key=randomBytes(32);
    assert.equal(dirname(privateRoot),parent);
    const config={...entryConfig,identityMode:'VERIFIED_DELEGATED_MAPPING',reporterUserIds:['user-test']};
    const identityMapping=await createYxxDelegatedIdentityMapping({config,accessTokenProvider:async()=> 'SYNTHETIC_DETAIL_TOKEN',fetchImpl:async()=>new Response(JSON.stringify({errcode:0,open_userid_list:[{userid:'user-test',open_userid:'synthetic-open-test'}]}))});
    let runtime:P2016EnabledRuntime|undefined,failure:unknown;
    try{const created=createP2016Runtime({pool:f.pool,publicOrigin:f.origin,listenPort:Number(new URL(f.origin).port),principalIds:[f.principals[0]?.id??'',f.principals[1]?.id??''],workbenchMediaEmployeeReadEnabled:employeeReadEnabled,workbenchActorAvatarsEnabled:actorAvatarsEnabled,
      flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true as const,REPORTER_TIMELINE_ENABLED:true,WECOM_TEMPLATE_CARD_ENABLED:true},externalSendEnabled:false,
      ticketSelfHandlingEnabled:true,ticketStaffCompletionEnabled:true,ticketWaitingActionsEnabled:true,ticketAssignmentEnabled:true,ticketRoundNotificationsEnabled:true,ticketReopenRoundsEnabled:true,workbenchInternalNotesEnabled:true,workbenchDraftRecoveryEnabled:true,
      reporterOrigin:'https://reporter.example.test',reporterHmacSecret:entryKey,reporterPolicy:'MEMBER_REQUIRED',reporterMemberEntry:config,identityMapping,
      yxxSelfService:{featureFlags:{YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true}},yxxH5:{enabled:true,privateRoot,key,workbenchProgressEnabled:true,compressionEnabled},
      wecomWebOAuth:{enabled:true,corpId:entryConfig.corpId,agentId:entryConfig.agentId,resolveCode:async()=>{throw Error('NO_REAL_OAUTH');}}});
    if('disabled' in created)throw Error('DETAIL_FIXTURE_RUNTIME_DISABLED');runtime=created;
    const started=await runtime.start();assert.ok(started.cookies);await run({...f,runtime,botTicketId:f.ticketId,privateRoot,key,cookies:started.cookies.map(cookie=>cookie.name+'='+cookie.value),browserCookies:started.cookies});}
    catch(error){failure=error;}
    await closeBrowserTestResources([async()=>{if(runtime){await runtime.stop();assert.equal(runtime.server.listening,false);}},async()=>{key.fill(0);await rm(privateRoot,{recursive:true,force:true});}],failure);
  },{ticketAssignmentEnabled:true,ticketReopenRoundsEnabled:true,mvpNotificationsEnabled:true});
}
