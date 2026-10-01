# Project people and execution workers

Identity correction requested by the user on 2026-09-30; verified from the Mac at 2026-10-01T02:54:44Z. This mapping governs current attribution and supersedes inferences from commit display names, machine names, task prefixes or Codex chat titles.

## Canonical mapping

| Label | Human/account | Evidence and limits |
| --- | --- | --- |
| User A | Ricardo, also called martelaxe; GitHub [martelaxe](https://github.com/martelaxe), account ID `44531296` | The user confirms Ricardo and martelaxe are the same person. The Mac's current Git credential successfully authenticated GitHub's `/user` endpoint as martelaxe. |
| User B | Octavio Alatorre; GitHub [Battosai1806](https://github.com/Battosai1806), account ID `143764700` | GitHub links Octavio's [KE14 correction](https://github.com/Known-Enough/known-enough/commit/95db9b58da4dbff3f600ab338430a59eb2fa9882) and [review commit](https://github.com/Known-Enough/known-enough/commit/b0699fe57127e8e0c7959e02cbd963b3dc872d51) to this account. This is public commit/account association, not fresh authentication of B's own machine or a claim about B's current activity. |
| Mac / MAC worker | A separate execution worker using User A's martelaxe account at the verification checkpoint | Current checkout: `/Users/martelaxe/Blockchain_development/known-enough`. The Mac is not an additional verified GitHub person/account and must not be called User B. Report its task/session activity separately. |

The Mac can be treated as a separate worker while its authenticated account belongs to A. Other machines/sessions must establish their own current account; this mapping does not authenticate an unseen host or grant AWS authority.

## Cause and correction

The Mac's global Git configuration contains both `martelaxe` and `Ricardo` as `user.name` values, with Ricardo effective. The main checkout and accessible KE14 integration clone share that effective name. These are commit metadata aliases, not two authenticated users.

The assistant incorrectly treated Ricardo as B and used the idle status of the chat “MAC DIRECT” to answer what B was doing. That title/status identifies a local session only. Those identity and B-activity conclusions are withdrawn.

GitHub does not associate the sampled Ricardo/martelaxe commits `5611aca` and `61d346c` with an author account through their recorded metadata. Author-name differences or a missing author link therefore cannot identify a separate person. The authenticated `/user` result and the user's confirmed alias relationship establish A for this Mac checkpoint.

## Attribution and status rules

1. Keep human/account, worker/machine, chat/session and implementation/reviewer role separate. New claims record verified GitHub login/account ID when available, worker/checkout, actual model/effort, task and exact baseline/files. Use the account owner's log: current Mac/martelaxe work uses A's log; Battosai1806 work uses B's log.
2. Verify current Git transport identity through an authenticated GitHub profile query without printing tokens, credential-helper output, auth headers or secret storage. Author name/email, OS username, folder path and a connected app's separate account are insufficient. If authentication cannot be checked, report identity as unverified.
3. Do not inspect B's credentials from A's machine. Public GitHub metadata may establish an account association; B verifies B's own transport identity on B's host. No credential transfer, login/settings change or history rewrite is part of this correction.
4. Report another worker's activity from an explicitly identified session and/or dated synchronized claim. A local idle chat does not prove another human or remote worker is idle. No automatic notifications or cross-account messaging are implied.
5. A, B and the Mac worker share the [NP queue](task-board.md), with one active task total across all machines/sessions. Current task/claim is authoritative on the [board](task-board.md); [NP00](tasks/NP00.md) is now claimed by A's Mac worker. Extra workers do not open a second queue.
6. AWS authority stays A-only under separately authorized operations and verified AWS profiles; GitHub identity alone grants no AWS, deployment, paid-call, email or participant authority. Developer accounts are distinct from Cognito participant/display accounts.

## Historical evidence and the misplaced planning note

Previous tickets, imported bytes, commits and review verdicts remain unchanged history. Older A/B role labels alone do not prove a human identity or reviewer independence; this correction does not retroactively certify them. Independent reviews remain deferred under the NP policy.

The assistant's own NP planning entry in commit `5611aca` was incorrectly filed at the top of B's log. Its exact text is preserved in [the attribution archive](archive/np-planning-mac-attribution.md.txt), SHA-256 `0b8e5a101fef8f568d2aeba3889962f7663c97d360c7ed330ddc5e96099fe473`. Only that newly authored misplaced entry is removed; B's prior log history is preserved exactly. A's log records the verified Mac/A attribution and correction. Both handoffs carry the mapping; no B acknowledgement, activity or new implementation claim is invented.
