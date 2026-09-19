# Astra-led task execution

User-requested working policy, September 19, 2026. Applies to every task in docs/tasks and both developer lanes. This updates agent allocation only; product semantics, file ownership, dependencies, review gates and approval boundaries remain in force. Imported planning references remain unchanged.

## Starting a task

Each developer selects **GPT-6 Astra** as the lead model in their own Codex session, opens their own project copy and asks it to execute the relevant task file. A Markdown instruction does not change the session model or enable unavailable tools. If Astra is unavailable, report that limitation and ask the developer to select an available lead; do not pretend another model is Astra.

Read AGENTS.md, this policy, the task and its referenced requirements. Check the task's dependency/status gate and existing work before implementation. Astra owns the task end to end: understand requirements, implement useful work, delegate where appropriate, integrate results, verify acceptance and produce the handoff. It is a working lead for this task, not a permanent manager or a reason to stop at planning.

## Delegation authority and model choice

The user explicitly authorizes Astra to spawn local subagents for bounded work within the selected task and to choose their available model and reasoning effort without asking for each delegation. Astra decides whether delegation is useful; small or tightly coupled work can be done directly. Use only tools/models exposed in the current developer's session. Never assume another developer's account or machine is available.

The following are project preferences, not fixed assignments or guaranteed performance claims:

| Work | Suggested starting choice |
| --- | --- |
| Narrow UI components, mechanical edits, focused tests/docs | Luna |
| Routine implementation, integration, scoped investigation | Terra |
| Difficult domain reasoning, multi-step failures, substantial reviews | Sol |
| Ambiguous architecture, consent/privacy/concurrency decisions and critical review | Astra, or Sol with Astra's final review |

Astra may select a stronger or different available model when risk, dependencies or observed results justify it. Choose supported reasoning effort explicitly when useful. If a selected model fails to resolve a subtask after two substantive attempts, reassess the approach and move it to Astra or a stronger available model. Do not silently substitute models: report what was actually used.

Briefly state each delegation's objective, selected model and file ownership. Give each subagent a concrete deliverable, necessary context, allowed files, acceptance checks and non-goals. Prefer independent subtasks that can run alongside useful local work. Respect session concurrency limits; use the fewest agents that help. Do not create recursive delegation chains, permanent monitoring or duplicate implementations.

## Ownership, integration and review

Subagents inherit the current ticket's limits. Developer A's agents cannot consume B's tickets, and B's agents cannot change A-owned files without coordination. Model choice does not change human ownership. In a shared checkout, give parallel writers disjoint files; serialize edits to shared files and root configuration. A read-only reviewer must not rewrite the author's changes.

Astra inspects subagent output, resolves integration issues and runs the task's required checks against the integrated result. A subagent's success report alone is insufficient. Critical identity, access, projection, grant, version/hash, transaction, IAM or secret-handling changes retain the architecture's strong-model review requirement; use a separate read-only Astra/Sol reviewer where available. Report missing review and leave the task REVIEW rather than claiming completion. Agent review does not replace required human review or authorize merging.

The final handoff names the lead and any subagents actually used, their subtasks, changed files/contracts, actual verification results, outstanding risks and next dependency. If subagent tools or model overrides are unavailable, say so and continue directly with Astra within scope; do not block ordinary implementation or claim delegation happened. Report any required review that could not be performed.

## Account and external-action boundaries

Delegation stays within the current developer's authorized Codex session and its existing limits. This does not authorize purchasing credits, changing billing, starting separately billed API workflows, publishing, pushing, merging, deploying or creating paid resources. Do not modify private/global Codex configuration to force model access. Each developer starts their own Astra session; share reviewed repository changes through the agreed workflow, not cross-account agents.

Codex supports per-subagent model/effort selection subject to available tools and configuration; see [official OpenAI documentation on subagents](https://developers.openai.com/es-419/docs/agent-configuration/subagents). These files express project instructions, not a promise that both accounts have identical model access.
