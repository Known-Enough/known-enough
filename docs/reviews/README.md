# Checkpoint evidence

Create one compact record per checkpoint: B02.5, A03.5, B04.5, G01, G02, G03 or KE13C. No checkpoint has passed merely because its ticket exists. Use the independent model/effort selected in the ticket; record the actual reviewer model and effort without inference.

Record:

- UTC timestamp, checkpoint, reviewer identity/model/effort and implementation owner.
- Exact base/head commits or reproducible diff artifact; include untracked files when applicable.
- Requirements and relevant work-log entries inspected.
- Code paths reviewed, checks actually run with exit/results, and test evidence supplied by the author (distinguish the two).
- Findings with affected files, reproduction/evidence, severity and responsible owner.
- Verdict: PASS, CHANGES_REQUESTED or BLOCKED; remaining limitations, affected dependent tasks and human acceptance status.
- Follow-up for changed code: new reviewed artifact, closed/open findings and updated verdict.

## Known Enough checkpoints

- [KE10 runtime follow-up](KE10-runtime-followup.md): IN PROGRESS on `da76fae..8d70fd9`; independent review of the new model/job boundary. Live provider evidence remains separately authorized.
- [KE13C hosted-preview review](KE13C.md): PASS reported for `a5d1833..a625498`; user accepted KE13C on 2026-09-27. Reviewer reported as Sol/Codex GPT-6 by the user; exact variant/effort unexposed. Two permanent-check coverage gaps remain non-blocking for the exact reviewed artifact.
- [KE13C Stage 0 IAM policy review](KE13C-policy.md): user-supplied CHANGES_REQUESTED findings against `f1893e3`; reviewer identity/model/effort unexposed. See the completed follow-up below; the original verdict is preserved as history. This policy gate is separate from the accepted hosted-preview build.

- [KE13C policy independent follow-up](KE13C-policy-followup.md): PASS on exact `f1893e3..6238700`; P1/P2 closed, no newly overbroad release grant found. Independent Codex GPT-6 session, exact variant/effort unexposed. Human acceptance, rendered ARN revalidation and live/cloud gates remain separate.

Midpoint review does not approve later unreviewed changes. Mock tests never establish backend authorization or real cloud races. Logs alone are not review evidence. Do not include participant secrets, private payloads or credentials.
