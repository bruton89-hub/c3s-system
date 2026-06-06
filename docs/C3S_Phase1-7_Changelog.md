# C3S Industrial Production Planning — Phase 1–7 Changelog

**Project:** `c3s-preview` (Expo SDK 54, React Native 0.81, TypeScript, Firebase Firestore)
**Scope:** Transformation from generic preview app into industrial deli thermal MES.
**Status:** All seven phases shipped. TypeScript compiles clean (`tsc --noEmit --skipLibCheck` ⇒ EXIT 0, 773 files).

---

## 1. Updated Folder Structure

```
c3s-preview/
├── app/
│   ├── _layout.tsx                    [MODIFIED] – registered new stack routes
│   ├── (tabs)/
│   │   └── planning.tsx               [REPLACED]  – Mon–Sun production board
│   ├── thermal-timeline.tsx           [NEW]      – Gantt of houses + chillers
│   └── products/
│       └── index.tsx                  [NEW]      – Product master MES table
├── lib/
│   ├── firebase/
│   │   ├── collections.ts             [MODIFIED] – +product_profiles, +operational_events
│   │   └── models.ts                  [MODIFIED] – additive types only
│   ├── products/                      [NEW]
│   │   ├── index.ts
│   │   ├── types.ts
│   │   ├── seed-data.ts
│   │   └── repository.ts
│   ├── forecasting/index.ts           [NEW]
│   ├── capacity/index.ts              [NEW]
│   └── operational-events/index.ts    [NEW]
├── scripts/
│   └── seed-product-profiles.mjs      [NEW]
├── app.json                           [MODIFIED] – orientation, dark UI, iPad ids
├── package.json                       [MODIFIED] – +seed:product-profiles script
└── docs/
    └── C3S_Phase1-7_Changelog.md      [this file]
```

Legacy files (`batch-timeline.tsx`, `qa-review.tsx`, `seed-products.mjs`, the old `products` collection helpers) were left in place untouched.

---

## 2. Firestore Schema (additions only)

### `product_profiles` (new)
| Field | Type | Notes |
|---|---|---|
| `productCode` | `string` | Stable display code from runtime sheet |
| `description` | `string` | Customer-facing name |
| `species` | `'beef' \| 'pork' \| 'turkey' \| 'chicken' \| 'mixed'` |  |
| `processType` | `'cook' \| 'smoke' \| 'cook_smoke' \| 'raw' \| 'cured'` |  |
| `smokeType` | `'none' \| 'natural' \| 'liquid' \| 'mixed'` |  |
| `cookHours` | `number` | NA encoded as `0` |
| `chillHours` | `number` | NA encoded as `0` |
| `blastHours` | `number` | NA encoded as `0` |
| `probeOutTemp` | `number` | °F target |
| `rackCapacity` | `number` | Default racks per smokehouse load |
| `boxType` | `'case' \| 'combo' \| 'bin' \| 'vac'` |  |
| `shelfLifeDays` | `number` |  |
| `productionSection` | `'boning_room' \| 'ham_stuffing' \| 'process_meats' \| 'turkey_room'` |  |
| `category` | `'salad' \| 'fresh_kitchen' \| 'bulk' \| 'slicing'` |  |
| `active` | `boolean` | soft-delete flag |
| `notes` | `string[]` | flags for partially-legible source rows |
| `createdAt` / `updatedAt` | `Timestamp` |  |

### `weekly_plan` (extended — all optional)
Adds: `productCodeSnapshot`, `description`, `processOrder`, `cases`, `btc`,
`productionSection`, `assignedSmokehouse`, `assignedChiller`, `boardStatus`,
`plannedStartAt`, `forecastCookEnd`, `forecastChillEnd`, `forecastBlastEnd`,
`forecastPackagingEta`.

### `operational_events` (new)
| Field | Type |
|---|---|
| `weeklyPlanId?` | `string` |
| `department` | `OperationalEventDepartment` |
| `type` | `OperationalEventType` |
| `severity` | `'info' \| 'low' \| 'medium' \| 'high' \| 'critical'` |
| `notes` | `string` |
| `loggedBy` | `string` |
| `resolved` | `boolean` |
| `resolvedBy?` / `resolvedAt?` | `string` / `Timestamp` |
| `createdAt` | `Timestamp` |

---

## 3. Component Breakdown — `app/(tabs)/planning.tsx`

* **Header bar:** Week label · `‹ Prev` · `Today` · `Next ›` · `Timeline` · `Products`.
* **Capacity warnings strip:** chips for `over_capacity`, `overlap`, `equipment_unavailable`, `qa_hold_conflict`, `unassigned`.
* **Day column (×7):** 280 px wide, horizontal scroll.
  * Section header rows × 4 — `Boning Room`, `Ham Stuffing`, `Process Meats`, `Turkey Room`.
  * `BoardCard` per planned line: description / code / PO / cases / racks / BTC, cook–chill–pack ETAs, smokehouse & chiller assignments, status chip (tap = cycle), and `Edit / Event / Delete` actions.
  * Daily Grand Total foot (cases / racks / BTC).
* **EditRowModal:** product picker (filters product_profiles by section), smokehouse chips D–O, chiller chips 4–16, planned start time.
* **EventModal:** dropdowns for type / severity / department, notes textarea, "Log Event" → `recordOperationalEvent`.

Status cycle: `planned → rtc → ready_for_thermal → cooking → awaiting_chill → chill_running → ready_for_qa → ready_for_packaging → complete → deviation → planned`.

---

## 4. Component Breakdown — `app/thermal-timeline.tsx`

* 24-hour grid, **36 px / hour**, primitive `<View>` positioning (no chart lib).
* Rows: smokehouses **D–O**, then chillers **4–16**.
* Bar colours:
  * Smokehouse OK → `#FB8C00` orange.
  * Chiller OK → `#4FC3F7` blue.
  * Overload → `#E53935` red with white border.
* Day navigation: `Prev` · `Today` · `Next` · `Back`.
* Top warning strip mirrors planning.tsx capacity chips.

---

## 5. Type Definitions (`lib/firebase/models.ts` excerpt)

```ts
export type ProductSpecies      = 'beef' | 'pork' | 'turkey' | 'chicken' | 'mixed';
export type ProductProcessType  = 'cook' | 'smoke' | 'cook_smoke' | 'raw' | 'cured';
export type ProductSmokeType    = 'none' | 'natural' | 'liquid' | 'mixed';
export type ProductBoxType      = 'case' | 'combo' | 'bin' | 'vac';
export type ProductCategory     = 'salad' | 'fresh_kitchen' | 'bulk' | 'slicing';
export type ProductionSection   = 'boning_room' | 'ham_stuffing' | 'process_meats' | 'turkey_room';

export type ProductionBoardStatus =
  | 'planned' | 'rtc' | 'ready_for_thermal' | 'cooking'
  | 'awaiting_chill' | 'chill_running' | 'ready_for_qa'
  | 'ready_for_packaging' | 'complete' | 'deviation';

export type OperationalEventType =
  | 'delay' | 'qa_hold' | 'maintenance' | 'cook_overrun'
  | 'steam_issue' | 'humidity_issue' | 'reassignment' | 'other';
```

All extensions to `WeeklyPlanDoc` are optional, so existing live documents remain valid without backfill.

---

## 6. Forecasting Utility (`lib/forecasting/index.ts`)

```ts
computeLoadFactor(rackCount, rackCapacity) // clamped to [0, 1.5]
forecastSchedule({ profile, rackCount, plannedStart, packagingBufferHours = 0.5 })
  → { cookStart, cookEnd, chillEnd, blastEnd, postThermalEnd,
      packagingReadyEta, totalHours, loadFactor }
formatForecastTime(date) // → "Mon 14:30"
computeBtc(rackCount, rackCapacity) // 2-decimal float
```

Key formulas:
* `cookEnd = cookStart + (cookHours × loadFactor)`
* `postThermalEnd = max(chillEnd, blastEnd)`
* `packagingReadyEta = postThermalEnd + bufferHours`

---

## 7. Capacity Utility (`lib/capacity/index.ts`)

```ts
SMOKEHOUSE_IDS = ['D','E','F','G','H','I','J','K','L','M','N','O'];
SMOKEHOUSES['E']  = { rackCapacity: 1,  manual: true  };  // 1-rack manual house
SMOKEHOUSES[ * ]  = { rackCapacity: 18, manual: false };

CHILLER_IDS  = [4,5,6,7,8,9,10,11,12,13,14,15,16];
CHILLERS[8]  = { rackCapacity: 10 };                       // big chiller
CHILLERS[ * ]= { rackCapacity: 6  };

analyzeSmokehouseUtilization(slots)
analyzeChillerUtilization(slots)
analyzeAll(plans, profiles)  // → { smokehouse, chiller, warnings[] }
```

Warning types emitted: `over_capacity`, `overlap`, `equipment_unavailable`,
`qa_hold_conflict`, `unassigned`.

---

## 8. Seed Data Example

`scripts/seed-product-profiles.mjs` writes the runtime master sheet
(~30 SKUs) to `product_profiles` using stable `docId`s + `setDoc({merge:true})`
so re-runs are idempotent.

Truncated example tuple form used in the script:

```js
{
  docId: 'sku-rb-roastbeef-top',
  productCode: 'RB-TOP',
  description: 'Top Round Roast Beef',
  species: 'beef',
  processType: 'cook_smoke',
  smokeType: 'natural',
  cookHours: 8.0,
  chillHours: 14.0,
  blastHours: 0,
  probeOutTemp: 142,
  rackCapacity: 18,
  boxType: 'case',
  shelfLifeDays: 60,
  productionSection: 'process_meats',
  category: 'slicing',
  active: true,
  notes: [],
}
```

Run from a workstation with internet + Firebase creds:

```bash
cd c3s-preview
npm run seed:product-profiles
```

The live seed could not be performed from the sandbox (no DNS to
`firestore.googleapis.com` — `EAI_AGAIN`). The script is wired and ready.

---

## 9. Verification

| Check | Result |
|---|---|
| `tsc --noEmit --skipLibCheck` | EXIT 0 — 773 files clean |
| `eslint` | Could not run in offline sandbox (missing native binding `@unrs/resolver-binding-linux-arm64-gnu`). Not a code defect. |
| Live Firestore seed | Deferred to user machine (DNS blocked in sandbox) |
| `WeeklyPlanDoc` back-compat | All new fields optional — existing docs valid |

---

## 10. TestFlight / iPad Deployment Steps

`app.json` changes applied:

```json
"orientation": "default",
"userInterfaceStyle": "dark",
"ios": {
  "supportsTablet": true,
  "buildNumber": "1",
  "bundleIdentifier": "com.c3ssystem.preview",
  "requireFullScreen": false
}
```

Recommended pipeline:

1. `npm install`  (first time on dev machine)
2. `npx expo prebuild --platform ios --clean`
3. `eas build --profile preview --platform ios`
   *(requires an `eas.json` with an internal preview profile and an active Apple Developer account)*
4. `eas submit --platform ios --latest`
5. In **App Store Connect → TestFlight**, add internal testers (iPad capable).
6. On the iPad, install **TestFlight**, accept the invite, install **c3s-preview**.
7. Sign in with a seeded Firebase user; verify:
   * Planning board renders Mon–Sun, all 4 section bands.
   * Thermal timeline shows D–O and chillers 4–16 with current day's bars.
   * Products screen lists all seeded SKUs with inline edit.
   * Logging an operational event from a card writes to `operational_events`.

---

## Known follow-ups (for product owner)

* Validate partially-legible SKU rows flagged in `seed-data.ts → notes[]`.
* Run `npm run seed:product-profiles` from a network-capable workstation.
* Build a TestFlight bundle and sanity-test on physical iPad hardware.
* Optional: backfill historical `weekly_plan` rows with `productionSection` so
  Sunday-back-week views light up immediately.
