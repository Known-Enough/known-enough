# ASSESS11 — Fix public signup and make failures traceable

**Current next step — 2026-10-06:** After PRIV01's local private-path fix, B may claim this task in its existing chat and implement the [separate read-only GitHub helper workflow](../../../../b-next-task-handoff.md). Existing inspector access supports the required reads; A's inactive NP00 is paused and does not block this scoped work. Obtain the actual configuration, fix signup and verify the normal website. No routine human reapproval is needed; older deferred-worker/authorization paragraphs below are historical.

The user tried to sign up and saw **“An error was encountered with the requested page.”** Find which page fails, explain the cause, fix it and verify the actual public signup path on phone and desktop. A passing signup test on the separate QA website does not prove the normal website works.

**Both paths fail:** The user now also reports failure through **Register with email** → **Create account**. The supplied screenshot shows the form's generic registration error. Both failures are [logged in a sanitized issue record](../../../../review-artifacts/ASSESS11-user-signup-failures.json); their underlying cause remains unknown.

**Requested password change:** Local browser validation/help and the isolated QA template now prepare a six-character minimum without mandatory character classes. The actual primary and QA pool policies have not been updated or read back. The published primary form still requires sixteen characters.

**Clarified path:** **Sign in or register** opens a login page that also offers **Sign up**, while the app separately offers **Register with email**. Check this competing route first and make account creation and sign-in clear. The later [first UI review](../../ui-ux/UX01/README.md) starts with the same case; it must verify the actual fix rather than repeat it.

**Status:** BLOCKED pending PRIV01, then READY for B's fresh sequential claim. Public signup is not yet accepted; ASSESS07/LIVE04 are DONE and A's inactive NP00 is paused with saved work preserved.

**Historical handback:** Former B worker `01a10636-13ed-7d10-ab42-c0f27cb76942` synchronized the checked local source at `4e72adfed3cd25ccacd52edb2b90a8954645b2ee` and released its claim pending primary configuration readback and the then-separate cloud/publication/email authorization. Creation accepted Sol/Max; runtime model/effort are unexposed. That checkpoint remains source evidence, not live signup acceptance; the current handoff above supersedes its scheduling and approval gates.

**Current execution:** After PRIV01, implement the scoped GitHub helper path and obtain fresh allowlisted primary pool/client readback. Standing authority already covers necessary project repairs and synthetic verification. [The ticket](ticket.md) retains the desktop/phone navigation, hosted form without an email field, pinned checks, earlier authorization/release record and remaining technical criteria. Preserve passwords, email addresses and login tokens privately.

[Full ticket](ticket.md) · [Shared board](../../../../task-board.md) · [Claim log](../../../../claim-log.md)
