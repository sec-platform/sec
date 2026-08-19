import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { buildAcceptanceCoverage } from '../../platform/compiler/verify/build-acceptance-coverage.ts';
import type {
  BlockManifest,
  FastVerificationLaneReport,
  LockFile,
  RuntimeVerificationLaneReport
} from '../../platform/shared/types.ts';
import { writeYaml } from '../../platform/shared/yaml.ts';
import { emptyVerificationLogs } from '../helpers/verification-fixtures.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

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

function fast(passed: string[]): FastVerificationLaneReport {
  return {
    status: 'passed',
    build: { status: 'passed' },
    unit: { status: 'passed', passed: ['example.test.ts'] },
    acceptance: { status: 'passed', passed, failed: [] },
    policy: { status: 'skipped', violations: [] },
    policyReport: {
      status: 'skipped',
      official: { policies: [], sources: [], violations: [] },
      project: { policies: [], sources: [], violations: [] },
      merged: { policies: [] },
      violations: [],
      diagnostics: []
    },
    logs: emptyVerificationLogs()
  };
}

function runtime(passed: string[]): RuntimeVerificationLaneReport {
  return {
    status: 'passed',
    build: {
      status: 'passed', passed: ['next build'], failed: [], command: 'bun run build'
    },
    unit: {
      status: 'passed',
      passed: ['tests/runtime/unit/example.test.ts'],
      failed: [],
      command: 'bun run test:unit'
    },
    acceptance: {
      status: 'passed',
      passed,
      failed: [],
      command: 'bun run test:acceptance'
    },
    logs: emptyVerificationLogs()
  };
}

function lock(acceptancePlan: string[]): LockFile {
  return {
    formatVersion: '1',
    app: {
      id: 'coverage-test',
      name: 'coverage-test',
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
        provenanceHints: { generator: 'test', verifiedBy: [] }
      }
    ],
    generatedPaths: [],
    acceptancePlan,
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
}

async function writeManifests(
  workspaceRoot: string,
  sourceAcceptance: BlockManifest['acceptance']
): Promise<void> {
  const registryRoot = path.join(workspaceRoot, 'registry');
  await fs.mkdir(path.join(registryRoot, 'source.block'), { recursive: true });
  await fs.mkdir(path.join(registryRoot, 'target.block'), { recursive: true });
  await writeYaml(
    path.join(registryRoot, 'source.block', 'block.manifest.yaml'),
    manifest('source/block', sourceAcceptance)
  );
  await writeYaml(
    path.join(registryRoot, 'target.block', 'block.manifest.yaml'),
    manifest('target/block', [])
  );
}

test('fast and runtime files close every declared semantic acceptance', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await writeManifests(workspaceRoot, [
      {
        id: 'user_can_login',
        covers: { blocks: ['source/block'] }
      },
      {
        id: 'user_can_create_customer',
        dependsOn: ['user_can_login'],
        covers: { blocks: ['source/block'] }
      },
      {
        id: 'customer_can_upload_attachment',
        dependsOn: ['user_can_create_customer'],
        covers: { blocks: ['target/block'], slots: ['target_slot'] }
      }
    ]);

    const coverage = await buildAcceptanceCoverage(
      workspaceRoot,
      lock([
        'user_can_login',
        'user_can_create_customer',
        'customer_can_upload_attachment'
      ]),
      runtime(['tests/runtime/acceptance/customer-flow.spec.ts']),
      fast(['customer-flow.test.ts'])
    );

    expect(coverage.acceptancePassed).toEqual([
      'customer_can_upload_attachment',
      'user_can_create_customer',
      'user_can_login'
    ]);
    expect(coverage.blocks).toEqual([
      {
        id: 'source/block',
        declaredAcceptance: ['user_can_create_customer', 'user_can_login'],
        coveredBy: ['user_can_create_customer', 'user_can_login'],
        uncovered: false
      },
      {
        id: 'target/block',
        declaredAcceptance: ['customer_can_upload_attachment'],
        coveredBy: ['customer_can_upload_attachment'],
        uncovered: false
      }
    ]);
    expect(coverage.slots[0]).toEqual({
      id: 'target_slot',
      declaredAcceptance: ['customer_can_upload_attachment'],
      coveredBy: ['customer_can_upload_attachment'],
      uncovered: false
    });
    expect(coverage.uncoveredBlocks).toEqual([]);
    expect(coverage.uncoveredSlots).toEqual([]);
  });
});

test('partial, unmapped and empty observations remain uncovered', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await writeManifests(workspaceRoot, [
      {
        id: 'user_can_create_customer',
        covers: { blocks: ['source/block'] }
      },
      {
        id: 'customer_can_upload_attachment',
        dependsOn: ['user_can_create_customer'],
        covers: { blocks: ['target/block'], slots: ['target_slot'] }
      },
      {
        id: 'unmapped_acceptance',
        covers: { blocks: ['target/block'] }
      }
    ]);
    const currentLock = lock([
      'user_can_create_customer',
      'customer_can_upload_attachment',
      'unmapped_acceptance'
    ]);

    const partial = await buildAcceptanceCoverage(
      workspaceRoot,
      currentLock,
      runtime([
        'tests/runtime/acceptance/customer-flow.spec.ts'
      ]),
      fast([])
    );
    expect(partial.acceptancePassed).toEqual([
      'customer_can_upload_attachment',
      'user_can_create_customer'
    ]);
    expect(partial.blocks.find((entry) => entry.id === 'target/block')).toEqual({
      id: 'target/block',
      declaredAcceptance: [
        'customer_can_upload_attachment',
        'unmapped_acceptance'
      ],
      coveredBy: ['customer_can_upload_attachment'],
      uncovered: true
    });
    expect(partial.uncoveredBlocks).toEqual(['target/block']);

    const empty = await buildAcceptanceCoverage(
      workspaceRoot,
      currentLock,
      runtime([]),
      fast([])
    );
    expect(empty.acceptancePassed).toEqual([]);
    expect(empty.blocks.every((entry) => entry.uncovered)).toBe(true);
    expect(empty.slots.every((entry) => entry.uncovered)).toBe(true);
  });
});

test('acceptance plan cannot reference an undeclared ID', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await writeManifests(workspaceRoot, []);
    await expect(buildAcceptanceCoverage(
      workspaceRoot,
      lock(['missing_acceptance']),
      runtime([]),
      fast([])
    )).rejects.toThrow(/undeclared acceptance ID missing_acceptance/);
  });
});
