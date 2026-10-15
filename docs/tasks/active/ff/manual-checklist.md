# FF manual acceptance

A has published the FF code. At the user’s direction no new automated or manual product tests are run by this A chat. Compilation and publication are separate from the manual checks below. The previously deferred FF02 permission command was applied successfully by the user; no repeat setup is needed.

Open [Known Enough](https://main.d143q5ravxp5av.amplifyapp.com/) and refresh to get the latest frontend.

## FF01 — Account screens (no CloudShell needed)

- Sign out. Open Create account and Sign in. Check compact layout on desktop/mobile and both themes.
- Show/hide the password with the eye icon. Labels, password requirements and typed values should remain understandable.
- Check Back to sign in, Create one, Forgot password and the discreet existing-account verification section. The normal sign-in form should not show a code field.
- With a test account of your choice, manually exercise registration/email confirmation, sign-in and password recovery if desired. Never share the password or verification code in chat. Avoid clicking again while an operation is in progress.

## FF03 — Shared draft (no new CloudShell needed)

- In an approved organizer account, open a group and start or continue a decision.
- Example shared idea: “Choose a restaurant for a fictional group dinner on Friday: Green Bowl, Pizza Corner or Taco House.” Keep private needs out of the shared idea.
- Answer any follow-up questions and select Let AI update the draft. Earlier choices and answers should stay available. Review the saved draft and explicitly confirm your review before creating the decision.
- If a request fails, its recovery screen should explain whether it stopped, has not started or has an uncertain result. Use Check progress, and Close unfinished request only when offered. An uncertain call must not silently run again.
- Check the saved decision from another actual group member's own account. Drafts still belong to the organizer; a decision becomes shared after creation.

## FF02 — Private interpretation (permission applied)

The [timestamp-permission command](FF02/cloudshell-command.md) already succeeded in the user’s CloudShell at17:43:10Z. Do not repeat it or rerun unrelated installations. Private processing still requires the normal shared-frame and individual processing-consent steps below:

- Every required group member reviews and confirms the current shared frame in their own account. The person interpreting private conditions must confirm it too.
- Enter only fictional test conditions, such as “For this fictional dinner I prefer Green Bowl and want to spend at most $20.” Explicitly select the fictional-test processing consent checkbox.
- Select Interpret my conditions. Review the proposed conditions before any separate confirmation. Other members must not see your private text or unapproved disclosures.
- If something fails, keep the error reference and describe the step; do not send private text, credentials or raw AI output. Your text and earlier saved conditions should remain available for safe recovery.

Actual acceptance remains pending the user's observations. Historical FF03 error responses have not been reconstructed, and publication alone is not proof that every AI response will be accepted.

## Generic guide continuation

Start with “Let’s go to a restaurant” even if you do not know the day or cost. The saved starting point should show proposed choices and important unknowns. If asked something you cannot answer, select Not sure—suggest options, then Let AI update the draft. If the question belongs to participants’ private needs, select Ask each person privately and submit that request. These help buttons fill an explicit answer; they do not silently call AI. Saved public answers appear in a collapsible history. An unchanged answer to a repeated question should not be resubmitted as another paid call. The same behavior should work for a trip or shared purchase; use the [behavior reference](FF03/gold-standard.md).
