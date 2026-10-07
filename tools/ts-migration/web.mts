import path from 'node:path';
import {writeFileSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {controlledBuildRoot,runNode,outputFiles,record,hash,safeFile,workspaceFiles,slash} from './common.mjs';
export function typecheckWeb(root:string):void {
  const project=path.join(root,'web/admin-workbench');
  const declared=record(JSON.parse(readFileSync(safeFile(project,'package.json'),'utf8')) as unknown);
  const installed=record(record(JSON.parse(readFileSync(safeFile(root,'package.json'),'utf8')) as unknown).devDependencies);
  for(const [name,version] of Object.entries({...record(declared.dependencies),...record(declared.devDependencies)})){
    const alias=name==='typescript'?'typescript-web':name;
    if(installed[alias]!== (name==='typescript'?'npm:typescript@'+String(version):version))throw new Error('WEB01_DEPENDENCY_LOCK_DRIFT: '+name);
    const actual=record(JSON.parse(readFileSync(path.join(root,'node_modules',alias,'package.json'),'utf8')) as unknown);
    if(actual.version!==version)throw new Error('WEB01_INSTALLED_DEPENDENCY_DRIFT: '+name);
  }
  const config=record(JSON.parse(readFileSync(safeFile(project,'tsconfig.json'),'utf8')) as unknown),options=record(config.compilerOptions);
  for(const key of ['strict','noUncheckedIndexedAccess','exactOptionalPropertyTypes','useUnknownInCatchVariables','verbatimModuleSyntax','forceConsistentCasingInFileNames','noEmit','noEmitOnError'])if(options[key]!==true)throw new Error('WEB01_STRICT_FLAG_REQUIRED: '+key);
  // Preserve the prototype's vendor declaration exception. Our public .d.ts inputs
  // are also checked by the existing strict root type program with skipLibCheck=false.
  if(options.noCheck||['noImplicitAny','strictNullChecks'].some(k=>options[k]===false))throw new Error('WEB01_TYPE_BYPASS');
  const args=[path.join(root,'node_modules/typescript-web/bin/tsc'),'-p',path.join(project,'tsconfig.json')];
  runNode(root,args);
  const checked=new Set(execFileSync(process.execPath,[...args,'--listFilesOnly'],{cwd:root,encoding:'utf8',windowsHide:true}).split(/\r?\n/u).map(slash));
  const sources=workspaceFiles(root).filter(f=>/^web\/admin-workbench\/.+\.(ts|tsx)$/u.test(f));
  if(!sources.length||sources.some(f=>!checked.has(slash(path.join(root,f)))))throw new Error('WEB01_UNCHECKED_SOURCE');
}
export function buildWeb(root:string):void {
  typecheckWeb(root);
  const project=path.join(root,'web/admin-workbench'),output=path.join(controlledBuildRoot(root),'emit/web/admin-workbench');
  runNode(root,[path.join(root,'node_modules/vite/bin/vite.js'),'build',project,'--outDir',output,'--emptyOutDir']);
  const files=outputFiles(output);
  if(!files.includes('index.html')||!files.includes('.vite/manifest.json')||files.some(f=>!['index.html','.vite/manifest.json'].includes(f)&&!/^assets\/[A-Za-z0-9_-]+\.(js|css)$/u.test(f)))throw new Error('WEB01_BUILD_OUTPUT_INVALID');
  writeFileSync(path.join(output,'asset-inventory.json'),JSON.stringify(files)+'\n');
  const lock=record(JSON.parse(readFileSync(safeFile(root,'package-lock.json'),'utf8')) as unknown);
  writeFileSync(path.join(output,'dependency-inventory.json'),JSON.stringify({lock_sha256:hash(readFileSync(safeFile(root,'package-lock.json'))),packages:lock.packages})+'\n');
}
