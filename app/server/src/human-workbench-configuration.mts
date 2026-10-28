import {readFileSync, statSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {createHash,createHmac} from 'node:crypto';
import {validateYxxEntryConfig} from './p2-g2-yixiaoxiu-contract.mjs';
import type {YxxEntryConfig} from './p2-g2-yixiaoxiu-contract.mjs';
import {yxxIdentityConfigHash} from './p2-g2-yixiaoxiu-delegated-identity.mjs';
import {createWorkbenchGroupNotificationSender} from './workbench-group-notification-sender.mjs';
import {createP2016InboundScope} from './p2-016-inbound-scope.mjs';
import {applicationRecipientProof,boundApplicationRecipient} from './yxx-application-member-auth.mjs';
import {assertEpochMsString,formatEpochMsToShanghaiLocal} from './platform/time-contract.mjs';
import type {TicketAppNotificationOptions} from '../../../contracts/workbench_app_notification_contracts.js';
import type {YxxH5RuntimeOptions} from './yxx-h5-runtime.mjs';

export const HUMAN_WORKBENCH_PROFILE='human-v1';
export interface WorkbenchReporterProfileScope {corpId:string;agentId:string;validationProfile:'DEPLOYMENT'|'ISOLATED_TEST'}
export type WorkbenchRole='APP'|'WORKER'|'GATEWAY';
export type MemberEntry=Extract<YxxEntryConfig,{enabled:true}>;
export interface WorkbenchSettings {
 schemaVersion:1;publicOrigin:string;reporterOrigin:string;listenPort:number;transportEnabled:boolean;botInboundEnabled?:boolean;workbenchRemindersEnabled?:boolean;workbenchFollowEnabled?:boolean;
 memberEntry:MemberEntry;bot:{id:string;wsUrl:string;personTargetHashes:string[];groupTargetHashes:string[]};
 appChannelAccountId:string;notificationBindingsFile:string;
 groupRoutes:{botId:string;groupId:string;url:string}[];
}
export interface WorkbenchConfiguration {enabled:true;settings:WorkbenchSettings;databaseUrl:string;identityHashKey:string;reporterHmacSecret:string;appSecret:string;botSecret:string;ioApprovalRef:string;inboundApprovalRef:string;h5Environment?:NodeJS.ProcessEnv;actorAvatarProviderKey?:string}
export interface RoleSettings {groupNotificationTargets?:{botId:string;groupId:string}[];role:WorkbenchRole;reporterOrigin:string;transportEnabled:boolean;botInboundEnabled?:boolean;workbenchRemindersEnabled?:boolean;botId:string;appChannelAccountId:string;notificationBindingsFile:string;memberEntry:MemberEntry;publicOrigin?:string;listenPort?:number;groupRoutes?:WorkbenchSettings['groupRoutes'];personTargetHashes?:string[];groupTargetHashes?:string[]}
export interface WorkerRoleSettings {workbenchMediaEmployeeReadEnabled?:boolean;role:'WORKER';transportEnabled:boolean;botId:string;reporterProfiles?:WorkbenchReporterProfileScope;actorAvatars?:{rootRef:string;validationProfile:'DEPLOYMENT'|'ISOLATED_TEST'}}
export interface WorkbenchSettings {workbenchReporterProfilesEnabled?:boolean;workbenchMediaEmployeeReadEnabled?:boolean;workbenchActorAvatarsEnabled?:boolean;workbenchActorAvatarRootRef?:string|null}
export interface RoleSettings {workbenchReporterProfilesEnabled?:boolean;workbenchFollowEnabled?:boolean;workbenchMediaEmployeeReadEnabled?:boolean;workbenchActorAvatarsEnabled?:boolean}
export function configurationError(field:string):never{throw new Error('HUMAN_WORKBENCH_CONFIG_INVALID:'+field);}
function record(value:unknown,field:string):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))configurationError(field);return value as Record<string,unknown>;}
function exact(value:unknown,keys:readonly string[],field:string){const r=record(value,field);if(Object.keys(r).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(r,k)))configurationError(field);return r;}
function text(value:unknown,field:string,max=512):string{if(typeof value!=='string'||!value||value.length>max||/[\r\n\x00]/u.test(value))configurationError(field);return value;}
function origin(value:unknown,field:string){const s=text(value,field);let url:URL;try{url=new URL(s);}catch{configurationError(field);}if(url.origin!==s||url.protocol!=='https:'||url.username||url.password)configurationError(field);return s;}
const h5EnvironmentKeys=['YIXIAOXIU_H5_ENABLED','YIXIAOXIU_H5_PRIVATE_ROOT','YIXIAOXIU_H5_MEDIA_KEY_HEX','YIXIAOXIU_H5_FFMPEG_PATH','YIXIAOXIU_H5_FFPROBE_PATH','YIXIAOXIU_H5_PROGRESS_ENABLED','YIXIAOXIU_H5_PERFORMANCE_ENABLED','YIXIAOXIU_H5_MEDIA_COMPRESSION_ENABLED','YIXIAOXIU_H5_PREVIOUS_STATIC_ROOT'] as const;
/** No environment default enables H5, a Provider, or an external delivery. */
export function readWorkbenchH5RuntimeOptions(env:NodeJS.ProcessEnv=process.env,{worker=false}:{worker?:boolean}={}):YxxH5RuntimeOptions {
 const enabled=env.YIXIAOXIU_H5_ENABLED,progress=env.YIXIAOXIU_H5_PROGRESS_ENABLED,performance=env.YIXIAOXIU_H5_PERFORMANCE_ENABLED,compression=env.YIXIAOXIU_H5_MEDIA_COMPRESSION_ENABLED;
 if(enabled!==undefined&&!['true','false'].includes(enabled))configurationError('YIXIAOXIU_H5_ENABLED');
 if(progress!==undefined&&!['true','false'].includes(progress))configurationError('YIXIAOXIU_H5_PROGRESS_ENABLED');
 if(compression!==undefined&&!['true','false'].includes(compression))configurationError('YIXIAOXIU_H5_MEDIA_COMPRESSION_ENABLED');
 if(performance!==undefined&&!['true','false'].includes(performance))configurationError('YIXIAOXIU_H5_PERFORMANCE_ENABLED');
 if(enabled!=='true'){if(compression==='true')configurationError('YIXIAOXIU_H5_MEDIA_COMPRESSION_ENABLED');if(progress==='true')configurationError('YIXIAOXIU_H5_PROGRESS_ENABLED');if(performance==='true')configurationError('YIXIAOXIU_H5_PERFORMANCE_ENABLED');if(env.YIXIAOXIU_H5_PREVIOUS_STATIC_ROOT!==undefined)configurationError('YIXIAOXIU_H5_PREVIOUS_STATIC_ROOT');return {enabled:false};}
 const path=(key:typeof h5EnvironmentKeys[number])=>{const value=text(env[key],key,2048);if(!isAbsolute(value))configurationError(key);return value;};
 const privateRoot=path('YIXIAOXIU_H5_PRIVATE_ROOT'),keyHex=text(env.YIXIAOXIU_H5_MEDIA_KEY_HEX,'YIXIAOXIU_H5_MEDIA_KEY_HEX',64);
 if(!/^[a-fA-F0-9]{64}$/u.test(keyHex))configurationError('YIXIAOXIU_H5_MEDIA_KEY_HEX');
 const result:YxxH5RuntimeOptions={enabled:true,privateRoot,key:Buffer.from(keyHex,'hex'),workbenchProgressEnabled:progress==='true',performanceEnabled:performance==='true',compressionEnabled:compression==='true'};
 if(env.YIXIAOXIU_H5_PREVIOUS_STATIC_ROOT!==undefined)result.previousStaticRoot=path('YIXIAOXIU_H5_PREVIOUS_STATIC_ROOT');
 if(worker){result.ffmpegPath=path('YIXIAOXIU_H5_FFMPEG_PATH');result.ffprobePath=path('YIXIAOXIU_H5_FFPROBE_PATH');}
 return result;
}
function hashes(value:unknown,field:string):string[]{if(!Array.isArray(value)||value.length>64||value.some(v=>typeof v!=='string'||!/^[a-f0-9]{64}$/u.test(v))||new Set(value).size!==value.length)configurationError(field);return value as string[];}
export function readWorkbenchJson(file:string,field='file'):unknown{try{if(!isAbsolute(file)||statSync(file).size>131072)configurationError(field);return JSON.parse(readFileSync(file,'utf8')) as unknown;}catch{configurationError(field);}}
function member(value:unknown,receiveOnly=false):MemberEntry{
 let c:YxxEntryConfig;try{c=validateYxxEntryConfig(value);}catch{configurationError('memberEntry');}
 // This recipe includes the existing H5 self-service/feedback extension, whose contract requires delegated mapping.
 if(!c.enabled||(!['VERIFIED_DELEGATED_MAPPING','VERIFIED_APP_OPENID'].includes(c.identityMode)&&!(receiveOnly&&c.identityMode==='UNVERIFIED')))configurationError('memberEntry.identityMode');
 if(!Number.isSafeInteger(Number(c.agentId))||Number(c.agentId)<1)configurationError('memberEntry.agentId');
 return c;
}
export function parseWorkbenchSettings(value:unknown):WorkbenchSettings{
 const raw=record(value,'settings');
 const r=exact({botInboundEnabled:false,workbenchRemindersEnabled:false,workbenchFollowEnabled:false,workbenchReporterProfilesEnabled:false,workbenchMediaEmployeeReadEnabled:false,workbenchActorAvatarsEnabled:false,workbenchActorAvatarRootRef:null,...raw},['schemaVersion','publicOrigin','reporterOrigin','listenPort','transportEnabled','botInboundEnabled','workbenchRemindersEnabled','workbenchFollowEnabled','workbenchReporterProfilesEnabled','workbenchActorAvatarsEnabled','workbenchMediaEmployeeReadEnabled','workbenchActorAvatarRootRef','memberEntry','bot','appChannelAccountId','notificationBindingsFile','groupRoutes'],'settings');
 if(r.schemaVersion!==1)configurationError('schemaVersion');
 if(typeof r.transportEnabled!=='boolean')configurationError('transportEnabled');
 if(typeof r.botInboundEnabled!=='boolean')configurationError('botInboundEnabled');
 if(typeof r.workbenchMediaEmployeeReadEnabled!=='boolean')configurationError('workbenchMediaEmployeeReadEnabled');
 if(typeof r.workbenchActorAvatarsEnabled!=='boolean')configurationError('workbenchActorAvatarsEnabled');
 if(r.workbenchActorAvatarsEnabled)text(r.workbenchActorAvatarRootRef,'workbenchActorAvatarRootRef',256);else if(r.workbenchActorAvatarRootRef!==null)configurationError('workbenchActorAvatarRootRef');
 if(typeof r.workbenchRemindersEnabled!=='boolean')configurationError('workbenchRemindersEnabled');
 if(typeof r.workbenchFollowEnabled!=='boolean')configurationError('workbenchFollowEnabled');
 if(typeof r.workbenchReporterProfilesEnabled!=='boolean')configurationError('workbenchReporterProfilesEnabled');
 if(typeof r.listenPort!=='number'||!Number.isInteger(r.listenPort)||r.listenPort<1024||r.listenPort>65535)configurationError('listenPort');
 const m=member(r.memberEntry,r.botInboundEnabled&&!r.transportEnabled),b=exact(r.bot,['id','wsUrl','personTargetHashes','groupTargetHashes'],'bot');
 const id=text(b.id,'bot.id',128),wsUrl=text(b.wsUrl,'bot.wsUrl');if(id!==m.botId||!/^wss:\/\//u.test(wsUrl))configurationError('bot');
 const people=hashes(b.personTargetHashes,'bot.personTargetHashes'),groups=hashes(b.groupTargetHashes,'bot.groupTargetHashes');
 if(!r.botInboundEnabled)try{createP2016InboundScope({bot_id:id,person_hashes:people,group_hashes:groups});}catch{configurationError('bot.scope');}
 const file=text(r.notificationBindingsFile,'notificationBindingsFile',2048);if(!isAbsolute(file))configurationError('notificationBindingsFile');
 if(!Array.isArray(r.groupRoutes))configurationError('groupRoutes');
 const routes=r.groupRoutes.map(v=>{const route=exact(v,['botId','groupId','url'],'groupRoutes');return {botId:text(route.botId,'groupRoutes.botId',128),groupId:text(route.groupId,'groupRoutes.groupId'),url:text(route.url,'groupRoutes.url',2048)};});
 // Reuse the actual adapter's closed endpoint rules; no database or Provider call.
 try{createWorkbenchGroupNotificationSender({pool:{query:async()=>{throw Error('CONFIG_CHECK_DATABASE_FORBIDDEN');}},routes});}catch{configurationError('groupRoutes');}
 if(routes.some(route=>route.botId!==id))configurationError('groupRoutes');
 if(routes.some(route=>!groups.includes(createHash('sha256').update(route.groupId).digest('hex'))))configurationError('groupRoutes.scope');
 return {schemaVersion:1,publicOrigin:origin(r.publicOrigin,'publicOrigin'),reporterOrigin:origin(r.reporterOrigin,'reporterOrigin'),listenPort:r.listenPort,transportEnabled:r.transportEnabled,botInboundEnabled:r.botInboundEnabled,workbenchRemindersEnabled:r.workbenchRemindersEnabled,workbenchFollowEnabled:r.workbenchFollowEnabled,workbenchReporterProfilesEnabled:r.workbenchReporterProfilesEnabled,workbenchMediaEmployeeReadEnabled:r.workbenchMediaEmployeeReadEnabled,workbenchActorAvatarsEnabled:r.workbenchActorAvatarsEnabled,workbenchActorAvatarRootRef:r.workbenchActorAvatarsEnabled?String(r.workbenchActorAvatarRootRef):null,memberEntry:m,
  bot:{id,wsUrl,personTargetHashes:people,groupTargetHashes:groups},appChannelAccountId:text(r.appChannelAccountId,'appChannelAccountId',128),notificationBindingsFile:file,groupRoutes:routes};
}
export function readHumanWorkbenchConfiguration(env:NodeJS.ProcessEnv=process.env,{isolatedBoundaries=false}={}):WorkbenchConfiguration|{enabled:false}{
 if(env.WORKBENCH_RUNTIME_PROFILE===undefined)return {enabled:false};
 if(env.WORKBENCH_RUNTIME_PROFILE!==HUMAN_WORKBENCH_PROFILE)configurationError('WORKBENCH_RUNTIME_PROFILE');
 const settings=parseWorkbenchSettings(readWorkbenchJson(text(env.WORKBENCH_RUNTIME_CONFIG,'WORKBENCH_RUNTIME_CONFIG',2048),'WORKBENCH_RUNTIME_CONFIG'));
 const databaseUrl=text(env.PILOT_DATABASE_URL,'PILOT_DATABASE_URL',4096);let db:URL;try{db=new URL(databaseUrl);}catch{configurationError('PILOT_DATABASE_URL');}if(!['postgres:','postgresql:'].includes(db.protocol))configurationError('PILOT_DATABASE_URL');
 const identityHashKey=text(env.PILOT_LOG_IDENTITY_HASH_KEY,'PILOT_LOG_IDENTITY_HASH_KEY');if(identityHashKey.length<16)configurationError('PILOT_LOG_IDENTITY_HASH_KEY');
 const reporterHmacSecret=text(env.P2_016_REPORTER_HMAC_SECRET,'P2_016_REPORTER_HMAC_SECRET');if(Buffer.byteLength(reporterHmacSecret)<32||reporterHmacSecret===identityHashKey)configurationError('P2_016_REPORTER_HMAC_SECRET');
 const appSecret=text(env.APP_SECRET,'APP_SECRET'),botSecret=settings.transportEnabled||settings.botInboundEnabled?text(env.WECOM_BOT_SECRET,'WECOM_BOT_SECRET'):'';
 const ioApprovalRef=settings.transportEnabled?text(env.WORKBENCH_EXTERNAL_IO_APPROVAL_REF,'WORKBENCH_EXTERNAL_IO_APPROVAL_REF'):'';
 const inboundApprovalRef=settings.botInboundEnabled?text(env.WORKBENCH_INBOUND_IO_APPROVAL_REF,'WORKBENCH_INBOUND_IO_APPROVAL_REF'):'';
 if(settings.transportEnabled&&!isolatedBoundaries&&(env.WORKBENCH_EXTERNAL_IO_APPROVED!=='true'||settings.memberEntry.proofKind!=='LIVE'||settings.memberEntry.validationProfile!=='DEPLOYMENT'))configurationError('WORKBENCH_EXTERNAL_IO_APPROVED');
 if(settings.botInboundEnabled&&!isolatedBoundaries&&(env.WORKBENCH_INBOUND_IO_APPROVED!=='true'||settings.memberEntry.validationProfile!=='DEPLOYMENT'))configurationError('WORKBENCH_INBOUND_IO_APPROVED');
 if(!isolatedBoundaries&&settings.memberEntry.validationProfile!=='DEPLOYMENT')configurationError('memberEntry.validationProfile');
 if(settings.memberEntry.identityMode==='VERIFIED_DELEGATED_MAPPING')validateNotificationBindings(settings.notificationBindingsFile,settings.memberEntry);
 const h5=readWorkbenchH5RuntimeOptions(env,{worker:true});
 if(settings.workbenchMediaEmployeeReadEnabled&&!h5.enabled)configurationError('workbenchMediaEmployeeReadEnabled');
 if(h5.enabled&&!['VERIFIED_DELEGATED_MAPPING','VERIFIED_APP_OPENID'].includes(settings.memberEntry.identityMode))configurationError('memberEntry.identityMode');
 const h5Environment:NodeJS.ProcessEnv={};if(h5.enabled)for(const key of h5EnvironmentKeys)if(env[key]!==undefined)h5Environment[key]=env[key];
 const actorAvatarProviderKey=settings.workbenchActorAvatarsEnabled?text(env.THIRD_STAFF_INFO_SYNC_KEY,'THIRD_STAFF_INFO_SYNC_KEY',4096):undefined;
 h5.key?.fill(0);
 return {enabled:true,settings,databaseUrl,identityHashKey,reporterHmacSecret,appSecret,botSecret,ioApprovalRef,inboundApprovalRef,...(h5.enabled?{h5Environment}:{}),...(actorAvatarProviderKey?{actorAvatarProviderKey}:{})};
}
interface NotificationBindings {validUntilEpochMs:string;members:{memberUserId:string;bindingProofRef:string;accountStatus:string;bindingState:string;messageReachability:string}[];mentions:{botId:string;groupId:string;reporterUserId:string;mentionUserId:string;namespaceProofRef:string}[]}
function validateNotificationBindings(file:string,m:MemberEntry):NotificationBindings{
 const r=exact(readWorkbenchJson(file,'notificationBindingsFile'),['schemaVersion','mappingConfigHash','mappingProofRef','proofKind','validUntilEpochMs','members','mentions'],'notificationBindings');
 if(r.schemaVersion!==1||r.mappingConfigHash!==yxxIdentityConfigHash(m)||r.mappingProofRef!==m.proofRef||r.proofKind!==m.proofKind)configurationError('notificationBindings.authority');
 if(typeof r.validUntilEpochMs!=='string'||!/^\d{13}$/u.test(r.validUntilEpochMs)||BigInt(r.validUntilEpochMs)<=BigInt(Date.now()))configurationError('notificationBindings.validUntilEpochMs');
 if(!Array.isArray(r.members)||r.members.length>32||!Array.isArray(r.mentions)||r.mentions.length>256)configurationError('notificationBindings.targets');
 const members=r.members.map(v=>{const a=exact(v,['memberUserId','bindingProofRef','accountStatus','bindingState','messageReachability'],'notificationBindings.members');const id=text(a.memberUserId,'memberUserId',256);if(!/^[A-Za-z0-9][A-Za-z0-9_.@-]{0,255}$/u.test(id)||id==='@all')configurationError('memberUserId');
  if(!['ACTIVE','DISABLED','UNKNOWN'].includes(String(a.accountStatus))||!['VERIFIED','REVOKED','UNKNOWN'].includes(String(a.bindingState))||!['REACHABLE','UNREACHABLE','UNKNOWN'].includes(String(a.messageReachability)))configurationError('notificationBindings.qualification');
  return {memberUserId:id,bindingProofRef:text(a.bindingProofRef,'bindingProofRef',256),accountStatus:String(a.accountStatus),bindingState:String(a.bindingState),messageReachability:String(a.messageReachability)};});
 const mentions=r.mentions.map(v=>{const a=exact(v,['botId','groupId','reporterUserId','mentionUserId','namespaceProofRef'],'notificationBindings.mentions');const id=text(a.mentionUserId,'mentionUserId',256);if(id==='@all')configurationError('mentionUserId');return {botId:text(a.botId,'botId'),groupId:text(a.groupId,'groupId'),reporterUserId:text(a.reporterUserId,'reporterUserId'),mentionUserId:id,namespaceProofRef:text(a.namespaceProofRef,'namespaceProofRef',256)};});
 if(new Set(members.map(v=>v.memberUserId.toLowerCase())).size!==members.length||new Set(mentions.map(v=>JSON.stringify([v.botId,v.groupId,v.reporterUserId]))).size!==mentions.length)configurationError('notificationBindings.duplicate');
 return {validUntilEpochMs:r.validUntilEpochMs,members,mentions};
}
/** Operator-supplied current verified authority, re-read at each qualification. No inferred directory/OAuth send rights. */
export function createWorkbenchNotificationOptions(settings:Pick<RoleSettings,'memberEntry'|'appChannelAccountId'|'notificationBindingsFile'>,reporterHmacSecret:string):TicketAppNotificationOptions{
 const m=settings.memberEntry;
 if(!['VERIFIED_DELEGATED_MAPPING','VERIFIED_APP_OPENID'].includes(m.identityMode))configurationError('notificationBindings.authority');
 const legacy=m.identityMode==='VERIFIED_APP_OPENID'&&m.reporterUserIds?{...m,identityMode:'VERIFIED_DELEGATED_MAPPING' as const}:m;
 return {enabled:true,...(m.identityMode==='VERIFIED_APP_OPENID'?{identityMode:'VERIFIED_APP_OPENID' as const}:{}),authority:{sourceCorpScope:m.corpId,sourceAppScope:m.agentId,channelAccountId:settings.appChannelAccountId,mappingConfigHash:yxxIdentityConfigHash(m),mappingProofRef:m.proofRef as string,proofKind:m.proofKind as 'LIVE'|'SYNTHETIC',validationProfile:m.validationProfile},
  targetResolver:{localOnly:true,async resolveCurrentTarget(input){
   input.signal.throwIfAborted();const epoch=assertEpochMsString(String(Date.now()));
   const base={schema_version:1,source_kind:input.source_kind,scope:input.scope,checked_at:formatEpochMsToShanghaiLocal(epoch),checked_at_epoch_ms:epoch};
   if(m.identityMode==='VERIFIED_APP_OPENID'&&input.recipient){
    let recipient;try{recipient=boundApplicationRecipient(input.recipient);}catch{return {...base,state:'NOT_ELIGIBLE',reason:'NO_MAPPING'};}
    if(input.source_kind!=='WEB_REQUEST'||input.scope.sourceCorpScope!==m.corpId||input.scope.sourceAppScope!==m.agentId||input.scope.proofRef!==m.proofRef
      ||applicationRecipientProof(reporterHmacSecret,input.scope,recipient.member_id)!==recipient.proof_ref)return {...base,state:'NOT_ELIGIBLE',reason:'SCOPE_MISMATCH'};
    return {...base,state:'ELIGIBLE',target:{provider:'WECOM_APP',channel_account_id:settings.appChannelAccountId,target_type:'PERSON',target_id:recipient.member_id},verification:{mapping_config_hash:yxxIdentityConfigHash(m),mapping_proof_ref:m.proofRef,binding_proof_ref:m.proofRef,proof_kind:m.proofKind,account_status:'ACTIVE',binding_state:'VERIFIED',message_reachability:'REACHABLE'}};
   }
   if(m.identityMode==='VERIFIED_APP_OPENID'&&!m.reporterUserIds)return {...base,state:'NOT_ELIGIBLE',reason:'NO_MAPPING'};
   const bindings=validateNotificationBindings(settings.notificationBindingsFile,legacy);
   const found=bindings.members.find(v=>v.bindingProofRef===input.scope.proofRef&&createHmac('sha256',reporterHmacSecret).update(JSON.stringify(['member',m.corpId,m.agentId,v.memberUserId])).digest('hex')===input.scope.scopeHash);
   if(!found)return {...base,state:'NOT_ELIGIBLE',reason:'NO_MAPPING'};
   if(found.accountStatus!=='ACTIVE'||found.bindingState!=='VERIFIED'||found.messageReachability!=='REACHABLE')return {...base,state:'NOT_ELIGIBLE',reason:found.bindingState==='REVOKED'?'REVOKED':found.messageReachability==='UNREACHABLE'?'UNREACHABLE':'UNKNOWN'};
   return {...base,state:'ELIGIBLE',target:{provider:'WECOM_APP',channel_account_id:settings.appChannelAccountId,target_type:'PERSON',target_id:found.memberUserId},verification:{mapping_config_hash:yxxIdentityConfigHash(m),mapping_proof_ref:m.proofRef,binding_proof_ref:found.bindingProofRef,proof_kind:m.proofKind,account_status:'ACTIVE',binding_state:'VERIFIED',message_reachability:'REACHABLE'}};
  }}};
}
export function resolveWorkbenchMention(settings:RoleSettings,input:{botId:string;groupId:string;reporterUserId:string}):string|null{
 const member=settings.memberEntry.identityMode==='VERIFIED_APP_OPENID'?{...settings.memberEntry,identityMode:'VERIFIED_DELEGATED_MAPPING' as const}:settings.memberEntry;
 const bindings=validateNotificationBindings(settings.notificationBindingsFile,member);
 return bindings.mentions.find(v=>v.botId===input.botId&&v.groupId===input.groupId&&v.reporterUserId===input.reporterUserId)?.mentionUserId??null;
}
export function workbenchRoleEnvironment(c:WorkbenchConfiguration,role:WorkbenchRole):NodeJS.ProcessEnv{
 const s=c.settings;
 if(role==='WORKER')return {WORKBENCH_RUNTIME_PROFILE:HUMAN_WORKBENCH_PROFILE,WORKBENCH_ROLE_SETTINGS:JSON.stringify({role,transportEnabled:s.transportEnabled,botId:s.bot.id,...(s.workbenchMediaEmployeeReadEnabled?{workbenchMediaEmployeeReadEnabled:true}:{}),...(s.workbenchActorAvatarsEnabled?{actorAvatars:{rootRef:s.workbenchActorAvatarRootRef,validationProfile:s.memberEntry.validationProfile}}:{}),...(s.workbenchReporterProfilesEnabled?{reporterProfiles:{corpId:s.memberEntry.corpId,agentId:s.memberEntry.agentId,validationProfile:s.memberEntry.validationProfile}}:{})}),PILOT_LOG_IDENTITY_HASH_KEY:c.identityHashKey,P2_016_REPORTER_HMAC_SECRET:c.reporterHmacSecret,...c.h5Environment,...(s.workbenchActorAvatarsEnabled?{THIRD_STAFF_INFO_SYNC_KEY:c.actorAvatarProviderKey}:{}),...(s.workbenchReporterProfilesEnabled?{APP_SECRET:c.appSecret}:{})};
 const settings:RoleSettings={role,reporterOrigin:s.reporterOrigin,transportEnabled:s.transportEnabled,botInboundEnabled:s.botInboundEnabled??false,botId:s.bot.id,memberEntry:s.memberEntry,appChannelAccountId:s.appChannelAccountId,notificationBindingsFile:s.notificationBindingsFile,
  ...(role==='APP'?{publicOrigin:s.publicOrigin,listenPort:s.listenPort,workbenchRemindersEnabled:s.workbenchRemindersEnabled??false,workbenchFollowEnabled:s.workbenchFollowEnabled??false,workbenchReporterProfilesEnabled:s.workbenchReporterProfilesEnabled??false,workbenchMediaEmployeeReadEnabled:s.workbenchMediaEmployeeReadEnabled??false,workbenchActorAvatarsEnabled:s.workbenchActorAvatarsEnabled??false,groupNotificationTargets:s.groupRoutes.map(({botId,groupId})=>({botId,groupId}))}:{}),...(role==='GATEWAY'?{groupRoutes:s.groupRoutes,personTargetHashes:s.bot.personTargetHashes,groupTargetHashes:s.bot.groupTargetHashes}:{})};
 return {WORKBENCH_RUNTIME_PROFILE:HUMAN_WORKBENCH_PROFILE,WORKBENCH_ROLE_SETTINGS:JSON.stringify(settings),PILOT_LOG_IDENTITY_HASH_KEY:c.identityHashKey,P2_016_REPORTER_HMAC_SECRET:c.reporterHmacSecret,
  ...(role==='APP'&&c.h5Environment?Object.fromEntries(Object.entries(c.h5Environment).filter(([key])=>!['YIXIAOXIU_H5_FFMPEG_PATH','YIXIAOXIU_H5_FFPROBE_PATH'].includes(key))):{}),
  ...(role==='APP'||role==='GATEWAY'&&(s.transportEnabled||s.botInboundEnabled)?{APP_SECRET:c.appSecret}:{}),...(role==='GATEWAY'&&s.transportEnabled?{WORKBENCH_EXTERNAL_IO_APPROVED:'true',WORKBENCH_EXTERNAL_IO_APPROVAL_REF:c.ioApprovalRef}:{}),
  ...(role==='GATEWAY'&&s.botInboundEnabled?{WORKBENCH_INBOUND_IO_APPROVED:'true',WORKBENCH_INBOUND_IO_APPROVAL_REF:c.inboundApprovalRef}:{})};
}
export function readWorkbenchRoleSettings(role:WorkbenchRole,env:NodeJS.ProcessEnv=process.env):RoleSettings{
 if(role==='WORKER')configurationError('role');
 if(env.WORKBENCH_RUNTIME_PROFILE!==HUMAN_WORKBENCH_PROFILE)configurationError('WORKBENCH_RUNTIME_PROFILE');
 let r:Record<string,unknown>;try{r=record(JSON.parse(env.WORKBENCH_ROLE_SETTINGS??''),'WORKBENCH_ROLE_SETTINGS');}catch{configurationError('WORKBENCH_ROLE_SETTINGS');}
 if(r.role!==role||typeof r.transportEnabled!=='boolean')configurationError('role');
 if(r.botInboundEnabled!==undefined&&typeof r.botInboundEnabled!=='boolean')configurationError('botInboundEnabled');
 if(r.workbenchRemindersEnabled!==undefined&&(role!=='APP'||typeof r.workbenchRemindersEnabled!=='boolean'))configurationError('workbenchRemindersEnabled');
 if(r.workbenchFollowEnabled!==undefined&&(role!=='APP'||typeof r.workbenchFollowEnabled!=='boolean'))configurationError('workbenchFollowEnabled');
 if(r.workbenchReporterProfilesEnabled!==undefined&&(role!=='APP'||typeof r.workbenchReporterProfilesEnabled!=='boolean'))configurationError('workbenchReporterProfilesEnabled');
 if(r.workbenchMediaEmployeeReadEnabled!==undefined&&(role!=='APP'||typeof r.workbenchMediaEmployeeReadEnabled!=='boolean'))configurationError('workbenchMediaEmployeeReadEnabled');
 if(r.workbenchActorAvatarsEnabled!==undefined&&(role!=='APP'||typeof r.workbenchActorAvatarsEnabled!=='boolean'))configurationError('workbenchActorAvatarsEnabled');
 const m=member(r.memberEntry,r.botInboundEnabled===true&&!r.transportEnabled);origin(r.reporterOrigin,'reporterOrigin');text(r.botId,'botId');text(r.appChannelAccountId,'appChannelAccountId');
 if(m.botId!==r.botId)configurationError('botId');
 const file=text(r.notificationBindingsFile,'notificationBindingsFile');if(m.identityMode==='VERIFIED_DELEGATED_MAPPING')validateNotificationBindings(file,m);
 if(text(env.PILOT_LOG_IDENTITY_HASH_KEY,'PILOT_LOG_IDENTITY_HASH_KEY').length<16)configurationError('PILOT_LOG_IDENTITY_HASH_KEY');
 if(Buffer.byteLength(text(env.P2_016_REPORTER_HMAC_SECRET,'P2_016_REPORTER_HMAC_SECRET'))<32||env.P2_016_REPORTER_HMAC_SECRET===env.PILOT_LOG_IDENTITY_HASH_KEY)configurationError('P2_016_REPORTER_HMAC_SECRET');
 if(role==='APP'){origin(r.publicOrigin,'publicOrigin');if(!Number.isInteger(r.listenPort))configurationError('listenPort');text(env.APP_SECRET,'APP_SECRET');}
 if(role==='GATEWAY'&&r.transportEnabled&&env.WORKBENCH_EXTERNAL_IO_APPROVED!=='true')configurationError('WORKBENCH_EXTERNAL_IO_APPROVED');
 if(role==='GATEWAY'&&r.botInboundEnabled){if(env.WORKBENCH_INBOUND_IO_APPROVED!=='true')configurationError('WORKBENCH_INBOUND_IO_APPROVED');text(env.WORKBENCH_INBOUND_IO_APPROVAL_REF,'WORKBENCH_INBOUND_IO_APPROVAL_REF');text(env.APP_SECRET,'APP_SECRET');}
 const result:RoleSettings={role,reporterOrigin:origin(r.reporterOrigin,'reporterOrigin'),transportEnabled:r.transportEnabled,botInboundEnabled:r.botInboundEnabled===true,botId:text(r.botId,'botId'),appChannelAccountId:text(r.appChannelAccountId,'appChannelAccountId'),notificationBindingsFile:file,memberEntry:m};
 if(role==='APP'){
  result.workbenchRemindersEnabled=r.workbenchRemindersEnabled===true;
  result.workbenchFollowEnabled=r.workbenchFollowEnabled===true;
  if(r.workbenchActorAvatarsEnabled!==undefined&&typeof r.workbenchActorAvatarsEnabled!=='boolean')configurationError('workbenchActorAvatarsEnabled');
  result.workbenchMediaEmployeeReadEnabled=r.workbenchMediaEmployeeReadEnabled===true;
  result.workbenchActorAvatarsEnabled=r.workbenchActorAvatarsEnabled===true;
  result.workbenchReporterProfilesEnabled=r.workbenchReporterProfilesEnabled===true;
  if(!Array.isArray(r.groupNotificationTargets)||r.groupNotificationTargets.length>32)configurationError('groupNotificationTargets');
  result.groupNotificationTargets=r.groupNotificationTargets.map(v=>{const a=exact(v,['botId','groupId'],'groupNotificationTargets');return {botId:text(a.botId,'botId'),groupId:text(a.groupId,'groupId')};});
  result.publicOrigin=origin(r.publicOrigin,'publicOrigin');result.listenPort=Number(r.listenPort);}
 if(role==='GATEWAY'){
  if(!Array.isArray(r.groupRoutes))configurationError('groupRoutes');
  result.groupRoutes=r.groupRoutes.map(v=>{const a=exact(v,['botId','groupId','url'],'groupRoutes');return {botId:text(a.botId,'botId'),groupId:text(a.groupId,'groupId'),url:text(a.url,'url',2048)};});
  result.personTargetHashes=hashes(r.personTargetHashes,'personTargetHashes');result.groupTargetHashes=hashes(r.groupTargetHashes,'groupTargetHashes');
 }
 return result;
}
export function readWorkbenchWorkerSettings(env:NodeJS.ProcessEnv=process.env):WorkerRoleSettings{
 if(env.WORKBENCH_RUNTIME_PROFILE!==HUMAN_WORKBENCH_PROFILE)configurationError('WORKBENCH_RUNTIME_PROFILE');
 let raw:unknown;try{raw=JSON.parse(env.WORKBENCH_ROLE_SETTINGS??'');}catch{configurationError('WORKBENCH_ROLE_SETTINGS');}
 const r=exact({reporterProfiles:null,actorAvatars:null,workbenchMediaEmployeeReadEnabled:false,...record(raw,'WORKBENCH_ROLE_SETTINGS')},['role','transportEnabled','botId','reporterProfiles','actorAvatars','workbenchMediaEmployeeReadEnabled'],'WORKBENCH_ROLE_SETTINGS');
 if(r.role!=='WORKER'||typeof r.transportEnabled!=='boolean'||typeof r.workbenchMediaEmployeeReadEnabled!=='boolean')configurationError('role');
 if(text(env.PILOT_LOG_IDENTITY_HASH_KEY,'PILOT_LOG_IDENTITY_HASH_KEY').length<16)configurationError('PILOT_LOG_IDENTITY_HASH_KEY');
 if(Buffer.byteLength(text(env.P2_016_REPORTER_HMAC_SECRET,'P2_016_REPORTER_HMAC_SECRET'))<32||env.P2_016_REPORTER_HMAC_SECRET===env.PILOT_LOG_IDENTITY_HASH_KEY)configurationError('P2_016_REPORTER_HMAC_SECRET');
 let reporterProfiles:WorkbenchReporterProfileScope|undefined;
 if(r.reporterProfiles!==null){
  const p=exact(r.reporterProfiles,['corpId','agentId','validationProfile'],'reporterProfiles');
  if(!['DEPLOYMENT','ISOLATED_TEST'].includes(String(p.validationProfile)))configurationError('reporterProfiles.validationProfile');
  if(!/^[1-9][0-9]*$/u.test(text(p.agentId,'reporterProfiles.agentId',20)))configurationError('reporterProfiles.agentId');
  text(env.APP_SECRET,'APP_SECRET');reporterProfiles={corpId:text(p.corpId,'reporterProfiles.corpId',128),agentId:String(p.agentId),validationProfile:p.validationProfile as WorkbenchReporterProfileScope['validationProfile']};
 }
 let actorAvatars:WorkerRoleSettings['actorAvatars'];if(r.actorAvatars!==null){const a=exact(r.actorAvatars,['rootRef','validationProfile'],'actorAvatars');if(a.validationProfile!=='DEPLOYMENT'&&a.validationProfile!=='ISOLATED_TEST')configurationError('actorAvatars.validationProfile');actorAvatars={rootRef:text(a.rootRef,'actorAvatars.rootRef',256),validationProfile:a.validationProfile};text(env.THIRD_STAFF_INFO_SYNC_KEY,'THIRD_STAFF_INFO_SYNC_KEY',4096);}
 return {...(r.workbenchMediaEmployeeReadEnabled?{workbenchMediaEmployeeReadEnabled:true}:{}),role:'WORKER',transportEnabled:r.transportEnabled,botId:text(r.botId,'botId'),...(reporterProfiles?{reporterProfiles}:{}),...(actorAvatars?{actorAvatars}:{})};
}
