import type {IncomingMessage,ServerResponse} from 'node:http';
import {readFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {brotliDecompressSync,gunzipSync} from 'node:zlib';
import {negotiateStaticEncoding,type StaticEncoding} from './static-encoding.mjs';

export const EMBEDDED_LOGIN_PATH='/workbench/desktop/embedded';
const ASSET_PREFIX='/workbench/desktop/assets/';
const ENTRY='src/login/main.ts';
const ASSET=/^assets\/[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(?:js|css)$/u;
const ROOT=new URL('../../../web/desktop-login/',import.meta.url);
const CSP="default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-src https://login.work.weixin.qq.com; img-src 'self' data:; font-src 'self'";
interface LoginRepresentation {encoding:StaticEncoding;body:Buffer}
interface LoginAssets {entry:string;styles:string[];representations:ReadonlyMap<string,ReadonlyMap<StaticEncoding,LoginRepresentation>>}
const MAX_ASSET_BYTES=4*1024*1024,MAX_PUBLIC_BYTES=16*1024*1024;
let assetsTask:Promise<LoginAssets>|null=null;
const record=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('LOGIN_ASSET_MANIFEST_INVALID');return value as Record<string,unknown>;};
function assets():Promise<LoginAssets>{
  if(assetsTask)return assetsTask;
  assetsTask=(async()=>{
    const manifest=record(JSON.parse(await readFile(new URL('.vite/manifest.json',ROOT),'utf8')) as unknown);
    const inventory:unknown=JSON.parse(await readFile(new URL('asset-inventory.json',ROOT),'utf8'));
    if(!Array.isArray(inventory)||!inventory.every((value:unknown)=>typeof value==='string'))throw Error('LOGIN_ASSET_INVENTORY_INVALID');
    const allowed=new Set<string>(),styles=new Set<string>(),seen=new Set<string>();
    const visit=(key:string):void=>{
      if(seen.has(key))return;seen.add(key);
      const item=record(manifest[key]);
      if(item.isEntry===true&&key!==ENTRY)throw Error('LOGIN_ASSET_ENTRY_BOUNDARY');
      if(typeof item.file!=='string'||!ASSET.test(item.file)||!inventory.includes(item.file))throw Error('LOGIN_ASSET_FILE_INVALID');
      allowed.add(item.file);
      for(const field of ['css','imports','dynamicImports'] as const){
        const values=item[field];if(values===undefined)continue;
        if(!Array.isArray(values)||!values.every((value:unknown)=>typeof value==='string'))throw Error('LOGIN_ASSET_REFERENCE_INVALID');
        for(const value of values){if(field!=='css'){visit(value);continue;}if(!ASSET.test(value)||!value.endsWith('.css')||!inventory.includes(value))throw Error('LOGIN_STYLE_INVALID');allowed.add(value);styles.add(value);}
      }
    };
    visit(ENTRY);const entry=record(manifest[ENTRY]).file;if(typeof entry!=='string')throw Error('LOGIN_ASSET_ENTRY_INVALID');
    if(allowed.size>32)throw Error('LOGIN_ASSET_LIMIT');
    const declared=record(manifest[ENTRY]).loginRepresentations;
    if(!Array.isArray(declared)||declared.length!==allowed.size*3)throw Error('LOGIN_REPRESENTATIONS_INVALID');
    const metadata=new Map<string,{source:string;encoding:StaticEncoding;bytes:number;sha256:string}>();
    for(const value of declared){
      const {file,source,encoding,bytes,sha256}=record(value);
      if(typeof source!=='string'||!allowed.has(source)||typeof file!=='string'||metadata.has(file)||typeof bytes!=='number'||!Number.isSafeInteger(bytes)||bytes<0||bytes>MAX_ASSET_BYTES||typeof sha256!=='string'||!/^[a-f0-9]{64}$/u.test(sha256))throw Error('LOGIN_REPRESENTATION_INVALID');
      if(encoding!=='identity'&&encoding!=='gzip'&&encoding!=='br')throw Error('LOGIN_REPRESENTATION_ENCODING_INVALID');
      if(file!==source+(encoding==='identity'?'':encoding==='gzip'?'.gz':'.br')||!inventory.includes(file))throw Error('LOGIN_REPRESENTATION_PATH_INVALID');
      metadata.set(file,{source,encoding,bytes,sha256});
    }
    let totalBytes=0;
    const verified=async(file:string,source:string,encoding:StaticEncoding)=>{
      const item=metadata.get(file);if(!item||item.source!==source||item.encoding!==encoding)throw Error('LOGIN_REPRESENTATION_MISSING');
      const url=new URL(file,ROOT),info=await lstat(url);if(!info.isFile()||info.isSymbolicLink()||info.size!==item.bytes)throw Error('LOGIN_REPRESENTATION_DRIFT');
      const body=await readFile(url);totalBytes+=body.length;
      if(totalBytes>MAX_PUBLIC_BYTES||body.length!==item.bytes||createHash('sha256').update(body).digest('hex')!==item.sha256)throw Error('LOGIN_REPRESENTATION_DRIFT');
      return body;
    };
    const representations=new Map<string,ReadonlyMap<StaticEncoding,LoginRepresentation>>();
    for(const source of allowed){
      const identity=await verified(source,source,'identity'),variants=new Map<StaticEncoding,LoginRepresentation>([['identity',{encoding:'identity',body:identity}]]);
      for(const encoding of ['gzip','br'] as const){
        const body=await verified(source+(encoding==='gzip'?'.gz':'.br'),source,encoding);
        const decoded=encoding==='gzip'?gunzipSync(body,{maxOutputLength:MAX_ASSET_BYTES}):brotliDecompressSync(body,{maxOutputLength:MAX_ASSET_BYTES});
        if(!decoded.equals(identity))throw Error('LOGIN_REPRESENTATION_CONTENT_DRIFT');
        variants.set(encoding,{encoding,body});
      }
      representations.set(source,variants);
    }
    return {entry,styles:[...styles],representations};
  })();
  return assetsTask;
}
const escape=(value:string)=>value.replace(/[&<>"']/gu,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]??char));
const publicAsset=(file:string)=>ASSET_PREFIX+file.slice('assets/'.length);
export interface EmbeddedLoginInput {corpId:string;agentId:string;state:string;issuedEpochMs:number;expiresEpochMs:number;publicOrigin:string}
export async function renderEmbeddedLogin(input:EmbeddedLoginInput):Promise<string>{
  const files=await assets();
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>医小修 · 扫码登录</title>${files.styles.map(file=>'<link rel="stylesheet" href="'+escape(publicAsset(file))+'">').join('')}</head>
<body data-login-scene="loading" data-backdrop="pending"><div class="login-preparing" role="status" aria-label="正在加载"><div class="loader" aria-hidden="true"></div></div><div id="login-backdrop" aria-hidden="true" inert></div><main id="desktop-login" class="login-shell" data-corp-id="${escape(input.corpId)}" data-agent-id="${escape(input.agentId)}" data-state="${escape(input.state)}" data-issued="${String(input.issuedEpochMs)}" data-expires="${String(input.expiresEpochMs)}" data-callback="${escape(new URL('/workbench/callback',input.publicOrigin).href)}">
<header class="login-copy"><p class="login-brand"><span class="login-brand-mark" aria-hidden="true">+</span>医小修</p><h1>让每一次报修<span class="login-heading-line"><span>都有</span><span class="login-response">回应</span></span></h1></header>
<section class="login-content" aria-label="扫码进入工作台"><div id="lanyard-stage"></div><p class="login-gesture">试试拖动工牌</p><div class="login-panel-parking"><div id="wecom-panel" aria-label="企业微信扫码登录"></div></div><p id="login-status" role="status">正在准备二维码…</p></section></main>
<footer class="login-footer">成都市第三人民医院 <span class="login-footer-dot" aria-hidden="true"></span> <span class="login-footer-department">信息管理部</span><span class="login-footer-research">研发</span></footer>
<div class="login-options"><button id="login-more" type="button" aria-label="更多登录方式" title="更多登录方式" popovertarget="login-options-menu" aria-controls="login-options-menu" aria-expanded="false"><span id="login-more-icon" aria-hidden="true"></span></button></div>
<nav id="login-options-menu" class="login-options-menu" popover="auto" aria-label="更多登录方式"><button id="restart-login" type="button">重新获取二维码</button><button id="switch-login-view" type="button">使用平面扫码</button><a href="/workbench/desktop">使用官方登录页</a><button id="quit-desktop" type="button" hidden>退出程序</button></nav>
<noscript><p class="login-noscript">请启用JavaScript，或<a href="/workbench/desktop">使用官方登录页</a>。</p></noscript><script type="module" src="${escape(publicAsset(files.entry))}"></script></body></html>`;
}
export const embeddedLoginHeaders=()=>({'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':CSP,'referrer-policy':'origin'});
export async function serveEmbeddedLoginAsset(request:Pick<IncomingMessage,'method'|'headers'>,response:ServerResponse,url:URL):Promise<boolean>{
  if(!url.pathname.startsWith(ASSET_PREFIX))return false;
  const relative='assets/'+url.pathname.slice(ASSET_PREFIX.length);
  if(!['GET','HEAD'].includes(request.method??'')||url.search||!ASSET.test(relative)){
    response.writeHead(400,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'});response.end('无效的登录资源请求');return true;
  }
  const files=await assets();
  const available=files.representations.get(relative);
  if(!available){response.writeHead(404,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'});response.end('登录资源不存在');return true;}
  const header=request.headers['accept-encoding'],selected=negotiateStaticEncoding(Array.isArray(header)?header.join(','):header,available);
  if(!selected){response.writeHead(406,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store','vary':'Accept-Encoding'});response.end('没有可接受的登录资源编码');return true;}
  const {body,encoding}=selected;
  response.writeHead(200,{'content-type':relative.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8','content-length':String(body.length),'cache-control':'public, max-age=31536000, immutable','x-content-type-options':'nosniff','vary':'Accept-Encoding',...(encoding==='identity'?{}:{'content-encoding':encoding})});response.end(request.method==='HEAD'?undefined:body);return true;
}
