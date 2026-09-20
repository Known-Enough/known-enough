# Deal Table · TeamTable

Local foundation and A01 UI: React/Vite shared and owner demo screens, separate mock adapters, strict runtime contracts and independent developer lanes. All people/data are fictional. **Mocked identities are not authentication. No solver, backend, Alexa integration or cloud services are implemented/deployed.**

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

Exception permission, disclosure permission, and final acceptance remain separate. These mock screens exercise the interface only; real command handling belongs to A02/B02/B03.

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
- `docs`: immutable source references, [contracts](docs/contracts.md), [decisions/risks](docs/decisions.md), 18 [task files](docs/tasks), and [A](docs/handoff-A.md)/[B](docs/handoff-B.md) handoffs.

The foundation review is integrated on remote `main` at `ca9fb636974030bfd8a620cec2b3d8581b3c8114`. The user authorized **A01** on September 20; its work is on `task/a01`. **B01** remains B's solver/ranking task in a separate clone. A owns root config, lockfile and CI. After A01 review, **A02** still needs B02/B03 for real HTTP integration. Individual tickets record review gates; passing agent checks does not replace human acceptance.

The product plan governs semantics; the two-developer plan governs ownership and sequence. Existing planning dates/research are historical references requiring current checks before release. Private outcomes can still be inferred from final plan facts. Later work must implement verified owner identity, public projections, independent consents, expiry, idempotency and atomic versioned acceptance.

## Starting tasks with Astra

Both developers select **GPT-6 Astra** as lead in their own Codex session and ask it to read AGENTS.md and execute their assigned task file (A: `docs/tasks/A01.md`; B: `docs/tasks/B01.md`). Every task explicitly authorizes Astra to select available local subagent models and reasoning effort as useful. Astra integrates the work, runs checks and reports actual outcomes. For small tasks it may work directly. See [the shared execution policy](docs/agent-workflow.md) and [task assignments and execution record](docs/task-execution.md). Model/tool availability depends on each session; task files do not switch models or configure accounts. Existing dependency and human-review gates still apply.
