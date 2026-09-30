# KE14 informed-confirmation correction checkpoint

User B / Codex GPT-6 (exact variant/effort unexposed; KE14 Sol/high ticket target), 2026-09-30 UTC. B took the bounded R1/R2 correction under the user's “review and finish KE14” direction after the independent [CHANGES_REQUESTED verdict](reviews/KE14-KE09-followup.md). Clean synchronized baseline `b0699fe57127e8e0c7959e02cbd963b3dc872d51`, successful ff-only pull, ahead/behind 0/0. The original review verdict remains unchanged; the correction author cannot independently pass the follow-up.

## Changes

- The connected shared-frame review shows the exact frame version, every participant's required/optional approval role, each public variable's type, required flag and available options/domain, and every public decision rule. Confirmation stays disabled until the participant checks that they reviewed this version. The check is bound to context token and frame version.
- The private draft and question review renders all seven closed validation operators with their referenced variables, values and inclusive/exclusive bounds. Preferences now identify their variable and cost. The opaque “Combined condition” fallback was removed, so an accepted complex rule is no longer confirmable behind that generic wording.
- The connected signed-HTTP browser scenario asserts option/roster/rule visibility before frame confirmation and the disabled/enabled action; its retry case still sends the identical command envelope. A focused unit/SSR regression parses a valid complex owner draft and verifies the rendered sum and preference variable, plus all-different, mutually exclusive, implication and range semantics.

Changed executable files and SHA-256:

```text
apps/web/src/connected-decision.tsx 905c89f47d5bc2033c6818a26de4b144b22ecab562c5a8aeb0a83a228b0bc81d
apps/web/src/connected-decision.test.ts bef81285bfa9e16e3bdb7f27455d660fd632ead1d83c9952141ba695aaa786b4
tests/e2e/ke14-connected.spec.ts 96082263133ed8679f91c11bef58d20138a58f25ae46371b16cb692efd307eac
```

No backend, contracts, model adapter, storage codec, IAM, infrastructure, root configuration or deployment file changed. No AWS write, paid provider call, real participant action or external message occurred. User A's 17-file KE14 implementation remains the underlying artifact; this is a narrow UI correction.

## Verification and remaining gates

Fresh focused connected-review unit **3/3**, KE14 connected browser **2/2**, lint/boundaries and typecheck passed. Final pinned `npm run check` exited 0 on this exact executable artifact: **417 unit/integration passes, two optional DynamoDB Local skips, hosted browser 1/1, E2E 47/47**, imported hashes 7/7, planning 15/15, lint/boundaries 199, types and both builds. The prior independent R1/R2 verdict has not been relabeled as a PASS.

KE14 remains REVIEW until a different reviewer performs the focused follow-up of these changed UI/test files against this baseline. Then the ticket still needs a separately authorized backend/model deployment with exact member bindings and real, synthetic two-scenario qualification on the deployed artifact. No live model or managed scenario success is claimed by the passing local tests. KE15 remains BLOCKED.
