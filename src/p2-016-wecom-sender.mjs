import { createP2G1WeComCommunicationSender } from './p2-g1-wecom-sender.mjs';
import { createCommunicationSenderPort } from './p2-004-communication-sender-port.mjs';
import { buildP2016TemplateCard } from './p2-016-template-card-builder.mjs';
import { textHashP2016,snapshotP2016 } from './p2-016-domain-contracts.mjs';

export function createP2016WeComSender({gateway,allowedTargetHashes,enabled=false,cardEnabled=false,
  reporterAccess,origin,allowedHosts=[],allowLocalHttp=false}) {
  if(typeof enabled!=='boolean'||typeof cardEnabled!=='boolean')throw new TypeError('P2_016_SENDER_CONFIG_INVALID');
  if(!enabled)return createCommunicationSenderPort(async()=>({outcome:'REJECTED_NOT_APPLIED',provider_message_id:null,error_code:'P2_016_SENDER_DISABLED',retryable:false}));
  const allowlist=new Set(allowedTargetHashes??[]);
  if([...allowlist].some(v=>typeof v!=='string'||!/^[a-f0-9]{64}$/u.test(v)))throw new TypeError('P2_016_SENDER_CONFIG_INVALID');
  const legacy=createP2G1WeComCommunicationSender({gateway,allowedTargetHashes:[...allowlist],enabled});
  const rejected=(code,retryable=false)=>({outcome:'REJECTED_NOT_APPLIED',provider_message_id:null,error_code:code,retryable});
  const unknown=()=>({outcome:'UNKNOWN',provider_message_id:null,error_code:'P2_016_PROVIDER_UNKNOWN',retryable:false});
  return createCommunicationSenderPort(async request=>{
    if(!enabled)return rejected('P2_016_SENDER_DISABLED');
    if(['text','markdown'].includes(request.message.message_type))return legacy.send(request);
    if(!cardEnabled)return rejected('P2_016_CARD_DISABLED');
    if(request.message.message_type!=='template_card'||request.provider!=='WECOM_AIBOT'||request.target_type!=='PERSON'
      ||!allowlist.has(textHashP2016(request.target_id)))return rejected('P2_016_SEND_SCOPE_FORBIDDEN');
    if(request.signal.aborted)return rejected('P2_016_ABORTED_BEFORE_SEND',true);
    let body;
    try {
      const model=snapshotP2016(request.message.content);
      const grant=await reporterAccess.deliveryGrant({deliveryId:request.delivery_id});
      if(grant.public_ref!==model.public_ref||grant.recipient_binding_hash!==textHashP2016(JSON.stringify([request.provider,request.channel_account_id,request.target_id])))return rejected('P2_016_CARD_BINDING_INVALID');
      body=buildP2016TemplateCard({model,origin,allowedHosts,token:grant.token,allowLocalHttp});
    }catch{return rejected('P2_016_CARD_INVALID');}
    let client;try{client=gateway.getAuthenticatedClient();}catch{
      const error=new Error('GATEWAY_UNAVAILABLE_BEFORE_SEND');error.code='GATEWAY_UNAVAILABLE_BEFORE_SEND';throw error;
    }
    if(request.signal.aborted)return rejected('P2_016_ABORTED_BEFORE_SEND',true);
    try{
      const receipt=await client.sendMessage(request.target_id,body);
      const code=receipt?.errcode??receipt?.body?.errcode;
      if(code===0)return {outcome:'ACKNOWLEDGED',provider_message_id:typeof receipt?.headers?.req_id==='string'?'wecom_ack_'+textHashP2016(receipt.headers.req_id).slice(0,32):null,error_code:null,retryable:false};
      return Number.isInteger(code)&&code!==0?rejected('P2_016_PROVIDER_REJECTED'):unknown();
    }catch(error){return Number.isInteger(error?.errcode)&&error.errcode!==0?rejected('P2_016_PROVIDER_REJECTED'):unknown();}
  });
}
