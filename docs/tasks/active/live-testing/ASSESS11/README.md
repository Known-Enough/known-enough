# ASSESS11 — Fix public signup and make failures traceable

The user tried to sign up and saw **“An error was encountered with the requested page.”** Find which page fails, explain the cause, fix it and verify the actual public signup path on phone and desktop. A passing signup test on the separate QA website does not prove the normal website works.

**Clarified path:** **Sign in or register** opens a login page that also offers **Sign up**, while the app separately offers **Register with email**. Check this competing route first and make account creation and sign-in clear. The later [first UI review](../../ui-ux/UX01/README.md) starts with the same case; it must verify the actual fix rather than repeat it.

**Status:** READY / unclaimed; next priority before ASSESS10 and OPS. The existing ASSESS07 worker keeps its claim until completion or an explicit safe handoff. Do not start a second implementation worker or wait for all seven ASSESS07 journeys to pass before investigating this blocker.

**Next step:** Identify the exact site/button and collect safe browser request details; compare the deployed login settings with the existing GitHub reports. The [ticket's debugging map](ticket.md#where-the-debugging-data-is) names the reports, source files and AWS log locations, and marks what is still unknown. Preserve passwords, email addresses and login tokens privately.

[Full ticket](ticket.md) · [Shared board](../../../../task-board.md) · [Claim log](../../../../claim-log.md)
