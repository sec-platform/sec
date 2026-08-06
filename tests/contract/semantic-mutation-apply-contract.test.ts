import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from 'bun:test';
import ts from 'typescript';

import {
  executeSemanticMutationVerification,
  planSemanticMutationVerificationCapabilities
} from '../../platform/compiler/index.ts';
import { buildSemanticMutationVerificationExecutionRef } from '../../platform/compiler/semantic-mutation/semantic-mutation-result.ts';
import { semanticMutationTransactionRoot } from '../../platform/compiler/semantic-mutation/transaction-identity.ts';
import {
  semanticMutationIsolatedVerificationEvidenceDigest,
  type SemanticMutationIsolatedVerificationEvidence
} from '../../platform/compiler/verify/semantic-mutation-isolated-verification-evidence.ts';
import { isSemanticMutationStagingWorkspace } from '../../platform/compiler/verify/semantic-mutation-staging-boundary.ts';
import { assertSemanticMutationVerificationReportInvariant } from '../../platform/compiler/verify/semantic-mutation-verification-adapter.ts';
import { applySemanticMutation } from '../../platform/orchestrator.ts';
import type { IsolatedVerificationCapability } from '../../platform/orchestrator/isolated-verification-capability.ts';
import { sha256 } from '../../platform/shared/canonical-primitives.ts';
import {
  PIPELINE_COMPLETION_PROOF_REVISION,
  PIPELINE_STAGE_IDS,
  type PipelineExecutionContext
} from '../../platform/shared/pipeline-types.ts';
import {
  SEMANTIC_MUTATION_RECOVERY_RECORD_REVISION,
  SEMANTIC_MUTATION_RECOVERY_TRANSITIONS,
  SEMANTIC_MUTATION_REJECTED_TERMINAL_RECORD_REVISION,
  SEMANTIC_MUTATION_REQUEST_RECORD_VIEW_REVISION,
  SEMANTIC_MUTATION_STAGED_TRANSACTION_REVISION,
  SEMANTIC_MUTATION_TERMINAL_RETENTION,
  type SemanticMutationApplyOutcomeV1,
  type SemanticMutationRequestRecordViewV1
} from '../../platform/shared/semantic-mutation-transaction-types.ts';
import {
  SEMANTIC_MUTATION_ROLLBACK_MANIFEST_REVISION
} from '../../platform/shared/semantic-mutation-types.ts';
import {
  SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_ID,
  SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_REVISION,
  SEMANTIC_MUTATION_VERIFICATION_CAPABILITY_PLAN_REVISION,
  SEMANTIC_MUTATION_VERIFICATION_REPORT_REVISION
} from '../../platform/shared/verification-types.ts';
import { WORKSPACE_WRITE_LEASE_TOKEN_VERSION } from '../../platform/shared/workspace-write-lease.ts';

function legacyPassedIsolatedVerificationEvidenceDigest(
  evidence: Extract<SemanticMutationIsolatedVerificationEvidence, { readonly status: 'passed' }>
): string {
  const snapshot = evidence.artifacts.semanticBundle.snapshot.ir;
  const generatedReport = evidence.artifacts.verificationReport;
  return sha256({
    domain: ['semantic-mutation-isolated-verification', 'evidence-v1'].join('-'),
    completedStages: ['resolve', 'semantic', 'compose', 'adapt', 'verify'],
    inputRevision: snapshot.inputRevision,
    semanticRevision: snapshot.semanticRevision,
    generatedArtifactRawDigests: evidence.artifacts.rawDigests,
    report: {
      summary: generatedReport.summary,
      build: generatedReport.build,
      unit: generatedReport.unit,
      acceptance: generatedReport.acceptance,
      policy: generatedReport.policy,
      runtime: {
        status: generatedReport.runtime.status,
        build: generatedReport.runtime.build,
        unit: generatedReport.runtime.unit,
        acceptance: generatedReport.runtime.acceptance
      }
    }
  });
}

test('semantic mutation staging layout is exactly the canonical transaction workspace', () => {
  const workspaceRoot = path.resolve('contract-workspace');
  const digest = sha256('canonical-transaction-layout');
  const transactionRoot = semanticMutationTransactionRoot(workspaceRoot, digest);
  const transactionName = digest.slice('sha256:'.length);
  expect(transactionRoot).toBe(path.join(
    workspaceRoot,
    '.sec',
    'semantic-mutation',
    'v1',
    'transactions',
    transactionName
  ));
  expect(isSemanticMutationStagingWorkspace(path.join(transactionRoot, 'workspace'))).toBe(true);
  expect(isSemanticMutationStagingWorkspace(path.join(workspaceRoot, '.sec', 's', transactionName))).toBe(false);
  expect(isSemanticMutationStagingWorkspace(path.join(transactionRoot, 'staging'))).toBe(false);
  expect(isSemanticMutationStagingWorkspace(path.join(
    workspaceRoot,
    '.sec',
    'semantic-mutation',
    'v1',
    'transactions',
    'not-a-digest',
    'workspace'
  ))).toBe(false);
});

function propertyName(member: ts.TypeElement): string | null {
  if (!ts.isPropertySignature(member) || member.name === undefined) return null;
  return member.name.getText().replace(/^['"]|['"]$/gu, '');
}

function interfaceKeys(source: string, interfaceName: string): string[] {
  const file = ts.createSourceFile('contract.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = file.statements.find((statement): statement is ts.InterfaceDeclaration =>
    ts.isInterfaceDeclaration(statement) && statement.name.text === interfaceName);
  if (!declaration) throw new Error(`Missing interface ${interfaceName}`);
  return declaration.members.map(propertyName).filter((name): name is string => name !== null);
}

function typeLiteralKeys(source: string, aliasName: string): string[][] {
  const file = ts.createSourceFile('contract.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = file.statements.find((statement): statement is ts.TypeAliasDeclaration =>
    ts.isTypeAliasDeclaration(statement) && statement.name.text === aliasName);
  if (!declaration) throw new Error(`Missing type alias ${aliasName}`);
  const results: string[][] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isTypeLiteralNode(node)) {
      results.push(node.members.map(propertyName).filter((name): name is string => name !== null));
      return;
    }
    node.forEachChild(visit);
  };
  visit(declaration.type);
  return results;
}

function typeStringLiteralValues(source: string, aliasName: string): string[] {
  const file = ts.createSourceFile('contract.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = file.statements.find((statement): statement is ts.TypeAliasDeclaration =>
    ts.isTypeAliasDeclaration(statement) && statement.name.text === aliasName);
  if (!declaration) throw new Error(`Missing type alias ${aliasName}`);
  const members = ts.isUnionTypeNode(declaration.type)
    ? declaration.type.types
    : [declaration.type];
  return members.map((member) => {
    if (!ts.isLiteralTypeNode(member) || !ts.isStringLiteral(member.literal)) {
      throw new Error(`Type alias ${aliasName} contains a non-string-literal member`);
    }
    return member.literal.text;
  });
}

function classPublicReadonlyKeys(source: string, className: string): string[] {
  const file = ts.createSourceFile('contract.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = file.statements.find((statement): statement is ts.ClassDeclaration =>
    ts.isClassDeclaration(statement) && statement.name?.text === className);
  if (!declaration) throw new Error(`Missing class ${className}`);
  const hasModifier = (
    node: ts.PropertyDeclaration | ts.ParameterDeclaration,
    kind: ts.SyntaxKind
  ): boolean => ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false;
  const publicReadonlyName = (
    node: ts.PropertyDeclaration | ts.ParameterDeclaration
  ): string | null => {
    if (!hasModifier(node, ts.SyntaxKind.PublicKeyword) ||
      !hasModifier(node, ts.SyntaxKind.ReadonlyKeyword) || node.name === undefined) return null;
    return node.name.getText().replace(/^['"]|['"]$/gu, '');
  };
  return declaration.members.flatMap((member) => {
    if (ts.isPropertyDeclaration(member)) {
      const name = publicReadonlyName(member);
      return name === null ? [] : [name];
    }
    if (!ts.isConstructorDeclaration(member)) return [];
    return member.parameters.flatMap((parameter) => {
      const name = publicReadonlyName(parameter);
      return name === null ? [] : [name];
    });
  });
}

test('SM-3 freezes lease, journal, query, rollback, Pipeline proof, and Verification revisions', () => {
  expect({
    lease: WORKSPACE_WRITE_LEASE_TOKEN_VERSION,
    recovery: SEMANTIC_MUTATION_RECOVERY_RECORD_REVISION,
    rejectedTerminal: SEMANTIC_MUTATION_REJECTED_TERMINAL_RECORD_REVISION,
    requestView: SEMANTIC_MUTATION_REQUEST_RECORD_VIEW_REVISION,
    stagedTransaction: SEMANTIC_MUTATION_STAGED_TRANSACTION_REVISION,
    rollbackManifest: SEMANTIC_MUTATION_ROLLBACK_MANIFEST_REVISION,
    pipelineCompletionProof: PIPELINE_COMPLETION_PROOF_REVISION,
    terminalRetention: SEMANTIC_MUTATION_TERMINAL_RETENTION,
    verificationAdapterId: SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_ID,
    verificationAdapterRevision: SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_REVISION,
    capabilityPlanRevision: SEMANTIC_MUTATION_VERIFICATION_CAPABILITY_PLAN_REVISION,
    verificationReportRevision: SEMANTIC_MUTATION_VERIFICATION_REPORT_REVISION
  }).toEqual({
    lease: 'workspace-write-lease-token-v2',
    recovery: 'semantic-mutation-recovery-record-v1',
    rejectedTerminal: 'semantic-mutation-rejected-terminal-record-v1',
    requestView: 'semantic-mutation-request-record-view-v1',
    stagedTransaction: 'semantic-mutation-staged-transaction-v1',
    rollbackManifest: 'semantic-mutation-rollback-manifest-v2',
    pipelineCompletionProof: 'pipeline-completion-proof-v1',
    terminalRetention: 256,
    verificationAdapterId: 'semantic-mutation-local-verification',
    verificationAdapterRevision: 'semantic-mutation-local-verification-v2',
    capabilityPlanRevision: 'semantic-mutation-verification-capability-plan-v1',
    verificationReportRevision: 'semantic-mutation-verification-report-v1'
  });
  expect(PIPELINE_STAGE_IDS).toEqual([
    'resolve', 'semantic', 'compose', 'adapt', 'verify', 'lock', 'emit'
  ]);
  expect(SEMANTIC_MUTATION_RECOVERY_TRANSITIONS).toEqual({
    prepared: ['authoring-committed', 'recovery-required'],
    'authoring-committed': ['verified', 'rolled-back', 'recovery-required'],
    verified: [],
    'rolled-back': [],
    'recovery-required': []
  });
  expect(Object.values(SEMANTIC_MUTATION_RECOVERY_TRANSITIONS)
    .every((states) => Object.isFrozen(states))).toBe(true);
  const preparedTransitions: readonly ('authoring-committed' | 'recovery-required')[] =
    SEMANTIC_MUTATION_RECOVERY_TRANSITIONS.prepared;
  const committedTransitions: readonly ('verified' | 'rolled-back' | 'recovery-required')[] =
    SEMANTIC_MUTATION_RECOVERY_TRANSITIONS['authoring-committed'];
  expect(preparedTransitions).toHaveLength(2);
  expect(committedTransitions).toHaveLength(3);
});

test('ordinary malformed requests return the exact redacted request-rejected outcome before lease acquisition', async () => {
  const outcome = await applySemanticMutation('Z:\\must-not-be-observed', {
    request: { contractVersion: '1', requestId: 'request:malformed' }
  } as never);
  expect(Object.keys(outcome)).toEqual([
    'status', 'requestId', 'requestRevision', 'diagnostics', 'diagnosticRevision'
  ]);
  expect(outcome).toMatchObject({
    status: 'request-rejected',
    requestId: 'request:malformed',
    requestRevision: ''
  });
  if (outcome.status !== 'request-rejected') throw new Error(JSON.stringify(outcome));
  expect(outcome.diagnostics).toHaveLength(1);
  expect(JSON.stringify(outcome)).not.toContain('Z:\\must-not-be-observed');
  expect(outcome.diagnosticRevision).toBe(sha256({
    domain: 'semantic-mutation-diagnostic-v2',
    diagnostics: outcome.diagnostics
  }));
});

test('Verification adapter emits the exact frozen report and execution binding, and forged unions never run', async () => {
  const inputRevision = sha256('input');
  const semanticRevision = sha256('semantic');
  const snapshot = {
    ir: { inputRevision, semanticRevision, entities: [], facts: [] }
  } as never;
  const requirements = [{ kind: 'pass' as const, passId: 'verify' }];
  const isolationCapabilityProbe = () => ({ status: 'available' });
  const capabilityPlan = await planSemanticMutationVerificationCapabilities({
    snapshot,
    requirements,
    isolationCapabilityProbe
  });
  const attempted = { transactionId: 'tx:staged', inputRevision, semanticRevision };
  const planRevision = sha256('plan');
  const stagedSourceDigest = sha256('staged-source');
  const requiredVerificationDigest = sha256({
    domain: 'semantic-mutation-required-verification-v1',
    requirements
  });
  let calls = 0;
  const runner = (runnerInput: unknown) => {
    calls += 1;
    expect(Object.isFrozen(runnerInput)).toBe(true);
    expect(Object.keys(runnerInput as object)).toEqual([
      'runner', 'planRevision', 'attempted', 'stagedSourceDigest',
      'requiredVerificationDigest', 'requirements'
    ]);
    return { status: 'passed' as const, evidenceDigest: sha256('verify-all') };
  };
  const report = await executeSemanticMutationVerification({
    capabilityPlan,
    requirements,
    planRevision,
    attempted,
    stagedSourceDigest,
    requiredVerificationDigest
  }, runner);
  expect(calls).toBe(1);
  expect(Object.keys(report)).toEqual([
    'formatRevision', 'adapterId', 'adapterRevision', 'planRevision', 'attempted',
    'stagedSourceDigest', 'requiredVerificationDigest', 'executions', 'status', 'reportRevision'
  ]);
  expect(Object.keys(report.executions[0]!)).toEqual([
    'requirement', 'runner', 'status', 'evidenceDigest'
  ]);
  const { reportRevision, ...withoutReportRevision } = report;
  expect(reportRevision).toBe(sha256({
    domain: 'semantic-mutation-verification-report-v1',
    ...withoutReportRevision
  }));
  expect(() => assertSemanticMutationVerificationReportInvariant(report)).not.toThrow();

  const execution = buildSemanticMutationVerificationExecutionRef(report);
  expect(Object.keys(execution)).toEqual([
    'adapterId', 'adapterRevision', 'reportRevision', 'planRevision', 'attempted',
    'stagedSourceDigest', 'requiredVerificationDigest', 'status', 'verificationExecutionRevision'
  ]);
  expect(() => buildSemanticMutationVerificationExecutionRef({
    ...report,
    reportRevision: sha256('forged-report-revision')
  })).toThrow('revision is stale or forged');
  expect(() => buildSemanticMutationVerificationExecutionRef({
    ...report,
    forgedExtra: true
  } as never)).toThrow('non-canonical schema');

  await expect(executeSemanticMutationVerification({
    capabilityPlan,
    requirements,
    planRevision,
    attempted,
    stagedSourceDigest,
    requiredVerificationDigest: sha256('forged-union')
  }, runner)).rejects.toThrow('invalid or blocked');
  expect(calls).toBe(1);

  await expect(executeSemanticMutationVerification({
    capabilityPlan,
    requirements,
    planRevision,
    attempted: { ...attempted, transactionId: '' },
    stagedSourceDigest,
    requiredVerificationDigest
  }, runner)).rejects.toThrow('invalid or blocked');
  const nonShaEndpointPlan = structuredClone(capabilityPlan) as unknown as Record<string, unknown>;
  nonShaEndpointPlan.snapshotInputRevision = 'not-a-sha256-revision';
  delete nonShaEndpointPlan.capabilityPlanRevision;
  nonShaEndpointPlan.capabilityPlanRevision = sha256({
    domain: 'semantic-mutation-verification-capability-plan-v1',
    ...nonShaEndpointPlan
  });
  await expect(executeSemanticMutationVerification({
    capabilityPlan: nonShaEndpointPlan as never,
    requirements,
    planRevision,
    attempted: { ...attempted, inputRevision: 'not-a-sha256-revision' },
    stagedSourceDigest,
    requiredVerificationDigest
  }, runner)).rejects.toThrow('invalid or blocked');
  await expect(executeSemanticMutationVerification({
    capabilityPlan,
    requirements: [{ ...requirements[0]!, forgedExtra: true }] as never,
    planRevision,
    attempted,
    stagedSourceDigest,
    requiredVerificationDigest
  }, runner)).rejects.toThrow('invalid or blocked');
  expect(calls).toBe(1);

  const forgedCapabilityPlan = structuredClone(capabilityPlan) as unknown as Record<string, unknown>;
  const forgedCapabilities = forgedCapabilityPlan.capabilities as Array<Record<string, unknown>>;
  forgedCapabilities[0] = { ...forgedCapabilities[0], isolated: false };
  delete forgedCapabilityPlan.capabilityPlanRevision;
  forgedCapabilityPlan.capabilityPlanRevision = sha256({
    domain: 'semantic-mutation-verification-capability-plan-v1',
    ...forgedCapabilityPlan
  });
  await expect(executeSemanticMutationVerification({
    capabilityPlan: forgedCapabilityPlan as never,
    requirements,
    planRevision,
    attempted,
    stagedSourceDigest,
    requiredVerificationDigest
  }, runner)).rejects.toThrow('invalid or blocked');
  expect(calls).toBe(1);

  const externalEffectPlan = await planSemanticMutationVerificationCapabilities({
    snapshot: {
      ir: {
        inputRevision,
        semanticRevision,
        entities: [{
          id: 'effect:external',
          kind: 'effect',
          label: 'External call',
          attributes: [{ key: 'effectKind', value: 'external-service-call' }]
        }],
        facts: []
      }
    } as never,
    requirements,
    isolationCapabilityProbe
  });
  expect(externalEffectPlan.status).toBe('blocked');
  expect(externalEffectPlan.capabilities[0]).toMatchObject({
    status: 'non-runnable',
    isolated: false
  });
});

test('storage, query-view, Verification, and Pipeline proof interfaces retain exact property sets', async () => {
  const transactionTypes = await readFile(path.resolve(
    import.meta.dir,
    '../../platform/shared/semantic-mutation-transaction-types.ts'
  ), 'utf8');
  const verificationTypes = await readFile(path.resolve(
    import.meta.dir,
    '../../platform/shared/verification-types.ts'
  ), 'utf8');
  const mutationTypes = await readFile(path.resolve(
    import.meta.dir,
    '../../platform/shared/semantic-mutation-types.ts'
  ), 'utf8');
  const pipelineTypes = await readFile(path.resolve(
    import.meta.dir,
    '../../platform/shared/pipeline-types.ts'
  ), 'utf8');
  const stagedProofTypes = await readFile(path.resolve(
    import.meta.dir,
    '../../platform/compiler/verify/staged-verification-proof.ts'
  ), 'utf8');

  expect(interfaceKeys(transactionTypes, 'SemanticMutationRecoveryRecordBaseV1')).toEqual([
    'formatRevision', 'sequence', 'previousRecordRevision', 'transactionId',
    'requestIdentityDigest', 'requestRevision', 'authorizationRevision',
    'expectedPlanRevision', 'planRevision', 'editPlanRevision', 'rollbackManifestDigest',
    'relativePath', 'beforeByteDigest', 'committedByteDigest', 'base', 'staged',
    'verificationExecutionRevision', 'verificationReportRevision', 'request', 'authorization',
    'plan', 'verification', 'result', 'recoveryState', 'diagnostics', 'recordRevision'
  ]);
  expect(interfaceKeys(transactionTypes, 'SemanticMutationRejectedTerminalRecordV1')).toEqual([
    'formatRevision', 'requestIdentityDigest', 'requestRevision', 'planRevision',
    'terminalSequence', 'result', 'recordRevision'
  ]);
  expect(typeLiteralKeys(transactionTypes, 'SemanticMutationRecoveryRecordV1')).toEqual([
    ['state', 'terminalSequence'],
    ['state', 'terminalSequence']
  ]);
  expect(interfaceKeys(mutationTypes, 'SemanticMutationRollbackManifestV2')).toEqual([
    'formatRevision', 'ownerId', 'adapterId', 'adapterRevision', 'relativePath',
    'beforeByteDigest', 'stagedByteDigest', 'beforeByteLength', 'stagedByteLength',
    'fileMode', 'windowsFileAttributes', 'encoding', 'utf8Bom', 'lineEnding',
    'finalNewline', 'pathEvidenceRevision', 'rollbackManifestDigest'
  ]);
  expect(interfaceKeys(transactionTypes, 'SemanticMutationRequestTransactionRecordViewBaseV1')).toEqual([
    'formatRevision', 'recordKind', 'identity', 'requestIdentityDigest',
    'transactionId', 'requestRevision', 'authorizationRevision', 'expectedPlanRevision',
    'planRevision', 'editPlanRevision', 'rollbackManifestDigest', 'base', 'staged',
    'verificationExecutionRevision', 'verificationReportRevision', 'diagnostics',
    'recordRevision'
  ]);
  expect(typeLiteralKeys(transactionTypes, 'SemanticMutationRequestTransactionRecordViewV1')).toEqual([
    ['state', 'terminalSequence', 'result', 'recoveryState'],
    ['state', 'terminalSequence', 'result', 'recoveryState'],
    ['state', 'terminalSequence', 'result', 'recoveryState'],
    ['state', 'terminalSequence', 'result', 'recoveryState']
  ]);
  expect(typeLiteralKeys(transactionTypes, 'SemanticMutationRequestRecordViewV1')).toEqual([
    [
      'formatRevision', 'recordKind', 'identity', 'requestIdentityDigest', 'state',
      'requestRevision', 'planRevision', 'terminalSequence', 'result', 'diagnostics',
      'recordRevision'
    ]
  ]);
  expect(typeLiteralKeys(transactionTypes, 'SemanticMutationApplyOutcomeV1')).toEqual([
    ['status', 'result'],
    ['status', 'requestId', 'requestRevision', 'diagnostics', 'diagnosticRevision']
  ]);
  expect(typeLiteralKeys(transactionTypes, 'SemanticMutationRecoveryOutcomeV1')).toEqual([
    ['status'],
    ['status', 'result'],
    ['status', 'record']
  ]);
  expect(interfaceKeys(verificationTypes, 'SemanticMutationVerificationReportV1')).toEqual([
    'formatRevision', 'adapterId', 'adapterRevision', 'planRevision', 'attempted',
    'stagedSourceDigest', 'requiredVerificationDigest', 'executions', 'status', 'reportRevision'
  ]);
  expect(interfaceKeys(pipelineTypes, 'PipelineCompletionProofV1')).toEqual([
    'formatRevision', 'transactionId', 'inputRevision', 'semanticRevision',
    'completedStages', 'completedPasses', 'verificationDigest', 'provenanceDigest',
    'explainGraphDigest', 'reviewSummaryDigest', 'localViewDigests', 'proofRevision'
  ]);
  expect(interfaceKeys(stagedProofTypes, 'StagedVerificationProofSource')).toEqual([
    'formatRevision'
  ]);
  expect(interfaceKeys(stagedProofTypes, 'StagedVerificationProofBinding')).toEqual([
    'inputRevision', 'semanticRevision', 'planRevision', 'stagedSourceDigest',
    'requiredVerificationDigest', 'verificationExecutionRevision', 'verificationReportDigest'
  ]);
  expect(interfaceKeys(stagedProofTypes, 'StagedVerificationProof')).toEqual([
    'formatRevision', 'projectInputDigest', 'verificationArtifactDigest',
    'rawArtifactSetDigest', 'artifactSetDigest'
  ]);
});

test('writer authority, immutable journal, atomic publish/rollback CAS, and public redaction stay closed', async () => {
  const paths = {
    atomicPublish: 'platform/compiler/semantic-mutation/atomic-source-publish.ts',
    recovery: 'platform/compiler/semantic-mutation/mutation-recovery-record.ts',
    isolatedChild: 'platform/compiler/verify/run-semantic-mutation-isolated-child.ts',
    isolatedEvidence: 'platform/compiler/verify/semantic-mutation-isolated-verification-evidence.ts',
    isolatedFailure: 'platform/compiler/verify/semantic-mutation-isolated-verification-failure.ts',
    stagedProof: 'platform/compiler/verify/staged-verification-proof.ts',
    verifyProject: 'platform/compiler/verify/verify-project.ts',
    verifyFacade: 'platform/orchestrator/verify-orchestrator.ts',
    pipeline: 'platform/orchestrator/pipeline-orchestrator.ts',
    isolatedRunner: 'platform/orchestrator/semantic-mutation-isolated-verification-runner.ts',
    mutationOrchestrator: 'platform/orchestrator/semantic-mutation-orchestrator.ts',
    productionSentinel: 'tests/integration/semantic-mutation-production-sentinel.test.ts',
    runtimeVerification: 'platform/compiler/verify/run-runtime-verification.ts'
  } as const;
  const entries = await Promise.all(Object.entries(paths).map(async ([key, file]) => [
    key,
    await readFile(path.resolve(file), 'utf8')
  ] as const));
  const sources = Object.fromEntries(entries) as Record<keyof typeof paths, string>;

  expect(sources.atomicPublish).toContain('assertSemanticMutationTransactionRoot');
  expect(sources.atomicPublish).toContain('beforeByteDigest');
  expect(sources.atomicPublish).toContain('stagedByteDigest');
  expect(sources.recovery).toContain('previousRecordRevision');
  expect(sources.recovery).toContain('recordRevision');
  expect(sources.mutationOrchestrator).toContain('buildSemanticMutationVerificationExecutionRef(report)');
  expect(sources.mutationOrchestrator).toContain('stagedVerificationProofBinding(passedExecution, sha256(report))');
  expect(sources.mutationOrchestrator).toContain('assertStagedVerificationProofBinding');

  for (const removed of [
    'platform/compiler/verify/semantic-mutation-runner-build-child.ts',
    'platform/compiler/verify/semantic-mutation-runner-build-protocol.ts',
    'platform/compiler/verify/semantic-mutation-runner-build-settlement.ts',
    'platform/compiler/verify/semantic-mutation-staged-verification-reuse.ts'
  ]) {
    await expect(readFile(path.resolve(removed), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  }

  expect(sources.isolatedChild.match(/Bun\.build\(\{/gu)).toHaveLength(1);
  expect(sources.isolatedChild.match(/const result = await supervisor\(\{/gu)).toHaveLength(1);
  expect(sources.isolatedChild).not.toContain('Worker(');
  expect(sources.isolatedChild).not.toContain('runSemanticMutationIsolatedRunnerBuildFromFreshProcess');
  expect(sources.isolatedChild).not.toContain('createHostOwnedIsolatedPlaywrightRuntimeAliases');
  expect(sources.isolatedChild).not.toContain('cleanupHostOwnedIsolatedPlaywrightRuntimeAliases');
  expect(sources.runtimeVerification).not.toContain('playwright-cli-loader.mjs');
  expect(sources.runtimeVerification).not.toContain('Playwright Bun IPC');
  expect(sources.runtimeVerification).not.toContain('cdpPort');
  expect(sources.runtimeVerification).not.toContain('source identity changed');
  expect(sources.productionSentinel).toContain(
    "const enabled = process.env.SEC_RUN_SM3_PRODUCTION_SENTINEL === '1';"
  );
  expect(sources.productionSentinel).toContain('test.skipIf(!enabled)(');
  expect(sources.productionSentinel).toContain(
    "await import('../helpers/semantic-mutation-production-sentinel.ts')"
  );
  expect(sources.productionSentinel).not.toContain(
    "from '../helpers/semantic-mutation-production-sentinel.ts'"
  );
  expect(sources.productionSentinel).not.toContain('playwright');

  expect(sources.stagedProof).toContain("const PROOF_FORMAT_REVISION = 'staged-verification-proof-v1'");
  expect(sources.stagedProof).toContain('const issuedSources = new WeakMap');
  expect(sources.stagedProof).toContain('const issuedProofs = new WeakMap');
  expect(sources.stagedProof).toContain('source.consumed = true;');
  expect(sources.stagedProof).toContain('state.consuming = true;');
  expect(sources.stagedProof).toContain('state.consumed = true;');
  expect(sources.stagedProof).toContain('state.consuming = false;');
  expect(sources.stagedProof).toContain('projectInputDigest');
  expect(sources.stagedProof).toContain('stagedSourceDigest');
  expect(sources.stagedProof).toContain('verificationReportDigest');
  expect(sources.stagedProof).toContain('requiredVerificationDigest');
  expect(sources.stagedProof).toContain('rawArtifactSetDigest');
  expect(sources.stagedProof).not.toContain("from '../semantic-mutation/");
  expect(sources.stagedProof).not.toContain('run-semantic-mutation-isolated-child');

  const pipelineImports = sources.pipeline.slice(0, sources.pipeline.indexOf('const PIPELINE_LEASE_MONITOR_INTERVAL_MS'));
  expect(pipelineImports).toContain("from './verify-orchestrator.ts'");
  expect(pipelineImports).not.toContain('semantic-mutation-staged');
  expect(pipelineImports).not.toContain('staged-verification-proof');
  expect(pipelineImports).not.toContain('SemanticMutation');
  expect(sources.verifyFacade).toContain("from '../compiler/verify/staged-verification-proof.ts'");
  expect(sources.verifyProject).toContain('consumeStagedVerificationProof');
  expect(sources.verifyProject).toContain('revalidateStagedVerificationProof');
  expect(sources.verifyProject).toContain('assertStagedVerificationLiveContext');

  const evidenceDomain = ['semantic-mutation-isolated-verification', 'evidence-v1'].join('-');
  expect(sources.isolatedEvidence.split(evidenceDomain)).toHaveLength(2);
  expect(sources.isolatedEvidence).toContain("readonly status: 'passed'");
  expect(sources.isolatedEvidence).toContain("readonly status: 'blocked'");
  expect(sources.isolatedEvidence).not.toContain('run-semantic-mutation-isolated-child');
  expect(sources.isolatedEvidence).toContain("from './semantic-mutation-isolated-verification-failure.ts'");
  expect(sources.isolatedFailure).toContain('SemanticMutationIsolatedVerificationUnavailableError');

  const publicFacades = await Promise.all([
    readFile(path.resolve('platform/orchestrator.ts'), 'utf8'),
    readFile(path.resolve('platform/compiler/index.ts'), 'utf8')
  ]);
  for (const facade of publicFacades) {
    expect(facade).not.toContain('applySemanticMutationWithTestDependencies');
    expect(facade).not.toContain('runSemanticMutationIsolatedVerificationChild');
    expect(facade).not.toContain('StagedVerificationProof');
  }
});
test('compile-time boundaries reject lease-free Pipeline contexts and raw journal fields in public views', () => {
  const outcome = {} as SemanticMutationApplyOutcomeV1;
  const view = {} as SemanticMutationRequestRecordViewV1;
  type TransactionView = Extract<SemanticMutationRequestRecordViewV1, { readonly recordKind: 'transaction' }>;
  type ActiveView = TransactionView & { readonly state: 'prepared' | 'authoring-committed' };
  if (false) {
    // @ts-expect-error Isolated Verification authority cannot be forged structurally.
    const forgedIsolationCapability: IsolatedVerificationCapability = {};
    // @ts-expect-error Every manual Pipeline execution context must carry the exact writer lease token.
    const leaseFree: PipelineExecutionContext = { transactionId: 'tx:test', source: 'api' };
    // @ts-expect-error Public request-record views never expose retained source paths.
    const pathLeak: string = view.relativePath;
    // @ts-expect-error Public request-record views never expose retained before bytes/digests.
    const beforeLeak: string = view.beforeByteDigest;
    // @ts-expect-error Apply outcomes are discriminated; a rejection has no terminal result.
    const result = outcome.result;
    const prepared = {} as ActiveView & { readonly state: 'prepared' };
    const authoringCommitted = {} as ActiveView & { readonly state: 'authoring-committed' };
    const verified = {} as TransactionView & { readonly state: 'verified' };
    const rolledBack = {} as TransactionView & { readonly state: 'rolled-back' };
    const recoveryRequired = {} as TransactionView & { readonly state: 'recovery-required' };
    // @ts-expect-error Prepared views never carry terminal completion order.
    const invalidPrepared: TransactionView = { ...prepared, terminalSequence: 1 };
    // @ts-expect-error Authoring-committed views never carry terminal results.
    const invalidAuthoringCommitted: TransactionView = { ...authoringCommitted, result: verified.result };
    // @ts-expect-error Verified views never carry recovery failure state.
    const invalidVerified: TransactionView = { ...verified, recoveryState: 'concurrent-write' };
    // @ts-expect-error Rolled-back views require a rolled-back result.
    const invalidRolledBack: TransactionView = { ...rolledBack, result: verified.result };
    // @ts-expect-error Recovery-required views never carry terminal completion order.
    const invalidRecoveryRequired: TransactionView = { ...recoveryRequired, terminalSequence: 1 };
    const { recoveryState: omittedRecoveryState, ...recoveryWithoutState } = recoveryRequired;
    // @ts-expect-error Recovery-required views require their matching recovery state.
    const invalidRecoveryWithoutState: TransactionView = recoveryWithoutState;
    void forgedIsolationCapability;
    void leaseFree;
    void pathLeak;
    void beforeLeak;
    void result;
    void invalidPrepared;
    void invalidAuthoringCommitted;
    void invalidVerified;
    void invalidRolledBack;
    void invalidRecoveryRequired;
    void invalidRecoveryWithoutState;
    void omittedRecoveryState;
  }
  expect(true).toBe(true);
});

test('SM-3 digest domains remain independently reproducible', () => {
  const requirements = [{ kind: 'pass', passId: 'verify' }] as const;
  expect(sha256({
    domain: 'semantic-mutation-required-verification-v1',
    requirements
  })).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(sha256({
    domain: 'semantic-mutation-request-identity-v1',
    graphId: 'graph:1',
    appId: 'app:1',
    requestId: 'request:1'
  })).not.toBe(sha256({
    domain: 'semantic-mutation-verification-report-v1',
    graphId: 'graph:1',
    appId: 'app:1',
    requestId: 'request:1'
  }));
});

test('isolated Verification evidence preserves the passed projection and freezes blocked vectors', () => {
  const passed = {
    status: 'passed',
    artifacts: {
      rawDigests: {
        acceptanceCoverage: `sha256:${'a'.repeat(64)}`,
        policyReport: `sha256:${'b'.repeat(64)}`,
        runtimeReport: `sha256:${'c'.repeat(64)}`,
        verificationReport: `sha256:${'d'.repeat(64)}`
      },
      semanticBundle: {
        snapshot: {
          ir: {
            inputRevision: `sha256:${'1'.repeat(64)}`,
            semanticRevision: `sha256:${'2'.repeat(64)}`
          }
        }
      },
      verificationReport: {
        summary: { status: 'passed', requestedLane: 'all', failedLanes: [] },
        build: { status: 'passed' },
        unit: { status: 'passed', passed: ['unit'] },
        acceptance: { status: 'passed', passed: ['acceptance'], failed: [] },
        policy: { status: 'skipped', violations: [] },
        runtime: {
          status: 'passed',
          build: {
            status: 'passed', passed: ['build'], failed: [], command: 'bun run build'
          },
          unit: {
            status: 'passed', passed: ['unit'], failed: [], command: 'bun run test:unit'
          },
          acceptance: {
            status: 'passed', passed: ['acceptance'], failed: [],
            command: 'bun run test:acceptance'
          }
        }
      }
    }
  } as unknown as Extract<
    SemanticMutationIsolatedVerificationEvidence,
    { readonly status: 'passed' }
  >;
  expect(semanticMutationIsolatedVerificationEvidenceDigest(passed))
    .toBe(legacyPassedIsolatedVerificationEvidenceDigest(passed));
  expect(semanticMutationIsolatedVerificationEvidenceDigest({
    status: 'blocked',
    failure: { stage: 'binding-mismatch' }
  })).toBe('sha256:940969c50d2ef23e11454d3543f924348662a721717d7b58fba87bf75afb6927');
});
