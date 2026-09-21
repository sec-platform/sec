import { compareCodeUnits } from '../contracts/canonical.ts';

export type BlockUsageMapEntry = Readonly<{
  id: string;
  installOrder: number;
}>;

export type BlockUsageMapView = Readonly<{
  blocks: readonly BlockUsageMapEntry[];
}>;

export function projectBlockUsageMap(
  source: Readonly<{ blocks: readonly BlockUsageMapEntry[] }>
): BlockUsageMapView {
  return {
    blocks: source.blocks
      .map((block) => ({ id: block.id, installOrder: block.installOrder }))
      .sort((left, right) => left.installOrder - right.installOrder || compareCodeUnits(left.id, right.id))
  };
}
