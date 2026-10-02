# ASSESS08 — Finish the AWS setup handoff

- Status: READY — queued after B's ASSESS01 → ASSESS04 → ASSESS02 → ASSESS03 → ASSESS05 → ASSESS06 corrections, before A's next full installation and ASSESS07 managed verification.
- Intended worker: B / Octavio / GitHub Battosai1806; unclaimed. Record actual model/effort and clean synchronized baseline when claiming. No subagents.
- Authority: user requested this focused setup-blocker task on 2026-10-02 to reduce repeated CloudShell attempts and token use. A retains AWS operations and NP00; this task grants no personal AWS credential access, cloud writes, deployment, paid calls or email.
- Purpose: check the remaining installer path as a whole and give A one verified, pinned resume command. Local readiness is separate from actual cloud success in [ASSESS07](ASSESS07.md) and [LIVE04](LIVE04.md).

## Known checkpoint to preserve

A's last readback: QA stack known-enough-live-qa UPDATE_COMPLETE, source 348afae8270eb739a89ab974c85a89e1526f06d9. Retained tables were imported and full QA infrastructure installed. Publishing stopped at amplify:create-deployment because the CLI requires appId/branchName/jobId. The three publication calls and regressions were corrected in 67657e24fab2c4e3f5cfaae67e4b67cc9578ae1b; actual publishing has not been proved. Primary rollout was not reached: original handler, groups unset, model DISABLED and paid flag false. These are dated observations, not a fresh live result.

Keep private HOME config/state, retained tables and original rollback material. Preserve the activated expiry 2026-10-09T03:16:41.171626Z and approved whole-envelope ceilings: 28 runs, USD 7 reserved model cost, 56 verification messages; infrastructure cost is separate. No automatic renewal or broader access. Do not depend on surviving /tmp files or remembered shell variables.

## Bounded work

After prior correction scopes are released, inspect scripts/live-qa/{aws,install,setup,resume,recovery,package,release,private-directory}.mjs or .sh as applicable, their existing integration tests, and setup/handoff documentation. Read the corrected primary/budget/workflow interfaces for integration; do not reopen completed assessment fixes without a concrete finding. Maintain this ticket and own B log/handoff; shared board/workflow only for this routing. Amend exact scope before additional source, root configuration or lockfile edits.

1. Trace every remaining step from the installed QA stack through website publication, corrected primary apply, readback, private receipt and GitHub configuration. Reuse prior passing evidence; avoid another broad assessment.
2. Check each remaining AWS CLI operation's input field names and response shape against CLI skeletons or official API documentation. Skeleton generation needs no AWS credentials. Add focused regressions for concrete gaps, including publication failures; mocks accepting any object are insufficient.
3. Verify forward resume from the installed 348afae stack and saved config into the final corrected source, including prior pin recognition, HOME journals, source changes, expiry refusal, interrupted publication/apply and unchanged authorization. Preserve originals; do not guess or reset ambiguous AWS state.
4. Confirm the final source includes A's import/Amplify fixes and all required B corrections. Check exact existing role permissions for remaining calls; prepare any narrowly scoped missing-access proposal instead of asking for administrator credentials. Optional existing GitHub read-only evidence must use B's own account.
5. Produce one short handoff: exact source commit, included fixes/check results, one copy-and-paste CloudShell resume block with no remembered variables, expected success output, exact non-secret GitHub settings, and clear remaining live checks. Include a short read-only diagnostic block that identifies a failed operation without exposing secrets or encouraging blind retries.

## Completion and cost of verification

DONE means the installation handoff is locally verified and published, not that AWS or B's real journeys passed. If executable changes are necessary, run focused meaningful regressions and one pinned full npm run check before handoff. Documentation-only work requires links, reference hashes and consistency checks; do not rerun successful application suites without changed executable code or a relevant unresolved concern. Reuse existing receipts/logs; keep the handoff concise.

Synchronize to origin main with [skip ci] under the standing repository authorization, verify equality and have A pull before installation. ASSESS07 stays pending until actual corrected installation, B's own GitHub run and matching automatic run pass. No independent human sign-off or extra recurring AWS login is introduced. An expired authorization is reported as expired, never silently extended.
