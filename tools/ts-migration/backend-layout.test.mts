import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {testEnvironment} from './routing.mjs';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {assertBackendLayout,assertSharedBoundary,BACKEND_LAYOUT_BASE,canonicalSourceText,isProductionSource,logicalSource,physicalSource,PC_MODULES,SHARED_MODULES} from './backend-layout.mjs';
import {git,record,safeFile,sourceRoot} from './common.mjs';

const original=sourceRoot();
const mapping=record(JSON.parse(readFileSync(path.join(original,'tools/ts-migration/backend-layout.json'),'utf8')) as unknown);
const baseline=git(original,['ls-tree','-r','--name-only',BACKEND_LAYOUT_BASE,'--','src','scripts']).split('\n');
const entries=baseline.filter(file=>file!=='src/bot-reporter-static.mts').map(source=>({source,target:physicalSource(source)}));
function fixture(){
 const root=mkdtempSync(path.join(tmpdir(),'server-layout-negative-'));
 mkdirSync(path.join(root,'tools/ts-migration'),{recursive:true});
 writeFileSync(path.join(root,'tools/ts-migration/backend-layout.json'),JSON.stringify(mapping));
 return {root,files:entries.map(item=>item.target)};
}
test('server layout binds all 382 original files to unique physical and logical identities',()=>{
 const {root,files}=fixture();
 try{
  assert.equal(files.length,382);assert.equal(new Set(files).size,382);
  assert.equal(files.filter(file=>file.startsWith('app/server/src/')).length,265);
  assert.equal(files.filter(file=>file.startsWith('app/server/scripts/')).length,105);
  assert.equal(PC_MODULES.length,9);assert.equal(SHARED_MODULES.length,3);
  for(const entry of entries)assert.equal(logicalSource(entry.target),entry.source);
  assertBackendLayout(root,files,baseline);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('a missing source and duplicate logical module are rejected before emit',()=>{
 const {root,files}=fixture();
 try{
  assert.throws(()=>assertBackendLayout(root,files.slice(1),baseline),/MIGRATION_LAYOUT_SOURCE_MISSING/u);
  const target=files.find(file=>file.endsWith('.mts'));assert.ok(target);
  const legacy=files.find(file=>file.endsWith('.mjs'));assert.ok(legacy);
  assertBackendLayout(root,files.map(file=>file===legacy?legacy.slice(0,-4)+'.mts':file),baseline);
  assert.throws(()=>assertBackendLayout(root,files.map(file=>file===target?target.slice(0,-4)+'.mjs':file),baseline),/MIGRATION_LAYOUT_SOURCE_MISSING/u);
  assert.throws(()=>assertBackendLayout(root,[...files,target.slice(0,-4)+'.mjs'],baseline),/MIGRATION_DUPLICATE_LOGICAL_SOURCE/u);
  const pc=PC_MODULES[0];assert.ok(pc);
  assert.throws(()=>assertBackendLayout(root,[...files,pc.slice(0,-4)+'.mjs'],baseline),/MIGRATION_DUPLICATE_LOGICAL_SOURCE/u);

 }finally{rmSync(root,{recursive:true,force:true});}
});
test('editing the forward map cannot borrow a legacy exemption or hide a duplicate',()=>{
 const {root,files}=fixture();
 try{
  const file=path.join(root,'tools/ts-migration/backend-layout.json');
  for(const forged of [entries.map((item,index)=>index===0?{...item,target:'app/server/src/g0-003-frame-capture.mjs'}:item),[...entries,entries[0]],entries.slice(1)]){
   writeFileSync(file,JSON.stringify({schema_version:1,baseline:BACKEND_LAYOUT_BASE,files:forged}));
   assert.throws(()=>assertBackendLayout(root,files,baseline),/MIGRATION_LAYOUT_MAPPING_INVALID/u);
  }
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('old roots and a missing mapping cannot silently retain source implementations',()=>{
 const {root,files}=fixture();
 try{
  mkdirSync(path.join(root,'src'));
  assert.throws(()=>assertBackendLayout(root,files,baseline),/MIGRATION_OLD_SOURCE_ROOT/u);
  rmSync(path.join(root,'tools/ts-migration/backend-layout.json'));
  assert.throws(()=>assertBackendLayout(root,files,baseline),/MIGRATION_LAYOUT_MAPPING_REQUIRED/u);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('shared modules reject Node, package and dynamic runtime dependencies',()=>{
 const {root}=fixture(),file='shared/isolated-negative.mts';
 try{
  mkdirSync(path.join(root,'shared'));
  for(const code of ["import {readFileSync} from 'node:fs';", "export {Pool} from 'pg';", "import '../app/server/src/platform/postgres-pool.mjs';", "await import('node:fs');", "require('node:fs');", "import fs = require('node:fs'); export const read = fs.readFileSync;"]){
   writeFileSync(path.join(root,file),code);
   assert.throws(()=>assertSharedBoundary(root,[file]),/MIGRATION_SHARED_RUNTIME_DEPENDENCY/u);
  }
  writeFileSync(path.join(root,file),"import type {PublicRef} from '../contracts/p2_016_contracts.js'; export const pure = true;");
  assertSharedBoundary(root,[file]);
  writeFileSync(path.join(root,file),"import type fs = require('node:fs'); export type ReadFile = typeof fs.readFileSync;");
  assertSharedBoundary(root,[file]);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('new production roots include unimported MTS and keep legacy identity after relocation',()=>{
 for(const file of ['app/server/src/unimported.mts','app/server/scripts/unimported.mts','shared/unimported.mts','app/pc-admin/src/unimported.mts','app/pc-admin/src/contracts/resurrected.mjs','app/pc-admin/src/realtime/unmanaged.cjs'])assert.equal(isProductionSource(file),true);
 assert.equal(logicalSource('app/server/src/platform/postgres-pool.mjs'),'src/platform/postgres-pool.mjs');
 assert.equal(logicalSource('shared/workbench-search-contracts.mjs'),'src/workbench-search-contracts.mjs');
 assert.equal(logicalSource('app/pc-admin/src/realtime/workbench-realtime-client.mjs'),'src/workbench-realtime-client.mjs');
});
test('parent junctions are rejected for backend and shared files',()=>{
 const {root}=fixture(),outside=mkdtempSync(path.join(tmpdir(),'server-layout-link-target-'));
 try{
  writeFileSync(path.join(outside,'synthetic.mts'),'export const synthetic = true;');
  mkdirSync(path.join(root,'app'));
  for(const relative of ['app/server','shared']){
   const link=path.join(root,relative);symlinkSync(outside,link,process.platform==='win32'?'junction':'dir');
   assert.throws(()=>safeFile(root,relative+'/synthetic.mts'),/MIGRATION_INPUT_SYMLINK/u);
   rmSync(link);
  }
 }finally{rmSync(root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
});
test('historical comparison normalizes module and resource locations without erasing executable changes',()=>{
 const before="import {search} from './workbench-search-contracts.mjs';\nconst sql = new URL('../database/migrations/'+id+'.sql',import.meta.url);\nexport const enabled = false;";
 const relocated="import {search} from '../../../shared/workbench-search-contracts.mjs';\nconst sql = new URL('../../../database/migrations/'+id+'.sql',import.meta.url);\nexport const enabled = false;";
 assert.equal(canonicalSourceText('app/server/src/synthetic.mts',relocated),before);
 assert.equal(canonicalSourceText('src/synthetic.mts',before),before);
 const oldSourceGuard="loadedFile.startsWith('src/')";
 const newSourceGuard=String.raw`loadedFile.startsWith('src/') || loadedFile.startsWith('app/server/src/') || loadedFile.startsWith('shared/') || /^app\/pc-admin\/src\/.+\.mts$/u.test(loadedFile)`;
 assert.equal(canonicalSourceText('app/server/src/synthetic.mts',newSourceGuard),oldSourceGuard);
 assert.equal(canonicalSourceText('app/server/src/synthetic.mts',newSourceGuard.replaceAll(' || ','||')),oldSourceGuard);
 assert.notEqual(canonicalSourceText('app/server/src/synthetic.mts',newSourceGuard.replace("startsWith('shared/')","startsWith('public/')")),oldSourceGuard);
 const oldGuard=String.raw`if(!sourceHost)assert.equal(/^(?:src|scripts|tests)\//u.test(loadedFile),false);`;
 const newGuard=String.raw`if(!sourceHost)assert.equal(/^(?:(?:app\/server\/)?(?:src|scripts)|tests)\//u.test(loadedFile),false);`;
 assert.equal(canonicalSourceText('app/server/src/synthetic.mts',newGuard),oldGuard);
 assert.notEqual(canonicalSourceText('app/server/src/synthetic.mts',newGuard.replace('|tests)','|fixtures)')),oldGuard);
 assert.notEqual(canonicalSourceText('app/server/src/synthetic.mts',relocated.replace('enabled = false','enabled = true')),before);
 assert.notEqual(canonicalSourceText('app/server/src/synthetic.mts',relocated.replace('workbench-search-contracts','other-implementation')),before);
});

test('cloud preparation resolves the repository root and keeps private settings at their explicit original path with synthetic IO',()=>{
 const probe=`
  import assert from 'node:assert/strict';import {mock} from 'node:test';import * as fs from 'node:fs';import * as cp from 'node:child_process';
  import path from 'node:path';import {pathToFileURL} from 'node:url';
  const root=process.cwd(),reads=[],writes=[],calls=[],head='a'.repeat(40);
  const tracked=['app/server/src/synthetic.mts','shared/synthetic.mts'];
  const fsExports=Object.fromEntries(Object.entries(fs).filter(([key])=>key!=='default'));
  mock.module('node:fs',{namedExports:{...fsExports,
   readFileSync:(file,encoding)=>{const absolute=String(file);reads.push(absolute);if(absolute===path.join(root,'.env.pilot')){assert.equal(encoding,'utf8');return 'WECOM_BOT_SECRET=synthetic-private-fixture-only\\n';}assert.ok(absolute.startsWith(root+path.sep));assert.ok(!absolute.includes('.env'));return Buffer.from('synthetic payload without private settings');},
   lstatSync:file=>{assert.ok(String(file).startsWith(root+path.sep));return {isFile:()=>true};},
   mkdirSync:directory=>{assert.equal(path.dirname(directory),path.join(root,'tmp'));},
   writeFileSync:(file,value)=>{assert.equal(path.dirname(path.dirname(file)),path.join(root,'tmp'));writes.push({file,value:JSON.parse(value)});}
  }});
  const cpExports=Object.fromEntries(Object.entries(cp).filter(([key])=>key!=='default'));
  mock.module('node:child_process',{namedExports:{...cpExports,
   execFileSync:(command,args,options)=>{assert.equal(command,'git');assert.equal(path.resolve(options.cwd),root);calls.push({command,args});if(args[0]==='rev-parse')return head;if(args[0]==='ls-files'){for(const required of ['app/server/src','app/server/scripts','shared','app/pc-admin','app/h5'])assert.ok(args.includes(required));for(const old of ['src','scripts','h5'])assert.ok(!args.includes(old));return tracked.join('\\n');}assert.fail('unexpected command');},
   spawnSync:(command,args,options)=>{assert.equal(command,'python');assert.equal(args[0],'-c');assert.equal(path.resolve(options.cwd),root);const input=JSON.parse(options.input);assert.equal(path.resolve(input.root),root);assert.ok(input.files.includes('app/server/scripts/p2-g2-postgres-native.sh'));assert.ok(input.files.every(file=>!file.startsWith('scripts/')&&!file.startsWith('src/')));calls.push({command});return {status:0};}
  }});
  process.argv=[process.execPath,path.join(root,'app/server/scripts/p2-g2-cloud-package.mjs')];
  await import(pathToFileURL(process.argv[1]).href);
  assert.equal(process.exitCode,undefined);assert.equal(writes.length,2);assert.equal(calls.length,3);
  const manifest=writes[0].value;assert.equal(manifest.deployment_state,'STAGED_NOT_ACTIVATED');assert.equal(manifest.ready_candidate,false);assert.equal(manifest.gateway_enabled,false);assert.equal(manifest.sender_enabled,false);assert.equal(manifest.secrets_included,false);
  assert.deepEqual(reads.filter(file=>file.includes('.env')),[path.join(root,'.env.pilot')]);
  console.log('CLOUD_PREPARATION_SYNTHETIC_IO_ONLY_PASS');`;
 const result=spawnSync(process.execPath,['--experimental-test-module-mocks','--input-type=module','-e',probe],{cwd:original,env:testEnvironment(original,[]),encoding:'utf8',windowsHide:true,timeout:15_000});
 assert.equal(result.error,undefined);assert.equal(result.status,0,result.stdout+result.stderr);assert.match(result.stdout,/CLOUD_PREPARATION_SYNTHETIC_IO_ONLY_PASS/u);
});

test('P2-015 keeps committed type and directory identity while rejecting executable, SQL and duplicate-source changes',()=>{
 const source=readFileSync(path.join(original,'app/server/scripts/validate-p2-015-rule-first-intake.mjs'),'utf8');
 const code=source.slice(source.indexOf('function erasedMigrationRuntime('),source.indexOf('const frozen ='));
 const migrationScope=JSON.parse(readFileSync(path.join(original,'plans/typescript-migration/scope.json'),'utf8')) as unknown;
 const scope=record(migrationScope),moduleMap=record(scope.current_module_map);
 const logical='src/p2-007-domain-utils.mjs',typed=logical.replace(/\.mjs$/u,'.mts'),current=physicalSource(typed);
 const inspect=(beforePath:string,afterPath:string,before:string,after:string,changes=[beforePath,afterPath],duplicate=false):boolean=>{
  const base='a'.repeat(40),row=(file:string):string=>'100644 blob '+'0'.repeat(40)+'\t'+file;
  const context={root:original,path,ts,migrationScope:scope,moduleMap,logicalSource,physicalSource,canonicalSourceText,changes,result:false,
   execFileSync:(_command:string,args:string[]):string=>{
    if(args.includes('merge-base'))return base;
    if(args.includes('ls-tree'))return args[args.indexOf('ls-tree')+1]===base?row(beforePath):row(afterPath)+(duplicate?'\n'+row(physicalSource(logical)):'');
    if(args.includes('show'))return args.at(-1)?.startsWith(base+':')?before:after;
    throw Error('UNEXPECTED_POLICY_GIT_COMMAND');
   }};
  runInNewContext(code+'\nresult=onlyRegisteredTypeMigrations(changes);',context);
  return context.result;
 };
 const before='export const enabled = false;',after='export const enabled: boolean = false;';
 assert.equal(inspect(logical,current,before,after),true);
 assert.equal(inspect(physicalSource(logical),current,before,after),true);
 assert.equal(inspect(typed,current,after,after),true);
 assert.equal(inspect(typed,current,"import {x} from '../contracts/pure.js'; export const enabled = false;","import {x} from '../../../contracts/pure.js'; export const enabled = false;"),true);
 assert.equal(inspect(typed,current,after,after.replace('false','true')),false);
 assert.equal(inspect(typed,current,after,after,[typed,current,'database/migrations/001_protected.sql']),false);
 assert.equal(inspect(logical,current,before,after,[logical,current],true),false);
 assert.equal(inspect(current,typed,after,after),false);
 assert.equal(inspect(typed,physicalSource(logical),after,before),false);
});

test('P2-016 preserves historical logical identifiers and resolves current source IO without old-root fallback',()=>{
 const text=readFileSync(path.join(original,'app/server/scripts/validate-p2-016-ticket-lifecycle-workbench.mjs'),'utf8');
 const sourceCode=text.slice(text.indexOf('function sourcePath('),text.indexOf('const read=p=>'));
 const logical='src/p2-007-domain-utils.mjs',target=path.join(original,physicalSource(logical).replace(/\.mjs$/u,'.mts'));
 const seen:string[]=[],context={root:original,path,physicalSource,result:'',existsSync:(file:string):boolean=>{seen.push(file);return file===target;}};
 runInNewContext(sourceCode+'\nresult=sourcePath('+JSON.stringify(logical)+');',context);
 assert.equal(context.result,target);
 assert.ok(seen.every(file=>file.startsWith(path.join(original,'app/server/src')+path.sep)));
 const missing={...context,existsSync:()=>false};
 runInNewContext(sourceCode+'\nresult=sourcePath('+JSON.stringify(logical)+');',missing);
 assert.equal(missing.result,path.join(original,physicalSource(logical)));
 assert.throws(()=>runInNewContext(sourceCode+'\nsourcePath('+JSON.stringify(logical)+');',{...context,existsSync:()=>true}),/MIGRATION_DUAL_SOURCE/u);
 const candidateCode=text.slice(text.indexOf('function candidateFiles(){'),text.indexOf('export function p2016FrozenInputsMatch'));
 const files=['src/p2-007-domain-utils.mts','app/server/src/p2-007-domain-utils.mts','shared/workbench-search-contracts.mts','app/pc-admin/src/realtime/workbench-realtime-client.mts'];
 const inventory={git:()=>files.join('\n'),logicalSource,result:[]};
 runInNewContext(candidateCode+'\nresult=candidateFiles();',inventory);
 assert.deepEqual(Array.from(inventory.result),['src/p2-007-domain-utils.mts','src/workbench-realtime-client.mts','src/workbench-search-contracts.mts']);
});
