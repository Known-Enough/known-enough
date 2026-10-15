# Debugging decision drafts

Use the error reference displayed by the decision guide. A and B can read the project’s sanitized diagnostics through GitHub using their own accounts; no AWS login or CloudShell command is needed.

## Read one failed request

From the repository, paste the actual reference in place of `PASTE_ERROR_REFERENCE`:

```bash
gh workflow run decision-draft-diagnostic.yml \
  --repo Known-Enough/known-enough --ref main \
  -f source_sha="$(gh api repos/Known-Enough/known-enough/commits/main --jq .sha)" \
  -f request_id=PASTE_ERROR_REFERENCE \
  -f lookback_minutes=60
```

Open **GitHub → Actions → Read recent primary draft failure stages → latest run → Summary**. The summary gives a timeline and readable validation details; the `draft-failure-readback` artifact contains the matching JSON. Increase the window up to 120 minutes if needed. Leave `request_id` blank to list recent failures. A failed source check means main changed during dispatch: refresh the source and run the read-only command again.

This workflow only reads logs. It never creates a decision, calls AI, sends email, changes permissions or retries a failed request. A missing match or an incomplete bounded window is reported explicitly and does not mean the request succeeded. Failures from before detailed logging was deployed lack exact-reference/field details; their raw answers cannot be reconstructed.

## What is recorded

The primary API writes to CloudWatch group `/aws/lambda/known-enough-stage-api` in `us-east-1`:

- `FIX01_PUBLIC_DRAFT_DIAGNOSTIC`: request start, provider dispatch/completion, model validation failure, saved outcome and request finish.
- `FIX01_PUBLIC_DRAFT_FAILURE`: terminal phase/reason and schema validation details.
- `PUBLIC_DRAFT_HTTP_RESULT`: the final saved/failed HTTP result with the same opaque reference returned to the browser.

Records include the server-generated reference, installed source SHA, elapsed time, provider acknowledgement, token counts and stop reason when available. Validation records contain bounded field paths/indexes, framework issue codes, expected/received types and allowlisted unexpected field names. For example, a malformed response could produce `rules[0].values: invalid_type; expected array; received string`. This is an illustration, not evidence of a particular historical failure.

Passwords, tokens, emails, subjects, group/decision IDs, raw prompts/model answers, private inputs and raw error messages/stacks are excluded. Unknown field names are masked. Full provider invocation logging stays disabled. Diagnostics cannot authorize anything, change request disposition or launch a retry. The reader uses the existing inspector role and reconstructs the same safe allowlist before writing GitHub output.

Exact-reference run [38803481971](https://github.com/Known-Enough/known-enough/actions/runs/38803481971) verified live correlation and reported `variables[1].options` missing without recording raw content. That proves the logging path, not successful draft generation. The generic grouped transport adds `ARCHITECT_WIRE_SCHEMA` with paths such as `variables.ENUM[0].options`; existing persisted-schema and semantic stages remain. No tests or model probes were executed by A; user manual acceptance is required after publication.
