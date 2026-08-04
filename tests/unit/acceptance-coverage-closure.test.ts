import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { buildAcceptanceCoverage } from '../../platform/compiler/verify/build-acceptance-coverage.ts';
import { writeJson } from '../../platform/shared/fs.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import type {
  BlockManifest,
  FastVerificationLaneReport,
  LockFile,
  RuntimeVerificationLaneReport,
  VerificationReport
} from '../../platform/shared/types.ts';
import { readYaml, writeYaml } from '../../platform/shared/yaml.ts';
import { emptyVerificationLogs } from '../helpers/verification-fixtures.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

function manifest(acceptance: BlockManifest['acceptance']): BlockManifest {
  return {
    id: 'source/block',
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

function lock(acceptancePlan: string[]): LockFile {
  return {
    formatVersion: '1',
    app: {
      id: 'coverage-closure',
      name: 'coverage-closure',
      stack: 'nextjs-ts-prisma-sqlite',
      mode: 'single-tenant'
    },
    resolvedBlocks: [{
      id: 'source/block',
      version: '0.1.0',
      kind: 'capability',
      installOrder: 1,
      manifestPath: 'block.manifest.yaml',
      registrySourceId: 'test',
      registryKind: 'private',
      registryLocation: 'workspace',
      registryPath: 'registry'
    }],
    resolvedCapabilities: [],
    installPlan: [],
    slotTasks: [],
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
      violations: []
    },
    logs: emptyVerificationLogs()
  };
}

function runtime(): RuntimeVerificationLaneReport {
  return {
    status: 'passed',
    build: {
      status: 'passed',
      passed: ['next build'],
      failed: [],
      command: 'bun run build'
    },
    unit: {
      status: 'passed',
      passed: ['tests/runtime/unit/example.test.ts'],
      failed: [],
      command: 'bun run test:unit'
    },
    acceptance: {
      status: 'passed',
      passed: [],
      failed: [],
      command: 'bun run test:acceptance'
    },
    logs: emptyVerificationLogs()
  };
}

async function writeManifest(
  workspaceRoot: string,
  acceptance: BlockManifest['acceptance']
): Promise<void> {
  const root = path.join(workspaceRoot, 'registry', 'source.block');
  await fs.mkdir(root, { recursive: true });
  await writeYaml(path.join(root, 'block.manifest.yaml'), manifest(acceptance));
}

test('a planned acceptance must cover at least one resolved block or slot', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await writeManifest(workspaceRoot, [{
      id: 'orphan_acceptance',
      covers: { blocks: [], slots: [] }
    }]);
    await expect(buildAcceptanceCoverage(
      workspaceRoot,
      lock(['orphan_acceptance']),
      runtime(),
      fast([])
    )).rejects.toThrow('covers no resolved block or slot');
  });
});

test('acceptance targets cannot reference unknown resolved block or slot identities', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await writeManifest(workspaceRoot, [{
      id: 'unknown_target',
      covers: { blocks: ['missing/block'], slots: ['missing_slot'] }
    }]);
    await expect(buildAcceptanceCoverage(
      workspaceRoot,
      lock(['unknown_target']),
      runtime(),
      fast([])
    )).rejects.toThrow('unknown resolved block');
  });
});

test('coverage readback restores fast acceptance from the matching canonical report', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await writeManifest(workspaceRoot, [{
      id: 'user_can_create_customer',
      covers: { blocks: ['source/block'] }
    }]);
    const fastLane = fast(['customer-flow.test.ts']);
    const runtimeLane = runtime();
    const report = {
      fast: fastLane,
      runtime: runtimeLane
    } as VerificationReport;
    await fs.mkdir(path.dirname(getWorkspacePaths(workspaceRoot).verificationReportPath), {
      recursive: true
    });
    await writeJson(getWorkspacePaths(workspaceRoot).verificationReportPath, report);

    const coverage = await buildAcceptanceCoverage(
      workspaceRoot,
      lock(['user_can_create_customer']),
      runtimeLane
    );
    expect(coverage.acceptancePassed).toEqual(['user_can_create_customer']);
    expect(coverage.uncoveredBlocks).toEqual([]);
  });
});

test('every official registry slot is declared by at least one acceptance cover', async () => {
  const officialRoot = path.resolve(import.meta.dir, '../../platform/registry/official');
  const manifests = (await fs.readdir(officialRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(officialRoot, entry.name, 'block.manifest.yaml'));
  expect(manifests.length).toBeGreaterThan(0);

  for (const manifestPath of manifests) {
    const parsed = await readYaml<BlockManifest>(manifestPath);
    const coveredSlots = new Set(
      (parsed.acceptance ?? []).flatMap((acceptance) => acceptance.covers?.slots ?? [])
    );
    for (const slot of parsed.slots ?? []) {
      expect(
        coveredSlots.has(slot.id),
        `${parsed.id} slot ${slot.id} must be declared by an acceptance cover`
      ).toBe(true);
    }
  }
});
