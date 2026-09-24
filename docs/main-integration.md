# Shared main — integrated baseline

Main is the single active development branch, in separate clones. Earlier user-authorized consolidations are historical and do not authorize new publication. Old task branches are preserved only as historical pointers; do not start new work on them.

## Included work

| Source | Included result |
| --- | --- |
| ca9fb63 | Accepted foundation |
| 39c1885 | A01 mock UI and browser tests |
| 45aaf11 | Direct-model workflow, parallel tasks, logs and checkpoints |
| 04c87d7 | B01 solver and synthetic fixtures/demo |
| 5abdc49 | First consolidation of A01/workflow and B01 |
| 47b97eb | B02 commands, in-memory repository, projections, consent and integration tests |

The initial consolidation included B02, superseding earlier reports that it was only in B’s clone. Subsequent A02/A03 frontend preparation and B03 local HTTP integration are recorded below; live UI/API acceptance remains separate.

## Integration changes and review

Conflicts were documentation-only. Retain the current main/direct-model/transfer policy and both developers' dated evidence. Backend source, contracts and coordinated root files are unchanged from B's B02 commit. Its root changes register integration tests and existing workspace dependencies, without new external packages.

B02 adds required CONFIRM_INPUTS.reviewedIntervals and owner-only availabilityReview; public DTOs are unchanged. A01's synthetic owner adapter was updated to supply a receipt bound to its confirmed context/revision, with focused scenario tests. A02 must collect explicit owner-reviewed intervals, never infer them from schedule options. [B02.5](reviews/B02.5.md) records imported independent Astra review plus the integration compatibility review.

## Verification

Final integration evidence recorded 2026-09-21T15:21:01Z. Pinned Node 24.21.0/npm 11.19.0; clean npm ci succeeded. `PLAYWRIGHT_CHANNEL=chrome npm run check` exited 0 using installed Google Chrome 150.0.7871.125 (the documented macOS 12 fallback):

| Check | Result |
| --- | --- |
| Immutable references | 7/7 matched |
| Planning arithmetic | 15/15 passed |
| Lint/import boundaries | Passed, 44 references |
| TypeScript | Passed |
| Unit/integration tests | 149/149 in 8 files |
| Production build/bundle scan | Passed, 123 modules |
| Browser tests | 17/17 passed |

Astra coordinated integration and reviewed the compatibility diff. Terra/medium made the bounded owner-mock fix, passing 3 focused tests and a web build before the full check. Imported B02 independent-review evidence is retained; its critical backend code is unchanged. B02 and B02.5 are complete for this local application scope under the user’s integration direction. B03 is READY; real HTTP/auth/cloud gates remain open.

The earlier 5abdc49 consolidation’s 120-test result is historical and superseded for the combined baseline by this run.

## Continue on main

For a clean clone already on main:

```sh
git fetch origin
git switch main
git pull --ff-only origin main
```

If there are uncommitted or unshared changes, save them first in a commit or transferable diff including untracked files. Inspect the history before synchronizing; do not reset or force-push. A clone still on task/b02 should preserve any newer local work, then switch to main and fast-forward it from origin/main. The published task/b02 source is already included; do not merge or reimplement it a second time.

Current scheduling uses the September 22 shared pool: either user may claim an eligible unclaimed task from the [board](task-board.md), subject to its ticket and synchronized claims. The integration history above does not establish current availability. No task is claimed automatically by integration.

Shared destination: origin/main. The integration session must verify the remote tip after its authorized push before reporting completion. This record covers included source and checks; deployment, external access and future pushes retain their own authorization requirements.

## B03 integration — 2026-09-21T17:58:42Z

User explicitly requested all completed work on main and a main-branch check before future pushes. Integrated `task/b03` source `27a110c` into main baseline `7eb2b86`, preserving A02/A03 and A03.5 findings. B01/B02 were already ancestors of main. Conflicts were documentation-only; the reviewed B03 API and HTTP tests are unchanged. AGENTS.md now requires verifying main is checked out and using an explicit `origin main` destination before authorized pushes.

Fresh combined `npm run check` exited 0 with pinned Node 24.21.0/npm 11.19.0: seven reference hashes, 15 arithmetic checks, lint/boundaries (54 references), typecheck, 164 unit/integration tests in ten files, build (124 modules)/bundle scan, and 20 Chromium browser tests. Chromium and required libraries used the documented B03 `/tmp` setup. Log: `/tmp/b03-main-check.log`.

B03 remains REVIEW for live acceptance. A03.5 findings and A02.5/G01 remain open; intercepted/mock browser tests do not establish a connected local negotiation. No new task, real authentication or cloud work is claimed. Source branches are preserved as historical pointers. Publication is authorized for this integration; verify origin/main equals the resulting local main commit after pushing.


## B04 divergent-line integration — 2026-09-23

The local and published `main` lines independently developed overlapping B04 work from common base `8e6d1c4` (local `d6c4a90`, published `2087331`). They therefore had separate commits touching the same API, application, persistence, test, and tracking files, plus incompatible DynamoDB designs. This caused the rebase conflict set; it was not a single bad commit or a corrupt shared history.

History-preserving local merge `2dd036a` retains both lines as parents. The current tree selects the stricter multi-item STATE/GUARD/REPLAY adapter and authenticated API composition, removes the duplicate single-item adapter, and ports the published line’s opt-in DynamoDB Local scenario to the selected adapter. Old reviews remain tied to their exact pre-merge artifacts. The unified artifact requires fresh independent B04.5 review. The user requested local unification; no push is authorized by that request.


Follow-up review of `2dd036a` found one P2: package-level exports for the Cognito resolver were missing, and the generated lock omitted registry integrity metadata while the SDK pin did not match installed modules. B04 restored the package exports with a package-surface regression, aligned SDK 3.1135.0 with installed modules, and restored complete lock metadata. The corrected code passed full local checks and fresh independent Astra/high follow-up on exact code commit `a058cc5` passed. B04 remains REVIEW pending human acceptance/integration; the opt-in DynamoDB Local scenario was skipped. No push has occurred.
