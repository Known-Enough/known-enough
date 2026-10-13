"""Bounded existing-pool/Lambda/profile-route setup. Inspect by default; private backups before writes."""
import argparse
import base64
import copy
import datetime
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path
ACCOUNT = '092954139775'
REGION = 'us-east-1'
POOL = 'us-east-1_V9OMjd0zx'
FUNCTION = 'known-enough-stage-api'
ARN = f'arn:aws:lambda:{REGION}:{ACCOUNT}:function:{FUNCTION}'
POOL_ARN = f'arn:aws:cognito-idp:{REGION}:{ACCOUNT}:userpool/{POOL}'
API = 'u94iyvt6p9'
SID = 'KnownEnoughZZ02PostConfirmation'
ROUTES = ['GET /account/profile', 'POST /account/profile', 'POST /account/profile/image', 'OPTIONS /account/profile', 'OPTIONS /account/profile/image']
ROOT = Path(__file__).resolve().parents[2]
BACKUP_BUCKET = 'known-enough-qa-artifacts-' + ACCOUNT


def configuration():
    value = json.loads((ROOT / 'infra/zz/application-config.json').read_text())
    expected = {'schemaVersion': 1, 'account': ACCOUNT, 'region': REGION, 'pool': POOL, 'api': API, 'function': FUNCTION}
    if any(value.get(key) != item for key, item in expected.items()):
        raise RuntimeError('APPLICATION_TARGET_CHANGED')
    if not re.fullmatch(r'[a-f0-9]{64}', value.get('apiSha256', '')) or not re.fullmatch(r'[a-f0-9]{40}', value.get('runtimeSource', '')):
        raise RuntimeError('APPLICATION_RUNTIME_INVALID')
    routes = value.get('routes', [])
    if not routes or len(set(routes)) != len(routes) or len(routes) > 100 or any(
        not re.fullmatch(r'(GET|POST|PUT|PATCH|DELETE|OPTIONS) /[A-Za-z0-9_/-]+', route) for route in routes
    ):
        raise RuntimeError('APPLICATION_ROUTES_INVALID')
    return value


def verify_integration(auth, integration):
    jwt = auth.get('JwtConfiguration', auth.get('JWTConfiguration', {}))
    if jwt.get('Issuer') != f'https://cognito-idp.{REGION}.amazonaws.com/{POOL}' or '3accf7paalvon2m8ue8okfi853' not in jwt.get('Audience', []):
        raise RuntimeError('AUTHORIZER_IDENTITY_INVALID')
    if integration.get('IntegrationType') != 'AWS_PROXY' or integration.get('IntegrationUri') not in [
        ARN, f'arn:aws:apigateway:{REGION}:lambda:path/2015-03-31/functions/{ARN}/invocations'
    ]:
        raise RuntimeError('INTEGRATION_IDENTITY_INVALID')


def private_backup(aws, path):
    content = path.read_bytes()
    checksum = hashlib.sha256(content).hexdigest()
    key = 'application-config/' + path.parent.name + '/prior.json'
    aws('s3api', 'put-object', {'Bucket': BACKUP_BUCKET, 'Key': key, 'Body': str(path),
                              'ChecksumAlgorithm': 'SHA256', 'Metadata': {'sha256': checksum}})
    metadata = aws('s3api', 'head-object', {'Bucket': BACKUP_BUCKET, 'Key': key})
    if metadata.get('ContentLength') != len(content) or metadata.get('Metadata', {}).get('sha256') != checksum:
        raise RuntimeError('PRIVATE_BACKUP_UNCONFIRMED')
    return key


def preserved_update(pool, skeleton):
    if pool.get('Id') != POOL or pool.get('LambdaConfig', {}).get('PostConfirmation') not in [None, ARN]:
        raise RuntimeError('FOREIGN_POST_CONFIRMATION')
    result = {key: copy.deepcopy(pool[key]) for key in skeleton if key in pool}
    result['UserPoolId'] = POOL
    result['LambdaConfig'] = {**result.get('LambdaConfig', {}), 'PostConfirmation': ARN}
    for key in ['Policies', 'AdminCreateUserConfig', 'AutoVerifiedAttributes']:
        if key not in result or result[key] != pool.get(key):
            raise RuntimeError('POOL_PRESERVATION_INVALID')
    return result


def checked_route(basis, route):
    if basis.get('AuthorizationType') != 'JWT' or not re.fullmatch(r'integrations/[A-Za-z0-9]+', basis.get('Target', '')) or not basis.get('AuthorizerId'):
        raise RuntimeError('ACCOUNT_ROUTE_INVALID')
    result = {'ApiId': API, 'RouteKey': route, 'Target': basis['Target'], 'AuthorizationType': 'NONE' if route.startswith('OPTIONS ') else 'JWT'}
    if result['AuthorizationType'] == 'JWT':
        result['AuthorizerId'] = basis['AuthorizerId']
        if 'AuthorizationScopes' in basis:
            result['AuthorizationScopes'] = basis['AuthorizationScopes']
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--api-sha256')
    parser.add_argument('--backup-to-s3', action='store_true')
    args = parser.parse_args()
    report = {'result': 'ZZ02_SETUP_NOT_VERIFIED', 'configurationWrites': 0, 'dataWrites': 0, 'providerCalls': 0, 'signupDelivery': 'NOT_EXECUTED'}
    phase = 'application-manifest'

    def aws(service, operation, data=None, skeleton=False):
        cmd = ['aws', service, operation, '--region', REGION, '--output', 'json', '--no-cli-pager']
        if service == 's3api' and operation == 'put-object' and data is not None:
            data = dict(data)
            cmd += ['--body', data.pop('Body')]
        if skeleton:
            cmd += ['--generate-cli-skeleton', 'input']
        elif data is not None:
            cmd += ['--cli-input-json', json.dumps(data)]
        result = subprocess.run(cmd + ['--cli-connect-timeout', '5', '--cli-read-timeout', '20'], capture_output=True, timeout=30,
                                env={**os.environ, 'AWS_MAX_ATTEMPTS': '1'})
        if result.returncode:
            match = re.search(rb'\(([A-Za-z0-9]+)\)', result.stderr)
            raise RuntimeError(match.group(1).decode() if match else 'AWS_CLI_FAILED')
        return json.loads(result.stdout or '{}')

    try:
        config = configuration()
        managed_routes = config['routes']
        report['configurationSha256'] = hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()
        phase = 'identity'
        identity = aws('sts', 'get-caller-identity')
        if identity.get('Account') != ACCOUNT:
            raise RuntimeError('WRONG_AWS_ACCOUNT')
        phase = 'cognito-idp:DescribeUserPool'
        pool = aws('cognito-idp', 'describe-user-pool', {'UserPoolId': POOL})['UserPool']
        binding = pool.get('LambdaConfig', {}).get('PostConfirmation')
        report['postConfirmation'] = 'MATCH' if binding == ARN else 'ABSENT' if binding is None else 'FOREIGN'
        report['smsRoleConfigured'] = bool(pool.get('SmsConfiguration', {}).get('SnsCallerArn'))
        phase = 'lambda:GetFunctionConfiguration'
        function = aws('lambda', 'get-function-configuration', {'FunctionName': FUNCTION})
        if function.get('FunctionArn') != ARN:
            raise RuntimeError('FUNCTION_IDENTITY_INVALID')
        report['apiSha256'] = base64.b64decode(function['CodeSha256'], validate=True).hex()
        phase = 'apigateway:GetRoutes'
        items = aws('apigatewayv2', 'get-routes', {'ApiId': API})
        if items.get('NextToken'):
            raise RuntimeError('ROUTE_PAGE_NOT_COMPLETE')
        routes = items['Items']
        report['profileRoutesPresent'] = sum(route.get('RouteKey') in ROUTES for route in routes)
        report['managedRoutesPresent'] = sum(route.get('RouteKey') in managed_routes for route in routes)
        if not args.apply:
            report['result'] = 'ZZ02_SETUP_METADATA_READ'
            return report
        checked_hash = args.api_sha256 or config['apiSha256']
        if not re.fullmatch(r'[a-f0-9]{64}', checked_hash) or checked_hash != config['apiSha256'] or report['apiSha256'] != checked_hash:
            raise RuntimeError('CHECKED_RUNTIME_HASH_REQUIRED')
        if function.get('State') != 'Active' or function.get('LastUpdateStatus') != 'Successful':
            raise RuntimeError('RUNTIME_UPDATE_NOT_COMPLETE')
        if os.environ.get('GITHUB_ACTIONS') == 'true' and not args.backup_to_s3:
            raise RuntimeError('DURABLE_CONFIGURATION_BACKUP_REQUIRED')
        if report['postConfirmation'] == 'FOREIGN':
            raise RuntimeError('FOREIGN_POST_CONFIRMATION')
        basis = next((route for route in routes if route.get('RouteKey') == 'GET /account'), None)
        if not basis:
            raise RuntimeError('ACCOUNT_ROUTE_MISSING')
        desired = [checked_route(basis, key) for key in managed_routes]
        for route in desired:
            existing = next((r for r in routes if r.get('RouteKey') == route['RouteKey']), None)
            if existing and any(existing.get(key) != value for key, value in route.items() if key != 'ApiId'):
                raise RuntimeError('PROFILE_ROUTE_DRIFT')
        phase = 'apigateway:GetAuthorizer'
        auth = aws('apigatewayv2', 'get-authorizer', {'ApiId': API, 'AuthorizerId': basis['AuthorizerId']})
        integration = aws('apigatewayv2', 'get-integration', {'ApiId': API, 'IntegrationId': basis['Target'].split('/')[1]})
        verify_integration(auth, integration)
        phase = 'apigateway:GetStage'
        if not aws('apigatewayv2', 'get-stage', {'ApiId': API, 'StageName': '$default'}).get('AutoDeploy'):
            raise RuntimeError('AUTO_DEPLOY_NOT_VERIFIED')
        phase = 'lambda:GetPolicy'
        try:
            policy = aws('lambda', 'get-policy', {'FunctionName': FUNCTION})
        except RuntimeError as error:
            if str(error) != 'ResourceNotFoundException':
                raise
            policy = {'Policy': '{"Statement":[]}'}
        statements = json.loads(policy['Policy'])['Statement']
        existing = next((s for s in statements if s.get('Sid') == SID), None)
        expected = {'Sid': SID, 'Effect': 'Allow', 'Principal': {'Service': 'cognito-idp.amazonaws.com'}, 'Action': 'lambda:InvokeFunction', 'Resource': ARN,
                    'Condition': {'ArnLike': {'AWS:SourceArn': POOL_ARN}, 'StringEquals': {'AWS:SourceAccount': ACCOUNT}}}
        if existing and existing != expected:
            raise RuntimeError('INVOCATION_POLICY_DRIFT')
        if existing and binding == ARN and all(any(r.get('RouteKey') == desired_route['RouteKey'] for r in routes) for desired_route in desired):
            report['result'] = 'ZZ02_SETUP_READBACK_PASS'
            return report
        update = preserved_update(pool, aws('cognito-idp', 'update-user-pool', skeleton=True))
        os.umask(0o077)
        backup = Path.home() / '.known-enough' / ('zz02-setup-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
        backup.mkdir(parents=True, mode=0o700)
        (backup / 'prior.json').write_text(json.dumps({'pool': pool, 'policy': policy, 'routes': routes, 'function': function}))
        report['backup'] = str(backup)
        if args.backup_to_s3:
            phase = 's3:PrivateConfigurationBackup'
            report['privateBackupKey'] = private_backup(aws, backup / 'prior.json')
        phase = 'lambda:FreshConfiguration'
        fresh_function = aws('lambda', 'get-function-configuration', {'FunctionName': FUNCTION})
        if fresh_function.get('RevisionId') != function.get('RevisionId') or fresh_function.get('CodeSha256') != function.get('CodeSha256'):
            raise RuntimeError('RUNTIME_CHANGED_BEFORE_SETUP')
        if not existing:
            phase = 'lambda:AddPermission'
            request = {'FunctionName': FUNCTION, 'StatementId': SID, 'Action': 'lambda:InvokeFunction', 'Principal': 'cognito-idp.amazonaws.com', 'SourceArn': POOL_ARN, 'SourceAccount': ACCOUNT}
            if policy.get('RevisionId'):
                request['RevisionId'] = policy['RevisionId']
            report['configurationWrites'] += 1
            try:
                aws('lambda', 'add-permission', request)
            except (RuntimeError, subprocess.TimeoutExpired):
                pass
            read = json.loads(aws('lambda', 'get-policy', {'FunctionName': FUNCTION})['Policy'])['Statement']
            if next((s for s in read if s.get('Sid') == SID), None) != expected:
                raise RuntimeError('INVOCATION_GRANT_UNCONFIRMED')
        for route in desired:
            if any(r.get('RouteKey') == route['RouteKey'] for r in routes):
                continue
            phase = 'apigateway:CreateRoute'
            report['configurationWrites'] += 1
            try:
                aws('apigatewayv2', 'create-route', route)
            except (RuntimeError, subprocess.TimeoutExpired):
                pass
            page = aws('apigatewayv2', 'get-routes', {'ApiId': API})
            if page.get('NextToken'):
                raise RuntimeError('ROUTE_PAGE_NOT_COMPLETE')
            current = page['Items']
            got = next((r for r in current if r.get('RouteKey') == route['RouteKey']), None)
            if not got or any(got.get(key) != value for key, value in route.items() if key != 'ApiId'):
                raise RuntimeError('PROFILE_ROUTE_UNCONFIRMED')
        if binding != ARN:
            phase = 'cognito-idp:UpdateUserPool'
            if aws('cognito-idp', 'describe-user-pool', {'UserPoolId': POOL})['UserPool'] != pool:
                raise RuntimeError('POOL_CHANGED_BEFORE_WRITE')
            report['configurationWrites'] += 1
            try:
                aws('cognito-idp', 'update-user-pool', update)
            except (RuntimeError, subprocess.TimeoutExpired):
                pass
            current = aws('cognito-idp', 'describe-user-pool', {'UserPoolId': POOL})['UserPool']
            if any(current.get(key) != value for key, value in update.items() if key != 'UserPoolId'):
                raise RuntimeError('POOL_UPDATE_UNCONFIRMED')
        report['result'] = 'ZZ02_SETUP_READBACK_PASS'
    except Exception as error:
        report.update(operation=phase, code=str(error) if isinstance(error, RuntimeError) else type(error).__name__)
    return report


if __name__ == '__main__':
    result = main()
    output = json.dumps(result)
    print(output)
    if os.environ.get('RUNNER_TEMP'):
        (Path(os.environ['RUNNER_TEMP']) / 'zz02-setup-report.json').write_text(output + '\n')
    raise SystemExit(0 if result['result'] in ['ZZ02_SETUP_METADATA_READ', 'ZZ02_SETUP_READBACK_PASS'] else 1)
