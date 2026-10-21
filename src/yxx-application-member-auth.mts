import type {IncomingMessage} from 'node:http';
import type {EnabledWeComOAuth,SessionToken} from './p2-g2-wecom-web-oauth.mjs';
import type {YxxIdentityMapping} from './p2-g2-yixiaoxiu-delegated-identity.mjs';
import type {YxxMemberFlags} from './yxx-self-service-authorization.mjs';
import type {ApplicationMemberVerifier,VerifiedApplicationMember} from './wecom-application-member.mjs';
import {createHmac} from 'node:crypto';
import {readWeComCookie,sessionName} from './p2-g2-wecom-oauth-http.mjs';
import {failYxx} from './p2-g2-yixiaoxiu-contract.mjs';
import type {MemberEntry} from './human-workbench-configuration.mjs';
import {applicationMemberId} from './wecom-application-member.mjs';
import {exactP2016} from './p2-016-domain-contracts.mjs';

export interface BoundApplicationRecipient {readonly namespace:'APP_OPEN_USERID';readonly member_id:string;readonly proof_ref:string;readonly verified_epoch_ms:string}
export function boundApplicationRecipient(value:unknown):BoundApplicationRecipient{
 const v=exactP2016(value,['namespace','member_id','proof_ref','verified_epoch_ms']);
 if(v.namespace!=='APP_OPEN_USERID'||!applicationMemberId(v.member_id)||typeof v.proof_ref!=='string'||!/^app_member_v1_[a-f0-9]{64}$/u.test(v.proof_ref)
  ||typeof v.verified_epoch_ms!=='string'||!/^\d{13}$/u.test(v.verified_epoch_ms))throw Error('APPLICATION_RECIPIENT_INVALID');
 return Object.freeze({namespace:v.namespace,member_id:v.member_id,proof_ref:v.proof_ref,verified_epoch_ms:v.verified_epoch_ms});
}
export function applicationRecipientProof(secret:string,scope:{scopeHash:string;sourceCorpScope:string;sourceAppScope:string},memberId:string){
 return 'app_member_v1_'+createHmac('sha256',secret).update(JSON.stringify(['request-notification',scope.sourceCorpScope,scope.sourceAppScope,scope.scopeHash,'APP_OPEN_USERID',memberId])).digest('hex');
}
/** Provider qualification occurs once per request before any business transaction. */
export function createYxxApplicationMemberAuthentication({oauth,config,identityMapping,secret,flags,verifyMember,h5EntryVerifier=null,requestBudgetMs=5000}:{oauth:EnabledWeComOAuth;config:MemberEntry;identityMapping?:YxxIdentityMapping|null;secret:string;flags:Partial<YxxMemberFlags>;verifyMember:ApplicationMemberVerifier;h5EntryVerifier?:ApplicationMemberVerifier|null;requestBudgetMs?:number}){
 if(!Number.isSafeInteger(requestBudgetMs)||requestBudgetMs<5000||requestBudgetMs>60000)failYxx('CONFIG_INVALID');
 const digest=(purpose:string,values:unknown[])=>createHmac('sha256',secret).update(JSON.stringify([purpose,...values])).digest('hex');
 type Context={profile:'FULL_SERVICE_LOOP'|'MEMBER_SELF_SERVICE';flags:Partial<YxxMemberFlags>;write_flag:boolean;csrf_token:string;session_generation:string;canonical_reporter_binding:string;source_corp_scope:string;source_app_scope:string;proof_ref:string;bot_owner:{botId:string;userId:string}|null;identity_mode:string;notification_recipient:BoundApplicationRecipient};
 const prepared=new WeakMap<IncomingMessage,{token:SessionToken;openId:string;expires:number;context:Context;verified:VerifiedApplicationMember}>();
 const local=(request:IncomingMessage)=>{
  const ready=prepared.get(request);if(!ready||Date.now()>=ready.expires)failYxx('AUTH_REQUIRED');
  const member=oauth.authenticate(ready.token);
  if(member.corpId!==config.corpId||member.userid!==ready.openId||readWeComCookie(request,sessionName)!==ready.token)failYxx('AUTH_REQUIRED');
  return ready.context;
 };
 async function authenticateUsing(request:IncomingMessage,profile:Context['profile'],selected:ApplicationMemberVerifier,signal?:AbortSignal){
  if(prepared.has(request))return local(request);
  const token=readWeComCookie(request,sessionName);if(!token)failYxx('AUTH_REQUIRED');
  const member=oauth.authenticate(token),verified=await selected(member.userid,signal).catch(()=>failYxx('UNAVAILABLE'));
  if(!verified||verified.openUserId!==member.userid||member.corpId!==config.corpId)failYxx('MEMBER_REQUIRED');
  const current=oauth.authenticate(token);if(current.userid!==member.userid||current.corpId!==member.corpId)failYxx('AUTH_REQUIRED');
  // Known legacy correspondence keeps its original owner hash. New members use a distinct namespace.
  const legacy=identityMapping?.resolve(member.userid)??null;
  const canonical=legacy?digest('member',[config.corpId,config.agentId,legacy]):digest('application-member',[config.corpId,config.agentId,'APP_OPEN_USERID',member.userid]);
  const scope={scopeHash:canonical,sourceCorpScope:config.corpId,sourceAppScope:config.agentId};
  const context:Context={profile,flags,write_flag:flags.YIXIAOXIU_SELF_SERVICE_ENABLED===true,csrf_token:digest('csrf',[token]),session_generation:digest('session',[token]),
   canonical_reporter_binding:canonical,source_corp_scope:config.corpId,source_app_scope:config.agentId,proof_ref:config.proofRef as string,identity_mode:'VERIFIED_APP_OPENID',
   bot_owner:legacy?{botId:config.botId,userId:legacy}:null,notification_recipient:{namespace:'APP_OPEN_USERID',member_id:member.userid,proof_ref:applicationRecipientProof(secret,scope,member.userid),verified_epoch_ms:verified.checkedEpochMs}};
  // A media response can outlive qualification's 5s network budget. This proof
  // remains request-local and each use still verifies the live OAuth session.
  prepared.set(request,{token,openId:member.userid,expires:Date.now()+requestBudgetMs,context,verified});return local(request);
 }
 return {
  authenticate:(request:IncomingMessage,profile:Context['profile']='FULL_SERVICE_LOOP')=>authenticateUsing(request,profile,verifyMember),
  authenticateEntry:(request:IncomingMessage,profile:Context['profile']='FULL_SERVICE_LOOP')=>authenticateUsing(request,profile,h5EntryVerifier??verifyMember),
  authenticateProfile:(request:IncomingMessage,profile:Context['profile']='FULL_SERVICE_LOOP',signal?:AbortSignal)=>{
   if(!verifyMember.profileRead)failYxx('UNAVAILABLE');
   return authenticateUsing(request,profile,verifyMember.profileRead,signal);
  },
  currentDisplay:(request:IncomingMessage)=>{
   local(request);const verified=prepared.get(request)?.verified;
   return {name:verified?.displayName??null,department:verified?.departmentName??null};
  },
  recheck:local,
 };
}
