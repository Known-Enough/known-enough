#!/usr/bin/env python3
"""Focused guards for the profile API release helper."""
from __future__ import annotations

import base64
import contextlib
import hashlib
import importlib.util
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).with_name('profile-api-release.py')
SPEC = importlib.util.spec_from_file_location('profile_api_release', SCRIPT)
release = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(release)


class ProfileApiReleaseTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.archive = self.root / 'ke13b-lambda.zip'
        self.new_bytes = b'checked profile api package'
        self.old_bytes = b'previous deployed api package'
        self.archive.write_bytes(self.new_bytes)
        old_code = base64.b64encode(hashlib.sha256(self.old_bytes).digest()).decode()
        self.prior = {'FunctionArn': release.FUNCTION_ARN, 'State': 'Active', 'LastUpdateStatus': 'Successful',
                      'Runtime': 'nodejs24.x', 'Handler': 'ke13b-lambda.handler', 'Role': release.ROLE_ARN,
                      'GroupsEnabled': 'true',
                      'RevisionId': 'revision-old', 'CodeSha256': old_code}
        self.final = {**self.prior, 'RevisionId': 'revision-new',
                      'CodeSha256': base64.b64encode(hashlib.sha256(self.new_bytes).digest()).decode()}
        self.route_map = {
            release.GROUP_ROUTE: {'RouteKey': release.GROUP_ROUTE, 'AuthorizationType': 'JWT',
                                  'AuthorizerId': 'existing-jwt', 'AuthorizationScopes': ['groups:read'],
                                  'Target': 'integrations/existing'},
            release.GROUP_OPTIONS: {'RouteKey': release.GROUP_OPTIONS, 'AuthorizationType': 'NONE',
                                    'Target': 'integrations/existing'},
        }
        self.writes: list[list[str]] = []
        self.created: list[tuple[str, str, str, str | None, list[str] | None]] = []

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_publish_binds_routes_to_existing_jwt_integration_and_lambda_revision(self) -> None:
        def read_routes() -> dict:
            return self.route_map

        def create_route(key: str, auth: str, target: str, authorizer: str | None = None,
                         scopes: list[str] | None = None) -> str:
            self.created.append((key, auth, target, authorizer, scopes))
            route_id = f'created-{len(self.created)}'
            self.route_map[key] = {'RouteId': route_id, 'RouteKey': key, 'AuthorizationType': auth,
                                   'Target': target, **({'AuthorizerId': authorizer, 'AuthorizationScopes': scopes or []}
                                                        if authorizer else {})}
            return route_id

        def run_command(args: list[str], *, capture: bool = True) -> str:
            self.writes.append(args)
            return ''

        def save_prior(config: dict, destination: Path) -> bytes:
            destination.write_bytes(self.old_bytes)
            return self.old_bytes

        def read_aws(*args: str) -> dict:
            if 'get-authorizer' in args:
                return {'AuthorizerType': 'JWT', 'JwtConfiguration': {'Issuer': release.AUTHORIZER_ISSUER,
                        'Audience': sorted(release.AUTHORIZER_AUDIENCES)}}
            return {'AutoDeploy': True}

        with patch.dict(os.environ, {'EXPECTED_SOURCE': 'a' * 40, 'RUNNER_TEMP': str(self.root)}), \
             patch.object(release, 'expected_source', return_value='a' * 40), \
             patch.object(release, 'work_dir', return_value=self.root), \
             patch.object(release, 'lambda_config', side_effect=[self.prior, self.final]), \
             patch.object(release, 'routes', side_effect=read_routes), \
             patch.object(release, 'integration_exists', return_value=True), \
             patch.object(release, 'aws_json', side_effect=read_aws), \
             patch.object(release, 'current_lambda_archive', side_effect=save_prior), \
             patch.object(release, 'run', side_effect=run_command), \
             patch.object(release, 'wait_config', return_value=self.final), \
             patch.object(release, 'create_route', side_effect=create_route), \
             contextlib.redirect_stdout(io.StringIO()):
            release.publish()

        update = next(args for args in self.writes if args[:3] == ['aws', 'lambda', 'update-function-code'])
        self.assertIn('--revision-id', update)
        self.assertIn('revision-old', update)
        self.assertEqual([item[:2] for item in self.created], [
            (release.PROFILE_ROUTE, 'JWT'), (release.OPTIONS_ROUTE, 'NONE')])
        self.assertEqual(self.created[0][2:], ('integrations/existing', 'existing-jwt', ['groups:read']))
        self.assertEqual(self.created[1][2:], ('integrations/existing', None, None))
        self.assertFalse(any('update-function-configuration' in arg or 'invoke' in arg for call in self.writes for arg in call))
        report = json.loads((self.root / 'zz-profile-api-release.json').read_text())
        self.assertEqual(report['authenticatedProfileRoute'], 'VERIFIED')
        self.assertEqual(report['configurationWrites'], 0)
        self.assertEqual(report['dataWrites'], 0)

    def test_rejects_unprotected_existing_group_route_before_any_write(self) -> None:
        self.route_map[release.GROUP_ROUTE]['AuthorizationType'] = 'NONE'
        with patch.dict(os.environ, {'EXPECTED_SOURCE': 'a' * 40, 'RUNNER_TEMP': str(self.root)}), \
             patch.object(release, 'expected_source', return_value='a' * 40), \
             patch.object(release, 'work_dir', return_value=self.root), \
             patch.object(release, 'lambda_config', return_value=self.prior), \
             patch.object(release, 'routes', return_value=self.route_map), \
             patch.object(release, 'run') as command:
            with self.assertRaisesRegex(release.ReleaseError, 'GROUP_JWT_ROUTE_MISSING'):
                release.publish()
        command.assert_not_called()

    def test_rejects_profile_route_with_weaker_authorization(self) -> None:
        routes = {release.PROFILE_ROUTE: {'RouteKey': release.PROFILE_ROUTE, 'AuthorizationType': 'NONE',
                                          'Target': 'integrations/existing'}}
        with self.assertRaisesRegex(release.ReleaseError, 'EXISTING_PROFILE_ROUTE_MISMATCH'):
            release.route_readback(routes, release.PROFILE_ROUTE, auth='JWT', target='integrations/existing',
                                   authorizer='existing-jwt', scopes=['groups:read'])

    def test_lambda_archives_are_stable_across_build_times(self) -> None:
        source = self.root / 'bundle.mjs'
        source.write_bytes(b'fixed bundle content')
        one, two = self.root / 'one.zip', self.root / 'two.zip'
        release.write_archive(source, one)
        release.write_archive(source, two)
        self.assertEqual(hashlib.sha256(one.read_bytes()).digest(), hashlib.sha256(two.read_bytes()).digest())
        with __import__('zipfile').ZipFile(one) as zipped:
            self.assertEqual(zipped.namelist(), ['ke13b-lambda.mjs'])
            self.assertEqual(zipped.read('ke13b-lambda.mjs'), source.read_bytes())


if __name__ == '__main__':
    unittest.main()
