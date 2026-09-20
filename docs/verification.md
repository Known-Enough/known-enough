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

## A01 verification — September 20, 2026

Executed on `task/a01`, based on foundation review commit `ca9fb636974030bfd8a620cec2b3d8581b3c8114`, in the macOS 12.7.6 checkout. Lead: Astra; UI implementation agent: `gpt-5.6-terra` with high reasoning. Astra independently reviewed browser data separation, stale controls and consent presentation, wrote the browser checks and integrated fixes. Contracts, backend packages, dependencies, lockfile and immutable references are unchanged.

Installed the exact Node 24.21.0/npm 11.19.0 runtime with nvm; download checksum matched. `npm ci` passed (150 packages installed, 159 audited, zero reported vulnerabilities). Playwright's pinned Chromium installation explicitly failed because macOS 12 is unsupported. The supported local test path uses the already installed Google Chrome **150.0.7871.125**, with `PLAYWRIGHT_CHANNEL=chrome`. This option uses one worker to reduce startup pressure; CI's default pinned Chromium configuration is unchanged.

Initial integrated verification passed all non-browser stages, then had four Chrome startup timeouts and one nondeterministic loading assertion (12/17 browser tests passed). The loading test now pauses Playwright's clock before navigation. A strict TypeScript error in the optional worker configuration was corrected with a conditional property. The subsequent focused typecheck/build/browser run exited 0, with all **17/17 browser tests passing**.

Browser coverage includes public/owner loading, empty, failure/retry, stale/refresh; disabled stale owner controls; local draft retention; independent exception/disclosure feedback; unavailable acceptance without an exact proposal; shared proposal/approval/superseded snapshots; keyboard navigation; mobile/desktop layouts at 390/1280px; no owner chunk request on the shared page; and no external requests or page exceptions in the shared smoke checks. Screenshot artifacts are produced under ignored `test-results/`; Astra visually inspected shared mobile and owner desktop/mobile captures.

These are synthetic UI checks, not authentication, authorization, solver, expiry, transaction, real HTTP or cloud tests. No server fixture is imported by browser code; browser owner demo values remain downloadable synthetic examples, not a security boundary. A01 stays REVIEW pending human acceptance. A02 still requires B02/B03 for real behavior.

Final integrated command:

```sh
PATH=/Users/martelaxe/.nvm/versions/node/v24.21.0/bin:$PATH \
PLAYWRIGHT_CHANNEL=chrome npm run check
```

Final exit status: **0**. All 7 reference hashes, 15 planning checks, ESLint/import boundaries (22 references), strict typecheck, **70/70 unit tests across 4 files**, production build/private marker scan, and **17/17 browser tests** passed. The final browser phase completed in 46.9 seconds. Build: 123 modules; public entry 332.46 kB (99.38 kB gzip), separate owner chunk 10.69 kB (3.71 kB gzip). `git diff --check` also passed. Remote CI and bundled Chromium on a supported host were not run in this session.
