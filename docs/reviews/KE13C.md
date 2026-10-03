# KE13C hosted-preview review

- Verdict: **PASS**, reported on `a5d1833..a625498`.
- Reviewer: the user confirmed that Sol performed the review. The supplied report identifies the reviewer session as Codex GPT-6; exact model variant and effort were not exposed. Do not claim this was `gpt-6-astra` / high. The ticket had requested Astra/high; the user explicitly accepted this review as sufficient for KE13C.
- Human acceptance: the user explicitly accepted KE13C on 2026-09-27. This accepts the hosted-preview build only; it does not mark KE13 live operations accepted.
- Scope: full source diff and the generated hosted artifact in `/tmp/known-enough-stage0-guard`.

## Evidence reported by the reviewer

- An in-memory build using `write:false` reproduced the three committed output files byte-for-byte. The module graph excluded owner screens/adapters, local API code, backend packages and private fixtures. The listed local identity, API-origin and private-fixture markers were absent.
- The committed hosted browser test passed. Thirty-two additional navigations covered encoded, duplicated, malformed and oversized query strings at `/` and `/hosted-preview/index.html`. Every run retained the collecting fixture with zero API calls, WebSockets, identity headers, owner links or page errors.
- The runbook uploads all of `apps/web/dist-hosted-preview/`; the nested default document and root-relative asset paths match.
- Fresh pinned checks reported: typecheck, lint, 94 import-boundary checks, seven reference hashes and hosted bundle scan passed. The full application suite was not rerun by the reviewer; the author’s earlier full `npm run check` evidence remains dated in [KE13C](../tasks/historical/previous-batches/KE13C/ticket.md).
- No source, artifact, AWS resource, permission set or acceptance status was changed by the reviewer.

## Non-blocking gaps and limits

1. The permanent hosted browser test does not fail on same-origin API requests.
2. The hosted bundle scanner does not include the private-fixture markers checked by the ordinary bundle scanner.

The reviewer’s additional probes covered these gaps for the exact artifact. The author left the reviewed source and generated bundle unchanged so this PASS continues to refer to the same code. These permanent-check improvements remain follow-up work; they do not block this accepted preview build. No live AWS deployment or operational acceptance is established.

## Current artifact hashes

The accepted local output currently has these SHA-256 hashes:

| Output | SHA-256 |
| --- | --- |
| `hosted-preview/index.html` | `574954696e5098f34cfedb1fda0e2942f7df781a4e07e58bc6adb366a51c32fe` |
| `assets/index-CohlOwP-.js` | `eccc59393bcda465c1dfa3e20f38fe28f7013ef21be998323cb095db061de379` |
| `assets/index-Bh2GWqRh.css` | `786e7c506ddb978f62cac8cc40ea0e67e28e74489701c9d8dc76ace55c2fee23` |

These hashes identify the current build; the reviewer’s reported byte-for-byte reproduction did not include hash values.
