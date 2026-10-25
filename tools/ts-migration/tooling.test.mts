import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync,spawn } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import { build,buildSyntaxEvidence } from './build.mjs';
import { verifyArtifact,runtimeOutputInventory } from './verify-artifact.mjs';
import { cleanGenerated, controlledBuildRoot, program, sourceRoot, workspaceFiles,runNode,git as runGit,hash,record } from './common.mjs';
import {checkCompiledSyntax} from './syntax-check.mjs';
import {typecheckWeb} from './web.mjs';
import {ownedSpawnSync} from './owned-process.mjs';

const original = sourceRoot();

if(process.platform==='win32')test('owned Windows subprocesses reclaim descendants on exit and timeout while a separate process survives',async t=>{
  const root=mkdtempSync(path.join(tmpdir(),'migration-owned-process-'));
  const foreign=spawn(process.execPath,['-e','setInterval(()=>{},10000)'],{stdio:'ignore',windowsHide:true});
  const foreignPid=foreign.pid;assert.ok(foreignPid);
  const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch(error){if(error&&typeof error==='object'&&'code' in error&&error.code==='ESRCH')return false;throw error;}};
  try{
    for(const scenario of ['root-exit','timeout'] as const)await t.test(scenario,()=>{
      const childScript="process.stdout.write('CHILD_READY\\n');setInterval(()=>{},10000);";
      const script="const{spawn}=require('node:child_process');const p=spawn(process.execPath,['-e',"+JSON.stringify(childScript)+"],{stdio:['ignore','pipe','ignore'],windowsHide:true,detached:true});p.stdout.once('data',()=>{console.log(JSON.stringify({root:process.pid,child:p.pid,child_ready:true}));"+(scenario==='root-exit'?'process.exit(0);':'setInterval(()=>{},10000);')+'});';
      const result=ownedSpawnSync(process.execPath,['-e',script],{cwd:root,encoding:'utf8',windowsHide:true,timeout:scenario==='timeout'?1000:5000});
      const receipt=result.ownership_receipt;assert.ok(receipt);
      const parsed:unknown=JSON.parse(result.stdout),child=record(parsed);assert.equal(typeof child.root,'number');assert.equal(typeof child.child,'number');
      if(typeof child.root!=='number'||typeof child.child!=='number')throw Error('OWNED_PROCESS_ACTUAL_PIDS_REQUIRED');
      assert.equal(child.child_ready,true);
      const start:unknown=JSON.parse(readFileSync(path.join(receipt,'started.json'),'utf8')),end:unknown=JSON.parse(readFileSync(path.join(receipt,'closed.json'),'utf8'));
      const started=record(start),closed=record(end);
      assert.equal(started.root_pid,child.root);assert.equal(started.owner_pid,process.pid);assert.equal(started.root_parent_pid,started.supervisor_pid);
      assert.equal(started.suspended_assigned_before_execution,true);assert.equal(started.verified_member_before_resume,true);
      assert.equal(typeof started.root_created_utc,'string');assert.equal(typeof started.owner_created_utc,'string');
      assert.equal(closed.cleanup_active_processes,0);assert.equal(alive(child.root),false);assert.equal(alive(child.child),false);assert.equal(alive(foreignPid),true);
      if(scenario==='timeout'){assert.ok(result.error&&'code' in result.error);assert.equal(result.error.code,'ETIMEDOUT');}
      else{assert.equal(result.error,undefined);assert.equal(result.status,0);assert.equal(closed.forced_cleanup,true);}
      t.diagnostic(JSON.stringify({scenario,receipt,actual_root_gone:true,actual_descendant_gone:true,separate_process_survived:true}));
    });
  }finally{
    if(foreign.exitCode===null&&foreign.signalCode===null)foreign.kill('SIGTERM');
    await new Promise<void>(resolve=>foreign.exitCode!==null||foreign.signalCode!==null?resolve():foreign.once('close',()=>resolve()));
    assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('migration-owned-process-'));rmSync(root,{recursive:true,force:true});
  }
});

test('runtime identity binds every output and source map while preserving the archived C manifest',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'migration-runtime-identity-'));
  try{
    const files=[{path:'code.mjs',bytes:Buffer.from('export const actual=1;\n')},{path:'code.mjs.map',bytes:Buffer.from('{"sources":["../code.mts"]}\n')},{path:'asset.bin',bytes:Buffer.from([0,1,255])}];
    for(const file of files)writeFileSync(path.join(root,file.path),file.bytes);
    const manifest={schema_version:1,status:'STAGED_NOT_ACTIVATED',node_major:24,source:{head:'a'.repeat(40),inputs:[]},
      outputs:files.map(file=>({path:file.path,source:file.path,kind:'RESOURCE',sha256:hash(file.bytes)}))};
    const archived=Buffer.from(JSON.stringify(manifest)+'\n'),file=path.join(root,'build-manifest.json');writeFileSync(file,archived);
    const current=runtimeOutputInventory(root);assert.equal(current.file_count,4);assert.ok(current.files.includes('code.mjs.map'));
    writeFileSync(path.join(root,'code.mjs.map'),'changed');assert.throws(()=>runtimeOutputInventory(root),/MIGRATION_OUTPUT_TAMPERED/u);writeFileSync(path.join(root,'code.mjs.map'),files[1]?.bytes??Buffer.alloc(0));
    writeFileSync(path.join(root,'extra.txt'),'undeclared');assert.throws(()=>runtimeOutputInventory(root),/MIGRATION_UNDECLARED_OUTPUT/u);rmSync(path.join(root,'extra.txt'));
    manifest.source.head='b'.repeat(40);writeFileSync(file,JSON.stringify(manifest));assert.notEqual(runtimeOutputInventory(root).fingerprint,current.fingerprint);
    assert.equal(runtimeOutputInventory(root,archived).fingerprint,current.fingerprint);
    const first=manifest.outputs[0];assert.ok(first);first.source='different.mts';writeFileSync(file,JSON.stringify(manifest));assert.throws(()=>runtimeOutputInventory(root,archived),/MIGRATION_RUNTIME_ARCHIVE_MISMATCH/u);
  }finally{
    assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('migration-runtime-identity-'));rmSync(root,{recursive:true,force:true});
  }
});

test('successful Git warnings stay captured while nonzero Git commands still fail',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'migration-git-diagnostics-'));
  try{
    execFileSync('git',['init','--quiet',root],{windowsHide:true,stdio:'pipe'});
    writeFileSync(path.join(root,'native.txt'),'synthetic LF\n');writeFileSync(path.join(root,'captured.txt'),'synthetic LF\n');
    const options=['-c','core.autocrlf=true','-c','core.safecrlf=warn','add','--'];
    const native=spawnSync('git',[...options,'native.txt'],{cwd:root,encoding:'utf8',windowsHide:true});
    assert.equal(native.status,0);assert.notEqual(native.stderr.trim(),'','the regression requires a genuine Git diagnostic');
    const module=pathToFileURL(path.join(original,'.build/tools/common.mjs')).href;
    const child=spawnSync(process.execPath,['--input-type=module','-e',
      `import {git} from ${JSON.stringify(module)};git(process.cwd(),${JSON.stringify([...options,'captured.txt'])});console.log('GIT_SUCCEEDED');`],
    {cwd:root,encoding:'utf8',windowsHide:true});
    assert.equal(child.status,0);assert.equal(child.stdout.trim(),'GIT_SUCCEEDED');assert.equal(child.stderr,'');
    assert.ok(runGit(root,['diff','--cached','--name-only']).includes('captured.txt'));
    assert.throws(()=>runGit(root,['not-a-git-command']),error=>error instanceof Error&&'status' in error&&error.status!==0&&'stderr' in error&&typeof error.stderr==='string'&&error.stderr.length>0);
  }finally{
    assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('migration-git-diagnostics-'));
    rmSync(root,{recursive:true,force:true});
  }
});

function scratch(reference = false): string {
  const root = mkdtempSync(path.join(tmpdir(), 'types-migration-test-'));
  execFileSync('git', ['clone', '--quiet', '--no-hardlinks', original, root], { stdio: 'pipe', windowsHide: true });
  if (reference) execFileSync('git', ['checkout', '--quiet', '--detach', '7eefaa99591bfaa2e787701efd315ff701c51f35'], { cwd: root, windowsHide: true });
  // Overlay deletions as well as additions, so uncommitted renames cannot create dual sources.
  if (!reference) { const current = new Set(workspaceFiles(original)); for (const relative of workspaceFiles(root)) if (!current.has(relative)) rmSync(path.join(root, relative)); for (const directory of ['src','scripts']) if (!workspaceFiles(original).some(file=>file.startsWith(directory+'/'))) rmSync(path.join(root,directory),{recursive:true,force:true}); }
  for (const relative of reference ? [] : workspaceFiles(original)) {
    const target = path.join(root, relative); mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.join(original, relative), target);
  }
  symlinkSync(path.join(original, 'node_modules'), path.join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  return root;
}
function alter(root: string, relative: string, content: string, fn: () => void): void {
  const file = path.join(root, relative), previous = existsSync(file) ? readFileSync(file) : null;
  mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, content);
  try { fn(); } finally { if (previous) writeFileSync(file, previous); else rmSync(file); }
}

test('T01 build and negative checks run on an owned full clone, never on user source', async t => {
  const root = scratch();
  try {
    const first = build(root), digest = verifyArtifact(root);
    await t.test('WEB01 source identity and hashed browser assets cannot fall back or drift',()=>{
      const pcSources=workspaceFiles(root).filter(file=>file.startsWith('app/pc-admin/'));
      assert.ok(pcSources.length>0);
      assert.deepEqual(first.source.inputs.filter(file=>file.path.startsWith('app/pc-admin/')).map(file=>file.path),pcSources);
      assert.ok(!first.source.inputs.some(file=>file.path.startsWith('web/admin-workbench/')));
      const asset=first.outputs.find(f=>f.kind==='WEB'&&f.path.startsWith('web/admin-workbench/')&&f.path.endsWith('.js'));
      assert.ok(asset,'real frontend output must be in the artifact');
      assert.ok(first.outputs.filter(file=>file.kind==='WEB'&&file.path.startsWith('web/admin-workbench/')).every(file=>file.source==='app/pc-admin/index.html'));
      alter(root,asset.path.replace(/^web\//u,'.build/runtime/web/'),'tampered browser script',()=>assert.throws(()=>verifyArtifact(root),/MIGRATION_OUTPUT_TAMPERED/u));
      const target=path.join(root,'.build/runtime',asset.path),bytes=readFileSync(target);
      rmSync(target);try{assert.throws(()=>verifyArtifact(root));}finally{writeFileSync(target,bytes);}
      const source='app/pc-admin/src/api/client.ts';
      alter(root,source,readFileSync(path.join(root,source),'utf8')+'\n// changed input\n',()=>assert.throws(()=>verifyArtifact(root),/MIGRATION_INPUT_DRIFT/u));
    });
    await t.test('PC source relocation preserves strict checking and complete source coverage',()=>{
      alter(root,'app/pc-admin/src/migration-layout-probe.ts','export const checked: string = 42;\n',()=>assert.throws(()=>typecheckWeb(root)));
      // Outside tsconfig.include: a valid TS file must still be rejected as unchecked.
      alter(root,'app/pc-admin/migration-layout-probe.ts','export const checked: string = "synthetic";\n',()=>assert.throws(()=>typecheckWeb(root),/WEB01_UNCHECKED_SOURCE/u));
      alter(root,'app/pc-admin/src/unimported-layout-probe.mts','export const checked = "synthetic";\n',()=>assert.throws(()=>program(root,'tsconfig.migration.json'),/MIGRATION_UNCHECKED_TARGET/u));
    });
    await t.test('native backend and shared outputs retain explicit ownership and complete checking',()=>{
      for(const file of ['app/server/src/migration-canary.mts','shared/workbench-search-contracts.mts','app/pc-admin/src/contracts/workbench-reminder-browser-contracts.mts','app/pc-admin/src/realtime/workbench-realtime-client.mts'])assert.ok(first.typed_implementations.includes(file));
      assert.ok(first.outputs.every(file=>!file.path.startsWith('src/')&&!file.path.startsWith('scripts/')));
      for(const file of ['g0-001-test-wss.ps1','p1-012-wecom-burst-ui.ps1','p2-g2-postgres-native.sh'])assert.ok(!first.outputs.some(output=>output.path==='app/server/scripts/'+file));
      alter(root,'app/server/src/unimported-layout-probe.mts','export const checked: string = 42;\n',()=>assert.throws(()=>program(root,'tsconfig.migration.json'),/not assignable/u));
    });
    assert.ok(first.typed_implementations.includes('app/server/src/migration-canary.mts'));
    assert.ok(first.typed_implementations.includes('app/server/src/p2-015-incident-correlation.mts'));
    assert.ok(first.typed_implementations.includes('app/server/src/p2-g2-service-loop-assembly.mts'));
    await t.test('two clean builds produce identical manifests', () => {
      assert.deepEqual(buildSyntaxEvidence(first),{actual_node_checks:first.typed_implementations.length,reused_checks:0,covered_files:first.typed_implementations.length,node_sha256:hash(readFileSync(process.execPath))});
      const second=build(root,{syntaxReference:first});assert.equal(verifyArtifact(root), digest);
      assert.deepEqual(buildSyntaxEvidence(second),{actual_node_checks:0,reused_checks:first.typed_implementations.length,covered_files:first.typed_implementations.length,node_sha256:hash(readFileSync(process.execPath))});
    });
    await t.test('every legacy file preserves exact source bytes', () => {
      for (const f of first.outputs.filter(x => x.kind === 'LEGACY' || x.kind === 'RESOURCE')) assert.deepEqual(readFileSync(path.join(root, '.build/runtime', f.path)), readFileSync(path.join(root, f.source)));
    });
    for (const relative of ['app/server/src/migration-canary.mts', 'tsconfig.base.json', 'package-lock.json']) {
      await t.test('input drift is rejected: ' + relative, () => {
        alter(root, relative, readFileSync(path.join(root, relative), 'utf8') + '\n', () => assert.throws(() => verifyArtifact(root), /MIGRATION_INPUT_DRIFT/u));
      });
    }
    for (const relative of ['app/server/src/migration-canary.mjs', 'app/server/src/p2-015-decision-store.mjs', 'web/p2-workbench/index.html']) {
      await t.test('artifact tampering is rejected: ' + relative, () => {
        alter(root, '.build/runtime/' + relative, '// changed', () => assert.throws(() => verifyArtifact(root), /MIGRATION_OUTPUT_TAMPERED/u));
      });
    }
    await t.test('manifest tampering is rejected by an outer digest', () => {
      alter(root, '.build/runtime/build-manifest.json', '{}', () => assert.throws(() => verifyArtifact(root), /MIGRATION_MANIFEST_TAMPERED/u));
    });
    await t.test('unexpected files, including env files, cannot hide in the artifact', () => {
      alter(root, '.build/runtime/.env', 'SYNTHETIC_ONLY=1', () => assert.throws(() => verifyArtifact(root), /MIGRATION_UNDECLARED_OUTPUT/u));
    });
    await t.test('omitting a root target is rejected even when transitively imported', () => {
      const relative = 'tsconfig.migration.json';
      const config: unknown = JSON.parse(readFileSync(path.join(root, relative), 'utf8'));
      assert.ok(config && typeof config === 'object');
      alter(root, relative, JSON.stringify({ ...config, include: ['tests/migration-canary.test.mts'] }), () => assert.throws(() => program(root, relative), /MIGRATION_UNCHECKED_TARGET/u));
    });
    await t.test('new untyped production is rejected even if a current inventory edit calls it legacy', () => {
      for (const relative of ['app/server/src/new-service.mjs', 'app/server/scripts/new-service.mjs', 'app/server/src/new-service.js', 'app/server/src/new-service.cjs']) {
        alter(root, relative, 'export const untyped = true;', () => {
          assert.throws(() => program(root, 'tsconfig.migration.json'), /MIGRATION_NEW_UNTYPED_PRODUCTION/u);
          alter(root, 'plans/typescript-migration/scope.json', '{}', () => assert.throws(() => build(root), /MIGRATION_NEW_UNTYPED_PRODUCTION/u));
          assert.equal(existsSync(path.join(root, '.build/artifact-proof.json')), false);
        });
      }
    });
    await t.test('a committed MTS migration cannot be silently restored as grandfathered MJS', () => {
      const retiredRoot = scratch(true);
      try {
        const js = path.join(retiredRoot, 'src/g0-002-sdk-lifecycle.mjs');
        const typed = path.join(retiredRoot, 'src/g0-002-sdk-lifecycle.mts');
        const originalBytes = readFileSync(js);
        rmSync(js); writeFileSync(typed, originalBytes);
        execFileSync('git', ['add', 'src/g0-002-sdk-lifecycle.mjs', 'src/g0-002-sdk-lifecycle.mts'], { cwd: retiredRoot });
        execFileSync('git', ['-c', 'user.name=Migration test fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Synthetic fixture: record typed migration'], { cwd: retiredRoot });
        rmSync(typed); writeFileSync(js, originalBytes);
        assert.throws(() => program(retiredRoot, 'tsconfig.migration.json'), /MIGRATION_RETIRED_LEGACY/u);
        assert.throws(() => build(retiredRoot), /MIGRATION_RETIRED_LEGACY/u);
      } finally { rmSync(retiredRoot, { recursive: true, force: true }); }
    });
    await t.test('parentheses, satisfies and angle assertions cannot disguise double casts', () => {
      for (const expression of ['value as unknown as string', '(value as unknown) as string', '(((value as unknown))) as string',
        '(value as unknown satisfies unknown) as string', '<string>(<unknown>value)']) {
        alter(root, 'app/server/src/assertion-negative.mts', 'const value = 1; export const result = ' + expression + ';', () => {
          assert.throws(() => program(root, 'tsconfig.migration.json'), /MIGRATION_TYPE_ESCAPE/u);
        });
      }
    });
    await t.test('new JavaScript tools are not grandfathered by a directory', () => {
      for (const relative of ['tools/helper.mjs', '.github/review/helper.mjs', 'tools/ts-migration/helper.js']) {
        alter(root, relative, 'export const unchecked = 1;', () => {
          assert.throws(() => program(root, 'tsconfig.tools.json'), /MIGRATION_NEW_UNTYPED_TOOL/u);
          assert.throws(() => build(root), /MIGRATION_NEW_UNTYPED_TOOL/u);
        });
      }
    });
    await t.test('local declarations cannot hide any or a suppressed error', () => {
      for (const [relative, content] of [
        ['app/server/src/declaration-negative.d.mts', 'export const unchecked: any;'],
        ['app/server/src/declaration-negative.d.mts', '// @ts-ignore\nexport const invalid: MissingType;'],
        ['app/server/src/declaration-negative.d.ts', 'export const unchecked: any;'],
        ['contracts/declaration-negative.d.cts', 'export const unchecked: any;'],
        ['contracts/declaration-negative.d.cts', '// @ts-ignore\nexport const invalid: MissingType;'],
      ]) {
        if (!relative || !content) throw new Error('invalid negative fixture');
        alter(root, relative, content, () => {
          const specifier = relative.endsWith('.d.cts') ? '../../../contracts/declaration-negative.cjs' : relative.endsWith('.d.mts') ? './declaration-negative.mjs' : './declaration-negative.js';
          alter(root, 'app/server/src/declaration-negative-consumer.mts', `import { ${content.includes('unchecked') ? 'unchecked' : 'invalid'} } from '${specifier}';`, () => {
            assert.throws(() => program(root, 'tsconfig.migration.json'), /MIGRATION_TYPE_(?:ESCAPE|SUPPRESSION)/u);
          });
        });
      }
    });
    await t.test('expect-error requires substantive explanation rather than padding', () => {
      for (const reason of ['        ', '\t\t\t\t\t\t\t\t', '********']) {
        alter(root, 'tests/types/padding-negative.mts', `// @ts-expect-error -- ${reason}\nconst rejected: number = 'wrong';`, () => {
          assert.throws(() => program(root, 'tsconfig.type-tests.json'), /MIGRATION_TYPE_SUPPRESSION/u);
        });
      }
    });
    await t.test('same logical MJS and MTS are rejected and stale success is removed', () => {
      alter(root, 'app/server/src/g0-002-sdk-lifecycle.mts', 'export const duplicate = true;', () => {
        assert.throws(() => build(root), /MIGRATION_DUPLICATE_LOGICAL_SOURCE/u);
        assert.equal(existsSync(path.join(root, '.build/artifact-proof.json')), false);
        assert.equal(existsSync(path.join(root, '.build/runtime/build-manifest.json')), false);
      });
    });
    await t.test('missing required resources fail without source fallback', () => {
      const resource = path.join(root, 'web/p2-workbench/index.html'), content = readFileSync(resource);
      rmSync(resource);
      try { assert.throws(() => build(root)); assert.equal(existsSync(path.join(root, '.build/artifact-proof.json')), false); }
      finally { writeFileSync(resource, content); }
    });
    await t.test('compile failure leaves no previously successful artifact', () => {
      assert.throws(()=>build(root,{syntaxReference:{...first}}),/MIGRATION_SYNTAX_PROOF_NOT_OWNED/u);
      assert.equal(existsSync(path.join(root,'.build/artifact-proof.json')),false);
      const source='app/server/src/migration-canary.mts';
      alter(root,source,readFileSync(path.join(root,source),'utf8')+'\n// A changed controlled input cannot borrow the prior syntax proof.\n',()=>{
        const changed=build(root,{syntaxReference:first});const proof=buildSyntaxEvidence(changed);
        assert.equal(proof.actual_node_checks,changed.typed_implementations.length);assert.equal(proof.reused_checks,0);
        alter(root,source,"export const wrong: number = 'bad';",()=>{
          assert.throws(() => build(root)); assert.equal(existsSync(path.join(root, '.build/runtime/build-manifest.json')), false);
        });
      });
    });
    await t.test('disabled strictness and unsafe emit directories are rejected', () => {
      for (const override of [{ strict: false }, { strictNullChecks: false }, { noCheck: true }, { outDir: './src' }]) {
        const relative = 'tsconfig.migration.json';
        alter(root, relative, JSON.stringify({ extends: './tsconfig.base.json', compilerOptions: { rootDir: '.', outDir: './.build/emit', allowJs: true, ...override }, include: ['app/server/src/**/*.mts', 'tests/migration-canary.test.mts'] }), () => assert.throws(() => program(root, relative), /MIGRATION_/u));
      }
    });
    await t.test('tooling never recursively removes an unowned build directory', () => {
      const marker = path.join(root, '.build/.migration-owner'), content = readFileSync(marker);
      writeFileSync(marker, 'not this project');
      try { assert.throws(() => cleanGenerated(root, 'runtime'), /MIGRATION_UNOWNED_BUILD_ROOT/u); }
      finally { writeFileSync(marker, content); }
    });
    await t.test('a symlink build root is rejected without deleting its destination', () => {
      const other = mkdtempSync(path.join(tmpdir(), 'types-owned-link-'));
      const linkRoot = mkdtempSync(path.join(tmpdir(), 'types-link-root-'));
      try {
        writeFileSync(path.join(other, 'keep'), 'keep');
        symlinkSync(other, path.join(linkRoot, '.build'), process.platform === 'win32' ? 'junction' : 'dir');
        assert.throws(() => controlledBuildRoot(linkRoot), /MIGRATION_UNSAFE_BUILD_ROOT/u);
        assert.equal(readFileSync(path.join(other, 'keep'), 'utf8'), 'keep');
      } finally { rmSync(linkRoot, { recursive: true, force: true }); rmSync(other, { recursive: true, force: true }); }
    });
    await t.test('the real tsc CLI rejects a wrong call and accepts its corrected form', () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'types-negative-cli-'));
      try {
        const file = path.join(dir, 'negative.mts');
        for (const bad of [true, false]) {
          writeFileSync(file, `import { canary } from '${path.join(root, 'app/server/src/migration-canary.mjs').replaceAll('\\', '/')}';\ncanary({ label: 'cli', sequence: ${bad ? "'wrong'" : '1'} });`);
          const result = spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--types', 'node', '--typeRoots', path.join(root, 'node_modules/@types'), file], { cwd: root, encoding: 'utf8', windowsHide: true });
          assert.equal(result.error, undefined);
          if (bad) { assert.notEqual(result.status, 0); assert.match(result.stdout, /TS2322/u); }
          else assert.equal(result.status, 0, result.stdout);
        }
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('ARCH-006 CLI rejects content changes within an already reviewed path', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'arch006-content-regression-'));
  try {
    execFileSync('git', ['clone', '--quiet', '--no-hardlinks', original, root], { windowsHide: true, stdio: 'pipe' });
    execFileSync('git', ['checkout', '--quiet', '--detach', '1911d364e48530683032f8856c41678c80f69dc9'], { cwd: root, windowsHide: true });
    const base = '87de2bc9e8835882cd390b024a04e2865cd367f9';
    execFileSync('git', ['update-ref', 'refs/remotes/origin/main', base], { cwd: root, windowsHide: true });
    const report = mkdtempSync(path.join(tmpdir(), 'arch006-logs-'));
    const scope = '- valid pinned local self-service successor scope\n';
    const evidence = '- historical Evidence is immutable; authorized current reports require exact snapshots and current READY proof\n';
    writeFileSync(path.join(report, 'base-arch006.txt'), 'ARCH-006 validation failed with 2 error(s):\n' + scope + evidence);
    writeFileSync(path.join(report, 'current-arch006.txt'), 'ARCH-006 validation failed with 3 error(s):\n- no forbidden Runtime Migration web archive or secret path changed\n' + scope + evidence);
    const run = (expectedBase: string | undefined = base) => spawnSync(process.execPath, [path.join(original, '.build/tools/arch006-baseline.mjs'), report], {
      cwd: root, env: { ...process.env, EXPECTED_BASE: expectedBase }, encoding: 'utf8', windowsHide: true,
    });
    const accepted = run();
    assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
    assert.match(accepted.stdout, /ARCH006_KNOWN_BASELINE_NOT_READY/u);
    assert.notEqual(run('1911d364e48530683032f8856c41678c80f69dc9').status, 0, 'a different PR base requires its own review');
    assert.notEqual(run('').status, 0, 'the PR-event base is mandatory');
    const currentLog = path.join(report, 'current-arch006.txt');
    const originalLog = readFileSync(currentLog, 'utf8');
    writeFileSync(currentLog, originalLog + '- unexpected failure\n');
    assert.match(run().stderr, /ARCH006_CURRENT_REJECTION_DRIFT/u);
    writeFileSync(currentLog, 'ARCH-006 rule-first service loop validation passed (1 checks).\n');
    assert.notEqual(run().status, 0, 'a readiness PASS cannot be classified as known non-readiness');
    writeFileSync(currentLog, originalLog);
    writeFileSync(path.join(root, 'README.md'), readFileSync(path.join(root, 'README.md'), 'utf8') + '\nSynthetic documentation successor.\n');
    execFileSync('git', ['add', 'README.md'], { cwd: root, windowsHide: true });
    execFileSync('git', ['-c', 'user.name=Migration test fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Synthetic documentation successor'], { cwd: root, windowsHide: true });
    assert.equal(run().status, 0, 'documentation-only successors retain the reviewed runtime content');
    execFileSync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd: root, windowsHide: true });
    assert.equal(run().status, 0, 'a moving origin/main must not change the PR-event comparison');
    writeFileSync(path.join(report, 'current-arch006.txt'), readFileSync(path.join(report, 'base-arch006.txt')));
    assert.equal(run().status, 0, 'the original two-error rejection can also be retained');
    const file = path.join(root, 'src/p1-001-pilot-foundation.mts');
    writeFileSync(file, readFileSync(file, 'utf8') + "\nthrow new Error('SYNTHETIC_RUNTIME_REGRESSION');\n");
    assert.notEqual(run().status, 0, 'uncommitted runtime content cannot borrow the clean HEAD fingerprint');
    execFileSync('git', ['add', 'src/p1-001-pilot-foundation.mts'], { cwd: root, windowsHide: true });
    execFileSync('git', ['-c', 'user.name=Migration test fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Synthetic same-path runtime regression'], { cwd: root, windowsHide: true });
    const rejected = run();
    assert.notEqual(rejected.status, 0, 'a same-path production mutation must not share the reviewed exception');
    assert.match(rejected.stdout + rejected.stderr, /ARCH006_REVIEWED_RUNTIME_DELTA_DRIFT/u);
    execFileSync('git', ['checkout', '--quiet', '--detach', '1911d364e48530683032f8856c41678c80f69dc9'], { cwd: root, windowsHide: true });
    assert.equal(run().status, 0);
    if (process.platform !== 'win32') chmodSync(file, 0o755);
    execFileSync('git', ['update-index', '--chmod=+x', 'src/p1-001-pilot-foundation.mts'], { cwd: root, windowsHide: true });
    execFileSync('git', ['-c', 'user.name=Migration test fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Synthetic runtime mode regression'], { cwd: root, windowsHide: true });
    assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim(), '', 'the mode regression must be a clean committed object');
    assert.match(run().stderr, /ARCH006_REVIEWED_RUNTIME_DELTA_DRIFT/u);
    execFileSync('git', ['checkout', '--quiet', '--detach', '1911d364e48530683032f8856c41678c80f69dc9'], { cwd: root, windowsHide: true });
    for (const relative of ['database/migrations/999_synthetic.sql', 'evidence/synthetic-rewrite.json']) {
      writeFileSync(path.join(root, relative), 'synthetic only\n');
      execFileSync('git', ['add', relative], { cwd: root, windowsHide: true });
      execFileSync('git', ['-c', 'user.name=Migration test fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Synthetic out-of-scope regression'], { cwd: root, windowsHide: true });
      assert.match(run().stderr, /ARCH006_REVIEWED_RUNTIME_DELTA_DRIFT/u);
      execFileSync('git', ['checkout', '--quiet', '--detach', '1911d364e48530683032f8856c41678c80f69dc9'], { cwd: root, windowsHide: true });
    }
    rmSync(report, { recursive: true, force: true });
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test('bounded native syntax jobs parse every emitted file without executing code',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'migration-syntax-check-'));
 try{
  const output=path.join(root,'.build/runtime');mkdirSync(output,{recursive:true});
  const files=['one.mjs','two.mjs','three.mjs'].map(name=>path.join(output,name));
  for(const file of files)writeFileSync(file,"throw new Error('PARSE_ONLY_MUST_NOT_EXECUTE'); export const value=1;\n");
  const state=await checkCompiledSyntax(root,files);
  assert.deepEqual(state,{started:3,checked:3,active:0,max_active:2});
  assert.ok(files[0]);writeFileSync(files[0],"export const =1;\n");
  await assert.rejects(checkCompiledSyntax(root,files),error=>{
   assert.ok(error instanceof Error);assert.match(error.message,/MIGRATION_COMMAND_FAILED/u);
   assert.ok('syntax_state' in error);const state=error.syntax_state;
   assert.ok(state!==null&&typeof state==='object'&&'active' in state&&'max_active' in state);
   assert.equal(state.active,0);assert.equal(state.max_active,2);return true;
  });
 }finally{assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('migration-syntax-check-'));rmSync(root,{recursive:true,force:true});}
});


test('compile-only observer boundary keeps actual execution coverage and native checks',()=>{
 const root=mkdtempSync(path.join(tmpdir(),'migration-coverage-boundary-')),prior=process.env.NODE_V8_COVERAGE;
 try{
  const coverage=path.join(root,'coverage'),file=path.join(root,'real.mjs');mkdirSync(coverage);
  writeFileSync(file,"export const value=1;\n");process.env.NODE_V8_COVERAGE=coverage;
  runNode(root,['--check',file]);assert.deepEqual(readdirSync(coverage).filter(name=>name.endsWith('.json')),[]);
  writeFileSync(file,"export const =1;\n");assert.throws(()=>runNode(root,['--check',file]),/MIGRATION_COMMAND_FAILED/u);
  assert.deepEqual(readdirSync(coverage).filter(name=>name.endsWith('.json')),[]);
  writeFileSync(file,"export const value=1;\n");runNode(root,[file]);assert.ok(readdirSync(coverage).filter(name=>name.endsWith('.json')).length>0);
 }finally{
  if(prior===undefined)delete process.env.NODE_V8_COVERAGE;else process.env.NODE_V8_COVERAGE=prior;
  assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('migration-coverage-boundary-'));rmSync(root,{recursive:true,force:true});
 }
});


test('direct syntax API excludes parse coverage and preserves actual execution coverage',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'migration-direct-syntax-coverage-')),prior=process.env.NODE_V8_COVERAGE;
 try{
  const output=path.join(root,'.build/runtime'),coverage=path.join(root,'coverage');mkdirSync(output,{recursive:true});mkdirSync(coverage);
  const files=['one.mjs','two.mjs','three.mjs'].map(name=>path.join(output,name));
  for(const file of files)writeFileSync(file,"throw new Error('DIRECT_PARSE_MUST_NOT_EXECUTE'); export const value=1;\n");
  process.env.NODE_V8_COVERAGE=coverage;
  const state=await checkCompiledSyntax(root,files);assert.deepEqual(state,{started:3,checked:3,active:0,max_active:2});
  assert.deepEqual(readdirSync(coverage).filter(name=>name.endsWith('.json')),[]);
  assert.equal(process.env.NODE_V8_COVERAGE,coverage,'the parent observer must remain enabled');
  assert.ok(files[0]);writeFileSync(files[0],"export const =1;\n");
  await assert.rejects(checkCompiledSyntax(root,files),error=>{
   assert.ok(error instanceof Error);assert.match(error.message,/MIGRATION_COMMAND_FAILED/u);
   assert.ok('syntax_state' in error);const state=error.syntax_state;
   assert.ok(state!==null&&typeof state==='object'&&'active' in state&&'max_active' in state);
   assert.equal(state.active,0);assert.equal(state.max_active,2);return true;
  });
  assert.deepEqual(readdirSync(coverage).filter(name=>name.endsWith('.json')),[]);
  const real=path.join(output,'actual.mjs');writeFileSync(real,"export const value=1;\n");runNode(root,[real]);
  assert.ok(readdirSync(coverage).filter(name=>name.endsWith('.json')).length>0,'actual execution must still be observed');
 }finally{
  if(prior===undefined)delete process.env.NODE_V8_COVERAGE;else process.env.NODE_V8_COVERAGE=prior;
  assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('migration-direct-syntax-coverage-'));rmSync(root,{recursive:true,force:true});
 }
});
