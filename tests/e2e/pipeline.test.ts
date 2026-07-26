import { expect, test } from 'bun:test';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import fs, { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { buildProvenanceSummary } from '../../platform/compiler/emit/write-review-summary.ts';
import {
  addBlock,
  compileWorkspace,
  explainWorkspace,
  initWorkspace,
  upgradeWorkspace
} from '../../platform/orchestrator.ts';
import {
  assertPipelineCompletionProofInvariant,
  buildPipelineCompletionProof,
  createPipelineCompletionProof,
  type PipelineCompletionProofEvidenceV1,
  type PipelineCompletionProofStageEvidenceV1
} from '../../platform/orchestrator/pipeline-orchestrator.ts';
import { CI_ARTIFACT_FILES } from '../../platform/shared/ci-artifact-contract.ts';
import { formatJsonFile, readJson } from '../../platform/shared/fs.ts';
import {
  getWorkspacePaths,
  graphViewRelativePath,
  overviewViewRelativePath,
  reviewViewRelativePath,
  slotRuleViewRelativePath,
  sourceViewRelativePath
} from '../../platform/shared/paths.ts';
import { readPipelineJournal } from '../../platform/shared/pipeline-journal.ts';
import { getPipelineStageDefinition } from '../../platform/shared/pipeline-pass-registry.ts';
import { PIPELINE_STAGE_IDS } from '../../platform/shared/pipeline-types.ts';
import type { ProvenanceArtifact, ProvenanceFile } from '../../platform/shared/provenance-types.ts';
import type { ReviewSummary } from '../../platform/shared/review-types.ts';
import { acquireWorkspaceWriteLease } from '../../platform/shared/workspace-write-lease.ts';
import {
  expectGraphEdge,
  expectReviewConflictHint,
  expectReviewRegressionRisk
} from '../helpers/graph-assertions.ts';
import {
  prepareAdaptedWorkspace,
  prepareLockedWorkspace,
  withTempWorkspace
} from '../testkit/workspace.ts';

const staleRevision = `sha256:${'0'.repeat(64)}`;

test('upgrade advances an official block version and preserves a passing pipeline', async () => {
  const workspaceRoot = await prepareLockedWorkspace({ prefix: 'engineering-compiler-upgrade-' });
  const { upgradePlanPath } = getWorkspacePaths(workspaceRoot);

  const beforeUpgrade = await fs.readFile(
    path.join(workspaceRoot, 'project', 'src', 'installed', 'auth', 'session.ts'),
    'utf8'
  );
  expect(beforeUpgrade).toMatch(/SESSION_BLOCK_VERSION = '0\.1\.0'/);

  const { plan, lock, upgradePlan } = await upgradeWorkspace(workspaceRoot, 'auth/basic-session', '0.1.1');
  expect(plan.blocks.find((block) => block.id === 'auth/basic-session')?.version).toBe('0.1.1');
  expect(lock.resolvedBlocks.find((block) => block.id === 'auth/basic-session')?.version).toBe('0.1.1');
  expect(lock.passStatus.lock).toBe('succeeded');
  expect(upgradePlan.status).toBe('applied');
  expect(lock.generatedPaths).toContain(CI_ARTIFACT_FILES.upgradePlan);

  const afterUpgrade = await fs.readFile(
    path.join(workspaceRoot, 'project', 'src', 'installed', 'auth', 'session.ts'),
    'utf8'
  );
  expect(afterUpgrade).toMatch(/SESSION_BLOCK_VERSION = '0\.1\.1'/);
  expect(afterUpgrade).toMatch(/SUPPORTED_USERNAMES/);
  await expect(fs.readFile(path.join(workspaceRoot, 'project', 'upgrade.metadata.json'), 'utf8')).resolves.toContain('"auth/basic-session@0.1.1"');

  const persistedUpgradePlan = await readJson<{
    toVersion: string;
    status: string;
    preflightChecks: Array<{ id: string; status: string; message: string; evidence: string[] }>;
    impacts: string[];
    migrationKindCounts: Record<string, number>;
    migrationSummaries: Array<{
      id: string;
      kind: string;
      source?: string;
      target: string;
      reason: string;
      requiresVerification: boolean;
    }>;
    migrationOperations: Array<{
      id: string;
      kind: string;
      target: string;
      role: string;
      source?: string;
      path?: string[];
      itemCount?: number;
    }>;
  }>(upgradePlanPath);
  expect(persistedUpgradePlan.toVersion).toBe('0.1.1');
  expect(persistedUpgradePlan.status).toBe('applied');
  expect(persistedUpgradePlan.preflightChecks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'version-range', status: 'passed', evidence: ['0.1.x'] }),
      expect.objectContaining({
        id: 'migration-entries',
        status: 'passed',
        evidence: [
          'mig-auth-session-refresh:migrations/auth-session-refresh.json',
          'mig-auth-session-upgrade-metadata:migrations/auth-session-upgrade-metadata.json'
        ]
      }),
      expect.objectContaining({
        id: 'migration-targets',
        status: 'passed',
        evidence: [
          'mig-auth-session-refresh:target:src/installed/auth/session.ts:exists',
          'mig-auth-session-upgrade-metadata:target:upgrade.metadata.json:missing'
        ]
      }),
      expect.objectContaining({
        id: 'migration-file-operations',
        status: 'passed',
        evidence: ['mig-auth-session-refresh:manifest-source:exists']
      }),
      expect.objectContaining({
        id: 'migration-json-shapes',
        status: 'passed',
        evidence: ['mig-auth-session-upgrade-metadata:path:upgradedBlocks:array:1']
      }),
      expect.objectContaining({
        id: 'migration-json-structure',
        status: 'passed',
        evidence: ['mig-auth-session-upgrade-metadata:target:missing']
      }),
      expect.objectContaining({ id: 'impact-scan', status: 'passed', evidence: ['src/installed/auth/session.ts', 'upgrade.metadata.json'] }),
      expect.objectContaining({ id: 'override-conflicts', status: 'passed', evidence: [] })
    ])
  );
  expect(persistedUpgradePlan.impacts).toEqual(
    expect.arrayContaining(['src/installed/auth/session.ts', 'upgrade.metadata.json'])
  );
  expect(persistedUpgradePlan.migrationKindCounts).toEqual({
    'file-replace': 1,
    'json-array-append': 1
  });
  expect(persistedUpgradePlan.migrationSummaries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 'mig-auth-session-refresh',
        kind: 'file-replace',
        target: 'src/installed/auth/session.ts',
        requiresVerification: true
      }),
      expect.objectContaining({
        id: 'mig-auth-session-upgrade-metadata',
        kind: 'json-array-append',
        target: 'upgrade.metadata.json',
        requiresVerification: false
      })
    ])
  );
  expect(persistedUpgradePlan.migrationOperations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'mig-auth-session-refresh', role: 'file' }),
      expect.objectContaining({ id: 'mig-auth-session-upgrade-metadata', role: 'json' })
    ])
  );

  const { reviewSummary } = await explainWorkspace(workspaceRoot);
  expectReviewConflictHint(reviewSummary, {
    kind: 'upgrade-plan-present',
    relatedId: 'auth/basic-session',
    message: 'Upgrade plan applied, verify pending: auth/basic-session 0.1.0 -> 0.1.1'
  });
}, 180000);

test('upgrade advances ticket block version and surfaces runtime upgrade impact', async () => {
  const workspaceRoot = await prepareAdaptedWorkspace({
    prefix: 'engineering-compiler-ticket-upgrade-',
    blockIds: ['ticket/basic']
  });

  const ticketServicePath = path.join(workspaceRoot, 'project', 'src', 'installed', 'ticket', 'ticket-service.ts');
  const beforeUpgrade = await fs.readFile(ticketServicePath, 'utf8');
  expect(beforeUpgrade).not.toMatch(/TICKET_BLOCK_VERSION/);

  const { plan, lock, upgradePlan } = await upgradeWorkspace(workspaceRoot, 'ticket/basic', '0.1.1');

  const plannedTicketBlock = plan.blocks.find((block) => block.id === 'ticket/basic');
  const resolvedTicketBlock = lock.resolvedBlocks.find((block) => block.id === 'ticket/basic');
  expect(plannedTicketBlock?.version).toBe('0.1.1');
  expect(resolvedTicketBlock?.version).toBe('0.1.1');
  expect(lock.passStatus.lock).toBe('succeeded');
  expect(upgradePlan.status).toBe('applied');
  expect(upgradePlan.impacts.length).toBeGreaterThan(0);
  expect(upgradePlan.migrationKindCounts).toEqual({
    'file-replace': 1,
    'json-array-append': 1
  });

  const afterUpgrade = await fs.readFile(ticketServicePath, 'utf8');
  expect(afterUpgrade).toMatch(/TICKET_BLOCK_VERSION = '0\.1\.1'/);
  const upgradeMetadataPath = path.join(workspaceRoot, 'project', 'upgrade.metadata.json');
  const upgradeMetadata = await fs.readFile(upgradeMetadataPath, 'utf8');
  expect(upgradeMetadata).toContain('"ticket/basic@0.1.1"');

  const { graph, reviewSummary } = await explainWorkspace(workspaceRoot);
  expectReviewConflictHint(reviewSummary, {
    kind: 'upgrade-plan-present',
    relatedId: 'ticket/basic',
    message: 'Upgrade plan applied, verify pending: ticket/basic 0.1.0 -> 0.1.1'
  });
  expectReviewRegressionRisk(reviewSummary, {
    kind: 'upgrade-impact',
    blockId: 'ticket/basic',
    message: 'Upgrade ticket/basic impacts src/installed/ticket/ticket-service.ts'
  });
  expectGraphEdge(graph, {
    from: 'block:ticket/basic',
    to: 'file:app/tickets/page.tsx',
    type: 'writes_to'
  });
}, 180000);

async function readCompletionProofEvidence(
  workspaceRoot: string,
  result: Awaited<ReturnType<typeof compileWorkspace>>
): Promise<PipelineCompletionProofEvidenceV1> {
  if (!result.semanticContext || !result.verificationReport || !result.explainGraph || !result.reviewSummary) {
    throw new Error('Expected a full Pipeline compilation result');
  }
  const paths = getWorkspacePaths(workspaceRoot);
  const localViewLocations = [
    [overviewViewRelativePath, paths.overviewViewPath],
    [sourceViewRelativePath, paths.sourceViewPath],
    [slotRuleViewRelativePath, paths.slotRuleViewPath],
    [graphViewRelativePath, paths.graphViewPath],
    [reviewViewRelativePath, paths.reviewViewPath]
  ] as const;
  return {
    transactionId: result.transactionId,
    completedStages: result.completedStages,
    semanticContext: result.semanticContext,
    lock: result.lock,
    verificationReport: result.verificationReport,
    provenance: await readJson<ProvenanceFile>(paths.provenancePath),
    explainGraph: result.explainGraph,
    reviewSummary: result.reviewSummary,
    localViews: await Promise.all(
      localViewLocations.map(async ([relativePath, absolutePath]) => ({
        relativePath,
        bytes: new Uint8Array(await readFile(absolutePath))
      }))
    )
  };
}

function stageEvidenceFrom(
  evidence: PipelineCompletionProofEvidenceV1
): PipelineCompletionProofStageEvidenceV1 {
  return {
    transactionId: evidence.transactionId,
    completedStages: evidence.completedStages,
    semanticContext: evidence.semanticContext,
    lock: evidence.lock,
    verificationReport: evidence.verificationReport,
    provenance: evidence.provenance,
    explainGraph: evidence.explainGraph,
    reviewSummary: evidence.reviewSummary
  };
}

function tamperArtifactBytes(bytes: Uint8Array, kind: 'json' | 'text'): Uint8Array {
  if (kind === 'text') {
    return Buffer.concat([Buffer.from(bytes), Buffer.from('\nproof-tamper\n', 'utf8')]);
  }
  const value = JSON.parse(Buffer.from(bytes).toString('utf8')) as Record<string, unknown>;
  return Buffer.from(formatJsonFile({ ...value, proofTamper: true }), 'utf8');
}

test('compile coordinator runs resolve and compose in one committed transaction', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await initWorkspace(workspaceRoot, { reset: true });
    const boundaries: string[] = [];

    const result = await compileWorkspace(workspaceRoot, {
      source: 'ci',
      through: 'compose',
      onEvent: (event) => {
        if (event.type === 'execution-boundary' && event.boundary) boundaries.push(event.boundary);
      }
    });

    expect(result.completedStages).toEqual(['resolve', 'semantic', 'compose']);
    expect(boundaries).toEqual([
      'pipeline-lease-bind',
      'pipeline-lease-bound',
      'pipeline-transaction-bootstrap',
      'pipeline-resolve',
      'pipeline-semantic',
      'pipeline-compose'
    ]);
    expect(result.semanticContext).toMatchObject({
      transactionId: result.transactionId,
      inputRevision: result.semanticContext?.snapshot.ir.inputRevision,
      semanticRevision: result.semanticContext?.snapshot.ir.semanticRevision
    });
    expect(result.lock.passStatus).toMatchObject({
      parse: 'succeeded',
      align: 'succeeded',
      resolve: 'succeeded',
      'build-ir': 'succeeded',
      compose: 'succeeded',
      adapt: 'pending',
      verify: 'pending',
      repair: 'skipped',
      lock: 'pending',
      emit: 'pending'
    });

    const journal = await readPipelineJournal(workspaceRoot);
    const transaction = journal.transactions.find((entry) => entry.id === result.transactionId);
    expect(journal.activeTransactionId).toBeUndefined();
    expect(journal.lastCommittedTransactionId).toBe(result.transactionId);
    expect(transaction).toMatchObject({
      source: 'ci',
      requestedStages: ['resolve', 'semantic', 'compose'],
      status: 'succeeded'
    });
    expect(transaction?.passRecords.map((entry) => [entry.passId, entry.status])).toEqual([
      ['resolve', 'succeeded'],
      ['build-ir', 'succeeded'],
      ['compose', 'succeeded']
    ]);
  }, 'engineering-compiler-pipeline-coordinator-');
}, 120000);

test('full Pipeline completion proof binds the exact registry closure and derivative evidence', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await initWorkspace(workspaceRoot, { reset: true });
    await addBlock(workspaceRoot, 'ticket/basic');

    const result = await compileWorkspace(workspaceRoot, {
      source: 'ci',
      from: 'resolve',
      through: 'emit',
      verificationLane: 'all'
    });
    const proof = result.completionProof;
    expect(proof).toBeDefined();
    if (!proof) throw new Error('Expected PipelineCompletionProofV1');

    const evidence = await readCompletionProofEvidence(workspaceRoot, result);
    const stageEvidence = stageEvidenceFrom(evidence);
    expect(() => assertPipelineCompletionProofInvariant(proof, evidence)).not.toThrow();
    expect(await buildPipelineCompletionProof(workspaceRoot, stageEvidence)).toEqual(proof);
    expect(proof.completedStages).toEqual(PIPELINE_STAGE_IDS);
    expect(proof.completedPasses).toEqual(
      PIPELINE_STAGE_IDS.flatMap((stage) => getPipelineStageDefinition(stage).ownedPasses)
    );
    for (const [index, localView] of evidence.localViews.entries()) {
      const rawByteDigest = `sha256:${createHash('sha256').update(localView.bytes).digest('hex')}`;
      expect(proof.localViewDigests[index]).toEqual({
        relativePath: localView.relativePath,
        digest: rawByteDigest
      });
    }

    const paths = getWorkspacePaths(workspaceRoot);
    const proofArtifacts = [
      { label: 'Lock', path: paths.lockPath, kind: 'json' },
      { label: 'Verification report', path: paths.verificationReportPath, kind: 'json' },
      { label: 'runtime report', path: paths.runtimeReportPath, kind: 'json' },
      { label: 'policy report', path: paths.policyReportPath, kind: 'json' },
      { label: 'acceptance coverage', path: paths.acceptanceCoveragePath, kind: 'json' },
      { label: 'Provenance', path: paths.provenancePath, kind: 'json' },
      { label: 'ExplainGraph JSON', path: paths.explainGraphPath, kind: 'json' },
      { label: 'ExplainGraph Mermaid', path: paths.explainGraphMermaidPath, kind: 'text' },
      { label: 'ExplainGraph DOT', path: paths.explainGraphDotPath, kind: 'text' },
      { label: 'ReviewSummary', path: paths.reviewSummaryPath, kind: 'json' },
      { label: 'Overview local view', path: paths.overviewViewPath, kind: 'text' },
      { label: 'Source local view', path: paths.sourceViewPath, kind: 'text' },
      { label: 'Slot/rule local view', path: paths.slotRuleViewPath, kind: 'text' },
      { label: 'Graph local view', path: paths.graphViewPath, kind: 'text' },
      { label: 'Review local view', path: paths.reviewViewPath, kind: 'text' }
    ] as const;

    for (const artifact of proofArtifacts) {
      const originalBytes = await readFile(artifact.path);
      await rm(artifact.path);
      try {
        await expect(buildPipelineCompletionProof(workspaceRoot, stageEvidence)).rejects.toThrow();
      } finally {
        await writeFile(artifact.path, originalBytes);
      }
    }

    for (const artifact of proofArtifacts) {
      const originalBytes = await readFile(artifact.path);
      await writeFile(artifact.path, tamperArtifactBytes(originalBytes, artifact.kind));
      try {
        await expect(buildPipelineCompletionProof(workspaceRoot, stageEvidence)).rejects.toThrow();
      } finally {
        await writeFile(artifact.path, originalBytes);
      }
    }

    const originalReviewBytes = await readFile(paths.reviewSummaryPath);
    const provenanceSummaryTamper = JSON.parse(originalReviewBytes.toString('utf8')) as ReviewSummary;
    if (!provenanceSummaryTamper.provenanceSummary) throw new Error('Expected Provenance ReviewSummary');
    const originalArtifactCount = provenanceSummaryTamper.provenanceSummary.artifactCount;
    provenanceSummaryTamper.provenanceSummary.verifiedArtifactCount += 1;
    expect(provenanceSummaryTamper.provenanceSummary.artifactCount).toBe(originalArtifactCount);
    await writeFile(paths.reviewSummaryPath, formatJsonFile(provenanceSummaryTamper), 'utf8');
    try {
      await expect(buildPipelineCompletionProof(workspaceRoot, stageEvidence)).rejects.toThrow('ReviewSummary');
    } finally {
      await writeFile(paths.reviewSummaryPath, originalReviewBytes);
    }

    expect(() => assertPipelineCompletionProofInvariant({ ...proof, unexpected: true })).toThrow('exact v1 schema');
    const { proofRevision: _omitted, ...missingProofRevision } = proof;
    expect(() => assertPipelineCompletionProofInvariant(missingProofRevision)).toThrow('exact v1 schema');
    expect(() =>
      assertPipelineCompletionProofInvariant({
        ...proof,
        completedStages: proof.completedStages.slice(0, -1)
      })
    ).toThrow('registry-owned stage closure');
    expect(() =>
      assertPipelineCompletionProofInvariant({
        ...proof,
        localViewDigests: proof.localViewDigests.map((view, index) =>
          index === 0 ? { ...view, unexpected: true } : view
        )
      })
    ).toThrow('exact v1 schema');

    expect(() =>
      createPipelineCompletionProof({
        ...evidence,
        transactionId: 'stale-transaction'
      })
    ).toThrow('semantic transaction');

    const staleSemantic = {
      ...structuredClone(evidence.semanticContext),
      semanticRevision: staleRevision
    };
    expect(() =>
      createPipelineCompletionProof({
        ...evidence,
        semanticContext: staleSemantic
      })
    ).toThrow('semantic transaction');

    const incompleteLock = structuredClone(evidence.lock);
    incompleteLock.passStatus.emit = 'pending';
    expect(() => createPipelineCompletionProof({ ...evidence, lock: incompleteLock })).toThrow(
      'registry-owned pass closure'
    );

    const failedVerification = structuredClone(evidence.verificationReport);
    failedVerification.summary.status = 'failed';
    expect(() =>
      createPipelineCompletionProof({
        ...evidence,
        verificationReport: failedVerification
      })
    ).toThrow('Verification report');

    const currentTask = evidence.semanticContext.generatorPlan.tasks[0];
    expect(currentTask).toBeDefined();
    if (!currentTask) throw new Error('Expected the ticket semantic Generator task');
    const staleProvenance = structuredClone(evidence.provenance);
    const currentArtifact = staleProvenance.artifacts.find((artifact) => artifact.path === currentTask.target);
    expect(currentArtifact).toBeDefined();
    if (!currentArtifact) throw new Error('Expected current semantic Provenance');
    currentArtifact.compilationTransactionId = 'historical-transaction';
    expect(() =>
      createPipelineCompletionProof({
        ...evidence,
        provenance: staleProvenance
      })
    ).toThrow('is not current');

    const staleGraph = structuredClone(evidence.explainGraph);
    staleGraph.semanticViews.semanticRevision = staleRevision;
    expect(() => createPipelineCompletionProof({ ...evidence, explainGraph: staleGraph })).toThrow('ExplainGraph');

    const staleReview = structuredClone(evidence.reviewSummary);
    if (!staleReview.semanticViewSummary) throw new Error('Expected semantic ReviewSummary');
    staleReview.semanticViewSummary.semanticRevision = staleRevision;
    expect(() =>
      createPipelineCompletionProof({
        ...evidence,
        reviewSummary: staleReview
      })
    ).toThrow('ReviewSummary');

    const tamperedLocalViewBytes = new Uint8Array(evidence.localViews[0]!.bytes.length + 1);
    tamperedLocalViewBytes.set(evidence.localViews[0]!.bytes);
    const staleLocalViews = evidence.localViews.map((view, index) =>
      index === 0
        ? {
            ...view,
            bytes: tamperedLocalViewBytes
          }
        : view
    );
    expect(() =>
      assertPipelineCompletionProofInvariant(proof, {
        ...evidence,
        localViews: staleLocalViews
      })
    ).toThrow('local-view byte bindings');

    const historicalArtifact: ProvenanceArtifact = {
      path: 'historical/semantic-output.ts',
      originType: 'generated',
      originId: 'historical-generator',
      generatedByPass: 'compose',
      generatorTaskId: 'historical-task',
      generatorEntityId: 'generator:historical',
      artifactEntityId: 'artifact:historical',
      semanticRevision: staleRevision,
      compilationTransactionId: 'historical-transaction',
      verifiedBy: [],
      overrideStatus: 'none'
    };
    const provenanceWithHistory = structuredClone(evidence.provenance);
    provenanceWithHistory.artifacts.push(historicalArtifact);
    const graphWithHistory = structuredClone(evidence.explainGraph);
    graphWithHistory.overlays.provenance.push(structuredClone(historicalArtifact));
    const reviewWithHistory = structuredClone(evidence.reviewSummary);
    if (!reviewWithHistory.provenanceSummary) throw new Error('Expected Provenance ReviewSummary');
    reviewWithHistory.provenanceSummary = buildProvenanceSummary(provenanceWithHistory);
    expect(() =>
      createPipelineCompletionProof({
        ...evidence,
        provenance: provenanceWithHistory,
        explainGraph: graphWithHistory,
        reviewSummary: reviewWithHistory
      })
    ).not.toThrow();
  }, 'engineering-compiler-pipeline-completion-proof-');
}, 240000);

test('compileWorkspace acquires the writer lease and accepts only the exact reentrant token', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await initWorkspace(workspaceRoot, { reset: true });
    const lease = await acquireWorkspaceWriteLease(workspaceRoot);

    await expect(compileWorkspace(workspaceRoot, { through: 'resolve' })).rejects.toMatchObject({
      code: 'WORKSPACE-WRITE-LEASE-001'
    });
    await expect(compileWorkspace(workspaceRoot, {
      through: 'resolve',
      workspaceWriteLease: { ...lease.token, leaseId: 'forged' }
    })).rejects.toMatchObject({
      code: 'WORKSPACE-WRITE-LEASE-002'
    });

    const result = await compileWorkspace(workspaceRoot, {
      through: 'resolve',
      workspaceWriteLease: lease.token
    });
    expect(result.completedStages).toEqual(['resolve']);
    await lease.assertOwned();
    await lease.release();

    const independent = await compileWorkspace(workspaceRoot, { through: 'resolve' });
    expect(independent.completedStages).toEqual(['resolve']);
  }, 'engineering-compiler-pipeline-workspace-lease-');
}, 120000);
