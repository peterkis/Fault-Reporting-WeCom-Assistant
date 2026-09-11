import { readFileSync, mkdirSync, mkdtempSync, realpathSync, rmdirSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { minimalG2Environment, failG2 } from './p2-g2-validation-config.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export const G2_FROZEN_MERGE = '8c332710dad9b6cf3f6796f3344c04d1c710ddf3';
export const isG2SuccessorState = state => ['P2_G2_ASSEMBLY_AUTHORIZED', 'P2_G2_READY_FOR_LIVE_E2E'].includes(state?.implementation_authorization_status);
export function g2PredecessorScopeValid(v) {
  const ready = v?.implementation_authorization_status === 'P2_G2_READY_FOR_LIVE_E2E';
  return isG2SuccessorState(v) && v.active_task === 'P2-G2' && v.active_lane === 'ASSEMBLY'
    && v.p2_g2_status === (ready ? 'READY_FOR_LIVE_E2E' : 'IN_PROGRESS')
    && v.last_completed_task === 'P2-012' && v.last_completed_gate === 'P2-G1'
    && v.last_completed_architecture_task === 'ARCH-006' && v.p2_012_status === 'DONE' && v.p2_016_status === 'DONE'
    && v.p2_008_status === 'TODO_BLOCKED_BY_P2_G2'
    && (v.next_task_candidate ?? v.next_task) === (ready ? 'P2-G2-LIVE' : 'P2-G2') && v.next_task_authorized === !ready
    && JSON.stringify(v.authorized_gates) === JSON.stringify(['P2-G1', 'P2-G2']);
}
const git = (args, cwd = root) => execFileSync('git', ['-c', 'safe.directory=' + root.replaceAll('\\', '/'),
  '-c', 'safe.directory=' + cwd.replaceAll('\\', '/'), ...args], { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 8000000 });

// Run each predecessor's unchanged validator in its exact completed checkout. This validates history only;
// it cannot certify the current G2 Runtime or turn a historical live result into G2 readiness.
export function verifyG2Predecessor(task, includeReadinessEvidence) {
  if (!['P2-012', 'P2-016'].includes(task) || typeof includeReadinessEvidence !== 'boolean') failG2('PREDECESSOR_ARGUMENTS_INVALID');
  const errors = [];
  for (const p of ['MANIFEST.json', 'plans/current_phase.json', 'plans/master_backlog.json', 'plans/parallel_workstreams.json', 'tasks/master_backlog.json', 'project_summary.json']) {
    const raw = JSON.parse(readFileSync(path.join(root, p), 'utf8')), v = p === 'project_summary.json' ? raw.project : raw;
    if (!g2PredecessorScopeValid(v)) errors.push('P2_G2_SUCCESSOR_SCOPE_INVALID:' + p);
  }
  if (git(['merge-base', G2_FROZEN_MERGE, 'HEAD']).trim() !== G2_FROZEN_MERGE) errors.push('P2_G2_FROZEN_ANCESTRY_INVALID');
  if (git(['diff', '--name-only', '--diff-filter=MDR', G2_FROZEN_MERGE, '--', 'evidence']).trim()) errors.push('P2_G2_HISTORICAL_EVIDENCE_CHANGED');
  if (!readFileSync(path.join(root, 'evidence/p2-g2-start-authorization.md'), 'utf8').includes(G2_FROZEN_MERGE)) errors.push('P2_G2_INDEPENDENT_AUTHORIZATION_MISSING');
  if (errors.length) return { task, state: 'DONE', ok: false, errors, historical_only: true, verification_revision: G2_FROZEN_MERGE };
  const temporaryRoot = path.join(root, 'tmp'); mkdirSync(temporaryRoot, { recursive: true });
  const directory = mkdtempSync(path.join(temporaryRoot, 'p2-g2-frozen-'));
  let added = false;
  try {
    git(['-c', 'core.autocrlf=false', 'worktree', 'add', '--quiet', '--detach', directory, G2_FROZEN_MERGE]); added = true;
    const script = task === 'P2-012' ? 'validate-p2-012-human-confirmed-incident.mjs' : 'validate-p2-016-ticket-lifecycle-workbench.mjs';
    const exportName = task === 'P2-012' ? 'validateP2012' : 'validateP2016';
    const code = `import {${exportName}} from './scripts/${script}';const r=await ${exportName}({includeReadinessEvidence:${includeReadinessEvidence}});console.log(JSON.stringify(r));if(!r.ok)process.exitCode=1;`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      cwd: directory, env: minimalG2Environment(), encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 8000000,
    });
    let result; try { result = JSON.parse(child.stdout.trim()); } catch { failG2('PREDECESSOR_OUTPUT_INVALID'); }
    return { ...result, ok: child.status === 0 && result.ok === true, historical_only: true,
      verification_revision: G2_FROZEN_MERGE, successor_task: 'P2-G2', current_runtime_verified: false,
      successor_scope_checked: true, frozen_checkout_cleanup_passed: true };
  } finally {
    const resolved = realpathSync(directory);
    if (path.dirname(resolved) !== realpathSync(temporaryRoot) || !path.basename(resolved).startsWith('p2-g2-frozen-')) failG2('FROZEN_CHECKOUT_CLEANUP_BOUNDARY');
    if (added) {
      if (git(['status', '--porcelain'], directory).trim()) failG2('FROZEN_CHECKOUT_UNEXPECTED_MUTATION');
      git(['worktree', 'remove', directory]);
    } else rmdirSync(directory);
  }
}
