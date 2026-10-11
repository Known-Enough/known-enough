#!/usr/bin/env python3
"""One resumable fixed owner read permission and HTTP-route setup; never user data deletion."""
import argparse
import importlib.util
import json
from pathlib import Path
import subprocess

def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
access = load('lifecycle-owner-access')
routes = load('lifecycle-owner-routes')

def run(source, apply):
    result = access.run(source, apply)
    if result['result'] != 'LIFECYCLE_OWNER_READ_POLICY_PASS':
        return result
    outcome = routes.run(source, apply)
    if outcome['result'] == 'LIFECYCLE_OWNER_ROUTES_CONFIGURATION_PASS':
        return {'result': 'LIFECYCLE_OWNER_SETUP_CONFIGURATION_PASS', 'ownerReadPolicy': 'MATCH', 'ownerRoutes': 5,
                'dataChanges': 0, 'codePublication': 'NOT_EXECUTED', 'managedOwnerProof': 'NOT_EXECUTED'}
    return outcome

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        print(json.dumps(run(args.source, args.apply)))
    except (access.RepairError, routes.a.RepairError, subprocess.SubprocessError, ValueError, KeyError, OSError) as error:
        known = isinstance(error, (access.RepairError, routes.a.RepairError))
        print(json.dumps({'result': 'BLOCKED', 'code': str(error) if known else 'OWNER_SETUP_NOT_VERIFIED', 'dataChanges': 0}))
        raise SystemExit(1)
