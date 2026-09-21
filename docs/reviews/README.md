# Checkpoint evidence

Create one compact record per checkpoint: B02.5, A03.5, B04.5, G01, G02 or G03. No checkpoint has passed merely because its ticket exists. Astra is the direct human-selected reviewer; use an independent session/agent for critical implementation review.

Record:

- UTC timestamp, checkpoint, reviewer identity/model/effort and implementation owner.
- Exact base/head commits or reproducible diff artifact; include untracked files when applicable.
- Requirements and relevant work-log entries inspected.
- Code paths reviewed, checks actually run with exit/results, and test evidence supplied by the author (distinguish the two).
- Findings with affected files, reproduction/evidence, severity and responsible owner.
- Verdict: PASS, CHANGES_REQUESTED or BLOCKED; remaining limitations, affected dependent tasks and human acceptance status.
- Follow-up for changed code: new reviewed artifact, closed/open findings and updated verdict.

Midpoint review does not approve later unreviewed changes. Mock tests never establish backend authorization or real cloud races. Logs alone are not review evidence. Do not include participant secrets, private payloads or credentials.
