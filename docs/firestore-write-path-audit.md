# Firestore Write-Path Audit

Date: 2026-08-10. This inventory covers application repositories, operational wrappers, callable Functions, and development scripts. Read-only functions are omitted.

## Pass 7 disposition

The RTC, Thermal, Chill, QA, packaging, equipment-allocation, and final-completion rows below have now moved to the shared `executeProductionAction` callable. Direct client writes to `prep_queue`, `chill_logs`, `qa_checks`, `packaging_logs`, `operational_items`, and `operational_events` are denied. Equipment occupancy is server-managed; only narrow supervisor/admin configuration remains client-writable. Planning edits remain client-writable, but RTC linkage/status fields are protected and can only be changed by the server handoff transaction.

## Classification

- **Safe client write**: append-only or narrowly scoped data with authenticated identity and server timestamp enforced by rules.
- **Client write with stricter rules**: bounded mutation whose role, immutable fields, and state can be checked by rules.
- **Server-orchestrated write required**: stale-state or cross-document consistency requires trusted transactional logic.

## Collection inventory

| Collection / document | Initiating screens and actions | Repository functions | Allowed roles | Fields written and trust | Multi-document | Previous weakness / current rule | Classification and enforcement |
|---|---|---|---|---|---|---|---|
| `users` / profile | Admin provisioning; self display-name change | `createUser`; auth profile update | Admin creates/deletes; self may change `name`; admin/supervisor administer | role, active, department, name, createdAt | No | Self could previously create/elevate; now self diff is `name` only | Client write with stricter rules; privileged provisioning should move to admin tooling before go-live |
| `products` / legacy product | Product administration | `createProduct`, `updateProduct`, `deactivateProduct`, `reactivateProduct`; seed scripts | Admin/supervisor through `isAdmin` | product configuration and active flag | No | Already admin-only | Client write with stricter rules |
| `product_profiles` | Product Profiles configuration | `createProductProfile`, `upsertProductProfileAt`, `updateProductProfile`, deactivate/reactivate | Admin/supervisor | production-critical configuration | No | Already admin-only | Client write with stricter rules |
| `weekly_plan` | Planning create/edit/delete; Send to RTC links/status | create/update/delete plan, `markWeeklyPlanRtcCreated`, `updatePlanStatus`, `linkPlanToPrepQueue`, `sendPlanToRTC` | Supervisor/admin | plan fields; immutable createdBy/createdAt; createdAt is server timestamp | Send to RTC also creates prep and event | Broad signed-in writes removed; immutable creator/time enforced | Simple planning edit: stricter client rule. Send to RTC: server orchestration required |
| `prep_queue` | RTC readiness; Thermal assignment/cook/check/evacuation; Chill/QA/Packaging stage handoff; formal hold mirror | create/start/ready/hold/move, smokehouse/cook/check functions, QA/packaging functions, OItem wrappers | Operator/supervisor for RTC/Thermal/Chill; QA for QA outcome; Packaging for packaging; admin | status/stage, equipment, checks, hold mirror; source identity/start fields immutable | Frequently with weekly plan, equipment, chill, QA, packaging, canonical item, events | Broad signed-in write removed; active role, valid state movement, protected identifiers, no delete | Simple check fields: stricter client rule. Every cross-stage or equipment operation: server orchestration required |
| `operational_items` | All canonical stage actions; formal holds | `patchOItem`, wrappers, create; secure callables | Active operational roles; hold resolution QA/supervisor/admin | canonical stage/status/version/hold; audit transitions | Mirrors legacy records and events | Transactional stale check added; valid transitions and hold roles enforced | Server orchestration required for transitions/holds. Same-state presentation fields may remain constrained client writes |
| `smokehouses` | Thermal equipment assignment/start/finish/repair | create/ensure/repair; cook batch functions | Operator/supervisor/admin update; supervisor/admin create | status/currentLoadId/cleaning/setup; name immutable | With prep/canonical/event | Broad signed-in write removed; allowed-field diff and role enforced; delete denied | Assignment/start/finish server-orchestrated; setup administration stricter client write |
| `chillers` | Chill assignment/completion; equipment setup | create/ensure; assign/finish chill | Operator/supervisor/admin update; supervisor/admin create | status/currentLoadId; name immutable | With chill log/prep/QA/event | Broad signed-in write removed | Assignment/completion server-orchestrated; setup stricter client write |
| `cook_logs` | Thermal cook logging | `createCookLog` | Operator/supervisor/admin | immutable cook snapshot | No | Broad writes removed; create-only | Safe client write once actor field is added; currently Medium migration item because legacy shape lacks actorId |
| `chill_logs` | Thermal evacuation; Chill assign/check/deviation/complete | create/assign/check/flag/resolve/finish functions | Operator/supervisor/admin | status, chiller, checks, deviation, sign-out; prep identity immutable; creation time server-managed | With chiller/prep/QA/event | Broad signed-in write removed; exact mutable fields and roles enforced | Checks may remain stricter client writes; assign/finish requires server orchestration |
| `qa_checks` | Chill completion creates; QA approve/hold/resubmit/notes | create, review, resubmit, append note | Production role may create only ready-for-QA; QA/supervisor/admin update | linked prep/timestamp immutable; review timestamp server-managed | With chill/prep/packaging/event | Broad signed-in write removed; QA role and field allowlist enforced | QA decision is server-orchestrated; append-only note model recommended instead of rewriting `notes` |
| `packaging_logs` | Start, complete, hold/resume, notes | start/complete/hold/resume/append | Packaging/supervisor/admin | linked IDs/start immutable; completion time server-managed; result counts/status/notes | Start updates prep; completion adds event | Broad signed-in write removed; role and field allowlist enforced | Completion/result may be stricter client write; start and stage completion require server orchestration |
| `operational_events` | Every operational repository action; manual resolve | record/create/resolve | Active roles create; supervisor/admin resolve | new writes bind `actorId` to auth and `createdAt` to request time; only resolution fields mutable | Side effect of most actions | Previously arbitrary signed-in rewrite/delete; now actor-bound create, narrow one-way resolve, no delete | Safe append-only client write; server should generate events for server actions |
| `alerts` | evaluator detection/recurrence/automatic resolution; operator acknowledgement | sync/detect/resolve/acknowledge | Active operational roles; resolution QA/supervisor/admin | deterministic identity, actor-bound lifecycle timestamps | Paired with alert event | Existing lifecycle rules retained | Client transaction with stricter rules; automatic evaluation should eventually run server-side |
| `alert_events` | alert lifecycle | alert repository | Active roles | actor uid and request time; immutable | Paired with alert | Append-only and actor-bound | Safe client write when paired rule succeeds; server preferred for atomic lifecycle |
| `hold_events` | place/review/release | hold repositories and secure callables | Place: operational roles; resolve: QA/supervisor/admin | actor uid and request time; immutable | Paired with operational/prep item | Append-only and actor-bound | Server-orchestrated write required |
| `delays` | record/clear delay | delay repository | Active operational roles | stable item+stage ID, start/clear actor and request time, occurrence; original start immutable on clear | Paired with delay event | Unique active delay and one-way clear/reopen enforced | Client transaction with stricter rules; feature-gated |
| `delay_events` | delay start/reopen/clear | delay repository | Active operational roles | actor uid/request time; immutable | Paired with delay | Append-only | Safe client write only within paired transaction; feature-gated |
| `handoff_notes` | Shift Handoff note | handoff repository | Active operational roles | author uid/request time; note ≤500; ≤25 item refs | No | Append-only; no edit/delete | Safe client write; feature-gated |
| `mutation_receipts` | Callable idempotency | secure Functions only | Admin SDK only | uid/action/item/request/result/server time | Paired with server action | New; all client access denied | Server-only |

## Sensitive multi-document operations

| Operation | Current documents | Decision |
|---|---|---|
| Send plan/manual entry to RTC | weekly plan where present + prep + canonical item + event + receipt | Implemented in shared server transaction |
| Allocate/assign/start/check/finish cook | prep + smokehouse + canonical item + event/chill log + alert side effects + receipt | Implemented in shared server transaction |
| Assign/check/complete chill | chill log + chiller + prep + QA + canonical item + event/alert side effects + receipt | Implemented in shared server transaction |
| QA decision/resubmission | QA check + prep + canonical item + event/alert side effects + receipt | Implemented in shared server transaction; QA role enforced |
| Start/complete packaging and batch | packaging log + prep + canonical item + event/alert side effects + receipt | Implemented in shared server transaction; packaging role enforced |
| Formal hold place/release | canonical item + prep mirror + immutable events + receipt | Implemented in callable Functions; client use is staging-feature-gated |
| Canonical transition | canonical item + immutable event + receipt | Implemented in callable Functions; remaining specialized payload adapters are required |
| Alert lifecycle | alert + immutable event | Existing client transaction is enforceable; server evaluator recommended later |
| Delay lifecycle | delay + immutable event | Existing transaction/rules are adequate while feature-gated |

## Development-only writes

`seed-dev`, product seeders, normalization, Planning flow-test cleanup, smokehouse repair, duplicate cleanup, and `resetOperationalData` are not production workflows. Seed/normalization scripts require explicit developer credentials and must target staging/emulator only. UI flow-test and repair controls are compiled behind `__DEV__`. Firestore now denies collection deletion in normal client roles, so destructive helpers fail closed against deployed rules.
