declare const tokenKind: unique symbol;
export type OAuthState = string & { readonly [tokenKind]: 'state' };
export type BrowserToken = string & { readonly [tokenKind]: 'browser' };
export type SessionToken = string & { readonly [tokenKind]: 'session' };
declare const identityKind: unique symbol;
declare const oauthIdentityKind: unique symbol;
export type OAuthMemberId = string & { readonly [oauthIdentityKind]: 'oauth-member' };
export type InternalMemberId = string & { readonly [identityKind]: 'internal' };
export type OpenMemberId = string & { readonly [identityKind]: 'open' };
export type InternalReturnPath = string & { readonly [identityKind]: 'return-path' };
export interface OAuthMember { corpId: string; userid: OAuthMemberId }
export interface WeComOAuthOptions { enabled?: boolean | undefined; h5Session?: boolean | undefined; corpId?: string | undefined; agentId?: string | undefined; publicOrigin?: string | undefined; resolveCode?: ((code: string, options: { signal: AbortSignal }) => Promise<unknown>) | undefined; now?: (() => number) | undefined }
interface BrowserBinding { expires: number; group: object }
interface PendingIntent { browser: string; returnPath: InternalReturnPath; binding: BrowserBinding; expires: number }
interface MemberSession extends OAuthMember { expires: number; absoluteExpires: number; browser: string; binding: BrowserBinding; group: object }
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
const h5IdleMs=8*60*60*1000,h5AbsoluteMs=24*60*60*1000;
const h5ReturnPrefix='/wecom/yixiaoxiu/?auth_return=1#';

/** Only a bounded SPA destination is stored in an opaque server-side OAuth intent. */
export function h5OAuthReturnPath(returnTo:unknown):InternalReturnPath {
  if(typeof returnTo!=='string'||Buffer.byteLength(returnTo)>1024||/[\\#\x00-\x1f\x7f]/u.test(returnTo)||/%(?![a-f0-9]{2})/iu.test(returnTo))fail('WECOM_AUTH_REQUIRED',400);
  const separator=returnTo.indexOf('?'),pathname=separator<0?returnTo:returnTo.slice(0,separator),search=separator<0?'':returnTo.slice(separator+1);
  if(!/^\/(?:report|reports|department|requests\/[A-Za-z0-9_-]{32})?$/u.test(pathname))fail('WECOM_AUTH_REQUIRED',400);
  const allowed=pathname==='/reports'?['search','status','source']:pathname==='/department'?['search','status']:[];
  if(separator>=0&&(allowed.length===0||!search))fail('WECOM_AUTH_REQUIRED',400);
  const params=new URLSearchParams(search);
  for(const [key,value]of params){
    if(!allowed.includes(key)||params.getAll(key).length!==1||/[\x00-\x1f\x7f]/u.test(value))fail('WECOM_AUTH_REQUIRED',400);
    if(key==='search'&&([...value.trim()].length>100||Buffer.byteLength(value.trim())>400))fail('WECOM_AUTH_REQUIRED',400);
    if(key==='status'&&!['OPEN','ACTIVE','COMPLETED'].includes(value)||key==='source'&&!['WEB','BOT'].includes(value))fail('WECOM_AUTH_REQUIRED',400);
  }
  // Serialize a header-safe path even when the caller supplies a Unicode filter.
  const target=new URL(returnTo,'https://h5-return.invalid');
  return h5ReturnPrefix+target.pathname+target.search as InternalReturnPath;
}

// Ephemeral authentication only: no Ticket permissions or staff principal is minted here.
export function createWeComWebOAuth({enabled=false,h5Session=false,corpId,agentId,publicOrigin,resolveCode,now=Date.now}: WeComOAuthOptions={}) {
  if(enabled!==true)return Object.freeze({enabled:false as const});
  const origin=new URL(publicOrigin as string);
  if(origin.protocol!=='https:'||origin.origin!==publicOrigin||typeof corpId!=='string'||!corpId||corpId.length>128
    ||!/^\d{1,20}$/u.test(agentId as string)||typeof resolveCode!=='function'||typeof h5Session!=='boolean')throw new TypeError('WECOM_OAUTH_CONFIG_INVALID');
  const pending=new Map<string, PendingIntent>(),sessions=new Map<string, MemberSession>(),codes=new Map<string, { expires: number }>(),browsers=new Map<string, BrowserBinding>();let busy=false,closed=false,credentialsStarted=false;
  const sweep=()=>{for(const map of [pending,sessions,codes,browsers])for(const [key,value] of map)if(value.expires<=now())map.delete(key);};
  function browserBinding(browserToken: BrowserToken | null | undefined): BrowserToken{
    if(closed)fail('WECOM_AUTH_UNAVAILABLE',503);
    // A policy cannot be upgraded after any legacy credential was issued,
    // including credentials already removed by expiry/logout/sweep.
    credentialsStarted=true;
    sweep();
    if(token(browserToken)&&browsers.has(hash(browserToken))){(browsers.get(hash(browserToken)) as BrowserBinding).expires=now()+(h5Session?h5AbsoluteMs:1200000);return browserToken;}
    if(browsers.size>=1024)fail('WECOM_AUTH_BUSY',503);
    const value=random();browsers.set(hash(value),{expires:now()+(h5Session?h5AbsoluteMs:1200000),group:{}});return value as BrowserToken;
  }
  return Object.freeze({enabled:true as const,get h5Session(){return h5Session;},get browserMaxAgeSeconds(){return h5Session?h5AbsoluteMs/1000:1200;},scope:Object.freeze({corpId:corpId as string,agentId:agentId as string}),
    enableH5Session(){
      if(closed||!h5Session&&credentialsStarted)throw new TypeError('WECOM_OAUTH_CONFIG_INVALID');
      h5Session=true;
    },
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
      if(typeof returnPath!=='string')fail('WECOM_AUTH_REQUIRED',400);
      if(!/^\/wecom\/yixiaoxiu\/(?:\?auth_return=1|tickets\/[A-Za-z0-9_-]{32}|continue\/[a-f0-9]{64})?$/u.test(returnPath)
        &&!(h5Session&&returnPath.startsWith(h5ReturnPrefix)&&h5OAuthReturnPath(returnPath.slice(h5ReturnPrefix.length))===returnPath))fail('WECOM_AUTH_REQUIRED',400);
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
        const descriptor=Object.getOwnPropertyDescriptor(identity,'userid'),userid:unknown=descriptor?.value;
        if(typeof userid!=='string'||!userid||Buffer.byteLength(userid)>64
          ||/[\/\s\x00-\x1f\x7f]/u.test(userid))fail('WECOM_MEMBER_REQUIRED',403);
        // Replacement is a server fact, independent of the Cookie snapshot captured by this request.
        const group=entry.binding.group;
        for(const [key,session] of sessions)if(session.group===group)sessions.delete(key);
        const issuedAt=now(),idleMs=h5Session?h5IdleMs:900000,absoluteExpires=issuedAt+(h5Session?h5AbsoluteMs:900000);
        const sessionToken=random();sessions.set(hash(sessionToken),{corpId:corpId as string,userid:userid as OAuthMemberId,expires:issuedAt+idleMs,absoluteExpires,browser:entry.browser,binding:entry.binding,group});
        entry.binding.expires=issuedAt+(h5Session?h5AbsoluteMs:1200000);
        return {sessionToken:sessionToken as SessionToken,maxAgeSeconds:idleMs/1000,browserMaxAgeSeconds:h5Session?h5AbsoluteMs/1000:1200,returnPath:entry.returnPath};
      }catch(error){if(error instanceof WeComOAuthError)throw error;fail('WECOM_AUTH_UNAVAILABLE',502);}
      finally{busy=false;}})();
      const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new WeComOAuthError('WECOM_AUTH_UNAVAILABLE',502));},5000);});
      // A timed-out provider stays single-flight until its own promise settles.
      try{return await Promise.race([operation,deadline]);}finally{clearTimeout(timer);controller.abort();}
    },
    authenticate(sessionToken: SessionToken | null | undefined){sweep();if(!token(sessionToken))fail();const entry=sessions.get(hash(sessionToken));if(!entry)fail();return {corpId:entry.corpId,userid:entry.userid};},
    renewH5Session({sessionToken,browserToken}:{sessionToken:SessionToken|null;browserToken:BrowserToken|null}){
      if(!h5Session)return null;
      sweep();if(closed||!token(sessionToken)||!token(browserToken))fail();
      const entry=sessions.get(hash(sessionToken)),at=now();
      if(!entry||entry.expires<=at||entry.absoluteExpires<=at||entry.browser!==hash(browserToken)||browsers.get(entry.browser)!==entry.binding||entry.binding.expires<=at||entry.binding.group!==entry.group)fail();
      // Synchronous after the complete READ terminal: no Provider, identity or token changes.
      entry.expires=Math.min(at+h5IdleMs,entry.absoluteExpires);
      // Another fresh intent may already own a later browser-binding lease.
      // Do not truncate its five-minute callback window at this older session's cap.
      entry.binding.expires=Math.max(entry.binding.expires,entry.absoluteExpires);
      return {maxAgeSeconds:Math.floor((entry.expires-at)/1000),browserMaxAgeSeconds:Math.floor((entry.absoluteExpires-at)/1000)};
    },
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
