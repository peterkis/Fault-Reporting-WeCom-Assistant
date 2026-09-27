#!/usr/bin/env python3
"""Read-only Git baseline check. This does not run or approve application tests."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import subprocess
import sys


def git(repo: Path, *args: str, allowed: tuple[int, ...] = (0,)) -> str:
    result = subprocess.run(['git', '-C', str(repo), *args], capture_output=True,
                            text=True, encoding='utf-8', errors='replace', timeout=30)
    if result.returncode not in allowed:
        raise ValueError('GIT_COMMAND_FAILED: ' + ' '.join(args[:2]))
    return result.stdout.strip()


def verify(repo: Path, baseline: dict, mode: str, expected_head: str | None) -> dict:
    repo = repo.resolve(strict=True)
    actual_root = Path(git(repo, 'rev-parse', '--show-toplevel')).resolve()
    if actual_root != repo:
        raise ValueError('REPO_MUST_BE_REAL_GIT_ROOT_NOT_BUILD_SUBDIRECTORY')
    head = git(repo, 'rev-parse', 'HEAD')
    tree = git(repo, 'rev-parse', 'HEAD^{tree}')
    if git(repo, 'rev-parse', '--is-shallow-repository') != 'false':
        raise ValueError('SHALLOW_HISTORY_NOT_ACCEPTED')
    if git(repo, 'for-each-ref', '--format=%(refname)', 'refs/replace'):
        raise ValueError('REPLACE_REFS_NOT_ACCEPTED')
    graft = Path(git(repo, 'rev-parse', '--git-path', 'info/grafts'))
    if not graft.is_absolute():
        graft = repo / graft
    if graft.exists() and graft.stat().st_size:
        raise ValueError('GRAFT_HISTORY_NOT_ACCEPTED')
    changed = git(repo, 'diff', '--name-only', 'HEAD', '--')
    if changed:
        raise ValueError('TRACKED_WORKTREE_OR_INDEX_IS_DIRTY')
    origin = baseline['authoritative_main_sha']
    if mode == 'exact':
        if head != origin or tree != baseline['authoritative_tree']:
            raise ValueError('INITIAL_BASELINE_MISMATCH_RECONCILE_BEFORE_EXECUTION')
        if expected_head is not None and expected_head != head:
            raise ValueError('AUTHORITATIVE_HEAD_MISMATCH')
    else:
        if not expected_head or expected_head != head:
            raise ValueError('DESCENDANT_MODE_REQUIRES_EXTERNALLY_VERIFIED_EXPECTED_HEAD')
        git(repo, 'merge-base', '--is-ancestor', origin, head)
    untracked = git(repo, 'ls-files', '--others', '--exclude-standard').splitlines()
    return {'status': 'PASS_OBJECT_AND_TRACKED_WORKTREE_ONLY', 'head': head, 'tree': tree,
            'mode': mode, 'untracked_files_require_review': untracked,
            'application_tests': 'NOT_RUN', 'production_approval': False,
            'note': 'No fetch/checkout/reset/write was performed; untracked files are not attested.'}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--repo', type=Path, required=True)
    ap.add_argument('--baseline', type=Path, required=True)
    ap.add_argument('--mode', choices=['exact', 'descendant'], default='exact')
    ap.add_argument('--expected-head')
    args = ap.parse_args()
    try:
        baseline = json.loads(args.baseline.read_text(encoding='utf-8'))
        result = verify(args.repo, baseline, args.mode, args.expected_head)
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as exc:
        print(json.dumps({'status': 'BLOCKED_BASELINE', 'error': str(exc),
                          'application_tests': 'NOT_RUN'}, ensure_ascii=False, indent=2))
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
