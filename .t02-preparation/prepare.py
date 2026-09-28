"""Create verified Git objects only; never publish refs or execute candidate code."""
import base64
import hashlib
import json
import lzma
import os
from pathlib import Path
import subprocess
import urllib.request

REPO = 'peterkis/Fault-Reporting-WeCom-Assistant'
BASE = '84d39b964d02db335c6c0c900d56d5b0a383f621'
BASE_TREE = '532bdb12e45917ea7870270e5c283e916150aa4b'
TREE = '6c60e30b9a7b0c995a2709b6f76fca7a8bc9d0d4'
PATCH_SHA = '9c4209e37027a1658dc348c109c85b7505d8c4c4a34d43a6e71523158ec58463'
root = Path(os.environ['GITHUB_WORKSPACE']) / 'subject'
out = Path(os.environ['RUNNER_TEMP']) / 't02-prepared'
out.mkdir()

def git(*args):
    return subprocess.check_output(['git', *args], cwd=root)

def api(endpoint, payload=None):
    # Deliberately supports only GET main and POST object endpoints, never refs.
    if endpoint not in ('git/ref/heads/main', 'git/trees', 'git/commits'):
        raise RuntimeError('UNAPPROVED_ENDPOINT')
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode()
    request = urllib.request.Request('https://api.github.com/repos/' + REPO + '/' + endpoint, data=data,
        headers={'Authorization': 'Bearer ' + os.environ['GH_TOKEN'],
                 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
                 'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=90) as response:
        return json.load(response)

assert api('git/ref/heads/main')['object']['sha'] == BASE, 'MAIN_MOVED'
assert git('rev-parse', 'HEAD').decode().strip() == BASE
assert git('rev-parse', 'HEAD^{tree}').decode().strip() == BASE_TREE
assert git('rev-parse', '--is-shallow-repository').decode().strip() == 'false'
assert git('status', '--porcelain') == b'', 'DIRTY_SUBJECT'
parts = Path(__file__).resolve().parent
encoded = ''.join((parts / ('part%02d.txt' % i)).read_text().strip() for i in range(4))
patch = lzma.decompress(base64.b64decode(encoded, validate=True))
assert hashlib.sha256(patch).hexdigest() == PATCH_SHA, 'PATCH_DIGEST_MISMATCH'
patch_path = out / 't02.patch'
patch_path.write_bytes(patch)
subprocess.run(['git', 'apply', '--index', '--check', str(patch_path)], cwd=root, check=True)
subprocess.run(['git', 'apply', '--index', str(patch_path)], cwd=root, check=True)
assert git('write-tree').decode().strip() == TREE, 'TARGET_TREE_MISMATCH'
paths = git('diff', '--cached', '--name-only', '-z', BASE).decode().strip('\0').split('\0')
assert len(paths) == 40 and len(set(paths)) == 40
assert not any(p.startswith(('evidence/', 'database/', '.t02-preparation/')) for p in paths)
entries = []
for name in paths:
    item = root / name
    assert not item.is_symlink() and item.is_file()
    assert git('ls-files', '-s', '--', name).decode().startswith('100644 ')
    entries.append({'path': name, 'type': 'blob', 'mode': '100644', 'content': item.read_bytes().decode('utf-8')})
# All contents and paths were bound by the independently computed exact Git tree.
created_tree = api('git/trees', {'base_tree': BASE_TREE, 'tree': entries})
assert created_tree['sha'] == TREE, 'REMOTE_TREE_MISMATCH'
commit = api('git/commits', {'tree': TREE, 'parents': [BASE],
    'message': 'feat(types): T02 explicit test hosts and compiled runtime verification\n\nSeparate source, staged and frozen checks; preserve test file selections and Node arguments.\nConnect all thirteen local contracts to strict TypeScript, normalize runtime resources\nand validate current candidate coverage without altering frozen evidence or live gates.\nOriginal-byte legacy copying and existing runtime guards remain in place.\nNo production activation, deployment, T03 migration or automatic merge.'})
assert commit['tree']['sha'] == TREE and [p['sha'] for p in commit['parents']] == [BASE]
record = {'scope': 'GIT_OBJECT_PREPARATION_ONLY', 'base': BASE, 'tree': TREE,
          'commit': commit['sha'], 'patch_sha256': PATCH_SHA, 'changed_files': paths,
          'refs_updated': False, 'candidate_code_executed': False}
(out / 'prepared.json').write_text(json.dumps(record, indent=2) + '\n')
print(json.dumps(record, indent=2))
