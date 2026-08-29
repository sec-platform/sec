import { expect, test } from 'bun:test';
import { defaultInstallRegistry } from '../../src/compiler/compose/install-strategies.ts';
import { validateManifest } from '../../src/compiler/parse/load-manifest.ts';
import { loadPlan } from '../../src/compiler/parse/load-plan.ts';
import type { InstallPlanStep } from '../../src/compiler/contract.ts';
import { getWorkspacePaths } from '../../src/workspace/paths.ts';
import type { BlockManifest } from '../../src/compiler/contract.ts';
import { writeYaml } from '../../src/workspace/yaml.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('plan validation rejects registry paths that traverse outside their base root', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { planPath } = getWorkspacePaths(workspaceRoot);

    await writeYaml(planPath, {
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
            path: 'source/blocks/private/../outside'
          }
        ]
      },
      blocks: [],
      slots: [],
      acceptance: []
    });

    expect(() => loadPlan(planPath))
      .toThrow(expect.objectContaining({ code: 'PLAN-VALIDATION-012' }));
  }, 'engineering-compiler-path-plan-registry-');
});

test('plan validation rejects slot targets that traverse outside custom', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { planPath } = getWorkspacePaths(workspaceRoot);

    await writeYaml(planPath, {
      app: {
        id: 'customer-admin',
        name: 'customer-admin',
        stack: 'typescript-library',
        packageManager: 'pnpm',
        mode: 'single-tenant'
      },
      blocks: [{ id: 'entity/customer-basic' }],
      slots: [
        {
          id: 'customer_normalizer',
          block: 'entity/customer-basic',
          kind: 'adapter',
          target: 'custom/../../control/evil.ts',
          sourcePath: 'source/code/slots/customer_normalizer.ts',
          symbol: 'normalizeCustomerInput',
          description: 'Normalize customer input.'
        }
      ],
      acceptance: []
    });

    expect(() => loadPlan(planPath))
      .toThrow(expect.objectContaining({ code: 'PLAN-VALIDATION-008' }));
  }, 'engineering-compiler-path-plan-slot-');
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
    slots: [],
    acceptance: [],
    routes: []
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
    const { projectRoot } = getWorkspacePaths(workspaceRoot);
    const step: InstallPlanStep = {
      stepId: 'private/path-test:1',
      blockId: 'private/path-test',
      registrySourceId: 'private',
      registryKind: 'private',
      registryLocation: 'workspace',
      registryPath: 'src/compiler/registry/private',
      sourceRoot: '',
      action: 'copy',
      from: 'files/source.ts',
      to: '../outside.ts'
    };

    await expect(defaultInstallRegistry.executeAll([step], {
      workspaceRoot,
      projectRoot,
      lock: {
        formatVersion: '1',
        app: { id: 'customer-admin', name: 'customer-admin', stack: 'typescript-library', mode: 'single-tenant' },
        resolvedBlocks: [],
        resolvedCapabilities: [],
        installPlan: [],
        slotTasks: [],
        generatedPaths: [],
        acceptancePlan: [],
        passStatus: {
          parse: 'succeeded',
          align: 'succeeded',
          resolve: 'succeeded',
          compose: 'pending',
          adapt: 'pending',
          verify: 'pending',
          repair: 'pending',
          lock: 'pending',
          emit: 'pending'
        }
      }
    })).rejects.toMatchObject({ code: 'COMPOSE-PATH-004' });
  }, 'engineering-compiler-path-install-target-');
});
