import { expect, test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { readOptionalCanonicalVerificationArtifactSet } from '../../../src/adapters/verification/platform/artifact/runtime/authority.ts';
import { publishVerificationArtifactSet } from '../../../src/adapters/verification/verification-artifact-publication.ts';
import { resolveWorkspaceArtifactPath } from "../../../src/adapters/workspace-context.ts";
import { ensureCanonicalWorkspaceArtifactParents } from '../../../src/adapters/workspace/project-base.ts';
import { isCanonicalVerificationArtifactSet } from '../../../src/assurance/verification/artifact/contract/artifact.ts';
import { CI_ARTIFACT_FILES } from '../../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { buildBlockedProductVerificationClaimSummary } from '../../../src/assurance/verification/profile/contract/product.ts';
import { productVerificationSubjectRevision } from '../../../src/assurance/verification/project/report.ts';
import { buildReviewLock } from '../../helpers/review-fixtures.ts';
import { buildSemanticViewFixture } from '../../helpers/semantic-view-fixtures.ts';
import { productVerificationObservationsFixture } from '../../helpers/verification-fixtures.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';

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
    formatVersion: '2' as const,
    status: 'skipped' as const,
    source: { resolvedBlockIds: [], acceptancePlan: [], declarations: [], tests: [] },
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
          productVerificationObservationsFixture('all', 'full', productVerificationSubjectRevision(publicationLock()))
        )
      },
      logs: { stdout: '', stderr: '' }
    },
    runtimeReport: runtime,
    policyReport,
    acceptanceCoverage
  };
}

function publicationLock() {
  return buildReviewLock({ passStatus: { verify: 'failed' }, semanticLoweringTasks: [], semanticViews: buildSemanticViewFixture() });
}

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

test('Verification artifact applies canonical inventory admission to runtime reports', () => {
  const candidate = blockedArtifactSet();
  const inventory = ['tests/runtime/z.test.ts', 'tests/runtime/a.test.ts'];
  candidate.verificationReport.runtime.unit.passed = inventory;
  candidate.runtimeReport.unit.passed = inventory;
  expect(isCanonicalVerificationArtifactSet(candidate)).toBe(false);
});


// These additional cases retain the real schemas, physical publishers, lock and
// canonical reader. They are native integration, not local boundary fixtures.
test('publication captures one root, nested artifact set and receiver-bound fence before callbacks', async () => {
  await withTempWorkspace(async workspaceRoot => {
    await ensureCanonicalWorkspaceArtifactParents(workspaceRoot);
    const expected = blockedArtifactSet();
    const requestedArtifacts = structuredClone(expected);
    class Input {
      #calls = 0;
      workspaceRoot = '.';
      artifacts = requestedArtifacts;
      lock = publicationLock();
      async commitFence() {
        this.#calls++;
        requestedArtifacts.verificationReport.fast.unit.passed.push('changed.test.ts');
        requestedArtifacts.runtimeReport.logs.stdout = 'changed';
        this.workspaceRoot = path.join(workspaceRoot, 'retargeted');
        this.artifacts = {} as typeof expected;
        this.lock = {} as ReturnType<typeof publicationLock>;
        this.commitFence = async () => assert.fail('replacement fence ran');
        process.chdir(tmpdir());
      }
      get calls() { return this.#calls; }
    }
    const input = new Input();
    const previous = process.cwd();
    try {
      process.chdir(workspaceRoot);
      const published = await publishVerificationArtifactSet(input);
      assert.ok(input.calls > 1);
      assert.deepEqual(published, expected);
      // The canonical reader needs only the four artifact leaves, not a Lock.
      await fs.rm(resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock));
      assert.deepEqual(readOptionalCanonicalVerificationArtifactSet(workspaceRoot), expected);
      await assert.rejects(fs.access(path.join(workspaceRoot, 'retargeted')));
    } finally { process.chdir(previous); }
  });
});
