import { expect, test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { readOptionalCanonicalVerificationArtifactSet } from '../../src/adapters/verification/platform/artifact/runtime/authority.ts';
import { publishVerificationArtifactSet } from '../../src/adapters/verification/verification-artifact-publication.ts';
import { resolveWorkspaceArtifactPath } from "../../src/adapters/workspace-context.ts";
import { ensureProjectBase } from '../../src/adapters/workspace/project-base.ts';
import { isCanonicalVerificationArtifactSet } from '../../src/assurance/verification/artifact/contract/artifact.ts';
import { CI_ARTIFACT_FILES } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { buildBlockedProductVerificationClaimSummary } from '../../src/assurance/verification/profile/contract/product.ts';
import { buildReviewLock } from '../helpers/review-fixtures.ts';
import { productVerificationObservationsFixture } from '../helpers/verification-fixtures.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

function skippedPolicyReport() {
  return {
    status: 'skipped' as const,
    official: { policies: [], sources: [], violations: [] },
    project: { policies: [], sources: [], violations: [] },
    merged: { policies: [] },
    violations: [],
    diagnostics: []
  };
}

function skippedRuntimeStep() {
  return {
    status: 'skipped' as const,
    passed: [] as string[],
    failed: [] as string[],
    command: null as string | null
  };
}

function blockedArtifactSet() {
  const policyReport = skippedPolicyReport();
  const fast = {
    status: 'failed' as const,
    build: { status: 'skipped' as const },
    unit: { status: 'skipped' as const, passed: [] as string[] },
    acceptance: {
      status: 'skipped' as const,
      passed: [] as string[],
      failed: [] as string[]
    },
    policy: { status: 'skipped' as const, violations: [] },
    policyReport,
    logs: { stdout: '', stderr: '' }
  };
  const runtime = {
    status: 'skipped' as const,
    build: skippedRuntimeStep(),
    unit: skippedRuntimeStep(),
    acceptance: skippedRuntimeStep(),
    logs: { stdout: '', stderr: '' }
  };
  const acceptanceCoverage = {
    formatVersion: '1' as const,
    status: 'skipped' as const,
    acceptancePassed: [] as string[],
    blocks: [],
    uncoveredBlocks: [] as string[]
  };

  return {
    verificationReport: {
      build: fast.build,
      unit: fast.unit,
      acceptance: fast.acceptance,
      policy: fast.policy,
      fast,
      runtime,
      summary: {
        status: 'failed' as const,
        requestedLane: 'all' as const,
        failedLanes: ['fast' as const],
        claimSummary: buildBlockedProductVerificationClaimSummary(
          'all',
          productVerificationObservationsFixture()
        )
      },
      logs: { stdout: '', stderr: '' }
    },
    runtimeReport: runtime,
    policyReport,
    acceptanceCoverage
  };
}

test('Verification artifact publisher bytes round-trip through the canonical reader', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await ensureProjectBase(workspaceRoot);
    const artifacts = blockedArtifactSet();
    await publishVerificationArtifactSet({
      workspaceRoot,
      lock: buildReviewLock({ passStatus: { verify: 'failed' } }),
      artifacts
    });

    await expect(fs.access(
      resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.verificationReport)
    ).then(() => true)).resolves.toBe(true);
    expect(readOptionalCanonicalVerificationArtifactSet(workspaceRoot)).toEqual(artifacts);
  });
});

test('Verification artifact reader resolves the native canonical inventory without path aliases', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const artifacts = blockedArtifactSet();
    const publications = [
      [CI_ARTIFACT_FILES.verificationReport, artifacts.verificationReport],
      [CI_ARTIFACT_FILES.runtimeReport, artifacts.runtimeReport],
      [CI_ARTIFACT_FILES.policyReport, artifacts.policyReport],
      [CI_ARTIFACT_FILES.acceptanceCoverage, artifacts.acceptanceCoverage]
    ] as const;

    for (const [artifactPath, artifact] of publications) {
      const filePath = resolveWorkspaceArtifactPath(workspaceRoot, artifactPath);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
    }

    expect(readOptionalCanonicalVerificationArtifactSet(workspaceRoot)).toEqual(artifacts);
  });
});

test('Verification artifact rejects duplicate, blank and noncanonical fast inventories', () => {
  for (const inventory of [
    ['unit/z.test.ts', 'unit/a.test.ts'],
    ['unit/a.test.ts', 'unit/a.test.ts'],
    ['']
  ]) {
    const candidate = blockedArtifactSet();
    candidate.verificationReport.fast.unit.passed = inventory;
    candidate.verificationReport.unit.passed = inventory;
    expect(isCanonicalVerificationArtifactSet(candidate)).toBe(false);
  }
});

test('Verification artifact rejects duplicate and noncanonical runtime inventories', () => {
  for (const inventory of [
    ['tests/runtime/z.test.ts', 'tests/runtime/a.test.ts'],
    ['tests/runtime/a.test.ts', 'tests/runtime/a.test.ts']
  ]) {
    const candidate = blockedArtifactSet();
    candidate.verificationReport.runtime.unit.passed = inventory;
    candidate.runtimeReport.unit.passed = inventory;
    expect(isCanonicalVerificationArtifactSet(candidate)).toBe(false);
  }
});


// These additional cases retain the real schemas, physical publishers, lock and
// canonical reader. They are native integration, not local boundary fixtures.
test('publication owns one root, input set and callback despite mutation at the first fence', async () => {
  await withTempWorkspace(async workspaceRoot => {
    await ensureProjectBase(workspaceRoot);
    const expected = blockedArtifactSet();
    const input = { workspaceRoot, artifacts: structuredClone(expected),
      lock: buildReviewLock({ passStatus: { verify: 'failed' } }), commitFence: async () => {} };
    let calls = 0;
    input.commitFence = async () => {
      calls++;
      input.workspaceRoot = path.join(workspaceRoot, 'retargeted');
      input.artifacts = {} as typeof input.artifacts;
      input.lock = {} as typeof input.lock;
      input.commitFence = async () => assert.fail('replacement fence ran');
    };
    const published = await publishVerificationArtifactSet(input);
    assert.ok(calls > 1);
    assert.deepEqual(published, expected);
    assert.deepEqual(readOptionalCanonicalVerificationArtifactSet(workspaceRoot), expected);
    await assert.rejects(fs.access(path.join(workspaceRoot, 'retargeted')));
  });
});

test('nested source changes cannot retarget the already validated artifact set', async () => {
  await withTempWorkspace(async workspaceRoot => {
    await ensureProjectBase(workspaceRoot);
    const artifacts = blockedArtifactSet(), expected = structuredClone(artifacts);
    await publishVerificationArtifactSet({ workspaceRoot, artifacts,
      lock: buildReviewLock({ passStatus: { verify: 'failed' } }), commitFence: async () => {
        artifacts.verificationReport.fast.unit.passed.push('changed.test.ts');
        artifacts.runtimeReport.logs.stdout = 'changed';
      } });
    assert.deepEqual(readOptionalCanonicalVerificationArtifactSet(workspaceRoot), expected);
  });
});

test('a relative publication root cannot move when the callback changes cwd', async () => {
  await withTempWorkspace(async workspaceRoot => {
    await ensureProjectBase(workspaceRoot);
    const previous = process.cwd(), artifacts = blockedArtifactSet();
    try {
      process.chdir(workspaceRoot);
      await publishVerificationArtifactSet({ workspaceRoot: '.', artifacts,
        lock: buildReviewLock({ passStatus: { verify: 'failed' } }), commitFence: async () => { process.chdir(tmpdir()); } });
      assert.deepEqual(readOptionalCanonicalVerificationArtifactSet(workspaceRoot), artifacts);
    } finally { process.chdir(previous); }
  });
});

test('publication callback keeps private state on the actual provider receiver', async () => {
  await withTempWorkspace(async workspaceRoot => {
    await ensureProjectBase(workspaceRoot);
    class Input {
      #calls = 0;
      workspaceRoot = workspaceRoot;
      artifacts = blockedArtifactSet();
      lock = buildReviewLock({ passStatus: { verify: 'failed' } });
      async commitFence() { this.#calls++; }
      get calls() { return this.#calls; }
    }
    const input = new Input();
    await publishVerificationArtifactSet(input);
    assert.ok(input.calls > 1);
    assert.deepEqual(readOptionalCanonicalVerificationArtifactSet(workspaceRoot), input.artifacts);
  });
});

test('invalid callback rejects before any verification artifact is published', async () => {
  await withTempWorkspace(async workspaceRoot => {
    await ensureProjectBase(workspaceRoot);
    await assert.rejects(publishVerificationArtifactSet({ workspaceRoot, artifacts: blockedArtifactSet(),
      lock: buildReviewLock({ passStatus: { verify: 'failed' } }), commitFence: 7 as never }), TypeError);
    for (const key of ['runtimeReport', 'policyReport', 'acceptanceCoverage', 'verificationReport'] as const) {
      await assert.rejects(fs.access(resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES[key])));
    }
  });
});
