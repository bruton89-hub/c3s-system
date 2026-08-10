# Fourth-pass route audit

This inventory was completed before fourth-pass implementation. Decisions follow the rule that a control must answer: what is happening, what needs attention, what happens next, what can I do, or what happened previously.

| Route | Purpose / target user | Current information and actions | Gaps / duplication / complexity | Fourth-pass decision |
|---|---|---|---|---|
| `/` | Shift command center for all roles | Active/waiting/attention totals, alert previews, active work, Production link | No stage progress, held/critical/equipment totals, risk list, completion history, or global actions | Add compact shift metrics, flow counts, At Risk, Recently Completed, and role-neutral quick links |
| `/production` | Primary batch workspace for operators/supervisors | Stage filters, cards, next action, direct item access | Missing Held filter, search, sort choice, risk/alert indicators | Add Held/Complete, batch-product-equipment search, operational sorts, richer card indicators |
| `/production-item` | Single batch context for all operational roles | Identity, current state, warning, next action, basic details, combined history | Stage-specific facts and checks are not organized; equipment history and timeline are mixed | Add collapsed Process Details, Timeline, Alerts & Holds, Checks, Equipment History, Notes |
| `/notifications` | Actionable alert queue | Lifecycle filters, severity, direct action, audit disclosure | Cannot focus by department/category or recognize recurrence | Add Critical/Thermal/Chill/QA/Equipment/Holds/Resolved group filters and occurrence marker |
| `/holds` | Central hold visibility for QA/supervisors/operators | Missing | Holds are reachable only through items or stage queues | Add active holds plus collapsed recently resolved history and authorized resolution links |
| `/equipment` | Visibility-only resource overview for operators/supervisors | Equipment data scattered across Thermal, Chill, and Chiller Load | No cross-resource availability answer | Add ovens/chillers overview using existing modeled status/assignment only; no controls |
| `/shift-handoff` | One-screen outgoing/incoming shift summary | Missing; data must be manually gathered | No synthesized active/held/alert/equipment/completion view | Add generated read-only summary; omit persisted note until a trusted schema exists |
| `/prep-queue` | RTC preparation and handoff for RTC operators | Queue stages, quantities/details, start prep, ready, thermal handoff, manual entry, hold | Legacy handoff/delete add complexity; recent actions hidden in item detail | Keep safe actions, improve timing/destination/delay visibility, direct item links; keep legacy actions collapsed |
| `/thermal` | Oven/load execution for thermal operators | Assignment, load verification, cook steps, checks, finish/evacuate, hold | Strong execution but limited overview and direct batch navigation; no telemetry abstraction | Add active-oven summary, expected completion/risk presentation, item links, delay link; document disconnected telemetry interface |
| `/thermal-timeline` | Thermal/chiller timing overview for supervisors/thermal | Utilization timeline by day and resource | Events do not deep-link consistently; urgency is difficult to scan | Add active/upcoming/overdue event list with item/action links; retain simple resource view |
| `/chill` | Chill execution for chill operators | Assignment, start, temperature milestones, completion, deviation handling | Current batch context is verbose; hold/delay/item navigation is indirect | Add direct item links, clearer elapsed/expected state, delay/hold access without changing chill validation |
| `/chiller-load` | Chiller capacity/assignment for chill operators/supervisors | Capacity strip, assignment, checks, QA handoff, deviation | Capacity states are visually weak and dispersed | Add status-labeled cards and available/occupied/cleaning language only from reliable records |
| `/qa-review` | QA decision queue | Ready/hold/history sections, reviewer, approve, QA hold, notes, resubmit | Missing queue filters, waiting time, direct batch access | Add Waiting/On Hold/Approved/Recent filters and Open Batch; preserve all QA validation |
| `/(tabs)/qa-review` | Hidden tab alias | Re-exports the QA screen | Duplicate route implementation would drift | Keep as alias only; improve canonical `/qa-review` |
| `/packaging` | Packaging handoff/execution | Ready/in-progress/completed/hold, start, complete, notes | Waiting/arrival/priority are hard to scan; delay/item navigation indirect | Add concise handoff timing/context, item links, and delay/hold routes; preserve existing counts validation |
| `/planning` | Shift plan and board for planners | Weekly plan, forecasts, equipment assignment, operational event modal | Dense, but already has most scheduling data; contention not summarized | Add conflict/overlap summary from explicit planned equipment only; no auto-rescheduling |
| `/products` | Product requirement reference/admin setup | Search/filter, requirements grid, inline editing | Operators can encounter editing affordance without clear role distinction; table is weak on small screens | Make requirements vs current batch context explicit, gate editing by role, provide readable reference cards where narrow |
| `/more` | Secondary navigation | Production tools and advanced tools | Grouping does not match operational mental model and omits new utilities | Regroup into Production, Quality, Planning, System/Training; add Holds, Equipment, Handoff |
| `/batch-timeline` | Legacy local-store batch history | Batch metadata, next action, event timeline, delay | Duplicates canonical Production Item and uses separate local store | Keep for simulation/training compatibility; direct live work to Production Item |
| `/simulation-alerts` | Local training alerts | Local acknowledgement and legacy batch links | Could be mistaken for live state | Keep clearly labeled and grouped under System/Training |
| `/hold` | Formal hold placement/resolution | Reasons, notes, release outcome, role/feature gates | No central entry point or recent hold context | Link from Holds and item pages; preserve supported outcome only |
| `/sign-in` | Auth entry | Email/password sign-in and startup feedback | No operational additions appropriate | Keep focused; no feature additions |
| `/modal` | Expo starter placeholder | No operational purpose | Dead/duplicate surface | Leave unreachable; recommend removal after confirming no external links |

## Cross-route findings

- Canonical live navigation should converge on Production Item; legacy Batch Timeline remains training-only.
- Equipment visibility can be synthesized safely, but equipment control cannot.
- Delay recording already exists through `operational_events`; a shared contextual entry screen can standardize it without inventing state transitions.
- History presentation should use one reusable chronological row rather than bespoke stage timelines.
- Persistent alert/hold writes remain feature-gated. Fourth-pass browser QA must remain read-only.
