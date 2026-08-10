# C3S Staging Deployment Checklist

No step authorizes production deployment.

## Configuration inventory

- Separate Firebase staging project ID and Auth tenant/configuration.
- Firestore rules: `firestore.rules`; indexes: `firestore.indexes.json`.
- Functions source: `functions/`, Node 20 runtime.
- Public Firebase web configuration supplied through `EXPO_PUBLIC_FIREBASE_*`; these identifiers are not service-account secrets.
- Server credentials come only from the Functions runtime. Do not add service-account JSON to the repository.
- Feature flags default false: alerts, holds, delays, handoff notes, and training tools. Critical production transitions no longer have a client fallback or secure-transition feature flag; they fail closed when Functions are unavailable.
- Staging recommendation: deploy and smoke-test `executeProductionAction`, hold, and alert callables before installing a staging client. Enable delay/handoff notes in a later controlled step; training tools only in explicit development builds.
- Before any Firebase command, configure a `staging` alias in `.firebaserc` and run `C3S_STAGING_FIREBASE_PROJECT_ID=<exact-id> C3S_PRODUCTION_FIREBASE_PROJECT_ID=<exact-id> npm run verify:staging -- <exact-staging-id>`. A failed preflight is a hard stop.
- Build staging with `EXPO_PUBLIC_APP_ENV=staging`, matching `EXPO_PUBLIC_STAGING_FIREBASE_PROJECT_ID`, and a distinct `EXPO_PUBLIC_PRODUCTION_FIREBASE_PROJECT_ID`. Use `expo export --clear` when changing environments so Metro cannot reuse a bundle compiled for another target.

## Staging project prerequisite (currently blocked)

As of 2026-08-10, the authenticated Firebase account exposes no explicitly isolated C3S staging project. The repository has only `default: c3s-system`, and the local environment also targets `c3s-system`. Its production status is not documented, so it must be treated as potentially production and must not be used for staging.

An authorized Firebase owner must create or identify a separate project, then:

1. Record its exact project ID and owner; explicitly identify the production project ID for comparison.
2. Enable Firestore, Email/Password Authentication, Functions, and Hosting. Enable Storage only if a verified C3S path uses it.
3. Add a Firebase Web App and store its public web configuration in a secure staging environment, not in source control.
4. Add `.firebaserc` alias `staging` for the exact staging project; do not change `default` as a shortcut.
5. Configure Functions runtime parameters/secrets and staging-only feature flags. Keep training tools disabled for acceptance unless a test explicitly requires them.
6. Create individual staging-only Operator, Supervisor, QA, and Admin accounts and matching active profiles. Do not use shared credentials.
7. Re-run the preflight above. Only after it passes may the ordered checklist continue.

## Ordered checklist

1. Back up/export staging Firestore if it contains retained test data; record export location and retention.
2. Deploy indexes and wait until each reports Ready.
3. Deploy Firestore rules during a communicated staging maintenance window; immediately run read/auth smoke tests.
4. Deploy callable Functions and verify runtime region, Node version, IAM, and App Check decision.
5. Verify Auth users and active role profiles; explicitly test inactive and missing profiles.
6. Build the staging client with selected flags. Confirm every RTC/Thermal/Chill/QA/Packaging mutation reaches callable Functions. Keep training tools false outside local development.
7. Seed staging-only test data using an explicitly verified staging project ID. Never copy production credentials into seed scripts.
8. Run Home, Production, item, Thermal, Chill, QA, Packaging, Alerts, Holds, and Handoff smoke tests for every role.
9. Run the full Prep → RTC → Thermal → Chill → QA → Packaging → Complete lifecycle plus concurrent cook start, chiller assignment/completion, QA approval, packaging completion, duplicate submission, hold, and stale-transition tests.
10. Verify structured Functions logs contain uid/action/item/result/category and contain no tokens or secrets.
11. Test rollback using the plan in `production-rollback-plan.md`, including disabling secure flags and restoring compatible rules/functions.
12. Obtain security, operations, QA, and product-owner approval before any production change.

## Go-live gate

- All unit, rules, function, build, and staging concurrency tests pass.
- All indexes are Ready and exact deployed rules/functions versions are recorded.
- Role roster is reviewed; no shared admin accounts; inactive departures disabled.
- Every critical transition callable, required index, and fail-closed rule is deployed and verified; no application High/Critical defect remains.
- Staging pressure test and rollback rehearsal pass.
- Monitoring/alerting and write-stop procedure are owned and tested.
- Production backup/export plan, maintenance window, and approvers are recorded.
- The SDK 54 dependency advisory risk acceptance is approved, or the separately tested SDK-major remediation is complete.
