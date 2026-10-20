import {readFile,lstat} from 'node:fs/promises';
import type {ServerResponse} from 'node:http';

export const YXX_H5_SECURITY_HEADERS=Object.freeze({
 'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff',
 'content-security-policy':"default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; connect-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; font-src 'self'",
});
const MIME:Readonly<Record<string,string>>={js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',woff2:'font/woff2',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',svg:'image/svg+xml'};
const ASSET=/^assets\/[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(js|css|woff2|png|jpg|jpeg|webp|svg)$/u;
function unavailable():never{const e=new Error('YXX_UNAVAILABLE') as Error&{code:string;status:number};e.code='YXX_UNAVAILABLE';e.status=503;throw e;}
function object(v:unknown):Record<string,unknown>{if(v===null||typeof v!=='object'||Array.isArray(v))return unavailable();return v as Record<string,unknown>;}

/** Only compiled, manifest-declared H5 assets are public. Source/prototype/preview files are never served. */
export function createYxxH5Static({enabled=false,root=new URL('../h5/',import.meta.url)}:{enabled?:boolean;root?:URL}={}){
 if(typeof enabled!=='boolean')unavailable();
 async function regular(relative:string,maximum:number){
  const rootInfo=await lstat(root);if(rootInfo.isSymbolicLink()||!rootInfo.isDirectory())unavailable();
  const parts=relative.split('/');let cursor=root;
  for(let index=0;index<parts.length;index++){
   cursor=new URL(parts[index]+(index<parts.length-1?'/':''),cursor);
   const info=await lstat(cursor);if(info.isSymbolicLink())unavailable();
   if(index===parts.length-1&&(!info.isFile()||info.size>maximum))unavailable();
  }
  return readFile(cursor);
 }
 async function inventory(){
  const manifest=object(JSON.parse((await regular('.vite/manifest.json',256*1024)).toString('utf8')) as unknown);
  const files=new Set<string>(),visited=new Set<string>();
  function add(raw:unknown){if(typeof raw!=='string'||!ASSET.test(raw)||/preview|fixture/iu.test(raw))unavailable();files.add(raw);}
  function entry(key:string){
   if(visited.has(key))return;visited.add(key);if(visited.size>256)unavailable();
   if(/preview|fixture|(?:^|\/)(?:dev|docs|design-baseline)(?:\/|$)/iu.test(key))unavailable();
   const item=object(manifest[key]);if(typeof item.src==='string'&&/preview|fixture|(?:^|\/)(?:dev|docs|design-baseline)(?:\/|$)/iu.test(item.src))unavailable();add(item.file);
   for(const field of ['css','assets']){const list=item[field];if(list!==undefined){if(!Array.isArray(list)||list.length>256)unavailable();for(const file of list)add(file);}}
   for(const field of ['imports','dynamicImports']){const list=item[field];if(list!==undefined){if(!Array.isArray(list)||list.length>128)unavailable();for(const child of list){if(typeof child!=='string'||/preview|fixture|(?:^|\/)(?:dev|docs|design-baseline)(?:\/|$)/iu.test(child))unavailable();entry(child);}}}
  }
  const main=object(manifest['index.html']);if(main.isEntry!==true)unavailable();entry('index.html');return files;
 }
 return Object.freeze({enabled,
  async page(response:ServerResponse){
   if(!enabled)return false;await inventory();
   const html=await regular('index.html',256*1024);response.writeHead(200,{...YXX_H5_SECURITY_HEADERS,'content-type':'text/html; charset=utf-8'});response.end(html);return true;
  },
  async asset(url:URL,response:ServerResponse){
   if(!enabled||!url.pathname.startsWith('/wecom/yixiaoxiu/assets/'))return false;
   const file=url.pathname.slice('/wecom/yixiaoxiu/'.length);
   if(url.search||!ASSET.test(file)||(await inventory()).has(file)!==true){response.writeHead(404,{...YXX_H5_SECURITY_HEADERS,'content-type':'application/json'});response.end(JSON.stringify({error:{code:'YXX_NOT_FOUND',retryable:false}}));return true;}
   const bytes=await regular(file,20*1024*1024),extension=file.slice(file.lastIndexOf('.')+1);
   response.writeHead(200,{...YXX_H5_SECURITY_HEADERS,'content-type':MIME[extension]??'application/octet-stream','content-length':bytes.length});response.end(bytes);return true;
  },
 });
}
