import { WeComOAuthError } from './p2-g2-wecom-web-oauth.mjs';

export async function readWeComResponse(response,signal){
  if(!response.ok||!response.body){await response.body?.cancel().catch(()=>{});throw new Error('response');}
  const reader=response.body.getReader();const chunks=[];let length=0;
  try{for(;;){signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;
    length+=value.byteLength;if(length>65536)throw new Error('size');chunks.push(Buffer.from(value));}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

// The token must belong to the configured enterprise application, not the smart bot.
export function createWeComOAuthCodeResolver({accessTokenProvider,fetchImpl=fetch}={}) {
  if(typeof accessTokenProvider!=='function')throw new TypeError('WECOM_TOKEN_PROVIDER_REQUIRED');
  let inFlight=false;
  const resolve = async code=>{
    if(typeof code!=='string'||!code||Buffer.byteLength(code)>512)throw new WeComOAuthError('WECOM_AUTH_REQUIRED');
    if(inFlight)throw new WeComOAuthError('WECOM_AUTH_BUSY',503);
    inFlight=true;
    const controller=new AbortController(),signal=controller.signal;
    let timer;
    const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new WeComOAuthError('WECOM_AUTH_UNAVAILABLE',502));},5000);});
    const operation=(async()=>{try{
      const token=await accessTokenProvider({signal});signal.throwIfAborted();
      if(typeof token!=='string'||!token||token.length>4096)throw new Error('token');
      const url=new URL('https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo');
      url.searchParams.set('access_token',token);url.searchParams.set('code',code);
      const response=await fetchImpl(url,{method:'GET',redirect:'error',signal});
      const body=await readWeComResponse(response,signal);
      // Only token-specific failures invalidate the application-wide cache.
      // Never replay this one-time OAuth code; the next login obtains a fresh token.
      if(body?.errcode!==0){if([40014,42001].includes(body?.errcode))accessTokenProvider.invalidate?.(token);throw new Error('provider');}
      if(typeof body.userid!=='string'||!body.userid||Buffer.byteLength(body.userid)>64||/[\/\s\x00-\x1f\x7f]/u.test(body.userid))
        throw new WeComOAuthError('WECOM_MEMBER_REQUIRED',403);
      return {userid:body.userid};
    }catch(error){
      if(error instanceof WeComOAuthError)throw error;
      throw new WeComOAuthError('WECOM_AUTH_UNAVAILABLE',502);
    }finally{inFlight=false;}})();
    // A non-cooperative provider stays fenced until it settles; do not accumulate background calls.
    try{return await Promise.race([operation,deadline]);}finally{controller.abort();clearTimeout(timer);}
  };
  resolve.isBusy=()=>inFlight;
  return resolve;
}
