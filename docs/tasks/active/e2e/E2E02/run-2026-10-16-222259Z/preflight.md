# E2E02 preflight — E2E02-20261016-222259Z

- Run start: 2026-10-16T22:22:59Z.
- Runner: single assigned `gpt-6-luna`; serving build/version not exposed.
- Toolchain: Node.js v24.21.0 (downloaded from the official Node.js distribution and SHA-256 verified), Playwright 1.63.0, Google Chrome for Testing 153.0.8010.12.
- Repository source: `3a31b7c03ed032b08e1d582a8f620e77de2bea68` (`main`, clean at start).
- Primary site: `https://main.d143q5ravxp5av.amplifyapp.com/`.
- Expected/deployed frontend source: `2e5902f44f10f2b68dd3f7905a79ba4c8b7aa95c`, Amplify job 111; release job [38963388395](https://github.com/Known-Enough/known-enough/actions/runs/38963388395) succeeded. All five saved public frontend asset hashes were fetched from the primary URL and matched `tests/live/targets.json` at 2026-10-16T22:22:16Z.
- Expected/deployed API artifact SHA-256: `9b0badc58d00d3855735bc36cd300ccff6710486510f243d2f357236a1e81a87`; backend release job [38963203435](https://github.com/Known-Enough/known-enough/actions/runs/38963203435) succeeded. Public smoke check step succeeded in [38964421870](https://github.com/Known-Enough/known-enough/actions/runs/38964421870); its separate report-generation step failed.
- Credentials file: `/home/battousai/.known-enough/e2e-credentials.json`, present, mode 0600, owner `battousai:battousai`, 120 bytes; two account records with nonempty username/password fields. Values were not printed or copied into this run folder.
- Runtime USERNAME permission: read-only staging inspection artifact from [38964421870](https://github.com/Known-Enough/known-enough/actions/runs/38964421870), observed 2026-10-16T20:44:42Z, reports `USERNAME partition read=false; conditional transactional write=false`. Policy attempt [38964718851](https://github.com/Known-Enough/known-enough/actions/runs/38964718851) completed 20:47:20Z with `iam:put-role-policy/AccessDenied`, `iamWrites=0`; subsequent independent readback was `PARTICIPANT_POLICY_READBACK_MISMATCH` against the candidate, confirming the permission update did not occur. No policy changes were attempted by E2E02.

The exact deployment baseline was verified before authenticated UI actions. The missing USERNAME permission blocks invitation scenarios 07 and 15 per the runbook; it does not block the independent cases.

Post-preflight observation at 2026-10-16T22:29Z: both authenticated users reached `/groups` but the deployed dashboard rendered a groups-loading error before any `/invitations` request. The earlier expectation that independent group journeys were unblocked is superseded by this observed dashboard/client-path failure; see [the completed run report](report.md). E2E02 made no invitation or other application writes.
