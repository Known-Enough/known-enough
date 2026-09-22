# Deal Table · TeamTable

Main combines the A01 React/Vite mock UI, strict runtime contracts, B01’s deterministic solver, B02’s local application/in-memory repository, and the current parallel task workflow. All people/data are fictional. **Mock identities are not authentication. The UI still uses mocks; the local HTTP boundary and connected browser flow are next. No cloud services are deployed.**

## Setup and launch

Prerequisites: Node **24.21.0**, npm **11.19.0** (exact pins), network access for initial npm/browser installation. On Linux/WSL with nvm:

```sh
nvm install
nvm use
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. Stop with Ctrl+C. Windows users can install the pinned Node/npm directly and run the npm commands in the application folder. No Windows source paths, AWS account, API keys or environment variables are needed after import. A different Node/npm is rejected by engine-strict; change to the pinned runtime first. The root folder name need not match the app name.

## A01 local UI examples

The default page is the shared table. Follow **Open private owner demo** for a fixed fictional owner; it is not an identity switch or login. The personal screen loads separately and never changes the public mock result. Local form choices reset on navigation/reload.

- Shared examples: `/?public=collecting`, `blocked`, `private-review`, `proposed`, `agreed`, or `superseded`.
- Owner examples: `/?view=owner&owner=review`, `draft`, or `approval`.
- For either adapter, use `empty`, `failure`, or `stale` as its scenario value to inspect recovery states. Retry loads the default example; refreshing a stale example clears its stale marker. A short mock delay exposes loading feedback.

Exception permission, disclosure permission, and final acceptance remain separate. These mock screens exercise the interface only; client/forms preparation belongs to A02, with real command integration in A02.5/B02/B03.

## Solver demo

```sh
npm run demo --workspace @deal-table/test-support
```

This runs B01 independently of the browser: 12 structural candidates, zero feasible at baseline, two with the valid scoped exception; inconvenience selects B and balanced load selects A. B02 implements local application commands and stored membership checks using trusted synthetic principals; verified credential authentication is later work.

## Checks

```sh
npx playwright install chromium
# On minimal Linux, if system libraries are missing:
# npx playwright install --with-deps chromium
npm run check
```

`check` runs seven-reference integrity verification, the original 15-check arithmetic script, ESLint/import boundaries, TypeScript, unit/contract tests, production build/bundle marker check, and desktop/mobile Chromium smoke tests. Individual commands: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`, `npm run check:planning`, `npm run check:references`. Browser tests require an existing build and free port 4173. For a production preview: `npm run build` then `npm run preview --workspace @deal-table/web -- --port 4173`.

On a host unsupported by Playwright's bundled Chromium (such as macOS 12), an installed Google Chrome can be used explicitly: `PLAYWRIGHT_CHANNEL=chrome npm run check`. Record the actual browser/version with the results. CI continues to use pinned Playwright Chromium by default.

See the [dated bootstrap verification evidence](docs/verification.md). It records the original local run and is not a fresh result for the current checkout. CI is defined to run the same checks without cloud credentials. The arithmetic reference is not a production solver/security audit, and passing contract shapes does not prove authorization or race safety.

## Workspace and next work

- `apps/web`: shared and lazy-loaded owner demo screens with separate adapters; public sample responses are in `src/mocks/public`. Browser owner examples are synthetic UI-only values, never imports from server fixtures.
- `packages/contracts`: runtime DTO/command/error validators and canonical public hashing; shared-pool ownership with coordinated review of breaking changes.
- `packages/domain`: B01 structural enumeration, deterministic feasibility/ranking and domain tests.
- `packages/application`, `packages/adapters`: B02 command lifecycle, allowlisted snapshots, independent permissions and an isolated in-memory transaction repository.
- `apps/api`, `apps/workers`, `infra`: reserved HTTP/worker/cloud boundaries; no deployed service.
- `packages/test-support`: isolated synthetic domain fixtures and executable solver demo; server/test-only, never browser imports.
- `tests/e2e`, `tests/integration`: browser smoke checks and integration tests.
- `docs`: immutable source references, [contracts](docs/contracts.md), [decisions/risks](docs/decisions.md), [task files](docs/tasks), [local negotiation tutorial](docs/tutorials/local-negotiation.md), and [A](docs/handoff-A.md)/[B](docs/handoff-B.md) handoffs.

**Use main in separate clones for all new work.** A01, the workflow refactor, B01 and B02 are consolidated here at the user’s direction. The old task branches are historical pointers, not active work queues. See [main integration](docs/main-integration.md) for source commits, verification and publication state. Synchronize your separate clone before claiming the next task; do not continue work on the old task branches.

The [current task board](docs/task-board.md) and [workflow](docs/agent-workflow.md) govern execution and supersede dated branch/model/ownership/sequencing instructions in imported references. Product/security semantics remain unchanged. Both users select from one shared task pool; A/B task prefixes are historical identifiers, not user assignments. Existing claims remain protected. Separate integration tickets retain real API/auth checks. The AI facilitator extension is tracked in [T01](docs/tasks/T01.md) and [T02](docs/tasks/T02.md).

## Starting a task

Choose a READY task from the board, select its named model and reasoning effort as the **direct worker**, and ask: “Read AGENTS.md and execute docs/tasks/A02.md within its scope.” Use your own clone and log the claim. Terra handles most implementation; Luna handles narrow UI/docs; Sol handles difficult backend work; Astra handles architecture and explicit checkpoints. No routine Astra manager or subagents are required. Files do not switch the selected session model.

See [A handoff](docs/handoff-A.md), [B handoff](docs/handoff-B.md), [A log](docs/work-log-A.md), [B log](docs/work-log-B.md) and [review records](docs/reviews/README.md). Use ticket statuses and current shared claims to select work; completed or actively claimed tasks must not be restarted. Sharing logs/code requires authorized synchronization; no cross-account access or live messaging is configured. Agent checks do not replace human acceptance or authorize pushing, integration, deployment or spending.
