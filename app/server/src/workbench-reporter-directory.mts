import type {WeComAccessTokenProvider} from './p2-g2-wecom-oauth-provider.mjs';
import {createReporterDirectoryPort,reporterIdentityHash} from './p2-015-contact-journey.mjs';
import {convertWorkbenchBotUserId} from './human-workbench-bot-member-admission.mjs';
import {createApplicationMemberVerifier,applicationMemberId} from './wecom-application-member.mjs';
import {formatEpochMsToShanghaiLocal} from './platform/time-contract.mjs';
import {applicationRecipientProof} from './yxx-application-member-auth.mjs';
export interface ReporterApplicationScope {corpId:string;agentId:string;scopeSecret:string}

/** Worker-only display material. No delivery permission or staff principal is created. */
export function createWorkbenchReporterDirectory({botId,identityHmacKey,accessTokenProvider,fetchImpl=fetch,applicationScope}:{botId:string;identityHmacKey:string;accessTokenProvider:WeComAccessTokenProvider;fetchImpl?:typeof fetch;applicationScope?:ReporterApplicationScope}){
 if(!botId||botId.length>128||identityHmacKey.length<16||typeof accessTokenProvider!=='function')throw Error('WORKBENCH_REPORTER_DIRECTORY_CONFIG_INVALID');
 if(applicationScope&&(!applicationScope.corpId||!applicationScope.agentId||applicationScope.scopeSecret.length<32))throw Error('WORKBENCH_REPORTER_DIRECTORY_CONFIG_INVALID');
 const member=createApplicationMemberVerifier({accessTokenProvider,fetchImpl});
 return createReporterDirectoryPort({timeoutMs:2000,resolveProfile:async(input,{signal})=>{
  if(!applicationMemberId(input.reporter_external_id))return {status:'NOT_FOUND'};
  let id:string|null;
  if(input.source_provider==='WECOM_AIBOT'){
   if(input.source_namespace!=='WECOM_AIBOT'||input.bot_id!==botId
    ||input.reporter_identity_hash!==reporterIdentityHash({provider:'WECOM_AIBOT',bot_id:botId,reporter_external_id:input.reporter_external_id,hmac_key:identityHmacKey}))return {status:'NOT_FOUND'};
   const token=await accessTokenProvider({signal});signal.throwIfAborted();if(typeof token!=='string'||!token||token.length>4096)throw Error('WORKBENCH_REPORTER_TOKEN_UNAVAILABLE');
   id=await convertWorkbenchBotUserId({sender:input.reporter_external_id,token,accessTokenProvider,fetchImpl,signal});
  }else if(input.source_provider==='YIXIAOXIU_WEB'){
   if(!applicationScope||input.source_namespace!=='APP_OPEN_USERID'||input.source_corp_scope!==applicationScope.corpId||input.source_app_scope!==applicationScope.agentId
    ||typeof input.reporter_identity_hash!=='string'||!/^[a-f0-9]{64}$/u.test(input.reporter_identity_hash)
    ||input.recipient_proof!==applicationRecipientProof(applicationScope.scopeSecret,{scopeHash:input.reporter_identity_hash,sourceCorpScope:applicationScope.corpId,sourceAppScope:applicationScope.agentId},input.reporter_external_id))return {status:'NOT_FOUND'};
   id=input.reporter_external_id;
  }else return {status:'NOT_FOUND'};
  if(!id)return {status:'NOT_FOUND'};
  const profile=await member.profileRead?.(id,signal);signal.throwIfAborted();if(!profile)return {status:'NOT_FOUND'};
  const stamp=formatEpochMsToShanghaiLocal(profile.checkedEpochMs);
  return {status:'RESOLVED',snapshot:{source:'WECOM_DIRECTORY',version:'wecom-application-member/1',
   contact:{name:profile.displayName},memberships:profile.departmentName?[{name:profile.departmentName,role:'MEMBER'}]:[],fetched_at:stamp,valid_at:stamp}};
 }});
}
