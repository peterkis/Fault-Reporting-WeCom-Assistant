"""Refresh the selected Stitch screenshot exports at their declared native width."""
import hashlib
import json
import re
import urllib.request
from pathlib import Path

root = Path(__file__).resolve().parent
source = json.loads((root / 'source.json').read_text(encoding='utf-8'))
manifest = []
assets = set()
for screen in source['screens']:
    sid = screen['name'].split('/')[-1]
    url = screen['screenshot']['downloadUrl'] + '=w' + screen['width']
    urllib.request.urlretrieve(url, root / (sid + '.png'))
    for suffix in ('.html', '.png'):
        path = root / (sid + suffix)
        manifest.append({'file': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'bytes': path.stat().st_size})
    text = (root / (sid + '.html')).read_text(encoding='utf-8')
    assets.update(re.findall(r'https://[^\"<> ]+', text))
(root / 'sha256.json').write_text(json.dumps({'project_id': source['project_id'], 'files': manifest}, indent=2) + '\n', encoding='utf-8')
print('\n'.join(sorted(u for u in assets if 'googleapis' not in u and 'tailwindcss' not in u)))
