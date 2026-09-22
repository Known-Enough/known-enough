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

1. In Maya’s tab, select **is available**. Keep duration at **30 minutes** and cost at **0**, then click **Submit input draft**.
2. Refresh if needed, repeat the same selection and submission for Leo.
3. In Nina’s tab, keep the option requiring an exception. Keep duration at **30 minutes** and cost at **0**, then click **Submit input draft**.
4. Visit each participant’s tab, refreshing first. Under **Confirm reviewed inputs**, inspect and check every displayed interval, then click **Confirm these reviewed intervals**.
5. After all three participants have confirmed inputs, revisit each participant, refreshing before each action, and click **Confirm current setup**.
6. Refresh Maya’s tab and click **Request local plan**.
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

The owner form’s duration selector edits private input. It is not an organizer action that revises the shared decision. The complete revision/invalidation flow still needs separate integration verification.

## Record a failure

If a step fails, record:

| Field | Value |
| --- | --- |
| URL | The exact page URL, including query parameters |
| Action | The button clicked or keyboard action used |
| Visible message | The exact message shown in the UI |
| Expected result | What the step should have shown or changed |

