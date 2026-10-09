"""Reproduce pinned, unchanged DM Sans v17 assets from their official sources."""
import argparse, base64, hashlib, json, urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILES = [
    ('dm-sans-italic-latin-ext-v17-2a32f58c.woff2', 'rP2Wp2ywxg089UriCZaSExdy3sGt9zz86GPwyKK58VXh.woff2', 15344, '2a32f58c4865640d84d60e6bade92c9345d8ad70376e6bdae4c0553d2f5b6f31'),
    ('dm-sans-italic-latin-v17-71f3c985.woff2', 'rP2Wp2ywxg089UriCZaSExdy3sGt9zz86GPwyKy58Q.woff2', 28464, '71f3c9851c5a94ad14308d00b15ea2ec207b65ba80a0e9a43d45b2ee9ea631bd'),
    ('dm-sans-normal-latin-ext-v17-5d18d31d.woff2', 'rP2Hp2ywxg089UriCZ2IHSeH.woff2', 31292, '5d18d31d23ada61ebee1d589b11d5da30db9e158f589d5e35221ba2b1a45de54'),
    ('dm-sans-normal-latin-v17-ca72d2bc.woff2', 'rP2Hp2ywxg089UriCZOIHQ.woff2', 62724, 'ca72d2bcea8f4daa783dbdfa2d9b46068c3ce38168e05918fb867aa453b4f890'),
]
LICENSE_BLOB = '4430b85ac62998e2edb914360f9ebdfe43f4deaa'
LICENSE_SHA256 = '9af36190332437f5ecd09974de43c1f7c77a310a996cdd8ceb25628b458840e1'
sha = lambda raw: hashlib.sha256(raw).hexdigest()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--proxy')
    parser.add_argument('--write-assets', action='store_true')
    args = parser.parse_args()
    if args.output.exists():
        raise ValueError('Preserve earlier acquisition report')
    handlers = [urllib.request.ProxyHandler({'https': args.proxy})] if args.proxy else []
    opener = urllib.request.build_opener(*handlers)
    def get(url):
        with opener.open(urllib.request.Request(url, headers={'User-Agent': 'Astra-Pinned-Site-Fonts'}), timeout=30) as response:
            if response.status != 200:
                raise ValueError('Official source unavailable')
            return response.read()
    records, downloads = [], {}
    for local, original, size, expected in FILES:
        url = 'https://fonts.gstatic.com/s/dmsans/v17/' + original
        raw = get(url)
        if len(raw) != size or sha(raw) != expected or raw[:4] != b'wOF2':
            raise ValueError('Pinned official font bytes differ: ' + local)
        downloads[local] = raw
        records.append({'file': local, 'url': url, 'bytes': size, 'sha256': expected})
    url = 'https://api.github.com/repos/google/fonts/git/blobs/' + LICENSE_BLOB
    blob = json.loads(get(url))
    license_bytes = base64.b64decode(blob['content'])
    git_sha = hashlib.sha1(b'blob ' + str(len(license_bytes)).encode() + b'\0' + license_bytes).hexdigest()
    if git_sha != LICENSE_BLOB or sha(license_bytes) != LICENSE_SHA256:
        raise ValueError('Pinned OFL license differs')
    downloads['OFL.txt'] = license_bytes
    if args.write_assets:
        folder = ROOT / 'public/fonts/brand'
        folder.mkdir(parents=True, exist_ok=True)
        for name, raw in downloads.items():
            target = folder / name
            if target.exists() and target.read_bytes() != raw:
                raise ValueError('Do not replace different existing asset: ' + name)
        for name, raw in downloads.items():
            (folder / name).write_bytes(raw)
    report = {'passed': True, 'retrievedAt': datetime.now(timezone.utc).isoformat(), 'files': records,
              'license': {'url': url, 'gitBlobSha': git_sha, 'sha256': LICENSE_SHA256, 'bytes': len(license_bytes)},
              'unchangedOfficialWebFonts': True, 'written': args.write_assets}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'passed': True, 'fontFiles': len(records), 'totalFontBytes': sum(r['bytes'] for r in records), 'written': args.write_assets}))

if __name__ == '__main__':
    main()
