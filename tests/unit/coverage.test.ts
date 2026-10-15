import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { buildAcceptanceCoverage } from '../../src/adapters/verification/build-acceptance-coverage.ts';
import { writeYaml } from '../../src/adapters/workspace/yaml.ts';
import type { FastVerificationLaneReport, RuntimeVerificationLaneReport } from '../../src/assurance/verification/contract/types.ts';
import type {
  BlockManifest,
  LockFile
} from '../../src/compiler/contract.ts';
import { emptyVerificationLogs } from '../helpers/verification-fixtures.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

function manifest(id: string, acceptance: BlockManifest['acceptance']): BlockManifest {
  return {
    id,
    version: '0.1.0',
    kind: 'capability',
    stackProfiles: ['typescript-library'],
    requires: [],
    provides: [],
    conflicts: [],
    installs: [{ kind: 'copy', from: 'files/source.ts', to: 'src/source.ts' }],
    pins: { inputs: [], outputs: [] },
    acceptance
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
      status: 'passed', passed: ['bun run build'], failed: [], command: 'bun run build'
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

function lock(acceptancePlan: string[], acceptanceSources: NonNullable<LockFile['acceptanceSources']>): LockFile {
  return {
    formatVersion: '1',
    app: {
      id: 'coverage-test',
      name: 'coverage-test',
      stack: 'typescript-library',
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
    installPlan: [...new Set(acceptanceSources.flatMap(entry => entry.acceptance.source?.tests ?? []))].map((to, index) => ({
      stepId: `source:${index}`, blockId: 'source/block', registrySourceId: 'test', registryKind: 'private',
      registryLocation: 'workspace', registryPath: 'registry', sourceRoot: 'files', action: 'copy', from: to, to
    })),
    generatedPaths: [],
    acceptancePlan,
    acceptanceSources,
    passStatus: {
      parse: 'succeeded',
      align: 'succeeded',
      resolve: 'succeeded',
      compose: 'succeeded',
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
): Promise<NonNullable<LockFile['acceptanceSources']>> {
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
  return sourceAcceptance.map(acceptance => ({ declaringBlockId: 'source/block', acceptance }));
}

test('fast and runtime files close every declared semantic acceptance', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const captured = await writeManifests(workspaceRoot, [
      {
        id: 'user_can_login',
        source: { tests: ['tests/acceptance/auth-flow.test.ts'] },
        covers: { blocks: ['source/block'] }
      },
      {
        id: 'user_can_create_customer',
        source: { tests: ['tests/acceptance/customer-flow.test.ts'] },
        dependsOn: ['user_can_login'],
        covers: { blocks: ['source/block'] }
      },
      {
        id: 'customer_can_upload_attachment',
        source: { tests: ['tests/acceptance/customer-attachments-flow.test.ts'] },
        dependsOn: ['user_can_create_customer'],
        covers: { blocks: ['target/block'] }
      }
    ]);

    const coverage = await buildAcceptanceCoverage(
      workspaceRoot,
      lock([
        'user_can_login',
        'user_can_create_customer',
        'customer_can_upload_attachment'
      ], captured),
      runtime([
        'tests/acceptance/auth-flow.test.ts',
        'tests/acceptance/customer-attachments-flow.test.ts'
      ]),
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
    expect(coverage.uncoveredBlocks).toEqual([]);
  });
});

test('partial, unmapped and empty observations remain uncovered', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const captured = await writeManifests(workspaceRoot, [
      {
        id: 'user_can_create_customer',
        source: { tests: ['tests/acceptance/customer-flow.test.ts'] },
        covers: { blocks: ['source/block'] }
      },
      {
        id: 'customer_can_upload_attachment',
        source: { tests: ['tests/acceptance/customer-attachments-flow.test.ts'] },
        dependsOn: ['user_can_create_customer'],
        covers: { blocks: ['target/block'] }
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
    ], captured);

    const partial = await buildAcceptanceCoverage(
      workspaceRoot,
      currentLock,
      runtime([
        'tests/acceptance/customer-attachments-flow.test.ts',
        'tests/acceptance/customer-flow.test.ts'
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
  });
});

test('acceptance plan cannot reference an undeclared ID', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const captured = await writeManifests(workspaceRoot, []);
    await expect(buildAcceptanceCoverage(
      workspaceRoot,
      lock(['missing_acceptance'], captured),
      runtime([]),
      fast([])
    )).rejects.toThrow(/undeclared acceptance ID missing_acceptance/);
  });
});
