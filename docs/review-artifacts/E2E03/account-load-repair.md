# Account-load resilience repair

Status: PUBLISHED and live account-loading path verified for both synthetic users.

The latest hosted run observed `/account/profile` HTTP 200 followed by `/account` HTTP 503. Source inspection found that account status also synchronously ensures the immutable username directory entry, while own-profile reading does not. A directory read/write failure or conflicting retained entry can therefore make status unavailable even when the account itself remains readable. This is a possible cause; the historical 503's precise server cause has not been confirmed.

The status path keeps the existing alias repair attempt. If it fails operationally, it reads the authenticated owner's account again under the existing atomic revision conditions, original deadline and request budget. It does not retry the alias mutation, replace a foreign claim, approve an account, trust profile status as authority, or serve cached admission. Authentication/authorization errors still propagate; unreadable or invalid account data still fails.

Deferred lookup repair and remaining account-status errors now log allowlisted codes and the server request reference, without usernames, email addresses, tokens or private answers.

Validation: `npm test -- packages/adapters/src/partition-group-session.test.ts` passed 86/86, including a new case where a conflicting derived username entry does not prevent an authenticated owner account read and no username claim is written. Coordinated API publication passed in [run 39298683902](https://github.com/Known-Enough/known-enough/actions/runs/39298683902); schedule restoration passed in [run 39298891247](https://github.com/Known-Enough/known-enough/actions/runs/39298891247). Live U1 and U2 sign-ins each loaded groups and returned `GET /account` HTTP 200 in [E2E03 rerun](20261019T180154Z/report.md). No model request or email was made. The broader E2E03 remains BLOCKED at the decision modal's loading-state assertion; its report records the actual evidence.
