# Bootstrap verification — September 19, 2026

Executed in `/home/martelaxe/known-enough` on Linux/WSL, Node 24.21.0 and npm 11.19.0. All seven source files were accessible and source/destination bytes matched immediately after copying. A portable SHA-256 manifest is saved as a reviewable file; the repository has no commit yet.

`npm run check` exited 0 at approximately 20:16 UTC:

| Check | Actual result |
| --- | --- |
| Imported reference integrity | 7/7 SHA-256 checks matched |
| Original planning arithmetic | 15/15 passed; 12 structural / zero baseline / two scoped plans; ranking and invalid-grant arithmetic |
| ESLint + dependency/import boundary scan | Passed; 10 source import references checked |
| TypeScript strict typecheck | Passed |
| Vitest unit/contract suite | 49/49 passed in 2 files |
| Vite production build | Passed; 114 modules; JS 317.92 kB / gzip 96.85 kB; CSS 2.18 kB |
| Built-asset private fixture marker scan | Passed |
| Playwright Chromium built-app smoke tests | 2/2 passed, widths 390 and 1280; title/roster/slots/duties/timezone/mock labels, no horizontal overflow, no page exceptions or external requests |

Contract tests cover all 12 command variants, strict/nested private-field rejection, owner/public shape separation, finite full-interval validation, all error/status mappings, known SHA-256 vector, set/object-order stability and context/policy/version/duration/assignment hash changes. They do not execute backend authorization, idempotency, solver or state transitions.

Initial issues resolved: missing Vite CSS-import type declaration; bundle marker false positive from the legitimate `confirmedAt` schema key. The final scanner searches seeded private values/paths, not allowed owner-schema field names. Schemas themselves contain no fixture values. Tests do not establish inference resistance.

A clean `npm ci` also passed (149 packages installed, 158 audited), reporting zero known vulnerabilities. `npm run dev` started Vite on 127.0.0.1:5173 and an HTTP request returned the expected app HTML. The verification server was then stopped. Chromium was installed successfully; no AWS credentials were used. Color-environment warnings in Playwright output were non-failing. Remote GitHub CI has not run. Git status contains new bootstrap files only; no pre-existing work, remote, commit, publish or cloud deployment.

F00–F02 status: REVIEW, implementation and local checks complete, human review/integration pending. A01 and B01 begin after the shared baseline is accepted. Backend authentication, solver, atomic agreement, grant expiry, real persistence and cloud integration remain unimplemented and untested.

## Foundation review verification — September 19, 2026 local

Fresh run in `/home/battousai/projects/known-enough`, on `task/foundation-review`, against the local review diff based on commit `972386395618ec0ed81581d38082ebeb15d66142`. The original section above records historical bootstrap evidence from another checkout; it is not the current repository state. No new commit, push, merge, cloud deployment or paid resource was created in this execution.

Coordinating lead: Astra. Task agents F00/F01/F02 used `gpt-5.6-sol` with high reasoning. Independent Sol reviews covered contracts/tooling; the latter reported findings then hit a usage limit. The bounded F01 follow-up used `gpt-6-astra` with high reasoning. Actual assignments, findings, retries and review limits are in [task-execution.md](task-execution.md).

The runtime was absent from this shell. Downloaded the exact Node 24.21.0 archive under `/tmp/deal-table-runtime`, matched its published SHA-256, and confirmed bundled npm 11.19.0. `npm ci` passed using the unchanged lockfile: 149 packages installed, 158 audited, zero reported vulnerabilities. Chromium 153.0.8010.12 (Playwright build 1243) was downloaded under /tmp. System library installation could not run without an interactive sudo password; 16 Ubuntu library/font packages were instead downloaded and extracted under /tmp, with no system package installation. Cached update URLs for libgbm1/libnss3 returned 404, so available Ubuntu base-release packages were used only in this isolated local test runtime.

Initial verification attempts exposed sandbox DNS/preview-port restrictions and then missing browser libraries; these were environment failures, not passing browser results. Approved network and local-server commands plus the isolated runtime resolved them. Final command:

```sh
PATH=/tmp/deal-table-runtime/node-v24.21.0-linux-x64/bin:$PATH \
PLAYWRIGHT_BROWSERS_PATH=/tmp/deal-table-runtime/playwright \
LD_LIBRARY_PATH=/tmp/deal-table-runtime/browser-libs/usr/lib/x86_64-linux-gnu \
FONTCONFIG_FILE=/tmp/deal-table-runtime/fonts.conf \
npm run check
```

Final exit status: **0**, approximately 2026-09-20 01:52 UTC / September 19 19:52 America/Mexico_City.

| Check | Fresh result |
| --- | --- |
| Immutable reference SHA-256 | 7/7 matched; no imported bytes changed |
| Planning arithmetic | 15/15 passed |
| ESLint and boundary scan | Passed; 10 source import references |
| TypeScript | Passed |
| Vitest | 66/66 tests passed across 3 files, including 14 tooling regressions |
| Production build and bundle marker scan | Passed; 114 modules, JS 318.19 kB / gzip 96.91 kB |
| Chromium desktop/mobile smoke tests | 2/2 passed, widths 1280 and 390 |
| Additional portability check | Sol verified all 7 hashes in a temporary `core.autocrlf=true` checkout with the new attributes |
| Assignment consistency | All 18 task models match the execution table and exposed model identifiers |

The contract fix rejects revision commands claiming prior submissions or qualifications outside their supplied roster. The tooling fixes preserve exact imported line endings and enforce allowed, declared server workspace imports while keeping test fixtures out of browser/production code. Passing these checks does not establish backend identity, transactional consent, cloud behavior or inference resistance. F00–F02 remain REVIEW for human acceptance; A01/B01 implementation has not started.

## B01 verification — September 20, 2026

The foundation was subsequently committed/integrated to main as `ca9fb636974030bfd8a620cec2b3d8581b3c8114` at the user's request. The user then authorized B01. This run verifies B01's local `task/b01` diff against that accepted baseline; previous sections above describe their historical task state.

The assigned `gpt-5.6-sol` agent wrote the initial implementation, then reached its usage limit. The coordinating lead reported this limitation and, after the user resumed work, explicitly escalated completion to `gpt-6-astra`. A separate `gpt-6-astra` reviewer resumed and independently checked the final source/tests, ran 64 focused tests and six additional assertions, and found no remaining supported actionable issues. Initial review findings included hard-condition precedence, meeting/duty double booking, reviewed-coverage gaps and shared fixture objects; the final tests cover the corrected behavior.

The coordinator ran `npm run check` with the exact Node 24.21.0/npm 11.19.0 and isolated Chromium/library environment documented above. The temporary environment was restored for this task. Final exit status **0** at approximately 2026-09-20 19:24 UTC / 13:24 America/Mexico_City.

| Check | Actual result |
| --- | --- |
| Imported reference SHA-256 | 7/7 unchanged |
| Planning arithmetic | 15/15 passed |
| ESLint/import boundaries | Passed, 23 import references |
| TypeScript | Passed |
| Full Vitest suite | 116/116 in five files: 49 domain, 51 contracts, 14 tooling, one fixture-isolation, one web-adapter test |
| Production build/bundle marker scan | Passed, 114 modules; browser bundle unchanged from the accepted foundation |
| Chromium browser smoke | 2/2 passed at 390/1280px |
| Production solver demo | Both policies: 12 structural candidates, NO_AGREEMENT at baseline, two feasible after the scoped exception; inconvenience selects B, balanced load selects A |
| Working diff whitespace | git diff --check passed |

The executable demo is `npm run demo --workspace @deal-table/test-support`. Focused tests are `npm test -- packages/domain packages/test-support`. Tests independently check exact assignments and ranking vectors, hard impossibility, zero-concession success, expiry/status/scope failures, 60-minute clarification, full meeting/duty coverage, gaps, deterministic ties/order, nonmutation and disclosure independence. Fixture copies prevent a schedule edit from silently changing a grant or another owner's input.

No wire contract changes. The internal owner `availabilityReview` binds explicitly confirmed coverage to the current context/input revision; B02 must obtain it from authoritative confirmation, never infer it from the entire schedule. Root coordination added only existing workspace dependencies to the lockfile and `allowImportingTsExtensions` to the existing noEmit TypeScript configuration for the direct Node demo. No external dependencies, runtime cloud resources or browser solver imports were added.

The named implementation diff is `/tmp/b01-ca9fb63-review.patch` against the accepted baseline, SHA-256 `f2b354c277db77e140df7fc867691eda021c3f74eb2bc34a87bdf02f26e42bcb`. It includes source, tests, package docs/manifests and coordinated lock/TypeScript changes, including untracked files. No B01 commit, push or merge was performed. B01 remains REVIEW for human acceptance. These checks do not establish B02 authorization/projections/state transitions, DynamoDB race safety or cloud/auth behavior.

## B02 verification — September 20, 2026

B02 is local on `task/b02`, based on B01 commit `04c87d761d13f29643e287392e520ca38af940d0`. The user authorized this task after B01 was committed. Earlier sections retain their historical status.

Final integrated `npm run check` exited 0 at approximately 22:43 UTC using pinned Node 24.21.0/npm 11.19.0. The runtime, Chromium, fonts and required Linux libraries were reused from the isolated `/tmp/deal-table-runtime` setup documented above. The browser preview required an approved sandbox escalation to bind localhost.

- Seven imported reference checksums unchanged; all 15 original arithmetic checks passed.
- ESLint and import/dependency boundaries passed (32 references).
- TypeScript passed. The first completion check found two readonly-array type errors in new tests; the coordinator corrected those before this final successful run.
- 144 tests passed in seven files: 53 contracts, 49 domain, 11 application/transaction, 15 integration, 14 import-boundary, one fixture and one web mock test.
- Production build passed: 114 modules, JavaScript 318.57 kB (97.00 kB gzip); browser bundle marker check passed.
- Both existing Chromium smoke tests passed at 390px and 1280px. These verify the public scaffold, not a connected B02 browser flow.

The integration suite uses real application methods, the in-memory repository and the deterministic solver. It exercises explicit owner confirmations, the private exception round, independent disclosure refusal, exact three-person approval, owner/display/organizer scopes, removed membership before replay, same-key changed-body conflicts including rejected commands, publication audiences, retained receipts, expiry, duration invalidation, stale jobs, both finalization/revocation orderings and closed rooms. Focused application tests add no-concession success, hard/uninvited impossibility, unknown coverage, offer substitution, policy reconfirmation, duplicate/pre-start stale jobs, expiry across asynchronous hashing and repository rollback/isolation.

Named implementation artifact: `/tmp/b02-04c87d7-review.patch`, 104,937 bytes, SHA-256 `eca0b98c448696642ef48e8093e86507e92c600e12f7d9845e139903a56f1c4a`; per-file hashes in `/tmp/b02-04c87d7-review-files.json`. It covers 19 implementation, contract, test, package-documentation and coordinated configuration files against B01, including new files. Final task/verification/handoff records are excluded to avoid self-referential evidence.

Required CONFIRM_INPUTS.reviewedIntervals and OwnerSnapshot.availabilityReview extend the pre-release v1 owner/command contract; public DTOs and B01 ConfirmedInputs are unchanged. Current web consumers use only public snapshots. Human A compatibility review remains required. Root coordination registered integration discovery and existing workspace dependencies in the lockfile; no external dependencies were introduced.

The assigned Astra implementation agent reached its usage limit after writing the code/tests. The coordinator retained its work, completed documentation and test type corrections, then ran the full check. The separate Astra reviewer identified organizer disclosure outside its approved audience and failure-result replay inconsistency; both were corrected with regressions. Final independent Astra review found no remaining actionable findings in the named diff, verified its base/size/SHA and all 19 per-file hashes, passed the reverse patch check, and independently ran 79 focused tests across three files.

B02 remains REVIEW. No B02 commit, push, merge, HTTP server, Cognito authentication, DynamoDB verification, AWS deployment or paid resource was performed. Synthetic trusted principals are not authentication; in-memory serialization is not proof of distributed/cloud transaction safety. The browser remains the public mock until A02/B03 integration.

## B03 verification — September 21, 2026

User authorized local B03 from committed B02 `47b97eb`, on `task/b03`. B02's prior human review status is not rewritten by this implementation. Lead: GPT-6 Astra; implementation: GPT-5.6 Terra; independent read-only authorization review: GPT-5.6 Sol.

Final integrated `npm run check` exited 0 at approximately 17:45 UTC. Runtime: Node 24.21.0/npm 11.19.0 under `/tmp/node-v24.21.0-linux-x64`; Node archive matched the official SHA-256 manifest. Installed Playwright Chromium under `/tmp/b03-playwright`; missing Linux libraries were downloaded/unpacked under `/tmp/b03-browser-libs`, with no system package installation. Local socket tests and browser preview required sandbox escalation. Full output: `/tmp/b03-check.log`.

- Seven immutable reference hashes and 15 arithmetic checks passed.
- ESLint/import boundaries passed (40 references), TypeScript passed.
- 156 tests in eight files passed, including 12 new real HTTP integration tests.
- Build passed (114 modules, JavaScript 318.57 kB / 97.00 kB gzip); private fixture marker scan passed.
- Two existing Chromium scaffold smoke tests passed at 390px/1280px. They do not claim connected A02/G01 browser behavior.
- Terra separately started `npm run start --workspace @deal-table/api` on loopback port 8787, then stopped it. Startup uses Node's transform-types flag for the existing application's parameter properties.

HTTP integration tests cover every documented error code/status, missing/unknown identities, malformed JSON/schema/body-room mismatch, oversized input and wrong media type, owner substitution, missing/cross-room/other-owner nonenumeration, display writes (including malformed bodies), organizer/service escalation, current authorization before replay, changed-body idempotency, local CORS/no-store headers, production startup rejection, and full solver negotiation through HTTP with disclosure refusal, three exact approvals and duration invalidation. A configuration regression verifies that mutating the caller's identity map or principal after startup cannot change the private server mapping or add an HTTP service identity.

Initial review/checks found and corrected a missing default request cap, display validation ordering, Node startup flag, type errors and use of the asset-boundary checker’s restricted URL constructor. The HTTP parser uses URL.parse. Sol identified the mutable caller identity map; the implementation now reconstructs allowlisted principals into a private map. Only the runnable entry/listenLocalApi enforce loopback binding; the unbound server factory is a trusted composition API.

Named seven-file implementation artifact (including new source/tests): `/tmp/b03-47b97eb-review.patch`, 33,169 bytes, SHA-256 `f7546bcbe467dbe3a6c19c897fcbf4a3e3ccf129973ad50c1df5e9e9b751dcc2`; per-file hashes: `/tmp/b03-review-files.json`. Mutable task/handoff/evidence records are excluded to avoid self-reference. No wire contract changes. The only root-owned change is the coordinated lock entry for three existing workspace dependencies.

B03 remains REVIEW pending human acceptance/integration. Test identities are not authentication; in-memory operations do not establish DynamoDB safety. No cloud, Cognito, external participant trial, publishing, commit, push, merge, deployment or spending was performed. G01 requires A02's connected UI as well as B03.

Final independent Sol review examined the exact named patch, verified all seven file hashes and reverse patch applicability, and reported no remaining actionable authorization/privacy findings. Sol confirmed the identity-map correction and regression; it reviewed the lead's full-check evidence without rerunning the suite independently. Agent review does not replace human acceptance.
