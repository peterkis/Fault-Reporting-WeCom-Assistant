// Review-environment preflight only. This is NOT a replacement for --require-ready.
// Authoritative SHAs must come from the PR event/API, never from local HEAD.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA = /^[0-9a-f]{40}$/u;
const PLAN = 'plans/yxx-self-service-ticket-plan.json';
export class HistoryError extends Error {
  constructor(code, detail, exitCode = 2) {
    super(detail);
    this.code = code;
    this.exitCode = exitCode;
  }
}
const reject = (code, detail, exitCode) => { throw new HistoryError(code, detail, exitCode); };
const requireSha = (value, name) => {
  if (typeof value !== 'string' || !SHA.test(value)) {
    reject('AUTHORITATIVE_SHA_REQUIRED', `${name} must be a full SHA from the PR event/API, not local HEAD.`);
  }
};

// Do not let inherited GIT_DIR, replace refs, a global config or lazy fetch
// silently substitute another graph. The preflight is entirely offline/read-only.
function gitEnvironment() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  return { ...env, GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1',
    GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
}

export function verifyPublishedHistory({ root = process.cwd(), expectedHead, expectedMerge, expectedBase } = {}) {
  requireSha(expectedHead, 'expectedHead');
  if (expectedMerge !== undefined || expectedBase !== undefined) {
    requireSha(expectedMerge, 'expectedMerge');
    requireSha(expectedBase, 'expectedBase');
  }
  const env = gitEnvironment();
  const command = args => {
    const r = spawnSync('git', ['--no-replace-objects', ...args], {
      cwd: root, env, windowsHide: true, timeout: 30_000, maxBuffer: 8 * 1024 * 1024,
    });
    if (r.error || r.signal) reject('GIT_EXECUTION_UNAVAILABLE', 'Git failed or timed out; no history conclusion is available.');
    return r;
  };
  const raw = args => {
    const r = command(args);
    if (r.status !== 0) reject('GIT_OBJECT_OR_HISTORY_UNAVAILABLE', `Git ${args[0]} failed; fetch the exact published full history before retrying.`);
    return r.stdout;
  };
  const git = args => raw(args).toString('utf8').trim();
  const commit = sha => {
    const bytes = raw(['cat-file', 'commit', sha]);
    const actual = createHash('sha1').update(`commit ${bytes.length}\0`).update(bytes).digest('hex');
    if (actual !== sha) reject('GIT_OBJECT_IDENTITY_MISMATCH', 'Raw commit bytes do not hash to the requested SHA.');
    const header = bytes.toString('utf8').split('\n\n', 1)[0].split('\n');
    const tree = header.find(line => /^tree [0-9a-f]{40}$/u.test(line))?.slice(5);
    requireSha(tree, 'commit tree');
    return { sha, tree, parents: header.filter(line => /^parent [0-9a-f]{40}$/u.test(line)).map(line => line.slice(7)) };
  };
  if (git(['rev-parse', '--is-shallow-repository']) !== 'false') {
    reject('REVIEW_HISTORY_INCOMPLETE', 'Shallow checkout: use a full-history checkout. Do not rebind the evidence.');
  }
  const grafts = path.resolve(root, git(['rev-parse', '--git-path', 'info/grafts']));
  if (git(['for-each-ref', '--format=%(refname)', 'refs/replace/']) !== ''
      || (existsSync(grafts) && readFileSync(grafts, 'utf8').trim() !== '')) {
    reject('REVIEW_HISTORY_OVERLAY_PRESENT', 'Replace refs or grafts are present; use a clean independent checkout.');
  }
  const checkout = git(['rev-parse', '--verify', 'HEAD^{commit}']);
  const current = commit(checkout);
  let role;
  if (checkout === expectedHead) role = 'PUBLISHED_PR_HEAD';
  else if (expectedMerge && checkout === expectedMerge) {
    if (current.parents.length !== 2 || current.parents[0] !== expectedBase || current.parents[1] !== expectedHead) {
      reject('REVIEW_MERGE_PARENTS_MISMATCH', 'The exact preview must have the API/event base and PR head as its two ordered parents.');
    }
    role = 'PUBLISHED_MERGE_PREVIEW';
  } else {
    reject('REVIEW_CHECKOUT_IDENTITY_MISMATCH',
      `Checkout ${checkout} is neither authoritative head ${expectedHead} nor the explicitly supplied merge preview. A same-tree snapshot is not the published commit.`);
  }
  if (git(['status', '--porcelain=v1', '--untracked-files=all']) !== '') {
    reject('REVIEW_WORKTREE_DIRTY', 'Tracked or untracked changes exist. Use a clean checkout and put logs outside the repository.');
  }
  const readJson = file => {
    const bytes = raw(['show', `${checkout}:${file}`]);
    try { return JSON.parse(bytes.toString('utf8')); }
    catch { reject('COMMITTED_EVIDENCE_INVALID', `Committed ${file} is not valid JSON.`, 1); }
  };
  const plan = readJson(PLAN);
  const tickets = Array.isArray(plan?.tickets) ? plan.tickets.filter(t => t?.id === 'YXX-SS-009') : [];
  if (!Array.isArray(tickets) || tickets.length !== 1
      || !/^evidence\/yxx-ss-009(?:-r\d+)?-report\.json$/u.test(tickets[0].evidence ?? '')) {
    reject('CURRENT_REPORT_REFERENCE_INVALID', 'The committed plan must identify exactly one SS-009 report.', 1);
  }
  const reportPath = tickets[0].evidence;
  const report = readJson(reportPath);
  requireSha(report.tested_head, 'report.tested_head');
  requireSha(report.tested_tree, 'report.tested_tree');
  const tested = commit(report.tested_head);
  if (tested.tree !== report.tested_tree) {
    reject('PUBLISHED_TESTED_TREE_MISMATCH', 'The tested commit tree does not equal the committed report tested_tree.', 1);
  }
  const ancestry = command(['merge-base', '--is-ancestor', report.tested_head, checkout]);
  if (ancestry.status === 1) {
    reject('PUBLISHED_EVIDENCE_ANCESTRY_MISMATCH',
      'On the identity-verified published commit, tested_head is NOT an ancestor. Preserve the tested history or regenerate evidence; do not bypass the strict validator.', 1);
  }
  if (ancestry.status !== 0) reject('GIT_OBJECT_OR_HISTORY_UNAVAILABLE', 'Git could not determine ancestry; no product-defect conclusion is available.');
  return {
    schema_version: 1, status: 'REVIEW_HISTORY_PREFLIGHT_PASS_NOT_READINESS',
    checkout_role: role, expected_head: expectedHead, checkout_head: checkout,
    checkout_tree: current.tree, checkout_parents: current.parents,
    report_path: reportPath, tested_head: tested.sha, tested_tree: tested.tree,
    merge_base: git(['merge-base', tested.sha, checkout]),
    shallow: false, history_overlays: false, worktree_clean: true,
    strict_readiness: 'NOT_RUN',
    next_command: 'node scripts/validate-yxx-self-service.mjs --require-ready',
  };
}

export function main(argv = process.argv.slice(2)) {
  try {
    const options = {};
    const names = { '--expected-head': 'expectedHead', '--expected-merge': 'expectedMerge', '--expected-base': 'expectedBase' };
    for (let i = 0; i < argv.length; i += 2) {
      const key = names[argv[i]];
      if (!key || options[key] !== undefined || argv[i + 1] === undefined) {
        reject('INVALID_ARGUMENT', 'Usage: node .github/review/verify-published-history.mjs --expected-head <API_SHA> [--expected-merge <API_SHA> --expected-base <API_SHA>]');
      }
      options[key] = argv[i + 1];
    }
    console.log(JSON.stringify(verifyPublishedHistory(options), null, 2));
    return 0;
  } catch (e) {
    console.log(JSON.stringify({ status: 'REVIEW_HISTORY_PREFLIGHT_BLOCKED',
      code: e.code ?? 'PREFLIGHT_INTERNAL_ERROR', detail: e.message,
      strict_readiness: 'NOT_RUN' }, null, 2));
    return e instanceof HistoryError ? e.exitCode : 2;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main();
}
