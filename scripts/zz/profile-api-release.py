#!/usr/bin/env python3
"""Publish the narrowly scoped shared-profile read on the existing API."""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
import zipfile
from pathlib import Path

FUNCTION = 'known-enough-stage-api'
API_ID = 'u94iyvt6p9'
REGION = 'us-east-1'
FUNCTION_ARN = 'arn:aws:lambda:us-east-1:092954139775:function:known-enough-stage-api'
ROLE_ARN = 'arn:aws:iam::092954139775:role/KnownEnoughStageApiRole'
AUTHORIZER_ISSUER = 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_V9OMjd0zx'
AUTHORIZER_AUDIENCES = {'3accf7paalvon2m8ue8okfi853', '481ru24906sv26f30i569gq8g0'}
PROFILE_ROUTE = 'GET /groups/{groupId}/members/{memberId}/profile'
OPTIONS_ROUTE = 'OPTIONS /groups/{groupId}/members/{memberId}/profile'
GROUP_ROUTE = 'GET /groups/{groupId}'
GROUP_OPTIONS = 'OPTIONS /groups/{proxy+}'


class ReleaseError(Exception):
    pass


def require(ok: bool, code: str) -> None:
    if not ok:
        raise ReleaseError(code)


def run(args: list[str], *, capture: bool = True) -> str:
    result = subprocess.run(args, capture_output=capture, text=True, check=False)
    if result.returncode:
        detail = (result.stderr or '').lower()
        if 'accessdenied' in detail or 'not authorized' in detail or 'access denied' in detail:
            raise ReleaseError('AWS_ACCESS_DENIED')
        if 'conflict' in detail or 'already exists' in detail:
            raise ReleaseError('AWS_CONCURRENT_ROUTE_CHANGE')
        raise ReleaseError('AWS_OPERATION_FAILED')
    return result.stdout.strip() if capture else ''


def aws_json(*args: str) -> dict:
    value = json.loads(run(['aws', *args, '--region', REGION, '--output', 'json', '--no-cli-pager']))
    require(isinstance(value, dict), 'AWS_READBACK_INVALID')
    return value


def expected_source() -> str:
    source = os.environ.get('EXPECTED_SOURCE', '')
    require(bool(re.fullmatch(r'[0-9a-f]{40}', source)), 'SOURCE_SHA_INVALID')
    actual = run(['git', 'rev-parse', 'HEAD'])
    require(actual == source, 'SOURCE_SHA_MISMATCH')
    return source


def work_dir() -> Path:
    root = Path(os.environ.get('RUNNER_TEMP', '/tmp')) / 'zz-profile-api'
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(root, 0o700)
    return root


def write_archive(module: Path, archive: Path) -> None:
    info = zipfile.ZipInfo('ke13b-lambda.mjs', date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    info.create_system = 3
    info.external_attr = 0o100644 << 16
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as zipped:
        zipped.writestr(info, module.read_bytes())


def prepare() -> None:
    source = expected_source()
    root = work_dir()
    module = root / 'ke13b-lambda.mjs'
    archive = root / 'ke13b-lambda.zip'
    run(['./node_modules/.bin/rolldown', 'apps/api/src/ke13b-lambda.ts', '--platform', 'node',
         '--format', 'esm', '--no-codeSplitting', '--file', str(module)], capture=False)
    require(module.is_file() and module.stat().st_size > 0, 'API_BUNDLE_MISSING')
    write_archive(module, archive)
    with zipfile.ZipFile(archive) as zipped:
        require(zipped.namelist() == ['ke13b-lambda.mjs'], 'API_ARCHIVE_CONTENT_INVALID')
    print(json.dumps({'sourceSha': source, 'apiZipSha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
                      'bundleBytes': module.stat().st_size, 'packageBytes': archive.stat().st_size,
                      'apiPublication': 'PREPARED', 'configurationWrites': 0, 'dataWrites': 0,
                      'providerCalls': 0}, separators=(',', ':')))


def lambda_config() -> dict:
    return aws_json('lambda', 'get-function-configuration', '--function-name', FUNCTION,
                    '--query', '{FunctionArn:FunctionArn,State:State,LastUpdateStatus:LastUpdateStatus,Runtime:Runtime,Handler:Handler,Role:Role,GroupsEnabled:Environment.Variables.NP_GROUPS_ENABLED,RevisionId:RevisionId,CodeSha256:CodeSha256}')


def current_lambda_archive(config: dict, destination: Path) -> bytes:
    details = aws_json('lambda', 'get-function', '--function-name', FUNCTION,
                       '--query', '{Location:Code.Location,CodeSha256:Configuration.CodeSha256}')
    require(details.get('CodeSha256') == config.get('CodeSha256'), 'LAMBDA_CHANGED_DURING_PREFLIGHT')
    location = details.get('Location')
    require(isinstance(location, str) and location.startswith('https://'), 'LAMBDA_ARCHIVE_URL_INVALID')
    request = urllib.request.Request(location, method='GET')
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            data = response.read(50 * 1024 * 1024 + 1)
    except Exception:
        raise ReleaseError('LAMBDA_ARCHIVE_READ_FAILED') from None
    require(0 < len(data) <= 50 * 1024 * 1024, 'LAMBDA_ARCHIVE_SIZE_INVALID')
    require(base64.b64encode(hashlib.sha256(data).digest()).decode('ascii') == config.get('CodeSha256'),
            'LAMBDA_ARCHIVE_HASH_MISMATCH')
    destination.write_bytes(data)
    os.chmod(destination, 0o600)
    return data


def routes() -> dict[str, dict]:
    result = aws_json('apigatewayv2', 'get-routes', '--api-id', API_ID)
    items = result.get('Items')
    require(isinstance(items, list), 'API_ROUTE_READBACK_INVALID')
    return {item.get('RouteKey'): item for item in items if isinstance(item, dict) and isinstance(item.get('RouteKey'), str)}


def integration_exists(target: str) -> bool:
    match = re.fullmatch(r'integrations/([A-Za-z0-9]+)', target)
    require(match is not None, 'GROUP_INTEGRATION_INVALID')
    result = aws_json('apigatewayv2', 'get-integrations', '--api-id', API_ID)
    items = result.get('Items')
    require(isinstance(items, list), 'API_INTEGRATION_READBACK_INVALID')
    return any(isinstance(item, dict) and item.get('IntegrationId') == match.group(1)
               and item.get('IntegrationType') == 'AWS_PROXY' and item.get('IntegrationUri') == FUNCTION_ARN
               and item.get('PayloadFormatVersion') == '2.0' for item in items)


def route_readback(route_map: dict[str, dict], key: str, *, auth: str, target: str,
                   authorizer: str | None = None, scopes: list[str] | None = None) -> bool:
    current = route_map.get(key)
    if current is None:
        return False
    require(current.get('AuthorizationType') == auth and current.get('Target') == target,
            'EXISTING_PROFILE_ROUTE_MISMATCH')
    if authorizer is not None:
        require(current.get('AuthorizerId') == authorizer, 'EXISTING_PROFILE_ROUTE_MISMATCH')
        require(current.get('AuthorizationScopes', []) == (scopes or []), 'EXISTING_PROFILE_ROUTE_MISMATCH')
    return True


def create_route(key: str, auth: str, target: str, authorizer: str | None = None,
                 scopes: list[str] | None = None) -> str:
    args = ['apigatewayv2', 'create-route', '--api-id', API_ID, '--route-key', key,
            '--target', target, '--authorization-type', auth]
    if authorizer is not None:
        args += ['--authorizer-id', authorizer]
        if scopes:
            args += ['--authorization-scopes', *scopes]
    result = aws_json(*args)
    route_id = result.get('RouteId')
    require(isinstance(route_id, str) and route_id, 'API_ROUTE_CREATE_UNVERIFIED')
    return route_id


def delete_route(route_id: str) -> None:
    run(['aws', 'apigatewayv2', 'delete-route', '--api-id', API_ID, '--route-id', route_id,
         '--region', REGION, '--no-cli-pager'])


def wait_config(expected_hash: str, timeout: int = 600) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        config = lambda_config()
        if config.get('LastUpdateStatus') == 'Failed':
            raise ReleaseError('LAMBDA_UPDATE_FAILED')
        if config.get('State') == 'Active' and config.get('LastUpdateStatus') == 'Successful' \
                and config.get('CodeSha256') == expected_hash:
            return config
        time.sleep(5)
    raise ReleaseError('LAMBDA_UPDATE_TIMEOUT')


def publish() -> None:
    source = expected_source()
    root = work_dir()
    archive = root / 'ke13b-lambda.zip'
    rollback = root / 'previous-ke13b-lambda.zip'
    require(archive.is_file(), 'API_ARCHIVE_MISSING')
    new_bytes = archive.read_bytes()
    require(0 < len(new_bytes) <= 50 * 1024 * 1024, 'API_ARCHIVE_SIZE_INVALID')
    new_sha = hashlib.sha256(new_bytes).hexdigest()
    new_code_sha = base64.b64encode(hashlib.sha256(new_bytes).digest()).decode('ascii')

    prior = lambda_config()
    require(prior.get('State') == 'Active' and prior.get('LastUpdateStatus') == 'Successful',
            'LAMBDA_NOT_READY')
    require(prior.get('Runtime') == 'nodejs24.x' and prior.get('Handler') == 'ke13b-lambda.handler',
            'LAMBDA_TARGET_MISMATCH')
    require(prior.get('FunctionArn') == FUNCTION_ARN and prior.get('Role') == ROLE_ARN,
            'LAMBDA_TARGET_MISMATCH')
    require(prior.get('GroupsEnabled') == 'true', 'GROUPS_RUNTIME_NOT_ENABLED')
    require(isinstance(prior.get('RevisionId'), str) and isinstance(prior.get('CodeSha256'), str),
            'LAMBDA_REVISION_MISSING')

    route_map = routes()
    group_route = route_map.get(GROUP_ROUTE)
    require(isinstance(group_route, dict) and group_route.get('AuthorizationType') == 'JWT'
            and isinstance(group_route.get('AuthorizerId'), str) and group_route.get('AuthorizerId'),
            'GROUP_JWT_ROUTE_MISSING')
    target = group_route.get('Target')
    require(isinstance(target, str) and integration_exists(target), 'GROUP_INTEGRATION_MISSING')
    authorizer = group_route['AuthorizerId']
    authorizer_config = aws_json('apigatewayv2', 'get-authorizer', '--api-id', API_ID,
                                 '--authorizer-id', authorizer)
    jwt = authorizer_config.get('JwtConfiguration')
    require(authorizer_config.get('AuthorizerType') == 'JWT' and isinstance(jwt, dict)
            and jwt.get('Issuer') == AUTHORIZER_ISSUER
            and set(jwt.get('Audience', [])) == AUTHORIZER_AUDIENCES, 'GROUP_AUTHORIZER_MISMATCH')
    scopes = group_route.get('AuthorizationScopes', [])
    require(isinstance(scopes, list) and all(isinstance(scope, str) for scope in scopes), 'GROUP_ROUTE_SCOPES_INVALID')
    has_profile = route_readback(route_map, PROFILE_ROUTE, auth='JWT', target=target,
                                 authorizer=authorizer, scopes=scopes)

    # Exact preflight route; mirror an existing catch-all if present, otherwise
    # the same Lambda integration handles OPTIONS and applies the configured CORS policy.
    options_source = route_map.get(GROUP_OPTIONS)
    if options_source is not None:
        require(options_source.get('AuthorizationType') == 'NONE' and options_source.get('Target') == target,
                'GROUP_OPTIONS_ROUTE_MISMATCH')
        options_target = options_source['Target']
    else:
        options_target = target
    has_options = route_readback(route_map, OPTIONS_ROUTE, auth='NONE', target=options_target)

    stage = aws_json('apigatewayv2', 'get-stage', '--api-id', API_ID, '--stage-name', '$default')
    require(stage.get('AutoDeploy') is True, 'API_STAGE_NOT_AUTODEPLOY')
    prior_bytes = current_lambda_archive(prior, rollback)
    prior_code_sha = prior.get('CodeSha256')
    require(isinstance(prior_code_sha, str), 'LAMBDA_CODE_HASH_MISSING')
    writes: list[str] = []
    new_route_ids: list[str] = []
    updated = False
    try:
        if prior_code_sha != new_code_sha:
            run(['aws', 'lambda', 'update-function-code', '--function-name', FUNCTION,
                 '--zip-file', f'fileb://{archive}', '--revision-id', prior['RevisionId'],
                 '--region', REGION, '--no-cli-pager'])
            updated = True
            writes.append('lambda-code')
            wait_config(new_code_sha)
        if not has_profile:
            new_route_ids.append(create_route(PROFILE_ROUTE, 'JWT', target, authorizer, scopes))
            writes.append('authenticated-profile-route')
        if not has_options:
            new_route_ids.append(create_route(OPTIONS_ROUTE, 'NONE', options_target))
            writes.append('cors-preflight-route')
        observed = routes()
        require(route_readback(observed, PROFILE_ROUTE, auth='JWT', target=target,
                               authorizer=authorizer, scopes=scopes), 'PROFILE_ROUTE_FINAL_READBACK_MISMATCH')
        require(route_readback(observed, OPTIONS_ROUTE, auth='NONE', target=options_target),
                'OPTIONS_ROUTE_FINAL_READBACK_MISMATCH')
        final_config = lambda_config()
        require(final_config.get('CodeSha256') == new_code_sha and final_config.get('State') == 'Active'
                and final_config.get('LastUpdateStatus') == 'Successful', 'LAMBDA_FINAL_READBACK_MISMATCH')
    except Exception:
        route_cleanup_failed = False
        for route_id in reversed(new_route_ids):
            try:
                delete_route(route_id)
            except Exception:
                route_cleanup_failed = True
        if updated:
            try:
                current = lambda_config()
                run(['aws', 'lambda', 'update-function-code', '--function-name', FUNCTION,
                     '--zip-file', f'fileb://{rollback}', '--revision-id', current['RevisionId'],
                     '--region', REGION, '--no-cli-pager'])
                wait_config(prior_code_sha)
            except Exception:
                raise ReleaseError('PUBLISH_FAILED_ROLLBACK_UNVERIFIED') from None
        if route_cleanup_failed:
            raise ReleaseError('PUBLISH_FAILED_ROUTE_CLEANUP_UNVERIFIED') from None
        raise
    finally:
        try:
            rollback.unlink(missing_ok=True)
        except OSError:
            pass

    report = {'sourceSha': source, 'apiZipSha256': new_sha, 'lambdaCodeSha256': new_code_sha,
              'lambdaState': final_config['State'], 'lambdaUpdateStatus': final_config['LastUpdateStatus'],
              'authenticatedProfileRoute': 'VERIFIED', 'corsPreflightRoute': 'VERIFIED',
              'routeWrites': writes, 'configurationWrites': 0, 'dataWrites': 0,
              'providerCalls': 0, 'accountTests': 'NOT_EXECUTED'}
    output = Path(os.environ.get('RUNNER_TEMP', '/tmp')) / 'zz-profile-api-release.json'
    output.write_text(json.dumps(report, separators=(',', ':')) + '\n', encoding='utf-8')
    os.chmod(output, 0o600)
    print(json.dumps(report, separators=(',', ':')))


def main() -> None:
    if len(sys.argv) != 2 or sys.argv[1] not in {'prepare', 'publish'}:
        raise ReleaseError('USAGE_INVALID')
    if sys.argv[1] == 'prepare':
        prepare()
    else:
        publish()


if __name__ == '__main__':
    try:
        main()
    except ReleaseError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
