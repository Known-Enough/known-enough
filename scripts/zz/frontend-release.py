"""Publish only the fixed public frontend; never touches API, users, or model controls."""
import hashlib
import json
import os
import re
import subprocess
import time
import urllib.request
from pathlib import Path

ACCOUNT = '092954139775'
APP = 'd143q5ravxp5av'
REGION = 'us-east-1'


def validate_identity(identity):
    if identity.get('Account') != ACCOUNT or not identity.get('Arn', '').startswith(
            f'arn:aws:sts::{ACCOUNT}:assumed-role/KnownEnoughAmplifyMainDeploy/'):
        raise RuntimeError('FRONTEND_ROLE_INVALID')


def public_manifest(directory):
    rows = []
    for path in sorted(directory.rglob('*')):
        if not path.is_file():
            continue
        relative = str(path.relative_to(directory))
        if relative != 'index.html' and not re.fullmatch(r'assets/[A-Za-z0-9_-]+\.(js|css)', relative):
            raise RuntimeError('PUBLIC_BUILD_INVALID')
        rows.append({'path': '/' if relative == 'index.html' else '/' + relative,
                     'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    if not 1 <= len(rows) <= 100 or not any(row['path'] == '/' for row in rows):
        raise RuntimeError('PUBLIC_BUILD_INVALID')
    return rows


def main():
    source = os.environ['GITHUB_SHA']
    if (source != os.environ['EXPECTED_SOURCE'] or not re.fullmatch(r'[a-f0-9]{40}', source)
            or os.environ['GITHUB_REPOSITORY'] != 'Known-Enough/known-enough'
            or os.environ['GITHUB_REF'] != 'refs/heads/main'
            or os.environ['GITHUB_ACTOR_ID'] not in ['143764700', '44531296']):
        raise RuntimeError('FRONTEND_SOURCE_INVALID')
    report = {'sourceSha': source, 'result': 'NOT_EXECUTED', 'providerCalls': 0, 'signup': 0,
              'apiPublication': 'NOT_EXECUTED'}
    target = Path(os.environ['RUNNER_TEMP']) / 'zz-frontend-release.json'

    def aws(*args):
        result = subprocess.run(['aws', *args, '--region', REGION, '--output', 'json', '--no-cli-pager'],
                                capture_output=True, timeout=30, check=False)
        if result.returncode:
            match = re.search(rb'\(([A-Za-z0-9]+)\)', result.stderr)
            raise RuntimeError(match.group(1).decode() if match else 'AWS_CLI_FAILED')
        return json.loads(result.stdout or '{}')

    phase = 'identity'
    try:
        validate_identity(aws('sts', 'get-caller-identity'))
        report['files'] = public_manifest(Path('apps/web/dist'))
        archive = Path(os.environ['RUNNER_TEMP']) / 'zz-public-build.zip'
        subprocess.run(['zip', '-qr', str(archive), '.'], cwd='apps/web/dist', check=True,
                       capture_output=True)
        phase = 'amplify:CreateDeployment'
        deployment = aws('amplify', 'create-deployment', '--app-id', APP, '--branch-name', 'main')
        job = deployment.get('jobId')
        url = deployment.get('zipUploadUrl')
        if not isinstance(job, str) or not re.fullmatch(r'[0-9]+', job) or not isinstance(url, str) or not url.startswith('https://'):
            raise RuntimeError('DEPLOYMENT_RESPONSE_INVALID')
        phase = 'public-upload'
        with urllib.request.urlopen(urllib.request.Request(url, data=archive.read_bytes(), method='PUT'), timeout=60):
            pass
        phase = 'amplify:StartDeployment'
        # A lost start acknowledgment is read back; the start write is never retried.
        try:
            aws('amplify', 'start-deployment', '--app-id', APP, '--branch-name', 'main', '--job-id', job)
        except (RuntimeError, subprocess.TimeoutExpired):
            pass
        phase = 'amplify:GetJob'
        for _ in range(60):
            status = aws('amplify', 'get-job', '--app-id', APP, '--branch-name', 'main', '--job-id', job)['job']['summary']['status']
            if status in ['SUCCEED', 'SUCCEEDED']:
                report['result'] = 'FRONTEND_PUBLICATION_PASS'
                report['amplifyJobId'] = job
                break
            if status in ['FAILED', 'CANCELLED']:
                raise RuntimeError('FRONTEND_DEPLOYMENT_FAILED')
            time.sleep(10)
        else:
            raise RuntimeError('FRONTEND_DEPLOYMENT_UNCONFIRMED')
    except Exception as error:
        report.update(result='FRONTEND_PUBLICATION_UNVERIFIED', operation=phase,
                      code=str(error) if isinstance(error, RuntimeError) else type(error).__name__)
    target.write_text(json.dumps(report) + '\n')
    return 0 if report['result'] == 'FRONTEND_PUBLICATION_PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
