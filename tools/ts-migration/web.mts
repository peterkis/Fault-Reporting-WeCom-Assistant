import path from 'node:path';
import {writeFileSync,readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {brotliCompressSync,constants,gzipSync} from 'node:zlib';
import {controlledBuildRoot,runNode,outputFiles,record,hash,safeFile,workspaceFiles,slash,isH5ProductionInput,h5OutputFiles,h5StartupMetrics} from './common.mjs';
type WebProject = 'app/pc-admin' | 'app/h5';
function typecheckProject(root:string,relative:WebProject):void {
  const project=path.join(root,relative),code=relative==='app/h5'?'H5':'WEB01';
  const declared=record(JSON.parse(readFileSync(safeFile(project,'package.json'),'utf8')) as unknown);
  const installed=record(record(JSON.parse(readFileSync(safeFile(root,'package.json'),'utf8')) as unknown).devDependencies);
  for(const [name,version] of Object.entries({...record(declared.dependencies),...record(declared.devDependencies)})){
    const alias=name==='typescript'?'typescript-web':name;
    if(installed[alias]!== (name==='typescript'?'npm:typescript@'+String(version):version))throw new Error(code+'_DEPENDENCY_LOCK_DRIFT: '+name);
    const actual=record(JSON.parse(readFileSync(path.join(root,'node_modules',alias,'package.json'),'utf8')) as unknown);
    if(actual.version!==version)throw new Error(code+'_INSTALLED_DEPENDENCY_DRIFT: '+name);
  }
  const config=record(JSON.parse(readFileSync(safeFile(project,'tsconfig.json'),'utf8')) as unknown),options=record(config.compilerOptions);
  for(const key of ['strict','noUncheckedIndexedAccess','exactOptionalPropertyTypes','useUnknownInCatchVariables','verbatimModuleSyntax','forceConsistentCasingInFileNames','noEmit','noEmitOnError'])if(options[key]!==true)throw new Error(code+'_STRICT_FLAG_REQUIRED: '+key);
  // Preserve the prototype's vendor declaration exception. Our public .d.ts inputs
  // are also checked by the existing strict root type program with skipLibCheck=false.
  if(options.noCheck||['noImplicitAny','strictNullChecks',...(relative==='app/h5'?['strictFunctionTypes','strictBindCallApply','strictPropertyInitialization','noImplicitThis','alwaysStrict']:[])].some(k=>options[k]===false))throw new Error(code+'_TYPE_BYPASS');
  const args=[path.join(root,'node_modules/typescript-web/bin/tsc'),'-p',path.join(project,'tsconfig.json')];
  runNode(root,args);
  const checked=new Set(execFileSync(process.execPath,[...args,'--listFilesOnly'],{cwd:root,encoding:'utf8',windowsHide:true}).split(/\r?\n/u).map(slash));
  const sources=workspaceFiles(root).filter(f=>relative==='app/h5'?isH5ProductionInput(f)&&/\.(mts|ts|tsx)$/u.test(f):/^app\/pc-admin\/(?!desktop\/).+\.(mts|ts|tsx)$/u.test(f));
  if(!sources.length||relative==='app/h5'&&!sources.some(f=>f.startsWith('app/h5/src/'))||sources.some(f=>!checked.has(slash(path.join(root,f)))))throw new Error(code+'_UNCHECKED_SOURCE');
}
export function typecheckH5(root:string):void { typecheckProject(root,'app/h5'); }
export function typecheckDesktop(root:string):void {
  const sources=workspaceFiles(root).filter(file=>/^app\/pc-admin\/desktop\/.+\.(?:mts|cts)$/u.test(file));
  if(!sources.length)return;
  const config=path.join(root,'app/pc-admin/desktop/tsconfig.json');if(!existsSync(config))throw Error('DESKTOP_TYPES_CONFIG_MISSING');
  const args=[path.join(root,'node_modules/typescript/bin/tsc'),'-p',config,'--noEmit'];runNode(root,args);
  const effective=record(record(JSON.parse(execFileSync(process.execPath,[...args,'--showConfig'],{cwd:root,encoding:'utf8',windowsHide:true}))).compilerOptions);
  for(const key of ['strict','noUncheckedIndexedAccess','exactOptionalPropertyTypes','useUnknownInCatchVariables','noEmitOnError'])if(effective[key]!==true)throw Error('DESKTOP_STRICT_FLAG_REQUIRED:'+key);
  if(effective.noCheck||effective.skipLibCheck)throw Error('DESKTOP_TYPE_BYPASS');
  const checked=new Set(execFileSync(process.execPath,[...args,'--listFilesOnly'],{cwd:root,encoding:'utf8',windowsHide:true}).split(/\r?\n/u).map(slash));
  if(sources.some(file=>!checked.has(slash(path.join(root,file)))))throw Error('DESKTOP_UNCHECKED_SOURCE');
}
export function typecheckWeb(root:string):void { typecheckProject(root,'app/pc-admin'); typecheckH5(root); typecheckDesktop(root); }
export function buildWeb(root:string):void {
  typecheckWeb(root);
  // Source layout is independent of the established runtime asset location.
  const project=path.join(root,'app/pc-admin'),output=path.join(controlledBuildRoot(root),'emit/web/admin-workbench');
  runNode(root,[path.join(root,'node_modules/vite/bin/vite.js'),'build',project,'--outDir',output,'--emptyOutDir']);
  const files=outputFiles(output);
  if(!files.includes('index.html')||!files.includes('.vite/manifest.json')||files.some(f=>!['index.html','.vite/manifest.json'].includes(f)&&!/^assets\/[A-Za-z0-9_-]+\.(js|css)$/u.test(f)))throw new Error('WEB01_BUILD_OUTPUT_INVALID');
  writeFileSync(path.join(output,'asset-inventory.json'),JSON.stringify(files)+'\n');
  const lock=record(JSON.parse(readFileSync(safeFile(root,'package-lock.json'),'utf8')) as unknown);
  writeFileSync(path.join(output,'dependency-inventory.json'),JSON.stringify({lock_sha256:hash(readFileSync(safeFile(root,'package-lock.json'))),packages:lock.packages})+'\n');
  emitH5(root);
}
function emitH5(root:string):void {
  const output=path.join(controlledBuildRoot(root),'emit/h5');
  runNode(root,[path.join(root,'node_modules/vite/bin/vite.js'),'build',path.join(root,'app/h5'),'--outDir',output,'--emptyOutDir']);
  const original=h5OutputFiles(root,false),manifest=record(JSON.parse(readFileSync(safeFile(output,'.vite/manifest.json'),'utf8')) as unknown),main=record(manifest['index.html']);
  // Public files are already compared against source bytes by h5OutputFiles.
  // Register them in the reachable graph as well as the artifact inventory.
  main.assets=[...new Set([...(Array.isArray(main.assets)?main.assets:[]),...original.filter(file=>/^assets\//u.test(file)&&!file.endsWith('.js')&&!file.endsWith('.css'))])];
  const representations=[];
  for(const source of original.filter(file=>file.startsWith('assets/'))){
    const bytes=readFileSync(safeFile(output,source));representations.push({file:source,source,encoding:'identity',bytes:bytes.length,sha256:hash(bytes)});
    if(!/\.(?:js|css)$/u.test(source))continue;
    for(const [encoding,suffix,encoded] of [['gzip','.gz',gzipSync(bytes,{level:9})],['br','.br',brotliCompressSync(bytes,{params:{[constants.BROTLI_PARAM_QUALITY]:11}})]] as const){
      const file=source+suffix;writeFileSync(path.join(output,file),encoded);representations.push({file,source,encoding,bytes:encoded.length,sha256:hash(encoded)});
    }
  }
  main.h5Representations=representations;writeFileSync(path.join(output,'.vite/manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  const startup=h5StartupMetrics(root);writeFileSync(path.join(output,'startup-metrics.json'),JSON.stringify(startup)+'\n');
  const files=h5OutputFiles(root,false);
  writeFileSync(path.join(output,'asset-inventory.json'),JSON.stringify(files)+'\n');
  const lock=record(JSON.parse(readFileSync(safeFile(root,'package-lock.json'),'utf8')) as unknown);
  writeFileSync(path.join(output,'dependency-inventory.json'),JSON.stringify({lock_sha256:hash(readFileSync(safeFile(root,'package-lock.json'))),packages:lock.packages})+'\n');
  if([startup.initial,...startup.routes].some(item=>item.gzip>startup.js_budget_gzip))throw new Error('H5_STARTUP_BUDGET_EXCEEDED');
  if(startup.assets.some(item=>/^assets\/prepaint-/u.test(item.file)&&item.gzip>startup.prepaint_budget_gzip))throw new Error('H5_PREPAINT_BUDGET_EXCEEDED');
}
export function buildH5(root:string):void { typecheckH5(root); emitH5(root); }
