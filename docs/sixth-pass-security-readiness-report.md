# C3S Sixth-Pass Security Readiness Report

Date: 2026-08-10
Scope: local development code, Firestore/Functions emulators, and production-like static export. No deployment or production mutation.

## Outcome

The High issue from pass five—unrestricted signed-in legacy writes—was fixed in development rules. Legacy collections now require active profiles, collection-specific roles, immutable linkage/identity fields, valid state movement, server-managed lifecycle timestamps where supported, and explicit mutable-field allowlists. Deletes are denied for operational/audit data.

A trusted callable layer now covers canonical transitions, formal hold placement, formal hold resolution, and equipment assignment. It authenticates the caller, loads the active role profile, checks expected state/version, validates the action, uses one Firestore transaction, writes actor-bound audit data, creates an idempotency receipt, and returns canonical state. Structured logs contain uid/action/item/result/error category and no tokens or secrets.

C3S is suitable for a controlled staging security deployment, but it is **not production go-live ready**. Remaining cross-document RTC, cook/chill, QA, and packaging adapters and dependency advisories are go-live blockers.

## Firestore write-path audit

The collection-by-collection inventory, initiating screens, repository functions, fields, roles, trust boundary, multi-document involvement, rule weakness, and classification are in [firestore-write-path-audit.md](./firestore-write-path-audit.md).

Summary:

- Safe append-only client writes retained: handoff notes, lifecycle event documents, and narrowly controlled operational-event creation.
- Stricter client writes retained: planning edits, bounded stage check fields, equipment status fields, QA review fields, packaging result fields, alerts, and delays.
- Server required: stage transitions, plan-to-RTC, equipment assignment, formal holds, cook/chill completion, QA disposition, and packaging stage transitions.

## Issues fixed

- Removed `allow read, write: if signedIn()` from weekly plan, prep queue, smokehouses, chillers, chill logs, QA checks, packaging logs, operational events, and cook logs.
- Self profile updates are limited to `name`; self role/active/admin/authority changes fail emulator tests.
- New operational events bind `actorId` to authenticated uid and `createdAt` to request time; prior content cannot be rewritten or deleted.
- Weekly plan creator/time, QA linkage/time, packaging linkage/start, prep identity, and equipment names are protected.
- QA decisions require QA/supervisor/admin; packaging creation and completion require packaging/supervisor/admin.
- Delay start/clear/reopen retains unique item+stage identity, immutable original start on clear, actor binding, request time, and append-only events.
- Handoff notes remain append-only with authenticated author and request time.
- Training navigation is compile/environment gated. Stress scenarios require `__DEV__`; scenario writes throw before canonical mutation.
- Secure Functions reject unauthenticated, inactive, wrong-role, stale, invalid, duplicate, and incompatible-equipment actions.
- User-facing error mapping now distinguishes permission, stale state, invalid transition, network, and secure-service failures without stack traces.

## Functions added

| Callable | Roles | Transaction scope | Idempotency / audit |
|---|---|---|---|
| `transitionProductionItem` | active operational roles | canonical item | uid+request receipt; immutable operational event |
| `assignEquipment` | operator/supervisor/admin | canonical item + oven/chiller + linked prep/chill log | receipt + operational event |
| `placeFormalHold` | active operational roles | canonical item + prep mirror + hold event | receipt |
| `resolveFormalHold` | QA/supervisor/admin | canonical item + prep mirror + reviewed/released events | receipt |

Formal hold client calls switch to Functions only when `EXPO_PUBLIC_ENABLE_SECURE_TRANSITIONS=true`. The flag defaults false and was not enabled globally. Specialized transition adapters remain intentionally disabled until staging validation.

## Rules changes

- Added planning, production, QA, and packaging role helpers based on an active user profile.
- Added immutable field and allowed-field-diff checks for each legacy collection.
- Added valid state checks for prep/canonical movement and protected formal-hold roles.
- Made cook logs create-only and operational events append-only except one-way supervisor/admin resolution.
- Denied all client access to `mutation_receipts`.
- Retained append-only alert, hold, delay, and handoff audit rules and re-ran their regression tests.

## Feature flags

| Flag | Purpose | Default | Staging recommendation | Production recommendation / dependency |
|---|---|---|---|---|
| `ENABLE_ALERT_PERSISTENCE` | durable alert lifecycle | false | enable after rule smoke | enable only with evaluator ownership defined |
| `ENABLE_HOLD_WORKFLOW` | formal hold UI | false | enable with secure transitions | require hold Functions deployed |
| `ENABLE_DELAY_PERSISTENCE` | delay lifecycle | false | limited-role pilot | enable after operational acceptance |
| `ENABLE_HANDOFF_NOTES` | append-only shift notes | false | limited-role pilot | enable after retention review |
| `ENABLE_SECURE_TRANSITIONS` | callable hold/transition boundary | false | enable only after Functions deploy | required before protected workflows go live |
| `ENABLE_TRAINING_TOOLS` | local simulation UI | false and `__DEV__` required | false in staging release build | false |

All disabled flags fail closed. No flag was globally enabled.

## Security tests

- Application behavior/unit tests: 18 passed.
- Firestore emulator tests: 12 passed.
- Functions contract tests: 10 passed.
- Total: **40 passed, 0 failed**.
- Firestore tests cover unauthorized roles, inactive profile, self-privilege escalation, immutable audit records, actor spoofing, timestamp spoofing, invalid transitions, concurrent acknowledgement, delay lifecycle, handoff notes, QA authority, equipment identity, and packaging roles.
- Functions tests cover authentication, inactive/wrong role, stale version, invalid transition, duplicate receipts, successful canonical/audit planning, no mutation on failure, and equipment compatibility.
- Functions + Firestore emulators loaded all four callable definitions successfully on Node 20. No callable was pointed at production or invoked with production data. The emulator warned that host Application Default Credentials exist; all exercised tests were pure/local and no non-emulated service call occurred.

## Dependency findings

No automatic or major upgrade was performed.

- Root audit: 43 advisories (1 low, 18 moderate, 21 high, 3 critical), predominantly transitive Expo/Metro/build-tool dependencies. The reported remediation path includes an Expo 57 major upgrade and therefore needs a separate compatibility pass.
- Functions audit: 8 moderate advisories after lock/install, primarily transitive Google Cloud/Firebase Admin dependencies. `firebase-functions` is pinned within the current 6.6 line; latest is major 7.x.
- Expo 54.0.35 has a compatible 54.0.36 patch available. React Navigation has compatible minor updates. These were documented, not installed.
- No dependency was removed without usage proof. A dedicated Expo-supported dependency remediation pass is required before go-live, prioritizing whether critical root advisories are build-only or reachable in shipped artifacts.

## Secrets review

A filename/pattern scan found no private keys, service-account files, tokens, private certificates, or hard-coded credential-like values in repository source/configuration. `.env`, Firebase local state, service-account patterns, mobile service configs, and private key formats are ignored. Firebase public web identifiers remain environment-provided and are never printed in this report.

## Production-like build

- Expo production-mode web export completed with all persistence/training flags false.
- Normal More navigation contained no Simulation Alerts/System Training entry.
- `?stress=chaotic-shift` did not activate a scenario in the production bundle.
- Direct static training navigation failed closed. The simple local Python static server does not reproduce Expo Hosting rewrites and emitted React hydration warnings on `.html` route aliases; staging hosting rewrite behavior remains a required smoke test.
- Branding and normal operational navigation rendered.

## Schema and migration

No destructive migration is required. Secure callables add optional `version` and `actorId` fields and a server-only `mutation_receipts` collection. The non-destructive, idempotent rollout/validation plan is in [security-schema-migration-plan.md](./security-schema-migration-plan.md). No migration was run.

## Remaining issues and go-live blockers

### High

- Plan-to-RTC, cook start/finish, chill completion, QA disposition, and packaging stage transitions still span legacy/canonical documents through client repository batches. Each needs a callable adapter before production write enablement.
- Root dependency audit contains three critical and 21 high advisories. Reachability and Expo-supported remediation must be resolved or formally risk-accepted before production.

### Medium

- Admin user provisioning is rule-protected but lacks a dedicated audited admin callable.
- Legacy cook logs do not yet contain authenticated actor IDs; new immutable audit conventions should be applied before relying on them as a primary audit record.
- Existing free-form QA/packaging notes are overwritten/concatenated within a mutable document; a future corrective/notes event collection would improve audit quality.
- Hosting rewrites and callable App Check enforcement require staging validation.

No application-level Critical authorization defect was found after the rules change.

## Readiness documents

- [Security role matrix](./security-role-matrix.md)
- [Staging deployment checklist and go-live gate](./staging-deployment-checklist.md)
- [Production rollback plan](./production-rollback-plan.md)
- [Schema evolution plan](./security-schema-migration-plan.md)

## Files changed in this pass

- Security boundary: `functions/package.json`, `functions/src/contracts.js`, `functions/src/index.js`, `functions/test/contracts.test.js`, `functions/package-lock.json`.
- Client boundary/isolation: `lib/security/*`, `lib/training/config.ts`, `lib/operational-items/repository.ts`, `lib/auth/diagnostics.ts`, `app/more.tsx`, `app/simulation-alerts.tsx`.
- Trustworthy writes/models: `lib/firebase/config.ts`, `lib/firebase/models.ts`, `lib/firebase/repository.ts`, `lib/operational-events/index.ts`.
- Rules/config: `firestore.rules`, `firebase.json`, `.env.example`, `.gitignore`, `package.json`.
- Tests/docs: `tests/firestore.rules.test.mjs` and the sixth-pass documentation listed above.

The worktree contains prior uncommitted passes; this is the sixth-pass scope, not a claim that every current diff originated in this pass.

## Explicit confirmations

- No production deployment occurred.
- No production data was changed.
- No migration executed against production.
- No production feature flag was globally enabled.
