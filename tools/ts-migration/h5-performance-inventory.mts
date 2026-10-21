import {createHash} from 'node:crypto';
import {cpSync,existsSync,lstatSync,mkdirSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {brotliCompressSync,constants,gzipSync} from 'node:zlib';

export interface PerformanceFile {
  path:string;bytes:number;sha256:string;gzip_bytes?:number;brotli_bytes?:number;
}
interface Chunk {file:string;imports:string[];dynamic_imports:string[];css:string[];entry:boolean}
export interface H5PerformanceInventory {
  schema_version:1;runtime_root:string;source_head:string|null;manifest_sha256:string;
  files:PerformanceFile[];h5_chunks:Chunk[];
}
function sha(bytes:Uint8Array):string{return createHash('sha256').update(bytes).digest('hex');}
function record(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('H5_PERFORMANCE_INVALID_MANIFEST');
  return value as Record<string,unknown>;
}
function strings(value:unknown):string[]{return Array.isArray(value)?value.filter((item):item is string=>typeof item==='string'):[];}
function filesBelow(root:string,prefix=''):string[]{
  const result:string[]=[];
  for(const entry of readdirSync(path.join(root,prefix),{withFileTypes:true})){
    const relative=prefix?prefix+'/'+entry.name:entry.name;
    if(entry.isSymbolicLink())throw new Error('H5_PERFORMANCE_SYMLINK_REJECTED');
    if(entry.isDirectory())result.push(...filesBelow(root,relative));
    else if(entry.isFile())result.push(relative);
  }
  return result.sort();
}
export function inventoryRuntime(runtimeRoot:string):H5PerformanceInventory{
  const root=path.resolve(runtimeRoot);
  const manifestBytes=readFileSync(path.join(root,'build-manifest.json'));
  const manifest=record(JSON.parse(manifestBytes.toString('utf8')) as unknown),source=record(manifest.source);
  const files=filesBelow(root).map(file=>{
    const bytes=readFileSync(path.join(root,file)),result:PerformanceFile={path:file,bytes:bytes.length,sha256:sha(bytes)};
    if(/^h5\/.*\.(?:js|css)$/u.test(file)){
      result.gzip_bytes=gzipSync(bytes,{level:9}).length;
      result.brotli_bytes=brotliCompressSync(bytes,{params:{[constants.BROTLI_PARAM_QUALITY]:11}}).length;
    }
    return result;
  });
  const vite=record(JSON.parse(readFileSync(path.join(root,'h5/.vite/manifest.json'),'utf8')) as unknown);
  const h5_chunks=Object.values(vite).map(value=>{
    const chunk=record(value);
    if(typeof chunk.file!=='string')throw new Error('H5_PERFORMANCE_INVALID_CHUNK');
    return {file:chunk.file,imports:strings(chunk.imports),dynamic_imports:strings(chunk.dynamicImports),css:strings(chunk.css),entry:chunk.isEntry===true};
  });
  return {schema_version:1,runtime_root:root,source_head:typeof source.head==='string'?source.head:typeof source.commit==='string'?source.commit:null,manifest_sha256:sha(manifestBytes),files,h5_chunks};
}
export function freezeRuntime(runtimeRoot:string,destination:string):H5PerformanceInventory{
  const source=path.resolve(runtimeRoot),target=path.resolve(destination);
  if(!path.isAbsolute(destination)||existsSync(target)||target===source||target.startsWith(source+path.sep))throw new Error('H5_PERFORMANCE_FRESH_DESTINATION_REQUIRED');
  for(let current=path.dirname(target);;current=path.dirname(current)){
    if(existsSync(current)&&lstatSync(current).isSymbolicLink())throw new Error('H5_PERFORMANCE_SYMLINK_REJECTED');
    if(path.dirname(current)===current)break;
  }
  const before=inventoryRuntime(source);
  mkdirSync(path.dirname(target),{recursive:true});
  cpSync(source,target,{recursive:true,errorOnExist:true,force:false,dereference:false});
  const after=inventoryRuntime(target);
  if(JSON.stringify(before.files)!==JSON.stringify(after.files))throw new Error('H5_PERFORMANCE_FREEZE_MISMATCH');
  writeFileSync(path.join(path.dirname(target),path.basename(target)+'-inventory.json'),JSON.stringify({...after,frozen_at:new Date().toISOString(),source_runtime_root:source},null,2)+'\n',{flag:'wx'});
  return after;
}
const invoked=process.argv[1];
if(invoked&&pathToFileURL(path.resolve(invoked)).href===import.meta.url){
  const [mode,runtimeRoot,destination]=process.argv.slice(2);
  if(!runtimeRoot||(mode!=='inventory'&&mode!=='freeze')||(mode==='freeze'&&!destination))throw new Error('USAGE: h5-performance-inventory.mjs inventory <runtime> | freeze <runtime> <fresh-absolute-destination>');
  const result=mode==='freeze'&&destination?freezeRuntime(runtimeRoot,destination):inventoryRuntime(runtimeRoot);
  process.stdout.write(JSON.stringify({schema_version:result.schema_version,manifest_sha256:result.manifest_sha256,files:result.files.length,bytes:result.files.reduce((sum,file)=>sum+file.bytes,0),h5:result.files.filter(file=>file.path.startsWith('h5/'))},null,2)+'\n');
}
