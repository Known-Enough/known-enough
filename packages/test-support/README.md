# @deal-table/test-support

Synthetic server/test fixtures for Deal Table. Never import this package or its JSON fixtures into the browser.

`buildTeamTableFixture({ policy?, withGrant? })` returns a fresh solver input for the fictional Maya/Leo/Nina example in [the product plan](../../docs/Deal-Table-TeamTable-plan.md). Defaults are `BALANCE_RECENT_LOAD` and no exception. Time is fixed at `2026-10-01T12:00:00Z`; all dated intervals explicitly use `America/Mexico_City`. Schedule, private conditions, review intervals and grant facts are independent copies so changing a schedule does not silently update existing consent.

The fixture explicitly records reviewed candidate intervals. Nina's hard availability envelope includes Thursday 11:00, while her separate negotiable condition blocks it until the scoped no-weekend-duty exception is granted. Positive hard availability cannot be expanded by that grant. This models the product's conditional availability without disguising a hard constraint as negotiable.

Run from the repository root using the pinned Node/npm versions:

```sh
npm run demo --workspace @deal-table/test-support
npm test -- packages/domain packages/test-support
```

The executable synthetic observer demo calls the production solver for both policies and prints 12 structural candidates, `NO_AGREEMENT` at baseline, two feasible plans after the exception, and these selections:

| Policy | Selected plan | Lead | Follow-up |
| --- | --- | --- | --- |
| LOWEST_INCONVENIENCE | B, Thursday 11:00 | Leo | Maya |
| BALANCE_RECENT_LOAD | A, Thursday 11:00 | Maya | Leo |

The demo is a local observer tool, not the public application or an authenticated consent flow. JSON under `fixtures/` remains contract examples; `src/teamtable-fixture.ts` drives the production solver tests and demo. No real participant data, cloud access or model calls are used.
