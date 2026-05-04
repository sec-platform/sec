import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { buildAcceptanceCoverage } from '../../platform/compiler/verify/build-acceptance-coverage.ts';
import type { BlockManifest, LockFile, RuntimeVerificationLaneReport } from '../../platform/shared/types.ts';
import { writeYaml } from '../../platform/shared/yaml.ts';
import { emptyVerificationLogs } from '../helpers/verification-fixtures.ts';
import { withTempWorkspace } from '../helpers/workspace-fixtures.ts';

function manifest(id: string, acceptance: BlockManifest['acceptance']): BlockManifest {
  return {
    id,
    version: '0.1.0',
    kind: 'capability',
    stackProfiles: ['nextjs-ts-prisma-sqlite'],
    requires: [],
    provides: [],
    conflicts: [],
    installs: [{ kind: 'copy', from: 'files/source.ts', to: 'src/source.ts' }],
    pins: { inputs: [], outputs: [] },
    slots: [],
    acceptance,
    routes: []
  };
}

function runtime(passed: string[]): RuntimeVerificationLaneReport {
  const acceptancePassed = passed.length > 0;
  return {
    status: acceptancePassed ? 'passed' : 'failed',
    build: { status: 'skipped', passed: [], failed: [], command: null },
    unit: { status: 'skipped', passed: [], failed: [], command: null },
    acceptance: { status: acceptancePassed ? 'passed' : 'failed', passed, failed: acceptancePassed ? [] : passed, command: 'bun run test:acceptance' },
    logs: emptyVerificationLogs()
  };
}

test('acceptance coverage honors covers and dependsOn declarations', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const registryRoot = path.join(workspaceRoot, 'registry');
    await fs.mkdir(path.join(registryRoot, 'source.block'), { recursive: true });
    await fs.mkdir(path.join(registryRoot, 'target.block'), { recursive: true });
    await writeYaml(
      path.join(registryRoot, 'source.block', 'block.manifest.yaml'),
      manifest('source/block', [
        {
          id: 'source_smoke',
          covers: {
            blocks: ['source/block']
          }
        },
        {
          id: 'cross_block_flow',
          dependsOn: ['source_smoke'],
          covers: {
            blocks: ['target/block', 'target/block'],
            slots: ['target_slot', 'target_slot']
          }
        },
        {
          id: 'chained_cross_block_flow',
          dependsOn: ['cross_block_flow'],
          covers: {
            blocks: ['target/block'],
            slots: ['target_slot']
          }
        },
        {
          id: 'cycle_a',
          dependsOn: ['cycle_b'],
          covers: {
            blocks: ['target/block']
          }
        },
        {
          id: 'cycle_b',
          dependsOn: ['cycle_a'],
          covers: {
            blocks: ['target/block']
          }
        },
        {
          id: 'source_smoke',
          dependsOn: ['missing_duplicate_dependency'],
          covers: {
            blocks: ['target/block']
          }
        }
      ])
    );
    await writeYaml(
      path.join(registryRoot, 'target.block', 'block.manifest.yaml'),
      manifest('target/block', [{ id: 'target_declared_only' }])
    );

    const lock: LockFile = {
      formatVersion: '1',
      app: {
        name: 'customer-admin',
        stack: 'nextjs-ts-prisma-sqlite',
        mode: 'single-tenant'
      },
      resolvedBlocks: [
        {
          id: 'source/block',
          version: '0.1.0',
          kind: 'capability',
          installOrder: 1,
          manifestPath: 'block.manifest.yaml',
          registrySourceId: 'test',
          registryKind: 'private',
          registryLocation: 'workspace',
          registryPath: 'registry'
        },
        {
          id: 'target/block',
          version: '0.1.0',
          kind: 'capability',
          installOrder: 2,
          manifestPath: 'block.manifest.yaml',
          registrySourceId: 'test',
          registryKind: 'private',
          registryLocation: 'workspace',
          registryPath: 'registry'
        }
      ],
      resolvedCapabilities: [],
      installPlan: [],
      slotTasks: [
        {
          id: 'target_slot',
          block: 'target/block',
          target: 'custom/target_slot.ts',
          symbol: 'targetSlot',
          kind: 'adapter',
          status: 'filled',
          writableZones: ['custom/target_slot.ts'],
          provenanceHints: {
            generator: 'test',
            verifiedBy: []
          }
        }
      ],
      generatedPaths: [],
      acceptancePlan: [
        'source_smoke',
        'cross_block_flow',
        'chained_cross_block_flow',
        'cycle_a',
        'cycle_b',
        'target_declared_only'
      ],
      passStatus: {
        parse: 'succeeded',
        align: 'succeeded',
        resolve: 'succeeded',
        compose: 'succeeded',
        adapt: 'succeeded',
        verify: 'succeeded',
        repair: 'skipped',
        lock: 'pending',
        emit: 'pending'
      }
    };

    const missingDependencyCoverage = await buildAcceptanceCoverage(workspaceRoot, lock, runtime(['cross_block_flow']));
    expect(missingDependencyCoverage.blocks.find((entry) => entry.id === 'target/block')).toMatchObject({
      declaredAcceptance: ['chained_cross_block_flow', 'cross_block_flow', 'cycle_a', 'cycle_b', 'source_smoke', 'target_declared_only'],
      coveredBy: [],
      uncovered: true
    });
    expect(missingDependencyCoverage.slots.find((entry) => entry.id === 'target_slot')).toMatchObject({
      declaredAcceptance: ['chained_cross_block_flow', 'cross_block_flow'],
      coveredBy: [],
      uncovered: true
    });

    const missingTransitiveDependencyCoverage = await buildAcceptanceCoverage(
      workspaceRoot,
      lock,
      runtime(['chained_cross_block_flow', 'cross_block_flow'])
    );
    expect(missingTransitiveDependencyCoverage.blocks.find((entry) => entry.id === 'target/block')).toMatchObject({
      coveredBy: [],
      uncovered: true
    });

    const cyclicDependencyCoverage = await buildAcceptanceCoverage(workspaceRoot, lock, runtime(['cycle_a', 'cycle_b']));
    expect(cyclicDependencyCoverage.blocks.find((entry) => entry.id === 'target/block')).toMatchObject({
      coveredBy: ['cycle_a', 'cycle_b'],
      uncovered: false
    });

    const covered = await buildAcceptanceCoverage(workspaceRoot, lock, runtime(['unknown_flow', 'cross_block_flow', 'source_smoke', 'source_smoke']));
    expect(covered.acceptancePassed).toHaveLength(2);
    expect(covered.blocks.find((entry) => entry.id === 'source/block')).toMatchObject({
      declaredAcceptance: ['source_smoke'],
      coveredBy: ['source_smoke'],
      uncovered: false
    });
    expect(covered.blocks.find((entry) => entry.id === 'target/block')).toMatchObject({
      declaredAcceptance: ['chained_cross_block_flow', 'cross_block_flow', 'cycle_a', 'cycle_b', 'source_smoke', 'target_declared_only'],
      coveredBy: ['cross_block_flow'],
      uncovered: false
    });
    expect(covered.slots.find((entry) => entry.id === 'target_slot')).toMatchObject({
      declaredAcceptance: ['chained_cross_block_flow', 'cross_block_flow'],
      coveredBy: ['cross_block_flow'],
      uncovered: false
    });
    expect(covered.uncoveredBlocks).toHaveLength(0);
    expect(covered.uncoveredSlots).toHaveLength(0);

    // When acceptance has no test files, coverage falls back to the declared
    // acceptance chain: all targets on the dependency chain are considered covered.
    const noAcceptanceFilesRuntime: RuntimeVerificationLaneReport = {
      status: 'passed',
      build: { status: 'passed', passed: ['next build'], failed: [], command: 'bun run build' },
      unit: { status: 'passed', passed: ['tests/runtime/unit/example.test.ts'], failed: [], command: 'bun run test:unit' },
      acceptance: { status: 'passed', passed: [], failed: [], command: 'bun run test:acceptance' },
      logs: emptyVerificationLogs()
    };
    const fallback = await buildAcceptanceCoverage(workspaceRoot, lock, noAcceptanceFilesRuntime);
    expect(fallback.acceptancePassed).toHaveLength(6);
    expect(fallback.blocks.find((entry) => entry.id === 'target/block')).toMatchObject({
      coveredBy: ['chained_cross_block_flow', 'cross_block_flow', 'cycle_a', 'cycle_b', 'target_declared_only'],
      uncovered: false
    });
  });
});
