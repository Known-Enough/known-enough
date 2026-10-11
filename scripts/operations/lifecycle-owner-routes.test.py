import copy
import importlib.util
from pathlib import Path
import unittest
spec = importlib.util.spec_from_file_location('routes', Path(__file__).with_name('lifecycle-owner-routes.py'))
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
BASIS = {'RouteKey': 'GET /account', 'RouteId': 'existing', 'Target': 'integrations/known', 'AuthorizationType': 'JWT', 'AuthorizerId': 'auth'}
INTEGRATION = {'IntegrationType': 'AWS_PROXY', 'IntegrationId': 'known', 'IntegrationUri': r.FUNCTION}
AUTH = {'AuthorizerId': 'auth', 'AuthorizerType': 'JWT', 'IdentitySource': ['$request.header.Authorization'], 'JwtConfiguration': {'Issuer': 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_V9OMjd0zx'}}
class RouteTests(unittest.TestCase):
    def test_only_fixed_three_owner_operations_and_options_use_existing_jwt_target(self):
        planned = r.expected_routes([BASIS], INTEGRATION, AUTH)
        self.assertEqual(len(planned), 5)
        for expected, prior in planned:
            self.assertIsNone(prior)
            self.assertEqual(expected['Target'], BASIS['Target'])
            self.assertEqual(expected['AuthorizationType'], 'NONE' if expected['RouteKey'].startswith('OPTIONS ') else 'JWT')
            if not expected['RouteKey'].startswith('OPTIONS '): self.assertEqual(expected['AuthorizerId'], 'auth')
    def test_foreign_function_pool_or_duplicate_existing_route_is_rejected(self):
        for integration, auth, items in [(dict(INTEGRATION, IntegrationUri='arn:other'), AUTH, [BASIS]), (INTEGRATION, dict(AUTH, JwtConfiguration={'Issuer': 'https://foreign.invalid'}), [BASIS]), (INTEGRATION, AUTH, [BASIS, BASIS])]:
            with self.assertRaises(r.a.RepairError): r.expected_routes(items, integration, auth)
    def test_existing_matching_routes_are_reusable_but_insecure_or_scope_changed_ones_are_not(self):
        expected = r.expected_routes([BASIS], INTEGRATION, AUTH)[0][0]
        row = dict(expected, RouteId='owned')
        self.assertIsNotNone(r.expected_routes([BASIS, row], INTEGRATION, AUTH)[0][1])
        for patch in [{'AuthorizationType': 'NONE'}, {'AuthorizationScopes': ['foreign']}, {'Target': 'integrations/foreign'}]:
            with self.assertRaises(r.a.RepairError): r.expected_routes([BASIS, dict(row, **patch)], INTEGRATION, AUTH)
    def test_preexisting_read_scopes_are_preserved_for_every_new_authenticated_operation(self):
        planned = r.expected_routes([dict(BASIS, AuthorizationScopes=['openid'])], INTEGRATION, AUTH)
        for expected, _ in planned:
            if expected['AuthorizationType'] == 'JWT': self.assertEqual(expected['AuthorizationScopes'], ['openid'])

# Execution recovery uses persistent home state and exact configuration readback.
import json
import tempfile
from unittest.mock import patch

class ExecutionTests(unittest.TestCase):
    def scenario(self, folder, lost=False):
        state = {'items': [copy.deepcopy(BASIS)], 'creates': 0, 'lossUsed': False}
        source = 'a' * 40
        def git(args, **kwargs): return source + '\n' if args[1] == 'rev-parse' else ''
        def aws(service, operation, *args):
            if operation == 'get-caller-identity': return {'Account': '092954139775'}
            if operation == 'get-stage': return {'AutoDeploy': True}
            if operation == 'get-routes': return {'Items': copy.deepcopy(state['items'])}
            if operation == 'get-integration': return INTEGRATION
            if operation == 'get-authorizer': return AUTH
            if operation == 'create-route':
                content = json.loads(Path(args[args.index('--cli-input-json') + 1][7:]).read_text())
                content.pop('ApiId'); content['RouteId'] = 'created-' + str(state['creates'])
                state['creates'] += 1; state['items'].append(content)
                if lost and not state['lossUsed']:
                    state['lossUsed'] = True; raise r.a.RepairError('LOST_ACK')
                return copy.deepcopy(content)
            self.fail(operation)
        return source, state, git, aws
    def test_install_repeat_and_lost_ack_do_not_duplicate_or_alter_existing_route(self):
        for lost in [False, True]:
            with self.subTest(lost=lost), tempfile.TemporaryDirectory() as folder:
                home = Path(folder); source, state, git, aws = self.scenario(home, lost)
                with patch.object(Path, 'home', return_value=home), patch.object(r.subprocess, 'check_output', side_effect=git), patch.object(r.a, 'aws', side_effect=aws):
                    self.assertEqual(r.run(source, True)['result'], 'LIFECYCLE_OWNER_ROUTES_CONFIGURATION_PASS')
                    self.assertEqual(r.run(source, True)['newRouteWrites'], 0)
                self.assertEqual(state['creates'], 5); self.assertEqual(state['items'][0], BASIS)
    def test_an_unresolved_saved_create_intent_cannot_be_reissued(self):
        with tempfile.TemporaryDirectory() as folder:
            home = Path(folder); source, state, git, aws = self.scenario(home)
            saved = home / '.known-enough' / ('ops02-owner-routes-' + source); saved.mkdir(parents=True, mode=0o700)
            (saved / 'state-private.json').write_text(json.dumps({'source': source, 'baseline': [BASIS], 'created': [], 'pending': {'RouteKey': r.ROUTES[0]}}))
            with patch.object(Path, 'home', return_value=home), patch.object(r.subprocess, 'check_output', side_effect=git), patch.object(r.a, 'aws', side_effect=aws):
                with self.assertRaisesRegex(r.a.RepairError, 'ROUTE_CREATE_OUTCOME_UNKNOWN'): r.run(source, True)
            self.assertEqual(state['creates'], 0)

if __name__ == '__main__': unittest.main()
