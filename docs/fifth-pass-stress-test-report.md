# C3S Fifth-Pass Stress-Test Report

Date: 2026-08-10
Scope: local development code and development-only scenario data in `c3s-preview`
Production impact: none

## Executive result

C3S remained readable and internally consistent during the crowded local scenario. Shared urgency, freshness, transition, and equipment-availability rules now drive the principal operational surfaces. Alert and hold audit protections were verified against the Firestore emulator. The optimized Thermal query no longer needs an undeclared compound index and no longer emits the former rejection/fallback diagnostic.

No production deployment occurred. No production data was modified. No production migration ran. No production feature flag was globally enabled.

## Stress harness

The development-only framework in `lib/stress/scenarios.ts` activates only in development through `?stress=chaotic-shift`, `?stress=empty-shift`, or `?stress=all-equipment-unavailable`. It supplies local operational items, equipment, chill logs, QA state, and alert state. Planning returns an isolated empty local plan because reliable planning profiles are not part of the scenario contract. A visible banner identifies local read-only mode. Canonical writes are rejected while a scenario is active.

The chaotic scenario contains 22 batches, 21 equipment records, four simultaneous cooks, two batches waiting for chill, one active chill, one QA hold, ten packaging-backlog items, four recently completed batches, unavailable/cleaning equipment, and several distinct critical conditions.

## Scenario results

| Scenario | Setup | Expected | Actual behavior and fixes | Coverage / limitation |
|---|---|---|---|---|
| Multiple simultaneous cooks | Four products in ovens with normal, approaching, overdue, and deviation states | Important issue first; stable alerts; readable cards | Thermal showed all four; Home and Production prioritized overdue/deviation conditions; distinct deterministic alerts remained separate | Browser desktop/mobile; alert identity and sorting unit tests |
| Approaching timing requirement | Existing configured cook duration at normal, near, and exceeded elapsed times | Warning, overdue, acknowledge without safety claim, resolve only after valid action | Shared presentation produces warning/critical states; acknowledgement preserves the active condition; recurrence reopens the stable identity with incremented occurrence | Unit coverage; no food-safety threshold was added |
| Overdue required check | Cook exceeded its configured expected duration | Critical route to batch; successful action clears; failed action does not | Home, Alerts, and Production Item all surface the same critical item; harness failure retains state; resolution helper requires condition clear | Full UI mutation against emulator remains future integration work |
| Oven becomes unavailable | Oven G unavailable while assigned; other ovens occupied/unavailable | No silent reassignment; conflict visible | Equipment and handoff show the unavailable oven and assigned batch; production remains assigned; no automatic reassignment exists | Reliable planning reassignment forecasting is intentionally not implemented |
| No chiller capacity | Two thermal handoffs, one active chiller, remaining chillers occupied, cleaning, or unavailable | Block normal progression; one alert; accurate capacity | Awaiting-chill items are critical; Chill shows 2 waiting/1 running; local chiller choices expose no usable scenario capacity; Home/handoff surface risk | Legacy Chiller model has only idle/chilling/cleaning, so detailed “unavailable” remains canonical overview data |
| Chiller cleaning | Chiller 9 cleaning | Cannot select as available; exclude from capacity | Shared selector accepts only `Available`; Cleaning is visually distinct and excluded from available count | Unit and browser coverage |
| Competing chiller demand | Multiple near-term handoffs with no free local capacity | Surface only reliable conflict | At Risk, Alerts, Equipment, Chill, and handoff expose current contention | No speculative time-window forecast; Planning scenario remains isolated/empty |
| QA hold and release | QA hold with actor, time, reason, and pre-hold state | Unmistakable hold; block progression; release to prior state | Hold appears on Home, Production, QA, Alerts/Holds, item detail, and handoff; resolution restores recorded previous state | Firestore role tests plus concurrency harness |
| Unauthorized hold resolution | Operator attempts resolution; QA resolves | Hide/reject operator; preserve record | UI permissions deny operator resolution; Firestore rejects it; QA update succeeds; direct self-role escalation is rejected | Emulator verified |
| Packaging backlog | Ten batches with increasing wait durations and a long name | Oldest recognizable; avoid alert flood | Production and Home rank backlog without making every item critical; long names wrap at 320 px | Browser crowded scenario |
| Multiple critical alerts | Several simultaneous conditions, including distinct conditions on one item | Consistent severity order and identity | Shared multi-condition helper preserves condition-per-item identity; Alerts and Home use the same urgency ordering | Unit and browser coverage |
| Shift change with open issues | Active cook/chill, acknowledged alert, hold, equipment issue, recent completions | Useful one-screen summary | Handoff shows active, waiting, held, critical, acknowledged, unavailable equipment, risk, and recent completion data | Handoff note mutation remains feature-gated |
| Network failure during action | Injected disconnect during transition/acknowledgement/hold operations | No optimistic success; no state change; retry data retained | Harness throws “Nothing was saved,” preserves authoritative state, and accepts a later retry | Behavior-level harness; browser network interception was not used against live repositories |
| Connection restored | Same request ID retried after reconnect | One event/mutation | Successful retry records once; repeated request ID is ignored | Unit coverage |
| Two users act concurrently | Concurrent acknowledgement and hold-resolution attempts | One winner; stale loser rejected | Emulator produced one acknowledgement winner; hold harness produced one resolver; canonical transaction rejects stale status/stage | Legacy collection mutations are still multi-document operations; see High limitation |
| Shift refresh/restart | Browser reload during crowded production | Reconstruct from durable/local truth | Scenario reconstructed the same batches and priorities after reload | Browser verified |
| Empty and extreme states | Empty shift and all equipment unavailable | Useful state; no crash | Both scenarios rendered; no blank screens or overflow | Browser verified |
| Rapid/double tap | Same request ID submitted repeatedly | One transition/event | Immediate request idempotence recorded one transition and one acknowledgement | Unit harness; not coordinate-double-clicked on production controls |
| Cross-stage actions | Cooking→complete and QA→cook attempts | Reject invalid transitions | Shared transition contract and Firestore rules reject shortcuts; valid cooking→awaiting-chill succeeds | Unit + emulator |

## Issues found and classification

### High

- Legacy collections (`weekly_plan`, `prep_queue`, `smokehouses`, `chill_logs`, `qa_checks`, and `packaging_logs`) still use broad signed-in write rules. Canonical `operational_items` is now transition-validated and transactionally stale-checked, but completely trustworthy multi-document operations require server-side orchestration or narrower legacy rules coordinated with repository changes.

### Medium

- The local scenario originally allowed specialized Chill, QA, and Planning reads to fall through to configured data. Those reads are now isolated or locally synthesized while stress mode is active.
- Canonical item updates previously used caller-provided state without an authoritative transactional read. They now reject stale clients in a transaction.
- The legacy equipment schema cannot represent “Unavailable” separately from occupied/cleaning on every specialized selector. The canonical Equipment view preserves the distinction; a schema deployment is needed for parity.
- Delay and handoff-note persistence are implemented and rules-tested but remain feature-gated until rules/index deployment and UI authorization review.

### Low

- ESLint reports 32 pre-existing unused-variable/unused-disable warnings and zero errors. No warning was introduced as a build blocker.
- Planning stress mode intentionally has no predictive schedule because the harness has no trustworthy profile/schedule contract.

No Critical issue remained after this pass.

## Thermal query diagnostic

Cause: `stage == thermal` plus `createdAt desc` required a compound index that was not declared. The broad fallback hid the missing-index problem after logging it.

Fix: query by stage equality only and sort the small stage result set by `createdAt` in the repository. The fallback was removed. Browser logs showed no index/query/fallback diagnostic, and the solution requires no production index deployment.

## Persistence contracts

### Delays

Stable identity is `item + stage + delay`. The document stores reason, stage, start/clear actors, server timestamps, derived duration, status, and occurrence. Append-only `delay_events` preserve lifecycle history. Reopen increments occurrence. Client-forged actors/timestamps and duplicate clear are rejected. Persistence is disabled by default with `EXPO_PUBLIC_ENABLE_DELAY_PERSISTENCE=false`.

### Shift handoff notes

Notes use `date + shift` identity, author from authentication, server timestamp, optional unique item references (maximum 25), and a 500-character limit. Notes are append-only; edits/deletes are disallowed, avoiding silent shared-text overwrite. Persistence is disabled by default with `EXPO_PUBLIC_ENABLE_HANDOFF_NOTES=false`.

## Firestore rules and indexes

- Added active-role operation checks, actor binding, and server-time checks.
- Prevented users from self-elevating roles; self-updates are limited to `name`.
- Added valid canonical production transitions and stage/status pairing.
- Formal hold placement/resolution remains role-bound and returns to the recorded pre-hold state.
- Added immutable `delay_events` and `handoff_notes`; protected delay lifecycle fields.
- Added the handoff-note `handoffId ASC, createdAt DESC` development index.
- Added local Firestore emulator configuration on port 8085.

## Tests and validation

- Unit/behavior tests: 18 passed.
- Firestore emulator/rules tests: 6 passed.
- Total automated tests: 24 passed, 0 failed.
- Concurrency: one-winner alert acknowledgement verified in emulator; one-winner hold resolution and idempotent transition retry verified in the local harness.
- TypeScript: passed (`npx tsc --noEmit`).
- ESLint: passed with 0 errors and 32 warnings.
- Expo web export: passed; 34 static routes exported.
- `git diff --check`: passed.
- Browser smoke tests: 11 operational routes at desktop plus 48 crowded route/viewport checks at 430/390/360/320 px.
- Responsive result: zero horizontal-overflow failures, zero blank pages, and zero visible buttons below 40 px in the tested route states.
- Reload/extreme checks: crowded state restored; empty shift and all-equipment-unavailable states rendered correctly.
- Java/emulator: Firebase CLI 15 requires JDK 21. `/opt/homebrew/opt/openjdk@21` was used successfully; no system-level Java installation was performed.

## Files changed in this pass

- Scenario/behavior: `lib/stress/scenarios.ts`, `lib/stress/harness.ts`, `components/stress-scenario-banner.tsx`, `components/data-freshness.tsx`.
- Shared truth: `lib/operations/core.ts`, `lib/operations/summary.ts`, `lib/production/presentation.ts`, `lib/alerts/repository.ts`.
- Persistence: `lib/delays/*`, `lib/handoff-notes/*`, `lib/firebase/models.ts`, `lib/firebase/collections.ts`, `lib/firebase/repository.ts`.
- Canonical repository/query: `lib/operational-items/repository.ts`.
- UI: Home, Production, Production Item, Alerts, Holds, Equipment, Thermal, Planning, and Shift Handoff routes.
- Security/config: `firestore.rules`, `firestore.indexes.json`, `firebase.json`, `.env.example`.
- Tests/tooling: `tests/alert-hold-core.test.ts`, `tests/firestore.rules.test.mjs`, `scripts/run-tests.mjs`, `package.json`, `package-lock.json`.
- Evidence: `artifacts/fifth-pass/*.png`.

The worktree already contained the prior four uncommitted passes; this list identifies the fifth-pass scope rather than claiming all current diff files originated here.

## Production rollout prerequisites

1. Review and deploy rules/indexes to a staging Firebase project.
2. Run the same emulator suite in CI with JDK 21 and a cached emulator JAR.
3. Refactor or server-orchestrate legacy multi-document transitions before tightening their broad rules.
4. Enable delay persistence in staging, exercise start/clear/reopen, then add its minimal UI.
5. Enable append-only handoff notes in staging and verify role visibility.
6. Decide whether equipment needs a canonical `unavailable` state migration; document and stage any migration without destructive rewriting.
7. Repeat concurrent device tests against staging before production deployment.

## Explicit confirmations

- No production deployment occurred.
- No production data was modified.
- No production migrations ran.
- No production feature flags were globally enabled.
- No existing production transition rule was bypassed.
