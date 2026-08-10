import { getChillers, getSmokehouses } from '@/lib/firebase/repository';
import type { OItemItem } from '@/lib/operational-items';
import { itemBatch } from '@/lib/production/presentation';
import type { EquipmentSummary } from './summary';
import { getActiveStressScenario } from '@/lib/stress/scenarios';

export async function getEquipmentOverview(items: OItemItem[]): Promise<EquipmentSummary[]> {
  const stressEquipment = getActiveStressScenario()?.equipment;
  if (stressEquipment) return stressEquipment;
  const [smokehouses, chillers] = await Promise.all([getSmokehouses(), getChillers()]);
  const ovens: EquipmentSummary[] = smokehouses.map((oven) => {
    const assigned = items.find((item) => item.assignedSmokehouse === oven.name && ['assigned', 'cooking'].includes(item.status));
    return {
      id: oven.name,
      kind: 'Oven',
      status: oven.status === 'cooking' || assigned ? 'In Use' : oven.status === 'cleaning' ? 'Cleaning' : oven.status === 'idle' ? 'Available' : 'Unavailable',
      assignedItemId: assigned?.id ?? null,
      assignedBatch: assigned ? itemBatch(assigned) : null,
    };
  });
  const chill: EquipmentSummary[] = chillers.map((chiller) => {
    const assigned = items.find((item) => item.chillerId === chiller.name && item.status === 'in_chill');
    return {
      id: chiller.name,
      kind: 'Chiller',
      status: chiller.status === 'chilling' || assigned ? 'In Use' : chiller.status === 'cleaning' ? 'Cleaning' : chiller.status === 'idle' ? 'Available' : 'Unavailable',
      assignedItemId: assigned?.id ?? null,
      assignedBatch: assigned ? itemBatch(assigned) : null,
    };
  });
  return [...ovens, ...chill];
}
