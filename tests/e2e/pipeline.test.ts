import { expect, test } from 'bun:test';
import { Buffer } from 'node:buffer';
import { readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { buildProvenanceSummary } from '../../src/adapters/compilation/emit/write-review-summary.ts';
import { readPipelineJournal } from '../../src/adapters/compilation/pipeline/journal.ts';
import { readJson } from "../../src/adapters/filesystem/files.ts";
import { acquireWorkspaceWriteLease } from '../../src/adapters/filesystem/write-lease.ts';
import { resolveWorkspaceArtifactPath } from "../../src/adapters/workspace-context.ts";
import { CI_ARTIFACT_FILES } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import type { ReviewSummary } from '../../src/assurance/verification/review/contract/types.ts';
import {
  addBlock,
  compileWorkspace,
  initWorkspace
} from '../../src/bootstrap/engineering/cli.ts';
import {
  assertPipelineCompletionProofInvariant,
  buildPipelineCompletionProof,
  createPipelineCompletionProof,
  type PipelineCompletionProofEvidence,
  type PipelineCompletionProofStageEvidence
} from '../../src/bootstrap/engineering/pipeline-orchestrator.ts';
import { getPipelineStageDefinition } from '../../src/compiler/pipeline/stage-definitions.ts';
import { PIPELINE_STAGE_IDS } from '../../src/compiler/pipeline/stages.ts';
import { formatJsonFile } from "../../src/contracts/json-text.ts";
import type { ProvenanceArtifact, ProvenanceFile } from '../../src/semantics/provenance/types.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

const staleRevision = `sha256:${'0'.repeat(64)}`;

async function readCompletionProofEvidence(
  workspaceRoot: string,
  result: Awaited<ReturnType<typeof compileWorkspace>>
): Promise<PipelineCompletionProofEvidence> {
  if (!result.semanticContext || !result.verificationReport || !result.explainGraph || !result.reviewSummary) {
    throw new Error('Expected a full Pipeline compilation result');
  }
  const provenancePath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.provenance);
  return {
    transactionId: result.transactionId,
    completedStages: result.completedStages,
    semanticContext: result.semanticContext,
    lock: result.lock,
    verificationReport: result.verificationReport,
    provenance: await readJson<ProvenanceFile>(provenancePath),
    explainGraph: result.explainGraph,
    reviewSummary: result.reviewSummary
  };
}

function stageEvidenceFrom(
  evidence: PipelineCompletionProofEvidence
): PipelineCompletionProofStageEvidence {
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
    await initWorkspace(workspaceRoot);
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
    await initWorkspace(workspaceRoot);
    await addBlock(workspaceRoot, 'ticket/basic');

    const result = await compileWorkspace(workspaceRoot, {
      source: 'ci',
      from: 'resolve',
      through: 'emit',
      verificationLane: 'all'
    });
    const proof = result.completionProof;
    expect(proof).toBeDefined();
    if (!proof) throw new Error('Expected PipelineCompletionProof');

    const evidence = await readCompletionProofEvidence(workspaceRoot, result);
    const stageEvidence = stageEvidenceFrom(evidence);
    expect(() => assertPipelineCompletionProofInvariant(proof, evidence)).not.toThrow();
    expect(await buildPipelineCompletionProof(workspaceRoot, stageEvidence)).toEqual(proof);
    expect(proof.completedStages).toEqual(PIPELINE_STAGE_IDS);
    expect(proof.completedPasses).toEqual(
      PIPELINE_STAGE_IDS.flatMap((stage) => getPipelineStageDefinition(stage).ownedPasses)
    );
    const paths = {
      lockPath: resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock),
      verificationReportPath: resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.verificationReport),
      runtimeReportPath: resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.runtimeReport),
      policyReportPath: resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.policyReport),
      acceptanceCoveragePath: resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.acceptanceCoverage),
      provenancePath: resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.provenance),
      explainGraphPath: resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.explainGraph),
      explainGraphMermaidPath: resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.explainGraphMermaid),
      explainGraphDotPath: resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.explainGraphDot),
      reviewSummaryPath: resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.reviewSummary)
    };
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
      { label: 'ReviewSummary', path: paths.reviewSummaryPath, kind: 'json' }
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

    if (process.platform !== 'win32') {
      const originalBytes = await readFile(paths.policyReportPath);
      const aliasTarget = path.join(workspaceRoot, 'same-policy-report.json');
      await writeFile(aliasTarget, originalBytes);
      await rm(paths.policyReportPath);
      await symlink(aliasTarget, paths.policyReportPath, 'file');
      try {
        await expect(buildPipelineCompletionProof(workspaceRoot, stageEvidence)).rejects.toThrow();
      } finally {
        await rm(paths.policyReportPath, { force: true });
        await writeFile(paths.policyReportPath, originalBytes);
        await rm(aliasTarget, { force: true });
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

    expect(() => assertPipelineCompletionProofInvariant({ ...proof, unexpected: true })).toThrow('exact schema');
    const { proofRevision: _omitted, ...missingProofRevision } = proof;
    expect(() => assertPipelineCompletionProofInvariant(missingProofRevision)).toThrow('exact schema');
    expect(() =>
      assertPipelineCompletionProofInvariant({
        ...proof,
        completedStages: proof.completedStages.slice(0, -1)
      })
    ).toThrow('registry-owned stage closure');
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
    await initWorkspace(workspaceRoot);
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
