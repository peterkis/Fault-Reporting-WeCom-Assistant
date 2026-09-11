import { createHash, randomBytes } from 'node:crypto';

const random=()=>randomBytes(32).toString('hex');
const hash=value=>createHash('sha256').update(value).digest('hex');
const token=value=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
export class WeComOAuthError extends Error {
  constructor(code,status=401){super(code);this.code=code;this.status=status;}
}
const fail=(code='WECOM_AUTH_REQUIRED',status=401)=>{throw new WeComOAuthError(code,status);};

// Ephemeral authentication only: no Ticket permissions or staff principal is minted here.
export function createWeComWebOAuth({enabled=false,corpId,agentId,publicOrigin,resolveCode,now=Date.now}={}) {
  if(enabled!==true)return Object.freeze({enabled:false});
  const origin=new URL(publicOrigin);
  if(origin.protocol!=='https:'||origin.origin!==publicOrigin||typeof corpId!=='string'||!corpId||corpId.length>128
    ||!/^\d{1,20}$/u.test(agentId)||typeof resolveCode!=='function')throw new TypeError('WECOM_OAUTH_CONFIG_INVALID');
  const pending=new Map(),sessions=new Map(),codes=new Map();let busy=false,closed=false;
  const sweep=()=>{for(const map of [pending,sessions,codes])for(const [key,value] of map)if(value.expires<=now())map.delete(key);};
  return Object.freeze({enabled:true,
    begin(){
      if(closed)fail('WECOM_AUTH_UNAVAILABLE',503);
      sweep();if(pending.size>=1024)fail('WECOM_AUTH_BUSY',503);
      const state=random(),browserToken=random();
      pending.set(hash(state),{browser:hash(browserToken),expires:now()+300000});
      const url=new URL('https://open.weixin.qq.com/connect/oauth2/authorize');
      for(const [key,value] of Object.entries({appid:corpId,redirect_uri:publicOrigin+'/wecom/yixiaoxiu/callback',response_type:'code',scope:'snsapi_base',state,agentid:agentId}))url.searchParams.set(key,value);
      url.hash='wechat_redirect';return {location:url.href,browserToken};
    },
    async complete({state,browserToken,code}={}){
      if(closed)fail('WECOM_AUTH_UNAVAILABLE',503);
      sweep();if(!token(state)||!token(browserToken)||typeof code!=='string'||!code||Buffer.byteLength(code)>512)fail();
      const key=hash(state),entry=pending.get(key);
      if(!entry||entry.browser!==hash(browserToken))fail();
      pending.delete(key); // Consume before any asynchronous I/O, including failed provider calls.
      const codeKey=hash(code);if(codes.has(codeKey))fail();
      if(busy||sessions.size>=1024||codes.size>=1024)fail('WECOM_AUTH_BUSY',503);
      codes.set(codeKey,{expires:now()+300000});busy=true;
      try{
        const identity=await resolveCode(code);
        if(closed)fail('WECOM_AUTH_UNAVAILABLE',503);
        if(typeof identity?.userid!=='string'||!identity.userid||Buffer.byteLength(identity.userid)>64
          ||/[\/\s\x00-\x1f\x7f]/u.test(identity.userid))fail('WECOM_MEMBER_REQUIRED',403);
        const sessionToken=random();sessions.set(hash(sessionToken),{corpId,userid:identity.userid,expires:now()+900000});
        return {sessionToken,maxAgeSeconds:900};
      }catch(error){if(error instanceof WeComOAuthError)throw error;fail('WECOM_AUTH_UNAVAILABLE',502);}
      finally{busy=false;}
    },
    authenticate(sessionToken){sweep();if(!token(sessionToken))fail();const entry=sessions.get(hash(sessionToken));if(!entry)fail();return {corpId:entry.corpId,userid:entry.userid};},
    logout(sessionToken){if(token(sessionToken))sessions.delete(hash(sessionToken));},
    close(){closed=true;pending.clear();sessions.clear();codes.clear();},
  });
}
