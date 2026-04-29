import { expect, test } from 'vitest';

import { expectCliJson, expectCliText, runCliPipeline, withTempWorkspace } from '../helpers/test-utils.ts';

test('CLI exposes provenance registry as text and JSON contracts', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await runCliPipeline(workspaceRoot, { verifyLane: 'all', lock: true });

    await expectCliText(workspaceRoot, ['provenance', 'registry'], [
      'Provenance registry; artifacts=',
      'Origins: block=',
      'slot=',
      'Registry sources: official=',
      'origin=slot:'
    ]);

    const provenance = await expectCliJson<{
      formatVersion: string;
      artifacts: Array<{
        path: string;
        originType: string;
        registrySourceId?: string;
        verifiedBy: string[];
        overrideStatus: string;
      }>;
    }>(workspaceRoot, ['provenance', 'registry', '--json']);
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

    await expectCliJson(
      workspaceRoot,
      ['provenance', 'registry', '--json', '--compact'],
      {
        formatVersion: '1',
        artifacts: expect.any(Array)
      },
      { compact: true }
    );
  });
}, 120000);
