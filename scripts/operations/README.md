# Operations recovery foundation

This inactive package supplies the shared recovery/preflight boundary for OPS01–03. It does not apply participant migrations, archive, erasure or model jobs.

`validatePlan` binds a submitted plan to a separately verified source/resource/operation contract. `journalService` uses exclusive creation and revision CAS, preserving progress on duplicate preparation. `dynamoJournal` targets only the dedicated proposed table. `manifestStore` creates content-addressed, private versioned recovery bytes and reads back the exact hash/version before `prepareRecovery` creates or resumes a journal. Operation-specific authority, revision-at-commit and completion/readback remain the caller's responsibility.

`awsTransport` allows only enumerated exact recovery-resource APIs, private JSON/body files, bounded calls and safe errors. `managed-preparation.mjs` accepts only the fixed synthetic recovery probe after own B/main/source/installation checks. It cannot apply a participant operation or mark a journal COMPLETE. Real managed execution remains deferred until installed resources and delegation have been verified.

Run focused checks with pinned Node: `node --test scripts/operations/*.test.mjs`. The full repository `npm run check` is also required at an executable checkpoint. The two GitHub workflows verify the checked proposal or prepare/resume the bounded synthetic probe. Never pass private rows, participant identifiers, credentials or arbitrary commands as workflow inputs/artifacts.

See the [setup/runbook](../../docs/review-artifacts/OPS00/setup-package.md), [operations envelope](../../docs/review-artifacts/OPS00/operations-envelope.md) and [coding-first queue](../../docs/coding-first-plan.md). Installation, effective permissions and managed recovery are UNKNOWN until their actual matching reports exist. Source changes require an independently reviewed plan; they never reset an earlier plan's progress.
