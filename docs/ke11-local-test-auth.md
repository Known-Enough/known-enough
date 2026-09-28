# KE11 local test authentication and invitations

This is a local QA path for the fictional Christmas scenario. It does not sign in a real person, use Cognito, or connect the hosted CloudFront preview to shared state. The test-user picker lets any local tester choose any fictional account; it proves app behavior for separate server-bound test identities, not protection against a person deliberately selecting Maya.

## Run it

Use the pinned Node 24.21.0 and npm 11.19.0 versions. In one terminal, start the loopback API on the web app's expected port with `PORT=8788 node scripts/run-local-api.mjs`. Confirm its startup message says `http://127.0.0.1:8788`. In another terminal, run `npm run dev` and open `http://127.0.0.1:5173`. The API listens only on loopback. The HTTPS hosted preview at CloudFront remains a static mock and has no invitations or shared application state.

Choose one of the fictional accounts: Maya (organizer), Leo, Nina, Ana, Raul, or Shared display. No password, email, AWS account, or participant identity is involved. Maya can create a local invitation link for one pending participant. Open that link in another browser tab/context on the same computer, choose the matching fictional account, and accept the invitation. The API checks that the signed test session subject matches the invited participant. The display account can view the public snapshot and cannot write commands.

For simultaneous participant testing, use separate browser profiles/private windows or Playwright browser contexts. A normal new tab can inherit the current tab's session. If the invitation opens under the wrong test account, sign out, select the invited account, then accept it.

The link is a local development URL. Sending it to another computer will not make that computer connect to this loopback API. No email or external message is sent.

## Expiry, retry and recovery

- Test sessions last 15 minutes, are held in that browser tab's `sessionStorage`, and are not refreshed. Signing out, expiry, or a 401 response clears the local session. Sign in again to get a new one.
- An invitation lasts 24 hours. Its random token is stored server-side only as a hash. The one-time plaintext is returned only when Maya creates the link. The UI puts it in the URL fragment, removes the fragment from the address bar before redemption, and does not send it in the HTTP request URL or application logs.
- Redemption is safe to retry with the same link and the same signed test account after a lost response. Another test account receives the same not-found response as an invalid, expired, or replaced link.
- If Maya loses the one-time link before sharing it, retrying without replacement reports that a live invite may exist. Select **Replace current link** and retry; this invalidates the old token and returns a new link. An expired link can be replaced by issuing again without that checkbox. Replacing a link is explicit because any holder of the prior link loses access.
- If an invitee reloads or closes the tab before redeeming, the fragment has already been removed and the pending token is not persisted. Maya must replace the unredeemed link. After redemption, reloading is safe while the local API process remains running.
- Stopping the local API discards all scenario data and rotates the in-memory signing key. Existing sessions and invitation links then stop working; start again and use the fresh scenario.

These sessions and links are development-only. Do not enter real participant data or treat this flow as managed authentication, multi-device sharing, or operational acceptance. KE11 remains paused before Cognito configuration and browser acceptance; explicit authorization is required for AWS identity-resource changes. No cloud resources or paid calls were used for this local slice.
