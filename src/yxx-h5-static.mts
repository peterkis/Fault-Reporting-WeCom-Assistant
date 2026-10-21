import {createHash} from 'node:crypto';
import {readFile,lstat} from 'node:fs/promises';
import type {ServerResponse} from 'node:http';
import {brotliDecompressSync,gunzipSync} from 'node:zlib';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const YXX_H5_SECURITY_HEADERS=Object.freeze({
 'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff',
 'content-security-policy':"default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; connect-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; font-src 'self'",
});
const MIME:Readonly<Record<string,string>>={js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',woff2:'font/woff2',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',svg:'image/svg+xml'};
const ASSET=/^assets\/[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(js|css|woff2|png|jpg|jpeg|webp|svg)$/u;
const HASHED=/-[A-Za-z0-9_-]{5,}\.(?:js|css|woff2|png|jpe?g|webp|svg)$/u;
const NON_PRODUCTION=/preview|fixture|(?:^|\/)(?:dev|docs|design-baseline)(?:\/|$)/iu;
const MAX_ASSET=20*1024*1024,MAX_CACHE=4*1024*1024;
type Encoding='identity'|'gzip'|'br';
type Representation={file:string;source:string;encoding:Encoding;bytes:number;sha256:string};
type Generation={root:URL;assets:Map<string,ReadonlyMap<Encoding,Representation>>;html:Buffer};
function unavailable():never{const e=new Error('YXX_UNAVAILABLE') as Error&{code:string;status:number};e.code='YXX_UNAVAILABLE';e.status=503;throw e;}
function object(v:unknown):Record<string,unknown>{if(v===null||typeof v!=='object'||Array.isArray(v))return unavailable();return v as Record<string,unknown>;}
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');

/** Prefer an available representation only when its quality permits it. */
function negotiate(header:string|undefined,available:ReadonlyMap<Encoding,Representation>):Representation|undefined{
 if(header===undefined)return available.get('identity');
 if(header.length>8192)return undefined;
 const qualities=new Map<string,number>();
 for(const token of header.split(',')){
  const [raw,...parameters]=token.trim().toLowerCase().split(';');if(!raw)continue;
  let quality=1;
  for(const parameter of parameters){const match=/^\s*q\s*=\s*(.*?)\s*$/u.exec(parameter);if(match){const value=match[1]??'';quality=/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/u.test(value)?Number(value):0;}}
  qualities.set(raw,Math.max(qualities.get(raw)??0,quality));
 }
 let selected:Representation|undefined,best=0;
 for(const encoding of ['br','gzip','identity'] as const){
  const quality=qualities.get(encoding)??(encoding==='identity'?(qualities.get('*')===0?0:1):(qualities.get('*')??0));
  const candidate=available.get(encoding);if(candidate&&quality>best){best=quality;selected=candidate;}
 }
 return selected;
}

/** Only compiled, manifest-declared H5 bytes are public. A previous generation is
 * opt-in and contributes assets only; its HTML can never replace the current page. */
export function createYxxH5Static({enabled=false,root=new URL('../h5/',import.meta.url),previousRoot}:{enabled?:boolean;root?:URL;previousRoot?:URL}={}){
 const directory=(value:URL)=>value.protocol==='file:'&&!value.search&&!value.hash&&value.pathname.endsWith('/');
 if(typeof enabled!=='boolean'||!(root instanceof URL)||!directory(root)||(previousRoot!==undefined&&(!(previousRoot instanceof URL)||!directory(previousRoot)||previousRoot.href===root.href)))unavailable();
 const cache=new Map<string,Buffer>();let cacheBytes=0,pageBytes=0;
 function trim(maximum:number):void{while(cacheBytes>maximum){const first=cache.entries().next().value;if(!first)break;cache.delete(first[0]);cacheBytes-=first[1].length;}}
 function remember(key:string,bytes:Buffer):void{
  const maximum=MAX_CACHE-pageBytes;if(bytes.length>maximum)return;
  const old=cache.get(key);if(old){cacheBytes-=old.length;cache.delete(key);}
  trim(maximum-bytes.length);
  cache.set(key,bytes);cacheBytes+=bytes.length;
 }
 async function regular(artifactRoot:URL,relative:string,maximum:number):Promise<Buffer>{
  // A trailing slash makes POSIX lstat resolve a directory link. Inspect each
  // native path without that separator; realpath would hide the link itself.
  let cursor=resolve(fileURLToPath(artifactRoot));
  const rootInfo=await lstat(cursor);if(rootInfo.isSymbolicLink()||!rootInfo.isDirectory())unavailable();
  const parts=relative.split('/');
  for(const [index,part]of parts.entries()){
   cursor=resolve(cursor,part);
   const info=await lstat(cursor);if(info.isSymbolicLink())unavailable();
   if(index<parts.length-1&&!info.isDirectory())unavailable();
   if(index===parts.length-1&&(!info.isFile()||info.size>maximum))unavailable();
  }
  const bytes=await readFile(cursor);if(bytes.length>maximum)unavailable();return bytes;
 }
 async function inventory(artifactRoot:URL,includePage=true):Promise<Generation>{
  const manifest=object(JSON.parse((await regular(artifactRoot,'.vite/manifest.json',256*1024)).toString('utf8')) as unknown);
  const files=new Set<string>(),visited=new Set<string>();
  function add(raw:unknown):void{if(typeof raw!=='string'||!ASSET.test(raw)||NON_PRODUCTION.test(raw))unavailable();files.add(raw);if(files.size>256)unavailable();}
  function entry(key:string):void{
   if(visited.has(key))return;visited.add(key);if(visited.size>256||NON_PRODUCTION.test(key))unavailable();
   const item=object(manifest[key]);if(typeof item.src==='string'&&NON_PRODUCTION.test(item.src))unavailable();add(item.file);
   for(const field of ['css','assets']){const list=item[field];if(list!==undefined){if(!Array.isArray(list)||list.length>256)unavailable();for(const file of list)add(file);}}
   for(const field of ['imports','dynamicImports']){const list=item[field];if(list!==undefined){if(!Array.isArray(list)||list.length>128)unavailable();for(const child of list){if(typeof child!=='string'||NON_PRODUCTION.test(child))unavailable();entry(child);}}}
  }
  const main=object(manifest['index.html']);if(main.isEntry!==true)unavailable();entry('index.html');
  const declared=new Map<string,Representation>();
  if(main.h5Representations!==undefined){
   if(!Array.isArray(main.h5Representations)||main.h5Representations.length>768)unavailable();
   for(const value of main.h5Representations){
    const item=object(value),{file,source,encoding,bytes,sha256}=item;
    if(typeof source!=='string'||!files.has(source)||typeof file!=='string'||declared.has(file)||typeof bytes!=='number'||!Number.isSafeInteger(bytes)||bytes<0||bytes>MAX_ASSET||typeof sha256!=='string'||!/^[a-f0-9]{64}$/u.test(sha256))unavailable();
    if(encoding!=='identity'&&encoding!=='gzip'&&encoding!=='br')unavailable();
    if(encoding==='identity'?file!==source:!(/\.(?:js|css)$/u.test(source)&&file===source+(encoding==='gzip'?'.gz':'.br')))unavailable();
    declared.set(file,{file,source,encoding,bytes,sha256});
   }
  }
  const assets=new Map<string,ReadonlyMap<Encoding,Representation>>();
  for(const source of files){
   const representations=new Map<Encoding,Representation>(),bytes=await regular(artifactRoot,source,MAX_ASSET);
   const identity=declared.get(source)??{file:source,source,encoding:'identity' as const,bytes:bytes.length,sha256:digest(bytes)};
   if(identity.encoding!=='identity'||identity.bytes!==bytes.length||identity.sha256!==digest(bytes)||main.h5Representations!==undefined&&!declared.has(source))unavailable();
   representations.set('identity',identity);remember(artifactRoot.href+source,bytes);
   for(const encoding of ['gzip','br'] as const){
    const file=source+(encoding==='gzip'?'.gz':'.br'),representation=declared.get(file);if(!representation)continue;
    const compressed=await regular(artifactRoot,file,MAX_ASSET);
    if(compressed.length!==representation.bytes||digest(compressed)!==representation.sha256)unavailable();
    const decoded=encoding==='gzip'?gunzipSync(compressed,{maxOutputLength:MAX_ASSET}):brotliDecompressSync(compressed,{maxOutputLength:MAX_ASSET});
    if(!decoded.equals(bytes))unavailable();representations.set(encoding,representation);remember(artifactRoot.href+file,compressed);
   }
   assets.set(source,representations);
  }
  const html=includePage?await regular(artifactRoot,'index.html',256*1024):Buffer.alloc(0);pageBytes+=html.length;trim(MAX_CACHE-pageBytes);
  return {root:artifactRoot,assets,html};
 }
 // One verification flight per instance, including failures. Replacing an artifact
 // requires a new instance, so a failed inventory never becomes an unverified retry.
 let current:Promise<Generation>|undefined,previous:Promise<Generation>|undefined;
 const generation=()=>current??=inventory(root);
 const oldGeneration=()=>previousRoot?(previous??=inventory(previousRoot,false)):undefined;
 async function bytesFor(item:Representation,from:Generation):Promise<Buffer>{
  const key=from.root.href+item.file,hit=cache.get(key);if(hit){cache.delete(key);cache.set(key,hit);return hit;}
  const bytes=await regular(from.root,item.file,MAX_ASSET);if(bytes.length!==item.bytes||digest(bytes)!==item.sha256)unavailable();remember(key,bytes);return bytes;
 }
 function notFound(response:ServerResponse,status=404):true{response.writeHead(status,{...YXX_H5_SECURITY_HEADERS,'content-type':'application/json','vary':'Accept-Encoding'});response.end(JSON.stringify({error:{code:status===406?'YXX_ENCODING_UNAVAILABLE':'YXX_NOT_FOUND',retryable:false}}));return true;}
 return Object.freeze({enabled,
  async page(response:ServerResponse){
   if(!enabled)return false;const active=await generation();
   response.writeHead(200,{...YXX_H5_SECURITY_HEADERS,'permissions-policy':'camera=(), microphone=(self), geolocation=()','content-type':'text/html; charset=utf-8','content-length':active.html.length});response.end(active.html);return true;
  },
  async asset(url:URL,response:ServerResponse){
   if(!enabled||!url.pathname.startsWith('/wecom/yixiaoxiu/assets/'))return false;
   const file=url.pathname.slice('/wecom/yixiaoxiu/'.length);if(url.search||!ASSET.test(file))return notFound(response);
   let active=await generation(),available=active.assets.get(file);
   if(!available){const old=await oldGeneration();if(old){active=old;available=old.assets.get(file);}}
   if(!available)return notFound(response);
   const requested=response.req.headers['accept-encoding'],item=negotiate(Array.isArray(requested)?requested.join(','):requested,available);if(!item)return notFound(response,406);
   const bytes=await bytesFor(item,active),extension=file.slice(file.lastIndexOf('.')+1);
   response.writeHead(200,{...YXX_H5_SECURITY_HEADERS,'cache-control':HASHED.test(file)?'public, max-age=31536000, immutable':'no-store','content-type':MIME[extension]??'application/octet-stream','content-length':bytes.length,'vary':'Accept-Encoding',...(item.encoding==='identity'?{}:{'content-encoding':item.encoding})});response.end(bytes);return true;
  },
 });
}
