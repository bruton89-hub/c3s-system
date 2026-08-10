import type { UserDoc } from '@/lib/firebase/models';

export type C3SCapability = 'view' | 'acknowledgeAlert' | 'placeHold' | 'resolveHold';

export function can(profile: UserDoc | null, capability: C3SCapability): boolean {
  if (capability === 'view') return true;
  if (!profile?.active) return false;
  if (capability === 'acknowledgeAlert') return ['admin', 'supervisor', 'qa', 'operator', 'packaging'].includes(profile.role);
  if (capability === 'placeHold') return ['admin', 'supervisor', 'qa', 'operator', 'packaging'].includes(profile.role);
  return ['admin', 'supervisor', 'qa'].includes(profile.role);
}
