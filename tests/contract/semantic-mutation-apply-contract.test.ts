import { createHash } from 'node:crypto';
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
  SEMANTIC_MUTATION_RUNNER_BUILD_CHILD_EVAL_SOURCE,
  SEMANTIC_MUTATION_RUNNER_BUILD_ENTRY_RELATIVE_PATH
} from '../../platform/compiler/verify/semantic-mutation-runner-build-child.ts';
import { isSemanticMutationStagingWorkspace } from '../../platform/compiler/verify/semantic-mutation-staging-boundary.ts';
import { assertSemanticMutationVerificationReportInvariant } from '../../platform/compiler/verify/semantic-mutation-verification-adapter.ts';
import { applySemanticMutation } from '../../platform/orchestrator.ts';
import type { IsolatedVerificationCapability } from '../../platform/orchestrator/isolated-verification-capability.ts';
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
import {
  arbitrateWindowsAppContainerNativeExecutionDeadlinesForTests,
  createWindowsAppContainerNativeExecutionBudgetForTests
} from '../../platform/shared/windows-appcontainer-executor.ts';
import { WORKSPACE_WRITE_LEASE_TOKEN_VERSION } from '../../platform/shared/workspace-write-lease.ts';

function sha256(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
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
    lease: 'workspace-write-lease-token-v1',
    recovery: 'semantic-mutation-recovery-record-v1',
    rejectedTerminal: 'semantic-mutation-rejected-terminal-record-v1',
    requestView: 'semantic-mutation-request-record-view-v1',
    stagedTransaction: 'semantic-mutation-staged-transaction-v1',
    rollbackManifest: 'semantic-mutation-rollback-manifest-v2',
    pipelineCompletionProof: 'pipeline-completion-proof-v1',
    terminalRetention: 256,
    verificationAdapterId: 'semantic-mutation-local-verification',
    verificationAdapterRevision: 'semantic-mutation-local-verification-v1',
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
});

test('writer authority, immutable journal, atomic publish/rollback CAS, and public redaction stay closed', async () => {
  const root = path.resolve(import.meta.dir, '../..');
  const sources = Object.fromEntries(await Promise.all(Object.entries({
    compilerFacade: 'platform/compiler/index.ts',
    blockOrchestrator: 'platform/orchestrator/block-orchestrator.ts',
    composeOrchestrator: 'platform/orchestrator/compose-orchestrator.ts',
    emitOrchestrator: 'platform/orchestrator/emit-orchestrator.ts',
    orchestratorFacade: 'platform/orchestrator.ts',
    orchestratorIndex: 'platform/orchestrator/index.ts',
    mutationOrchestrator: 'platform/orchestrator/semantic-mutation-orchestrator.ts',
    repairOrchestrator: 'platform/orchestrator/repair-orchestrator.ts',
    repairWriter: 'platform/compiler/repair/build-repair-plan.ts',
    workbenchOrchestrator: 'platform/orchestrator/workbench-orchestrator.ts',
    viewMutationWriter: 'platform/compiler/workbench/apply-view-mutations.ts',
    workspaceOrchestrator: 'platform/orchestrator/workspace-orchestrator.ts',
    journal: 'platform/compiler/semantic-mutation/mutation-recovery-record.ts',
    terminal: 'platform/compiler/semantic-mutation/mutation-terminal-record.ts',
    transactionIdentity: 'platform/compiler/semantic-mutation/transaction-identity.ts',
    stagedMutation: 'platform/compiler/semantic-mutation/derive-staged-mutation.ts',
    stagingBoundary: 'platform/shared/semantic-mutation-staging-boundary.ts',
    compilerStagingBoundary: 'platform/compiler/verify/semantic-mutation-staging-boundary.ts',
    atomicPublish: 'platform/compiler/semantic-mutation/atomic-source-publish.ts',
    lease: 'platform/shared/workspace-write-lease.ts',
    pipelineKernel: 'platform/shared/pipeline-kernel.ts',
    pipelineOrchestrator: 'platform/orchestrator/pipeline-orchestrator.ts',
    verifyOrchestrator: 'platform/orchestrator/verify-orchestrator.ts',
    neutralIsolationCapability: 'platform/orchestrator/isolated-verification-capability.ts',
    workbench: 'platform/orchestrator/workbench-server-v2.ts',
    upgrade: 'platform/upgrade/upgrade-workspace.ts',
    processRunner: 'platform/shared/process.ts',
    observedProcess: 'platform/shared/observed-process.ts',
    projectRuntime: 'platform/shared/project-runtime.ts',
    runtimeVerification: 'platform/compiler/verify/run-runtime-verification.ts',
    verifyProject: 'platform/compiler/verify/verify-project.ts',
    verificationAdapter: 'platform/compiler/verify/semantic-mutation-verification-adapter.ts',
    isolatedChildOutcome: 'platform/compiler/semantic-mutation/isolated-verification-child-outcome.ts',
    isolatedChildProgress: 'platform/compiler/semantic-mutation/isolated-verification-child-progress.ts',
    isolatedChild: 'platform/compiler/verify/run-semantic-mutation-isolated-child.ts',
    runnerBuildChild: 'platform/compiler/verify/semantic-mutation-runner-build-child.ts',
    runnerBuildProtocol: 'platform/compiler/verify/semantic-mutation-runner-build-protocol.ts',
    runnerBuildSettlement: 'platform/compiler/verify/semantic-mutation-runner-build-settlement.ts',
    isolatedRuntimeBinding: 'platform/compiler/verify/semantic-mutation-isolated-runtime-binding.ts',
    isolatedRuntimePlan: 'platform/compiler/verify/semantic-mutation-isolated-runtime-plan.ts',
    runtimeDependencySpec: 'platform/shared/runtime-dependency-spec.ts',
    isolationCapability: 'platform/compiler/verify/semantic-mutation-isolation-capability.ts',
    isolatedRunner: 'platform/orchestrator/semantic-mutation-isolated-verification-runner.ts',
    stagingTree: 'platform/compiler/verify/assert-isolated-staging-tree.ts',
    composeProject: 'platform/compiler/compose/compose-project.ts',
    prismaMerge: 'platform/compiler/compose/merge-prisma-template.ts',
    appContainer: 'platform/shared/windows-appcontainer-executor.ts',
    appContainerHelper: 'platform/shared/windows-appcontainer-native-helper.ts'
  }).map(async ([name, relative]) => [
    name,
    (await readFile(path.join(root, relative), 'utf8')).replace(/\r\n?/gu, '\n')
  ] as const)));

  for (const forbiddenWriter of [
    'composeProject', 'adaptProject', 'verifyProject',
    'writeCiArtifactManifest', 'lockProject', 'writeExplainGraph', 'writeLocalViews',
    'writeProvenance', 'writeReviewSummary', 'applyRepairPlan', 'writeRepairPlan',
    'writePolicySnapshot', 'applyViewMutations', 'buildSemanticMutationVerificationExecutionRef',
    'SemanticMutationIsolatedVerificationUnavailableError',
    'probeSemanticMutationIsolatedRuntimeCapability',
    'runSemanticMutationIsolatedVerificationChild',
    'IsolatedVerificationArtifacts',
    'SemanticMutationIsolatedVerificationFailure',
    'SemanticMutationIsolatedCapabilityPreparationSubstage',
    'SemanticMutationIsolatedRuntimeCapabilityDiagnostic',
    'SEMANTIC_MUTATION_ISOLATED_CAPABILITY_PREPARATION_SUBSTAGES',
    'buildSemanticMutationIsolatedRunnerBundleDiagnosticForTests',
    'classifySemanticMutationIsolatedRunnerBuildForTests',
    'readSemanticMutationIsolatedRunnerBuildFromFreshProcessForTests',
    'classifySemanticMutationIsolatedRunnerBuildFreshProcessForTests',
    'SEMANTIC_MUTATION_RUNNER_BUILD_EXIT_CODES',
    'SEMANTIC_MUTATION_RUNNER_BUILD_MAX_BUNDLE_BYTES',
    'SEMANTIC_MUTATION_RUNNER_BUILD_MAX_FRAME_BYTES',
    'SEMANTIC_MUTATION_RUNNER_BUILD_PROTOCOL_TOKEN',
    'SEMANTIC_MUTATION_RUNNER_BUILD_CHILD_EVAL_SOURCE',
    'SEMANTIC_MUTATION_RUNNER_BUILD_ENTRY_RELATIVE_PATH',
    'SEMANTIC_MUTATION_RUNNER_BUILD_FRAME_MAGIC_BYTES',
    'SEMANTIC_MUTATION_RUNNER_BUILD_FRAME_LENGTH_BYTES',
    'SEMANTIC_MUTATION_RUNNER_BUILD_FRAME_DIGEST_BYTES',
    'semanticMutationRunnerBuildSuccessFrame',
    'parseSemanticMutationRunnerBuildSuccessFrame',
    'semanticMutationRunnerBuildFailureSubstage',
    'classifySemanticMutationRunnerBuildSettlement',
    'SemanticMutationRunnerBuildSettlementRejection',
    'SemanticMutationRunnerBuildSettlementClassification',
    'SEMANTIC_MUTATION_RUNNER_BUILD_PROTOCOL_FRAME_INVALID',
    'SEMANTIC_MUTATION_RUNNER_BUILD_OUTPUT_OWNERSHIP_UNPROVEN',
    'createFreshProductionSemanticMutationIsolatedRunnerBundleLoaderForTests',
    'projectSemanticMutationIsolatedRuntimeCapabilitySubstageForTests',
    'semanticMutationIsolatedRuntimeCapabilityDiagnosticForTests'
  ]) {
    expect(sources.compilerFacade, `public Compiler facade exports ${forbiddenWriter}`)
      .not.toMatch(new RegExp(`export[^;]+\\b${forbiddenWriter}\\b`, 'su'));
  }
  for (const facade of [sources.compilerFacade, sources.orchestratorFacade, sources.orchestratorIndex]) {
    expect(facade).not.toContain('semantic-mutation-runner-build-settlement');
    for (const internalSettlementSymbol of [
      'classifySemanticMutationRunnerBuildSettlement',
      'SemanticMutationRunnerBuildSettlementRejection',
      'SemanticMutationRunnerBuildSettlementClassification',
      'SEMANTIC_MUTATION_RUNNER_BUILD_PROTOCOL_FRAME_INVALID',
      'SEMANTIC_MUTATION_RUNNER_BUILD_OUTPUT_OWNERSHIP_UNPROVEN',
      'createFreshProductionSemanticMutationIsolatedRunnerBundleLoaderForTests'
    ]) {
      expect(facade).not.toMatch(
        new RegExp(`export[^;]+\\b${internalSettlementSymbol}\\b`, 'su')
      );
    }
  }

  const normalizeIndex = sources.mutationOrchestrator.indexOf('normalizeSemanticMutationRequest(input.request)');
  const acquireIndex = sources.mutationOrchestrator.indexOf('acquireWorkspaceWriteLease(workspaceRoot)');
  expect(normalizeIndex).toBeGreaterThan(-1);
  expect(acquireIndex).toBeGreaterThan(normalizeIndex);
  expect(sources.mutationOrchestrator).toContain('projectSemanticMutationRequestRecordView');
  expect(sources.mutationOrchestrator).toContain('return terminalRecoveryOutcome(recovery)');
  expect(sources.mutationOrchestrator).toContain('proof = compiled.completionProof');
  for (const internalSeam of [
    'applySemanticMutationWithAfterPreparedTestCrash',
    'applySemanticMutationWithTestDependencies',
    'planSemanticMutationTransactionWithTestDependencies'
  ]) {
    expect(sources.mutationOrchestrator).toContain(internalSeam);
    expect(sources.orchestratorFacade).not.toContain(internalSeam);
    expect(sources.orchestratorIndex).not.toContain(internalSeam);
    expect(sources.compilerFacade).not.toContain(internalSeam);
  }

  expect(sources.journal).toContain('handle.sync()');
  expect(sources.journal).toContain('await rename(tempPath, finalPath)');
  expect(sources.journal).toContain('await fsyncDirectory(directory, commitFence)');
  expect(sources.terminal).toContain('reserveSemanticMutationTerminalSequence');
  expect(sources.terminal).toContain('terminal-order');
  expect(sources.transactionIdentity).toContain(
    "const TRANSACTION_PARENT_SEGMENTS = ['.sec', 'semantic-mutation', 'v1', 'transactions'] as const"
  );
  expect(sources.transactionIdentity).toContain('const TRANSACTION_NAME_PATTERN = /^[0-9a-f]{64}$/u');
  expect(sources.stagedMutation).toContain("const stagingWorkspaceRoot = path.join(transactionRoot, 'workspace')");
  expect(sources.stagingBoundary).toContain(
    "const STAGING_PARENT_SEGMENTS = ['.sec', 'semantic-mutation', 'v1', 'transactions'] as const"
  );
  expect(sources.stagingBoundary).toContain("if (path.basename(resolved) !== 'workspace') return false");
  expect(sources.compilerStagingBoundary).toContain(
    "export { isSemanticMutationStagingWorkspace } from '../../shared/semantic-mutation-staging-boundary.ts'"
  );
  expect(sources.pipelineOrchestrator).not.toContain('semantic-mutation-staging-boundary');
  expect(sources.pipelineOrchestrator).not.toContain('isSemanticMutationStagingWorkspace');
  expect(sources.pipelineOrchestrator).not.toContain('isolated: true');
  expect(sources.pipelineOrchestrator).toContain(
    'isolatedVerificationCapability?: IsolatedVerificationCapability'
  );

  expect(sources.atomicPublish).toContain('assertSameDevice(target, transactionRoot');
  expect(sources.atomicPublish).toContain('Live source changed during final publish CAS');
  expect(sources.atomicPublish).toContain('Rollback CAS refused to overwrite source bytes not committed by this transaction');
  expect(sources.atomicPublish).toContain('await operations.rename(publishTemp, target)');
  expect(sources.atomicPublish).toContain('await operations.rename(restoreTemp, target)');
  expect(sources.atomicPublish).toContain('{ details: safeDetails }');
  expect(sources.atomicPublish).not.toContain('copyFile');

  const ownerWrite = sources.lease.indexOf('await durableWriteOwner(candidate, owner, createId)');
  const leasePublish = sources.lease.indexOf('await publishLeaseCandidateNoReplace(candidate, lease)', ownerWrite);
  const parentFsync = sources.lease.indexOf('await fsyncDirectory(parent)', leasePublish);
  expect(ownerWrite).toBeGreaterThan(-1);
  expect(leasePublish).toBeGreaterThan(ownerWrite);
  expect(parentFsync).toBeGreaterThan(leasePublish);
  expect(sources.lease).toContain('const RENAME_NOREPLACE = 1');
  expect(sources.lease).toContain('async function publishLeaseCandidateNoReplace');
  expect(sources.lease).toContain("await import('bun:ffi')");
  expect(sources.lease).toContain('library.symbols.renameat2(');
  expect(sources.lease).toContain('const assertManagerHolder = (token: WorkspaceWriteLeaseToken)');
  expect(sources.lease).toContain('assertActiveLease(reentrantToken)');
  expect(sources.lease).toContain('assertManagerHolder(token);\n    await assertOwned(workspaceRoot, token)');
  const noReplacePublish = sources.lease.indexOf('async function publishLeaseCandidateNoReplace');
  const unsupportedPlatformGuard = sources.lease.indexOf("if (process.platform !== 'win32')", noReplacePublish);
  const windowsRenameFallback = sources.lease.indexOf('await fs.rename(candidate, lease)', unsupportedPlatformGuard);
  expect(unsupportedPlatformGuard).toBeGreaterThan(noReplacePublish);
  expect(windowsRenameFallback).toBeGreaterThan(unsupportedPlatformGuard);
  expect(sources.pipelineKernel).toContain('const commitFence = () => assertWorkspaceWriteLease(');
  expect(sources.pipelineKernel).toContain('await commitFence();');
  expect((sources.workbench.match(/withWorkbenchWriterLease/gu) ?? []).length).toBeGreaterThanOrEqual(3);
  expect(sources.workspaceOrchestrator).toContain('ensureProjectBase(workspaceRoot, commitFence)');
  expect(sources.workspaceOrchestrator).toContain('writeYaml(planPath, defaultPlan(), commitFence)');
  expect(sources.repairOrchestrator).toContain(
    'applyRepairPlan(workspaceRoot, plan, lock, repairPlan, commitFence)'
  );
  expect(sources.repairWriter).toContain('await commitFence?.();');
  expect(sources.repairWriter).toContain('writeProvenance(workspaceRoot, lock, commitFence)');
  expect(sources.viewMutationWriter).toContain('writeYaml(planPath, plan, commitFence)');
  expect(sources.viewMutationWriter).toContain('writeJson(viewMutationReportPath, report, commitFence)');
  for (const [source, minimumFences] of [
    [sources.blockOrchestrator, 1],
    [sources.workspaceOrchestrator, 3],
    [sources.emitOrchestrator, 2],
    [sources.repairOrchestrator, 5],
    [sources.workbenchOrchestrator, 1],
    [sources.upgrade, 10]
  ] as const) {
    const directFences = (source.match(/await assertWorkspaceWriteLease\(workspaceRoot, /gu) ?? []).length;
    const localFences = (source.match(/await commitFence\(\)/gu) ?? []).length;
    const delegatedFences = (source.match(/, commitFence\)/gu) ?? []).length;
    expect(directFences + localFences + delegatedFences)
      .toBeGreaterThanOrEqual(minimumFences);
  }
  expect(sources.upgrade).toContain('workspaceWriteLease: WorkspaceWriteLeaseToken');
  expect(sources.mutationOrchestrator).toContain('runSemanticMutationIsolatedVerificationChild');
  expect(sources.mutationOrchestrator).toContain('windowsAppContainerCapability().status');
  expect(sources.mutationOrchestrator).not.toContain('probeWindowsAppContainerCapability({');
  expect(sources.mutationOrchestrator).toContain('status: artifacts.status');
  expect(sources.mutationOrchestrator).toContain("reason: 'isolated-verification-unavailable'");
  expect(sources.mutationOrchestrator).toContain('isolatedVerification: isolatedVerificationFailure');
  expect(sources.mutationOrchestrator).toContain('generatedArtifactRawDigests: artifacts.rawDigests');
  expect(sources.mutationOrchestrator).toContain('build: generatedReport.runtime.build');
  expect(sources.mutationOrchestrator).not.toContain("errorCode: 'isolated-child-failed'");
  expect(sources.isolatedChild).toContain('options.appContainerRunner ?? runWindowsAppContainerChild');
  expect(sources.isolatedChild).toContain('SemanticMutationIsolatedVerificationUnavailableError');
  expect(sources.isolatedChild).toContain("stage: 'appcontainer-execution'");
  expect(sources.isolatedChildOutcome).toContain(
    "'.isolated-process/child/semantic-mutation-isolated-child-outcome-v1.json'"
  );
  expect(sources.isolatedChildOutcome).toContain(
    "'.isolated-process/child/.semantic-mutation-isolated-child-outcome-v1.pending'"
  );
  expect(sources.isolatedChildOutcome).toContain("readonly status: 'failed'");
  expect(sources.isolatedChildOutcome).toContain("| 'preflight'");
  expect(sources.isolatedChildOutcome).toContain("| 'verify-all'");
  expect(sources.isolatedChildOutcome).toContain("| 'postcondition'");
  expect(sources.isolatedChildOutcome).toContain("new TextDecoder('utf-8', { fatal: true })");
  expect(sources.isolatedChildOutcome).toContain("open(pendingPath, 'wx', 0o600)");
  expect(sources.isolatedChildOutcome).toContain('await handle.sync()');
  expect(sources.isolatedChildOutcome).toContain('await rename(pendingPath, finalPath)');
  for (const forbidden of ['message:', 'path:', 'stdout:', 'stderr:', 'rawOutput:', 'timestamp:']) {
    expect(sources.isolatedChildOutcome).not.toContain(forbidden);
  }
  expect(sources.isolatedChildProgress).toContain(
    "'.isolated-compiler/platform/orchestrator/semantic-mutation-isolated-verification-bootstrap.mjs'"
  );
  expect(sources.isolatedChildProgress).toContain(
    "'.isolated-compiler/platform/orchestrator/semantic-mutation-isolated-verification-loader.mjs'"
  );
  for (const checkpoint of [
    'bootstrap-entered', 'loader-entered', 'core-import-started', 'module-entered', 'catch-armed', 'verify-all',
    'postcondition', 'failure-caught', 'catch-tree-validated', 'outcome-publish-started'
  ]) {
    expect(sources.isolatedChildProgress).toContain(`'${checkpoint}'`);
  }
  expect(sources.isolatedChildProgress).toContain('runnerControlledFailure: 70');
  expect(sources.isolatedChildProgress).toContain('progressPublicationFailure: 74');
  expect(sources.isolatedChildProgress).toContain('loaderImportFailure: 75');
  for (const removedTypeScriptAuthority of [
    'typescriptResolutionFailure', 'typescriptEntryIdentityMismatch',
    'typescriptEntryImportFailure', 'typescriptRuntimeFailure',
    'typescript-resolution-failure', 'typescript-entry-identity-mismatch',
    'typescript-entry-import-failure', 'typescript-runtime-failure',
    'typescript-specifier-resolved', 'typescript-entry-identity-verified',
    'typescript-imported', 'typescript-runtime-verified', 'ts-morph-imported'
  ]) {
    expect(sources.isolatedChildProgress).not.toContain(removedTypeScriptAuthority);
    expect(sources.isolatedChild).not.toContain(removedTypeScriptAuthority);
  }
  expect(sources.isolatedChild).toContain("'loader-import-failure'");
  expect(sources.isolatedChildProgress).toContain("open(pendingPath, 'wx', 0o600)");
  expect(sources.isolatedChildProgress).toContain('await handle.sync()');
  expect(sources.isolatedChildProgress).toContain('await rename(pendingPath, finalPath)');
  expect(sources.isolatedChildProgress).toContain('await import(new URL(');
  expect(sources.isolatedChildProgress).toContain(
    "formatRevision: 'semantic-mutation-isolated-bundled-loader-binding-v1'"
  );
  expect(sources.isolatedChildProgress).toContain(
    "executionRevision: 'semantic-mutation-bundled-core-relocation-v1'"
  );
  expect(sources.isolatedChildProgress).not.toContain('Bun.resolveSync');
  expect(sources.isolatedChildProgress).not.toContain("await import('typescript')");
  expect(sources.isolatedChildProgress).not.toContain("await import('ts-morph')");
  const loaderCheckpoint = sources.isolatedChildProgress.indexOf("await publish('loader-entered')");
  const coreCheckpoint = sources.isolatedChildProgress.indexOf(
    "await publish('core-import-started')",
    loaderCheckpoint
  );
  const coreImport = sources.isolatedChildProgress.indexOf('await import(new URL(', coreCheckpoint);
  expect(loaderCheckpoint).toBeGreaterThan(-1);
  expect(coreCheckpoint).toBeGreaterThan(loaderCheckpoint);
  expect(coreImport).toBeGreaterThan(coreCheckpoint);
  expect(sources.isolatedRuntimePlan).toContain('loaderBundleDigest: sha256Bytes(plan.loaderBundle)');
  expect(sources.isolatedRuntimePlan).not.toContain('TypeScriptEntryBindingV1');
  expect(sources.isolatedRuntimePlan).not.toContain('typeScriptEntryBinding');
  expect(sources.isolatedRuntimePlan).not.toContain('typescript-entry-exit-algebra');
  for (const forbidden of [
    'readonly message', 'readonly path', 'readonly stdout', 'readonly stderr',
    'readonly rawOutput', 'readonly timestamp'
  ]) {
    expect(sources.isolatedChildProgress).not.toContain(forbidden);
  }
  expect(sources.stagedMutation).toContain("childRelative === '.shared-deps'");
  expect(sources.stagingTree).toContain('const ISOLATION_SCAN_CONCURRENCY = 8');
  expect(sources.stagingTree).toContain('await Promise.allSettled(');
  expect(sources.isolatedChildProgress).toContain('runnerStagingTreeFailure: 76');
  expect(sources.isolatedChildProgress).toContain('runnerEnvironmentBoundaryFailure: 77');
  expect(sources.isolatedChildProgress).toContain('runnerStagingLayoutBoundaryFailure: 78');
  expect(sources.isolatedChildProgress).toContain("'runner-staging-tree-failure'");
  expect(sources.isolatedRunner).toContain('SemanticMutationIsolatedStagingTreeFailure');
  expect(sources.isolatedRunner).toContain(
    'SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.runnerStagingTreeFailure'
  );
  expect(sources.isolatedRunner).toContain(
    'SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.runnerEnvironmentBoundaryFailure'
  );
  expect(sources.isolatedRunner).toContain(
    'SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.runnerStagingLayoutBoundaryFailure'
  );
  expect(sources.isolatedRunner).toContain(
    "let failureStage: SemanticMutationIsolatedChildFailureStage = 'preflight'"
  );
  const runnerVerifyAll = sources.isolatedRunner.indexOf("failureStage = 'verify-all'");
  const runnerCompileTelemetry = sources.isolatedRunner.indexOf(
    'const compiled = await withSemanticMutationIsolatedPhaseTelemetry(',
    runnerVerifyAll
  );
  const runnerCompilePhase = sources.isolatedRunner.indexOf(
    "'compile-workspace'",
    runnerCompileTelemetry
  );
  const runnerCompile = sources.isolatedRunner.indexOf(
    'async () => await compileWorkspace(',
    runnerCompilePhase
  );
  const runnerPostcondition = sources.isolatedRunner.indexOf("failureStage = 'postcondition'", runnerCompile);
  const runnerPostconditionCheckpoint = sources.isolatedRunner.indexOf(
    "publishSemanticMutationIsolatedProgressCheckpoint(stagingWorkspaceRoot, 'postcondition')",
    runnerPostcondition
  );
  const runnerOutcomePublishStarted = sources.isolatedRunner.indexOf(
    "publishSemanticMutationIsolatedProgressCheckpoint(process.cwd(), 'outcome-publish-started')",
    runnerPostconditionCheckpoint
  );
  const runnerPublishFailure = sources.isolatedRunner.indexOf(
    'await publishSemanticMutationIsolatedChildOutcome(process.cwd(), outcome)',
    runnerOutcomePublishStarted
  );
  expect(runnerVerifyAll).toBeGreaterThan(-1);
  expect(runnerCompileTelemetry).toBeGreaterThan(runnerVerifyAll);
  expect(runnerCompilePhase).toBeGreaterThan(runnerCompileTelemetry);
  expect(runnerCompile).toBeGreaterThan(runnerCompilePhase);
  expect(runnerPostcondition).toBeGreaterThan(runnerCompile);
  expect(runnerPostconditionCheckpoint).toBeGreaterThan(runnerPostcondition);
  expect(runnerOutcomePublishStarted).toBeGreaterThan(runnerPostconditionCheckpoint);
  expect(runnerPublishFailure).toBeGreaterThan(runnerOutcomePublishStarted);
  expect(sources.isolatedRunner).toContain(
    "publishSemanticMutationIsolatedProgressCheckpoint(process.cwd(), 'module-entered')"
  );
  expect(sources.isolatedRunner).toContain(
    "publishSemanticMutationIsolatedProgressCheckpoint(process.cwd(), 'outcome-publish-started')"
  );
  expect(sources.isolatedChild).toContain(
    'const DEFAULT_RUNTIME_DEPENDENCY_SOURCES = resolveIsolatedRuntimeDependencySources();'
  );
  expect(sources.isolatedChild).toContain(
    'browserCache: DEFAULT_RUNTIME_DEPENDENCY_SOURCES.browserCache'
  );
  expect(sources.isolatedChild).toContain(
    'compilerModulesRoot: DEFAULT_RUNTIME_DEPENDENCY_SOURCES.nodeModules'
  );
  expect(sources.isolatedChild).toContain(
    'dependencyModules: DEFAULT_RUNTIME_DEPENDENCY_SOURCES.nodeModules'
  );
  expect(sources.runtimeDependencySpec).toContain("'ts-morph'");
  expect(sources.isolatedChild).not.toContain("external: ['ts-morph', 'typescript']");
  for (const runnerBuildOutcome of [
    'runner-build-invocation',
    'runner-build-unsuccessful',
    'runner-build-output-count',
    'runner-build-output-read'
  ]) {
    expect(sources.isolatedChild).toContain(`'${runnerBuildOutcome}'`);
  }
  expect(sources.isolatedChild).not.toContain(
    "new SemanticMutationIsolatedCapabilityPreparationError('runner-build')"
  );
  expect(sources.isolatedChild).toContain('runObservedCommand');
  expect(sources.isolatedChild).toContain("'--no-install',\n          '--no-env-file'");
  expect(sources.isolatedChild).toContain("'--eval',\n          SEMANTIC_MUTATION_RUNNER_BUILD_CHILD_EVAL_SOURCE");
  expect(sources.isolatedChild).not.toContain('RUNNER_BUILD_CHILD_PATH');
  expect(sources.isolatedChild).toContain("envMode: 'replace'");
  expect(sources.isolatedChild).toContain('maxObservedOutputBytes: SEMANTIC_MUTATION_RUNNER_BUILD_MAX_FRAME_BYTES');
  expect(typeLiteralKeys(
    sources.runnerBuildSettlement,
    'SemanticMutationRunnerBuildSettlementClassification'
  )).toEqual([
    ['status'],
    ['status', 'substage'],
    ['status', 'reason']
  ]);
  const settlementRejectionStart = sources.runnerBuildSettlement.indexOf(
    'export type SemanticMutationRunnerBuildSettlementRejection ='
  );
  const settlementRejectionEnd = sources.runnerBuildSettlement.indexOf(
    '\n\nexport type SemanticMutationRunnerBuildSettlementClassification =',
    settlementRejectionStart
  );
  expect(settlementRejectionStart).toBeGreaterThan(-1);
  expect(settlementRejectionEnd).toBeGreaterThan(settlementRejectionStart);
  expect([...sources.runnerBuildSettlement
    .slice(settlementRejectionStart, settlementRejectionEnd)
    .matchAll(/\| '([^']+)'/gu)]
    .map((match) => match[1])).toEqual([
    'execute-rejected',
    'timed-out',
    'not-started',
    'closure-unproven',
    'requested-termination',
    'not-exited',
    'exit-status-unproven',
    'stdout-truncated',
    'stderr-truncated',
    'stdout-evidence-mismatch',
    'stderr-evidence-mismatch',
    'declared-failure-contaminated',
    'unexpected-exit',
    'protocol-frame-invalid',
    'output-ownership-unproven'
  ]);
  expect(sources.runnerBuildSettlement).not.toMatch(
    /\b(?:cleanup|cleanupProven|processRoot|rm)\b/u
  );
  expect(sources.runnerBuildSettlement).toContain(
    'outcome.stdout.digest !== observedDigest(observedStdout)'
  );

  const publicRunnerBuildSubstagesStart = sources.isolatedChild.indexOf(
    'export const SEMANTIC_MUTATION_ISOLATED_CAPABILITY_PREPARATION_SUBSTAGES = Object.freeze(['
  );
  const publicRunnerBuildSubstagesEnd = sources.isolatedChild.indexOf(
    '] as const);',
    publicRunnerBuildSubstagesStart
  );
  expect(publicRunnerBuildSubstagesStart).toBeGreaterThan(-1);
  expect(publicRunnerBuildSubstagesEnd).toBeGreaterThan(publicRunnerBuildSubstagesStart);
  expect([...sources.isolatedChild
    .slice(publicRunnerBuildSubstagesStart, publicRunnerBuildSubstagesEnd)
    .matchAll(/^\s+'([^']+)',?$/gmu)]
    .map((match) => match[1])).toEqual([
    'runner-build-root-proof',
    'runner-build-invocation',
    'runner-build-unsuccessful',
    'runner-build-output-count',
    'runner-build-output-read',
    'runner-relocation',
    'capability-issue',
    'unknown'
  ]);

  const runnerBuildObserverStart = sources.isolatedChild.indexOf(
    'function notifySemanticMutationRunnerBuildSettlement('
  );
  const runnerBuildObserverEnd = sources.isolatedChild.indexOf(
    '\nasync function cleanupSemanticMutationRunnerBuildProcessRoot(',
    runnerBuildObserverStart
  );
  const runnerBuildObserver = sources.isolatedChild.slice(
    runnerBuildObserverStart,
    runnerBuildObserverEnd
  );
  expect(runnerBuildObserverStart).toBeGreaterThan(-1);
  expect(runnerBuildObserverEnd).toBeGreaterThan(runnerBuildObserverStart);
  expect(runnerBuildObserver).toContain('try {');
  expect(runnerBuildObserver).toContain('observe?.(classification);');
  expect(runnerBuildObserver).toContain('} catch {');
  expect(runnerBuildObserver).not.toMatch(/\b(?:cleanup|cleanupProven|processRoot|rm)\b/u);

  const runnerBuildReaderStart = sources.isolatedChild.indexOf(
    'async function readSemanticMutationIsolatedRunnerBuildFromFreshProcess('
  );
  const runnerBuildReaderEnd = sources.isolatedChild.indexOf(
    '/** Test-only observed-process seam;',
    runnerBuildReaderStart
  );
  const runnerBuildReader = sources.isolatedChild.slice(
    runnerBuildReaderStart,
    runnerBuildReaderEnd
  );
  expect(runnerBuildReaderStart).toBeGreaterThan(-1);
  expect(runnerBuildReaderEnd).toBeGreaterThan(runnerBuildReaderStart);
  const runnerBuildCleanupProof = runnerBuildReader.indexOf(
    'cleanupProven = !outcome.started'
  );
  const runnerBuildClassification = runnerBuildReader.indexOf(
    'const classification = classifySemanticMutationRunnerBuildSettlement(outcome, frame);'
  );
  expect(runnerBuildCleanupProof).toBeGreaterThan(-1);
  expect(runnerBuildClassification).toBeGreaterThan(runnerBuildCleanupProof);
  const runnerBuildCleanupGate = runnerBuildReader.indexOf('if (cleanupProven) {');
  const runnerBuildPrimaryFailure = runnerBuildReader.indexOf('if (primaryFailed) {');
  expect(runnerBuildCleanupGate).toBeGreaterThan(runnerBuildClassification);
  expect(runnerBuildPrimaryFailure).toBeGreaterThan(runnerBuildCleanupGate);
  const runnerBuildCleanup = runnerBuildReader.slice(
    runnerBuildCleanupGate,
    runnerBuildPrimaryFailure
  );
  expect(runnerBuildCleanup).toContain('await cleanup(processRoot);');
  expect(runnerBuildCleanup).not.toMatch(/\b(?:classification|settlement|reason|status)\b/u);
  const runnerBuildOwnershipGuard = runnerBuildReader.indexOf(
    "if (cleanupFailed || bundle === undefined || settlement?.status !== 'success')"
  );
  const runnerBuildOwnershipRejection = runnerBuildReader.indexOf(
    'SEMANTIC_MUTATION_RUNNER_BUILD_OUTPUT_OWNERSHIP_UNPROVEN',
    runnerBuildOwnershipGuard
  );
  const runnerBuildOwnershipFailure = runnerBuildReader.indexOf(
    "throw new SemanticMutationIsolatedCapabilityPreparationError('runner-build-invocation');",
    runnerBuildOwnershipRejection
  );
  const runnerBuildSuccessNotification = runnerBuildReader.indexOf([
    'notifySemanticMutationRunnerBuildSettlement(',
    '      observeSettlement,',
    '      settlement',
    '    );'
  ].join('\n'), runnerBuildOwnershipFailure);
  const runnerBuildReturn = runnerBuildReader.indexOf('return bundle;', runnerBuildSuccessNotification);
  expect(runnerBuildOwnershipGuard).toBeGreaterThan(runnerBuildPrimaryFailure);
  expect(runnerBuildOwnershipRejection).toBeGreaterThan(runnerBuildOwnershipGuard);
  expect(runnerBuildOwnershipFailure).toBeGreaterThan(runnerBuildOwnershipRejection);
  expect(runnerBuildSuccessNotification).toBeGreaterThan(runnerBuildOwnershipFailure);
  expect(runnerBuildReturn).toBeGreaterThan(runnerBuildSuccessNotification);
  expect(runnerBuildReader).not.toContain(
    'settlement ?? SEMANTIC_MUTATION_RUNNER_BUILD_OUTPUT_OWNERSHIP_UNPROVEN'
  );

  const runnerBuildSettlementProjectionStart = sources.isolatedChild.indexOf(
    'function runnerBuildSettlementFailureSubstage('
  );
  const runnerBuildSettlementProjectionEnd = sources.isolatedChild.indexOf(
    '\nasync function readSemanticMutationIsolatedRunnerBuildFromFreshProcess(',
    runnerBuildSettlementProjectionStart
  );
  const runnerBuildSettlementProjection = sources.isolatedChild.slice(
    runnerBuildSettlementProjectionStart,
    runnerBuildSettlementProjectionEnd
  );
  expect(runnerBuildSettlementProjectionStart).toBeGreaterThan(-1);
  expect(runnerBuildSettlementProjectionEnd).toBeGreaterThan(
    runnerBuildSettlementProjectionStart
  );
  expect(runnerBuildSettlementProjection).toContain("'stdout-evidence-mismatch'");
  expect(runnerBuildSettlementProjection).toContain("'stderr-evidence-mismatch'");
  expect(runnerBuildSettlementProjection).toContain("'protocol-frame-invalid'");
  expect(runnerBuildSettlementProjection).toContain("? 'runner-build-output-read'");
  expect(runnerBuildSettlementProjection).toContain(": 'runner-build-invocation';");
  expect(runnerBuildSettlementProjection).not.toContain("'output-ownership-unproven'");
  expect(sources.isolatedChild).toContain('let cleanupProven = true;');
  expect(sources.isolatedChild).toContain('cleanupProven = false;');
  expect(sources.isolatedChild).toContain('maxRetries: 3');
  expect(sources.isolatedChild).toContain('retryDelay: 25');
  expect(sources.isolatedChild).not.toContain('const sourceBundle = await readSemanticMutationIsolatedRunnerBuildOutput(');
  expect(sources.runnerBuildChild).toContain(
    'export const SEMANTIC_MUTATION_RUNNER_BUILD_CHILD_EVAL_SOURCE = ['
  );
  expect(sources.runnerBuildChild).not.toContain('fileURLToPath');
  expect(sources.runnerBuildChild).not.toContain('import.meta.main');
  expect(sources.runnerBuildChild).not.toContain('process.env');
  expect(sources.runnerBuildChild).not.toContain('console.');
  expect(sources.runnerBuildChild).not.toContain('process.stderr');
  expect(SEMANTIC_MUTATION_RUNNER_BUILD_ENTRY_RELATIVE_PATH).toBe(
    'platform/orchestrator/semantic-mutation-isolated-verification-runner.ts'
  );
  expect(SEMANTIC_MUTATION_RUNNER_BUILD_CHILD_EVAL_SOURCE)
    .not.toMatch(/\b(?:import|require)\b/u);
  expect(SEMANTIC_MUTATION_RUNNER_BUILD_CHILD_EVAL_SOURCE)
    .not.toMatch(/(?:[A-Za-z]:[\\/]|file:|node_modules|import\.meta)/u);
  expect(SEMANTIC_MUTATION_RUNNER_BUILD_CHILD_EVAL_SOURCE).not.toContain('Bun.spawn');
  expect(SEMANTIC_MUTATION_RUNNER_BUILD_CHILD_EVAL_SOURCE).not.toContain('process.execPath');
  expect(SEMANTIC_MUTATION_RUNNER_BUILD_CHILD_EVAL_SOURCE).toContain([
    '      minify: {',
    '        whitespace: true,',
    '        syntax: true,',
    '        identifiers: false',
    '      },'
  ].join('\n'));
  expect(SEMANTIC_MUTATION_RUNNER_BUILD_CHILD_EVAL_SOURCE.match(/\bminify:/gu)).toHaveLength(1);
  expect(SEMANTIC_MUTATION_RUNNER_BUILD_CHILD_EVAL_SOURCE).not.toMatch(/\bminify:\s*true\b/u);
  expect(SEMANTIC_MUTATION_RUNNER_BUILD_CHILD_EVAL_SOURCE).not.toMatch(/\bidentifiers:\s*true\b/u);
  const runnerBuildTokenGuard = SEMANTIC_MUTATION_RUNNER_BUILD_CHILD_EVAL_SOURCE.indexOf(
    'process.argv.length !== 2 || process.argv[1] !== TOKEN'
  );
  const runnerBuildInvocation = SEMANTIC_MUTATION_RUNNER_BUILD_CHILD_EVAL_SOURCE.indexOf(
    'result = await Bun.build({'
  );
  const runnerBuildUnsuccessful = SEMANTIC_MUTATION_RUNNER_BUILD_CHILD_EVAL_SOURCE.indexOf(
    'if (!result.success)'
  );
  const runnerBuildOutputCount = SEMANTIC_MUTATION_RUNNER_BUILD_CHILD_EVAL_SOURCE.indexOf(
    'if (result.outputs.length !== 1)'
  );
  expect(runnerBuildTokenGuard).toBeGreaterThan(-1);
  expect(runnerBuildInvocation).toBeGreaterThan(runnerBuildTokenGuard);
  expect(runnerBuildUnsuccessful).toBeGreaterThan(runnerBuildInvocation);
  expect(runnerBuildOutputCount).toBeGreaterThan(runnerBuildUnsuccessful);
  expect(sources.runnerBuildProtocol).toContain('setBigUint64(');
  expect(sources.runnerBuildProtocol).toContain("createHash('sha256')");
  expect(sources.runnerBuildProtocol).toContain('timingSafeEqual(');
  expect(sources.runnerBuildProtocol).toContain('Uint8Array.from(frame.subarray(payloadOffset))');
  expect(sources.observedProcess).toContain('export async function runObservedCommand(');
  expect(sources.isolatedChild).toContain('relocateIsolatedRunnerBundle(');
  expect(sources.isolatedChild).toContain("'/node_modules/@ts-morph/common/dist'");
  expect(sources.isolatedChild).toContain("'/node_modules/typescript/lib'");
  expect(sources.isolatedChild).toContain('materializeSemanticMutationIsolatedRuntime({');
  expect(sources.isolatedChild).toContain('assertSemanticMutationIsolatedRuntimeLaunchManifest({');
  expect(sources.isolatedChild).toContain('Custom compiler registry closure is unavailable in isolated verification');
  expect(sources.isolatedChild).not.toContain('Isolated verification requires a project baseline');
  const isolatedBoundary = sources.isolatedRunner.indexOf(
    '!isSemanticMutationStagingWorkspace(stagingWorkspaceRoot)'
  );
  const isolatedTree = sources.isolatedRunner.indexOf(
    'await assertIsolatedStagingTree(stagingWorkspaceRoot, stagingTreeOptions)',
    isolatedBoundary
  );
  const isolatedMint = sources.isolatedRunner.indexOf(
    'const isolatedVerificationCapability = mintIsolatedVerificationCapability(stagingWorkspaceRoot)',
    isolatedTree
  );
  const isolatedCompileTelemetry = sources.isolatedRunner.indexOf(
    'const compiled = await withSemanticMutationIsolatedPhaseTelemetry(',
    isolatedMint
  );
  const isolatedCompile = sources.isolatedRunner.indexOf(
    'async () => await compileWorkspace(',
    isolatedCompileTelemetry
  );
  const isolatedBaseline = sources.isolatedRunner.indexOf(
    'const baseline = await readProjectBaseline(stagingWorkspaceRoot)',
    isolatedCompile
  );
  expect(isolatedBoundary).toBeGreaterThan(-1);
  expect(isolatedTree).toBeGreaterThan(isolatedBoundary);
  expect(isolatedMint).toBeGreaterThan(isolatedTree);
  expect(isolatedCompileTelemetry).toBeGreaterThan(isolatedMint);
  expect(isolatedCompile).toBeGreaterThan(isolatedCompileTelemetry);
  expect(isolatedBaseline).toBeGreaterThan(isolatedCompile);
  const verifyCapabilityAssertion = sources.verifyOrchestrator.indexOf(
    'assertIsolatedVerificationCapability(workspaceRoot, options.isolatedVerificationCapability)'
  );
  const isolatedVerifyProject = sources.verifyOrchestrator.indexOf(
    'const report = await verifyProject(',
    verifyCapabilityAssertion
  );
  expect(verifyCapabilityAssertion).toBeGreaterThan(-1);
  expect(isolatedVerifyProject).toBeGreaterThan(verifyCapabilityAssertion);
  expect(sources.isolatedRunner).toContain(
    "{ executionBoundary: 'windows-appcontainer' as const }"
  );
  expect(sources.verifyOrchestrator).toContain(
    'workspaceWriteLease: context.workspaceWriteLease'
  );
  expect(sources.verifyOrchestrator).toContain(
    "? { executionBoundary: 'windows-appcontainer' as const }"
  );
  expect(sources.verifyProject).toContain(
    'assertIsolatedStagingTree(workspaceRoot, options.stagingTreeOptions)'
  );
  expect(sources.runtimeVerification).toContain(
    'assertIsolatedStagingTree(options.stagingWorkspaceRoot!, options.stagingTreeOptions)'
  );
  expect(sources.stagingTree).toContain(
    "readonly executionBoundary?: 'windows-appcontainer'"
  );
  expect(sources.stagingTree).toContain('readonly workspaceWriteLease?: WorkspaceWriteLeaseToken');
  expect(sources.stagingTree).toContain('withWorkspaceWriteLeaseControlPlaneQuiesced(');
  expect(sources.stagingTree).toContain(
    "process.env[ISOLATED_VERIFICATION_ENV_KEY] !== '1'"
  );
  expect(sources.stagingTree).toContain('!isSemanticMutationStagingWorkspace(resolvedRoot)');
  expect(sources.pipelineOrchestrator).toContain('emitPipelineExecutionBoundary(');
  expect(sources.pipelineOrchestrator).toContain('`pipeline-${stage}`');
  for (const boundary of [
    'verify-preflight',
    'verify-fast',
    'verify-runtime',
    'verify-artifact-publish'
  ]) {
    expect(sources.verifyProject).toContain(`'${boundary}'`);
  }
  expect(sources.isolatedRunner).toContain("event.type === 'execution-boundary'");
  expect(sources.isolatedRunner).toContain("failureBoundary = 'pipeline-bootstrap'");
  expect(sources.isolatedRunner).toContain("event.type === 'transaction-start'");
  expect(sources.isolatedRunner).toContain("failureStage === 'verify-all' ? failureBoundary : undefined");
  expect(sources.isolatedChildOutcome).toContain("record.stage !== 'verify-all'");
  expect(sources.isolatedChild).toContain('projectChildOutcome(childOutcome.value)');
  expect(sources.isolatedChild).not.toContain("executionBoundary: 'windows-appcontainer'");
  const runtimeCapabilityProjectionStart = sources.isolatedChild.indexOf(
    'function projectSemanticMutationIsolatedRuntimeCapabilitySubstage('
  );
  const runtimeCapabilityProjectionEnd = sources.isolatedChild.indexOf(
    '\nfunction isolatedRuntimeCapabilityDiagnostic(',
    runtimeCapabilityProjectionStart
  );
  expect(runtimeCapabilityProjectionStart).toBeGreaterThan(-1);
  expect(runtimeCapabilityProjectionEnd).toBeGreaterThan(runtimeCapabilityProjectionStart);
  const runtimeCapabilityProjection = sources.isolatedChild.slice(
    runtimeCapabilityProjectionStart,
    runtimeCapabilityProjectionEnd
  );
  expect(runtimeCapabilityProjection).toContain("stage: 'runtime-capability' as const");
  expect(runtimeCapabilityProjection).toContain('runtimeCapability: Object.freeze({ substage })');
  for (const rawField of ['cause', 'command', 'env', 'message', 'path', 'stack', 'stderr', 'stdout']) {
    expect(runtimeCapabilityProjection).not.toMatch(new RegExp(`\\b${rawField}\\b`, 'u'));
  }
  expect(sources.neutralIsolationCapability).toContain(
    'const workspaceRootsByCapability = new WeakMap<object, string>()'
  );
  for (const facade of [sources.compilerFacade, sources.orchestratorFacade, sources.orchestratorIndex]) {
    expect(facade).not.toContain('mintIsolatedVerificationCapability');
  }
  expect(sources.isolatedRuntimePlan).toContain(
    "export const SEMANTIC_MUTATION_ISOLATED_COMPILER_RELATIVE_ROOT = '.isolated-compiler'"
  );
  expect(sources.isolatedRuntimePlan).toContain(
    'generatedInputFile(SEMANTIC_MUTATION_ISOLATED_BOOTSTRAP_RELATIVE_PATH, bootstrapBundle)'
  );
  expect(sources.isolatedRuntimePlan).toContain(
    'generatedInputFile(SEMANTIC_MUTATION_ISOLATED_RUNNER_CORE_RELATIVE_PATH, runnerBundle)'
  );
  expect(sources.isolatedRuntimePlan).toContain(
    'runnerRelativePath: SEMANTIC_MUTATION_ISOLATED_BOOTSTRAP_RELATIVE_PATH'
  );
  expect(sources.isolatedRuntimePlan).toContain(
    'const runtimePlansByBinding = new WeakMap<object, SemanticMutationIsolatedRuntimePlanV1>()'
  );
  expect(sources.isolatedRuntimePlan).toContain('runtimePlansByBinding.set(result, plan)');
  expect(sources.isolatedRuntimePlan).toContain(
    'registerSemanticMutationIsolatedRuntimePlanBinding(result)'
  );
  expect(sources.isolatedRuntimeBinding).toContain('const runtimeBindingRoots = new WeakSet<object>()');
  expect(sources.isolatedRuntimeBinding).toContain('const forwardedRuntimeBindings = new WeakMap<object, object>()');
  expect(sources.isolatedRuntimeBinding).toContain('forwardedRuntimeBindings.set(');
  expect(sources.isolatedRuntimePlan).toContain(
    'resolveSemanticMutationIsolatedRuntimePlanBinding(binding)'
  );
  expect(sources.isolationCapability).toContain(
    'forwardSemanticMutationIsolatedRuntimePlanBinding(result, proven)'
  );
  expect(sources.verificationAdapter).toContain(
    'forwardSemanticMutationIsolatedRuntimePlanBinding(isolationCapability, plan)'
  );
  expect(sources.isolatedRuntimePlan).toContain('readonly directories: readonly string[]');
  expect(sources.isolatedRuntimePlan).toContain('readonly files: readonly RuntimeDestinationManifestEntryV1[]');
  expect(sources.isolatedRuntimePlan).toContain('sourceIdentity: file.sourceIdentity');
  expect(sources.isolatedRuntimePlan).toContain('rawDigest: file.rawDigest');
  expect(sources.isolatedRuntimePlan).toContain('Semantic Mutation runtime source changed before materialization');
  expect(sources.isolatedRuntimePlan).toContain('Semantic Mutation isolated runtime destination manifest is not exact');
  expect(sources.isolatedChild).toContain("envMode: 'replace'");
  expect(sources.isolatedChild).toContain('classifySemanticMutationIsolatedVerificationArtifactSet');
  expect(sources.isolatedChild).not.toContain("if (result.code !== 0)");
  const freshReportRemoval = sources.isolatedChild.indexOf('await rm(reportPath');
  const isolatedChildSpawn = sources.isolatedChild.indexOf('const result = await supervisor({', freshReportRemoval);
  const childOutcomeRead = sources.isolatedChild.indexOf(
    'readChildOutcomeResult(stagingWorkspaceRoot, commitFence)',
    isolatedChildSpawn
  );
  const exactArtifactRead = sources.isolatedChild.indexOf(
    'readJsonArtifactResult(paths.verificationReportPath, commitFence)',
    childOutcomeRead
  );
  expect(freshReportRemoval).toBeGreaterThan(-1);
  expect(isolatedChildSpawn).toBeGreaterThan(freshReportRemoval);
  expect(childOutcomeRead).toBeGreaterThan(isolatedChildSpawn);
  expect(exactArtifactRead).toBeGreaterThan(childOutcomeRead);
  expect(sources.isolatedChild).toContain("stage: 'child-failed-before-artifacts'");
  expect(sources.isolatedChild).toContain("stage: 'child-terminated-without-outcome'");
  expect(sources.isolatedChild).toContain("artifact: 'child-progress'");
  expect(sources.isolatedChild).toContain('classifySemanticMutationIsolatedTermination(result.code)');
  expect(sources.isolatedChild).toContain('readSemanticMutationIsolatedProgressTrace(');
  expect(sources.isolatedChild).toContain("| 'artifact-missing'");
  expect(sources.isolatedChild).toContain("? 'artifact-missing'");
  expect(sources.isolatedChild).toContain("stage: 'artifact-parse'");
  expect(sources.isolatedChild).toContain("artifact: 'child-outcome'");
  expect(sources.isolatedChild).toContain("artifact: 'verification-set'");
  expect(sources.verifyProject).toContain("installMode: 'prebound-only'");
  expect(sources.runtimeVerification).toContain("installMode: 'prebound-only'");
  expect(sources.projectRuntime).toContain("['--no-env-file', `--config=${isolatedConfigPath}`, ...bunArgs]");
  expect(sources.projectRuntime).toContain("options.installMode === 'prebound-only'");
  expect(sources.projectRuntime).toContain('isRuntimeDepsPreboundBinding(binding, runtimeSpec.manifestHash)');
  expect(sources.isolatedRuntimePlan).toContain(
    "SEMANTIC_MUTATION_ISOLATED_PROJECT_DEPS_RELATIVE_ROOT =\n  'project/node_modules'"
  );
  expect(sources.isolatedRuntimePlan).toContain(
    'SEMANTIC_MUTATION_ISOLATED_PROJECT_DEPS_RELATIVE_ROOT,\n        inspector'
  );
  expect(sources.isolatedRuntimePlan).toContain(
    'runCanonicalBatches(plan.files, async (file) => {'
  );
  expect(sources.isolatedRuntimePlan).toContain('}, input.commitFence);');
  expect(sources.isolatedRuntimePlan).not.toContain(
    '`${SEMANTIC_MUTATION_ISOLATED_COMPILER_RELATIVE_ROOT}/.shared-deps/node_modules`'
  );
  expect(sources.projectRuntime).not.toContain(
    "['install', '--offline', '--no-save', '--ignore-scripts', '--backend=copyfile']"
  );
  expect(sources.runtimeVerification).toContain(
    "['--no-env-file', `--config=${isolatedConfigPath!}`, '--no-install', 'run', script]"
  );
  expect(sources.runtimeVerification).not.toContain('...process.env,\n    [envPathKey]');
  expect(sources.prismaMerge).toContain(
    "const isolatedConfigPath = path.join(isolatedWritableRoot, 'bunfig.toml')"
  );
  expect(sources.prismaMerge).toMatch(
    /'--no-env-file',\s*`--config=\$\{isolatedConfigPath\}`,\s*'x',\s*'--no-install',\s*'prisma@6'/u
  );
  expect(sources.pipelineOrchestrator).toContain(
    'composeWorkspace(workspaceRoot, { signal: leaseSignal }, context)'
  );
  expect(sources.composeOrchestrator).toContain('signal: options?.signal');
  expect(sources.composeProject).toContain('signal: options?.signal');
  expect(sources.prismaMerge).toContain('beforeSpawn: commitFence');
  expect(sources.prismaMerge).toContain('signal: options.signal');
  expect(sources.stagingTree).toContain("Number(before.nlink) !== 1");
  expect(sources.stagingTree).toContain('FILE_ATTRIBUTE_REPARSE_POINT');
  expect(sources.processRunner).toContain("options.envMode === 'replace' ? {} : process.env");
  expect(sources.appContainer).toContain('PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES');
  expect(sources.appContainer).toContain('PROC_THREAD_ATTRIBUTE_HANDLE_LIST');
  expect(sources.appContainer).toContain('STARTF_USESTDHANDLES');
  expect(sources.appContainer).toContain('CreateFileW');
  expect(sources.appContainer).toContain('standardInputHandle = openNullHandle(GENERIC_READ)');
  expect(sources.appContainer).toContain('standardOutputHandle = openNullHandle(GENERIC_WRITE)');
  expect(sources.appContainer).toContain('standardErrorHandle = openNullHandle(GENERIC_WRITE)');
  expect(sources.appContainer).toContain(
    'WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1.procThreadAttributeCount'
  );
  expect(sources.appContainer).toContain(
    'WINDOWS_APPCONTAINER_NATIVE_CONTRACT_V1.inheritHandles'
  );
  expect(sources.appContainer).toContain('CloseHandle(standardInputHandle)');
  expect(sources.appContainer).toContain('CloseHandle(standardOutputHandle)');
  expect(sources.appContainer).toContain('CloseHandle(standardErrorHandle)');
  expect(sources.appContainer).toContain('attributePayloads.push(securityCapabilities)');
  expect(sources.appContainer).toContain('attributePayloads.push(standardHandleList)');
  const deleteAttributeList = sources.appContainer.indexOf(
    'DeleteProcThreadAttributeList(attributeList)'
  );
  const pinAttributePayloads = sources.appContainer.indexOf(
    'for (const payload of attributePayloads) void payload.byteLength',
    deleteAttributeList
  );
  expect(deleteAttributeList).toBeGreaterThan(-1);
  expect(pinAttributePayloads).toBeGreaterThan(deleteAttributeList);
  expect(sources.appContainer).toContain(
    "if (diagnosticStreamPresent || protocol.classification === 'invalid')"
  );
  expect(sources.appContainer).toContain(
    'const nativeHelperObservations = new WeakMap<Error, WindowsAppContainerNativeHelperObservation>()'
  );
  expect(sources.appContainer.match(
    /^const \w+ = new WeakMap<.*>\(\);$/gmu
  )).toEqual([
    'const executionCleanupFailures = new WeakMap<Error, readonly Error[]>();',
    'const nativeHelperObservations = new WeakMap<Error, WindowsAppContainerNativeHelperObservation>();'
  ]);
  expect(typeLiteralKeys(
    sources.appContainer,
    'WindowsAppContainerNativeHelperObservation'
  )).toEqual([[
    'mode', 'exitClass', 'diagnosticStream', 'protocol', 'nativeReceipt'
  ]]);
  expect(sources.appContainer).not.toContain(
    'export type ObservedNativeHelperSettlementClassificationForTests'
  );
  expect(classPublicReadonlyKeys(
    sources.appContainer,
    'WindowsAppContainerExecutionError'
  )).toEqual([
    'code', 'preparationSubstage', 'nativeHelperObservation',
    'phase', 'nativeCode', 'hostToolFailure'
  ]);
  expect(sources.appContainer).toContain(
    "diagnosticStream: diagnosticStreamPresent ? 'present' : 'empty'"
  );
  expect(sources.appContainer).toContain('nativeReceipt: nativeReceipt.classification');
  expect(sources.appContainer).not.toContain('const controller = new AbortController()');
  expect(sources.appContainer).not.toContain('signal: controller.signal');
  expect(sources.appContainer).not.toContain('controller.abort()');
  expect(sources.appContainer).not.toContain('normalizeExecutionError(monitorError ?? error,');
  expect(sources.appContainer).toContain('WINDOWS_APPCONTAINER_NATIVE_WAIT_SLICE_MS');
  expect(sources.appContainer).toContain(
    'writeFileSync(nativeResultPath, `${JSON.stringify({ exitCode })}\\n`, { flag: \'wx\' })'
  );
  expect(sources.appContainer).toContain(
    '? await readNativeReceipt(helperRequest.nativeResultPath, commitFence)'
  );
  expect(sources.appContainer).toContain("handle = await open(resultPath, 'r')");
  expect(sources.appContainer).toContain('const after = await handle.stat()');
  expect(sources.appContainer).toContain(
    'String(after.dev) !== String(before.dev) || String(after.ino) !== String(before.ino)'
  );
  expect(sources.appContainer).toContain('Buffer.alloc(MAX_NATIVE_RECEIPT_BYTES + 1)');
  expect(sources.appContainer).not.toContain("readFile(resultPath, 'utf8')");
  expect(sources.appContainer).toContain(
    'if (error instanceof Error) nativeHelperObservations.set(error, observation)'
  );
  expect(sources.appContainer).not.toContain('parseNativeResult(');
  expect(sources.appContainer).not.toContain('observeNativeReceipt(');
  for (const forbiddenObservationField of [
    'readonly stdout', 'readonly stderr', 'readonly path', 'readonly message', 'readonly rawOutput'
  ]) {
    expect(sources.appContainer).not.toContain(forbiddenObservationField);
  }
  expect(sources.appContainer).not.toContain('process.stderr.write');
  expect(sources.appContainer).toContain('JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE');
  expect(sources.appContainer).toContain('probeWindowsAppContainerCapability');
  expect(sources.appContainer).toContain('rawConnect === false');
  expect(sources.appContainer).toContain('recoveryOwnerPath');
  const createProfileHelper = sources.appContainer.indexOf("'create-profile',\n          nativeRequest");
  const executeHelper = sources.appContainer.indexOf("'execute',\n          nativeRequest", createProfileHelper);
  expect(createProfileHelper).toBeGreaterThan(-1);
  expect(executeHelper).toBeGreaterThan(createProfileHelper);
  expect(sources.appContainer).toContain('createWindowsAppContainerProfileForNativeHelper');
  expect(sources.appContainer).toContain('deriveWindowsAppContainerSidForNativeHelper');
  expect(sources.appContainer).not.toContain('[sm3-native]');
  expect(sources.appContainer).not.toContain('SEC_DEBUG_ISOLATED_RUNTIME');
  const helperExitPreload = sources.appContainerHelper.indexOf(
    'const exitNativeHelper = await loadNativeHelperExit()'
  );
  const helperProfileCreate = sources.appContainerHelper.indexOf(
    'await createWindowsAppContainerProfileForNativeHelper(envelope.request)'
  );
  expect(helperExitPreload).toBeGreaterThan(-1);
  expect(helperProfileCreate).toBeGreaterThan(helperExitPreload);
  expect(sources.appContainerHelper).toContain("mode: 'create-profile'");
  expect(sources.appContainerHelper).toContain('writeSync(1, payload)');
  expect(sources.appContainerHelper).toContain('writeFileSync(');
  expect(sources.appContainerHelper).not.toContain('process.stdout.write');
  expect(sources.appContainerHelper).not.toContain('assertWorkspaceWriteLease');
  expect(sources.appContainer).toContain(
    "const HOST_BUN_CONFIG_RELATIVE_ROOT = '.sm3h'"
  );
  expect(sources.appContainer).toContain(
    'await durableCreateFile(configPath, ISOLATED_BUN_CONFIG_CONTENT, commitFence)'
  );
  expect(sources.appContainer).toContain(
    'if (cachedPromise) return cachedPromise'
  );
  expect(sources.appContainer).toContain(
    'if (cachedPromise === cached) cachedPromise = undefined'
  );
  expect(sources.appContainer).toContain('entrypoints: [NATIVE_HELPER_PATH]');
  expect(sources.appContainer).toContain('await durableCreateFile(helperPath, helperContents, commitFence)');
  expect(sources.appContainer).toContain("Number(helperMetadata.nlink) !== 1");
  expect(sources.appContainer).toContain(
    'await cleanupWindowsAppContainerNativeOwner(cleanupRequest, provenAppContainerSid)'
  );
  expect(sources.appContainerHelper).not.toContain("mode: 'cleanup'");
  expect(sources.appContainer).toMatch(
    /'--no-env-file',\s*`--config=\$\{configPath\}`,\s*'--no-install',\s*helperPath,\s*encodedRequest/u
  );
  expect(sources.appContainer).not.toContain('[NATIVE_HELPER_PATH, serialized]');
  expect(sources.appContainer.match(
    /'--no-env-file',\s*'--config=' \+ bunConfigPath,\s*'--no-install'/gu
  )?.length).toBe(2);
  expect(sources.appContainer.match(
    /const bunConfigPath = path\.join\(path\.dirname\(process\.execPath\), 'bunfig\.toml'\)/gu
  )?.length).toBe(2);
  expect(sources.appContainer).toContain('() => cleanupHostBunConfig(stagingRoot, commitFence)');
  expect(sources.appContainer).not.toContain("import { runCommand } from './process.ts'");
  expect(sources.appContainer).toContain('const executionRetainedOwners = new WeakSet<Error>();');
  expect(sources.appContainer).toContain('executionRetainedOwners.has(primaryError)');
  expect(sources.appContainer).toContain('if (!cleanupSafe) executionRetainedOwners.add(error);');
  const settlementStart = sources.appContainer.indexOf(
    'function settleObservedHostBunCommand('
  );
  const settlementEnd = sources.appContainer.indexOf(
    '\nfunction observedDiagnosticCaptureForTests(',
    settlementStart
  );
  const settlement = sources.appContainer.slice(settlementStart, settlementEnd);
  expect(settlementStart).toBeGreaterThan(-1);
  expect(settlementEnd).toBeGreaterThan(settlementStart);
  expect(settlement).toContain([
    'const cleanupSafe = outcome.started',
    '    ? closedTree',
    '    : outcome.termination.streamsDrained && outcome.termination.treeClosed;'
  ].join('\n'));
  expect(settlement).toContain('const classification = classifyObservedHostBunCommand(');
  expect(settlement).toContain(
    "if (classification.status !== 'success' || outcome.exitCode === null)"
  );
  expect(settlement).toContain('if (!cleanupSafe) executionRetainedOwners.add(error);');
  expect(settlement.indexOf('const cleanupSafe ='))
    .toBeLessThan(settlement.indexOf('const classification ='));
  expect(arbitrateWindowsAppContainerNativeExecutionDeadlinesForTests(60_000)).toEqual({
    childTimeoutMs: 60_000,
    hostWatchdogMs: 70_000
  });
  expect(arbitrateWindowsAppContainerNativeExecutionDeadlinesForTests(undefined)).toEqual({
    childTimeoutMs: 120_000,
    hostWatchdogMs: 130_000
  });
  expect(createWindowsAppContainerNativeExecutionBudgetForTests(60_000, 1_000)).toEqual({
    startedAtMs: 1_000,
    timeoutMs: 60_000
  });
  const nativeChildStart = sources.appContainer.indexOf(
    'export async function runWindowsAppContainerNativeChild('
  );
  const nativeChildEnd = sources.appContainer.indexOf(
    '\nexport async function cleanupWindowsAppContainerNativeOwner(',
    nativeChildStart
  );
  const nativeChild = sources.appContainer.slice(nativeChildStart, nativeChildEnd);
  expect(nativeChild.indexOf('const startedAtMs = Date.now();'))
    .toBeLessThan(nativeChild.indexOf('assertCapability();'));
  expect(nativeChild).toContain([
    'const executionBudget = createWindowsAppContainerNativeExecutionBudget(',
    '    executionDeadlines.childTimeoutMs,',
    '    startedAtMs',
    '  );'
  ].join('\n'));
  expect(sources.appContainer).toContain([
    "'execute',",
    '          nativeRequest,',
    '          validated.stagingRoot,',
    '          request.environment,',
    '          commitFence,',
    '          executionDeadlines.hostWatchdogMs'
  ].join('\n'));
  expect(sources.appContainer).toContain(
    'maxObservedOutputBytes: WINDOWS_HOST_TOOL_OUTPUT_LIMIT_BYTES'
  );
  expect(sources.appContainer).toContain('whileRunning: commitFence');
  expect(sources.appContainer).toContain(
    'result = settleObservedHostBunCommand(observed, stdoutChunks, Object.freeze({'
  );
  expect(sources.verificationAdapter).toContain('!exactEndpoint(input.attempted)');
  expect(sources.verificationAdapter).toContain('JSON.stringify(input.requirements) !== JSON.stringify(requirements)');
  expect(sources.verificationAdapter).toContain('assertSemanticMutationVerificationReportInvariant(report)');
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
