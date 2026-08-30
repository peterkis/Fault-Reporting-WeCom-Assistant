import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const script = resolve(root, 'scripts', 'p1-012-wecom-burst-ui.ps1');
const powershellProbe = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'], {
  encoding: 'utf8',
});
const hasPowerShell = powershellProbe.status === 0;

function runScript(arguments_) {
  return spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', script, ...arguments_], {
    cwd: root,
    encoding: 'utf8',
  });
}

function stdoutRecord(result) {
  const lines = result.stdout.trim().split(/\r?\n/u).filter(Boolean);
  assert.equal(lines.length, 1, result.stdout);
  return JSON.parse(lines[0]);
}

test('P1-012 WeCom burst UI plan is side-effect free and preserves the requested sequence range', {
  skip: !hasPowerShell,
}, () => {
  const result = runScript([
    '-TokenBase', 'P1012-BURST-DRYRUN',
    '-MentionSearchText', 'test-bot',
    '-StartIndex', '5',
    '-EndIndex', '100',
    '-StepDelayMs', '60',
    '-InterMessageDelayMs', '250',
    '-ArmDelaySeconds', '5',
    '-PlanOnly',
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(stdoutRecord(result), {
    test_id: 'P1-012',
    event: 'p1_012_wecom_ui_burst_plan',
    mode: 'PLAN_ONLY',
    start_index: 5,
    end_index: 100,
    count: 96,
    first_sequence: '005',
    last_sequence: '100',
    step_delay_ms: 60,
    mention_menu_delay_ms: 120,
    mention_selection_delay_ms: 600,
    mention_down_presses: 1,
    inter_message_delay_ms: 250,
    arm_delay_seconds: 5,
    native_mention_strategy: 'AT_SEARCH_SELECT_EACH_MESSAGE',
    composer_refocus_after_mention: true,
    external_side_effect: false,
    expected_reconciliation_event: 'p1_012_live_burst_result',
  });
});

test('P1-012 WeCom burst UI driver fails closed on invalid ranges and ambiguous modes', {
  skip: !hasPowerShell,
}, () => {
  const invalidRange = runScript([
    '-TokenBase', 'P1012-BURST-DRYRUN',
    '-MentionSearchText', 'test-bot',
    '-StartIndex', '11',
    '-EndIndex', '10',
    '-PlanOnly',
  ]);
  assert.equal(invalidRange.status, 1);
  assert.deepEqual(stdoutRecord(invalidRange), {
    test_id: 'P1-012',
    event: 'p1_012_wecom_ui_burst_stopped',
    outcome: 'UNKNOWN',
    error_code: 'P1_012_UI_RANGE_INVALID',
    completed_count: 0,
    current_sequence: null,
    current_phase: 'NOT_STARTED',
    composer_may_contain_unsent_text: false,
    reconciliation_required_before_resume: false,
  });

  const ambiguousMode = runScript([
    '-TokenBase', 'P1012-BURST-DRYRUN',
    '-MentionSearchText', 'test-bot',
    '-StartIndex', '1',
    '-EndIndex', '100',
  ]);
  assert.equal(ambiguousMode.status, 1);
  assert.equal(stdoutRecord(ambiguousMode).error_code, 'P1_012_UI_MODE_REQUIRED');
});

test('P1-012 WeCom burst UI driver retains fail-closed target, clipboard, stop, and reconciliation guards', async () => {
  const source = await readFile(script, 'utf8');

  assert.match(source, /Get-Process -Name 'WXWork'/u);
  assert.match(source, /MainWindowTitle -ceq '企业微信'/u);
  assert.match(source, /P1_012_UI_TARGET_NOT_UNIQUE/u);
  assert.match(source, /GetAsyncKeyState\(0x1B\)/u);
  assert.match(source, /SetForegroundWindow/u);
  assert.match(source, /Assert-P1012TargetForeground/u);
  assert.match(source, /\[System\.Windows\.Forms\.Clipboard\]::GetText\(\)/u);
  assert.match(source, /\[System\.Windows\.Forms\.SendKeys\]::SendWait/u);
  assert.match(source, /native_mention_strategy = 'AT_SEARCH_SELECT_EACH_MESSAGE'/u);
  assert.match(source, /native_mention_requires_callback_reconciliation = \$true/u);
  assert.match(source, /-Keys '@' -PhaseAfter 'MENTION_MENU_OPEN_REQUESTED'/u);
  assert.match(source, /-Keys '\{DOWN\}' -PhaseAfter 'MENTION_CANDIDATE_MOVED'/u);
  assert.match(source, /-Keys '\{ENTER\}' -PhaseAfter 'MENTION_SELECTED'/u);
  assert.match(source, /MENTION_SELECTED'[\s\S]*Wait-P1012Cancellable -Milliseconds \$MentionSelectionDelayMs[\s\S]*Set-P1012ComposerFocus -TargetWindow \$targetWindow[\s\S]*COMPOSER_REFOCUSED_AFTER_MENTION/u);
  assert.match(source, /composer_refocus_after_mention = \$true/u);
  assert.match(source, /P1_012_UI_COMPOSER_NOT_EMPTY/u);
  assert.match(source, /P1_012_UI_COMPOSER_FOCUS_INVALID/u);
  assert.match(source, /COMPOSER_PROBE_CLEARED/u);
  const partialComposerMatch = source.match(
    /\$partialComposer = \$script:CurrentPhase -in @\(([\s\S]*?)\r?\n\s*\)/u,
  );
  assert.ok(partialComposerMatch, 'partial composer fail-closed phase list must remain explicit');
  assert.match(partialComposerMatch[1], /'COMPOSER_REFOCUSED_AFTER_MENTION'/u);
  assert.match(source, /Restore-P1012Clipboard/u);
  assert.match(source, /callback_or_ticket_proven = \$false/u);
  assert.match(source, /expected_reconciliation_event = 'p1_012_live_burst_result'/u);
  assert.match(source, /reconciliation_required_before_resume/u);
  assert.doesNotMatch(source, /Invoke-Expression|Start-Process/u);
});
