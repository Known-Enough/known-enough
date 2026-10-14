#!/usr/bin/env python3
"""Recover the frozen account tool locally. Never call AWS or remove private state."""
import datetime
import errno
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request

SOURCE = 'df3e651cf96e09f4e2452e4398e60c1fa0b9140b'
ARCHIVE_HASH = '4061a2f32258a2443df11923b157ccbc2c5c6a86580def597c8f8516efea827f'
BOOTSTRAP_HASH = '0f68cd163f854efd4daab2d698ac4f8ed13444dfe406a6d143494e1ea32715f0'


def confined(path, home):
    if not path.resolve().is_relative_to(home.resolve()):
        raise ValueError('LOCAL_PATH_CHANGED')
    current = path
    while current != home:
        if current.is_symlink():
            raise ValueError('LOCAL_PATH_CHANGED')
        current = current.parent


def remove_cache(path, home):
    confined(path, home)
    if path.is_dir():
        shutil.rmtree(path)
    elif path.exists():
        path.unlink()


def main():
    os.umask(0o077)
    home = Path.home()
    root = home / '.known-enough/access-users'
    confined(root, home)
    root.mkdir(parents=True, exist_ok=True, mode=0o700)

    # These are reproducible downloads/dependencies, not AWS snapshots or account logs.
    remove_cache(home / '.npm/_cacache', home)
    for source in root.glob('source-*'):
        if not re.fullmatch(r'source-[a-f0-9]{40}', source.name) or not source.is_dir():
            continue
        confined(source, home)
        dependencies = [source / 'node_modules']
        for parent in ['apps', 'packages']:
            confined(source / parent, home)
            dependencies.extend((source / parent).glob('*/node_modules'))
        for dependency in dependencies:
            remove_cache(dependency, home)
        marker = source / '.fix04-tool-verified.json'
        confined(marker, home)
        marker.unlink(missing_ok=True)
    for archive in root.iterdir():
        if (re.fullmatch(r'source-[a-f0-9]{40}\.tar\.gz', archive.name)
                and archive.name != 'source-' + SOURCE + '.tar.gz'):
            remove_cache(archive, home)
        elif re.fullmatch(r'(?:source-[a-f0-9]{40}\.tar\.gz|node-v24\.21\.0-linux-(?:x64|arm64)\.tar\.xz)\.new-[a-f0-9]{8}', archive.name):
            remove_cache(archive, home)

    print(json.dumps({'result': 'REGENERABLE_CACHES_REMOVED',
                      'homeFreeMiB': shutil.disk_usage(home).free // (1024 * 1024),
                      'privateStateRemoved': False}))
    with tempfile.TemporaryDirectory(prefix='known-enough-tool-recovery-', dir='/tmp') as temporary:
        work = Path(temporary)
        bootstrap = work / 'bootstrap.py'
        url = 'https://raw.githubusercontent.com/Known-Enough/known-enough/' + SOURCE + '/scripts/fix04/bootstrap.py'
        with urllib.request.urlopen(url, timeout=30) as response:
            data = response.read(65537)
        if len(data) > 65536 or hashlib.sha256(data).hexdigest() != BOOTSTRAP_HASH:
            raise ValueError('BOOTSTRAP_HASH_MISMATCH')
        bootstrap.write_bytes(data)
        spec = importlib.util.spec_from_file_location('frozen_bootstrap', bootstrap)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        archive = root / ('source-' + SOURCE + '.tar.gz')
        confined(archive, home)
        # A completed but interrupted/corrupt download is reproducible, not a backup.
        if archive.exists() and hashlib.sha256(archive.read_bytes()).hexdigest() != ARCHIVE_HASH:
            archive.unlink()
        module.download('https://codeload.github.com/Known-Enough/known-enough/tar.gz/' + SOURCE,
                        archive, ARCHIVE_HASH, 100 * 1024 * 1024)
        target = root / ('source-' + SOURCE)
        confined(target, home)
        if target.exists():
            fresh = work / 'source'
            module.extract(archive, fresh, 'known-enough-' + SOURCE)
            stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
            backup = root / ('source-repair-backup-' + stamp)
            for original in fresh.rglob('*'):
                if not original.is_file():
                    continue
                relative = original.relative_to(fresh)
                destination = target / relative
                confined(destination.parent, home)
                if destination.exists() or destination.is_symlink():
                    if (not destination.is_symlink() and destination.is_file()
                            and hashlib.sha256(destination.read_bytes()).digest() == hashlib.sha256(original.read_bytes()).digest()):
                        continue
                    saved = backup / relative
                    saved.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                    destination.rename(saved)  # Retain changed/truncated files; never discard local edits.
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(original, destination)

        # npm's download cache uses temporary storage instead of refilling CloudShell home.
        env = {**os.environ, 'npm_config_cache': str(work / 'npm-cache')}
        result = subprocess.run([sys.executable, str(bootstrap), '--source-sha', SOURCE,
                                 '--archive-sha256', ARCHIVE_HASH], env=env, check=False)
        if result.returncode:
            raise ValueError('TOOL_UPDATE_INCOMPLETE')
    print(json.dumps({'result': 'LOCAL_SPACE_RECOVERY_COMPLETE', 'source': SOURCE,
                      'awsWrites': 0, 'accountChanges': 0, 'privateStateRemoved': False}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        code = str(error) if isinstance(error, ValueError) and re.fullmatch(r'[A-Z_]+', str(error)) else type(error).__name__
        if isinstance(error, OSError):
            code = errno.errorcode.get(error.errno, 'LOCAL_OS_ERROR')
        print(json.dumps({'result': 'LOCAL_SPACE_RECOVERY_BLOCKED', 'code': code,
                          'awsWrites': 0, 'accountChanges': 0}))
        sys.exit(1)
