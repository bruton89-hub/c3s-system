# Thermal reload planning

Open **Production Board → Reload plan**. The selected week carries into the planner.
The planner reads that week's production rows and product profiles. It splits rack
totals into house loads, proposes a fixed sequence and shows start, cook completion,
chill completion, cleaning intervals and each house's new-start deadline.

## Operating rules

- Smoke houses: L, M, N, O, H, D and K. F, G, I and J accept steam only.
  Steam products can use smoke houses. A nonempty product smoke-flavor field
  identifies smoke products.
- Maximum 18 racks per house, 12 for semi-wholes (51912), and 15 for semi-halves
  (51913). A smaller product-profile rack limit also applies. Loads retain their
  full profile cook time even when partially filled.
- Paired receiving chillers: L–16, M–15, N–14, O–13, H–9, D–4, K–12, F–7,
  G–6, I–10 and J–11. House C is excluded. Chiller 5 is unavailable.
- Chillers 4–7 use the old-chiller duration. Others use the blast duration.
  An unavailable duration is not replaced with zero or a different duration.
- Blast 8 accepts up to 10 racks, or 12 semi-whole racks. Other routes accept
  one house load at a time. Concurrent shared-load occupancy is not inferred.
- Same-species work needs no changeover, but the next cook cannot finish before
  its receiving chiller clears. Earliest start is the maximum of product readiness,
  house release after any cleaning, and chiller clearance minus the cook duration.
- Species changes receive two hours of cleaning. Mixed-species profiles require
  cleaning between loads because a matching `mixed` label does not establish
  compatible species.
- A house's use window starts with its first cook after cleaning. The draft uses
  an exclusive 24-hour deadline: a start at or beyond expiry requires another
  cleaning. A cook that started inside the window can finish after it expires.
  Routine cleaning duration must be entered; it is not silently assumed.
- Product readiness defaults to 8 a.m. on the production date. A later explicit
  planned start acts as a later readiness time. Overnight loads retain their
  original production date. Starts after the next 8 a.m. are flagged.
- Rerouting is off by default. When enabled, an alternative must advance the
  start or replace an unavailable paired route. The proposal explains the change.
- Equipment toggles immediately regenerate the proposal. Missing profiles,
  invalid times and impossible routes remain visible with unscheduled rack totals.

## Current implementation boundaries

This is a weekly simulation with a clean, empty starting condition. It does not
read current production occupancy or save/start assigned loads. Changing the
scenario never changes equipment, QA or production records. A late planned
readiness time and equipment outage can be modeled without modifying execution.

The pure engine accepts initial house release times, species and window starts,
and initial chiller-clearance times. These inputs support later integration with
server-authoritative operational state. The screen does not yet populate them.
Before connecting live replanning, preserve running cooks and holds, obtain
verified completion/clearance estimates, preserve planner-locked assignments,
show a change comparison and persist approved proposals through a callable
transaction. Actual sanitation and start verification remain execution events.

The sequence is a deterministic feasible heuristic, not a guarantee of a global
optimum. The current legacy timeline/capacity forecast is separate; this preview
uses resource-specific chilling rather than treating old and blast chill as two
parallel stages. Do not publish preview assignments into that legacy model until
its routing semantics are updated.

## Validation

`npm test` includes rack splitting, same-species timing, species changes,
cleaning-window expiry and rollover, route compatibility, blast 8 limits,
reroute justification, missing inputs, carryover and outage/resource-overlap tests.
`npx tsc --noEmit` checks the engine and screen integration.

Real weekly production quantities and source photographs are not included in
the repository. They remain in the separately prepared weekly workbook.
