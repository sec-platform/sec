import { expect, test } from 'vitest';

import { runCliInProcess as runCli, withTempWorkspace } from '../helpers/test-utils.ts';

test('CLI exposes provenance registry as text and JSON contracts', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expect(runCli(workspaceRoot, ['init', '--reset'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Initialized project workspace\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['resolve'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Resolved 3 blocks\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['compose'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Composed project\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['adapt'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Adapted slots\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['verify', '--lane', 'all'])).resolves.toMatchObject({
      code: 0,
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['lock'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Locked project\n',
      stderr: ''
    });

    const textResult = await runCli(workspaceRoot, ['provenance', 'registry']);
    expect(textResult.code).toBe(0);
    expect(textResult.stderr).toBe('');
    expect(textResult.stdout).toContain('Provenance registry; artifacts=');
    expect(textResult.stdout).toContain('Origins: block=');
    expect(textResult.stdout).toContain('slot=');
    expect(textResult.stdout).toContain('Registry sources: official=');
    expect(textResult.stdout).toContain('origin=slot:');

    const jsonResult = await runCli(workspaceRoot, ['provenance', 'registry', '--json']);
    expect(jsonResult.code).toBe(0);
    expect(jsonResult.stderr).toBe('');
    const provenance = JSON.parse(jsonResult.stdout) as {
      formatVersion: string;
      artifacts: Array<{
        path: string;
        originType: string;
        registrySourceId?: string;
        verifiedBy: string[];
        overrideStatus: string;
      }>;
    };
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

    const compactResult = await runCli(workspaceRoot, ['provenance', 'registry', '--json', '--compact']);
    expect(compactResult.code).toBe(0);
    expect(compactResult.stderr).toBe('');
    expect(compactResult.stdout.trim()).not.toContain('\n');
    expect(JSON.parse(compactResult.stdout)).toMatchObject({
      formatVersion: '1',
      artifacts: expect.any(Array)
    });
  });
}, 120000);
