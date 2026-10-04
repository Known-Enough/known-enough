# ASSESS11 — Fix public signup and make failures traceable

The user tried to sign up and saw **“An error was encountered with the requested page.”** Find which page fails, explain the cause, fix it and verify the actual public signup path on phone and desktop. A passing signup test on the separate QA website does not prove the normal website works.

**Both paths fail:** The user now also reports failure through **Register with email** → **Create account**. The supplied screenshot shows the form's generic registration error. Both failures are [logged in a sanitized issue record](../../../../review-artifacts/ASSESS11-user-signup-failures.json); their underlying cause remains unknown.

**Requested password change:** Local browser validation/help and the isolated QA template now prepare a six-character minimum without mandatory character classes. The actual primary and QA pool policies have not been updated or read back. The published primary form still requires sixteen characters.

**Clarified path:** **Sign in or register** opens a login page that also offers **Sign up**, while the app separately offers **Register with email**. Check this competing route first and make account creation and sign-in clear. The later [first UI review](../../ui-ux/UX01/README.md) starts with the same case; it must verify the actual fix rather than repeat it.

**Status:** BLOCKED / deferred / unclaimed. Former B worker `01a10636-13ed-7d10-ab42-c0f27cb76942` synchronized the checked local source at `4e72adfed3cd25ccacd52edb2b90a8954645b2ee` and released its claim because current primary configuration readback and separately authorized cloud/publication/email proof are still required. Creation accepted Sol/Max; runtime model/effort are unexposed. This is not DONE or live signup acceptance. Preserve ASSESS07's pending proof and A's NP00 claim.

**Restart condition:** Obtain a fresh allowlisted primary pool/client readback, the user's safe failing-request details and specific authorization for any cloud policy/provider-route change, publication and finite synthetic email test. [The ticket](ticket.md) records the desktop/phone navigation, current hosted form without an email field, pinned checks, exact remaining criteria and verified checkpoint. Preserve passwords, email addresses and login tokens privately.

[Full ticket](ticket.md) · [Shared board](../../../../task-board.md) · [Claim log](../../../../claim-log.md)
