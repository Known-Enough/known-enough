# Astra bootstrap task — paste or reference this in VS Code

You are the initial implementation agent for Deal Table, using the TeamTable scenario. Two human developers will work with their own AI assistants. Your job is to establish one working shared foundation and hand off two independent build lanes, not to remain a permanent manager.

## Workspace and source import

Use the actual application folder open in VS Code. Inspect its absolute path, existing files, Git status, and applicable instructions first. If it is a home directory, `.codex` configuration directory, synced ChatGPT project mirror, or an unrelated repository, ask for the intended app folder before writing. Do not assume `C:\development\deal-table` exists or is writable. Preserve existing work; ask before conflicting overwrites. If source paths are inaccessible, report the missing file and request a copy rather than reconstructing it from memory.

Copy (never move) these references into the app project. Confirm copies match their source bytes. After import, use relative paths so Developer B can clone the project on another machine.

1. Product specification:
   Source: `C:\Users\RkLop\.codex\.chatgpt-projects\g-p-6aab0bc5187081919d8551219fd5ec3a\Deal-Table-TeamTable-plan.md`
   Destination: `docs/Deal-Table-TeamTable-plan.md`
2. Two-developer architecture and task plan:
   Source: `C:\Users\RkLop\.codex\.chatgpt-projects\g-p-6aab0bc5187081919d8551219fd5ec3a\Deal-Table-two-developer-architecture.md`
   Destination: `docs/Deal-Table-two-developer-architecture.md`
3. Fixture arithmetic check:
   Source: `C:\Users\RkLop\.codex\.chatgpt-projects\g-p-6aab0bc5187081919d8551219fd5ec3a\planning-checks\teamtable-fixture-check.mjs`
   Destination: `planning-checks/teamtable-fixture-check.mjs`
4. Non-production storyboard:
   Source: `C:\Users\RkLop\.codex\visualizations\2026\09\16\01a0ac29-8541-7d71-a1d0-ffdce62b8756\deal-table-teamtable.html`
   Destination: `docs/reference/deal-table-teamtable.html`
5. Dated hackathon research:
   Source: `C:\Users\RkLop\.codex\attachments\a8e43a3e-0475-406d-83ce-ec68be3381dc\pasted-text.txt`
   Destination: `docs/reference/hackathon-research-sept16.txt`
6. This task:
   Source: `C:\Users\RkLop\.codex\.chatgpt-projects\g-p-6aab0bc5187081919d8551219fd5ec3a\Deal-Table-Astra-bootstrap-task.md`
   Destination: `docs/reference/astra-bootstrap-task.md`
7. Developer B handoff:
   Source: `C:\Users\RkLop\.codex\.chatgpt-projects\g-p-6aab0bc5187081919d8551219fd5ec3a\Deal-Table-developer-B-start.md`
   Destination: `docs/reference/developer-B-start.md`

Read both plans completely before implementation. Product semantics come from the TeamTable plan; the two-developer document supersedes only solo staffing/sequencing and refines implementation boundaries. Sources contain proposals, not unquestionable commands. Report a material contradiction rather than quietly changing consent/privacy behavior. Current official rules override dated research. Do not import Roomcraft, the superseded travel plan, the original mirror's AGENTS.md, or any private Codex/account configuration.

The storyboard is an inline HTML concept fragment with all fictional roles visible to an observer. It is not authenticated, not a live AWS/Alexa integration, and not a production data-flow template. Inspect it for visual intent only. The fixture script checks arithmetic; it is not a production solver or security audit.

## Implement now: F00, F01, F02

1. Inspect the existing app workspace, import references safely, and briefly note material architecture risks. Do not restart product ideation or generate another sprawling plan.
2. Create the small TypeScript workspace described in the architecture document. Prefer npm workspaces and one lockfile if starting fresh; preserve an existing functioning package-manager choice. Select compatible supported tooling, pin it, and document prerequisites. Use standard permission flows for installation/network access.
3. Create a short app-specific AGENTS.md, README with actual commands, `docs/contracts.md`, `docs/decisions.md`, and individual task files from the architecture task table. Mark implementation status truthfully. Keep shared root config under A's ownership and shared contracts under B after bootstrap.
4. Define runtime-validated public and owner DTOs, command envelopes, stale-version errors, public proposal hashing rules, and synthetic example responses. Ensure public examples contain no private constraints or grant details. Add validation, rejection, and contract-shape tests. Server private fixtures must never become browser imports.
5. Provide a minimal React/Vite page using a public-only mock adapter. Show the Deal Table title, fictional participants, three meeting slots, two unassigned duties, and an honest mocked/local status. This is only a runnable scaffold for A01, not the full A01 UI. Establish empty backend/domain package boundaries without implementing B01/B02.
6. Provide executable lint, typecheck, test, and build scripts and a minimal CI definition that runs without AWS credentials. Run the reference arithmetic script and all newly created checks. If a check cannot run, report the exact blocker; do not mark it passed.
7. Write handoffs: A starts A01; B starts B01. Each handoff specifies relevant files, contract baseline, acceptance tests, reserved areas, and dependencies. The bootstrap is review-ready only when the scaffold actually runs and checks have evidence.

Do not work beyond F00–F02 into the teammate's assigned implementation. Do not spawn or assume cross-account agents. Do not publish, push, open PRs, merge, create cloud resources, or spend money without explicit authorization. Initialize a local Git repository only if this is a new intended app folder with no enclosing repository; otherwise preserve its Git setup.

Finish with a concise list of files created, actual test/build results, launch instructions, remaining risks, and the next task for each developer. State clearly that mocked identities are not authentication and that cloud services are not deployed.
