# Known Enough

**Decide together without everyone needing to know everything.** Known Enough is an AI-first group-decision facilitator: people describe a shared objective, privately explain what matters, confirm the AI's interpretation, consider proposals and individually approve an exact outcome. A small trust kernel protects identity, consent, supported hard conditions and current approval authority.

The [product definition](docs/known-enough-product.md), [architecture direction](docs/known-enough-architecture.md) and [pivot record](docs/known-enough-pivot.md) describe the new direction: Family Christmas first, Shared Purchase Exploration as a second-domain proof. Private inputs are processed by Known Enough/its permitted AI service; other participants receive authorized public facts and disclosures, and outcomes can permit inference.

**Current implementation:** the retained TeamTable prototype includes the React/Vite UI, strict contracts, deterministic fixture, local application/HTTP flow and reviewed local Cognito/DynamoDB adapter code. Default UI routes use synthetic mocks; explicit local routes use fixed non-production identities. B04/B04.5 await human acceptance. Generic Known Enough AI, Bedrock/SQS runtime and cloud deployment are future tasks; KE00 changes documentation only. All demo people/data are fictional. Mock identities are not authentication.

Read the [current queue](docs/task-board.md) before starting work. KE00 stops for human review; KE01 is next only after acceptance. Package names such as `@deal-table/...` remain intentionally unchanged during the migration.

## Setup and launch

Prerequisites: Node **24.21.0**, npm **11.19.0** (exact pins), network access for initial npm/browser installation. On Linux/WSL with nvm:

```sh
nvm install
nvm use
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. Stop with Ctrl+C. Windows users can install the pinned Node/npm directly and run the npm commands in the application folder. No Windows source paths, AWS account, API keys or environment variables are needed after import. A different Node/npm is rejected by engine-strict; change to the pinned runtime first. The root folder name need not match the app name.

## Historical TeamTable demonstrations

The default page is the synthetic shared table. **Open private owner demo** opens a fixed fictional owner, not a login. Shared scenarios use `/?public=collecting` (also `blocked`, `private-review`, `proposed`, `agreed`, `superseded`); owner scenarios use `/?view=owner&owner=review` (also `draft`, `approval`). Both adapters support `empty`, `failure` and `stale` recovery examples.

For the connected local UI/API demonstration, use the [local negotiation tutorial](docs/tutorials/local-negotiation.md) and [API setup](apps/api/README.md). These routes exercise actual local application state with explicit non-production identity labels; they are not managed authentication or cloud evidence. Exception, disclosure and final acceptance are separate.

```sh
npm run demo --workspace @deal-table/test-support
```

The deterministic historical fixture has 12 structural candidates, zero feasible at baseline and two after the scoped exception; inconvenience selects B and balanced load selects A. Preserve it as regression evidence, separate from the new generic AI scenarios.

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

## Workspace and migration

| Boundary | Current value / next adaptation |
| --- | --- |
| `apps/web` | Separate shared/private surfaces, confirmation/receipts, retry/accessibility behavior; generic shell in KE05 |
| `packages/contracts` | Strict DTOs, commands and public hashes; generic contracts in KE01 |
| `packages/domain` | TeamTable solver/benchmark retained; small universal kernel in KE02 |
| `packages/application` | Commands, allowlisted snapshots, independent consent and guarded lifecycle; generic state in KE03 |
| `packages/adapters`, `apps/api` | Retained in-memory/DynamoDB repositories, verified Cognito identity, HTTP and subject-bound invitations; human/live gates remain |
| `apps/workers`, `infra` | Worker placeholder and infrastructure design; actual Bedrock/jobs/deployment in KE10/KE13 |
| `packages/test-support`, `tests` | Synthetic private fixtures and regression/integration/browser tests; never import server fixtures into web |
| `docs` | Known Enough direction, baseline contracts, immutable source evidence, current tasks and dated reviews/logs |

Use `main` in separate clones, one active project task at a time. On clean main, successfully run `git pull --ff-only origin main` before task development, then claim the highest-priority eligible task in the [queue](docs/task-board.md). Select its named direct worker model/effort; files do not change the session model. Independent critical reviews run sequentially. The [workflow](docs/agent-workflow.md) and [authority mapping](docs/known-enough-pivot.md#authority-and-evidence) supersede historical domain, ownership, branch and scheduling instructions.

[A handoff](docs/handoff-A.md), [B historical handoff](docs/handoff-B.md), [A log](docs/work-log-A.md), [B log](docs/work-log-B.md), [integration record](docs/main-integration.md) and [reviews](docs/reviews/README.md) retain evidence and acceptance boundaries. Check current ticket claims; local logs are not a shared lock. Human acceptance, publication, merging, deployment, spending and external messages require their own authorization. No blind repository/package rename or historical evidence rewrite is part of the pivot.
