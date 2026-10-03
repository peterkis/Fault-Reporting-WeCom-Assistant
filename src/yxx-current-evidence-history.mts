import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

const records = (text: string): string[] => text.split('\0').filter(Boolean);
const blobHash = (bytes: Buffer): string => createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
const textEvidence = /\.(?:json|jsonl|ndjson|md|tap|txt|log|csv|tsv|ya?ml|xml|html|sql|mjs|js|ps1|sh)$/iu;
const anchor = 'a1a48f9839315d7683d9973a1d9febfd14aa39a8';
type Transition = { commit: string; parent: string; path: string; before: string; after: string; oldMode: string; newMode: string; status: string };
const transitionKeys = ['commit', 'parent', 'path', 'before', 'after', 'oldMode', 'newMode', 'status'] as const;

/** Checks published evidence bytes and modes without trusting the Git stat cache. */
export function verifyCurrentYxxEvidenceHistory(root: string): void {
  try {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
    env.GIT_NO_REPLACE_OBJECTS = '1';
    const git = (args: string[]): string => execFileSync('git', args, {
      cwd: root, env, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.equal(realpathSync(git(['rev-parse', '--show-toplevel']).trim()), realpathSync(root));
    assert.equal(git(['rev-parse', '--is-shallow-repository']).trim(), 'false');
    assert.equal(git(['for-each-ref', '--format=%(refname)', 'refs/replace/']).trim(), '');
    const graft = path.resolve(root, git(['rev-parse', '--git-path', 'info/grafts']).trim());
    assert.ok(!existsSync(graft) || readFileSync(graft, 'utf8').trim() === '');
    git(['merge-base', '--is-ancestor', anchor, 'HEAD']);
    const approved: Transition[] = [];
    for (const [file, hash] of [
      ['.github/review/pr21-evidence-exceptions.json', '97a99da46bbe9c00fd30579d6e4e1f5c02f2f426ebf04004a9a64ea63b012c02'],
      ['.github/review/yxx-current-evidence-adjudication.json', '53327f6ffc34509c609ed2f46542151778540cbda64f8c11e5531b921b7e16d0'],
    ]) {
      assert.ok(file && hash);
      const text = readFileSync(path.join(root, file), 'utf8').replaceAll('\r\n', '\n');
      assert.equal(createHash('sha256').update(text).digest('hex'), hash);
      const value: unknown = JSON.parse(text);
      const entries: unknown = Array.isArray(value) ? value : value && typeof value === 'object' && 'changes' in value ? value.changes : undefined;
      assert.ok(Array.isArray(entries));
      for (const entry of entries) {
        assert.ok(entry && typeof entry === 'object');
        for (const key of transitionKeys) assert.equal(typeof entry[key], 'string');
        approved.push({ commit: entry.commit, parent: entry.parent, path: entry.path, before: entry.before,
          after: entry.after, oldMode: entry.oldMode, newMode: entry.newMode, status: entry.status });
      }
    }
    const parents = new Map(git(['rev-list', '--parents', anchor + '..HEAD']).trim().split('\n').map(line => {
      const [commit, ...values] = line.split(' '); assert.ok(commit); return [commit, values];
    }));
    // Explicit name-only output avoids patch text. Full history includes side branches;
    // checking every changed parent edge retains rewrite-restore and hidden merge edits.
    const changedCommits = new Set(git(['log', '--format=%H', '--name-only', '--diff-filter=a', '--full-history',
      '--diff-merges=separate', '--no-renames', anchor + '..HEAD', '--', 'evidence/']).split('\n').filter(line => /^[a-f0-9]{40}$/u.test(line)));
    const ancestorCache = new Map<string, Set<string>>();
    const ancestry = (commit: string): Set<string> => {
      let set = ancestorCache.get(commit);
      if (!set) { set = new Set(git(['rev-list', commit]).trim().split('\n')); ancestorCache.set(commit, set); }
      return set;
    };
    const accepted = new Set<Transition>();
    for (const commit of changedCommits) {
      const edges = parents.get(commit); assert.ok(edges && edges.length > 0);
      for (const parent of edges) {
        const raw = records(git(['diff-tree', '-r', '--raw', '-z', '--no-abbrev', '--no-renames', '--no-ext-diff', '--diff-filter=a', parent, commit, '--', 'evidence/']));
        assert.equal(raw.length % 2, 0);
        for (let i = 0; i < raw.length; i += 2) {
          const header = raw[i], file = raw[i + 1]; assert.ok(header && file);
          const [oldMode, newMode, before, after, status] = header.slice(1).split(' ');
          assert.ok(oldMode && newMode && before && after && status);
          const change: Transition = { commit, parent, path: file, oldMode, newMode, before, after, status };
          const exact = approved.find(entry => transitionKeys.every(key => entry[key] === change[key]));
          if (exact) { accepted.add(exact); continue; }
          // A merge may propagate only a forward chain of the six exact approved
          // transitions, supplied verbatim by another parent that contains that chain.
          // Arbitrary same-tree ancestry, reverse transitions and add/add conflicts fail.
          const propagated = edges.filter(other => other !== parent).some(other => {
            const target = git(['ls-tree', other, '--', file]).trim().split(/\s+/u);
            if (target[0] !== newMode || target[2] !== after) return false;
            let mode = oldMode, oid = before;
            for (let step = 0; step < approved.length; step++) {
              const next = approved.find(entry => entry.path === file && entry.oldMode === mode && entry.before === oid && ancestry(other).has(entry.commit));
              if (!next) return false;
              mode = next.newMode; oid = next.after;
              if (mode === newMode && oid === after) return true;
            }
            return false;
          });
          assert.ok(propagated, 'Unapproved committed evidence transition');
        }
      }
    }
    assert.equal(accepted.size, approved.length);
    const parse = (entry: string): [string, string[]] => {
      const tab = entry.indexOf('\t'); assert.ok(tab > 0);
      return [entry.slice(tab + 1), entry.slice(0, tab).split(' ')];
    };
    const indexed = new Map(records(git(['ls-files', '--stage', '-z', '--', 'evidence/'])).map(entry => {
      const [file, values] = parse(entry); assert.equal(values[2], '0'); return [file, values];
    }));
    const committed = records(git(['ls-tree', '-r', '-z', '--full-tree', 'HEAD', '--', 'evidence/']));
    assert.ok(committed.length > 0);
    const directories = new Set<string>();
    for (const entry of committed) {
      const [file, [mode, type, oid]] = parse(entry);
      assert.equal(type, 'blob'); assert.ok(mode === '100644' || mode === '100755');
      assert.ok(typeof oid === 'string'); assert.match(oid, /^[a-f0-9]{40}$/u);
      const index = indexed.get(file); assert.ok(index); assert.equal(index[0], mode); assert.equal(index[1], oid);
      assert.ok(file.startsWith('evidence/') && !file.includes('\\') && !path.isAbsolute(file));
      let current = root;
      const components = file.split('/');
      for (const part of components.slice(0, -1)) {
        assert.ok(part && part !== '.' && part !== '..'); current = path.join(current, part);
        if (!directories.has(current)) {
          const stat = lstatSync(current); assert.ok(stat.isDirectory() && !stat.isSymbolicLink()); directories.add(current);
        }
      }
      const target = path.join(root, file), stat = lstatSync(target);
      assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 64 * 1024 * 1024);
      if (process.platform !== 'win32') assert.equal(stat.mode & 0o111 ? '100755' : '100644', mode);
      const bytes = readFileSync(target);
      if (blobHash(bytes) !== oid) {
        assert.ok(textEvidence.test(file) && !bytes.includes(0));
        const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
        assert.equal(blobHash(Buffer.from(text.replaceAll('\r\n', '\n'))), oid);
      }
    }
  } catch {
    throw Object.assign(new Error('CURRENT_EVIDENCE_HISTORY_INVALID'), { code: 'CURRENT_EVIDENCE_HISTORY_INVALID', stage: 'HISTORY' });
  }
}
