declare const tokenKind: unique symbol;
export type OAuthState = string & { readonly [tokenKind]: 'state' };
export type BrowserToken = string & { readonly [tokenKind]: 'browser' };
export type SessionToken = string & { readonly [tokenKind]: 'session' };
declare const identityKind: unique symbol;
export type InternalMemberId = string & { readonly [identityKind]: 'internal' };
export type OpenMemberId = string & { readonly [identityKind]: 'open' };
export type InternalReturnPath = string & { readonly [identityKind]: 'return-path' };
export interface OAuthMember { corpId: string; userid: InternalMemberId }
export interface WeComOAuthOptions { enabled?: boolean | undefined; corpId?: string | undefined; agentId?: string | undefined; publicOrigin?: string | undefined; resolveCode?: ((code: string, options: { signal: AbortSignal }) => Promise<unknown>) | undefined; now?: (() => number) | undefined }
interface BrowserBinding { expires: number; group: object }
interface PendingIntent { browser: string; returnPath: InternalReturnPath; binding: BrowserBinding; expires: number }
interface MemberSession extends OAuthMember { expires: number; browser: string; group: object }
export type EnabledWeComOAuth = ReturnType<typeof createWeComWebOAuth> & { enabled: true };
export type WeComOAuth = ReturnType<typeof createWeComWebOAuth>;
import { createHash, randomBytes } from 'node:crypto';
import {types} from 'node:util';

const random=()=>randomBytes(32).toString('hex');
const hash=(value: string)=>createHash('sha256').update(value).digest('hex');
const token=(value: unknown): value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
export class WeComOAuthError extends Error {
  declare code: string; declare status: number;
  constructor(code: string,status=401){super(code);this.code=code;this.status=status;}
}
const fail: (code?: string, status?: number) => never=(code='WECOM_AUTH_REQUIRED',status=401)=>{throw new WeComOAuthError(code,status);};

// Ephemeral authentication only: no Ticket permissions or staff principal is minted here.
export function createWeComWebOAuth({enabled=false,corpId,agentId,publicOrigin,resolveCode,now=Date.now}: WeComOAuthOptions={}) {
  if(enabled!==true)return Object.freeze({enabled:false as const});
  const origin=new URL(publicOrigin as string);
  if(origin.protocol!=='https:'||origin.origin!==publicOrigin||typeof corpId!=='string'||!corpId||corpId.length>128
    ||!/^\d{1,20}$/u.test(agentId as string)||typeof resolveCode!=='function')throw new TypeError('WECOM_OAUTH_CONFIG_INVALID');
  const pending=new Map<string, PendingIntent>(),sessions=new Map<string, MemberSession>(),codes=new Map<string, { expires: number }>(),browsers=new Map<string, BrowserBinding>();let busy=false,closed=false;
  const sweep=()=>{for(const map of [pending,sessions,codes,browsers])for(const [key,value] of map)if(value.expires<=now())map.delete(key);};
  function browserBinding(browserToken: BrowserToken | null | undefined): BrowserToken{
    if(closed)fail('WECOM_AUTH_UNAVAILABLE',503);
    sweep();
    if(token(browserToken)&&browsers.has(hash(browserToken))){(browsers.get(hash(browserToken)) as BrowserBinding).expires=now()+1200000;return browserToken;}
    if(browsers.size>=1024)fail('WECOM_AUTH_BUSY',503);
    const value=random();browsers.set(hash(value),{expires:now()+1200000,group:{}});return value as BrowserToken;
  }
  return Object.freeze({enabled:true as const,scope:Object.freeze({corpId:corpId as string,agentId:agentId as string}),
    browserBinding,
    browserValid(browserToken: BrowserToken | null | undefined){sweep();return !closed&&token(browserToken)&&browsers.has(hash(browserToken));},
    sameBrowserBinding(a: BrowserToken | null, b: BrowserToken | null){sweep();return token(a)&&token(b)&&browsers.has(hash(a))&&(browsers.get(hash(a)) as BrowserBinding).group===browsers.get(hash(b))?.group;},
    joinBrowserBindings(values: readonly (BrowserToken | null)[]){
      sweep();if(!Array.isArray(values)||values.length>64)fail('WECOM_AUTH_BUSY',503);
      const groups=new Set((values.filter(token) as string[]).map(v=>browsers.get(hash(v))?.group).filter(Boolean));
      if(groups.size<2)return;
      const group=groups.values().next().value as object;
      for(const entry of browsers.values())if(groups.has(entry.group))entry.group=group;
      for(const session of sessions.values())if(groups.has(session.group))session.group=group;
    },
    begin({browserToken=null,returnPath='/wecom/yixiaoxiu/'}: { browserToken?: BrowserToken | null; returnPath?: unknown }={}){
      if(closed)fail('WECOM_AUTH_UNAVAILABLE',503);
      sweep();if(pending.size>=1024)fail('WECOM_AUTH_BUSY',503);
      if(typeof returnPath!=='string'||!/^\/wecom\/yixiaoxiu\/(?:\?auth_return=1|tickets\/[A-Za-z0-9_-]{32}|continue\/[a-f0-9]{64})?$/u.test(returnPath))fail('WECOM_AUTH_REQUIRED',400);
      browserToken=browserBinding(browserToken);
      const browser=hash(browserToken);
      if([...pending.values()].filter(v=>v.binding.group===(browsers.get(browser) as BrowserBinding).group).length>=8)fail('WECOM_AUTH_BUSY',503);
      const state=random();
      pending.set(hash(state),{browser,returnPath:returnPath as InternalReturnPath,binding:(browsers.get(browser) as BrowserBinding),expires:now()+300000});
      const url=new URL('https://open.weixin.qq.com/connect/oauth2/authorize');
      for(const [key,value] of Object.entries({appid:corpId as string,redirect_uri:publicOrigin+'/wecom/yixiaoxiu/callback',response_type:'code',scope:'snsapi_base',state,agentid:agentId as string}))url.searchParams.set(key,value);
      url.hash='wechat_redirect';return {location:url.href,browserToken};
    },
    async complete({state,browserToken,code}: {state?: OAuthState | null; browserToken?: BrowserToken | null; code?: string | null}={}){
      if(closed)fail('WECOM_AUTH_UNAVAILABLE',503);
      sweep();if(!token(state)||!token(browserToken)||typeof code!=='string'||!code||Buffer.byteLength(code)>512)fail();
      const key=hash(state),entry=pending.get(key);
      if(!entry||entry.browser!==hash(browserToken)||browsers.get(entry.browser)!==entry.binding)fail();
      pending.delete(key); // Consume before any asynchronous I/O, including failed provider calls.
      const codeKey=hash(code);if(codes.has(codeKey))fail();
      if(busy||sessions.size>=1024||codes.size>=1024)fail('WECOM_AUTH_BUSY',503);
      codes.set(codeKey,{expires:now()+300000});busy=true;
      const controller=new AbortController();let timer: ReturnType<typeof setTimeout> | undefined;
      const operation=(async()=>{try{
        const identity=await (resolveCode as (code: string, options: { signal: AbortSignal; }) => Promise<unknown>)(code,{signal:controller.signal});
        if(controller.signal.aborted)fail('WECOM_AUTH_UNAVAILABLE',502);
        if(closed)fail('WECOM_AUTH_UNAVAILABLE',503);
        if(browsers.get(entry.browser)!==entry.binding||entry.expires<=now())fail();
        if(!identity||typeof identity!=='object'||types.isProxy(identity))fail('WECOM_MEMBER_REQUIRED',403);
        const descriptor=Object.getOwnPropertyDescriptor(identity,'userid'),userid=descriptor?.value;
        if(typeof userid!=='string'||!userid||Buffer.byteLength(userid)>64
          ||/[\/\s\x00-\x1f\x7f]/u.test(userid))fail('WECOM_MEMBER_REQUIRED',403);
        // Replacement is a server fact, independent of the Cookie snapshot captured by this request.
        const group=entry.binding.group;
        for(const [key,session] of sessions)if(session.group===group)sessions.delete(key);
        const sessionToken=random();sessions.set(hash(sessionToken),{corpId:corpId as string,userid:userid as InternalMemberId,expires:now()+900000,browser:entry.browser,group});
        entry.binding.expires=now()+1200000;
        return {sessionToken:sessionToken as SessionToken,maxAgeSeconds:900,returnPath:entry.returnPath};
      }catch(error){if(error instanceof WeComOAuthError)throw error;fail('WECOM_AUTH_UNAVAILABLE',502);}
      finally{busy=false;}})();
      const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new WeComOAuthError('WECOM_AUTH_UNAVAILABLE',502));},5000);});
      // A timed-out provider stays single-flight until its own promise settles.
      try{return await Promise.race([operation,deadline]);}finally{clearTimeout(timer);controller.abort();}
    },
    authenticate(sessionToken: SessionToken | null | undefined){sweep();if(!token(sessionToken))fail();const entry=sessions.get(hash(sessionToken));if(!entry)fail();return {corpId:entry.corpId,userid:entry.userid};},
    logout(sessionToken: SessionToken | null | undefined){if(token(sessionToken))sessions.delete(hash(sessionToken));},
    logoutBrowser(browserToken: BrowserToken | null | undefined){
      if(!token(browserToken))return;
      const group=browsers.get(hash(browserToken))?.group;if(!group)return;
      for(const [key,entry] of browsers)if(entry.group===group)browsers.delete(key);
      for(const [key,entry] of pending)if(entry.binding.group===group)pending.delete(key);
      for(const [key,entry] of sessions)if(entry.group===group)sessions.delete(key);
    },
    close(){closed=true;pending.clear();sessions.clear();codes.clear();browsers.clear();},
  });
}
