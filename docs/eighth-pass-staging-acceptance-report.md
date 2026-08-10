# Eighth Pass — Staging Acceptance Report

Date: 2026-08-10
Assessment: **NOT READY FOR STAGING**

## Executive result

The mandatory staging identity gate failed safely. The repository maps only `default` to `c3s-system`, the local app environment targets the same project, and the authenticated Firebase account contains no separately identified C3S staging project. Because `c3s-system` is not proven non-production, no indexes, rules, Functions, Hosting, Auth users, or data were deployed or changed.

This result supersedes the prior “ready for controlled staging” code-readiness classification: the application is locally ready to enter staging, but the required isolated infrastructure does not yet exist. Real HTTPS acceptance therefore remains blocked rather than assumed.

## Staging project used

None. Read-only Firebase CLI discovery found one C3S project, `c3s-system`, plus unrelated projects. No C3S project was named or configured as staging. `c3s-system` was not selected as a substitute.

## Changes made in this pass

- Added `lib/environment-core.ts` with testable fail-closed environment binding rules.
- Added `lib/environment.ts` runtime binding against Expo config and Firebase project ID.
- Updated Firebase initialization to refuse staging/production project mismatches.
- Updated Expo config to embed one environment-binding block and name staging builds `C3S STAGING`.
- Added visible STAGING markers to shared C3S headers and sign-in.
- Added `scripts/verify-staging-target.mjs` and `npm run verify:staging`; it requires an exact `staging` alias plus distinct declared staging and production IDs.
- Added one application test covering staging-to-production and unknown-project rejection.
- Updated the staging deployment checklist with an explicit provisioning gate and clean-cache build requirement.

No backend schema, Firestore rules, indexes, Functions, or production feature flags changed during this pass.

## Deployment results

| Component | Result |
|---|---|
| Firestore indexes | NOT DEPLOYED — staging identity gate failed |
| Firestore rules | NOT DEPLOYED — staging identity gate failed |
| Functions (`executeProductionAction`, alerts, holds) | NOT DEPLOYED — staging identity gate failed |
| HTTPS application/Hosting | NOT DEPLOYED — staging identity gate failed; Hosting is not configured in `firebase.json` |
| Auth accounts/profiles | NOT CREATED OR MODIFIED |
| Storage | NOT USED OR MODIFIED |

## Acceptance results

Real-service results for roles, full lifecycle, Thermal, Chill, QA, Packaging, Alerts, Holds, delays, handoff notes, retry, two-session concurrency, refresh persistence, HTTPS browser routes, floor widths, iOS, logs, and performance are all **BLOCKED**. The full test-by-test record is in `docs/staging-acceptance-results.md`.

Local evidence remains strong:

- Full Prep → RTC → Thermal → Chill → QA → Packaging → Complete emulator lifecycle: PASS.
- Hold block/release, idempotency, retry, and concurrency in the lifecycle suite: PASS.
- Firestore rules security: 13/13 PASS.
- Application behavior: 19/19 PASS.
- Functions unit behavior: 11/11 PASS (the emulator-only case is exercised separately).
- Clean-cache staging-labeled production-mode web export: PASS, 34 static routes. It used a deliberately nonexistent placeholder project ID only to validate compilation and isolation logic; it was not hosted and made no Firebase deployment.

## Defects

- High: STG-001 — no isolated C3S staging Firebase project; unresolved acceptance blocker.
- Medium: STG-002 — Metro environment cache reuse; fixed with embedded binding, runtime refusal, and required clean-cache environment export. Retest passed.
- Critical: none found locally, but real staging discovery is incomplete.

See `docs/eighth-pass-staging-defects.md` for reproduction and retest details.

## Dependency risk

The required re-check found the same unresolved root tree: 14 High and 17 Moderate advisories, 0 Critical. They are concentrated in Expo/Metro/React Native build and development paths and require an Expo/React Native compatibility upgrade; this pass intentionally did not perform a major upgrade. Functions reports 8 Moderate and no High/Critical advisories. No real staging app existed with which to assess practical exposure, so risk disposition is unchanged and remains technical debt for the compatibility-upgrade pass.

## Required next action

An authorized Firebase owner must create or identify an isolated C3S staging project and complete the prerequisite section in `docs/staging-deployment-checklist.md`. At minimum it needs Firestore, Email/Password Auth, Functions, Hosting, a Web App config, explicit staging/production IDs, a `staging` CLI alias, and individual staging-only Operator/Supervisor/QA/Admin accounts. Then rerun this pass from index deployment onward.

## Explicit confirmations

- No production Firebase project was deployed.
- No production data was read for acceptance, copied, or modified.
- No production migration ran.
- No production feature flags were globally enabled.
- No staging deployment occurred because staging could not be conclusively identified.
- The repository remains isolated from production by a newly added fail-closed runtime and CLI preflight.
