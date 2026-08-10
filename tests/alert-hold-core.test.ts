import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildAlertId,
  canAcknowledgeAlert,
  shouldResolveAlert,
  sortAlerts,
  statusAfterDetection,
} from '../lib/alerts/core';
import { isHeldStatus, isSupportedHoldOutcome, progressionAllowed } from '../lib/holds/core';
import { actionAvailabilityFor, countEquipmentStatuses, freshnessState, isEquipmentSelectable, isValidProductionTransition, matchesOperationalSearch, summarizeHandoff, urgencyRank } from '../lib/operations/core';
import { LocalStressHarness } from '../lib/stress/harness';
import { buildDelayId, canClearDelay, delayDurationMinutes } from '../lib/delays/core';
import { handoffIdentity, validateHandoffNote } from '../lib/handoff-notes/core';
import { normalizeEnvironment, validateEnvironmentBinding } from '../lib/environment-core';

test('deterministic alert identity prevents refresh and polling duplicates', () => {
  assert.equal(buildAlertId('batch-2841', 'Thermal Check Overdue'), 'batch-2841__thermal-check-overdue');
  assert.equal(buildAlertId('batch-2841', 'thermal-check-overdue'), 'batch-2841__thermal-check-overdue');
  assert.notEqual(buildAlertId('batch-2841', 'waiting-for-chiller'), buildAlertId('batch-2841', 'thermal-check-overdue'));
});

test('repeated detection preserves acknowledgement while a resolved recurrence reopens', () => {
  assert.equal(statusAfterDetection('acknowledged'), 'acknowledged');
  assert.equal(statusAfterDetection('resolved'), 'open');
  assert.equal(statusAfterDetection(null), 'open');
});

test('acknowledgement is allowed only from open', () => {
  assert.equal(canAcknowledgeAlert('open'), true);
  assert.equal(canAcknowledgeAlert('acknowledged'), false);
  assert.equal(canAcknowledgeAlert('resolved'), false);
});

test('automatic resolution requires the underlying condition to clear', () => {
  assert.equal(shouldResolveAlert('open', true), false);
  assert.equal(shouldResolveAlert('acknowledged', true), false);
  assert.equal(shouldResolveAlert('acknowledged', false), true);
  assert.equal(shouldResolveAlert('resolved', false), false);
});

test('alerts sort by severity then oldest first detection', () => {
  const sorted = sortAlerts([
    { severity: 'warning' as const, status: 'open' as const, firstDetectedAt: 1, id: 'warning' },
    { severity: 'critical' as const, status: 'open' as const, firstDetectedAt: 20, id: 'new-critical' },
    { severity: 'critical' as const, status: 'acknowledged' as const, firstDetectedAt: 10, id: 'old-critical' },
  ]);
  assert.deepEqual(sorted.map((entry) => entry.id), ['old-critical', 'new-critical', 'warning']);
});

test('formal holds block progression and expose only supported resolution outcomes', () => {
  assert.equal(isHeldStatus('hold'), true);
  assert.equal(isHeldStatus('qa_hold'), true);
  assert.equal(progressionAllowed('hold'), false);
  assert.equal(progressionAllowed('cooking'), true);
  assert.equal(isSupportedHoldOutcome('released_to_production'), true);
  assert.equal(isSupportedHoldOutcome('product_rejected'), false);
});

test('Firestore rules keep lifecycle audit records append-only and bind actors to auth', () => {
  const rules = readFileSync('firestore.rules', 'utf8');
  assert.match(rules, /match \/alert_events\/\{docId\}/);
  assert.match(rules, /match \/hold_events\/\{docId\}/);
  assert.match(rules, /request\.resource\.data\.actorId == request\.auth\.uid/);
  assert.match(rules, /allow update, delete: if false/);
  assert.doesNotMatch(rules, /match \/alerts\/\{docId\} \{\s*allow read, write: if signedIn\(\)/);
});

test('production search matches batch, product, and equipment fields', () => {
  const fields = ['Batch 2841', 'Smoked Turkey Breast', 'Smokehouse D'];
  assert.equal(matchesOperationalSearch(fields, '2841'), true);
  assert.equal(matchesOperationalSearch(fields, 'turkey'), true);
  assert.equal(matchesOperationalSearch(fields, 'smokehouse d'), true);
  assert.equal(matchesOperationalSearch(fields, 'chiller 10'), false);
});

test('role and hold state determine contextual action availability', () => {
  assert.deepEqual(actionAvailabilityFor('operator', 'cooking'), { canProgress: true, canPlaceHold: true, canResolveHold: false });
  assert.deepEqual(actionAvailabilityFor('operator', 'hold'), { canProgress: false, canPlaceHold: false, canResolveHold: false });
  assert.equal(actionAvailabilityFor('qa', 'hold').canResolveHold, true);
  assert.equal(actionAvailabilityFor(null, 'ready').canPlaceHold, false);
});

test('equipment capacity summary does not infer unknown capacity', () => {
  assert.deepEqual(countEquipmentStatuses([{ status: 'Available' }, { status: 'In Use' }, { status: 'Cleaning' }, { status: 'Unavailable' }]), { inUse: 1, available: 1, unavailable: 2 });
});

test('cleaning, unavailable, and occupied equipment cannot be selected as available', () => {
  assert.equal(isEquipmentSelectable('Available'), true);
  assert.equal(isEquipmentSelectable('Cleaning'), false);
  assert.equal(isEquipmentSelectable('Unavailable'), false);
  assert.equal(isEquipmentSelectable('In Use'), false);
});

test('shared urgency and freshness helpers keep screens consistent', () => {
  assert.deepEqual(['warning', 'critical', null].sort((a, b) => urgencyRank(a as any) - urgencyRank(b as any)), ['critical', 'warning', null]);
  assert.deepEqual(freshnessState(1000, false, 5000), { state: 'live', label: 'Live state' });
  assert.deepEqual(freshnessState(1000, true, 62000), { state: 'stale', label: 'Last known state • updated 1m ago' });
});

test('stage transition contract rejects cross-stage shortcuts', () => {
  assert.equal(isValidProductionTransition('cooking', 'awaiting_chill'), true);
  assert.equal(isValidProductionTransition('cooking', 'complete'), false);
  assert.equal(isValidProductionTransition('ready_for_qa', 'cooking'), false);
});

test('concurrent alert acknowledgement creates one lifecycle event', async () => {
  const harness = new LocalStressHarness(); harness.seedAlert('batch__overdue');
  const results = await Promise.allSettled([harness.acknowledgeAlert('batch__overdue', 'a'), harness.acknowledgeAlert('batch__overdue', 'b')]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.deepEqual(harness.getAlert('batch__overdue')?.events, ['created', 'acknowledged']);
});

test('network failure preserves state and retry is idempotent', async () => {
  const harness = new LocalStressHarness(); harness.seedItem('batch', 'assigned'); harness.setNetworkAvailable(false);
  await assert.rejects(harness.transition('batch', 'assigned', 'cooking', 'request-1'), /Nothing was saved/);
  assert.equal(harness.getStatus('batch'), 'assigned');
  harness.setNetworkAvailable(true);
  assert.equal(await harness.transition('batch', 'assigned', 'cooking', 'request-1'), 'cooking');
  assert.equal(await harness.transition('batch', 'assigned', 'cooking', 'request-1'), 'duplicate-ignored');
  assert.deepEqual(harness.getTransitions('batch'), ['assigned->cooking']);
});

test('hold resolution is role-bound, concurrent-safe, and restores pre-hold state', async () => {
  const harness = new LocalStressHarness(); harness.seedHold('batch', 'cooking');
  await assert.rejects(harness.resolveHold('batch', 'operator', 'operator-request'), /cannot resolve/);
  const results = await Promise.allSettled([harness.resolveHold('batch', 'qa', 'qa-a'), harness.resolveHold('batch', 'supervisor', 'qa-b')]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(harness.getStatus('batch'), 'cooking');
  assert.deepEqual(harness.getHold('batch')?.events, ['placed', 'resolved', 'released']);
});

test('delay and handoff persistence helpers have stable identities and validation', () => {
  assert.equal(buildDelayId('Batch 2841', 'Thermal'), 'batch-2841__thermal__delay');
  assert.equal(delayDurationMinutes(0, 149000), 2);
  assert.equal(canClearDelay('active'), true); assert.equal(canClearDelay('cleared'), false);
  assert.equal(handoffIdentity('2026-08-10', 'Night Shift'), '2026-08-10__night-shift');
  assert.equal(validateHandoffNote('  Oven G unavailable.  '), 'Oven G unavailable.');
  assert.throws(() => validateHandoffNote(' '), /required/);
});

test('handoff summary counts active, held, critical, and complete without duplicate events', () => {
  assert.deepEqual(summarizeHandoff([
    { status: 'cooking', stage: 'thermal', severity: 'critical' },
    { status: 'hold', stage: 'chill' },
    { status: 'complete', stage: 'complete' },
  ]), { active: 2, held: 1, critical: 1, completed: 1 });
});

test('staging environment binding fails closed against production or an undeclared target', () => {
  assert.equal(normalizeEnvironment('STAGING'), 'staging');
  assert.equal(normalizeEnvironment('preview'), null);
  assert.deepEqual(validateEnvironmentBinding({
    environment: 'staging',
    firebaseProjectId: 'c3s-staging',
    stagingProjectId: 'c3s-staging',
    productionProjectId: 'c3s-production',
  }), []);
  assert.match(validateEnvironmentBinding({
    environment: 'staging',
    firebaseProjectId: 'c3s-production',
    stagingProjectId: 'c3s-staging',
    productionProjectId: 'c3s-production',
  }).join(' '), /cannot target the production/);
  assert.match(validateEnvironmentBinding({
    environment: 'staging',
    firebaseProjectId: 'unknown-project',
    stagingProjectId: 'c3s-staging',
    productionProjectId: 'c3s-production',
  }).join(' '), /does not match the explicit staging/);
});
