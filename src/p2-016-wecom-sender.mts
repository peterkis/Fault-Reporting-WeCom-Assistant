import type { WeComGatewayClient } from './p2-g1-wecom-gateway.mjs';
import type { CommunicationSenderResult, ValidatedSenderRequest } from './p2-004-communication-sender-port.mjs';
import type { ReporterAccess } from './p2-016-reporter-access.mjs';
import type { ReporterLinkMode } from './p2-016-template-card-builder.mjs';
import {createWorkbenchGroupNotificationSender} from './workbench-group-notification-sender.mjs';
import type {WorkbenchGroupNotificationOptions} from './workbench-group-notification-sender.mjs';
import {createWorkbenchAppNotificationSender} from './workbench-app-notification-sender.mjs';
import type {WorkbenchAppNotificationSenderOptions} from './workbench-app-notification-sender.mjs';
type ReceiptObservation = { errcode?: unknown; body?: { errcode?: unknown }; headers?: { req_id?: unknown } } | null | undefined;
function groupContent(value:unknown):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value);}
interface SenderOptions {qualifyBotNotificationRecipient?:(source:{botId:string;reporterUserId:string})=>Promise<boolean>;mvpPolicy?:boolean;groupReplies?:{pool:import('./platform/postgres-pool.mjs').PostgresTransaction;authorize?:(basis:import('./mvp-group-replies.mjs').MvpGroupReplyBasis)=>Promise<boolean>}; gateway: { getAuthenticatedClient: () => Pick<WeComGatewayClient,'sendMessage'> }; allowedTargetHashes?: readonly string[]; enabled?: boolean; cardEnabled?: boolean; reporterAccess: Pick<ReporterAccess, 'deliveryBinding' | 'deliveryGrant'>; origin: string; allowedHosts?: readonly string[]; allowLocalHttp?: boolean; linkMode?: ReporterLinkMode;groupRoundNotifications?:Omit<WorkbenchGroupNotificationOptions,'enabled'>;appRoundNotifications?:Omit<WorkbenchAppNotificationSenderOptions,'enabled'|'origin'|'allowedHosts'|'allowLocalHttp'> }

import {isDeepStrictEqual} from 'node:util';
import {readMvpGroupReplyBasis,createMvpNotificationAdmission} from './mvp-group-replies.mjs';
import { createP2G1WeComCommunicationSender } from './p2-g1-wecom-sender.mjs';
import { createCommunicationSenderPort,communicationPreSendCheck } from './p2-004-communication-sender-port.mjs';
import { buildP2016TemplateCard } from './p2-016-template-card-builder.mjs';
import { textHashP2016,snapshotP2016 } from './p2-016-domain-contracts.mjs';
import {computeCommunicationContentHash} from './p2-004-communication-core.mjs';

export function createP2016WeComSender({gateway,allowedTargetHashes,enabled=false,cardEnabled=false,mvpPolicy=false,groupReplies,qualifyBotNotificationRecipient,
  reporterAccess,origin,allowedHosts=[],allowLocalHttp=false,linkMode='LEGACY_BOUND_GRANT',groupRoundNotifications,appRoundNotifications}: SenderOptions) {
  if(typeof enabled!=='boolean'||typeof cardEnabled!=='boolean'||!['LEGACY_BOUND_GRANT','MEMBER_REQUIRED'].includes(linkMode)
    ||qualifyBotNotificationRecipient!==undefined&&(typeof qualifyBotNotificationRecipient!=='function'||!mvpPolicy||linkMode!=='MEMBER_REQUIRED'))throw new TypeError('P2_016_SENDER_CONFIG_INVALID');
  if(!enabled)return createCommunicationSenderPort(async()=>({outcome:'REJECTED_NOT_APPLIED',provider_message_id:null,error_code:'P2_016_SENDER_DISABLED',retryable:false}));
  const allowlist=new Set(allowedTargetHashes??[]);
  if([...allowlist].some(v=>typeof v!=='string'||!/^[a-f0-9]{64}$/u.test(v)))throw new TypeError('P2_016_SENDER_CONFIG_INVALID');
  // The existing port validates the request again, and its SDK adapter guards text/markdown content.
  const legacy=createP2G1WeComCommunicationSender({gateway,allowedTargetHashes:[...allowlist],enabled}) as { send: (request: ValidatedSenderRequest) => Promise<CommunicationSenderResult> };
  const rejected: (code: string,retryable?: boolean) => CommunicationSenderResult=(code,retryable=false)=>({outcome:'REJECTED_NOT_APPLIED',provider_message_id:null,error_code:code,retryable});
  const unknown: () => CommunicationSenderResult=()=>({outcome:'UNKNOWN',provider_message_id:null,error_code:'P2_016_PROVIDER_UNKNOWN',retryable:false});
  const groups=groupRoundNotifications?createWorkbenchGroupNotificationSender({...groupRoundNotifications,enabled}):null;
  const app=appRoundNotifications?createWorkbenchAppNotificationSender({...appRoundNotifications,enabled:enabled&&cardEnabled&&linkMode==='MEMBER_REQUIRED',origin,allowedHosts,allowLocalHttp}):null;
  return createCommunicationSenderPort(async request=>{
    if(!enabled)return rejected('P2_016_SENDER_DISABLED');
    const preparationSignal=AbortSignal.any([request.signal,AbortSignal.timeout(4000)]);
    const check=<T,>(operation:()=>Promise<T>)=>communicationPreSendCheck(operation,preparationSignal);
    if(request.provider==='WECOM_APP'){
      if(request.message.message_type!=='template_card'||!groupContent(request.message.content))return rejected('APP_NOTIFICATION_BINDING_INVALID');
      return app?app.send({...request,message:{message_type:'template_card',content:request.message.content}}):rejected('APP_NOTIFICATION_ROUTE_MISSING');
    }
    if(groupContent(request.message.content)&&request.message.content.transport==='WECOM_MESSAGE_PUSH'){
      if(request.message.message_type!=='template_card')return rejected('GROUP_PUSH_BINDING_INVALID');
      return groups?groups.send({...request,message:{message_type:'template_card',content:request.message.content}}):rejected('GROUP_PUSH_ROUTE_MISSING');
    }
    if((request.message.content as { transport?: unknown } | null)?.transport==='WECOM_GROUP_WEBHOOK')return rejected('P2_016_GROUP_WEBHOOK_TRANSPORT_REQUIRED');
    if(request.target_type==='GROUP'&&groupContent(request.message.content)&&request.message.content.group_reply){
      if(!mvpPolicy||!groupReplies||request.provider!=='WECOM_AIBOT'||request.message.message_type!=='text')return rejected('MVP_GROUP_REPLY_DISABLED');
      let client:ReturnType<SenderOptions['gateway']['getAuthenticatedClient']>;
      try{
        const basis=await check(()=>readMvpGroupReplyBasis(groupReplies.pool,request.delivery_id));
        if(!basis||basis.bot_id!==request.channel_account_id||basis.group_id!==request.target_id||!isDeepStrictEqual(basis.content,request.message.content))return rejected('MVP_GROUP_REPLY_BINDING_INVALID');
        const authorize=groupReplies.authorize;
        const authorized=authorize?await check(()=>authorize(basis)):allowlist.has(textHashP2016(request.target_id));
        if(!authorized)return rejected('MVP_GROUP_REPLY_NOT_AUTHORIZED');
        const current=await check(()=>readMvpGroupReplyBasis(groupReplies.pool,request.delivery_id));
        if(!isDeepStrictEqual(current,basis)||!await check(()=>createMvpNotificationAdmission()({transaction:groupReplies.pool,deliveryId:request.delivery_id})))return rejected('MVP_GROUP_REPLY_BINDING_INVALID');
        if(preparationSignal.aborted)return rejected('MVP_GROUP_REPLY_LOOKUP_UNAVAILABLE',true);
        if(BigInt(basis.retention_epoch)<=BigInt(Date.now()))return rejected('MVP_GROUP_REPLY_ABORTED');
        client=gateway.getAuthenticatedClient();
      }catch{return rejected('MVP_GROUP_REPLY_LOOKUP_UNAVAILABLE',true);}
      try{
        const receipt=await client.sendMessage(request.target_id,{msgtype:'markdown',markdown:{content:String(request.message.content.text)}}) as ReceiptObservation;
        const code=receipt?.errcode??receipt?.body?.errcode;
        return code===0?{outcome:'ACKNOWLEDGED',provider_message_id:null,error_code:null,retryable:false}:Number.isInteger(code)&&code!==0?rejected('P2_016_PROVIDER_REJECTED'):unknown();
      }catch{return unknown();}
    }
    if(mvpPolicy&&request.target_type==='GROUP')return rejected('MVP_GROUP_MESSAGE_SUPPRESSED');
    if(['text','markdown'].includes(request.message.message_type))return legacy.send(request);
    if(!cardEnabled)return rejected('P2_016_CARD_DISABLED');
    if(request.message.message_type!=='template_card'||request.provider!=='WECOM_AIBOT'||request.target_type!=='PERSON'
        ||!qualifyBotNotificationRecipient&&!allowlist.has(textHashP2016(request.target_id)))return rejected('P2_016_SEND_SCOPE_FORBIDDEN');
    if(request.signal.aborted)return rejected('P2_016_ABORTED_BEFORE_SEND',true);
    let body: ReturnType<typeof buildP2016TemplateCard>,model: unknown,binding: Awaited<ReturnType<ReporterAccess['deliveryBinding']>> | undefined,contentHash: string | undefined;
    try{model=snapshotP2016(request.message.content);if(linkMode==='MEMBER_REQUIRED')contentHash=computeCommunicationContentHash(model);}
    catch{return rejected('P2_016_CARD_INVALID');}
    if(linkMode==='MEMBER_REQUIRED'){
      try{binding=await check(()=>reporterAccess.deliveryBinding({deliveryId:request.delivery_id}));}catch(error){
        return (error as { code?: unknown } | null)?.code==='P2_016_REPORTER_BINDING_INVALID'
          ?rejected('P2_016_CARD_BINDING_INVALID'):rejected('P2_016_CARD_BINDING_UNAVAILABLE',true);
      }
      if(binding.provider!==request.provider||binding.channel_account_id!==request.channel_account_id
        ||binding.target_id!==request.target_id||binding.idempotency_key!==request.idempotency_key
        ||binding.content_hash!==contentHash)return rejected('P2_016_CARD_BINDING_INVALID');
    }
    try {
      const grant=binding??await reporterAccess.deliveryGrant({deliveryId:request.delivery_id});
      if(grant.public_ref!==(model as { public_ref?: unknown }).public_ref||grant.recipient_binding_hash!==textHashP2016(JSON.stringify([request.provider,request.channel_account_id,request.target_id])))return rejected('P2_016_CARD_BINDING_INVALID');
      body=buildP2016TemplateCard({model,origin,allowedHosts,token:grant.token,allowLocalHttp,linkMode});
    }catch{return rejected('P2_016_CARD_INVALID');}
    if(qualifyBotNotificationRecipient){
      try{
        if(!await check(()=>qualifyBotNotificationRecipient({botId:request.channel_account_id,reporterUserId:request.target_id})))return rejected('P2_016_SEND_SCOPE_FORBIDDEN');
      }catch{return rejected('P2_016_QUALIFICATION_UNAVAILABLE',true);}
      // Current membership may wait. Missing or changed facts deny sending;
      // an unavailable local lookup is still proven to precede the SDK call.
      try{if(!isDeepStrictEqual(await check(()=>reporterAccess.deliveryBinding({deliveryId:request.delivery_id})),binding))return rejected('P2_016_CARD_BINDING_INVALID');}
      catch(error){return (error as {code?:unknown}|null)?.code==='P2_016_REPORTER_BINDING_INVALID'?rejected('P2_016_CARD_BINDING_INVALID'):rejected('P2_016_CARD_BINDING_UNAVAILABLE',true);}
    }
    let client;try{client=gateway.getAuthenticatedClient();}catch{
      const error=new Error('GATEWAY_UNAVAILABLE_BEFORE_SEND') as Error & { code: string };error.code='GATEWAY_UNAVAILABLE_BEFORE_SEND';throw error;
    }
    if(preparationSignal.aborted)return rejected('P2_016_ABORTED_BEFORE_SEND',true);
    if(mvpPolicy&&binding&&BigInt(binding.retention_epoch)<=BigInt(Date.now()))return rejected('P2_016_CARD_BINDING_INVALID');
    try{
      const receipt=await client.sendMessage(request.target_id,body) as ReceiptObservation;
      const code=receipt?.errcode??receipt?.body?.errcode;
      if(code===0)return {outcome:'ACKNOWLEDGED',provider_message_id:typeof receipt?.headers?.req_id==='string'?'wecom_ack_'+textHashP2016(receipt.headers.req_id).slice(0,32):null,error_code:null,retryable:false};
      return Number.isInteger(code)&&code!==0?rejected('P2_016_PROVIDER_REJECTED'):unknown();
    }catch(error){return Number.isInteger((error as { errcode?: unknown } | null)?.errcode)&&(error as { errcode?: unknown }).errcode!==0?rejected('P2_016_PROVIDER_REJECTED'):unknown();}
  });
}
