# Eighth Pass Staging Defects

Date: 2026-08-10
Scope: controlled staging deployment and HTTPS acceptance
Deployment performed: no

## Defect STG-001 — No isolated C3S staging Firebase project

- Severity: High (acceptance blocker)
- Screen/workflow: environment prerequisite; all real-service workflows
- Reproduction:
  1. Inspect `.firebaserc` and environment bindings.
  2. Query the authenticated Firebase CLI project list.
  3. Observe that the only C3S project is `c3s-system`; no project is identified as staging.
- Expected: a separately owned and explicitly named C3S staging project with Firestore, Auth, Functions, and HTTPS Hosting.
- Actual: repository alias `default` and local config both target `c3s-system`. Its production status is not proven, so it cannot safely be used as staging.
- Fix: an authorized Firebase owner must create or identify a separate staging project and complete the prerequisite section in `docs/staging-deployment-checklist.md`.
- Retest: BLOCKED until an exact staging project ID is supplied and the fail-closed preflight passes.

## Defect STG-002 — Environment switch could reuse a Metro bundle cache

- Severity: Medium
- Screen/workflow: staging build configuration
- Reproduction:
  1. Export once with the existing local environment.
  2. Change only shell-provided Expo public environment values.
  3. Export without clearing Metro's cache.
- Expected: the new environment binding is compiled into the bundle.
- Actual: Metro reused a bundle compiled with the previous Firebase project ID. The new runtime guard detected the mismatch and refused Firebase initialization; no connection or deployment occurred.
- Fix: environment binding is now embedded in Expo config, runtime Firebase initialization fails closed on mismatch, staging builds are visibly labeled, and the checklist requires `expo export --clear` for environment changes.
- Retest: PASS. Clean-cache staging export initialized only with the declared placeholder staging binding and emitted the `C3S STAGING` build name. The placeholder was deliberately nonexistent and was not contacted or deployed.

## Other observations

- ESLint reports 31 existing warnings and 0 errors. None was introduced as a staging security bypass; cleanup remains recommended.
- No Critical defects were found locally.
- STG-001 prevents discovery of real staging-only operational defects. Those tests remain visibly blocked in the acceptance checklist.
