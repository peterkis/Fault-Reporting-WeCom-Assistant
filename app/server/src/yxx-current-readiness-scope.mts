import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';

export const CURRENT_YXX_BASE = 'd3b7fda4f2cfb4291f550a9ed0952812dcf9a18f';
export const CURRENT_YXX_TREE = '0f9c36124459cf681902c39c1002636d9e5f17a9';
export const CURRENT_YXX_CONTRACT = 'ADR-0045';
export const CURRENT_YXX_SCOPE = 'plans/yxx-current-readiness-scope.v2.json';
export const CURRENT_YXX_ACCEPTANCE = 'plans/yxx-current-readiness-acceptance.v2.json';
export const LEGACY_YXX_BASE = '562a96ffdd7148d729ab0eed9d215abe894f12c2';
export const LEGACY_YXX_TREE = 'fc20b1021291aca44b45ba3be461423a61bcee48';
export const LEGACY_YXX_SCOPE = 'plans/yxx-current-readiness-scope.json';
export const HISTORICAL_SS009_HEAD = '41edd855e7bc55149facb6a4b2e0076776c22e66';
const states = ['MANIFEST.json', 'plans/current_phase.json', 'plans/master_backlog.json',
  'plans/parallel_workstreams.json', 'tasks/master_backlog.json', 'project_summary.json'];
const defaults = ['.env.example', 'config_examples/yxx-limited-write-authorization.example.json'];
const lf = (value: string): string => value.replaceAll('\r\n', '\n');
const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
type ScopeProfile = {base:string;tree:string;file:string;contract:'ADR-0027'|'ADR-0045';sqlCount:22|49};
const currentProfile:ScopeProfile={base:CURRENT_YXX_BASE,tree:CURRENT_YXX_TREE,file:CURRENT_YXX_SCOPE,contract:CURRENT_YXX_CONTRACT,sqlCount:49};
const legacyProfile:ScopeProfile={base:LEGACY_YXX_BASE,tree:LEGACY_YXX_TREE,file:LEGACY_YXX_SCOPE,contract:'ADR-0027',sqlCount:22};

export type CurrentYxxScope = {
  base_head: string; base_tree: string; scope_sha256: string; migration_files: string[];
  contract:'ADR-0027'|'ADR-0045';
  historical_ss009_head: string; live_authorized: false; parent_gate_advanced: false;
};

/** Current structural contract only; a valid scope is never runtime acceptance. */
export function readCurrentYxxScope(root:string):CurrentYxxScope{return readYxxScope(root,currentProfile);}
/** Explicit predecessor diagnostics; never selected by current readiness. */
export function readLegacyYxxScope(root:string):CurrentYxxScope{return readYxxScope(root,legacyProfile);}

function readYxxScope(root: string,profile:ScopeProfile): CurrentYxxScope {
  try {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
    env.GIT_NO_REPLACE_OBJECTS = '1';
    const git = (args: string[]): string => execFileSync('git', args, {
      cwd: root, env, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.equal(realpathSync(git(['rev-parse', '--show-toplevel']).trim()), realpathSync(root));
    assert.equal(git(['rev-parse', '--is-shallow-repository']).trim(), 'false');
    assert.equal(git(['for-each-ref', '--format=%(refname)', 'refs/replace/']).trim(), '');
    const graft = path.resolve(root, git(['rev-parse', '--git-path', 'info/grafts']).trim());
    assert.ok(!existsSync(graft) || readFileSync(graft, 'utf8').trim() === '');
    assert.equal(git(['rev-parse', profile.base + '^{tree}']).trim(), profile.tree);
    git(['merge-base', '--is-ancestor', profile.base, 'HEAD']);
    git(['merge-base', '--is-ancestor', HISTORICAL_SS009_HEAD, profile.base]);
    const read = (relative: string): string => {
      let current = root;
      for (const part of relative.split('/')) {
        assert.ok(part && part !== '.' && part !== '..' && !part.includes('\\'));
        current = path.join(current, part); assert.equal(lstatSync(current).isSymbolicLink(), false);
      }
      const stat = lstatSync(current); assert.ok(stat.isFile() && stat.size <= 16 * 1024 * 1024);
      return lf(new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(current)));
    };
    const scopeText = read(profile.file);
    const scope: unknown = JSON.parse(scopeText);
    assert.ok(isRecord(scope));
    assert.deepEqual(Object.keys(scope).sort(), ['schema_version', 'work_item', 'contract', 'base_head', 'base_tree',
      'historical_ss009_head', 'content_encoding', 'files', 'default_files', 'live_authorized', 'parent_gate_advanced', 'sql_changes_authorized'].sort());
    assert.equal(scope.schema_version, 1); assert.equal(scope.work_item, 'YXX_CURRENT_READINESS');
    assert.equal(scope.contract, profile.contract); assert.equal(scope.content_encoding, 'UTF8_LF');
    assert.equal(scope.base_head, profile.base); assert.equal(scope.base_tree, profile.tree);
    assert.equal(scope.historical_ss009_head, HISTORICAL_SS009_HEAD);
    for (const key of ['live_authorized', 'parent_gate_advanced', 'sql_changes_authorized']) assert.equal(scope[key], false);
    // Batch immutable object and index reads. Each file still gets independent
    // mode/blob/LF-content checks; spawning Git three times per file made valid
    // 49-file positives exceed the unchanged Windows test budget.
    const tree=new Map<string,{mode:string;blob:string}>();
    for(const entry of git(['ls-tree','-r','-z',profile.base,'--','database/migrations',...states,...defaults]).split('\0').filter(Boolean)){
      const tab=entry.indexOf('\t');assert.ok(tab>0);const [mode,type,blob]=entry.slice(0,tab).split(' '),file=entry.slice(tab+1);
      assert.ok(mode==='100644'||mode==='100755');assert.equal(type,'blob');assert.ok(blob&&/^[a-f0-9]{40}$/u.test(blob));
      assert.equal(tree.has(file),false);tree.set(file,{mode,blob});
    }
    const sql=[...tree.keys()].filter(file=>file.startsWith('database/migrations/'));
    assert.equal(sql.length, profile.sqlCount);
    assert.equal(lstatSync(path.join(root, 'database')).isSymbolicLink(), false);
    assert.equal(lstatSync(path.join(root, 'database/migrations')).isSymbolicLink(), false);
    assert.deepEqual(readdirSync(path.join(root, 'database/migrations')).sort(), sql.map(p => path.posix.basename(p)).sort());
    const selected=[...sql,...states,...defaults];assert.equal(tree.size,selected.length);
    const ids=selected.map(file=>{const entry=tree.get(file);assert.ok(entry);return entry.blob;});
    const objects=execFileSync('git',['cat-file','--batch'],{cwd:root,env,windowsHide:true,stdio:['pipe','pipe','pipe'],
      input:ids.join('\n')+'\n',maxBuffer:64*1024*1024});
    const hashes=new Map<string,string>();let offset=0;
    for(const id of ids){
      const newline=objects.indexOf(10,offset);assert.ok(newline>offset);
      const header=/^([a-f0-9]{40}) blob ([0-9]+)$/u.exec(objects.subarray(offset,newline).toString('ascii'));assert.ok(header);assert.equal(header[1],id);
      const size=Number(header[2]);assert.ok(Number.isSafeInteger(size)&&size>=0&&size<=16*1024*1024);
      const start=newline+1,end=start+size;assert.ok(end<objects.length);assert.equal(objects[end],10);
      const bytes=objects.subarray(start,end);assert.equal(createHash('sha1').update('blob '+size+'\0').update(bytes).digest('hex'),id);
      hashes.set(id,digest(lf(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes))));offset=end+1;
    }
    assert.equal(offset,objects.length);
    const indexed=new Map<string,{mode:string;blob:string}>();
    for(const entry of git(['ls-files','--stage','-z','--',...selected]).split('\0').filter(Boolean)){
      const tab=entry.indexOf('\t');assert.ok(tab>0);const [mode,blob,stage]=entry.slice(0,tab).split(' '),file=entry.slice(tab+1);
      assert.ok(mode&&blob);assert.equal(stage,'0');assert.equal(indexed.has(file),false);indexed.set(file,{mode,blob});
    }
    const entryFor = (file: string): { path: string; mode: string; blob: string; sha256_utf8_lf: string } => {
      const entry=tree.get(file);assert.ok(entry);const {mode,blob}=entry;
      const sha256=hashes.get(blob);assert.ok(sha256);
      assert.equal(digest(read(file)), sha256);
      const staged=indexed.get(file);assert.ok(staged);assert.equal(staged.mode,mode);assert.equal(staged.blob,blob);
      if (process.platform !== 'win32') assert.equal(lstatSync(path.join(root, file)).mode & 0o111 ? '100755' : '100644', mode);
      return { path: file, mode, blob, sha256_utf8_lf: sha256 };
    };
    assert.deepEqual(scope.files, [...sql, ...states].map(entryFor));
    assert.deepEqual(scope.default_files, defaults.map(entryFor));
    return { base_head: profile.base, base_tree: profile.tree, scope_sha256: digest(scopeText),contract:profile.contract,
      migration_files: sql, historical_ss009_head: HISTORICAL_SS009_HEAD, live_authorized: false, parent_gate_advanced: false };
  } catch {
    throw Object.assign(new Error('CURRENT_SCOPE_INVALID'), { code: 'CURRENT_SCOPE_INVALID', stage: 'SCOPE' });
  }
}
