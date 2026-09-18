import { expect, test } from 'bun:test';
import { addBlockToPlan, type AddBlockManifest, type AddBlockOperations } from '../../src/application/add-block.ts';
import type { PlanFile } from '../../src/compiler/contract.ts';

function fixture() {
  const plan: PlanFile = {
    app: { id: 'app', name: 'App', stack: 'fixture', packageManager: 'npm', mode: 'single-tenant' },
    registry: { sources: [] }, blocks: [], acceptance: [{ id: 'keep' }]
  };
  const selected: AddBlockManifest = {
    registrySourceId: 'private', registryKind: 'private',
    manifest: { version: '2.0.0', acceptance: [{ id: 'keep' }, { id: 'new' }, { id: 'new' }] }
  };
  const events: string[] = [];
  const operations: AddBlockOperations = {
    readPlan: async () => { events.push('read'); return plan; },
    selectManifest: async request => {
      events.push('select'); expect(request.registrySources).toBe(plan.registry.sources);
      expect(request.blockId).toBe('feature/a');
      expect(request.version).toBe(plan.blocks[0]?.version);
      return selected;
    },
    writePlan: async () => { events.push('write'); }
  };
  return { plan, selected, events, operations };
}

test('addition keeps the input intact, deduplicates acceptance, and returns only after persistence', async () => {
  const f = fixture(); const before = structuredClone(f.plan);
  let persisted: PlanFile | undefined;
  f.operations.writePlan = async plan => { f.events.push('write'); await Promise.resolve(); persisted = plan; };
  const result = await addBlockToPlan('feature/a', f.operations);
  expect(result).toMatchObject({ changed: true, selectedBlock: { id: 'feature/a', version: '2.0.0', registrySourceId: 'private', registryKind: 'private' } });
  expect(result.plan).toBe(persisted!);
  expect(result.plan.blocks).toEqual([{ id: 'feature/a', version: '2.0.0' }]);
  expect(result.plan.acceptance).toEqual([{ id: 'keep' }, { id: 'new' }]);
  expect(f.plan).toEqual(before);
  expect(f.events).toEqual(['read', 'select', 'write']);
});

test('an existing block still resolves its pinned manifest without rewriting the plan', async () => {
  const f = fixture(); f.plan.blocks.push({ id: 'feature/a', version: '1.0.0' });
  f.selected.manifest.version = '1.0.0';
  const result = await addBlockToPlan('feature/a', f.operations);
  expect(result.changed).toBe(false); expect(result.plan).toBe(f.plan);
  expect(result.selectedBlock.version).toBe('1.0.0');
  expect(f.plan.acceptance).toEqual([{ id: 'keep' }]);
  expect(f.events).toEqual(['read', 'select']);
});

for (const failureAt of ['readPlan', 'selectManifest', 'writePlan'] as const) {
  test(`${failureAt} failure preserves its exact reason and leaves the source plan unchanged`, async () => {
    const f = fixture(); const before = structuredClone(f.plan);
    const failure = Object.freeze({ failureAt });
    f.operations[failureAt] = async () => { throw failure; };
    await expect(addBlockToPlan('feature/a', f.operations)).rejects.toBe(failure);
    expect(f.plan).toEqual(before);
    expect(f.events).not.toContain('write');
  });
}
