import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {readFileSync,rmSync,writeFileSync} from 'node:fs';
import {withScopeCheckout} from './helpers/yxx-current-scope-checkout.mjs';
import {checkSS010} from '../src/yxx-self-service-readiness.mjs';
import {verifyCurrentYxxEvidenceHistory} from '../src/yxx-current-evidence-history.mjs';
test('current readiness rejects a later working-tree rewrite of the adjudicated G0 path', () => {
  withScopeCheckout(root => {
    assert.equal(checkSS010({ root }).status, 'STRUCTURE_VALID_NOT_READY');
    const file = path.join(root, 'evidence/g0-005-active-push-matrix.md');
    writeFileSync(file, readFileSync(file, 'utf8') + '\nUNAPPROVED_LATER_CHANGE\n');
    assert.throws(() => checkSS010({ root }), { code: 'CURRENT_EVIDENCE_HISTORY_INVALID' });
  });
});

test('current readiness rejects committed evidence rewrite followed by restoration', () => {
  withScopeCheckout(root => {
    const git = (args: string[]): void => { execFileSync('git', args, { cwd: root, windowsHide: true, stdio: 'pipe' }); };
    const relative = 'evidence/g0-005-active-push-matrix.md', file = path.join(root, relative), original = readFileSync(file);
    const commit = (): void => {
      git(['add', '--', relative]);
      git(['-c', 'user.name=Readiness Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'synthetic evidence change']);
    };
    writeFileSync(file, Buffer.concat([original, Buffer.from('\nUNAPPROVED_COMMITTED_CHANGE\n')])); commit();
    writeFileSync(file, original); commit();
    assert.throws(() => checkSS010({ root }), { code: 'CURRENT_EVIDENCE_HISTORY_INVALID' });
  });
});

test('current evidence history checks a rewritten side branch even when an ours merge hides its contents', () => {
  withScopeCheckout(root => {
    const git = (args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, stdio: 'pipe' }).trim();
    const base = git(['rev-parse', 'HEAD']);
    const identity = ['-c', 'user.name=Readiness Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false'];
    const relative = 'evidence/g0-005-active-push-matrix.md';
    writeFileSync(path.join(root, relative), readFileSync(path.join(root, relative), 'utf8') + '\nHIDDEN_SIDE_REWRITE\n');
    git(['add', '--', relative]); git([...identity, 'commit', '-m', 'synthetic side rewrite']);
    const side = git(['rev-parse', 'HEAD']);
    git(['checkout', '--detach', base]);
    git([...identity, 'commit', '--allow-empty', '-m', 'synthetic main side']);
    git([...identity, 'merge', '--no-ff', '-s', 'ours', side, '-m', 'synthetic hidden side merge']);
    assert.throws(() => verifyCurrentYxxEvidenceHistory(root), { code: 'CURRENT_EVIDENCE_HISTORY_INVALID' });
  });
});

test('current evidence history accepts a new immutable receipt and rejects its deletion or indexed mode change', () => {
  withScopeCheckout(root => {
    const git = (args: string[]): void => { execFileSync('git', args, { cwd: root, windowsHide: true, stdio: 'pipe' }); };
    const relative = 'evidence/yxx-current-synthetic-receipt.json', file = path.join(root, relative);
    writeFileSync(file, '{"fixture":true}\n'); git(['add', '--', relative]);
    git(['-c', 'user.name=Readiness Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'synthetic new receipt']);
    verifyCurrentYxxEvidenceHistory(root);
    git(['update-index', '--chmod=+x', relative]);
    assert.throws(() => verifyCurrentYxxEvidenceHistory(root), { code: 'CURRENT_EVIDENCE_HISTORY_INVALID' });
    git(['update-index', '--chmod=-x', relative]); rmSync(file);
    assert.throws(() => verifyCurrentYxxEvidenceHistory(root), { code: 'CURRENT_EVIDENCE_HISTORY_INVALID' });
  });
});

test('current evidence history rejects expanding the precise adjudication record', () => {
  withScopeCheckout(root => {
    const file = path.join(root, '.github/review/yxx-current-evidence-adjudication.json');
    writeFileSync(file, readFileSync(file, 'utf8').replace('"does_not_authorize_future_changes": true', '"does_not_authorize_future_changes": false'));
    assert.throws(() => verifyCurrentYxxEvidenceHistory(root), { code: 'CURRENT_EVIDENCE_HISTORY_INVALID' });
  });
});
