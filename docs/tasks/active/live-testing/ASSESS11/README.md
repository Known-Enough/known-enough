# ASSESS11 — Fix public signup and make failures traceable

The user tried to sign up and saw **“An error was encountered with the requested page.”** Find which page fails, explain the cause, fix it and verify the actual public signup path on phone and desktop. A passing signup test on the separate QA website does not prove the normal website works.

**Both paths fail:** The user now also reports failure through **Register with email** → **Create account**. The supplied screenshot shows the form's generic registration error. Both failures are [logged in a sanitized issue record](../../../../review-artifacts/ASSESS11-user-signup-failures.json); their underlying cause remains unknown.

**Requested password change:** Allow passwords of at least six characters without mandatory capitals, numbers or symbols. Update the form, login service settings and tests together; verify the actual deployed rules. This change is queued and has not been applied.

**Clarified path:** **Sign in or register** opens a login page that also offers **Sign up**, while the app separately offers **Register with email**. Check this competing route first and make account creation and sign-in clear. The later [first UI review](../../ui-ux/UX01/README.md) starts with the same case; it must verify the actual fix rather than repeat it.

**Status:** RESERVED / B; ASSESS07's claim was explicitly released. Dedicated worker `01a10636-13ed-7d10-ab42-c0f27cb76942` (“ASSESS11 — Sol Max worker”) completed read-only intake with Full Access/never; creation selected Sol/Max, runtime model/effort unexposed. Synchronize its actual assignment before the explicit implementation start. Preserve ASSESS07's pending live proof and A's NP00 claim.

**Next step:** Identify the exact site/button and collect safe browser request details; compare the deployed login settings with the existing GitHub reports. The [ticket's debugging map](ticket.md#where-the-debugging-data-is) names the reports, source files and AWS log locations, and marks what is still unknown. Preserve passwords, email addresses and login tokens privately.

[Full ticket](ticket.md) · [Shared board](../../../../task-board.md) · [Claim log](../../../../claim-log.md)
