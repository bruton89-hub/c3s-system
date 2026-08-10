import { isValidProductionTransition } from '../operations/core';

type Role = 'admin' | 'supervisor' | 'qa' | 'operator' | 'packaging';
type HarnessAlert = { id: string; status: 'open' | 'acknowledged' | 'resolved'; events: string[] };
type HarnessHold = { itemId: string; status: 'active' | 'resolved'; previousStatus: string; events: string[] };

export class LocalStressHarness {
  private networkAvailable = true;
  private alerts = new Map<string, HarnessAlert>();
  private holds = new Map<string, HarnessHold>();
  private itemStatuses = new Map<string, string>();
  private processedRequests = new Set<string>();
  private transitionEvents = new Map<string, string[]>();

  setNetworkAvailable(value: boolean) { this.networkAvailable = value; }
  seedItem(itemId: string, status: string) { this.itemStatuses.set(itemId, status); }
  seedAlert(id: string, status: HarnessAlert['status'] = 'open') { this.alerts.set(id, { id, status, events: ['created'] }); }
  seedHold(itemId: string, previousStatus: string) { this.holds.set(itemId, { itemId, status: 'active', previousStatus, events: ['placed'] }); this.itemStatuses.set(itemId, 'hold'); }

  async acknowledgeAlert(id: string, requestId: string) {
    this.requireNetwork(); if (this.processedRequests.has(requestId)) return 'duplicate-ignored' as const;
    const alert = this.alerts.get(id); if (!alert) throw new Error('Alert not found.'); if (alert.status !== 'open') throw new Error('Alert is no longer open. Refresh to see current state.');
    alert.status = 'acknowledged'; alert.events.push('acknowledged'); this.processedRequests.add(requestId); return 'acknowledged' as const;
  }

  async resolveHold(itemId: string, role: Role, requestId: string) {
    this.requireNetwork(); if (!['admin', 'supervisor', 'qa'].includes(role)) throw new Error('Your role cannot resolve this hold.'); if (this.processedRequests.has(requestId)) return 'duplicate-ignored' as const;
    const hold = this.holds.get(itemId); if (!hold || hold.status !== 'active') throw new Error('Hold is no longer active. Refresh to see current state.');
    hold.status = 'resolved'; hold.events.push('resolved', 'released'); this.itemStatuses.set(itemId, hold.previousStatus); this.processedRequests.add(requestId); return hold.previousStatus;
  }

  async transition(itemId: string, fromStatus: string, toStatus: string, requestId: string) {
    this.requireNetwork(); if (this.processedRequests.has(requestId)) return 'duplicate-ignored' as const;
    const current = this.itemStatuses.get(itemId); if (current !== fromStatus) throw new Error(`Stale state: expected ${fromStatus}, current ${current}.`);
    if (!isValidProductionTransition(fromStatus, toStatus)) throw new Error(`Invalid production transition: ${fromStatus} → ${toStatus}.`);
    this.itemStatuses.set(itemId, toStatus); this.transitionEvents.set(itemId, [...(this.transitionEvents.get(itemId) ?? []), `${fromStatus}->${toStatus}`]); this.processedRequests.add(requestId); return toStatus;
  }

  getAlert(id: string) { const alert = this.alerts.get(id); return alert ? { ...alert, events: [...alert.events] } : null; }
  getHold(itemId: string) { const hold = this.holds.get(itemId); return hold ? { ...hold, events: [...hold.events] } : null; }
  getStatus(itemId: string) { return this.itemStatuses.get(itemId); }
  getTransitions(itemId: string) { return [...(this.transitionEvents.get(itemId) ?? [])]; }
  private requireNetwork() { if (!this.networkAvailable) throw new Error('Network unavailable. Nothing was saved.'); }
}
