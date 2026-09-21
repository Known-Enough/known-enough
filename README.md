# Deal Table · TeamTable

Local React/Vite foundation with strict contracts, the B01 deterministic solver, and B02 application commands with an in-memory repository. All people/data are fictional. **Mocked identities are not authentication. HTTP services, verified authentication, Alexa integration and cloud deployment remain unimplemented.**

## Setup and launch

Prerequisites: Node **24.21.0**, npm **11.19.0** (exact pins), network access for initial npm/browser installation. On Linux/WSL with nvm:

```sh
nvm install
nvm use
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. Stop with Ctrl+C. Windows users can install the pinned Node/npm directly and run the npm commands in the application folder. No Windows source paths, AWS account, API keys or environment variables are needed after import. A different Node/npm is rejected by engine-strict; change to the pinned runtime first. The root folder name need not match the app name.

## Checks

```sh
npx playwright install chromium
# On minimal Linux, if system libraries are missing:
# npx playwright install --with-deps chromium
npm run check
```

`check` runs seven-reference integrity verification, the original 15-check arithmetic script, ESLint/import boundaries, TypeScript, unit/contract tests, production build/bundle marker check, and desktop/mobile Chromium smoke tests. Individual commands: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`, `npm run check:planning`, `npm run check:references`. Browser tests require an existing build and free port 4173. For a production preview: `npm run build` then `npm run preview --workspace @deal-table/web -- --port 4173`.

See the [dated bootstrap verification evidence](docs/verification.md). It records the original local run and is not a fresh result for the current checkout. CI is defined to run the same checks without cloud credentials. The arithmetic reference is not a production solver/security audit, and passing contract shapes does not prove authorization or race safety.

## Workspace and next work

- `apps/web`: A's minimal public-only page and mock adapter; public sample responses are in `src/mocks/public`.
- `packages/contracts`: runtime DTO/command/error validators and canonical public hashing; B owns after bootstrap, A reviews breaking changes.
- `packages/domain`: B01 pure enumeration, scoped-exception feasibility and both ranking policies; see [the domain API](packages/domain/README.md).
- `packages/application`, `packages/adapters`: local application commands, owner/public projections and serialized in-memory persistence; see [application API](packages/application/README.md).
- `apps/api`, `apps/workers`, `infra`: implementation boundaries reserved for B.
- `packages/test-support`: synthetic owner/command examples for tests/server only; never browser imports.
- `tests/e2e`, `tests/integration`: A's browser smoke checks and B's application integration tests.
- `docs`: immutable source references, [contracts](docs/contracts.md), [decisions/risks](docs/decisions.md), 18 [task files](docs/tasks), and [A](docs/handoff-A.md)/[B](docs/handoff-B.md) handoffs.

A starts **A01**, the shared/owner UI with mock adapters and loading/error/stale states. B01 is committed as `04c87d761d13f29643e287392e520ca38af940d0`; **B02** application commands are developed on `task/b02`. B03 adds the local HTTP adapter after review; A02 connects the UI after its A01 dependency. Both developers use the same accepted foundation in separate clones; do not scaffold a second project. A owns root config, lockfile and CI. The foundation was integrated to `main` as `ca9fb636974030bfd8a620cec2b3d8581b3c8114` at the user's direction. Subsequent tasks retain their review and dependency gates.

Run the synthetic B01 solver demo with the pinned Node/npm runtime:

```sh
npm run demo --workspace @deal-table/test-support
```

It enumerates 12 structural plans, reports no baseline agreement, and finds two plans after the valid exception. Lowest inconvenience selects Leo as lead/Maya for follow-up; balanced recent load selects Maya as lead/Leo for follow-up. This is a server-side domain demonstration; the browser still displays its public-only mock. See [solver input and privacy boundaries](packages/domain/README.md).

The product plan governs semantics; the two-developer plan governs ownership and sequence. Existing planning dates/research are historical references requiring current checks before release. Private outcomes can still be inferred from final plan facts. B02 tests local membership enforcement, public projections, independent consents, expiry, idempotency and atomic versioned acceptance. Later adapters must verify real credentials and prove durable cloud transaction behavior.

## Starting tasks with Astra

Both developers select **GPT-6 Astra** as lead in their own Codex session and ask it to read AGENTS.md and execute their assigned task file (A: `docs/tasks/A01.md`; B: `docs/tasks/B02.md`). Every task explicitly authorizes Astra to select available local subagent models and reasoning effort as useful. Astra integrates the work, runs checks and reports actual outcomes. For small tasks it may work directly. See [the shared execution policy](docs/agent-workflow.md) and [task assignments and execution record](docs/task-execution.md). Model/tool availability depends on each session; task files do not switch models or configure accounts. Existing dependency and human-review gates still apply.
