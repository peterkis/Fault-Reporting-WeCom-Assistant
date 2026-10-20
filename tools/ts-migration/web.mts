import path from 'node:path';
import {writeFileSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {controlledBuildRoot,runNode,outputFiles,record,hash,safeFile,workspaceFiles,slash,isH5ProductionInput,h5OutputFiles} from './common.mjs';
type WebProject = 'web/admin-workbench' | 'h5';
function typecheckProject(root:string,relative:WebProject):void {
  const project=path.join(root,relative),code=relative==='h5'?'H5':'WEB01';
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
  if(options.noCheck||['noImplicitAny','strictNullChecks',...(relative==='h5'?['strictFunctionTypes','strictBindCallApply','strictPropertyInitialization','noImplicitThis','alwaysStrict']:[])].some(k=>options[k]===false))throw new Error(code+'_TYPE_BYPASS');
  const args=[path.join(root,'node_modules/typescript-web/bin/tsc'),'-p',path.join(project,'tsconfig.json')];
  runNode(root,args);
  const checked=new Set(execFileSync(process.execPath,[...args,'--listFilesOnly'],{cwd:root,encoding:'utf8',windowsHide:true}).split(/\r?\n/u).map(slash));
  const sources=workspaceFiles(root).filter(f=>relative==='h5'?isH5ProductionInput(f)&&/\.(ts|tsx)$/u.test(f):/^web\/admin-workbench\/.+\.(ts|tsx)$/u.test(f));
  if(!sources.length||relative==='h5'&&!sources.some(f=>f.startsWith('h5/src/'))||sources.some(f=>!checked.has(slash(path.join(root,f)))))throw new Error(code+'_UNCHECKED_SOURCE');
}
export function typecheckH5(root:string):void { typecheckProject(root,'h5'); }
export function typecheckWeb(root:string):void { typecheckProject(root,'web/admin-workbench'); typecheckH5(root); }
export function buildWeb(root:string):void {
  typecheckWeb(root);
  const project=path.join(root,'web/admin-workbench'),output=path.join(controlledBuildRoot(root),'emit/web/admin-workbench');
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
  runNode(root,[path.join(root,'node_modules/vite/bin/vite.js'),'build',path.join(root,'h5'),'--outDir',output,'--emptyOutDir']);
  const files=h5OutputFiles(root,false);
  writeFileSync(path.join(output,'asset-inventory.json'),JSON.stringify(files)+'\n');
  const lock=record(JSON.parse(readFileSync(safeFile(root,'package-lock.json'),'utf8')) as unknown);
  writeFileSync(path.join(output,'dependency-inventory.json'),JSON.stringify({lock_sha256:hash(readFileSync(safeFile(root,'package-lock.json'))),packages:lock.packages})+'\n');
}
export function buildH5(root:string):void { typecheckH5(root); emitH5(root); }
