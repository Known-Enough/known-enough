# Testing

Use the toolchain and dependency installation in [development setup](development.md). The root [package scripts](../package.json) define these checks:

| Command | Coverage |
| --- | --- |
| `npm run check:references` | Imported reference checksums |
| `npm run check:planning` | Historical fixture arithmetic |
| `npm run lint` | ESLint and import boundaries |
| `npm run typecheck` | TypeScript |
| `npm test` | Unit and integration tests |
| `npm run build` | Production build and bundle privacy checks |
| `npm run test:e2e` | Browser tests; requires an existing build |
| `npm run check` | All checks, including hosted-preview and browser coverage |

Install Chromium before running browser checks:

```sh
npx playwright install chromium
```

Minimal Linux systems may need `npx playwright install --with-deps chromium`. Browser checks use port **4173**. A documented fallback on hosts unsupported by bundled Chromium is `PLAYWRIGHT_CHANNEL=chrome npm run check`, with Google Chrome installed; record the actual browser/version.

## Known failures and scope of evidence

The full suite has recorded failures. They remain open and have not been rerun or repaired as part of the README editorial change.

- The [ALX02 report](review-artifacts/ALX02/report.md) records 32 full-suite failures reproduced by test name on its `1d45162` baseline, plus adjacent browser failures. See [full output](review-artifacts/ALX02/full-check.txt) and [validation details](review-artifacts/ALX02/validation.json) for the recorded results.
- The [E2E04 report](review-artifacts/E2E04/20261020T162508Z/report.md) qualifies six cases across an execution run and targeted follow-up. It is not a fresh full-suite run or a reliability measurement; two unrelated baseline assertions were excluded.

These reports describe their original artifacts and dates. They do not establish the current checkout's full-suite status. Passing local checks also does not establish Cognito, Bedrock, deployment, or live participant acceptance.
