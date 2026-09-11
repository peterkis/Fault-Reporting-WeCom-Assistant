import { WeComOAuthError } from './p2-g2-wecom-web-oauth.mjs';
import { readWeComResponse } from './p2-g2-wecom-oauth-provider.mjs';

// One instance per enterprise application. Secrets and cached tokens never leave this closure.
export function createWeComAppTokenProvider({corpId,appSecret,fetchImpl=fetch,now=Date.now}={}){
  if(typeof corpId!=='string'||!corpId||corpId.length>128||typeof appSecret!=='string'||!appSecret||appSecret.length>512)
    throw new TypeError('WECOM_APP_CREDENTIALS_REQUIRED');
  let cached=null,refresh=null,inFlight=false,nextAttempt=0;
  const unavailable=()=>new WeComOAuthError('WECOM_TOKEN_UNAVAILABLE',502);
  const provider=async({signal}={})=>{
    signal?.throwIfAborted();
    if(cached&&cached.refreshAt>now())return cached.token;
    if(refresh)return refresh;
    if(inFlight||now()<nextAttempt)throw unavailable();
    inFlight=true;nextAttempt=now()+30000;
    const controller=new AbortController();let timer;
    const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(unavailable());},5000);});
    const started=now();
    const operation=(async()=>{try{
      const url=new URL('https://qyapi.weixin.qq.com/cgi-bin/gettoken');url.searchParams.set('corpid',corpId);url.searchParams.set('corpsecret',appSecret);
      const body=await readWeComResponse(await fetchImpl(url,{method:'GET',redirect:'error',signal:controller.signal}),controller.signal);
      controller.signal.throwIfAborted();
      if(body?.errcode!==0||typeof body.access_token!=='string'||!body.access_token||Buffer.byteLength(body.access_token)>512
        ||!Number.isSafeInteger(body.expires_in)||body.expires_in<=0||body.expires_in>86400)throw unavailable();
      const lifetime=body.expires_in*1000;
      cached={token:body.access_token,refreshAt:started+lifetime-Math.min(60000,lifetime/10)};
      if(cached.refreshAt<=now())throw unavailable();
      return cached.token;
    }catch{cached=null;throw unavailable();}finally{inFlight=false;}})();
    refresh=Promise.race([operation,deadline]).finally(()=>{controller.abort();clearTimeout(timer);refresh=null;});
    return refresh;
  };
  provider.invalidate=token=>{if(cached?.token===token)cached=null;};
  return Object.freeze(provider);
}
