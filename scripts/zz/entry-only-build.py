"""Build the verified live frontend with only the user-requested shared entry removal."""
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import tarfile
import urllib.request
from pathlib import Path

BASE = '6afe139f1ef01d48839bf4bfbae9648207b4309b'
ORIGIN = 'https://main.d143q5ravxp5av.amplifyapp.com'
PATCH = 'apps/web/src/auth-entry.tsx'
BLOCK = '''      {!registering && <details className="ke-entry-display"><summary>Shared screen access</summary>
        <p>For a shared screen such as a TV. Shows shared progress only; cannot enter private needs or approve proposals.</p>
        <button type="button" className="secondary" onClick={() => void signIn('display')}>Shared display sign-in</button>
      </details>}
'''.encode()


def verify_patch(original, candidate):
    if original.count(BLOCK) != 1 or candidate != original.replace(BLOCK, b'', 1):
        raise RuntimeError('ENTRY_PATCH_NOT_ISOLATED')


def verify_live(publication, fetch):
    files = publication.get('files', [])
    if publication.get('sourceSha') != BASE or len(files) != 5:
        raise RuntimeError('ENTRY_BASE_INVALID')
    if len({item['path'] for item in files}) != len(files) or not any(item['path'] == '/' for item in files):
        raise RuntimeError('ENTRY_BASE_INVALID')
    for item in files:
        if (item['path'] != '/' and not re.fullmatch(r'/assets/[A-Za-z0-9_-]+\.(js|css)', item['path'])
                or not re.fullmatch(r'[a-f0-9]{64}', item.get('sha256', ''))):
            raise RuntimeError('ENTRY_BASE_INVALID')
    for item in files:
        if hashlib.sha256(fetch(ORIGIN + item['path'])).hexdigest() != item['sha256']:
            raise RuntimeError('LIVE_FRONTEND_CHANGED')


def main():
    source = os.environ['GITHUB_SHA']
    if source != os.environ['EXPECTED_SOURCE'] or not re.fullmatch(r'[a-f0-9]{40}', source):
        raise RuntimeError('ENTRY_SOURCE_INVALID')
    publication = json.loads(Path('docs/review-artifacts/ZZ01/evidence.json').read_text())['publication']['publication']
    def fetch(url):
        with urllib.request.urlopen(url, timeout=15) as response:
            return response.read(5_000_000)
    verify_live(publication, fetch)
    if sys.argv[1:] == ['verify-live']:
        print(json.dumps({'result': 'ENTRY_LIVE_BASE_MATCH', 'baseSourceSha': BASE}))
        return
    subprocess.run(['git', 'merge-base', '--is-ancestor', BASE, 'HEAD'], check=True)
    folder = Path(os.environ['RUNNER_TEMP']) / 'zz-entry-base'
    folder.mkdir(mode=0o700)
    archive = subprocess.check_output(['git', 'archive', BASE])
    with tarfile.open(fileobj=io.BytesIO(archive), mode='r:') as tree:
        tree.extractall(folder, filter='data')
    candidate = Path(PATCH).read_bytes()
    verify_patch((folder / PATCH).read_bytes(), candidate)
    (folder / PATCH).write_bytes(candidate)
    # Only regression source changes in the isolated tree; no other runtime code is copied.
    (folder / 'tests/e2e/zz-entry.spec.ts').write_bytes(Path('tests/e2e/zz-entry.spec.ts').read_bytes())
    log = Path(os.environ['RUNNER_TEMP']) / 'zz-entry-base-checks.log'
    with log.open('w') as output:
        for command in [
            ['npm', 'ci'], ['npm', 'run', 'lint'], ['npm', 'run', 'typecheck'],
            ['npx', 'playwright', 'test', 'tests/e2e/zz-entry.spec.ts', 'tests/e2e/email-registration.spec.ts', '--workers=2'],
            ['npm', 'run', 'build']
        ]:
            subprocess.run(command, cwd=folder, check=True, stdout=output, stderr=subprocess.STDOUT, timeout=300)
    import shutil
    target = Path('apps/web/dist')
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(folder / 'apps/web/dist', target)
    report = {'result': 'ENTRY_ONLY_BUILD_PASS', 'sourceSha': source, 'baseSourceSha': BASE,
              'runtimeChanges': [PATCH], 'patchSha256': hashlib.sha256(candidate).hexdigest(),
              'isolatedBrowserChecks': 6, 'apiPublication': 'NOT_EXECUTED', 'signup': 0, 'providerCalls': 0}
    (Path(os.environ['RUNNER_TEMP']) / 'zz-entry-only-build.json').write_text(json.dumps(report) + '\n')
    print(json.dumps(report))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'result': 'ENTRY_ONLY_BUILD_BLOCKED', 'code': str(error) if isinstance(error, RuntimeError) else type(error).__name__}))
        raise SystemExit(1)
