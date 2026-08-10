# Security Schema Evolution Plan

No production migration was executed. Current rules accept existing records for reads; new trusted writes add optional `actorId`, `version`, and idempotency receipts.

## Affected records

- `operational_items`: optional integer `version`, initialized by the first secure callable.
- `operational_events`: new events include authenticated `actorId`; historical events remain readable and immutable.
- `mutation_receipts`: new server-only collection; no backfill.
- Delay and handoff collections: additive, feature-gated, no legacy records required.

## Non-destructive rollout

1. Export the target staging database and record counts/checksums.
2. Run a read-only dry-run script that reports missing/invalid optional fields without logging production content.
3. If version backfill is desired, write `version: 0` only where absent, in bounded batches, with a deterministic run ID and checkpoint.
4. Never rewrite historical event actor/time fields. Historical records without `actorId` remain legacy audit entries; corrections are new corrective events.
5. Validate counts, stage/status pairs, hold links, equipment assignments, and a sample of timelines before enabling secure transitions.
6. Roll back application/rules/functions versions if necessary; leave additive optional fields and receipts intact.

The backfill is idempotent because it changes only missing `version` fields to `0`. It must refuse to run if the configured project ID is not the explicitly approved staging project. Production execution requires a separate reviewed change and approval.
