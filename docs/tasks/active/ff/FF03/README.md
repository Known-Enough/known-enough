# FF03 — Generic AI decision guide and recovery

Status: PUBLISHED / user manual acceptance pending.

Start with an incomplete idea, such as a meal with no day or budget selected. The public architect now favors small tentative choices or one essential public-scope question, while private participant needs remain separate. The UI shows the saved starting point and earlier public answers, offers explicit suggestion/private-later help responses, blocks unchanged answers to repeated normalized questions and shows actual AI-request progress. Help buttons prepare user text only; selecting Update explicitly sends it. No restaurant-specific algorithm or strict-schema bypass.

Runtime/frontend source `32f3e11`, frontend [38780870859](https://github.com/Known-Enough/known-enough/actions/runs/38780870859) SUCCESS/Amplify98. [Publication receipt](../../../../review-artifacts/FF/generic-guide-publication.json). Build completed; no tests/model/signup calls by A. Prompt effectiveness and full manual journey remain unverified. The repeated-question guard handles normalized exact repeats, not all semantic paraphrases.

[Generic gold standard](gold-standard.md) defines the desired journey and meal/trip/purchase variations without prescribing exact model wording or winners. The existing private interpretation/proposal/approval flow remains; this is not a new solver or real-world venue/pricing lookup. A implementation claim released. See [ticket](ticket.md) and [manual checklist](../manual-checklist.md).
