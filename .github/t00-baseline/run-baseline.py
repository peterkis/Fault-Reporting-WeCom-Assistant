#!/usr/bin/env python3
"""Validation-only branch runner. Never edits subject files, evidence, refs or PRs."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import signal
import subprocess
import sys
import time

subject = Path(sys.argv[1]).resolve()
logs = Path(sys.argv[2]).resolve()
tools = Path(__file__).resolve().parent
expected = os.environ['EXPECTED_HEAD']
base = json.loads((tools / 'plan-baseline.json').read_text())['authoritative_main_sha']
logs.mkdir(parents=True, exist_ok=True)
records = []


def run(name, args, cwd=subject, timeout=300):
    start = datetime.datetime.now(datetime.timezone.utc).isoformat()
    dest = logs / (name + '.txt')
    timed_out = False
    with dest.open('wb') as stream:
        proc = subprocess.Popen(args, cwd=cwd, stdout=stream, stderr=subprocess.STDOUT,
                                start_new_session=True)
        try:
            code = proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            os.killpg(proc.pid, signal.SIGKILL)
            code = proc.wait()
    raw = dest.read_bytes()
    text = re.sub(r'\x1b\[[0-9;]*m', '', raw.decode('utf-8', errors='replace'))
    counts = {}
    for key in ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']:
        matches = re.findall(r'^(?:#|\u2139)\s+' + key + r'\s+(\d+)\s*$', text, re.M)
        if matches:
            counts[key] = int(matches[-1])
    record = {'id': name, 'command': args, 'cwd': str(cwd), 'started_at': start,
              'finished_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'exit_code': code, 'timed_out': timed_out, 'log': dest.name,
              'sha256': hashlib.sha256(raw).hexdigest(), 'counts': counts}
    records.append(record)
    (logs / 'commands.json').write_text(json.dumps(records, indent=2) + '\n')
    print(json.dumps({'id': name, 'exit_code': code, 'counts': counts}), flush=True)
    return record


def passed(record):
    return record['exit_code'] == 0 and not record['timed_out']


def require(record):
    if not passed(record):
        raise RuntimeError('REQUIRED_CHECK_FAILED:' + record['id'])


def output(name):
    return (logs / (name + '.txt')).read_text().strip()


def git(*args):
    return subprocess.check_output(['git', '-C', str(subject), *args], text=True).strip()


def main():
    if not re.fullmatch(r'[0-9a-f]{40}', expected):
        raise RuntimeError('INVALID_EXTERNAL_HEAD')
    if git('rev-parse', 'HEAD') != expected:
        raise RuntimeError('SUBJECT_IDENTITY_MISMATCH')
    if (subject / '.env.pilot').exists() or (subject / '.env').exists():
        raise RuntimeError('REAL_ENV_FILE_FORBIDDEN')
    for filename, digest in {
        'verify_baseline.py': '7b8eef7e97f402fcb2552e8b84029317a92b6cc553480dcc92e2f1520920832a',
        'plan-baseline.json': 'ebc5a39a46bfddbd1a61dd6c0a33e8bb3b3f9bedeaca41ebfc08d9f880510150',
    }.items():
        if hashlib.sha256((tools / filename).read_bytes()).hexdigest() != digest:
            raise RuntimeError('ORIGINAL_PLAN_BYTES_CHANGED:' + filename)
    require(run('node-version', ['node', '--version']))
    if not output('node-version').startswith('v24.'):
        raise RuntimeError('NODE24_REQUIRED')
    require(run('npm-version', ['npm', '--version']))
    require(run('plan-descendant', ['python3', str(tools / 'verify_baseline.py'),
        '--repo', str(subject), '--baseline', str(tools / 'plan-baseline.json'),
        '--mode', 'descendant', '--expected-head', expected]))
    require(run('published-history', ['node', '.github/review/verify-published-history.mjs',
        '--expected-head', expected]))
    original = logs.parent / ('t00-original-' + os.environ['GITHUB_RUN_ID'])
    require(run('original-checkout', ['git', 'worktree', 'add', '--detach', str(original), base]))
    require(run('plan-exact', ['python3', str(tools / 'verify_baseline.py'),
        '--repo', str(original), '--baseline', str(tools / 'plan-baseline.json'),
        '--mode', 'exact', '--expected-head', base], cwd=original))
    require(run('install', ['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund']))
    require(run('base-install', ['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], cwd=original))
    pg_probe = """import pg from 'pg';
const u=new URL(process.env.PILOT_DATABASE_URL);
if(u.hostname!=='127.0.0.1'||u.port!=='5432'||u.pathname!=='/t00_ci')throw Error('ISOLATED_DATABASE_REQUIRED');
const p=new pg.Pool({connectionString:u.href,max:1});
try{const v=(await p.query('SHOW server_version_num')).rows[0].server_version_num;
if(Math.trunc(Number(v)/10000)!==18)throw Error('PG18_REQUIRED');
const db=(await p.query("SELECT count(*)::int n FROM pg_database WHERE datname NOT IN ('postgres','template0','template1','t00_ci')")).rows[0].n;
const backends=(await p.query("SELECT count(*)::int n FROM pg_stat_activity WHERE backend_type='client backend' AND pid<>pg_backend_pid()")).rows[0].n;
console.log(JSON.stringify({server_version_num:v,other_databases:db,other_client_backends:backends}));
if(db!==0||backends!==0)throw Error('DATABASE_RESIDUALS');}finally{await p.end();}"""
    require(run('pg-before', ['node', '--input-type=module', '-e', pg_probe]))
    manifest = json.loads((subject / 'plans/typescript-migration/baseline-tests.json').read_text())
    names = [r['id'] for r in manifest['commands']]
    if names != ['directory-unit', 'directory-pg', 'orchestration', 'p2016-schema', 'p2016-runtime']:
        raise RuntimeError('BASELINE_SELECTION_CHANGED')
    selected = [f for r in manifest['commands'] for f in r['selected_files']]
    if len(selected) != 17 or len(set(selected)) != 17 or not all((subject / f).is_file() for f in selected):
        raise RuntimeError('BASELINE_FILES_INVALID')
    test_records = [run(row['id'], shlex.split(row['command'])) for row in manifest['commands']]
    arch = run('architecture', ['node', 'scripts/validate-v1-4-architecture.mjs'])
    # Record the real unchanged CLI result, including a nonzero current readiness.
    strict = run('current-strict', ['node', 'scripts/validate-yxx-self-service.mjs', '--require-ready'])
    base_strict = run('base-strict', ['node', 'scripts/validate-yxx-self-service.mjs', '--require-ready'], cwd=original)
    diagnostic = """import {validateYxxSelfService} from './src/yxx-self-service-verification.mjs';
try{console.log(JSON.stringify(validateYxxSelfService({requireReady:true})));}
catch(e){console.log(JSON.stringify({ok:false,code:e.code??e.name,site:String(e.stack??'').split('\\n').find(l=>l.includes('yxx-self-service-verification.mjs'))?.trim()??null}));process.exitCode=1;}"""
    run('current-strict-diagnostic', ['node', '--input-type=module', '-e', diagnostic])
    run('base-strict-diagnostic', ['node', '--input-type=module', '-e', diagnostic], cwd=original)
    historical = run('p2016-historical', ['npm', 'run', 'validate:p2:016:historical'], timeout=600)
    pg_after = run('pg-after', ['node', '--input-type=module', '-e', pg_probe])
    integrity = run('final-tracked-integrity', ['git', 'diff', '--exit-code', 'HEAD', '--'])
    changed = git('diff', '--name-only', base, expected, '--').splitlines()
    allowed = ['AGENTS.md', 'docs/03_technology_stack.md', 'adr/0026_typescript_strict_incremental_migration.md']
    if any(f not in allowed and not f.startswith('plans/typescript-migration/') for f in changed):
        raise RuntimeError('T00_CHANGED_DISALLOWED_PATH')
    unchanged = ['src', 'scripts', 'tests', 'database', 'evidence', 'contracts', 'web', '.github', 'package.json', 'package-lock.json',
                 'plans/current_phase.json', 'plans/master_backlog.json', 'plans/parallel_workstreams.json']
    if git('diff', '--name-only', base, expected, '--', *unchanged):
        raise RuntimeError('PROTECTED_SCOPE_CHANGED')
    for f in ['scope.json', 'test-routing.json']:
        p = 'plans/typescript-migration/' + f
        if git('rev-parse', expected + ':' + p) != git('rev-parse', 'ae296330e742cffd810094d46c79c64acc6f05ce:' + p):
            raise RuntimeError('EXISTING_INVENTORY_REBUILT')
    tests_ok = all(passed(r) and set(r['counts']) == {'tests','pass','fail','cancelled','skipped','todo'}
        and r['counts']['tests'] > 0 and r['counts']['pass'] == r['counts']['tests']
        and all(r['counts'][key] == 0 for key in ['fail','skipped','cancelled','todo']) for r in test_records)
    strict_known = (strict['exit_code'] == base_strict['exit_code'] == 1
        and output('current-strict') == output('base-strict') == '{"ok":false,"error_code":"YXX_VERIFICATION_REJECTED"}'
        and not strict['timed_out'] and not base_strict['timed_out'])
    strict_ok = passed(strict) or strict_known
    ok = tests_ok and all(passed(r) for r in [arch,historical,pg_after,integrity]) and strict_ok
    result = {'schema_version':1, 'status':'POLICY_BASELINE_RECORDED' if ok else 'BASELINE_INCOMPLETE',
        'subject_head':expected, 'subject_tree':git('rev-parse','HEAD^{tree}'), 'original_main':base,
        'workflow_commit':os.environ['GITHUB_SHA'], 'run_id':os.environ['GITHUB_RUN_ID'],
        'node_version':output('node-version'), 'pg':json.loads(output('pg-after')),
        'selected_files':selected, 'selected_file_count':17,
        'tests':sum(r['counts'].get('tests',0) for r in test_records), 'commands':records,
        'current_strict_status':'PASS' if passed(strict) else 'KNOWN_BASELINE_NOT_READY' if strict_known else 'UNCLASSIFIED_FAILURE',
        'current_strict_exit':strict['exit_code'], 'base_strict_exit':base_strict['exit_code'],
        'no_runtime_or_frozen_changes':True, 'inventory_unchanged':True,
        'types':'NOT_APPLICABLE_T00','build':'NOT_APPLICABLE_T00','production_ready':False,
        'self_review':'NOT_PERFORMED_BY_RUNNER','external_review':'NOT_PERFORMED_BY_RUNNER','merge_approval':False}
    (logs / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
    require(run('original-worktree-removal', ['git','worktree','remove',str(original)]))
    print(json.dumps({k:v for k,v in result.items() if k not in ['commands','selected_files']}), flush=True)
    return 0 if ok else 1


try:
    sys.exit(main())
except Exception as exc:
    (logs / 'runner-error.json').write_text(json.dumps({'status':'BASELINE_INCOMPLETE','error':str(exc)}) + '\n')
    raise
