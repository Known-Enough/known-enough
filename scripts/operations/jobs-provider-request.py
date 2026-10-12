"""Prepare a password-free private support request; never send email or call Mail.tm."""
import datetime
import json
import os
import re
import subprocess
from pathlib import Path
ACCOUNT = '092954139775'
RUN = '1ea949f1-4fc2-4bc5-981c-371819e8d57b'
SOURCE = '246a1d8552810e46efdc635ba956ed459bbd9ad2'
KEY = 'ops01-owned/' + RUN + '/mailtm-support-request-private.txt'


def request_text(state):
    if state.get('sourceSha') != SOURCE or state.get('runId') != RUN or len(state.get('fixtures', [])) != 2:
        raise RuntimeError('ORIGINAL_CHECKPOINT_MISMATCH')
    pending = [f for f in state['fixtures'] if not f.get('mailboxRemoved')]
    if len(pending) != 1:
        raise RuntimeError('EXPECTED_ONE_PENDING_MAILBOX')
    address = pending[0].get('mailbox', {}).get('address', '')
    if not re.fullmatch(r'keqa-[a-f0-9]{32}@[a-z0-9.-]+', address):
        raise RuntimeError('SYNTHETIC_ADDRESS_INVALID')
    return ('To: support@mail.tm\nSubject: Synthetic mailbox status verification - Known Enough OPS03\n\n'
            'Synthetic mailbox address: ' + address + '\n\n'
            'Creation was attempted during 2026-10-11 23:26:45-23:28:16 UTC.\n'
            'The creation outcome was not recorded.\n'
            'During 2026-10-12 03:13:19-03:13:46 UTC, POST /token using the\n'
            'originally saved credentials returned HTTP 401.\n\n'
            'Please confirm whether this exact mailbox currently exists.\n'
            'If absent or deleted, provide account-specific confirmation and the UTC\n'
            'deletion time if available. If it exists, please advise the secure\n'
            'ownership-verification procedure so we can delete our synthetic test\n'
            'mailbox, or confirm deletion if you can verify our ownership.\n'
            'Please do not create or replace the mailbox. Provide a case reference.\n')


def prepare(aws, folder):
    bucket = 'known-enough-qa-artifacts-' + ACCOUNT
    raw = folder / 'provider-checkpoint-private.json'
    draft = folder / 'provider-request-private.txt'
    readback = folder / 'provider-request-readback-private.txt'
    report = {'result': 'PRIVATE_PROVIDER_REQUEST_BLOCKED', 'emailSent': False,
              'mailboxRequests': 0, 'signup': 0, 'providerCalls': 0, 'putRequests': 0}
    operation = 'sts:GetCallerIdentity'
    try:
        identity = aws('sts', 'get-caller-identity')
        if identity.get('Account') != ACCOUNT or not identity.get('Arn', '').startswith(
                f'arn:aws:sts::{ACCOUNT}:assumed-role/KnownEnoughGithubQaRelease/'):
            raise RuntimeError('OWN_QA_ROLE_REQUIRED')
        operation = 's3:GetObject'
        aws('s3api', 'get-object', '--bucket', bucket, '--key', 'ops01-owned/' + RUN + '/state-private.json', str(raw))
        text = request_text(json.loads(raw.read_text()))
        draft.write_text(text)
        operation = 's3:PutObject'
        report['putRequests'] = 1
        acknowledgment = 'ACKNOWLEDGED'
        try:
            aws('s3api', 'put-object', '--bucket', bucket, '--key', KEY, '--body', str(draft),
                '--server-side-encryption', 'AES256', '--content-type', 'text/plain; charset=utf-8',
                '--if-none-match', '*')
        except (RuntimeError, subprocess.TimeoutExpired) as error:
            # An existing object or unknown write acknowledgment is reconciled by one read, never another put.
            acknowledgment = 'READ_RECONCILED'
            label = str(error) if isinstance(error, RuntimeError) else 'WRITE_ACK_TIMEOUT'
            report['putCode'] = label if re.fullmatch(r'[A-Za-z0-9_]{1,100}', label) else 'AWS_REQUEST_FAILED'
        operation = 's3:GetObject'
        aws('s3api', 'get-object', '--bucket', bucket, '--key', KEY, str(readback))
        if readback.read_text() != text:
            raise RuntimeError('PRIVATE_REQUEST_CONTENT_MISMATCH')
        report.update(result='PRIVATE_PROVIDER_REQUEST_AVAILABLE', privateRequestKey=KEY,
                      originalSource=SOURCE, putAcknowledgment=acknowledgment, readbackMatches=True)
    except (RuntimeError, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
        code = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        report.update(operation=operation, code=code if re.fullmatch(r'[A-Za-z0-9_]{1,100}', code) else 'REQUEST_PREPARATION_FAILED')
    finally:
        for path in [raw, draft, readback]:
            path.unlink(missing_ok=True)
    return report


def main():
    os.umask(0o077)
    def aws(*args):
        result = subprocess.run(['aws', *args, '--region', 'us-east-1', '--output', 'json', '--no-cli-pager'],
                                capture_output=True, timeout=30)
        if result.returncode:
            match = re.search(rb'\(([A-Za-z0-9]+)\)', result.stderr)
            raise RuntimeError(match.group(1).decode() if match else 'AWS_REQUEST_FAILED')
        return json.loads(result.stdout or b'{}')
    report = prepare(aws, Path(os.environ['RUNNER_TEMP']))
    report.update(sourceSha=os.environ['GITHUB_SHA'], observedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
    (Path(os.environ['RUNNER_TEMP']) / 'provider-request-report.json').write_text(json.dumps(report) + '\n')
    print(json.dumps(report))
    return 0 if report['result'] == 'PRIVATE_PROVIDER_REQUEST_AVAILABLE' else 1


if __name__ == '__main__': raise SystemExit(main())
