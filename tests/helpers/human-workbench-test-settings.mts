import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {entryConfig,entryKey} from './p2-g2-yixiaoxiu-fixture.mjs';
import {yxxIdentityConfigHash} from '../../app/server/src/p2-g2-yixiaoxiu-delegated-identity.mjs';
import type {WorkbenchSettings} from '../../app/server/src/human-workbench-configuration.mjs';
import {validateYxxEntryConfig} from '../../app/server/src/p2-g2-yixiaoxiu-contract.mjs';
export const hashTarget=(v:string)=>createHash('sha256').update(v).digest('hex');
export function workbenchTestSettings(directory:string,listenPort=43166){
 const memberEntry=validateYxxEntryConfig({...entryConfig,identityMode:'VERIFIED_DELEGATED_MAPPING',reporterUserIds:['synthetic-A']});if(!memberEntry.enabled)throw Error('TEST_MEMBER_DISABLED');
 const settings:WorkbenchSettings={schemaVersion:1,publicOrigin:'https://entry.test',reporterOrigin:'https://entry.test',listenPort,transportEnabled:false,memberEntry,
  bot:{id:'bot-test',wsUrl:'wss://synthetic.invalid',personTargetHashes:[hashTarget('synthetic-A'),hashTarget('user-test')],groupTargetHashes:[hashTarget('runtime-group')]},
  appChannelAccountId:'runtime-app',notificationBindingsFile:join(directory,'notification-bindings.json'),groupRoutes:[{botId:'bot-test',groupId:'runtime-group',url:'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=synthetic-unused'}]};
 const bindings={schemaVersion:1,mappingConfigHash:yxxIdentityConfigHash(memberEntry),mappingProofRef:memberEntry.proofRef,proofKind:'SYNTHETIC',validUntilEpochMs:String(Date.now()+3600000),members:[{memberUserId:'synthetic-A',bindingProofRef:memberEntry.proofRef,accountStatus:'ACTIVE',bindingState:'VERIFIED',messageReachability:'REACHABLE'}],mentions:[{botId:'bot-test',groupId:'runtime-group',reporterUserId:'synthetic-A',mentionUserId:'qualified-mention-A',namespaceProofRef:'tests/synthetic-webhook-namespace'}]};
 const file=join(directory,'runtime.json');
 writeFileSync(file,JSON.stringify(settings));writeFileSync(settings.notificationBindingsFile,JSON.stringify(bindings));
 const env:NodeJS.ProcessEnv={WORKBENCH_RUNTIME_PROFILE:'human-v1',WORKBENCH_RUNTIME_CONFIG:file,PILOT_DATABASE_URL:'postgresql://unused@127.0.0.1:1/unused',PILOT_LOG_IDENTITY_HASH_KEY:'runtime-existing-identity-key-at-least-16',P2_016_REPORTER_HMAC_SECRET:entryKey,APP_SECRET:'synthetic-app-secret',WECOM_BOT_SECRET:'synthetic-bot-secret',WORKBENCH_EXTERNAL_IO_APPROVAL_REF:'tests/isolated-boundaries'};
 return {settings,bindings,env,file,save:()=>{writeFileSync(file,JSON.stringify(settings));writeFileSync(settings.notificationBindingsFile,JSON.stringify(bindings));}};
}
