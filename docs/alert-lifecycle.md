# Operational alert lifecycle

## Implemented model

Persistent lifecycle support uses three collections:

- `alerts`: one current lifecycle document per production item and condition;
- `alert_events`: append-only created, reopened, acknowledged, and resolved audit events;
- `hold_events`: append-only formal hold actions.

The production item remains the source of truth. An alert stores only its identity, routing/presentation context, lifecycle status, and audit pointers. It does not drive production stage or status.

## Stable identity and duplicate prevention

`alertId` is deterministic:

`<operational item id>__<normalized condition key>`

Examples include `thermal-check-overdue`, `waiting-for-chiller`, and `qa-hold`. Firestore transactions create or update that exact document, so refreshes, polling, restarts, and multiple clients converge on one record.

Repeated detection behaves as follows:

- Open stays Open and only `lastDetectedAt`/presentation fields are refreshed.
- Acknowledged stays Acknowledged. Acknowledgement never implies resolution.
- Resolved reopens as a new occurrence on the same stable identity. `occurrence` increments, current lifecycle timestamps reset, and a `reopened` audit event preserves the recurrence boundary.

This model preserves a single searchable identity without discarding prior audit events.

## Resolution

Conditions derived directly from canonical `operational_items` state can resolve automatically when the evaluator no longer detects them. Client-side automatic resolution is restricted to elevated development roles; production should move evaluation and automatic resolution to a trusted scheduled/on-write backend process.

Ambiguous conditions must not be resolved merely because they were acknowledged. Manual resolution is not exposed for conditions whose truth can be evaluated reliably.

## Authorization

Current application capabilities are deliberately small:

- all signed-in users may view;
- active admin, supervisor, QA, operator, and packaging profiles may acknowledge or place a formal hold;
- active admin, supervisor, and QA profiles may resolve a formal hold or perform client-side development resolution.

Anonymous sessions and authenticated users without an active `users/{uid}` profile remain read-only for these actions.

## Environment safety gates

Lifecycle writes are off by default:

- `EXPO_PUBLIC_ENABLE_ALERT_PERSISTENCE=true`
- `EXPO_PUBLIC_ENABLE_HOLD_WORKFLOW=true`

Enable these only in a development project after deploying the new rules and indexes. This prevents a preview build configured for an existing Firebase project from mutating records simply by opening Alerts.

## Production deployment plan (not executed)

1. Create or select a non-production Firebase project and deploy the updated rules/indexes there.
2. Seed active user profiles with supported roles; do not grant lifecycle actions to anonymous users.
3. Enable both flags in the development environment and run emulator/integration tests.
4. Implement a trusted Firestore-triggered or scheduled evaluator for detection and automatic resolution. It must use the same deterministic identity and append audit events.
5. Backfill is optional. Existing legacy alerts can remain untouched; do not destructively migrate them. If history is required, write a reviewed one-time script that creates new-format documents without deleting the source collection.
6. Validate concurrency, security rules, indexes, and role behavior in staging.
7. Only after approval, deploy rules/indexes/backend behavior, then enable client flags. No production deployment was performed in this pass.

## Known server-side requirement

Trustworthy automatic resolution across all roles still requires the backend evaluator described above. Firestore rules validate actor identity, append-only events, role capability, and protected timestamps, but rules cannot independently prove that a production condition has cleared.
