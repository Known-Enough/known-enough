#!/usr/bin/env python3
"""Fixed owner HTTP routes on the existing primary API; no code, auth or data changes."""
import argparse
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import uuid

spec = importlib.util.spec_from_file_location('owner_access', Path(__file__).with_name('lifecycle-owner-access.py'))
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)
API = 'u94iyvt6p9'
FUNCTION = 'arn:aws:lambda:us-east-1:092954139775:function:known-enough-stage-api'
ROUTES = ['GET /account/export', 'GET /account/erasure/{opId}', 'POST /account/erasure/{opId}/consent',
          'OPTIONS /account/export', 'OPTIONS /account/erasure/{proxy+}']


def expected_routes(items, integration, authorizer):
    indexed = {r['RouteKey']: r for r in items}
    a.require(len(indexed) == len(items), 'DUPLICATE_ROUTE_KEYS')
    basis = indexed.get('GET /account', {})
    a.require(basis.get('AuthorizationType') == 'JWT' and basis.get('Target', '').startswith('integrations/')
              and basis.get('AuthorizerId'), 'EXISTING_OWNER_ROUTE_CHANGED')
    a.require(integration.get('IntegrationType') == 'AWS_PROXY' and integration.get('IntegrationId') == basis['Target'].split('/')[1]
              and integration.get('IntegrationUri') in [FUNCTION, 'arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/' + FUNCTION + '/invocations'], 'INTEGRATION_CHANGED')
    a.require(authorizer.get('AuthorizerId') == basis['AuthorizerId'] and authorizer.get('AuthorizerType') == 'JWT'
              and authorizer.get('JwtConfiguration', {}).get('Issuer') == 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_V9OMjd0zx'
              and authorizer.get('IdentitySource') == ['$request.header.Authorization'], 'AUTHORIZER_CHANGED')
    result = []
    for name in ROUTES:
        expected = {'RouteKey': name, 'Target': basis['Target'], 'AuthorizationType': 'NONE' if name.startswith('OPTIONS ') else 'JWT'}
        if expected['AuthorizationType'] == 'JWT':
            expected['AuthorizerId'] = basis['AuthorizerId']
            if basis.get('AuthorizationScopes'):
                expected['AuthorizationScopes'] = list(basis['AuthorizationScopes'])
        prior = indexed.get(name)
        if prior:
            a.require(all(prior.get(k) == v for k, v in expected.items()) and not prior.get('ApiKeyRequired')
                      and (expected['AuthorizationType'] != 'NONE' or not prior.get('AuthorizerId')), 'OWNER_ROUTE_CONFLICT')
            if 'AuthorizationScopes' not in expected:
                a.require(not prior.get('AuthorizationScopes'), 'OWNER_ROUTE_SCOPES_CHANGED')
        result.append((expected, prior))
    return result


def run(source, apply):
    a.require(re.fullmatch('[a-f0-9]{40}', source) is not None, 'SOURCE_INVALID')
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=a.ROOT, text=True).strip()
    a.require(head == source and not subprocess.check_output(['git', 'status', '--porcelain'], cwd=a.ROOT, text=True).strip(), 'CHECKOUT_CHANGED')
    identity = a.aws('sts', 'get-caller-identity')
    a.require(identity.get('Account') == '092954139775', 'OWN_SETUP_IDENTITY_REQUIRED')
    stage = a.aws('apigatewayv2', 'get-stage', '--api-id', API, '--stage-name', '$default')
    a.require(stage.get('AutoDeploy') is True, 'EXISTING_AUTODEPLOY_REQUIRED')
    items = a.aws('apigatewayv2', 'get-routes', '--api-id', API).get('Items', [])
    basis = next((r for r in items if r['RouteKey'] == 'GET /account'), {})
    a.require(basis.get('Target', '').startswith('integrations/') and basis.get('AuthorizerId'), 'EXISTING_OWNER_ROUTE_CHANGED')
    integration = a.aws('apigatewayv2', 'get-integration', '--api-id', API, '--integration-id', basis['Target'].split('/')[1])
    authorizer = a.aws('apigatewayv2', 'get-authorizer', '--api-id', API, '--authorizer-id', basis['AuthorizerId'])
    expected = expected_routes(items, integration, authorizer)
    folder = Path.home() / '.known-enough' / ('ops02-owner-routes-' + source)
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    a.require(folder.stat().st_mode & 0o777 == 0o700, 'PRIVATE_STATE_MODE_CHANGED')
    state_path = folder / 'state-private.json'
    state = json.loads(state_path.read_text()) if state_path.exists() else {'source': source, 'baseline': items, 'created': [], 'pending': None}
    a.require(state['source'] == source, 'SAVED_SOURCE_CHANGED')
    baseline = {r['RouteKey']: r for r in state['baseline'] if r['RouteKey'] not in ROUTES}
    a.require({r['RouteKey']: r for r in items if r['RouteKey'] not in ROUTES} == baseline, 'EXISTING_ROUTES_CHANGED')
    if state.get('pending'):
        wanted = state['pending']['RouteKey']
        observed = next((prior for planned, prior in expected if planned['RouteKey'] == wanted), None)
        a.require(observed is not None, 'ROUTE_CREATE_OUTCOME_UNKNOWN')
        state['created'].append(observed['RouteId'])
        state['pending'] = None
        a.save(state_path, state)
    if not apply:
        return {'result': 'LIFECYCLE_OWNER_ROUTES_REVIEW_READY', 'missing': sum(prior is None for _, prior in expected), 'dataChanges': 0}
    writes = 0
    for planned, prior in expected:
        if prior:
            continue
        # A new interrupted attempt never replaces its previous durable intent.
        state['pending'] = planned
        a.save(state_path, state)
        path = folder / 'route-input-private.json'
        a.save(path, {'ApiId': API, **planned})
        try:
            reply = a.aws('apigatewayv2', 'create-route', '--cli-input-json', 'file://' + str(path))
            writes += 1
        except a.RepairError:
            current = a.aws('apigatewayv2', 'get-routes', '--api-id', API).get('Items', [])
            checked = expected_routes(current, integration, authorizer)
            reply = next((row for value, row in checked if value['RouteKey'] == planned['RouteKey']), None)
            if reply is None:
                raise
        a.require(reply.get('RouteId') and all(reply.get(k) == v for k, v in planned.items()), 'ROUTE_READBACK_INVALID')
        state['created'].append(reply['RouteId'])
        state['pending'] = None
        a.save(state_path, state)
    current = a.aws('apigatewayv2', 'get-routes', '--api-id', API).get('Items', [])
    final = expected_routes(current, integration, authorizer)
    a.require(all(prior is not None for _, prior in final), 'OWNER_ROUTES_READBACK_FAILED')
    a.require({r['RouteKey']: r for r in current if r['RouteKey'] not in ROUTES} == baseline, 'EXISTING_ROUTES_CHANGED')
    return {'result': 'LIFECYCLE_OWNER_ROUTES_CONFIGURATION_PASS', 'routes': len(ROUTES), 'newRouteWrites': writes,
            'dataChanges': 0, 'deployedBehavior': 'NOT_EXECUTED'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        print(json.dumps(run(args.source, args.apply)))
    except (a.RepairError, subprocess.SubprocessError, ValueError, KeyError, OSError) as error:
        print(json.dumps({'result': 'BLOCKED', 'code': str(error) if isinstance(error, a.RepairError) else 'OWNER_ROUTE_SETUP_NOT_VERIFIED', 'dataChanges': 0}))
        raise SystemExit(1)
