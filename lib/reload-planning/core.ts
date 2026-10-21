/** Deterministic planning only. Never starts equipment or changes production records. */
export const HOUR = 3_600_000;
export type Species = 'pork' | 'beef' | 'poultry' | 'mixed';
export type RackStyle = 'standard' | 'semi_whole' | 'semi_half';
export interface PlanningHouse { id: string; smoke: boolean; pairedChiller: number; available: boolean }
export interface PlanningChiller { id: number; type: 'old' | 'blast'; available: boolean }
export const PLANNING_HOUSES: PlanningHouse[] = [
  ['L', 16, true], ['M', 15, true], ['N', 14, true], ['O', 13, true],
  ['H', 9, true], ['D', 4, true], ['K', 12, true],
  ['F', 7, false], ['G', 6, false], ['I', 10, false], ['J', 11, false],
].map(([id, pairedChiller, smoke]) => ({ id: id as string, pairedChiller: pairedChiller as number, smoke: smoke as boolean, available: true }));
export const PLANNING_CHILLERS: PlanningChiller[] = Array.from({ length: 13 }, (_, i) => i + 4)
  .map(id => ({ id, type: [4, 5, 6, 7].includes(id) ? 'old' : 'blast', available: id !== 5 }));
export interface ReloadOrder {
  id: string; productionDay: string; productName: string; species: Species;
  smoke: boolean; rackStyle: RackStyle; racks: number; rackLimit: number;
  cookHours: number; oldChillHours: number | null; blastChillHours: number | null;
  readyAt: number; priority: number;
}
export interface HouseState { freeAt: number; windowStartedAt: number | null; species: Species | null }
export interface ReloadRules {
  routineCleanHours: number; speciesChangeHours: number; windowHours: number;
  allowRerouting: boolean; transferHours: number;
}
export interface ReloadInput {
  orders: ReloadOrder[]; startAt: number; houses: PlanningHouse[]; chillers: PlanningChiller[];
  rules: ReloadRules; initialHouses?: Record<string, HouseState>; initialChillers?: Record<number, number>;
}
export interface ReloadLoad {
  id: string; orderId: string; productName: string; productionDay: string; species: Species;
  smoke: boolean; racks: number; house: string; chiller: number; paired: boolean;
  start: number; cookEnd: number; chillEnd: number; windowDeadline: number;
  cleanStart: number | null; cleanEnd: number | null;
  reason: 'First load' | 'Same species' | 'Species change' | '24 h cleaning';
  dailyLoadNumber: number; rerouteSavedHours: number;
}
export interface ReloadIssue { orderId: string; message: string }
export interface ReloadResult { loads: ReloadLoad[]; issues: ReloadIssue[] }
const positive = (n: number) => Number.isFinite(n) && n > 0;
export function rackLimit(order: Pick<ReloadOrder, 'rackStyle' | 'rackLimit'>): number {
  return Math.min(order.rackStyle === 'semi_whole' ? 12 : order.rackStyle === 'semi_half' ? 15 : 18, order.rackLimit);
}
function validate(input: ReloadInput): ReloadIssue[] {
  const issues: ReloadIssue[] = [];
  const { rules } = input;
  if (!Number.isFinite(input.startAt) || !positive(rules.routineCleanHours) || !positive(rules.speciesChangeHours)
    || !positive(rules.windowHours) || !Number.isFinite(rules.transferHours) || rules.transferHours < 0) {
    issues.push({ orderId: '', message: 'Enter a valid start, cleaning duration, changeover duration, house window and transfer allowance.' });
  }
  if (new Set(input.houses.map(h => h.id)).size !== input.houses.length || new Set(input.chillers.map(c => c.id)).size !== input.chillers.length) {
    issues.push({ orderId: '', message: 'Equipment identifiers must be unique.' });
  }
  if (new Set(input.orders.map(o => o.id)).size !== input.orders.length) issues.push({ orderId: '', message: 'Order identifiers must be unique.' });
  for (const o of input.orders) {
    if (!Number.isInteger(o.racks) || !positive(o.racks) || !Number.isInteger(o.rackLimit) || !positive(o.rackLimit)
      || !positive(o.cookHours) || !Number.isFinite(o.readyAt) || !Number.isFinite(o.priority)
      || !['pork', 'beef', 'poultry', 'mixed'].includes(o.species)
      || !['standard', 'semi_whole', 'semi_half'].includes(o.rackStyle)
      || ![o.oldChillHours, o.blastChillHours].every(h => h === null || positive(h))) {
      issues.push({ orderId: o.id, message: `${o.productName}: rack count, species, rack limit, cook time, readiness or chill time is missing or invalid.` });
    }
  }
  for (const [id, s] of Object.entries(input.initialHouses ?? {})) {
    if (!Number.isFinite(s.freeAt) || (s.windowStartedAt !== null && !Number.isFinite(s.windowStartedAt))
      || ((s.windowStartedAt === null) !== (s.species === null)) || (s.species !== null && !['pork', 'beef', 'poultry', 'mixed'].includes(s.species))) {
      issues.push({ orderId: '', message: `House ${id}: current availability, cleaning window and species are required.` });
    }
  }
  if (Object.values(input.initialChillers ?? {}).some(t => !Number.isFinite(t))) issues.push({ orderId: '', message: 'Current chiller clearance times must be valid.' });
  const count = input.orders.reduce((n, o) => n + Math.ceil(o.racks / Math.max(1, rackLimit(o))), 0);
  if (count > 1000) issues.push({ orderId: '', message: 'Plan exceeds 1,000 loads. Split it into smaller planning periods.' });
  return issues;
}

/** Whole-house loads and one complete load per chiller. No inferred shared occupancy. */
export function planReloads(input: ReloadInput): ReloadResult {
  const invalid = validate(input);
  if (invalid.length) return { loads: [], issues: invalid };
  let best: ReloadResult | null = null, bestScore = Infinity;
  // Compare deterministic sequencing choices. Missed daily start targets dominate
  // the objective, followed by waiting, cleaning and unnecessary reroutes.
  for (let variant = 0; variant < 64; variant++) {
    const proposal = planSequence(input, variant);
    const ready = new Map(input.orders.map(o => [o.id, o.readyAt]));
    const score = proposal.issues.length * 1e9 + proposal.loads.reduce((n, l) => {
      const elapsed = (l.start - ready.get(l.orderId)!) / HOUR;
      return n + Math.max(0, elapsed - 24 + 0.0001) * 10000 + elapsed
        + (l.cleanStart !== null ? 0.8 : 0) + (!l.paired ? 0.7 : 0);
    }, 0);
    if (score < bestScore) { bestScore = score; best = proposal; }
  }
  return best!;
}

function planSequence(input: ReloadInput, variant: number): ReloadResult {
  const { rules } = input;
  let seed = variant + 1;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const weight = { smoke: 2 + random() * 8, clean: random() * 1.5, finish: random() * 0.35, noise: random() * 2, rack: random() * 0.04 };
  const hs: Record<string, HouseState> = Object.fromEntries(input.houses.map(h => [h.id,
    { ...(input.initialHouses?.[h.id] ?? { freeAt: input.startAt, windowStartedAt: null, species: null }) }]));
  const cs: Record<number, number> = Object.fromEntries(input.chillers.map(c => [c.id, input.initialChillers?.[c.id] ?? input.startAt]));
  const pending: (ReloadOrder & { batch: number; quantity: number })[] = [];
  for (const o of input.orders) {
    let remaining = o.racks, batch = 0;
    while (remaining > 0) { const quantity = Math.min(remaining, rackLimit(o)); pending.push({ ...o, batch: ++batch, quantity }); remaining -= quantity; }
  }
  pending.sort((a, b) => a.readyAt - b.readyAt || a.priority - b.priority || Number(b.smoke) - Number(a.smoke) || b.cookHours - a.cookHours || a.id.localeCompare(b.id) || a.batch - b.batch);
  const noise = new Map(pending.map(o => [`${o.id}:${o.batch}`, random() * weight.noise]));
  const loads: ReloadLoad[] = [], issues: ReloadIssue[] = [];
  while (pending.length) {
    const release = pending[0].readyAt;
    type Candidate = { index: number; load: ReloadLoad; epoch: number; score: number };
    let best: Candidate | null = null;
    const candidatesFor = (o: typeof pending[number], index: number, h: PlanningHouse, chiller: PlanningChiller): Candidate | null => {
      if (!h.available || !chiller.available || (o.smoke && !h.smoke)) return null;
      if (chiller.id === 8 && o.quantity > (o.rackStyle === 'semi_whole' ? 12 : 10)) return null;
      const chill = chiller.type === 'old' ? o.oldChillHours : o.blastChillHours;
      if (chill === null) return null;
      const state = hs[h.id];
      const free = state.freeAt + (state.species === null ? 0 : rules.transferHours * HOUR);
      let start = Math.max(input.startAt, o.readyAt, free, cs[chiller.id] - o.cookHours * HOUR);
      let reason: ReloadLoad['reason'] = state.species === null ? 'First load' : 'Same species';
      let cleanHours = 0;
      // Mixed-species loads require cleaning even when the previous label is also 'mixed'.
      if (state.species !== null && (state.species !== o.species || state.species === 'mixed')) {
        reason = 'Species change'; cleanHours = rules.speciesChangeHours;
      } else if (state.windowStartedAt !== null && start >= state.windowStartedAt + rules.windowHours * HOUR) {
        reason = '24 h cleaning'; cleanHours = rules.routineCleanHours;
      }
      start = Math.max(start, free + cleanHours * HOUR);
      const epoch = state.windowStartedAt === null || cleanHours > 0 ? start : state.windowStartedAt;
      const cookEnd = start + o.cookHours * HOUR;
      const load: ReloadLoad = {
        id: `${o.id}:${o.batch}`, orderId: o.id, productName: o.productName, productionDay: o.productionDay,
        species: o.species, smoke: o.smoke, racks: o.quantity, house: h.id, chiller: chiller.id,
        paired: chiller.id === h.pairedChiller, start, cookEnd, chillEnd: cookEnd + chill * HOUR,
        windowDeadline: epoch + rules.windowHours * HOUR, cleanStart: cleanHours > 0 ? start - cleanHours * HOUR : null,
        cleanEnd: cleanHours > 0 ? start : null, reason, dailyLoadNumber: 1, rerouteSavedHours: 0,
      };
      // Preserve scarce smoke houses while smoke work remains at this release time.
      const smokePenalty = !o.smoke && h.smoke && pending.some(p => p.readyAt === release && p.smoke) ? weight.smoke : 0;
      const cost = variant === 0 ? smokePenalty + cleanHours / 60 : smokePenalty + weight.finish * o.cookHours
        + (cleanHours > 0 ? weight.clean : 0) + noise.get(`${o.id}:${o.batch}`)! - o.quantity * weight.rack;
      return { index, load, epoch, score: start + cost * HOUR + o.priority * 60_000 };
    };
    pending.forEach((o, index) => {
      if (o.readyAt !== release || pending.some(p => p.id === o.id && p.batch < o.batch)) return;
      for (const h of input.houses) {
        const paired = input.chillers.find(c => c.id === h.pairedChiller);
        const base = paired ? candidatesFor(o, index, h, paired) : null;
        let choice = base;
        if (rules.allowRerouting) for (const c of input.chillers) {
          if (c.id === h.pairedChiller) continue;
          const alt = candidatesFor(o, index, h, c);
          // Reroute only for an earlier start, or when the paired route is unavailable.
          if (alt && (!choice || alt.load.start < choice.load.start)) {
            alt.load.rerouteSavedHours = base ? (base.load.start - alt.load.start) / HOUR : 0;
            choice = alt;
          }
        }
        if (choice && (!best || choice.score < best.score)) best = choice;
      }
    });
    if (best === null) {
      const blocked = pending.filter(o => o.readyAt === release);
      for (const o of blocked) if (!issues.some(i => i.orderId === o.id)) issues.push({ orderId: o.id, message: `${o.productName}: no available compatible house/chiller route.` });
      for (let i = pending.length - 1; i >= 0; i--) if (pending[i].readyAt === release) pending.splice(i, 1);
      continue;
    }
    const chosen = best as Candidate, l = chosen.load;
    l.dailyLoadNumber = loads.filter(p => p.house === l.house && p.productionDay === l.productionDay).length + 1;
    hs[l.house] = { freeAt: l.cookEnd, windowStartedAt: chosen.epoch, species: l.species };
    cs[l.chiller] = l.chillEnd;
    loads.push(l); pending.splice(chosen.index, 1);
  }
  return { loads: loads.sort((a, b) => a.start - b.start || a.house.localeCompare(b.house)), issues };
}

export function summarizeDay(loads: ReloadLoad[], productionDay: string, dayStart: number) {
  const today = loads.filter(l => l.productionDay === productionDay);
  return {
    racks: today.reduce((n, l) => n + l.racks, 0), loads: today.length,
    reloads: today.filter(l => l.dailyLoadNumber > 1).length,
    cookingAtStart: new Set(loads.filter(l => l.start < dayStart && l.cookEnd > dayStart).map(l => l.house)).size,
    cleaningAtStart: new Set(loads.filter(l => l.cleanStart !== null && l.cleanStart <= dayStart && l.cleanEnd! > dayStart).map(l => l.house)).size,
    startsAfterNextDay: today.filter(l => l.start >= dayStart + 24 * HOUR).length,
    latestStart: today.length ? Math.max(...today.map(l => l.start)) : null,
  };
}

/** Availability immediately before a boundary's planned starts, including cleanup. */
export function houseAvailability(loads: ReloadLoad[], houses: PlanningHouse[], at: number) {
  return houses.map(h => {
    const prior = loads.filter(l => l.house === h.id && l.start < at).sort((a, b) => b.start - a.start);
    const starting = loads.find(l => l.house === h.id && l.start === at);
    const cleaning = loads.some(l => l.house === h.id && l.cleanStart !== null && l.cleanStart <= at && l.cleanEnd! > at);
    const latest = starting ?? prior[0];
    const status = !h.available ? 'Unavailable' : prior.some(l => l.cookEnd > at) ? 'Cooking' : cleaning ? 'Cleaning'
      : latest && latest.windowDeadline <= at ? 'Needs cleaning' : 'Ready';
    return { house: h.id, status };
  });
}
