# Local plan request remains disabled

**Date:** 2026-09-22  
**Area:** Local negotiation tutorial / loopback API  
**Status:** Fixed and verified

## Summary

The tutorial cannot reliably reach step 6. After all three synthetic participants appear to have confirmed the current setup, the shared room remains in `COLLECTING` instead of changing to `READY`. The Maya screen therefore keeps **Request local plan** disabled.

Nina’s exception offer is not displayed because exception offers are created only after a successful `REQUEST_SOLVE` command.

## Observed evidence

The local API log first showed stale-tab failures while participants acted in sequence:

```text
nina SUBMIT_INPUT_DRAFT -> STALE_CONTEXT
maya CONFIRM_INPUTS -> STALE_CONTEXT
leo CONFIRM_INPUTS -> APPLIED
```

After refreshing and retrying, Nina’s input and setup confirmation succeeded. The final public snapshot showed:

```text
status="COLLECTING"
setup="maya:confirmed,leo:confirmed,nina:confirmed"
```

This is inconsistent with the expected `READY` state. No `REQUEST_SOLVE` command was sent because the UI disables the button whenever the public status is not `READY`.

## Expected behavior

Once Maya, Leo, and Nina have each:

1. submitted input;
2. confirmed the reviewed intervals; and
3. confirmed the current setup;

the room should report `status="READY"`. Refreshing Maya’s tab should then enable **Request local plan**. A successful request should create Nina’s scoped exception offer.

## Reproduction outline

1. Start the frontend and local API.
2. Complete the tutorial input and review steps across Maya, Leo, and Nina.
3. Refresh before each participant action.
4. Confirm the current setup for all three participants.
5. Refresh Maya’s tab.
6. Observe that the terminal can report all three participants as confirmed while the public status remains `COLLECTING` and the request button remains disabled.

## Related behavior

Each accepted setup command changes the control version. Other participant tabs become stale after that command, so the next participant must refresh before acting. This explains the earlier `STALE_CONTEXT` errors, but does not explain the final `COLLECTING` status after all three confirmations are reported.

## Prior workaround

Refreshing Maya and clicking **Confirm current setup** again may force the readiness calculation. If the status remains `COLLECTING`, the API room should not be restarted while preserving the current investigation because restarting the local API resets its in-memory room.

## Fix

The application now recomputes the derived readiness status when serving a public room snapshot, while preserving terminal and active proposal states. A regression test covers a room whose internal confirmations are complete but whose stored status is stale.

The local owner form also now supplies the intended synthetic availability coverage: Maya can use the 11:00 and 14:00 slots, Leo can use the 10:00 and 11:00 slots, and Nina can use all slots while marking 11:00 as negotiably unavailable. This prevents the local solver from either asking for clarification about unreviewed slots or avoiding Nina’s exception entirely.

Restart the local API to load the fix. Because the local repository is in memory, the restart creates a clean room and the tutorial must be replayed.

## Verification

The complete local negotiation now reaches `READY`, creates Nina’s exception offer, publishes the proposal, records three separate acceptances, and completes the agreement flow. `npm run check` passes with 30 browser tests and 173 unit/integration tests.

## Scope and privacy

The diagnostics use only fixed non-production participant labels, command types, status values, and counts. They do not log private availability conditions, exception text, grant IDs, or credentials.
