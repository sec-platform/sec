import { expect, test } from 'bun:test';

import { loadManifestById } from '../../platform/compiler/parse/load-manifest.ts';
import { loadSemanticContractsForManifestEntry } from '../../platform/compiler/parse/load-semantic-contract.ts';
import { resolveGraph } from '../../platform/compiler/resolve/resolve-graph.ts';
import { SUPPORTED_STACK } from '../../platform/shared/constants.ts';
import { officialRegistryRelativePath } from '../../platform/shared/paths.ts';
import type { PlanFile } from '../../platform/shared/plan-manifest-types.ts';

test('versioned manifest resources resolve through version-first block fallback roots', async () => {
  const rootEntry = await loadManifestById('ticket/basic');
  const versionEntry = await loadManifestById('ticket/basic', { version: '0.1.1' });
  expect(versionEntry.resourceRoots).toEqual([versionEntry.manifestRoot, rootEntry.manifestRoot]);

  const contracts = await loadSemanticContractsForManifestEntry(versionEntry);
  expect(contracts.map((entry) => entry.contract.id)).toContain('ticket-core');
  expect(contracts.map((entry) => entry.contractPath)).toContain('platform/registry/official/ticket.basic/contracts/ticket.yaml');

  const plan: PlanFile = {
    app: { name: 'versioned-ticket-resource-overlay', stack: SUPPORTED_STACK, packageManager: 'pnpm', mode: 'single-tenant' },
    registry: { sources: [{ id: 'official', kind: 'official', location: 'compiler', path: officialRegistryRelativePath.replaceAll('\\', '/') }] },
    blocks: [{ id: 'ticket/basic', version: '0.1.1' }],
    slots: [],
    acceptance: []
  };
  const lock = await resolveGraph(process.cwd(), plan);
  const ticketSteps = lock.installPlan.filter((step) => step.blockId === 'ticket/basic');
  expect(ticketSteps.find((step) => step.from.endsWith('ticket-service.ts'))?.sourceRoot).toBe('ticket.basic/versions/0.1.1');
  expect(ticketSteps.find((step) => step.from.endsWith('ticket.prisma'))?.sourceRoot).toBe('ticket.basic/versions/0.1.1');
  expect(ticketSteps.find((step) => step.from.endsWith('ticket-service.test.ts'))?.sourceRoot).toBe('ticket.basic/versions/0.1.1');
});
