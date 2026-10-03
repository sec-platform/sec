import { createHash } from 'node:crypto';
import type { CI_VERIFICATION_CONTRACT_REVISION } from "../../../../assurance/verification/contract/revision.ts";
import { CodexDevelopmentBuildVerificationGateResult, type VerificationGateResult, type VerificationResultStatus } from '../../../../assurance/verification/result/contract/result.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileProviderSettlementSet,
  compileSemanticOperationPlan,
  issueNormalDomainReadbackReceipt,
  issueNormalOwnerTerminalJoinReceipt,
  issueProviderSettlementReceipt,
  issueSemanticOperationAttemptContext,
  type BoundSemanticOperation,
  type OperationDigest
} from '../../../../execution/operation/semantic.ts';
import type { CiVerificationActionPlanClosure, VerificationActionKeyDigest, VerificationActionPlan } from '../../../../execution/verification/action.ts';
import type { VerificationEvidence, VerificationGateEvidence } from '../../../../execution/verification/session.ts';
import {
  type CodexDevelopmentExactGitBlobReadOptions
} from '../../../providers/git-read/exact-blob.ts';
import {
  type GitBlobBytes
} from '../../../providers/git-read/runtime/session.ts';
import { assertProcessResourceSessionReceipt } from '../../../runtime-state/physical/runtime/process-resource-session.ts';
import { encodeVerificationActionData, issueProcessVerificationActionTerminalSettlement, issueVerificationActionOwnerTerminalReceipt } from '../action/contract/action.ts';
import { assertCiVerificationCurrentOperation, ciVerificationNormalizedOperationArgv, parseCiVerificationActionPlanClosure, SOURCE_PROGRAM_TRANSITION_GATE_ID, SOURCE_PROGRAM_TRANSITION_STDOUT_BYTE_LIMIT, type CiVerificationProducerGate } from '../action/contract/ci.ts';
import {
  createVerificationActionRunner,
  type VerificationActionRunner,
  type VerificationActionRunOutcome
} from '../action/runner.ts';
import type { CodexDevelopmentTestImpactSourceProvider } from '../test-impact/runtime/impact.ts';
import type { CodexDevelopmentGitChangedRecord, CodexDevelopmentTestImpactTransitionObservation } from '../test-impact/runtime/transition.ts';
import { CodexDevelopmentVerificationDigest, parseTrustedRuntimeSourceProgramActionRecord, type TrustedRuntimeSourceProgramActionRecord } from './contract/evidence.ts';
import {
  type CodexDevelopmentVerificationPlan
} from './contract/plan.ts';
import {
  CODEX_DEVELOPMENT_GATE_STDERR_BYTE_LIMIT,
  CODEX_DEVELOPMENT_GATE_STDOUT_BYTE_LIMIT, CodexDevelopmentFailureTail, type CodexDevelopmentGateProcessSettlement
} from './runtime/ci-orchestration-core.ts';

export type CodexDevelopmentCiVerificationTestOptions = {
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  repositoryRoot?: string;
  gitRevision?: (ref: string) => string | null;
  trackedTreeIsClean?: () => boolean;
  changedFiles?: (baseRef: string) => string[] | null;
  changedRecords?: (baseRef: string) => CodexDevelopmentGitChangedRecord[] | null;
  transitionObservation?: CodexDevelopmentTestImpactTransitionObservation;
  readGitBlob?: (ref: string, file: string) => GitBlobBytes | null;
  runGate?: (
    step: { id: string; argv: string[]; env: NodeJS.ProcessEnv },
    execution: Readonly<{
      operation: BoundSemanticOperation;
      requirementId: string;
    }>
  ) => Promise<CodexDevelopmentGateProcessSettlement>;
  writeEvidence?: (filePath: string, evidence: VerificationEvidence<typeof CI_VERIFICATION_CONTRACT_REVISION, VerificationResultStatus, VerificationGateResult>) => void;
  actionRunner?: VerificationActionRunner;
  readDurableActionResult?: (actionKey: VerificationActionKeyDigest) => Readonly<{
    result: VerificationGateResult;
    evidenceRefs: readonly string[];
  }> | null;
  readExactGitBlob?: (options: CodexDevelopmentExactGitBlobReadOptions) => GitBlobBytes;
  /** Owner-issued test seam; production CLI always acquires the exact candidate projection. */
  testImpactSourceProvider?: CodexDevelopmentTestImpactSourceProvider;
  /** Test-only pure plan seam; never exposed by the production CLI entry. */
  testVerificationPlan?: CodexDevelopmentVerificationPlan;
};

export interface CodexDevelopmentCiActionExecution {
  readonly actionPlan: CiVerificationActionPlanClosure;
  readonly gates: readonly VerificationGateEvidence<VerificationGateResult>[];
  readonly failed: boolean;
}

const CI_ACTION_EFFECT_LEASE_MS = 300_000;

const CI_ACTION_PROCESS_REQUIREMENT_ID = 'verification.hosted-process';

const CI_ACTION_DIAGNOSTIC_REQUIREMENT_ID = 'verification.action-diagnostics';

const CI_ACTION_EFFECT_RESOURCE_BUDGET = Object.freeze({
  maximumDurationMs: CI_ACTION_EFFECT_LEASE_MS,
  maximumInputBytes: 16 * 1024 * 1024,
  maximumOutputBytes:
    CODEX_DEVELOPMENT_GATE_STDOUT_BYTE_LIMIT + CODEX_DEVELOPMENT_GATE_STDERR_BYTE_LIMIT,
  maximumProcesses: 1
});

function bindCiActionEffect(
  plan: VerificationActionPlan,
  operation: CiVerificationActionPlanClosure['normalizedOperations'][number],
  deadlineAtUnixMs: number
): BoundSemanticOperation {
  const processContractDigest = CodexDevelopmentVerificationDigest({
    schema: 'sec-ci-action-effect-contract-v1',
    actionKey: plan.action.actionKey,
    operation
  }) as OperationDigest;
  const diagnosticContractDigest = CodexDevelopmentVerificationDigest({
    schema: 'sec-ci-action-combined-diagnostic-contract-v1',
    actionKey: plan.action.actionKey
  }) as OperationDigest;
  const authorityGrantDigest = CodexDevelopmentVerificationDigest({
    processContractDigest,
    diagnosticContractDigest
  }) as OperationDigest;
  const semanticPlan = compileSemanticOperationPlan({
    operation: 'verification.hosted-ci',
    intentDigest: plan.action.actionKey as OperationDigest,
    decisionDigest: operation.semanticDigest as OperationDigest,
    deadlineAtUnixMs,
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: CI_ACTION_EFFECT_RESOURCE_BUDGET.maximumDurationMs },
      { resource: 'input-bytes', maximum: CI_ACTION_EFFECT_RESOURCE_BUDGET.maximumInputBytes },
      { resource: 'output-bytes', maximum: operation.gateId === SOURCE_PROGRAM_TRANSITION_GATE_ID
        ? SOURCE_PROGRAM_TRANSITION_STDOUT_BYTE_LIMIT + CODEX_DEVELOPMENT_GATE_STDERR_BYTE_LIMIT
        : CI_ACTION_EFFECT_RESOURCE_BUDGET.maximumOutputBytes },
      { resource: 'processes', maximum: CI_ACTION_EFFECT_RESOURCE_BUDGET.maximumProcesses }
    ],
    requirements: [{
      id: CI_ACTION_PROCESS_REQUIREMENT_ID,
      contractDigest: processContractDigest,
      effectKinds: ['process'],
      failureKinds: ['process.failed', 'process.settlement-failed']
    }, {
      id: CI_ACTION_DIAGNOSTIC_REQUIREMENT_ID,
      contractDigest: diagnosticContractDigest,
      effectKinds: ['filesystem'],
      failureKinds: ['diagnostic.incomplete-object', 'diagnostic.resource-exhausted']
    }],
    attempt: issueSemanticOperationAttemptContext({ authorityGrantDigest })
  });
  return bindSemanticOperation(semanticPlan, [
    compileCapabilityBinding({
      requirementId: CI_ACTION_PROCESS_REQUIREMENT_ID,
      contractDigest: processContractDigest,
      providerIdentityDigest: CodexDevelopmentVerificationDigest({
        schema: 'sec-ci-action-provider-binding-v1',
        environment: plan.action.environment,
        declaredEnvironment: plan.action.operation.declaredEnvironment
      }) as OperationDigest
    }),
    compileCapabilityBinding({
      requirementId: CI_ACTION_DIAGNOSTIC_REQUIREMENT_ID,
      contractDigest: diagnosticContractDigest,
      providerIdentityDigest: CodexDevelopmentVerificationDigest(
        'runtime-state.process-diagnostics'
      ) as OperationDigest
    })
  ]);
}

async function issueCiActionEffectSettlement(input: Readonly<{
  runner: VerificationActionRunner;
  repositoryRoot: string;
  operation: BoundSemanticOperation;
  plan: VerificationActionPlan;
  gateId: string;
  settlement: CodexDevelopmentGateProcessSettlement;
}>) {
  const { operation, plan, gateId, settlement } = input;
  const { result, processResourceReceipt } = settlement;
  assertProcessResourceSessionReceipt(processResourceReceipt, {
    operationIdentityDigest: operation.plan.identity.identityDigest,
    boundAttemptDigest: operation.boundAttemptDigest,
    requirementId: CI_ACTION_PROCESS_REQUIREMENT_ID
  });
  if (processResourceReceipt.processCount !== CI_ACTION_EFFECT_RESOURCE_BUDGET.maximumProcesses
      || processResourceReceipt.settledProcessCount !== processResourceReceipt.processCount) {
    throw new Error('CI Action process settlement requires one completely settled physical process.');
  }
  if (!Number.isSafeInteger(result.code) || result.code < 0
      || !/^sha256:[0-9a-f]{64}$/u.test(result.rawOutputDigest)) {
    throw new Error('CI Action process settlement is not canonical.');
  }
  const processSettlement = issueProviderSettlementReceipt(operation, {
    requirementId: CI_ACTION_PROCESS_REQUIREMENT_ID,
    physicalDisposition: 'settled',
    providerSettlementReferenceDigest: CodexDevelopmentVerificationDigest({
      schema: 'sec-ci-action-provider-settlement-reference-v1',
      actionKey: plan.action.actionKey,
      gateId,
      exitCode: result.code,
      rawOutputDigest: result.rawOutputDigest,
      processResourceReceiptDigest: processResourceReceipt.receiptDigest
    }) as OperationDigest
  });
  const diagnosticObjects = await input.runner.publishBoundProcessDiagnostics({
    repositoryRoot: input.repositoryRoot,
    action: plan.action,
    operation,
    processSettlement,
    streams: [{
      stream: 'combined-tail',
      bytes: new TextEncoder().encode(result.failureTail)
    }]
  });
  const diagnosticSettlement = issueProviderSettlementReceipt(operation, {
    requirementId: CI_ACTION_DIAGNOSTIC_REQUIREMENT_ID,
    physicalDisposition: 'settled',
    providerSettlementReferenceDigest: CodexDevelopmentVerificationDigest(
      diagnosticObjects.map(({ receipt, readback }) => ({
        objectDigest: receipt.objectDigest,
        readbackDigest: readback.readbackDigest
      }))
    ) as OperationDigest
  });
  const providerSettlementSet = compileProviderSettlementSet(
    operation,
    [processSettlement, diagnosticSettlement]
  );
  const failureTailDigest = CodexDevelopmentVerificationDigest(result.failureTail);
  const readback = issueNormalDomainReadbackReceipt(operation, providerSettlementSet, {
    readbackContractDigest: CodexDevelopmentVerificationDigest({
      schema: 'sec-ci-action-domain-readback-contract-v1',
      resultSchemaRevision: plan.action.resultSchemaRevision
    }) as OperationDigest,
    readbackReferenceDigest: CodexDevelopmentVerificationDigest({
      schema: 'sec-ci-action-domain-readback-reference-v1',
      actionKey: plan.action.actionKey,
      gateId,
      exitCode: result.code,
      rawOutputDigest: result.rawOutputDigest,
      failureTailDigest
    }) as OperationDigest,
    currentPhysicalEpochDigest: CodexDevelopmentVerificationDigest({
      schema: 'sec-ci-action-physical-epoch-v1',
      actionKey: plan.action.actionKey,
      gateId,
      rawOutputDigest: result.rawOutputDigest
    }) as OperationDigest,
    disposition: 'applied'
  });
  const ownerTerminalJoin = issueNormalOwnerTerminalJoinReceipt(
    operation,
    providerSettlementSet,
    readback,
    {
      ownerTerminalContractDigest: CodexDevelopmentVerificationDigest({
        schema: 'sec-verification-action-terminal-contract-v1',
        resultSchemaRevision: plan.action.resultSchemaRevision
      }) as OperationDigest,
      ownerTerminalReferenceDigest: CodexDevelopmentVerificationDigest({
        schema: 'sec-ci-action-owner-terminal-reference-v1',
        actionKey: plan.action.actionKey,
        gateId,
        exitCode: result.code,
        rawOutputDigest: result.rawOutputDigest,
        failureTailDigest
      }) as OperationDigest
    }
  );
  const actionTerminalReceipt = issueVerificationActionOwnerTerminalReceipt({
    action: plan.action,
    operation,
    providerSettlementSet,
    readback,
    ownerTerminalProjection: ownerTerminalJoin
  });
  return issueProcessVerificationActionTerminalSettlement(actionTerminalReceipt, {
    status: result.code === 0 ? 'passed' : 'failed',
    reasonCode: result.code === 0 ? 'executed-success' : 'executed-failure',
    diagnosticObjects
  });
}

export async function CodexDevelopmentExecuteCiActionClosure(options: {
  readonly repositoryRoot: string;
  readonly actionPlan: CiVerificationActionPlanClosure;
  readonly gates: readonly Readonly<{
    gate: CiVerificationProducerGate;
    env: NodeJS.ProcessEnv;
  }>[];
  readonly headSha: string;
  readonly now: () => Date;
  readonly runGate: (
    step: { id: string; argv: string[]; env: NodeJS.ProcessEnv },
    execution: Readonly<{
      operation: BoundSemanticOperation;
      requirementId: string;
    }>
  ) => Promise<CodexDevelopmentGateProcessSettlement>;
  /** Transported exact result; the host must rejoin the retained live issuer. */
  readonly sourceAction?: TrustedRuntimeSourceProgramActionRecord;
  readonly sessionRevision?: string;
  readonly actionRunner?: VerificationActionRunner;
  readonly readDurableActionResult?: CodexDevelopmentCiVerificationTestOptions['readDurableActionResult'];
}): Promise<CodexDevelopmentCiActionExecution> {
  const actionPlan = parseCiVerificationActionPlanClosure(
    encodeVerificationActionData(options.actionPlan)
  );
  if (options.gates.length !== actionPlan.actions.length) {
    throw new Error('CI Action executor gate/plan cardinality mismatch.');
  }
  const sourceAction = options.sourceAction === undefined ? undefined
    : parseTrustedRuntimeSourceProgramActionRecord(options.sourceAction);
  if (sourceAction !== undefined && (sourceAction.sessionRevision !== options.sessionRevision
      || sourceAction.gate.result.subjectRevision !== options.headSha
      || !actionPlan.actions.some(({ action }) => action.actionKey === sourceAction.gate.action.actionKey))) {
    throw new Error('Source Program Action handoff belongs to another exact Session or Action.');
  }
  const runner = options.actionRunner ?? createVerificationActionRunner();
  const evidence: VerificationGateEvidence<VerificationGateResult>[] = [];
  let failed = false;
  for (let index = 0; index < actionPlan.actions.length; index += 1) {
    const plan = actionPlan.actions[index]!;
    const operation = actionPlan.normalizedOperations[index]!;
    assertCiVerificationCurrentOperation(operation);
    const descriptor = options.gates[index]!;
    const authorizedArgv = ciVerificationNormalizedOperationArgv(operation);
    if (operation.gateId !== plan.action.operation.identity ||
        descriptor.gate.id !== plan.action.operation.identity) {
      throw new Error(`CI Action executor gate ${descriptor.gate.id} does not match Action ${plan.action.operation.identity}.`);
    }
    const descriptorBindings = Object.entries(descriptor.gate.environment)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([name, bindingDigest]) => ({ name, digest: bindingDigest }));
    const operationBindings = operation.environmentBindings.filter(
      ({ name }) => name !== 'SEC_EXECUTION_ENVIRONMENT_REVISION'
    );
    if (descriptor.gate.runtime !== operation.runtime || descriptor.gate.phase !== operation.phase ||
        encodeVerificationActionData(descriptor.gate.argv) !==
          encodeVerificationActionData(authorizedArgv) ||
        encodeVerificationActionData(descriptor.gate.coveredScopeIds) !==
          encodeVerificationActionData(operation.coveredScopeIds) ||
        encodeVerificationActionData(descriptorBindings) !==
          encodeVerificationActionData(operationBindings)) {
      throw new Error(`CI Action executor descriptor for ${operation.gateId} differs from its authorized operation.`);
    }
    if (sourceAction !== undefined && operation.gateId === SOURCE_PROGRAM_TRANSITION_GATE_ID) {
      if (encodeVerificationActionData(sourceAction.gate.action) !== encodeVerificationActionData(plan.action)) {
        throw new Error('Source Program Action handoff differs from the selected Action.');
      }
      // This result has already physically run, even if another independent
      // Action failed. Never mint a replacement journal terminal or rerun it.
      evidence.push(sourceAction.gate);
      continue;
    }
    if (failed) {
      evidence.push({
        action: plan.action,
        result: CodexDevelopmentBuildVerificationGateResult({
          gateId: descriptor.gate.id,
          gateRevision: plan.action.operation.revision,
          owner: 'ci-verification-maintainer',
          requirementKey: `gate:${descriptor.gate.id}`,
          subjectRevision: options.headSha,
          inputDigest: plan.action.actionKey,
          applicability: 'required',
          status: 'not-run',
          disposition: 'not-executed',
          reasonCode: 'fail-fast-prerequisite-failed',
          requiredForClaims: [`gate:${descriptor.gate.id}`],
          supportedClaims: [`gate:${descriptor.gate.id}`],
          environment: null,
          execution: null,
          evidenceRefs: [],
          invalidationRules: ['ActionKey or dependency closure changes'],
          diagnostic: 'A prior Action failed.'
        }),
        cleanup: { status: 'not-required', evidenceRefs: [], diagnostic: null }
      });
      continue;
    }
    let physical: CodexDevelopmentGateProcessSettlement | null = null;
    let gateStarted: Date | null = null;
    let gateFinished: Date | null = null;
    const outcome: VerificationActionRunOutcome = await runner.execute({
      repositoryRoot: options.repositoryRoot,
      action: plan.action,
      plan,
      executionDomain: 'hosted-ci',
      leaseDurationMs: CI_ACTION_EFFECT_LEASE_MS,
      executor: async () => {
        gateStarted = options.now();
        const boundEffect = bindCiActionEffect(
          plan,
          operation,
          Date.now() + CI_ACTION_EFFECT_LEASE_MS
        );
        physical = await options.runGate({
          id: operation.gateId,
          argv: [...authorizedArgv],
          env: descriptor.env
        }, {
          operation: boundEffect,
          requirementId: CI_ACTION_PROCESS_REQUIREMENT_ID
        });
        gateFinished = options.now();
        return await issueCiActionEffectSettlement({
          runner,
          repositoryRoot: options.repositoryRoot,
          operation: boundEffect,
          plan,
          gateId: operation.gateId,
          settlement: physical
        });
      }
    });
    let result: VerificationGateResult;
    if (outcome.physicalExecution) {
      if (physical === null || gateStarted === null || gateFinished === null || outcome.terminal === null) {
        throw new Error(
          `CI Action ${plan.action.actionKey} did not receive an owner-issued process terminal: ${
            outcome.reason ?? 'physical terminal observation unavailable'
          }`
        );
      }
      const processResult = (physical as CodexDevelopmentGateProcessSettlement).result;
      const started = gateStarted as Date;
      const finished = gateFinished as Date;
      result = CodexDevelopmentBuildVerificationGateResult({
        gateId: descriptor.gate.id,
        gateRevision: plan.action.operation.revision,
        owner: 'ci-verification-maintainer',
        requirementKey: `gate:${descriptor.gate.id}`,
        subjectRevision: options.headSha,
        inputDigest: plan.action.actionKey,
        applicability: 'required',
        status: processResult.code === 0 ? 'passed' : 'failed',
        disposition: 'executed',
        reasonCode: processResult.code === 0 ? 'executed-success' : 'executed-failure',
        requiredForClaims: [`gate:${descriptor.gate.id}`],
        supportedClaims: [`gate:${descriptor.gate.id}`],
        environment: {
          runtime: operation.runtime,
          os: process.platform,
          arch: process.arch,
          filesystem: null,
          capabilities: [],
          toolchainRevision: plan.action.environment.toolchainRevision,
          providerRevisions: [plan.action.environment.providerRevision]
        },
        execution: {
          argv: [...authorizedArgv],
          startedAt: started.toISOString(),
          finishedAt: finished.toISOString(),
          durationMs: Math.max(0, finished.getTime() - started.getTime()),
          exitCode: processResult.code,
          outputDigest: processResult.rawOutputDigest,
          failureFingerprint: processResult.code === 0 ? null : processResult.rawOutputDigest
        },
        evidenceRefs: descriptor.gate.id === SOURCE_PROGRAM_TRANSITION_GATE_ID
          ? processResult.stdout === undefined
            ? (() => { throw new Error('Source Program assessment requires exact captured producer stdout.'); })()
            : [`sha256:${createHash('sha256').update(processResult.stdout).digest('hex')}`]
          : [],
        invalidationRules: ['ActionKey, session, scope, review, main health, or trust revision changes'],
        diagnostic: processResult.code === 0
          ? null
          : CodexDevelopmentFailureTail(processResult.failureTail, `${descriptor.gate.id} failed.`)
      });
    } else {
      const durable = options.readDurableActionResult?.(plan.action.actionKey) ?? null;
      if (durable === null || durable.evidenceRefs.length === 0 ||
          durable.result.inputDigest !== plan.action.actionKey ||
          durable.result.subjectRevision !== options.headSha) {
        throw new Error(`CI Action ${plan.action.actionKey} ${outcome.disposition} without independently readable durable Evidence.`);
      }
      result = CodexDevelopmentBuildVerificationGateResult({
        ...durable.result,
        disposition: 'reused',
        execution: null,
        evidenceRefs: [...durable.evidenceRefs]
      });
    }
    evidence.push({
      action: plan.action,
      result,
      cleanup: { status: 'not-required', evidenceRefs: [], diagnostic: null }
    });
    if (result.status !== 'passed') failed = true;
  }
  return Object.freeze({ actionPlan, gates: Object.freeze(evidence), failed });
}
