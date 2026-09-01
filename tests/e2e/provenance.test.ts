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
        'Registry sources: official='
      ],
      compactJson: {
        formatVersion: '1',
        artifacts: expect.any(Array)
      }
    });
    expect(provenance.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'src/installed/entity/customer-service.ts',
          originType: 'block',
          registrySourceId: 'official'
        })
      ])
    );
  });
}, 120000);
