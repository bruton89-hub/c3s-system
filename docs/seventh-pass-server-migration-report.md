# C3S Seventh Pass — Server Migration and Dependency Remediation Report

Date: 2026-08-10
Scope: local/development code and emulators only.
Readiness classification: **Ready for controlled staging**, subject to the ordered deployment checklist and explicit acceptance of the remaining SDK/toolchain dependency advisories. This is not a production approval.

## Outcome

The two Pass 6 High blockers were addressed:

1. Critical RTC, Thermal, Chill, QA, equipment, and Packaging workflows now submit intent to one authenticated `executeProductionAction` callable. Canonical and related writes execute in a Firestore transaction with active-profile checks, role checks, expected-state checks, immutable audit creation, alert side effects, and an idempotency receipt.
2. Compatible dependency remediation removed every Critical advisory and reduced the root audit from 43 vulnerable package entries to 31 (Critical 3 → 0, High 21 → 14, Moderate 18 → 17, Low 1 → 0). The remaining High entries are Expo/React Native build, Metro, configuration, or CLI dependency chains requiring an SDK-major change; they are not production callable/runtime dependencies. That risk still requires staging-owner acceptance.

## Workflow inventory and migration

| Action | Previous client entry and repositories | Authoritative documents / effects | Expected state and role | Server validation and audit | Result |
|---|---|---|---|---|---|
| Send planned batch to RTC | Planning → `oItemSendPlanToRTC` → weekly plan, prep, canonical, event in separate calls | `weekly_plan`, `prep_queue`, `operational_items`, `operational_events`, receipt | unlinked plan; operator/supervisor/admin | duplicate linkage, active role, server actor/time | Migrated atomically |
| Manual RTC entry | RTC → client-created prep then canonical | prep, canonical, event, receipt | valid configured product/PO/dates/positive quantities | payload, actor/time, idempotency | Migrated atomically |
| RTC start/handoff | RTC → legacy prep mutation then canonical patch | prep, canonical, event, receipt | RTC staging/staged/prepping/ready; operator/supervisor/admin | expected stage/status/updatedAt and supported destination | Migrated atomically |
| Allocate oversized oven load | Thermal → client split/occupancy sequence | parent/child prep and canonical items, oven occupancy, event, receipt | Thermal-ready parent; available compatible oven | capacity from existing setup type, conflicts, remaining racks | Migrated atomically |
| Assign oven | Thermal wrapper + prep/equipment/canonical writes | prep, oven, canonical, event, receipt | Thermal-ready; operator/supervisor/admin | unavailable/cleaning/occupied rejection | Migrated atomically |
| Verify load | Thermal → prep then canonical | prep, canonical, event, receipt | assigned Thermal item | actor bound to authenticated uid | Migrated atomically |
| Start Cook | Thermal → prep/oven batch then canonical | prep, oven, canonical, event, receipt | assigned; matching unconflicted oven | stale state, equipment conflict, hold blocking | Migrated atomically |
| Thermal checks | 50°F, 130°F, critical temperature, smoke, duration client writes | prep, canonical, operational/alert events, receipt | cooking (verify load permits assigned); operational roles | ordering, uniqueness, configured target, payload, hold/stale checks | Migrated atomically |
| Finish Thermal | evacuation + cook finish + chiller log + oven release + canonical | prep, oven, chill log, canonical, events/alerts, receipt | cooking with existing required checks | supported evacuation, matching occupancy, no duplicate downstream record | Migrated atomically |
| Assign Chiller / Start Chill | Chill and Chiller Load direct log/equipment writes | chiller, chill log, canonical, events/alerts, receipt | awaiting chill; operator/supervisor/admin | available/idle, no occupancy conflict, stale/hold checks | Migrated atomically |
| Chill check | Chill/Chiller Load direct log then canonical | chill log, canonical, events/alerts, receipt | in chill; operational roles | positive finite check data and expected state | Migrated atomically |
| Complete Chill | log completion, chiller release, QA creation, prep/canonical handoff | chiller, chill log, QA check, prep, canonical, events/alerts, receipt | in chill; operational roles | matching state, single QA result, trusted actor/time | Migrated atomically |
| QA approve/hold/review | QA check then canonical patch | QA check, prep, canonical, events/alerts, receipt | ready for QA; QA/supervisor/admin | supported decision, role, stale/hold state | Migrated atomically |
| QA resubmit | QA check then canonical | QA check, canonical, event, receipt | QA hold/review-required; QA/supervisor/admin | corrective note required | Migrated atomically |
| Start Packaging | QA check → packaging log then canonical | packaging log, prep, canonical, event, receipt | ready for packaging; packaging/supervisor/admin | role, expected state, duplicate receipt | Migrated atomically |
| Complete Packaging / Batch | packaging log then canonical packaging status | packaging log, prep, canonical Complete state, event, receipt | packaging in progress; packaging/supervisor/admin | positive cases/units, role, expected state | Migrated atomically through Complete |

Formal hold placement and release continue through the Pass 6 callables. Their client fallback was removed: the app now fails closed if the secure service is unavailable.

## Shared callable contract

`executeProductionAction` accepts `action`, `itemId` (or `planId`), expected stage/status/update time, payload, and a request ID. It:

1. requires Firebase Authentication;
2. loads the canonical user profile and rejects missing/inactive profiles;
3. checks the action-specific role allowlist;
4. loads canonical and related state in one transaction;
5. rejects stale state or a formal hold;
6. validates the existing workflow and payload requirements;
7. updates every authoritative related document atomically;
8. appends an operational event with `actorUid`, `actorRole`, `action`, `itemId`, `batchId`, previous/resulting state, server time, and request ID;
9. stores a server-only mutation receipt; and
10. returns the canonical result.

Error categories are mapped without stack traces: unauthenticated, inactive-user, permission-denied, stale-state, invalid-transition, validation-error, equipment-conflict, and internal. Operator UI messages distinguish stale state, validation rejection, equipment conflict, network failure, and server unavailability.

## Idempotency and concurrency

- Receipt identity is `uid + requestId`; clients derive a stable request identity from action, item, expected update version, and payload.
- A retry with the same receipt returns the original result without another transition or audit event.
- Firestore transactions re-read canonical state. Concurrent requests with different IDs cannot both commit the same expected version.
- Emulator verification: two simultaneous Start Cook calls produced one winner and one stale loser; replay of the winner returned the original receipt; only one Start Cook audit event existed.
- A pre-hold stale request failed both while held and after release because the canonical version had changed.

## Direct client writes removed or blocked

The RTC, Thermal, Chill, QA, Packaging, and Chiller Load screens use canonical wrappers backed by callable Functions. The Planning developer flow no longer executes legacy transitions. Direct client writes are denied for:

- `prep_queue`
- `chill_logs`
- `qa_checks`
- `packaging_logs`
- `operational_items`
- `operational_events`
- server-managed smokehouse/chiller occupancy

Legacy repository implementations remain temporarily as non-routed compatibility/schema references for migration review, but deployed rules reject them. No application route invokes them for migrated workflows. They should be deleted after the controlled staging client-version cutoff confirms no old client remains.

Planning create/edit/delete remains a narrow client write for supervisor/admin. Its server-managed status/linkage fields cannot be changed by clients. Equipment configuration remains limited to supervisor/admin while status/current-load fields remain server-owned. Alerts, delays, and append-only handoff notes retain their separately constrained lifecycle rules.

## Rules and index changes

- Canonical workflow collections now deny all client writes.
- Planning linkage/status fields are protected.
- Equipment occupancy cannot be changed by an operator client; supervisor/admin may change only configuration fields while occupancy remains identical.
- Existing alert/delay/handoff rules remain active.
- Added the `operational_items(assignedSmokehouse, stage)` compound index needed by transactional oven-allocation conflict checks.

Rules emulator: **13/13 passing**, including direct-bypass attempts for RTC, Thermal, Chill, QA, Packaging, holds, equipment occupancy, operational audit history, and privilege escalation.

## Full lifecycle and held-workflow result

The emulator lifecycle passed:

Prep/Planning → RTC staged → prepping → Thermal ready → oven assignment → concurrent Start Cook → Thermal checks → finish Thermal → chiller assignment → Chill checks → complete Chill → QA approval → start Packaging → complete Batch.

The test also inserted a formal hold while cooking, proved the old in-flight request stale, released to the recorded pre-hold cooking state, proved the pre-hold request remained stale after release, and then resumed using current canonical state. Oven and chiller ended idle, audit history was continuous, and no duplicate Start Cook event existed.

## Dependency remediation

### Fixed safely

Compatible patch/transitive updates included Expo 54.0.36, `@xmldom/xmldom` 0.8.13, `@grpc/grpc-js` patched lines, `protobufjs` 7.6.5, `shell-quote` 1.10.0, `tar` 7.5.22, `undici` 6.28.0, `websocket-driver` 0.7.5, patched `ws` lines, and patched `brace-expansion` lines. `npm dedupe` removed an unnecessary nested Expo 57 peer tree and restored one consistent SDK 54 graph.

The three initial Critical entries (`shell-quote`, `tar`, `websocket-driver`) are fixed. No major framework upgrade was made.

### Remaining root advisories (31 package entries)

| Severity | Packages | Classification / disposition |
|---|---|---|
| High (14) | `@expo/cli`, `@expo/metro`, `@expo/metro-config`, `@react-native/community-cli-plugin`, `@react-native/metro-config`, `expo`, `form-data`, `image-size`, `metro`, `metro-config`, `metro-transform-worker`, `postcss`, `react-native`, `react-native-reanimated` | Expo/Metro/config/build chains or root test tooling. npm recommends Expo 57 or an incompatible React Native downgrade for most. `react-native-reanimated` 4.1 has no later compatible patch; 4.2 requires a separate compatibility pass. Not exposed as a C3S server callable. Compensating controls: no untrusted Metro/build input in staging, build workers restricted, no dev server in deployment, production bundle is static, staging-only risk acceptance. |
| Moderate (17) | `@expo/config`, `@expo/config-plugins`, `@expo/prebuild-config`, `@google-cloud/firestore`, `@google-cloud/storage`, `expo-asset`, `expo-constants`, `expo-linking`, `expo-router`, `expo-splash-screen`, `firebase-admin`, `gaxios`, `google-gax`, `retry-request`, `teeny-request`, `uuid`, `xcode` | Transitive Expo/Firebase Admin/config chains. Registry remediation recommends an SDK major or unsafe Firebase Admin downgrade. Inputs are application-defined, Functions use fixed schemas rather than user-supplied protobuf descriptors, and storage APIs are not used by the callable engine. Reassess during SDK 57 and Firebase Admin upstream upgrade work. |

### Functions package

Functions audit: **8 Moderate, 0 High, 0 Critical** across `@google-cloud/firestore`, `@google-cloud/storage`, `firebase-admin`, `gaxios`, `google-gax`, `retry-request`, `teeny-request`, and `uuid`. The registry’s proposed remediation is an incompatible/older Firebase Admin line; compatible update produced no further fix. The callable accepts fixed JSON payloads, does not accept protobuf schemas, does not expose storage operations, and validates field shapes before Admin SDK writes.

These remaining advisories are not treated as a C3S application High/Critical blocker for controlled staging, but they are a production-review risk item. A tested Expo SDK 57 / React Native compatibility project and Firebase upstream reassessment are required before production approval.

## Tests and validation

Automated tests passing: **43** total.

- application behavior: 18/18
- Functions contract/unit: 11/11
- Firestore rules emulator: 13/13
- full lifecycle/concurrency emulator: 1/1

Validation results:

- TypeScript: pass
- ESLint: pass with 31 pre-existing warnings and 0 errors
- Firestore rules emulator: pass
- Functions emulator: pass; Node 20 loaded all five callable definitions, including `executeProductionAction`
- shared Functions contract tests: pass
- full emulator lifecycle/concurrency: pass
- `git diff --check`: pass
- Expo SDK dependency check: SDK 54 dependency set retained; Expo updated to 54.0.36; local bundled-version map reports dependencies current (network version lookup was unavailable during the final check)
- Expo production web export: pass; 34 static routes emitted to the ignored local `dist-seventh-pass` directory with training/stress flags false
- production-like browser smoke: the in-app browser’s localhost policy prevented it from reaching the localhost-only static server. The export and route manifest were verified, and training/stress code was confirmed fail-closed, but interactive browser smoke remains a staging gate rather than a claimed pass
- dependency audit: root 31 (0 Critical), Functions 8 Moderate (0 High/Critical)

## Files changed in Pass 7

- `functions/src/production-actions.js`
- `functions/src/index.js`
- `functions/test/contracts.test.js`
- `functions/test/lifecycle.emulator.test.js`
- `functions/package.json`, `functions/package-lock.json`
- `lib/security/callables.ts`
- `lib/operational-items/repository.ts`, `lib/operational-items/index.ts`
- `lib/auth/diagnostics.ts`
- `app/(tabs)/prep-queue.tsx`
- `app/(tabs)/planning.tsx`
- `app/(tabs)/chiller-load.tsx`
- `firestore.rules`, `firestore.indexes.json`
- `tests/firestore.rules.test.mjs`
- `package.json`, `package-lock.json`
- `docs/firestore-write-path-audit.md`
- `docs/security-role-matrix.md`
- `docs/staging-deployment-checklist.md`
- this report

## Remaining limitations and staging gates

- Deploy indexes before Functions, then rules, then the staging client; current clients that still write canonical collections directly will fail after rules deployment.
- Keep a rules/functions rollback pair. Rolling rules back alone would re-open the direct-write risk.
- Complete staging App Check and IAM decisions, verify actual role profiles, and pressure-test callable quotas/logging.
- Firebase Functions 6.6.0 loaded successfully on Node 20, but the emulator reports that a newer major Functions SDK exists. Treat that as a separate compatibility upgrade; do not combine it with staging rules/function deployment without regression testing.
- Delete the now-unrouted legacy mutation implementations only after the staging client-version cutoff.
- Obtain explicit dependency risk acceptance for controlled staging. Start a separate SDK 57 compatibility branch before production approval review.
- Run the interactive production-build browser smoke against the staged HTTPS artifact; local browser access was blocked by the test environment’s localhost URL policy.
- Run the migration plan only in staging. No data migration was necessary or executed in this pass.

## Explicit safety confirmation

- **No production deployment occurred.**
- **No production data was changed.**
- **No production migration executed.**
- **No production feature flags were globally enabled.**
- No live Firestore project was targeted; all mutation verification used local emulator data. Although the Functions emulator detected local Application Default Credentials, no non-emulated service was invoked.
