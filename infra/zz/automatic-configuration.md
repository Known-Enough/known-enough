# Automatic application configuration

The existing database is not the blocker. The publishing roles deploy code and web assets, but the current release process left new API routes and the signup-confirmation connection to manual administrator scripts. ZZ02's backend is already published; its automatic intake/profile connections are not verified installed. Repeated CloudShell commands came from that incomplete release process.

The repaired normal release is: build/check source → assume the dedicated application-configuration role → verify the declared backend and existing authentication/integration → save a private backup → add missing declared connections and verify readback → assume the existing frontend role → publish → save sanitized reports. Matching configuration is a no-write repeat. Both A and B can use their own GitHub account; no AWS login or shared credentials for these normal releases. The existing push deployment and manual full frontend publication share one concurrency lock and both run this step. The isolated entry-only publication deliberately keeps its original narrow scope.

## One installation

An existing account administrator installs `KnownEnoughGithubApplicationConfig` and its identical permissions boundary once. This changes only that new role and boundary, not application data or existing roles. GitHub cannot grant itself the access that is presently missing. A's local administrator sessions have expired; installation requires a working own administrator session, such as CloudShell. This is an access installation, not another feature-specific route/hook command.

From a clean checkout of the exact published source, run:

```bash
python3 -B scripts/zz/install-application-config.test.py
python3 -B scripts/zz/post-confirmation-setup.test.py
python3 -B scripts/zz/install-application-config.py --source "$(git rev-parse HEAD)"
python3 -B scripts/zz/install-application-config.py --source "$(git rev-parse HEAD)" --apply
```

Expected final result: `APPLICATION_CONFIG_ROLE_READBACK_PASS`. The installer defaults to inspection, preserves a private prior-state file in the home directory, rejects foreign trust/policies/boundaries, and resumes an owned partial installation with the same pinned command. It never replaces a conflicting resource or modifies other roles. Return only the sanitized JSON result. This result verifies installation, not GitHub's actual ability to use it or signup delivery.

Next, A or B launches the existing full `ZZ primary frontend publication` workflow on the exact checked main SHA with `entry_only=false`. It installs/verifies missing application configuration itself before publishing the prepared dashboard. Future matching web pushes use the existing staging workflow automatically; unchanged connections need no administrator commands. Failure in setup stops publication and uploads the sanitized setup report. The existing staging workflow still feeds its existing automatic QA workflow; a report of configuration PASS does not substitute for live journeys.

## Scope and maintenance

[The manifest](application-config.json) records the expected published backend, exact existing targets and desired routes. Add future routes to this manifest with the matching backend implementation/checks, rather than creating another manual CloudShell installation. All non-OPTIONS routes inherit verified participant JWT authorization; OPTIONS uses the same integration without JWT. Existing conflicting routes or a foreign confirmation hook stop reconciliation. A future backend publication must update the manifest to its verified package hash/source before publishing a frontend that depends on it. The full API/worker coordination, disabled model controls, source anchors and task sequencing remain in their existing release workflows.

[The policy](github-application-config-policy.json) allows only existing primary pool configuration, metadata from the primary API/function, creation of routes on that API, a Cognito invocation permission on that function and private configuration backups under one existing artifact-bucket prefix. [The trust](github-application-config-trust.json) permits the project's exact main OIDC subject; workflows accept A/B actor IDs. The role has no IAM, data-table, provider-model invocation, user creation/admission or code-upload authority. Existing publishing/testing roles retain their roles.

IAM can scope `UpdateUserPool` to this pool, but cannot limit it to the PostConfirmation field. The implementation preserves the complete updateable configuration and unrelated hooks, with fresh comparison/readback. `lambda:Principal` restricts AddPermission to Cognito; the script additionally fixes the pool source/account. API permissions cannot select a route by its future route ID before creation; the policy scopes the creation collection to this single API and authentication types. These are actual permission limits, not claims of field-level IAM enforcement.

Private snapshots contain existing configuration, including sensitive function settings, and are never included in GitHub artifacts or the public build. CI verifies the private S3 backup before application writes; a fully matching no-write run needs no new backup. The role can read/write only that backup prefix. Public artifacts contain hashes/counts/results, not snapshot content, credentials or profile data.

This package automates these existing application's onboarding/profile/route connections. It is not a general AWS administrator or a replacement for configuring a genuinely new service outside its installed scope. No new database, account approval, model activation, email budget or participant permission is introduced by installing it. Required live signup/profile proof and other MVP gaps remain explicit in the [ZZ02 ticket](../../docs/tasks/active/zz/ZZ02/ticket.md).

AWS references: [API Gateway route permissions](https://docs.aws.amazon.com/service-authorization/latest/reference/list_apigatewayv2.html), [Lambda principal condition](https://docs.aws.amazon.com/lambda/latest/dg/lambda-api-permissions-ref.html), [full Cognito update preservation](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_UpdateUserPool.html).
