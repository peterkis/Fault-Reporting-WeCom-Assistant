import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer,request as nativeRequest} from 'node:http';
import {lstatSync,mkdirSync,mkdtempSync,renameSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {brotliCompressSync,gzipSync} from 'node:zlib';
import {createYxxH5Static,YXX_H5_SECURITY_HEADERS} from '../src/yxx-h5-static.mjs';

const assets=new Map<string,{type:string;body:Uint8Array}>([
 ['assets/main-Ab123.js',{type:'text/javascript; charset=utf-8',body:Buffer.from('export const page="SYNTHETIC_H5_MAIN";')}],
 ['assets/shared-Cd456.js',{type:'text/javascript; charset=utf-8',body:Buffer.from('export const shared=true;')}],
 ['assets/detail-Ef789.js',{type:'text/javascript; charset=utf-8',body:Buffer.from('export const detail=true;')}],
 ['assets/main-Ab123.css',{type:'text/css; charset=utf-8',body:Buffer.from('body{color:#123456}')}],
 ['assets/inter-Ab123.woff2',{type:'font/woff2',body:Buffer.from([0x77,0x4f,0x46,0x32,0,0,0,8])}],
 ['assets/picture-Ab123.png',{type:'image/png',body:Buffer.from([137,80,78,71,13,10,26,10])}],
 ['assets/picture-Ab123.jpg',{type:'image/jpeg',body:Buffer.from([255,216,255,224])}],
 ['assets/picture-Ab123.jpeg',{type:'image/jpeg',body:Buffer.from([255,216,255,224,1])}],
 ['assets/picture-Ab123.webp',{type:'image/webp',body:Buffer.from('RIFF0000WEBPVP8 ')}],
 ['assets/picture-Ab123.svg',{type:'image/svg+xml',body:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"/>')}],
]);
function manifest():Record<string,unknown>{return {
 'index.html':{file:'assets/main-Ab123.js',isEntry:true,src:'index.html',css:['assets/main-Ab123.css'],assets:['assets/picture-Ab123.png'],imports:['src/index.tsx'],dynamicImports:['src/detail.tsx']},
 'src/index.tsx':{file:'assets/shared-Cd456.js',src:'src/index.tsx',assets:['assets/inter-Ab123.woff2']},
 'src/detail.tsx':{file:'assets/detail-Ef789.js',isDynamicEntry:true,src:'src/detail.tsx',assets:['assets/picture-Ab123.jpg','assets/picture-Ab123.jpeg','assets/picture-Ab123.webp','assets/picture-Ab123.svg']},
};}
function put(root:string,file:string,body:string|Uint8Array):void{const target=path.join(root,file);mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,body);}
function fixture():string{
 const root=mkdtempSync(path.join(tmpdir(),'yxx-h5-static-test-'));
 put(root,'index.html','<!doctype html><html><head><link rel="stylesheet" href="/wecom/yixiaoxiu/assets/main-Ab123.css"></head><body>SYNTHETIC_H5_PAGE<script type="module" src="/wecom/yixiaoxiu/assets/main-Ab123.js"></script></body></html>');
 put(root,'.vite/manifest.json',JSON.stringify(manifest()));
 for(const [file,value] of assets)put(root,file,value.body);
 for(const file of ['docs/prototype/private.html','design-baseline/private.html','src/dev/preview.ts','assets/unmanifested.js'])put(root,file,'PRIVATE_H5_FIXTURE_MUST_NOT_BE_SERVED');
 return root;
}
function cleanup(root:string):void{assert.equal(path.dirname(root),tmpdir());assert.ok(path.basename(root).startsWith('yxx-h5-static-test-'));rmSync(root,{recursive:true,force:true});}
async function host(root:string,enabled:boolean|undefined,check:(origin:string)=>Promise<void>,previousRoot?:string):Promise<void>{
 const api=createYxxH5Static({root:pathToFileURL(root+path.sep),...(enabled===undefined?{}:{enabled}),...(previousRoot?{previousRoot:pathToFileURL(previousRoot+path.sep)}:{})});
 const server=createServer((request,response)=>{void(async()=>{
  try{
   const url=new URL(request.url??'/','http://127.0.0.1');
   const handled=url.pathname==='/wecom/yixiaoxiu'||url.pathname==='/wecom/yixiaoxiu/'?await api.page(response):await api.asset(url,response);
   if(!handled){response.writeHead(404,{'content-type':'application/json'});response.end('{"error":{"code":"YXX_NOT_FOUND"}}');}
  }catch{
   // The production native adapter owns exception-to-503 mapping. This harness
   // checks that the static consumer fails before writing a successful response.
   response.writeHead(503,{...YXX_H5_SECURITY_HEADERS,'content-type':'application/json'});response.end('{"error":{"code":"YXX_UNAVAILABLE"}}');
  }
 })();});
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 try{const address=server.address();assert.ok(address&&typeof address!=='string');await check('http://127.0.0.1:'+address.port);}
 finally{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
}
async function raw(origin:string,file:string,acceptEncoding?:string){
 return new Promise<{status:number;headers:import('node:http').IncomingHttpHeaders;body:Buffer}>((resolve,reject)=>{
  const request=nativeRequest(origin+'/wecom/yixiaoxiu/'+file,{headers:acceptEncoding===undefined?{}:{'accept-encoding':acceptEncoding}},response=>{
   const parts:Buffer[]=[];response.on('data',(chunk:Buffer)=>parts.push(chunk));response.once('error',reject);response.once('end',()=>resolve({status:response.statusCode??0,headers:response.headers,body:Buffer.concat(parts)}));
  });request.once('error',reject);request.end();
 });
}
function encodings(root:string):void{
 const graph=manifest(),main=graph['index.html'];assert.ok(main&&typeof main==='object');
 const representations=[];
 for(const [source,value] of assets){
  const bytes=Buffer.from(value.body),sha=(buffer:Buffer)=>createHash('sha256').update(buffer).digest('hex');
  representations.push({file:source,source,encoding:'identity',bytes:bytes.length,sha256:sha(bytes)});
  if(!/\.(?:js|css)$/u.test(source))continue;
  for(const [encoding,suffix,compressed] of [['gzip','.gz',gzipSync(bytes)],['br','.br',brotliCompressSync(bytes)]] as const){
   const file=source+suffix;put(root,file,compressed);representations.push({file,source,encoding,bytes:compressed.length,sha256:sha(compressed)});
  }
 }
 Object.assign(main,{h5Representations:representations});put(root,'.vite/manifest.json',JSON.stringify(graph));
}

test('H5 static serving stays off by default without reading a missing artifact',async()=>{
 const root=fixture();
 try{
  rmSync(path.join(root,'.vite/manifest.json'));
  for(const enabled of [undefined,false])await host(root,enabled,async origin=>{
   for(const route of ['/wecom/yixiaoxiu/','/wecom/yixiaoxiu/assets/main-Ab123.js']){const response=await fetch(origin+route);assert.equal(response.status,404);assert.doesNotMatch(await response.text(),/SYNTHETIC_H5|PRIVATE_H5/u);}
  });
 }finally{cleanup(root);}
});

test('enabled H5 serves only the reachable manifest graph with exact MIME, bytes, and CSP',async()=>{
 const root=fixture();
 try{await host(root,true,async origin=>{
  const page=await fetch(origin+'/wecom/yixiaoxiu/');assert.equal(page.status,200);assert.match(await page.text(),/SYNTHETIC_H5_PAGE/u);
  assert.equal(page.headers.get('content-type'),'text/html; charset=utf-8');
  const policy=page.headers.get('content-security-policy')??'';
  for(const directive of ["default-src 'self'","script-src 'self'","style-src 'self'","connect-src 'self'","object-src 'none'","base-uri 'none'","frame-ancestors 'none'","media-src 'self' blob:","font-src 'self'"])assert.ok(policy.includes(directive),directive);
  assert.doesNotMatch(policy,/(?:^|;\s*)script-src[^;]*(?:unsafe-inline|unsafe-eval|https?:|\*)/u);
  assert.equal(page.headers.get('cache-control'),'no-store');assert.equal(page.headers.get('referrer-policy'),'no-referrer');assert.equal(page.headers.get('x-content-type-options'),'nosniff');
  for(const [file,asset] of assets){
   const response=await fetch(origin+'/wecom/yixiaoxiu/'+file);assert.equal(response.status,200,file);assert.equal(response.headers.get('content-type'),asset.type,file);assert.equal(response.headers.get('content-length'),String(asset.body.byteLength),file);assert.equal(response.headers.get('content-security-policy'),policy);assert.equal(response.headers.get('cache-control'),'public, max-age=31536000, immutable');assert.equal(response.headers.get('vary'),'Accept-Encoding');assert.deepEqual(Buffer.from(await response.arrayBuffer()),Buffer.from(asset.body),file);
  }
 });}finally{cleanup(root);}
});

test('H5 chooses declared gzip or Brotli with q-values and preserves exact wire length',async()=>{
 const root=fixture(),file='assets/main-Ab123.js',source=assets.get(file);assert.ok(source);
 try{encodings(root);await host(root,true,async origin=>{
  for(const [header,expected] of [[undefined,'identity'],['br, gzip','br'],['gzip;q=1,br;q=0.5','gzip'],['BR;q=0.7, gzip;q=0.8, identity;q=0','gzip'],['br;q=0,gzip;q=0','identity'],['*;q=0.5, identity;q=0','br'],['gzip;q=0.3','identity']] as const){
   const response=await raw(origin,file,header);assert.equal(response.status,200,String(header));assert.equal(response.headers['content-encoding'],expected==='identity'?undefined:expected);assert.equal(response.headers['content-length'],String(response.body.length));assert.equal(response.headers.vary,'Accept-Encoding');
   assert.deepEqual(response.body,expected==='identity'?Buffer.from(source.body):expected==='br'?brotliCompressSync(source.body):gzipSync(source.body));
  }
  for(const header of ['identity;q=0,gzip;q=0,br;q=0','*;q=0','identity;q=0,gzip;q=2,br;q=0'])assert.equal((await raw(origin,file,header)).status,406,header);
  for(const suffix of ['.gz','.br'])assert.equal((await raw(origin,file+suffix,'br,gzip')).status,404);
 });}finally{cleanup(root);}
});

test('H5 rejects unverified sidecars and hash drift before exposing the page',async()=>{
 const root=fixture();
 try{
  encodings(root);put(root,'assets/main-Ab123.js.br',Buffer.from('tampered'));
  await host(root,true,async origin=>{assert.equal((await fetch(origin+'/wecom/yixiaoxiu/')).status,503);});
  encodings(root);const graph=manifest();Object.assign(graph['index.html']??{}, {h5Representations:[{file:'assets/main-Ab123.js.gz',source:'docs/prototype/private.html',encoding:'gzip',bytes:1,sha256:'a'.repeat(64)}]});put(root,'.vite/manifest.json',JSON.stringify(graph));
  await host(root,true,async origin=>{assert.equal((await fetch(origin+'/wecom/yixiaoxiu/')).status,503);});
 }finally{cleanup(root);}
});

test('H5 verifies one immutable generation once and keeps only bounded public byte buffers',async()=>{
 const root=fixture();
 try{
  await host(root,true,async origin=>{
   const pages=await Promise.all(Array.from({length:8},()=>fetch(origin+'/wecom/yixiaoxiu/')));assert.ok(pages.every(page=>page.status===200));
   put(root,'.vite/manifest.json','not-json');put(root,'index.html','UNVERIFIED_CHANGED_PAGE');put(root,'assets/main-Ab123.js','PRIVATE_CHANGED_BYTES');
   assert.match(await(await fetch(origin+'/wecom/yixiaoxiu/')).text(),/SYNTHETIC_H5_PAGE/u);
   assert.equal((await raw(origin,'assets/main-Ab123.js')).body.toString(),Buffer.from(assets.get('assets/main-Ab123.js')?.body??[]).toString());
  });
  put(root,'.vite/manifest.json',JSON.stringify({'index.html':{file:'assets/large1-Ab123.js',isEntry:true,assets:['assets/large2-Ab123.js','assets/large3-Ab123.js']}}));
  for(const index of [1,2,3])put(root,'assets/large'+index+'-Ab123.js',Buffer.alloc(2*1024*1024+1,index));
  await host(root,true,async origin=>{
   assert.equal((await fetch(origin+'/wecom/yixiaoxiu/')).status,200);
   rmSync(path.join(root,'assets/large1-Ab123.js'));rmSync(path.join(root,'assets/large3-Ab123.js'));
   assert.equal((await raw(origin,'assets/large1-Ab123.js')).status,503);
   assert.equal((await raw(origin,'assets/large3-Ab123.js')).status,200);
  });
 }finally{cleanup(root);}
});

test('H5 previous generation contributes only verified old assets, never old HTML',async()=>{
 const root=fixture(),previous=fixture();
 try{
  const graph=manifest();Object.assign(graph['src/detail.tsx']??{},{file:'assets/old-detail-Xy789.js'});put(previous,'.vite/manifest.json',JSON.stringify(graph));put(previous,'assets/old-detail-Xy789.js','SYNTHETIC_OLD_DETAIL');put(previous,'index.html','OLD_PAGE_MUST_NOT_REPLACE_CURRENT');
  await host(root,true,async origin=>{
   assert.equal((await raw(origin,'assets/old-detail-Xy789.js')).status,404);
  });
  await host(root,true,async origin=>{
   assert.equal((await raw(origin,'assets/old-detail-Xy789.js')).body.toString(),'SYNTHETIC_OLD_DETAIL');
   assert.match(await(await fetch(origin+'/wecom/yixiaoxiu/')).text(),/SYNTHETIC_H5_PAGE/u);
   assert.equal((await raw(origin,'assets/unmanifested.js')).status,404);
  },previous);
 }finally{cleanup(root);cleanup(previous);}
});

test('H5 refuses designs, dev fixtures, metadata, unmanifested assets, queries, and encoded traversal',async()=>{
 const root=fixture();
 try{await host(root,true,async origin=>{
  for(const route of ['/wecom/yixiaoxiu/docs/prototype/private.html','/wecom/yixiaoxiu/design-baseline/private.html','/wecom/yixiaoxiu/src/dev/preview.ts','/wecom/yixiaoxiu/.vite/manifest.json','/wecom/yixiaoxiu/asset-inventory.json','/wecom/yixiaoxiu/assets/unmanifested.js','/wecom/yixiaoxiu/assets/main-Ab123.js?preview=1','/wecom/yixiaoxiu/assets/%2e%2e%2fdocs%2fprivate.html','/wecom/yixiaoxiu/assets/%5c..%5cprivate.js','/wecom/yixiaoxiu/assets/../docs/prototype/private.html']){
   const response=await fetch(origin+route);assert.equal(response.status,404,route);assert.doesNotMatch(await response.text(),/PRIVATE_H5|SYNTHETIC_H5_MAIN/u,route);
  }
 });}finally{cleanup(root);}
});

test('H5 rejects preview or design references even if they are written into a manifest',async()=>{
 const root=fixture();
 try{
  put(root,'assets/preview-Ab123.js','PRIVATE_H5_FIXTURE_MUST_NOT_BE_SERVED');
  for(const entry of [
   {file:'assets/preview-Ab123.js',isEntry:true,src:'index.html'},
   {file:'assets/main-Ab123.js',isEntry:true,src:'src/dev/preview.ts'},
   {file:'assets/main-Ab123.js',isEntry:true,src:'docs/prototype/main.ts'},
   {file:'assets/main-Ab123.js',isEntry:true,dynamicImports:['src/dev/preview.ts']},
   {file:'assets/main-Ab123.js',isEntry:true,imports:['docs/prototype/main.ts']},
  ]){
   put(root,'.vite/manifest.json',JSON.stringify({'index.html':entry,'src/dev/preview.ts':{file:'assets/detail-Ef789.js'},'docs/prototype/main.ts':{file:'assets/detail-Ef789.js'}}));
   await host(root,true,async origin=>{const response=await fetch(origin+'/wecom/yixiaoxiu/');assert.equal(response.status,503,JSON.stringify(entry));assert.doesNotMatch(await response.text(),/PRIVATE_H5|SYNTHETIC_H5/u);});
  }
 }finally{cleanup(root);}
});

test('missing, malformed, incomplete, or unsafe manifests fail closed before exposing HTML',async()=>{
 const root=fixture();
 try{
  for(const text of [undefined,'not-json','[]','{}',JSON.stringify({'index.html':{file:'assets/main-Ab123.js'}}),JSON.stringify({'index.html':{file:'../private.js',isEntry:true}}),JSON.stringify({'index.html':{file:'https://example.invalid/main.js',isEntry:true}}),JSON.stringify({'index.html':{file:'assets/main-Ab123.js',isEntry:true,imports:['missing']}}),JSON.stringify({'index.html':{file:'assets/main-Ab123.js',isEntry:true,css:'assets/main-Ab123.css'}})]){
   if(text===undefined)rmSync(path.join(root,'.vite/manifest.json'));else put(root,'.vite/manifest.json',text);
   await host(root,true,async origin=>{for(const route of ['/wecom/yixiaoxiu/','/wecom/yixiaoxiu/assets/main-Ab123.js']){const response=await fetch(origin+route);assert.equal(response.status,503);assert.equal(await response.text(),'{"error":{"code":"YXX_UNAVAILABLE"}}');}});
  }
 }finally{cleanup(root);}
});

test('unreachable chunks cannot add public assets and cyclic imports stay bounded',async()=>{
 const root=fixture();
 try{
  const graph=manifest();graph['src/unreachable.ts']={file:'assets/unmanifested.js'};
  graph['src/index.tsx']={file:'assets/shared-Cd456.js',src:'src/index.tsx',imports:['index.html']};
  put(root,'.vite/manifest.json',JSON.stringify(graph));
  await host(root,true,async origin=>{const page=await fetch(origin+'/wecom/yixiaoxiu/');assert.equal(page.status,200);const hidden=await fetch(origin+'/wecom/yixiaoxiu/assets/unmanifested.js');assert.equal(hidden.status,404);assert.doesNotMatch(await hidden.text(),/PRIVATE_H5/u);});
  put(root,'.vite/manifest.json',JSON.stringify({'index.html':{file:'assets/main-Ab123.js',isEntry:true,assets:Array.from({length:257},()=> 'assets/picture-Ab123.png')}}));
  await host(root,true,async origin=>{const response=await fetch(origin+'/wecom/yixiaoxiu/');assert.equal(response.status,503);});
 }finally{cleanup(root);}
});

test('H5 refuses linked artifact roots, asset directories, and manifest directories',async()=>{
 const root=fixture(),wrapper=mkdtempSync(path.join(tmpdir(),'yxx-h5-static-test-'));
 try{
  const linkedRoot=path.join(wrapper,'linked-h5');symlinkSync(root,linkedRoot,process.platform==='win32'?'junction':'dir');assert.ok(lstatSync(linkedRoot).isSymbolicLink());
  await host(linkedRoot,true,async origin=>{const response=await fetch(origin+'/wecom/yixiaoxiu/');assert.equal(response.status,503);});
  renameSync(path.join(root,'assets'),path.join(root,'saved-assets'));symlinkSync(path.join(root,'saved-assets'),path.join(root,'assets'),process.platform==='win32'?'junction':'dir');
  await host(root,true,async origin=>{const response=await fetch(origin+'/wecom/yixiaoxiu/assets/main-Ab123.js');assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/SYNTHETIC_H5_MAIN/u);});
  renameSync(path.join(root,'.vite'),path.join(root,'saved-vite'));symlinkSync(path.join(root,'saved-vite'),path.join(root,'.vite'),process.platform==='win32'?'junction':'dir');
  await host(root,true,async origin=>{const response=await fetch(origin+'/wecom/yixiaoxiu/');assert.equal(response.status,503);});
 }finally{cleanup(wrapper);cleanup(root);}
});
