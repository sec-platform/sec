import { expect, test } from 'vitest';

import { expectCliVariants, runCliPipeline } from '../helpers/cli-helpers.ts';
import { withTempWorkspace } from '../helpers/test-utils.ts';

test('CLI exposes provenance registry as text and JSON contracts', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await runCliPipeline(workspaceRoot, { verifyLane: 'all', lock: true });

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
    expect(provenance.formatVersion).toBe('1');
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
