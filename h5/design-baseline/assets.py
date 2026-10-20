"""Localize the fonts and raster assets referenced by the fixed Stitch exports."""
import hashlib
import json
import re
import urllib.request
import urllib.parse
from pathlib import Path

root = Path(__file__).resolve().parent
dest = root.parent / 'src' / 'assets'
dest.mkdir(parents=True, exist_ok=True)
headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36'}
manifest = []
def download(url, name):
    data = urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=60).read()
    (dest / name).write_bytes(data)
    manifest.append({'file': name, 'source': url, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)})
    return data

source_icons = set()
for file in root.glob('*.html'):
    source_icons.update(re.findall(r'class="material-symbols-outlined[^\"]*"[^>]*>\s*([a-z][a-z0-9_]+)\s*</span>', file.read_text(encoding='utf-8')))
icon_union = (root.parent / 'src' / 'components' / 'Icon.tsx').read_text(encoding='utf-8').split('export type IconName=')[1].split(';')[0]
source_icons.update(re.findall(r"'([a-z][a-z0-9_]+)'", icon_union))
icon_names = urllib.parse.quote(','.join(sorted(source_icons)))
for family, css_url in [('inter', 'https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap'), ('symbols', 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&icon_names=' + icon_names)]:
    css = urllib.request.urlopen(urllib.request.Request(css_url, headers=headers), timeout=60).read().decode()
    urls = list(dict.fromkeys(re.findall(r'url\((https:[^)]+)\)', css)))
    for i, url in enumerate(urls):
        name = family + '-' + str(i) + '.woff2'
        download(url, name)
        css = css.replace(url, './' + name)
    (dest / (family + '.css')).write_text(css, encoding='utf-8')

urls = sorted(set(u for f in root.glob('*.html') for u in re.findall(r'https://[^\"<> ]+', f.read_text(encoding='utf-8')) if '/aida-public/' in u))
for i, url in enumerate(urls):
    download(url, 'reference-' + str(i + 1) + '.jpg')
(root / 'assets.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
print(json.dumps(manifest, indent=2))
