# Local negotiation tutorial

This tutorial exercises both the mock screens and the current local negotiation flow. The local flow uses fictional test identities and a loopback API; it is not real authentication or a production deployment.

## Start the local services

Use two terminals and keep both processes running.

In the first terminal, start the frontend:

```sh
cd /Users/martelaxe/Blockchain_development/known-enough
nvm use
npm ci
npm run dev --workspace @deal-table/web -- --port 5173 --strictPort
```

In the second terminal, start the local API:

```sh
cd /Users/martelaxe/Blockchain_development/known-enough
nvm use
npm run dev --workspace @deal-table/api
```

The API should listen on port `8787`. Stop it with `Ctrl+C` when a clean room is needed. Restarting the API clears its in-memory room.

## Open the four screens

Open each link in a separate tab:

| Screen | Link |
| --- | --- |
| Shared table | [Open shared display](http://127.0.0.1:5173/?local=display) |
| Maya | [Open Maya](http://127.0.0.1:5173/?view=owner&local=maya) |
| Leo | [Open Leo](http://127.0.0.1:5173/?view=owner&local=leo) |
| Nina | [Open Nina](http://127.0.0.1:5173/?view=owner&local=nina) |

Refresh a participant tab before acting after another participant has changed something. The application rejects stale versions, so work sequentially.

## Complete a negotiation

For a fresh room, answer each interval explicitly using this fictional example. “Unavailable” means **Unavailable; do not ask for an exception**. “Exception” means **Unavailable; you may ask about a scoped exception**.

| Person | Thu 10:00 | Thu 11:00 | Thu 14:00 | Saturday lead | Sunday follow-up | Lead cost | Follow-up cost |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Maya | Unavailable | Available | Available | Available | Available | 3 | 0 |
| Leo | Available | Available | Unavailable | Available | Available | 0 | 1 |
| Nina | Available | Exception | Available | Unavailable | Available | 0 | 0 |

1. In Maya’s tab, select each availability answer and both costs from the table, then click **Submit input draft**.
2. Refresh Leo’s tab, select Leo’s answers and costs, and submit.
3. Refresh Nina’s tab, select Nina’s answers and costs, and submit.
4. Visit each participant’s tab, refreshing first. Under **Confirm reviewed inputs**, inspect the saved conditions and costs, check every displayed interval, then click **Confirm these reviewed intervals**.
5. After all three participants have confirmed inputs, revisit each participant, refreshing before each action. Review the roster, schedule, policy and confirmed inputs, then click **Accept reviewed setup**.
6. Refresh Maya’s tab and click **Find a plan**.
7. Refresh Nina’s tab. The exception should offer **Thursday 11:00–11:30, provided Nina takes neither weekend duty**. Click **Allow scoped exception**.
8. For disclosure, click **Use exception without announcement**.
9. Refresh each participant’s tab, inspect the proposed meeting and assignments, then click **Accept reviewed current proposal**.
10. Refresh the shared display.

Expected result:

- **Agreement recorded for this local example**
- **3 of 3 separate acceptances**
- No published disclosure announcement
- No private conditions or permission receipts on the shared display

## Try the refusal path

Stop the API with `Ctrl+C`, restart it, and repeat the flow until Nina receives the exception. Click **Decline exception** instead of allowing it, then refresh the shared display.

Expected result: no agreement is shown, and the display does not identify which participant declined.

## Check the mock and recovery screens

These examples work without the API:

- [Proposal example](http://127.0.0.1:5173/?public=proposed)
- [Private receipts](http://127.0.0.1:5173/?view=owner&owner=approval)
- [Failure and retry](http://127.0.0.1:5173/?view=owner&owner=failure)
- [Stale state](http://127.0.0.1:5173/?view=owner&owner=stale)

Also test a narrow browser window and keyboard-only navigation using `Tab`, `Space`, and `Enter`.

The owner form’s duration selector edits private input. It is not an organizer action that revises the shared decision. The browser integration tests exercise organizer duration revision through the real API and verify invalidation in the browser; this tutorial does not provide an organizer editing screen.

## Record a failure

If a step fails, record:

| Field | Value |
| --- | --- |
| URL | The exact page URL, including query parameters |
| Action | The button clicked or keyboard action used |
| Visible message | The exact message shown in the UI |
| Expected result | What the step should have shown or changed |
