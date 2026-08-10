import { getFunctions, httpsCallable } from 'firebase/functions';

import { firebaseApp } from '@/lib/firebase/config';
import type { HoldReasonKey, HoldResolutionOutcome } from '@/lib/firebase/models';

function callable<TInput, TResult>(name: string) {
  if (!firebaseApp) throw new Error('Secure production service is unavailable.');
  return httpsCallable<TInput, TResult>(getFunctions(firebaseApp), name);
}

export type ProductionAction =
  | 'rtc_send_to_queue' | 'rtc_create_manual' | 'rtc_advance' | 'assign_oven' | 'allocate_oven_load' | 'verify_load'
  | 'start_cook' | 'record_thermal_check' | 'finish_thermal'
  | 'assign_chiller' | 'record_chill_check' | 'complete_chill'
  | 'qa_review' | 'qa_resubmit' | 'start_packaging'
  | 'complete_packaging' | 'complete_batch';

export type ProductionActionResult = {
  item: { id: string; stage: string; status: string; updatedAt: unknown; version?: number };
  prepId?: string;
  oItemId?: string;
  idempotentReplay?: boolean;
  childId?: string;
  assignedRackCount?: number;
  remainingRackCount?: number;
  capacity?: number;
};

export async function serverExecuteProductionAction(input: {
  action: ProductionAction;
  requestId: string;
  itemId?: string;
  planId?: string;
  expectedStage?: string;
  expectedStatus?: string;
  expectedUpdatedAt?: number;
  payload?: Record<string, unknown>;
}) {
  return (await callable<typeof input, ProductionActionResult>('executeProductionAction')(input)).data;
}

export async function serverTransitionProductionItem(input: { itemId: string; expectedStage: string; expectedStatus: string; expectedUpdatedAt?: number; toStatus: string; requestId: string }) {
  return (await callable<typeof input, { item: unknown }>('transitionProductionItem')(input)).data;
}

export async function serverPlaceFormalHold(input: { itemId: string; reasonKey: HoldReasonKey; reasonLabel: string; notes?: string; requestId: string }) {
  return (await callable<typeof input, { item: unknown }>('placeFormalHold')(input)).data;
}

export async function serverResolveFormalHold(input: { itemId: string; outcome: HoldResolutionOutcome; explanation: string; requestId: string }) {
  return (await callable<typeof input, { item: unknown }>('resolveFormalHold')(input)).data;
}

export async function serverAssignEquipment(input: { itemId: string; expectedStage: string; expectedStatus: string; expectedUpdatedAt?: number; equipmentKind: 'oven' | 'chiller'; equipmentId: string; requestId: string }) {
  return (await callable<typeof input, { item: unknown }>('assignEquipment')(input)).data;
}
