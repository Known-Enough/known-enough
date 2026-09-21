# Deal Table · TeamTable

Local foundation and A01 UI: React/Vite shared and owner demo screens, separate mock adapters, strict runtime contracts and independent developer lanes. All people/data are fictional. **Mocked identities are not authentication. This checkout contains no backend implementation or deployed services. The user reports B01 complete and B02 in progress in B’s separate clone; that code and evidence have not been synchronized here.**

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

- `apps/web`: A's shared and lazy-loaded owner demo screens with separate adapters; public sample responses are in `src/mocks/public`. Browser owner examples are synthetic UI-only values, never imports from server fixtures.
- `packages/contracts`: runtime DTO/command/error validators and canonical public hashing; B owns after bootstrap, A reviews breaking changes.
- `apps/api`, `apps/workers`, `packages/domain`, `packages/application`, `packages/adapters`, `infra`: empty implementation boundaries reserved for B.
- `packages/test-support`: synthetic owner/command examples for tests/server only; never browser imports.
- `tests/e2e`, `tests/integration`: A's browser smoke checks and B's reserved integration area.
- `docs`: immutable source references, [contracts](docs/contracts.md), [decisions/risks](docs/decisions.md), [task files](docs/tasks), and [A](docs/handoff-A.md)/[B](docs/handoff-B.md) handoffs.

The foundation review was integrated on remote main at `ca9fb636974030bfd8a620cec2b3d8581b3c8114`. A01 is implemented on the legacy `task/a01` branch and awaits human acceptance. Future work uses **main in separate clones**, with no mandatory task branches; preserve existing work until authorized integration. B01 is user-reported complete and B02 in progress elsewhere. Do not mistake this checkout's empty backend folders for a request to redo B's work.

The [current task board](docs/task-board.md) and [workflow](docs/agent-workflow.md) govern execution and supersede dated branch/model/ownership/sequencing instructions in imported references. Product/security semantics remain unchanged. A02/A03/A06 preparation can proceed while B works; separate integration tickets retain real API/auth checks. B can take available A work through a recorded handoff when A lacks tokens.

## Starting a task

Choose a READY task from the board, select its named model and reasoning effort as the **direct worker**, and ask: “Read AGENTS.md and execute docs/tasks/A02.md within its scope.” Use your own clone and log the claim. Terra handles most implementation; Luna handles narrow UI/docs; Sol handles difficult backend work; Astra handles architecture and explicit checkpoints. No routine Astra manager or subagents are required. Files do not switch the selected session model.

See [A handoff](docs/handoff-A.md), [B handoff](docs/handoff-B.md), [A log](docs/work-log-A.md), [B log](docs/work-log-B.md) and [review records](docs/reviews/README.md). B02 keeps its active assignment. Sharing logs/code requires authorized synchronization; no cross-account access or live messaging is configured. Agent checks do not replace human acceptance or authorize pushing, integration, deployment or spending.
