import { expect, test } from 'bun:test';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';

import { buildProvenanceSummary } from '../../platform/compiler/emit/write-review-summary.ts';
import {
  addBlock,
  compileWorkspace,
  composeWorkspace,
  initWorkspace
} from '../../platform/orchestrator.ts';
import {
  assertIsolatedVerificationCapability,
  mintIsolatedVerificationCapability
} from '../../platform/orchestrator/isolated-verification-capability.ts';
import {
  assertPipelineCompletionProofInvariant,
  buildPipelineCompletionProof,
  createPipelineCompletionProof,
  type PipelineCompletionProofEvidenceV1,
  type PipelineCompletionProofStageEvidenceV1
} from '../../platform/orchestrator/pipeline-orchestrator.ts';
import { formatJsonFile, readJson } from '../../platform/shared/fs.ts';
import { readLockFile } from '../../platform/shared/lock-utils.ts';
import {
  getWorkspacePaths,
  graphViewRelativePath,
  overviewViewRelativePath,
  reviewViewRelativePath,
  slotRuleViewRelativePath,
  sourceViewRelativePath
} from '../../platform/shared/paths.ts';
import {
  commitPipelineTransaction,
  readPipelineJournal,
  recordPipelinePassStart,
  REFERENCE_PIPELINE_TRANSACTION_ID,
  startPipelineTransaction
} from '../../platform/shared/pipeline-journal.ts';
import { getPipelineStageDefinition } from '../../platform/shared/pipeline-pass-registry.ts';
import { PIPELINE_STAGE_IDS } from '../../platform/shared/pipeline-types.ts';
import type { ProvenanceArtifact, ProvenanceFile } from '../../platform/shared/provenance-types.ts';
import type { ReviewSummary } from '../../platform/shared/review-types.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

const staleRevision = `sha256:${'0'.repeat(64)}`;

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

test('isolated Verification capability is opaque and bound to one exact workspace root', () => {
  const workspaceRoot = 'D:\\contract-workspaces\\isolated-a';
  const capability = mintIsolatedVerificationCapability(workspaceRoot);

  expect(() => assertIsolatedVerificationCapability(workspaceRoot, capability)).not.toThrow();
  expect(() => assertIsolatedVerificationCapability('D:\\contract-workspaces\\isolated-b', capability))
    .toThrow('exact workspace root');
  for (const forged of [
    {},
    { ...capability },
    { workspaceRoot }
  ]) {
    expect(() => assertIsolatedVerificationCapability(workspaceRoot, forged))
      .toThrow('exact workspace root');
  }
});

test('compile coordinator runs resolve and compose in one committed transaction', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await initWorkspace(workspaceRoot, { reset: true });

    const result = await compileWorkspace(workspaceRoot, {
      source: 'ci',
      through: 'compose'
    });

    expect(result.completedStages).toEqual(['resolve', 'semantic', 'compose']);
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

test('blocked stage is persisted as blocked instead of a pass execution failure', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await initWorkspace(workspaceRoot, { reset: true });

    await expect(composeWorkspace(workspaceRoot)).rejects.toMatchObject({
      code: 'PIPELINE-BLOCKED-002'
    });

    const lock = await readLockFile(workspaceRoot);
    expect(lock.passStatus).toMatchObject({
      resolve: 'pending',
      compose: 'blocked',
      adapt: 'blocked',
      verify: 'blocked',
      repair: 'blocked',
      lock: 'blocked',
      emit: 'blocked'
    });

    const journal = await readPipelineJournal(workspaceRoot);
    const transaction = journal.transactions.at(-1);
    expect(transaction?.status).toBe('failed');
    expect(transaction?.passRecords).toEqual([
      expect.objectContaining({
        passId: 'build-ir',
        status: 'blocked',
        errorCode: 'PIPELINE-BLOCKED-002'
      })
    ]);
  }, 'engineering-compiler-pipeline-blocked-');
});

test('new transaction marks an abandoned running transaction as interrupted', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const commitFence = async (): Promise<void> => undefined;
    const firstTransactionId = await startPipelineTransaction(workspaceRoot, 'api', ['resolve'], commitFence);
    await recordPipelinePassStart(workspaceRoot, firstTransactionId, 'resolve', commitFence);

    const secondTransactionId = await startPipelineTransaction(workspaceRoot, 'ci', ['resolve'], commitFence);
    let journal = await readPipelineJournal(workspaceRoot);
    const interrupted = journal.transactions.find((entry) => entry.id === firstTransactionId);

    expect(interrupted).toMatchObject({
      status: 'failed',
      errorCode: 'PIPELINE-INTERRUPTED-001'
    });
    expect(interrupted?.passRecords[0]).toMatchObject({
      passId: 'resolve',
      status: 'failed',
      errorCode: 'PIPELINE-INTERRUPTED-001'
    });
    expect(journal.activeTransactionId).toBe(secondTransactionId);

    await commitPipelineTransaction(workspaceRoot, secondTransactionId, commitFence);
    journal = await readPipelineJournal(workspaceRoot);
    expect(journal.activeTransactionId).toBeUndefined();
    expect(journal.lastCommittedTransactionId).toBe(secondTransactionId);
  }, 'engineering-compiler-pipeline-interruption-');
});

test('reference transaction identity is stable and names the current journal execution', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const commitFence = async (): Promise<void> => undefined;
    const firstTransactionId = await startPipelineTransaction(workspaceRoot, 'reference', ['resolve'], commitFence);
    await commitPipelineTransaction(workspaceRoot, firstTransactionId, commitFence);

    const secondTransactionId = await startPipelineTransaction(workspaceRoot, 'reference', ['resolve'], commitFence);
    let journal = await readPipelineJournal(workspaceRoot);

    expect(firstTransactionId).toBe(REFERENCE_PIPELINE_TRANSACTION_ID);
    expect(secondTransactionId).toBe(firstTransactionId);
    expect(journal.activeTransactionId).toBe(secondTransactionId);
    expect(journal.lastCommittedTransactionId).toBeUndefined();
    expect(journal.transactions.filter((entry) => entry.id === secondTransactionId)).toEqual([
      expect.objectContaining({
        source: 'reference',
        requestedStages: ['resolve'],
        status: 'running'
      })
    ]);

    await commitPipelineTransaction(workspaceRoot, secondTransactionId, commitFence);
    journal = await readPipelineJournal(workspaceRoot);
    expect(journal.activeTransactionId).toBeUndefined();
    expect(journal.lastCommittedTransactionId).toBe(secondTransactionId);
    expect(journal.transactions.filter((entry) => entry.id === secondTransactionId)).toHaveLength(1);
    expect(journal.transactions.find((entry) => entry.id === secondTransactionId)?.status).toBe('succeeded');
  }, 'engineering-compiler-reference-transaction-');
});

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
