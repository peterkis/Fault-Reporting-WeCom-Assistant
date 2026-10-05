import type {IncomingMessage,ServerResponse,OutgoingHttpHeaders} from 'node:http';
import type {EnabledWeComOAuth,SessionToken,OAuthMember} from './p2-g2-wecom-web-oauth.mjs';
import type {OAuthHttpContext,OAuthHttpHandler} from './p2-g2-wecom-oauth-http.mjs';
import type {YxxSelfServiceCommand} from './yxx-self-service-command.mjs';
import type {createYxxSelfServiceSupplement} from './yxx-self-service-supplement.mjs';
import type {createYxxSelfServiceQuery,YxxQueryInput} from './yxx-self-service-query.mjs';
import type {YxxProfile} from './p2-g2-yixiaoxiu-contract.mjs';
import type {YxxMemberFlags,YxxMemberSource} from './yxx-self-service-authorization.mjs';
import type {ServiceCatalog} from './p2-007-service-catalog.mjs';
type MemberServiceCatalog=Pick<ServiceCatalog,'catalog_version'|'listServices'>;
type RawAuth=Record<string,unknown>;
type ErrorFields={code?:string;status?:number};
export interface YxxNativeHttpOptions {publicOrigin:string;oauth:EnabledWeComOAuth;oauthHttp:OAuthHttpHandler|null;command:Pick<YxxSelfServiceCommand,'accept'>;supplement:Pick<ReturnType<typeof createYxxSelfServiceSupplement>,'accept'>;query:Pick<ReturnType<typeof createYxxSelfServiceQuery>,'list'|'detailWithEtag'|'timeline'|'commandStatus'>;authenticateMember:(input:{request:IncomingMessage;sessionToken:SessionToken;member:OAuthMember})=>unknown|Promise<unknown>;profile?:Extract<YxxProfile,'MEMBER_SELF_SERVICE'|'FULL_SERVICE_LOOP'>;featureFlags?:unknown;sessionCookieName?:typeof sessionName;recoveryBindingSecret:unknown;serviceCatalog?:MemberServiceCatalog|null}
import { readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { beginWeComOAuth, logoutWeComBrowser, sessionName } from './p2-g2-wecom-oauth-http.mjs';

const ROOT = '/wecom/yixiaoxiu/';
const REQUEST_REF = /^[A-Za-z0-9_-]{32}$/u;
const COMMAND_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ASSETS:Readonly<Record<string,readonly [string,string]>> = Object.freeze({
  '/wecom/yixiaoxiu/self-service.js': ['self-service.js', 'text/javascript'],
  '/wecom/yixiaoxiu/self-service.css': ['self-service.css', 'text/css'],
});
const FLAGS = Object.freeze(['YIXIAOXIU_SELF_SERVICE_ENABLED', 'YIXIAOXIU_MY_REPORTS_ENABLED']);
const BINDING_HASH = /^[a-f0-9]{64}$/u;
const HEADERS = Object.freeze({
  'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; font-src 'self'",
});

function error(code:string,status=400) {
  const value = new Error(code) as Error & {code:string;status:number}; value.code = code; value.status = status; return value;
}

function bool(value:unknown) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false' || value === undefined || value === null) return false;
  throw error('YXX_CONFIG_INVALID', 503);
}

function flags(value:unknown = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !FLAGS.includes(key))) throw error('YXX_CONFIG_INVALID', 503);
  return Object.freeze({
    YIXIAOXIU_SELF_SERVICE_ENABLED: bool((value as RawAuth).YIXIAOXIU_SELF_SERVICE_ENABLED),
    YIXIAOXIU_MY_REPORTS_ENABLED: bool((value as RawAuth).YIXIAOXIU_MY_REPORTS_ENABLED),
  });
}

function json(response:ServerResponse,status:number,body:unknown,extra:OutgoingHttpHeaders={}) {
  response.writeHead(status, { ...HEADERS, 'content-type': 'application/json; charset=utf-8', ...extra });
  response.end(status === 304 ? undefined : JSON.stringify(body));
}

function page(response:ServerResponse,status:number,title:string,message:string) {
  response.writeHead(status, { ...HEADERS, 'content-type': 'text/html; charset=utf-8' });
  const safeTitle = String(title).replace(/[<&>]/gu, '');
  const safeMessage = String(message).replace(/[<&>]/gu, '');
  response.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title></head><body><main><h1>${safeTitle}</h1><p>${safeMessage}</p><a href="${ROOT}">返回医小修</a></main></body></html>`);
}

function header(request:IncomingMessage,name:string) {
  const value = request.headers[name] ?? request.headers[name.toLowerCase()];
  return Array.isArray(value) ? null : typeof value === 'string' ? value : null;
}

function cookie(request:IncomingMessage,name:string):SessionToken|null {
  const values = (request.headers.cookie ?? '').split(';').map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`));
  return values.length === 1 ? (values[0] as string).slice(name.length + 1) as SessionToken : null;
}

function cookieSeen(request:IncomingMessage,name:string) {
  return (request.headers.cookie ?? '').split(';').some((part) => part.trim().startsWith(`${name}=`));
}

async function body(request:IncomingMessage,maximum:number):Promise<Record<string,unknown>> {
  if (((header(request, 'content-type') ?? '').split(';', 1)[0] as string).trim().toLowerCase() !== 'application/json') {
    throw error('YXX_CONTENT_TYPE_INVALID', 415);
  }
  const chunks:Buffer[] = []; let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > maximum) throw error('YXX_BODY_TOO_LARGE', 413);
    chunks.push(chunk);
  }
  try {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    const value:unknown = JSON.parse(source);
    // JSON.parse validates grammar; walk its lexical tokens to retain duplicate
    // object keys (including escaped equivalents) before their values disappear.
    const tokens = source.match(/"(?:[^"\\]|\\.)*"|[{}\[\]:,]|[^\s{}\[\]:,"]+/gu) ?? [];
    const objects:(Set<string>|null)[] = [];
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index] as string;
      if (token === '{' || token === '[') {
        if (objects.length >= 32) throw new Error('depth');
        objects.push(token === '{' ? new Set() : null);
      } else if (token === '}' || token === ']') objects.pop();
      else if (token.startsWith('"') && tokens[index + 1] === ':') {
        const key:string = JSON.parse(token), keys = objects.at(-1);
        if (!keys || keys.has(key)) throw new Error('duplicate key');
        keys.add(key);
      }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('shape');
    return value as Record<string,unknown>;
  } catch { throw error('YXX_INPUT_INVALID'); }
}

function assertOrigin(request:IncomingMessage,publicOrigin:string) {
  if (header(request, 'origin') !== publicOrigin || header(request, 'sec-fetch-site') === 'cross-site') {
    throw error('YXX_ORIGIN_INVALID', 403);
  }
}

function safeFlags(context:RawAuth,configured:YxxMemberFlags) {
  const selected = flags(context?.flags ?? configured);
  if (selected.YIXIAOXIU_SELF_SERVICE_ENABLED !== configured.YIXIAOXIU_SELF_SERVICE_ENABLED
    || selected.YIXIAOXIU_MY_REPORTS_ENABLED !== configured.YIXIAOXIU_MY_REPORTS_ENABLED) throw error('YXX_MEMBER_READ_DISABLED', 403);
  return selected;
}

function safeProfile(context:RawAuth,configuredProfile:YxxProfile) {
  if (!['MEMBER_SELF_SERVICE', 'FULL_SERVICE_LOOP'].includes(context?.profile as string)
    || context.profile !== configuredProfile) throw error('YXX_MEMBER_READ_DISABLED', 403);
  return context.profile;
}

function mapError(value:unknown) {
  if ((value as ErrorFields|null)?.status) {
    const codes:Record<number,string> = { 400: 'YXX_INPUT_INVALID', 401: 'YXX_AUTH_REQUIRED', 403: 'YXX_FORBIDDEN',
      404: 'YXX_NOT_FOUND', 409: 'YXX_CONFLICT', 413: 'YXX_BODY_TOO_LARGE',
      415: 'YXX_CONTENT_TYPE_INVALID', 429: 'YXX_BUSY', 503: 'YXX_UNAVAILABLE' };
    const status = Object.hasOwn(codes, (value as ErrorFields).status as number) ? Number((value as ErrorFields).status as number) : 503;
    return error(/^YXX_[A-Z0-9_]+$/u.test((value as ErrorFields).code ?? '') ? (value as ErrorFields).code as string : (codes[status] as string), status);
  }
  if (value instanceof TypeError && ['YXX_INPUT_INVALID', 'YXX_CURSOR_INVALID', 'YXX_LIMIT_INVALID', 'YXX_REQUEST_REF_INVALID'].includes(value.message)) {
    return error('YXX_INPUT_INVALID', 400);
  }
  const code = String((value as ErrorFields|null)?.code ?? '');
  if (/AUTH_REQUIRED|MEMBER_REQUIRED|UNAUTHENTICATED/u.test(code)) return error('YXX_AUTH_REQUIRED', 401);
  if (/FORBIDDEN|READ_DISABLED|WRITE_DISABLED|CSRF|ORIGIN/u.test(code)) return error('YXX_FORBIDDEN', 403);
  if (/NOT_FOUND/u.test(code)) return error('YXX_NOT_FOUND', 404);
  if (/CONFLICT|VERSION/u.test(code)) return error('YXX_CONFLICT', 409);
  if (/TOO_LARGE|BODY/u.test(code)) return error('YXX_BODY_TOO_LARGE', 413);
  if (/CONTENT_TYPE/u.test(code)) return error('YXX_CONTENT_TYPE_INVALID', 415);
  if (/LIMIT|INVALID|INPUT/u.test(code)) return error('YXX_INPUT_INVALID', 400);
  return error('YXX_UNAVAILABLE', 503);
}

function nativePageMessage(status:number) {
  if (status === 401) return '认证已失效，请重新认证。';
  if (status === 403) return '当前账号没有此项权限。';
  return '当前页面暂不可用。';
}

function mapLogoutError(value:unknown) {
  const status = Number((value as ErrorFields|null)?.status);
  if (status === 403 || /ORIGIN/u.test(String((value as ErrorFields|null)?.code ?? ''))) return error('YXX_ENTRY_ORIGIN_INVALID', 403);
  if (status === 401 || /AUTH_REQUIRED|MEMBER_REQUIRED/u.test(String((value as ErrorFields|null)?.code ?? ''))) return error('YXX_ENTRY_AUTH_REQUIRED', 401);
  if (status === 404) return error('YXX_ENTRY_NOT_FOUND', 404);
  if (status === 429 || /BUSY/u.test(String((value as ErrorFields|null)?.code ?? ''))) return error('YXX_ENTRY_BUSY', 503);
  if (status >= 500 || /UNAVAILABLE|CONFIG/u.test(String((value as ErrorFields|null)?.code ?? ''))) return error('YXX_ENTRY_UNAVAILABLE', 503);
  return error('YXX_ENTRY_INPUT_INVALID', 400);
}

function memberError(value:unknown) {
  if ((value as ErrorFields|null)?.status === 403) return error('YXX_FORBIDDEN', 403);
  if (Number((value as ErrorFields|null)?.status) >= 500) return error('YXX_UNAVAILABLE', 503);
  if ((value as ErrorFields|null)?.status === 401 || /^(?:YXX|WECOM)_(?:AUTH_REQUIRED|MEMBER_REQUIRED)$/u.test((value as ErrorFields|null)?.code ?? '')) {
    return error('YXX_AUTH_REQUIRED', 401);
  }
  return error('YXX_UNAVAILABLE', 503);
}

function writeEnabled(profile:YxxProfile,configuredFlags:YxxMemberFlags) {
  return ['MEMBER_SELF_SERVICE', 'FULL_SERVICE_LOOP'].includes(profile)
    && configuredFlags.YIXIAOXIU_SELF_SERVICE_ENABLED === true
    && configuredFlags.YIXIAOXIU_MY_REPORTS_ENABLED === true;
}

function recoverySecret(value:unknown) {
  const selected = Buffer.isBuffer(value) ? Buffer.from(value) : typeof value === 'string' ? Buffer.from(value, 'utf8') : null;
  if (!selected || selected.length < 32 || selected.length > 512) throw error('YXX_CONFIG_INVALID', 503);
  return selected;
}

function recoveryScope(context:RawAuth,secret:Buffer) {
  const binding = context?.canonical_reporter_binding;
  const corp = context?.source_corp_scope;
  const app = context?.source_app_scope;
  if (typeof binding !== 'string' || !BINDING_HASH.test(binding)
    || typeof corp !== 'string' || corp.length < 1 || corp.length > 128
    || typeof app !== 'string' || app.length < 1 || app.length > 128) throw error('YXX_UNAVAILABLE', 503);
  return createHmac('sha256', secret).update(JSON.stringify([binding, corp, app]), 'utf8').digest('hex');
}

export function createYxxSelfServiceNativeHttp({
  publicOrigin, oauth, oauthHttp = null, command, supplement, query, authenticateMember,
  profile = 'MEMBER_SELF_SERVICE', featureFlags = {}, sessionCookieName = sessionName, recoveryBindingSecret, serviceCatalog = null,
}:YxxNativeHttpOptions={} as YxxNativeHttpOptions) {
  if (typeof publicOrigin !== 'string' || !oauth || typeof oauth.authenticate !== 'function'
    || typeof oauthHttp !== 'function' || !command?.accept || !supplement?.accept
    || !query?.list || !query?.detailWithEtag || !query?.timeline || !query?.commandStatus
    || typeof authenticateMember !== 'function' || !['MEMBER_SELF_SERVICE', 'FULL_SERVICE_LOOP'].includes(profile)
    || sessionCookieName !== sessionName) {
    throw error('YXX_CONFIG_INVALID', 503);
  }
  const origin = new URL(publicOrigin);
  const scopeSecret = recoverySecret(recoveryBindingSecret);
  const configuredFlags = flags(featureFlags);
  const configured = Object.freeze({ profile, flags: configuredFlags });
  const serviceEnabled = writeEnabled(profile, configuredFlags);
  const readEnabled = configuredFlags.YIXIAOXIU_MY_REPORTS_ENABLED;

  async function currentMember(request:IncomingMessage, { requireWrite = false } = {}) {
    const token = cookie(request, sessionCookieName);
    if (!token) throw error('YXX_AUTH_REQUIRED', 401);
    let member;
    try { member = oauth.authenticate(token); } catch (value) { throw memberError(value); }
    let context:unknown;
    try { context = await authenticateMember({ request, sessionToken: token, member }); } catch (value) { throw memberError(value); }
    if (!context || typeof context !== 'object' || Array.isArray(context)) throw error('YXX_AUTH_REQUIRED', 401);
    const selectedProfile = safeProfile(context as RawAuth, configured.profile);
    const selectedFlags = safeFlags(context as RawAuth, configured.flags);
    if (requireWrite && (!serviceEnabled || (context as RawAuth).write_flag !== true)) throw error('YXX_FORBIDDEN', 403);
    if (typeof (context as RawAuth).csrf_token !== 'string' || (context as {csrf_token:string}).csrf_token.length < 32 || (context as {csrf_token:string}).csrf_token.length > 128) throw error('YXX_UNAVAILABLE', 503);
    return Object.freeze({ profile: selectedProfile, flags: selectedFlags, csrf_token: (context as {csrf_token:string}).csrf_token,
      recovery_scope: recoveryScope(context as RawAuth, scopeSecret) });
  }

  async function asset(response:ServerResponse,item:readonly [string,string]) {
    const content = await readFile(new URL(`../web/p2-reporter/${item[0]}`, import.meta.url), 'utf8');
    response.writeHead(200, { ...HEADERS, 'content-type': `${item[1]}; charset=utf-8` }); response.end(content);
  }

  async function nativePage({ request, response, requestRef }:{request:IncomingMessage;response:ServerResponse;requestRef:string|null}) {
    if (!readEnabled) { page(response, 503, '医小修服务未启用', '当前仅保留原有认证提示。'); return true; }
    try {
      await currentMember(request, { requireWrite: serviceEnabled });
      if (requestRef) {
        const detail = await query.detailWithEtag({ request, requestRef });
        if (detail?.status !== 200) throw error(detail?.status === 404 ? 'YXX_NOT_FOUND' : 'YXX_UNAVAILABLE', detail?.status === 404 ? 404 : 503);
      }
    }
    catch (value) {
      const selected = mapError(value);
      if (selected.status === 401 && !cookieSeen(request, sessionCookieName)) {
        // Reuse the bounded homepage return marker. Native report URLs are not
        // OAuth callback destinations, and a missing cookie must not loop.
        try { beginWeComOAuth({ request, response, oauth, returnPath: `${ROOT}?auth_return=1` }); }
        catch (beginFailure) {
          const terminal = mapError(beginFailure);
          page(response, terminal.status, '医小修', nativePageMessage(terminal.status));
        }
        return true;
      }
      page(response, selected.status, '医小修', nativePageMessage(selected.status)); return true;
    }
    await asset(response, ['self-service.html', 'text/html']); return true;
  }

  const handler:OAuthHttpHandler = async ({ request, response, url: inputUrl }) => {
    if (!inputUrl.pathname.startsWith(ROOT) && !inputUrl.pathname.startsWith('/api/yixiaoxiu/')) return false;
    const url = new URL(request.url ?? '/', publicOrigin);
    const logoutRoute = request.method === 'POST' && url.pathname === `${ROOT}logout`;
    for (const [name, value] of Object.entries(HEADERS)) response.setHeader(name, value);
    try {
      if(request.headers.host!==origin.host)throw error('YXX_ORIGIN_INVALID',403);
      if(!(request.url as string).startsWith('/')||(request.url as string).startsWith('//')||(request.url as string).split('?')[0]!==url.pathname)throw error('YXX_INPUT_INVALID');
      if (url.origin !== origin.origin || Buffer.byteLength(request.url ?? '', 'utf8') > 2048) throw error('YXX_INPUT_INVALID');
      if (ASSETS[url.pathname]) {
        if (request.method !== 'GET' || url.search) throw error('YXX_NOT_FOUND', 404);
        await asset(response, ASSETS[url.pathname] as readonly [string,string]); return true;
      }
      if (request.method === 'GET' && url.pathname === ROOT && (url.search === '?auth_return=1' || url.search === '')) {
        if (url.search === '?auth_return=1') return oauthHttp({ request, response, url });
        if (!readEnabled) return oauthHttp({ request, response, url });
        try { await currentMember(request, { requireWrite: serviceEnabled }); await asset(response, ['self-service.html', 'text/html']); return true; }
        catch (value) {
          const selected = mapError(value);
          if (selected.status === 401) return await oauthHttp({ request, response, url });
          page(response, selected.status, '医小修', selected.status === 403 ? '当前账号没有此项权限。' : '服务暂时不可用，请稍后重试。');
          return true;
        }
      }
      if (request.method === 'POST' && url.pathname === `${ROOT}logout`) {
        if (url.search) throw error('YXX_INPUT_INVALID');
        assertOrigin(request, origin.origin);
        if (Object.keys(await body(request, 1024)).length !== 0) throw error('YXX_INPUT_INVALID');
        const cleared = logoutWeComBrowser({ request, oauth });
        json(response, 200, { logged_out: true }, { 'set-cookie': cleared }); return true;
      }
      const pageMatch = url.pathname.match(/^\/wecom\/yixiaoxiu\/reports(?:\/(new|[A-Za-z0-9_-]{32}))?$/u);
      if (request.method === 'GET' && pageMatch && !url.search) return await nativePage({ request, response, requestRef: pageMatch[1]?.length === 32 ? pageMatch[1] : null });

      if (url.pathname === '/api/yixiaoxiu/bootstrap' && request.method === 'GET') {
        if (url.search) throw error('YXX_INPUT_INVALID');
        if (!readEnabled) throw error('YXX_FORBIDDEN', 403);
        const context = await currentMember(request, { requireWrite: serviceEnabled });
        json(response, 200, { authenticated: true, identity_mode: 'MEMBER_SELF_SERVICE', read_only: !serviceEnabled,
          can_submit: serviceEnabled, can_supplement: serviceEnabled, csrf_token: (context as {csrf_token:string}).csrf_token,
          recovery_scope: context.recovery_scope }); return true;
      }
      if (url.pathname === '/api/yixiaoxiu/service-catalog' && request.method === 'GET') {
        if (url.search || header(request,'transfer-encoding') || Number(header(request,'content-length')??0)>0) throw error('YXX_INPUT_INVALID');
        if (header(request,'sec-fetch-site')==='cross-site' || header(request,'origin') && header(request,'origin')!==origin.origin) throw error('YXX_FORBIDDEN',403);
        if (!readEnabled || !serviceEnabled) throw error('YXX_FORBIDDEN',403);
        const before=await currentMember(request,{requireWrite:true});
        if (!serviceCatalog) throw error('YXX_UNAVAILABLE',503);
        const bounded=(value:unknown,max:number):string=>{
          if(typeof value!=='string'||!value.trim()||Array.from(value).length>max)throw error('YXX_UNAVAILABLE',503);
          return value;
        };
        const version=bounded(serviceCatalog.catalog_version,64);
        const enabled=serviceCatalog.listServices({enabledOnly:true}).filter(item=>item.enabled);
        if(enabled.length>200)throw error('YXX_UNAVAILABLE',503);
        const services=enabled.map(item=>{
          const code=bounded(item.service_code,64),category=bounded(item.category,64);
          if(!/^[A-Z][A-Z0-9_]*(?:\.[A-Z][A-Z0-9_]*)*$/u.test(code)||!/^[A-Z][A-Z0-9_]*$/u.test(category))throw error('YXX_UNAVAILABLE',503);
          return {service_code:code,name_zh:bounded(item.name_zh,80),category,category_name_zh:bounded(item.category_name_zh,80)};
        });
        const after=await currentMember(request,{requireWrite:true});
        if(before.recovery_scope!==after.recovery_scope||before.csrf_token!==after.csrf_token)throw error('YXX_FORBIDDEN',403);
        json(response,200,{schema_version:1,catalog_version:version,services});return true;
      }
      const listPath = url.pathname === '/api/yixiaoxiu/my-reports';
      if (listPath && request.method === 'GET') {
        const allowed = new Set(['source', 'cursor', 'limit']);
        if (url.searchParams.has('source') && !['WEB', 'BOT'].includes(url.searchParams.get('source') as string)) throw error('YXX_INPUT_INVALID');
        if ([...url.searchParams.keys()].some((key) => !allowed.has(key) || url.searchParams.getAll(key).length !== 1)) throw error('YXX_INPUT_INVALID');
        await currentMember(request);
        json(response, 200, await query.list({ request, source: url.searchParams.get('source') as YxxMemberSource|null, cursor: url.searchParams.get('cursor'), limit: url.searchParams.get('limit') })); return true;
      }
      if (url.pathname.startsWith('/api/yixiaoxiu/requests/') && ['GET', 'POST'].includes(request.method as string)) {
        const route = url.pathname.match(/^\/api\/yixiaoxiu\/requests\/([^/]*)(?:\/(timeline|supplements))?$/u);
        if (!route || !REQUEST_REF.test(route[1] as string)) throw error('YXX_INPUT_INVALID');
      }
      const detailMatch = url.pathname.match(/^\/api\/yixiaoxiu\/requests\/([A-Za-z0-9_-]{32})(?:\/timeline)?$/u);
      if (detailMatch && request.method === 'GET') {
        const timeline = url.pathname.endsWith('/timeline');
        const allowed = timeline ? new Set(['after', 'before', 'cursor', 'limit']) : new Set();
        if ([...url.searchParams.keys()].some((key) => !allowed.has(key) || url.searchParams.getAll(key).length !== 1)) throw error('YXX_INPUT_INVALID');
        const timelineCursor = timeline ? url.searchParams.get('cursor') : null;
        if (timelineCursor !== null && timelineCursor.length < 10) throw error('YXX_INPUT_INVALID');
        const ifNoneMatch = timeline ? null : header(request, 'if-none-match');
        if (ifNoneMatch !== null && ifNoneMatch.length > 256) throw error('YXX_INPUT_INVALID');
        await currentMember(request);
        if (timeline) {
          const requestedLimit = url.searchParams.get('limit');
          const timelineLimit = requestedLimit === null ? undefined : Number(requestedLimit);
          if (timelineLimit !== undefined && (!Number.isSafeInteger(timelineLimit) || timelineLimit < 1 || timelineLimit > 100)) throw error('YXX_INPUT_INVALID');
          json(response, 200, await query.timeline({ request, requestRef: detailMatch[1], after: url.searchParams.get('after'), before: url.searchParams.get('before'), cursor: timelineCursor, limit: timelineLimit })); return true;
        }
        const result = await query.detailWithEtag({ request, requestRef: detailMatch[1], ifNoneMatch });
        json(response, result.status, result.body, { etag: result.etag }); return true;
      }
      const supplementMatch = url.pathname.match(/^\/api\/yixiaoxiu\/requests\/([A-Za-z0-9_-]{32})\/supplements$/u);
      if (supplementMatch && request.method === 'POST') {
        if (url.search) throw error('YXX_INPUT_INVALID');
        assertOrigin(request, origin.origin); const input = await body(request, 8 * 1024); const context = await currentMember(request, { requireWrite: true });
        if (header(request, 'x-csrf-token') !== (context as RawAuth).csrf_token) throw error('YXX_FORBIDDEN', 403);
        const result = await supplement.accept({ request, input, requestRef: supplementMatch[1] });
        const latest = await currentMember(request, { requireWrite: true });
        if(latest.recovery_scope!==context.recovery_scope||latest.csrf_token!==(context as RawAuth).csrf_token)throw error('YXX_AUTH_RECHECK_FAILED',503);
        json(response, result.replayed ? 200 : 202, { ok: true, replayed: result.replayed === true, receipt: result.receipt,
          location: `${ROOT}reports/${result.receipt.request_ref}` }); return true;
      }
      const requestPath = url.pathname === '/api/yixiaoxiu/requests';
      if (requestPath && request.method === 'POST') {
        if (url.search) throw error('YXX_INPUT_INVALID');
        assertOrigin(request, origin.origin); const input = await body(request, 16 * 1024); const context = await currentMember(request, { requireWrite: true });
        if (header(request, 'x-csrf-token') !== (context as RawAuth).csrf_token) throw error('YXX_FORBIDDEN', 403);
        const result = await command.accept({ request, input });
        const latest = await currentMember(request, { requireWrite: true });
        if(latest.recovery_scope!==context.recovery_scope||latest.csrf_token!==(context as RawAuth).csrf_token)throw error('YXX_AUTH_RECHECK_FAILED',503);
        json(response, result.replayed ? 200 : 202, { ok: true, replayed: result.replayed === true, receipt: result.receipt,
          location: `${ROOT}reports/${result.receipt.request_ref}` }); return true;
      }
      const commandMatch = url.pathname.match(/^\/api\/yixiaoxiu\/commands(?:\/(.*))?$/u);
      if (commandMatch && request.method === 'GET') {
        if (url.search) throw error('YXX_INPUT_INVALID');
        if (!COMMAND_ID.test(commandMatch[1] as string)) throw error('YXX_INPUT_INVALID');
        await currentMember(request); json(response, 200, await query.commandStatus({ request, clientCommandId: commandMatch[1] })); return true;
      }
      return false;
    } catch (value) {
      const selected = logoutRoute ? mapLogoutError(value) : mapError(value);
      json(response, selected.status, { error: { code: selected.code, retryable: selected.status >= 500 } }); return true;
    }
  };
  return Object.freeze({ handler, configured, serviceEnabled });
}
