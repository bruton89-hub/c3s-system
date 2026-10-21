import test from 'node:test';
import assert from 'node:assert/strict';
import { HOUR, PLANNING_CHILLERS, PLANNING_HOUSES, houseAvailability, planReloads, rackLimit, summarizeDay, type ReloadInput, type ReloadOrder } from '../lib/reload-planning/core';
const order = (patch: Partial<ReloadOrder> = {}): ReloadOrder => ({
  id: 'a', productionDay: '2030-01-07', productName: 'Product A', species: 'pork', smoke: true,
  rackStyle: 'standard', racks: 18, rackLimit: 18, cookHours: 13, oldChillHours: 13,
  blastChillHours: 10, readyAt: 0, priority: 1, ...patch,
});
const input = (orders: ReloadOrder[], patch: Partial<ReloadInput> = {}): ReloadInput => ({
  orders, startAt: 0, houses: [{ id: 'L', smoke: true, pairedChiller: 16, available: true }],
  chillers: [{ id: 16, type: 'blast', available: true }],
  rules: { routineCleanHours: 2, speciesChangeHours: 2, windowHours: 24, allowRerouting: false, transferHours: 0 }, ...patch,
});
test('plant routing distinguishes smoke, steam, old chillers and disabled chiller 5', () => {
  assert.equal(PLANNING_HOUSES.length, 11);
  assert.deepEqual(PLANNING_HOUSES.filter(h => h.smoke).map(h => h.id), ['L', 'M', 'N', 'O', 'H', 'D', 'K']);
  assert.equal(PLANNING_HOUSES.find(h => h.id === 'G')?.pairedChiller, 6);
  assert.equal(PLANNING_CHILLERS.find(c => c.id === 5)?.available, false);
  assert.equal(PLANNING_CHILLERS.find(c => c.id === 8)?.type, 'blast');
});
test('product rack limits split lots without scaling cook duration', () => {
  for (const [style, racks, expected] of [['semi_whole', 25, [12, 12, 1]], ['semi_half', 39, [15, 15, 9]], ['standard', 57, [18, 18, 18, 3]]] as const) {
    const p = planReloads(input([order({ rackStyle: style, racks })]));
    assert.deepEqual(p.loads.map(l => l.racks), expected);
    assert.ok(p.loads.every(l => l.cookEnd - l.start === 13 * HOUR));
    assert.equal(p.issues.length, 0);
  }
  assert.equal(rackLimit({ rackStyle: 'standard', rackLimit: 12 }), 12);
});
test('same-species reload starts immediately when cook outlasts previous chilling', () => {
  const { loads } = planReloads(input([order({ racks: 36 })]));
  assert.equal(loads[1].start, loads[0].cookEnd);
  assert.equal(loads[1].reason, 'Same species');
  assert.equal(loads[1].cleanStart, null);
});
test('shorter reload waits until its completion can enter a cleared chiller', () => {
  const { loads } = planReloads(input([order(), order({ id: 'b', cookHours: 5, readyAt: HOUR })]));
  assert.equal(loads[1].start, 18 * HOUR);
  assert.equal(loads[1].cookEnd, loads[0].chillEnd);
});
test('species changes receive two-hour cleaning and a fresh window', () => {
  const { loads } = planReloads(input([order(), order({ id: 'b', species: 'beef', readyAt: HOUR })]));
  assert.equal(loads[1].start, 15 * HOUR);
  assert.equal(loads[1].cleanStart, 13 * HOUR);
  assert.equal(loads[1].reason, 'Species change');
  assert.equal(loads[1].windowDeadline, 39 * HOUR);
});
test('cook may roll beyond 24 hours; next start needs cleaning', () => {
  const { loads } = planReloads(input([order({ racks: 36 })], {
    initialHouses: { L: { freeAt: 23 * HOUR, windowStartedAt: 0, species: 'pork' } },
  }));
  assert.equal(loads[0].start, 23 * HOUR);
  assert.equal(loads[0].cookEnd, 36 * HOUR);
  assert.equal(loads[0].windowDeadline, 24 * HOUR);
  assert.equal(loads[1].reason, '24 h cleaning');
  assert.equal(loads[1].start, 38 * HOUR);
});
test('a new start at window expiry receives cleaning', () => {
  const { loads } = planReloads(input([order({ readyAt: 24 * HOUR })], {
    initialHouses: { L: { freeAt: 24 * HOUR, windowStartedAt: 0, species: 'pork' } },
  }));
  assert.equal(loads[0].start, 26 * HOUR);
});
test('unavailable equipment and missing old-chill suitability remain unscheduled', () => {
  const p = planReloads(input([order({ oldChillHours: null })], {
    houses: [{ id: 'D', smoke: true, pairedChiller: 4, available: true }],
    chillers: [{ id: 4, type: 'old', available: true }],
  }));
  assert.equal(p.loads.length, 0); assert.equal(p.issues.length, 1);
  assert.equal(planReloads(input([order()], { houses: [] })).loads.length, 0);
});
test('steam-only houses reject smoke but accept steam product', () => {
  const patch = { houses: [{ id: 'I', smoke: false, pairedChiller: 16, available: true }] };
  assert.equal(planReloads(input([order()], patch)).loads.length, 0);
  assert.equal(planReloads(input([order({ smoke: false })], patch)).loads.length, 1);
});
test('blast 8 respects product capacity and reroutes only when start improves', () => {
  const setup = input([order({ racks: 12, rackStyle: 'semi_whole' })], {
    chillers: [{ id: 16, type: 'blast', available: true }, { id: 8, type: 'blast', available: true }],
    initialChillers: { 16: 40 * HOUR },
  });
  setup.rules.allowRerouting = true;
  assert.equal(planReloads(setup).loads[0].chiller, 8);
  assert.ok(planReloads(setup).loads[0].rerouteSavedHours > 0);
  setup.orders = [order({ racks: 12, rackStyle: 'semi_half' })];
  assert.equal(planReloads(setup).loads[0].chiller, 16);
  setup.orders = [order({ racks: 8 })]; setup.initialChillers = {};
  assert.equal(planReloads(setup).loads[0].chiller, 16);
});
test('invalid input cannot look like an empty successful plan', () => {
  for (const patch of [{ racks: 0 }, { racks: NaN }, { cookHours: NaN }, { oldChillHours: 0 }, { rackLimit: 0 }]) {
    const p = planReloads(input([order(patch)])); assert.equal(p.loads.length, 0); assert.ok(p.issues.length);
  }
  const p = input([order()]); p.rules.routineCleanHours = NaN;
  assert.ok(planReloads(p).issues.length);
});
test('cross-day carryover and daily reload totals are explicit', () => {
  const { loads } = planReloads(input([order({ racks: 36 })]));
  const s = summarizeDay(loads, '2030-01-07', 0);
  assert.equal(s.loads, 2); assert.equal(s.reloads, 1); assert.equal(s.racks, 36);
  assert.equal(summarizeDay(loads, '2030-01-08', 24 * HOUR).cookingAtStart, 1);
  assert.equal(houseAvailability(loads, PLANNING_HOUSES.slice(0, 1), 24 * HOUR)[0].status, 'Cooking');
  assert.equal(houseAvailability(loads, PLANNING_HOUSES.slice(0, 1), 30 * HOUR)[0].status, 'Needs cleaning');
});
test('new outage or delay regenerates a feasible proposal with no resource overlap', () => {
  const p = input([order({ racks: 36 }), order({ id: 'b', readyAt: 24 * HOUR, species: 'poultry', smoke: false })], {
    houses: PLANNING_HOUSES.map(h => ({ ...h, available: h.id !== 'L' })), chillers: PLANNING_CHILLERS,
    initialChillers: { 15: 40 * HOUR },
  });
  const r = planReloads(p); assert.equal(r.issues.length, 0);
  assert.ok(r.loads.every(l => l.house !== 'L'));
  for (const l of r.loads) {
    assert.ok(l.start < l.windowDeadline);
    for (const other of r.loads.filter(o => o.id !== l.id)) {
      if (other.house === l.house) assert.ok(l.cookEnd <= other.start || other.cookEnd <= l.start);
      if (other.chiller === l.chiller) assert.ok(l.chillEnd <= other.cookEnd || other.chillEnd <= l.cookEnd);
    }
  }
});
