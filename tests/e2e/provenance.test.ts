import { expect, test } from 'bun:test';

import { expectCliVariants } from '../testkit/cli.ts';
import { withWorkspaceScenario } from '../testkit/workspace.ts';

test('CLI exposes provenance registry as text and JSON contracts', async () => {
  await withWorkspaceScenario('locked-all-default', async (workspaceRoot) => {
    const { json: provenance } = await expectCliVariants<{
      formatVersion: string;
      artifacts: Array<{
        path: string;
        originType: string;
        registrySourceId?: string;
        verifiedBy: string[];
        overrideStatus: string;
      }>;
    }>(workspaceRoot, ['provenance', 'registry'], {
      text: [
        'Provenance registry; artifacts=',
        'Origins: block=',
        'slot=',
        'Registry sources: official=',
        'origin=slot:'
      ],
      compactJson: {
        formatVersion: '1',
        artifacts: expect.any(Array)
      }
    });
    expect(provenance.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'custom/customer_normalizer.ts',
          originType: 'slot',
          overrideStatus: 'none'
        }),
        expect.objectContaining({
          path: 'src/installed/entity/customer-service.ts',
          originType: 'block',
          registrySourceId: 'official'
        })
      ])
    );
  });
}, 120000);
