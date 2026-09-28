# Technical debt

This folder tracks intentionally deferred defects that still matter for a stated boundary.

`READY` means the debt is recorded and can be scheduled when its trigger is reached. It does not mean the affected implementation passed review or is safe for live or release use. Each item names the work allowed during deferral and the conditions that require closure.

## Queue

| ID | Status | Item | Required before |
| --- | --- | --- | --- |
| [TD-KE10-01](TD-KE10-01-stop-commit-race.md) | READY — deferred | A model proposal transaction may commit after runtime stop returns | Any live Bedrock evaluation or release-grade use of the KE10 runtime |
