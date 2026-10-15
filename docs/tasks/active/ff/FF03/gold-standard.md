# Generic decision guide — reference journey

This is a behavior specification and manual acceptance guide, not a scripted model answer, executed test or restaurant-specific implementation. The user's agreed plan controls this continuation. No tests/model calls run by A.

## Reference journey: a meal with incomplete plans

The organizer starts: “Let’s go to a restaurant.” The day, cost and preferences are unknown. Accept the idea and describe what is known and undecided. Do not demand that the organizer know everyone’s preferences, availability or private budget. Unknown values are not invalid input.

AI may propose a small set of explicitly tentative, finite shared choices for human review when option generation is enabled. Never invent actual venues, prices, availability, reservations or participant preferences. A proposed spending limit is a planning choice, not a claim about a venue's price. Unknown real-world facts stay unknown until supplied/verified. Do not invent proxy variables for unsupported objectives.

Ask one essential public-scope question at a time. State the actual missing fact. Offer “Not sure—suggest options” and “Ask everyone privately” rather than requiring invented answers. These actions prepare an explicit answer/request for the user to submit; they do not silently call a model. Retain earlier answers and show the saved public starting point. If an already answered question repeats, explain it and prevent resubmitting the unchanged answer in a paid loop. Never pretend a repeated question is new progress.

After review/create, each actual group member confirms the shared frame and privately supplies their own conditions. Fictional examples: one person is available Friday/Saturday with a $25 limit; another Saturday/Sunday with a $30 limit and vegetarian preference. Interpret only the caller’s conditions, let that person review them, and preserve independent confirmation. Never paste these into the shared context automatically.

A useful proposal could identify a compatible day and a provisional spending limit only if those dimensions/options exist in the reviewed frame and the supplied evidence supports them. Real restaurant selection still needs venue information; unknown price/availability prevents a verified booking claim. If new dimensions/choices are needed, surface that gap and require an explicit shared revision/review rather than silently dropping conditions or changing consent.

## Generic rules, not memorized output

- Same code/prompt for a meal, trip or shared purchase; no keyword routing, special names, predefined winning choices or fixed prices/days.
- Initial idea can be short/incomplete. Unsupported objectives get one actionable scope question; missing private preferences alone never blocks a public starting draft.
- Generated choices are proposals. Every participant still confirms the frame and approves independently.
- One visible question at a time; all required answers remain bounded and retained across follow-up drafts/recovery.
- Show actual request progress, saved result, safe failure or uncertainty. Never automatically retry paid/uncertain calls.
- Keep strict schemas and the existing finite-candidate limit. Explain a specific missing bound instead of exposing implementation language as the main onboarding experience.
- Private data never goes into shared questions/history/diagnostics. Existing confirmation and disclosure rules still apply.

## Manual variations to avoid overfitting

1. Meal: no day/budget/options, then “not sure”; allow explicit tentative suggestions without pretending facts are known.
2. Meal: organizer supplies two places and two possible days; retain them after a follow-up instead of asking again.
3. Same question repeated: earlier answer visible, unchanged resubmission blocked, help action available, no automatic provider call.
4. Trip: broad idea with destination undecided; same guidance and privacy boundaries, no meal-specific assumptions.
5. Shared purchase: options supplied, personal spending limit withheld; collect that limit privately later, not from the organizer.
6. Incompatible or unverified conditions: state the unresolved issue; do not announce false agreement or fabricate price/availability.

Acceptance assesses truthful progress and preservation of information, not exact prose or an exact generated proposal. Publication is not proof of live AI quality or a complete new negotiation engine. This continuation improves the shared starting/follow-up guide and reuses the existing private interpretation/proposal/approval machinery; any demonstrated limitations there remain explicit rather than silently bypassed.
