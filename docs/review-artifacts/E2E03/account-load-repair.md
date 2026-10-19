# Account-load resilience repair

Status: CODE_READY; focused local regression passed. Not deployed or verified on the live site.

The latest hosted run observed `/account/profile` HTTP 200 followed by `/account` HTTP 503. Source inspection found that account status also synchronously ensures the immutable username directory entry, while own-profile reading does not. A directory read/write failure or conflicting retained entry can therefore make status unavailable even when the account itself remains readable. This is a possible cause; the historical 503's precise server cause has not been confirmed.

The status path keeps the existing alias repair attempt. If it fails operationally, it reads the authenticated owner's account again under the existing atomic revision conditions, original deadline and request budget. It does not retry the alias mutation, replace a foreign claim, approve an account, trust profile status as authority, or serve cached admission. Authentication/authorization errors still propagate; unreadable or invalid account data still fails.

Deferred lookup repair and remaining account-status errors now log allowlisted codes and the server request reference, without usernames, email addresses, tokens or private answers.

Validation: `npm test -- packages/adapters/src/partition-group-session.test.ts` passed 86/86, including a new case where a conflicting derived username entry does not prevent an authenticated owner account read and no username claim is written. No browser/live request, AI, email, cloud change or deployment occurred in this check. The earlier E2E03 live result remains BLOCKED; live behavior still awaits a coordinated runtime publication and a fresh read.
