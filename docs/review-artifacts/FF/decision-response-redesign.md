# Decision response screen redesign

User-directed frontend change; final instruction explicitly requests no tests. Native API/worker source `bb4bae4`, automatic group membership, creation wizard and existing saved participant records are preserved.

- Compact decision heading, short phase badge, discreet refresh/close actions and a collapsible group-progress list. Counts use the supplied public progress only; an absent progress field is not presented as verified completion.
- All public options render immediately as full-width native checkbox rows, grouped under their existing topic labels. Select all, Clear and explicit None work for me replace the visible ANY/SELECTED/NONE mode selector.
- No choices are assumed for a new participant. Unchecking the last choice returns to unanswered, while None is an explicit separate action. Optional favorites include only acceptable options and clear when their option is removed.
- Backend payload remains CONFIRM_PRIVATE_ANSWERS: all selected maps to ANY with no indices, a subset maps to SELECTED, explicit None maps to NONE. A favorite remains optional and valid for the current selection. Existing saved constraints hydrate the visible checkboxes.
- Existing generated direct-answer unavailability drafts hydrate the explicit None state. A draft containing only generated direct-answer entries is replaced by the current direct selections on save, preventing stale None markers from persisting after the owner changes their answer. User/AI extra conditions and unresolved qualitative notes retain their explicit review/replacement path.
- Private notes remain optional and separate from direct selections; asking AI is explicit. Unsent notes retain the existing interpret-or-clear save rule. Pending/unknown requests and prior retained conditions are unchanged.
- Compact privacy details preserve processing/inference/disclosure information and the original explicit fictional-data consent wording. Saving remains separate from final proposal approval.
- Sticky save area explains incomplete selections, missing consent or pending notes; saving has a local duplicate-submit guard and honest in-flight state. Normal save confirmation is concise. Empty shared-rule sections are hidden; the embedded example matches the checkbox UI.
- Scoped theme tokens, readable selected/unchecked states, responsive spacing, native keyboard controls and one outer content scroll are used. No new dependencies, private browser-storage fields, backend/schema/IAM changes or CloudShell setup.

Static validation: pinned Node24.21.0/npm11.19.0 typecheck, full lint/import boundaries597, production build/public bundle scan and whitespace PASS. Automated/unit/browser/live tests, screenshot automation, paid AI and real participant actions were NOT_RUN by user direction. Responsive and functional manual acceptance remain pending; no visual or live PASS is claimed. Existing test selectors for old mode labels will need adaptation when tests resume.

Manual check after publication: refresh the site, open an unfinished decision, confirm every option is visible, select several choices, Select all, choose None, pick/remove an optional favorite, and save with the existing processing consent. Reopen to check the saved choices. Optional notes and final approval remain separate actions.

Published source `ff5f141`, Amplify126: [successful release](https://github.com/Known-Enough/known-enough/actions/runs/39170747931), [publication receipt](decision-response-publication.json). Seven public files returned matching hashes. Existing API `9b20406e` independently matched, frontend reconciliation configuration/data/provider writes0. No backend/worker/schedule/IAM/CloudShell changes. User manual acceptance pending.
