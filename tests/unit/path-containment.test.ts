import { expect, test } from 'bun:test';
import { defaultInstallRegistry } from '../../src/adapters/compilation/compose/install-strategies.ts';
import { getWorkspacePaths, privateRegistryRelativePath } from "../../src/adapters/workspace-context.ts";
import { loadPlan } from '../../src/adapters/workspace/sources/load-plan.ts';
import { writeYaml } from '../../src/adapters/workspace/yaml.ts';
import type { BlockManifest, InstallPlanStep } from '../../src/compiler/contract.ts';
import { validateManifest } from '../../src/compiler/contract/manifest-validation.ts';
import { posixPath } from '../../src/contracts/relative-path.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('plan validation rejects registry paths that traverse outside their base root', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { workspaceConfigPath } = getWorkspacePaths(workspaceRoot);

    await writeYaml(workspaceConfigPath, {
      app: {
        id: 'customer-admin',
        name: 'customer-admin',
        stack: 'typescript-library',
        packageManager: 'pnpm',
        mode: 'single-tenant'
      },
      registry: {
        sources: [
          {
            id: 'private',
            kind: 'private',
            location: 'workspace',
            path: `${posixPath(privateRegistryRelativePath)}/../outside`
          }
        ]
      },
      blocks: [],
      acceptance: []
    });

    expect(() => loadPlan(workspaceConfigPath))
      .toThrow(expect.objectContaining({ code: 'PLAN-VALIDATION-012' }));
  }, 'engineering-compiler-path-plan-registry-');
});

test('manifest validation rejects install paths that traverse outside allowed roots', () => {
  const manifest: BlockManifest = {
    id: 'private/path-test',
    version: '0.1.0',
    kind: 'capability',
    stackProfiles: ['typescript-library'],
    requires: [],
    provides: ['private/path-test'],
    conflicts: [],
    contracts: [],
    generators: [],
    installs: [
      {
        kind: 'copy',
        from: 'files/../secrets.ts',
        to: 'src/installed/private/path-test.ts'
      }
    ],
    pins: {
      inputs: [],
      outputs: []
    },
    acceptance: []
  };

  try {
    validateManifest(manifest);
    throw new Error('Expected manifest validation to reject traversal');
  } catch (caught) {
    expect(caught).toMatchObject({ code: 'MANIFEST-SCHEMA-006' });
  }
});

test('install strategy rejects persisted lock targets that escape project root', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const step: InstallPlanStep = {
      stepId: 'private/path-test:1',
      blockId: 'private/path-test',
      registrySourceId: 'private',
      registryKind: 'private',
      registryLocation: 'workspace',
      registryPath: posixPath(privateRegistryRelativePath),
      sourceRoot: '',
      action: 'copy',
      from: 'files/source.ts',
      to: '../outside.ts'
    };

    await expect(defaultInstallRegistry.executeAll([step], {
      workspaceRoot,
      lock: {
        formatVersion: '1',
        app: { id: 'customer-admin', name: 'customer-admin', stack: 'typescript-library', mode: 'single-tenant' },
        resolvedBlocks: [],
        resolvedCapabilities: [],
        installPlan: [],
        generatedPaths: [],
        acceptancePlan: [],
        passStatus: {
          parse: 'succeeded',
          align: 'succeeded',
          resolve: 'succeeded',
          compose: 'pending',
          verify: 'pending',
          repair: 'pending',
          lock: 'pending',
          emit: 'pending'
        }
      }
    })).rejects.toMatchObject({ code: 'COMPOSE-PATH-004' });
  }, 'engineering-compiler-path-install-target-');
});
