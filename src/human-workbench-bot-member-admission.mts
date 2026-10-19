import type {WeComAccessTokenProvider} from './p2-g2-wecom-oauth-provider.mjs';
import {readWeComResponse} from './p2-g2-wecom-oauth-provider.mjs';
import {validYxxUserId} from './p2-g2-yixiaoxiu-contract.mjs';

interface MemberResponse {errcode?:unknown;userid?:unknown;status?:unknown;enable?:unknown}
interface ConversionResponse {errcode?:unknown;open_userid_list?:unknown;invalid_userid_list?:unknown}
interface AdmissionOptions {botId:string;accessTokenProvider:WeComAccessTokenProvider;fetchImpl?:typeof fetch}
function record(value:unknown):Record<string,unknown>|null{return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;}

/** Receives only the original Adapter's message from the authenticated SDK leaf.
 * The application member lookup decides current visibility; no staff role or
 * outbound permission is inferred from a successful read. */
export function createWorkbenchBotMemberAdmission({botId,accessTokenProvider,fetchImpl=fetch}:AdmissionOptions){
 if(typeof botId!=='string'||!botId||botId.length>128||/[\r\n\x00]/u.test(botId)||typeof accessTokenProvider!=='function')throw Error('WORKBENCH_BOT_ADMISSION_CONFIG_INVALID');
 return {async accepts(input:unknown):Promise<boolean>{
  const message=record(input);
  if(message?.provider!=='WECOM_AIBOT'||message.bot_id!==botId||!validYxxUserId(message.sender_user_id)
   ||!['single','group'].includes(String(message.chat_type))||message.chat_type==='group'&&(typeof message.chat_id!=='string'||!message.chat_id||message.chat_id.length>256))return false;
  const sender=message.sender_user_id,controller=new AbortController(),signal=controller.signal;
  let timer:ReturnType<typeof setTimeout>|undefined;
  const deadline=new Promise<false>(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(false);},5000);});
  const operation=(async()=>{
   try{
    const token=await accessTokenProvider({signal});signal.throwIfAborted();
    if(typeof token!=='string'||!token||token.length>4096)return false;
    const conversionUrl=new URL('https://qyapi.weixin.qq.com/cgi-bin/batch/userid_to_openuserid');conversionUrl.searchParams.set('access_token',token);
    const converted=record(await readWeComResponse(await fetchImpl(conversionUrl,{method:'POST',redirect:'error',signal,headers:{'content-type':'application/json'},body:JSON.stringify({userid_list:[sender]})}),signal)) as ConversionResponse|null;
    signal.throwIfAborted();
    if(converted?.errcode!==0){if([40014,42001].includes(Number(converted?.errcode)))accessTokenProvider.invalidate?.(token);return false;}
    if(!Array.isArray(converted.open_userid_list)||converted.open_userid_list.length!==1
     ||converted.invalid_userid_list!==undefined&&(!Array.isArray(converted.invalid_userid_list)||converted.invalid_userid_list.length!==0))return false;
    const pair=record(converted.open_userid_list[0]);
    if(!validYxxUserId(pair?.userid)||pair.userid.toLowerCase()!==sender.toLowerCase()||!validYxxUserId(pair.open_userid))return false;
    const url=new URL('https://qyapi.weixin.qq.com/cgi-bin/user/get');url.searchParams.set('access_token',token);url.searchParams.set('userid',pair.open_userid);
    const member=record(await readWeComResponse(await fetchImpl(url,{method:'GET',redirect:'error',signal}),signal)) as MemberResponse|null;
    signal.throwIfAborted();
    if(member?.errcode!==0){if([40014,42001].includes(Number(member?.errcode)))accessTokenProvider.invalidate?.(token);return false;}
    return member.userid===pair.open_userid&&member.status===1&&(member.enable===undefined||member.enable===1);
   }catch{return false;}
  })();
  try{return await Promise.race([operation,deadline]);}finally{controller.abort();clearTimeout(timer);}
 }};
}
