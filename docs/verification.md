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
