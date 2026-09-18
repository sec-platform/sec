import type { ManifestEntry, PlanFile } from '../compiler/contract.ts';

export type AddBlockManifest = Pick<ManifestEntry, 'registrySourceId' | 'registryKind'> & {
  manifest: Pick<ManifestEntry['manifest'], 'version' | 'acceptance'>;
};

export interface AddBlockOperations {
  readPlan(): PlanFile | PromiseLike<PlanFile>;
  selectManifest(request: Readonly<{
    blockId: string;
    version: string | undefined;
    registrySources: PlanFile['registry']['sources'];
  }>): AddBlockManifest | PromiseLike<AddBlockManifest>;
  writePlan(plan: PlanFile): void | PromiseLike<void>;
}

/** One addition use case. The caller owns the write lease and physical commit
 * fence; a selected manifest is not a persisted plan until writePlan returns. */
export async function addBlockToPlan(blockId: string, operations: AddBlockOperations) {
  const { readPlan, selectManifest, writePlan } = operations;
  if ([readPlan, selectManifest, writePlan].some(operation => typeof operation !== 'function')) {
    throw new TypeError('Block addition operations must be callable');
  }
  const current = await readPlan.call(operations);
  const existing = current.blocks.find(entry => entry.id === blockId);
  const selected = await selectManifest.call(operations, {
    blockId, version: existing?.version, registrySources: current.registry.sources
  });
  const selectedBlock = {
    id: blockId,
    version: selected.manifest.version,
    registrySourceId: selected.registrySourceId,
    registryKind: selected.registryKind
  } as const;
  if (existing) return { plan: current, changed: false, selectedBlock };

  const acceptance = [...current.acceptance];
  const declared = new Set(acceptance.map(entry => entry.id));
  for (const entry of selected.manifest.acceptance) {
    if (!declared.has(entry.id)) {
      acceptance.push({ id: entry.id });
      declared.add(entry.id);
    }
  }
  const plan: PlanFile = {
    ...current,
    blocks: [...current.blocks, { id: blockId, version: selected.manifest.version }],
    acceptance
  };
  await writePlan.call(operations, plan);
  return { plan, changed: true, selectedBlock };
}
