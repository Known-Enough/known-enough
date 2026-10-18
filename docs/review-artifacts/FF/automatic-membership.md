# Automatic participation in unfinished group decisions

The user explicitly requires accepted group members to participate in unfinished decisions automatically. This supersedes the older FF08 group-versus-decision opt-in requirement for additions.

The deployed native participant repository now obtains the current member identities and public display names from the same server-owned group/account fence used to authorize the request. Opening/refreshing a decision includes missing group members before producing its snapshot; participant operations use the same path. The roster addition and operation commit together with the existing group/account and decision conditions. No caller-supplied identity, new endpoint, permission grant or bulk migration is involved.

The existing FF08 additive domain transition is shared rather than duplicated. It keeps original owners’ answers, confirmed constraints, frame confirmations, semantic/frame/context identity and refused requests; new owners start empty and must provide their own answers and processing consent. An unfinished proposal and its approvals/jobs are retired when the required participants change; nobody’s approval is transferred to a different proposal. AGREED/CLOSED records return unchanged. A removal or substituted identity fails the additive path and retains the existing access/revision safeguards.

Current decisions no longer show “Update decision participants.” Only an already stale binding retains the separately labelled membership-change recovery action; this is not part of normal accepted-member additions. Historical bindings made stale before FF08, or by removals, are not silently repaired because their provenance is not established. Finished-decision visibility continues to follow existing participant-access rules.

Implementation: application `includeDecisionGroupMembers` (also reused by explicit recovery), native group-fence metadata, native participant repository integration, and the group decision overview. Existing two-step creation, B pagination and prior source/checkpoints are retained.

Validation: pinned Node/npm typecheck, full lint/import boundaries, production build/bundle scan, reference and whitespace checks passed. No automated unit/browser/live tests, provider calls, signups, emails or real group/member actions were performed. The user’s manual-test direction applies to this continuation. This is not a claim of functional live acceptance.

Manual acceptance after publication:

1. Save an existing member’s private answers in an unfinished decision.
2. Have a second approved account accept an invitation to that group.
3. Open/refresh the same decision from either account. The new member should appear automatically; no organizer inclusion/review button is required.
4. Confirm the original answers remain and the newcomer can save only their own answers, with their own consent. Any new final proposal still needs each required person’s approval.
5. Repeat the membership addition after finishing a different decision: its saved outcome, participants and approvals must remain unchanged.

Published source `bb4bae4`, API `9b20406e`, worker `3a436662`, frontend Amplify125. [Runtime release](https://github.com/Known-Enough/known-enough/actions/runs/39158796661), [frontend release](https://github.com/Known-Enough/known-enough/actions/runs/39158915622), [restored schedule](https://github.com/Known-Enough/known-enough/actions/runs/39158926226), [receipt](automatic-membership-publication.json). Seven public file hashes match. Admission is enabled/current; cumulative usage unchanged; original schedule restored ENABLED and its ordinary empty tick observed with zero dispatch. Application configuration/data/provider writes were zero during frontend reconciliation. No IAM writes or CloudShell steps. Functional manual acceptance remains pending.
