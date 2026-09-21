import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyPublishedHistory, HistoryError } from './verify-published-history.mjs';

const cli = fileURLToPath(new URL('./verify-published-history.mjs', import.meta.url));
const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  GIT_AUTHOR_NAME: 'Synthetic History Test', GIT_COMMITTER_NAME: 'Synthetic History Test',
  GIT_AUTHOR_EMAIL: 'history-test@example.invalid', GIT_COMMITTER_EMAIL: 'history-test@example.invalid',
  GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' };
for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) delete env[key];

function fixture(t, revision = 'r5') {
  const owner = mkdtempSync(path.join(tmpdir(), 'ss009-history-test-'));
  t.after(() => rmSync(owner, { recursive: true, force: true }));
  const root = path.join(owner, 'repo');
  mkdirSync(root);
  const git = (...args) => execFileSync('git', args, { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q');
  git('config', 'commit.gpgsign', 'false');
  const write = (name, text) => { const file = path.join(root, name); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); };
  const commit = message => { git('add', '.'); git('commit', '-qm', message); return git('rev-parse', 'HEAD'); };
  write('source.txt', 'baseline\n');
  const base = commit('synthetic base');
  write('source.txt', 'tested candidate\n');
  const tested = commit('synthetic tested source');
  const testedTree = git('rev-parse', `${tested}^{tree}`);
  const reportPath = `evidence/yxx-ss-009-${revision}-report.json`;
  write(reportPath, JSON.stringify({ tested_head: tested, tested_tree: testedTree }));
  write('plans/yxx-self-service-ticket-plan.json', JSON.stringify({ tickets: [{ id: 'YXX-SS-009', evidence: reportPath }] }));
  const head = commit('synthetic evidence publication');
  return { owner, root, git, write, commit, base, tested, testedTree, reportPath, head,
    run: (options = {}) => verifyPublishedHistory({ root, expectedHead: head, ...options }),
    sibling: () => git('commit-tree', git('rev-parse', `${head}^{tree}`), '-p', base, '-m', 'synthetic same-tree reparented snapshot'),
  };
}
function blocked(fn, code, exitCode = 2) {
  assert.throws(fn, e => e instanceof HistoryError && e.code === code && e.exitCode === exitCode);
}

test('published evidence child preserves tested ancestry; result never claims readiness', t => {
  const f = fixture(t), r = f.run();
  assert.equal(r.status, 'REVIEW_HISTORY_PREFLIGHT_PASS_NOT_READINESS');
  assert.equal(r.checkout_role, 'PUBLISHED_PR_HEAD');
  assert.equal(r.strict_readiness, 'NOT_RUN');
  assert.equal(r.merge_base, f.tested);
  assert.deepEqual(r.checkout_parents, [f.tested]);
});

test('additional documentation commits need no report rebind', t => {
  const f = fixture(t);
  f.write('AGENTS.md', 'Review environment policy.\n');
  const newHead = f.commit('synthetic docs-only fix');
  const r = f.run({ expectedHead: newHead });
  assert.equal(r.tested_head, f.tested);
  assert.equal(r.checkout_head, newHead);
});

test('same-tree reparented review snapshot is an identity error, not a published-history finding', t => {
  const f = fixture(t), snapshot = f.sibling();
  f.git('checkout', '-q', '--detach', snapshot);
  assert.equal(f.git('rev-parse', 'HEAD^{tree}'), f.git('rev-parse', `${f.head}^{tree}`));
  assert.equal(f.git('merge-base', f.tested, snapshot), f.base);
  blocked(() => f.run(), 'REVIEW_CHECKOUT_IDENTITY_MISMATCH');
});

test('genuinely published squash still fails; no same-tree exception is allowed', t => {
  const f = fixture(t), snapshot = f.sibling();
  f.git('checkout', '-q', '--detach', snapshot);
  blocked(() => f.run({ expectedHead: snapshot }), 'PUBLISHED_EVIDENCE_ANCESTRY_MISMATCH', 1);
});

test('explicit exact merge preview requires the ordered base/head parents', t => {
  const f = fixture(t);
  const merge = f.git('commit-tree', f.git('rev-parse', `${f.head}^{tree}`), '-p', f.base, '-p', f.head, '-m', 'synthetic two-parent preview');
  f.git('checkout', '-q', '--detach', merge);
  const r = f.run({ expectedMerge: merge, expectedBase: f.base });
  assert.equal(r.checkout_role, 'PUBLISHED_MERGE_PREVIEW');
  assert.deepEqual(r.checkout_parents, [f.base, f.head]);
  assert.equal(r.merge_base, f.tested);
});

test('an unannounced merge is not silently substituted for the requested head', t => {
  const f = fixture(t);
  const merge = f.git('commit-tree', f.git('rev-parse', `${f.head}^{tree}`), '-p', f.base, '-p', f.head, '-m', 'synthetic preview');
  f.git('checkout', '-q', '--detach', merge);
  blocked(() => f.run(), 'REVIEW_CHECKOUT_IDENTITY_MISMATCH');
});

test('a single-parent snapshot cannot masquerade as the advertised merge preview', t => {
  const f = fixture(t), snapshot = f.sibling();
  f.git('checkout', '-q', '--detach', snapshot);
  blocked(() => f.run({ expectedMerge: snapshot, expectedBase: f.base }), 'REVIEW_MERGE_PARENTS_MISMATCH');
});

test('reversed merge parents are rejected', t => {
  const f = fixture(t);
  const merge = f.git('commit-tree', f.git('rev-parse', `${f.head}^{tree}`), '-p', f.head, '-p', f.base, '-m', 'synthetic reversed preview');
  f.git('checkout', '-q', '--detach', merge);
  blocked(() => f.run({ expectedMerge: merge, expectedBase: f.base }), 'REVIEW_MERGE_PARENTS_MISMATCH');
});

test('a real shallow clone is an incomplete review environment', t => {
  const f = fixture(t), shallow = path.join(f.owner, 'shallow');
  execFileSync('git', ['clone', '-q', '--depth=1', pathToFileURL(f.root).href, shallow], { env, stdio: 'pipe' });
  blocked(() => verifyPublishedHistory({ root: shallow, expectedHead: f.head }), 'REVIEW_HISTORY_INCOMPLETE');
});

test('replace refs cannot override the tested graph', t => {
  const f = fixture(t), snapshot = f.sibling();
  f.git('replace', f.head, snapshot);
  blocked(() => f.run(), 'REVIEW_HISTORY_OVERLAY_PRESENT');
});

test('legacy grafts cannot override the tested graph', t => {
  const f = fixture(t);
  f.write('.git/info/grafts', `${f.head} ${f.base}\n`);
  blocked(() => f.run(), 'REVIEW_HISTORY_OVERLAY_PRESENT');
});

test('tracked candidate edits block exact-commit verification', t => {
  const f = fixture(t);
  f.write('source.txt', 'uncommitted edit\n');
  blocked(() => f.run(), 'REVIEW_WORKTREE_DIRTY');
});

test('untracked files block exact-commit verification', t => {
  const f = fixture(t);
  f.write('untracked.txt', 'uncommitted evidence\n');
  blocked(() => f.run(), 'REVIEW_WORKTREE_DIRTY');
});

test('wrong tested_tree is a real evidence failure on the verified head', t => {
  const f = fixture(t);
  f.write(f.reportPath, JSON.stringify({ tested_head: f.tested, tested_tree: f.git('rev-parse', `${f.base}^{tree}`) }));
  const head = f.commit('synthetic invalid tree evidence');
  blocked(() => f.run({ expectedHead: head }), 'PUBLISHED_TESTED_TREE_MISMATCH', 1);
});

test('an unavailable tested object never yields PASS', t => {
  const f = fixture(t);
  f.write(f.reportPath, JSON.stringify({ tested_head: 'a'.repeat(40), tested_tree: f.testedTree }));
  const head = f.commit('synthetic absent object reference');
  blocked(() => f.run({ expectedHead: head }), 'GIT_OBJECT_OR_HISTORY_UNAVAILABLE');
});

test('expected SHA is mandatory; branch names and abbreviated hashes are forbidden', t => {
  const f = fixture(t);
  for (const value of [undefined, 'HEAD', f.head.slice(0, 7), '--all', 'z'.repeat(40)]) {
    blocked(() => f.run({ expectedHead: value }), 'AUTHORITATIVE_SHA_REQUIRED');
  }
});

test('current report is discovered from the plan, not hard-coded to r5', t => {
  const f = fixture(t, 'r6');
  assert.equal(f.run().report_path, f.reportPath);
});

test('duplicate or unsafe report pointers are rejected', t => {
  const f = fixture(t);
  f.write('plans/yxx-self-service-ticket-plan.json', JSON.stringify({ tickets: [{ id: 'YXX-SS-009', evidence: '../outside.json' }] }));
  const head = f.commit('synthetic unsafe pointer');
  blocked(() => f.run({ expectedHead: head }), 'CURRENT_REPORT_REFERENCE_INVALID', 1);
});

test('preflight is read-only and does not modify the report or index', t => {
  const f = fixture(t);
  const before = readFileSync(path.join(f.root, f.reportPath));
  const index = readFileSync(path.join(f.root, '.git/index'));
  f.run();
  assert.deepEqual(readFileSync(path.join(f.root, f.reportPath)), before);
  assert.deepEqual(readFileSync(path.join(f.root, '.git/index')), index);
  assert.equal(f.git('rev-parse', 'HEAD'), f.head);
  assert.equal(f.git('status', '--porcelain'), '');
});

test('CLI succeeds only for the explicit head and emits NOT_RUN readiness', t => {
  const f = fixture(t);
  const r = spawnSync(process.execPath, [cli, '--expected-head', f.head], { cwd: f.root, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(r.stdout).strict_readiness, 'NOT_RUN');
});

test('CLI blocks omitted or duplicate arguments with nonzero exit', t => {
  const f = fixture(t);
  for (const args of [[], ['--expected-head', f.head, '--expected-head', f.head], ['--unknown', f.head]]) {
    const r = spawnSync(process.execPath, [cli, ...args], { cwd: f.root, env, encoding: 'utf8' });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.equal(JSON.parse(r.stdout).strict_readiness, 'NOT_RUN');
  }
});

test('inherited GIT_DIR cannot redirect the CLI to a different repository', t => {
  const f = fixture(t);
  const r = spawnSync(process.execPath, [cli, '--expected-head', f.head], {
    cwd: f.root, env: { ...env, GIT_DIR: path.join(f.owner, 'nonexistent.git') }, encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(r.stdout).checkout_head, f.head);
});
