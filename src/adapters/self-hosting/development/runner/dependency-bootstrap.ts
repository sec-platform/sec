import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { canonicalJson, rawSha256Hex } from '../../../../contracts/canonical.ts';
import type {
  VerificationActionKey,
  VerificationActionKeyDigest,
  VerificationActionKeyInput,
  VerificationActionTerminalSettlement
} from '../../../verification/platform/action/contract/action.ts';
import {
  assertOperationDemandGraph,
  type OperationDemandGraph
} from '../../control/operation/demand.ts';

type CompilerDependencyExecutionGenerationAuthority = Readonly<{
  generationDigest: `sha256:${string}`;
}>;

type CompilerDependencyMaterializationInputProjection = Readonly<{
  manifestHash: `sha256:${string}`;
  projectionDigest: `sha256:${string}`;
}>;

type CompilerDepsReadyState = Readonly<{
  executionGenerationAuthority: CompilerDependencyExecutionGenerationAuthority;
  manifestHash: string;
  nodeModulesPath: string;
  requiresFreshProcess: boolean;
  root: string;
  source: 'existing' | 'installed';
  transitionDigest: `sha256:${string}`;
}>;

interface DevDependencyBootstrapResult {
  readonly manifestHash: string;
  readonly nodeModulesPath: string;
  readonly source: 'existing' | 'installed';
}

export interface DependencyTransitionBootstrapResult extends DevDependencyBootstrapResult {
  readonly executionGenerationAuthority: CompilerDependencyExecutionGenerationAuthority;
  readonly requiresFreshProcess: boolean;
  readonly transitionDigest: `sha256:${string}`;
}

export interface OperationDependencyBootstrapResult extends DependencyTransitionBootstrapResult {}

export interface MaterializedOperationDependencyBootstrapResult
  extends OperationDependencyBootstrapResult, DependencyTransitionBootstrapResult {}

const materializedOperationDemands = new WeakMap<
  OperationDependencyBootstrapResult,
  OperationDemandGraph
>();

interface CompilerDependencyBootstrapOptions {
  readonly ensureCompilerDeps?: () => Promise<CompilerDepsReadyState>;
}

interface OperationDependencyBootstrapOptions extends CompilerDependencyBootstrapOptions {
  readonly deadlineAtUnixMs?: number;
  readonly ensureHooks?: (repoRoot: string) => Promise<void>;
  readonly repositoryRoot?: string;
  readonly signal?: AbortSignal;
}

const DEPENDENCY_BOOTSTRAP_REQUIREMENT = 'development.compiler-dependency-materialization' as const;
const DEPENDENCY_BOOTSTRAP_JOIN_POLL_MS = 50;

function actionDigest(value: unknown): `sha256:${string}` {
  return `sha256:${rawSha256Hex(JSON.stringify(canonicalJson(value)))}`;
}

const DEPENDENCY_BOOTSTRAP_SEMANTIC_CONTRACT = Object.freeze({
  operation: 'development.compiler-dependency-materialization',
  authority: 'compiler-dependency-runtime-owner',
  input: 'manifest-and-runtime-executable-identity',
  settlement: 'verification-action-machine-global-owner-terminal-readback',
  recovery: 'current-readback-invalidation-with-successor-action-lineage',
  output: 'compiler-dependency-ready-state-with-execution-generation-authority'
});
const DEPENDENCY_BOOTSTRAP_ACTION_REVISION = actionDigest(
  DEPENDENCY_BOOTSTRAP_SEMANTIC_CONTRACT
);
const DEPENDENCY_BOOTSTRAP_RESULT_REVISION = actionDigest(Object.freeze({
  producerContractRevision: DEPENDENCY_BOOTSTRAP_ACTION_REVISION,
  result: DEPENDENCY_BOOTSTRAP_SEMANTIC_CONTRACT.output
}));

function compileDependencyBootstrapActionInput(
  projection: CompilerDependencyMaterializationInputProjection,
  recoveryPredecessorActionKeys: readonly VerificationActionKeyDigest[] = []
): VerificationActionKeyInput {
  const recoveryLineage = recoveryPredecessorActionKeys.length === 0
    ? null
    : actionDigest(Object.freeze([...recoveryPredecessorActionKeys]));
  return Object.freeze({
    actionKind: 'compiler-dependency-materialization',
    producer: Object.freeze({
      identity: 'development.dependency-bootstrap',
      revision: DEPENDENCY_BOOTSTRAP_ACTION_REVISION
    }),
    operation: Object.freeze({
      identity: 'development.compiler-dependency-materialization',
      revision: DEPENDENCY_BOOTSTRAP_ACTION_REVISION,
      semanticDigest: recoveryLineage === null
        ? projection.projectionDigest
        : actionDigest(Object.freeze({
            materializationInput: projection.projectionDigest,
            recoveryLineage
          })),
      workingDirectory: '.',
      declaredEnvironment: Object.freeze([
        {
          name: 'compiler-dependency-materialization-input',
          digest: projection.projectionDigest
        },
        ...(recoveryLineage === null ? [] : [{
          name: 'compiler-dependency-recovery-lineage',
          digest: recoveryLineage
        }])
      ])
    }),
    inputClosure: Object.freeze([
      {
        path: 'compiler-dependency-materialization-input',
        digest: projection.projectionDigest
      },
      ...(recoveryLineage === null ? [] : [{
        path: 'compiler-dependency-recovery-lineage',
        digest: recoveryLineage
      }])
    ]),
    environment: Object.freeze({
      toolchainRevision: projection.manifestHash,
      providerRevision: DEPENDENCY_BOOTSTRAP_ACTION_REVISION,
      contractRevision: DEPENDENCY_BOOTSTRAP_ACTION_REVISION
    }),
    requiredCheapPreflightActionKeys: Object.freeze([]),
    upstreamActionKeys: Object.freeze([]),
    resultSchemaRevision: DEPENDENCY_BOOTSTRAP_RESULT_REVISION
  });
}

async function ensureManagedHooks(repoRoot: string): Promise<void> {
  if (process.env.CI === 'true' || process.env.CI === '1') return;
  // Hook installation is downstream of compiler dependency readiness. Keeping
  // this import inside the demanded branch prevents the bootstrap entrypoint
  // from loading Git/provider packages before it has materialized them.
  const { installGitHooks } = await import('../hooks/install.ts');
  const result = await installGitHooks({ repoRoot, lifecycle: true });
  if (result.status === 'conflict') console.warn(result.message);
}

function dependencyBootstrapResult(ready: CompilerDepsReadyState): DependencyTransitionBootstrapResult {
  return {
    executionGenerationAuthority: ready.executionGenerationAuthority,
    manifestHash: ready.manifestHash,
    nodeModulesPath: ready.nodeModulesPath,
    requiresFreshProcess: ready.requiresFreshProcess,
    source: ready.source,
    transitionDigest: ready.transitionDigest
  };
}

export const DEV_RUNNER_FRESH_PROCESS_TRANSITION_ENV =
  'SEC_DEV_RUNNER_FRESH_PROCESS_TRANSITION_V1' as const;

export type DependencyFreshProcessHandoff = Readonly<{
  schema: 'sec-dependency-fresh-process-handoff-v1';
  transitionDigest: `sha256:${string}`;
}>;

/**
 * A dependency locator/generation transition invalidates module resolution in
 * the process that observed the old filesystem epoch. The exact transition
 * may hand off once; a child that observes another transition fails closed
 * instead of recursively spawning.
 */
export function createDependencyFreshProcessHandoff(
  result: DependencyTransitionBootstrapResult,
  environment: Readonly<Record<string, string | undefined>> = process.env
): DependencyFreshProcessHandoff | null {
  if (!/^sha256:[0-9a-f]{64}$/u.test(result.transitionDigest)) {
    throw new Error('Dependency bootstrap transition digest is invalid.');
  }
  if (!result.requiresFreshProcess) return null;
  const predecessor = environment[DEV_RUNNER_FRESH_PROCESS_TRANSITION_ENV];
  if (predecessor !== undefined) {
    throw new Error(
      predecessor === result.transitionDigest
        ? 'Dependency bootstrap repeated the same fresh-process transition.'
        : 'Dependency bootstrap attempted more than one fresh-process transition.'
    );
  }
  return Object.freeze({
    schema: 'sec-dependency-fresh-process-handoff-v1' as const,
    transitionDigest: result.transitionDigest
  });
}

function publishOperationDependencyResult(
  demandGraph: OperationDemandGraph,
  result: MaterializedOperationDependencyBootstrapResult
): MaterializedOperationDependencyBootstrapResult {
  const published = Object.freeze(result);
  materializedOperationDemands.set(published, demandGraph);
  return published;
}

export function reuseOperationDependencies(
  result: OperationDependencyBootstrapResult,
  demandGraph: OperationDemandGraph
): MaterializedOperationDependencyBootstrapResult {
  assertOperationDemandGraph(demandGraph);
  assertMaterializedOperationDependencyBootstrapResult(result);
  const materializedDemand = materializedOperationDemands.get(result);
  if (materializedDemand === undefined) throw new Error('Unreachable dependency provenance state.');
  if (demandGraph.capabilityDemands.some(
    (capability) => !materializedDemand.capabilityDemands.includes(capability)
  )) {
    throw new Error('Operation dependency result does not cover the requested capability closure.');
  }
  return result;
}

export function assertMaterializedOperationDependencyBootstrapResult(
  result: OperationDependencyBootstrapResult
): void {
  if (!materializedOperationDemands.has(result)) {
    throw new Error('Operation dependency result was not materialized by this process.');
  }
}

async function issueDependencyBootstrapTerminal(
  action: VerificationActionKey,
  projection: CompilerDependencyMaterializationInputProjection,
  ready: CompilerDepsReadyState,
  deadlineAtUnixMs: number,
  maximumDurationMs: number
): Promise<VerificationActionTerminalSettlement> {
  const [{
    bindSemanticOperation,
    compileCapabilityBinding,
    compileProviderSettlementSet,
    compileSemanticOperationPlan,
    issueNormalDomainReadbackReceipt,
    issueNormalOwnerTerminalJoinReceipt,
    issueProviderSettlementReceipt,
    issueSemanticOperationAttemptContext
  }, {
    issueNonProcessVerificationActionTerminalSettlement,
    issueVerificationActionOwnerTerminalReceipt
  }] = await Promise.all([
    import('../../../../execution/operation/semantic.ts'),
    import('../../../verification/platform/action/contract/action.ts')
  ]);
  const contractDigest = actionDigest(DEPENDENCY_BOOTSTRAP_ACTION_REVISION);
  const readyDigest = actionDigest({
    generationDigest: ready.executionGenerationAuthority.generationDigest,
    manifestHash: ready.manifestHash,
    materializationInputDigest: projection.projectionDigest,
    transitionDigest: ready.transitionDigest
  });
  const operationPlan = compileSemanticOperationPlan({
    operation: 'development.compiler-dependency-materialization',
    intentDigest: action.actionKey,
    decisionDigest: contractDigest,
    deadlineAtUnixMs,
    aggregateBudgets: [{
      resource: 'duration-ms',
      maximum: maximumDurationMs
    }],
    requirements: [{
      id: DEPENDENCY_BOOTSTRAP_REQUIREMENT,
      contractDigest,
      effectKinds: ['filesystem', 'process', 'provider'],
      failureKinds: [
        'filesystem.cleanup-failed',
        'filesystem.identity-drift',
        'filesystem.materialization-failed',
        'provider.cancelled',
        'provider.deadline-exhausted',
        'provider.drift',
        'provider.unavailable',
        'provider.unverified'
      ]
    }],
    attempt: issueSemanticOperationAttemptContext({ authorityGrantDigest: contractDigest })
  });
  const operation = bindSemanticOperation(operationPlan, [compileCapabilityBinding({
    requirementId: DEPENDENCY_BOOTSTRAP_REQUIREMENT,
    contractDigest,
    providerIdentityDigest: contractDigest
  })]);
  const provider = issueProviderSettlementReceipt(operation, {
    requirementId: DEPENDENCY_BOOTSTRAP_REQUIREMENT,
    physicalDisposition: 'settled',
    providerSettlementReferenceDigest: readyDigest
  });
  const providerSet = compileProviderSettlementSet(operation, [provider]);
  const readback = issueNormalDomainReadbackReceipt(operation, providerSet, {
    readbackContractDigest: contractDigest,
    readbackReferenceDigest: readyDigest,
    currentPhysicalEpochDigest: ready.transitionDigest,
    disposition: 'applied'
  });
  const ownerTerminal = issueNormalOwnerTerminalJoinReceipt(
    operation,
    providerSet,
    readback,
    {
      ownerTerminalContractDigest: contractDigest,
      ownerTerminalReferenceDigest: readyDigest
    }
  );
  const receipt = issueVerificationActionOwnerTerminalReceipt({
    action,
    operation,
    providerSettlementSet: providerSet,
    readback,
    ownerTerminalProjection: ownerTerminal
  });
  return issueNonProcessVerificationActionTerminalSettlement(receipt, {
    status: 'passed',
    reasonCode: 'executed-success'
  });
}

function assertDependencyBootstrapLive(
  deadlineAtUnixMs: number,
  signal: AbortSignal | undefined
): void {
  if (signal?.aborted === true) throw new Error('Dependency bootstrap operation was cancelled.');
  if (Date.now() >= deadlineAtUnixMs) throw new Error('Dependency bootstrap operation deadline is exhausted.');
}

async function waitForDependencyBootstrapJoin(
  deadlineAtUnixMs: number,
  signal: AbortSignal | undefined
): Promise<void> {
  assertDependencyBootstrapLive(deadlineAtUnixMs, signal);
  try {
    await delay(Math.min(
      DEPENDENCY_BOOTSTRAP_JOIN_POLL_MS,
      Math.max(1, deadlineAtUnixMs - Date.now())
    ), undefined, { signal });
  } catch (error) {
    if (signal?.aborted === true) throw new Error('Dependency bootstrap operation was cancelled.');
    throw error;
  }
}

async function materializeCompilerDependenciesSingleFlight(
  options: OperationDependencyBootstrapOptions
): Promise<CompilerDepsReadyState> {
  const dependencyRuntime = await import('../../../toolchain/dependencies/runtime.ts');
  const maximumDurationMs =
    dependencyRuntime.COMPILER_DEPENDENCY_EXECUTION_RETENTION_POLICY.maximumDurationMs;
  const repositoryRoot = options.repositoryRoot ?? process.cwd();
  const deadlineAtUnixMs = options.deadlineAtUnixMs
    ?? Date.now() + maximumDurationMs;
  assertDependencyBootstrapLive(deadlineAtUnixMs, options.signal);
  const [{ createVerificationActionKey, createVerificationActionPlan }, {
    VerificationActionRunner
  }] = await Promise.all([
    import('../../../verification/platform/action/contract/action.ts'),
    import('../../../verification/platform/action/runner.ts')
  ]);
  const materializationInput = await dependencyRuntime
    .observeCompilerDependencyMaterializationInput(repositoryRoot);
  const ensure = options.ensureCompilerDeps ?? (() => dependencyRuntime.ensureCompilerDepsReady({
    deadlineAtUnixMs: options.deadlineAtUnixMs,
    signal: options.signal
  }, repositoryRoot));
  const readback = options.ensureCompilerDeps !== undefined
    ? async () => {
      const ready = await options.ensureCompilerDeps!();
      return ready.source === 'existing' ? ready : null;
    }
    : async () => {
    const observed = await dependencyRuntime.observeCompilerDependencyExecutionGenerationAuthority(
      { deadlineAtUnixMs, signal: options.signal },
      repositoryRoot
    );
    if (observed === null) return null;
    return dependencyRuntime.projectCompilerDepsReadyState(observed);
    };
  const runner = new VerificationActionRunner();
  const recoveryPredecessorActionKeys: VerificationActionKeyDigest[] = [];
  try {
    while (true) {
      assertDependencyBootstrapLive(deadlineAtUnixMs, options.signal);
      const action = createVerificationActionKey(
        compileDependencyBootstrapActionInput(
          materializationInput,
          recoveryPredecessorActionKeys
        )
      );
      const plan = createVerificationActionPlan({
        action,
        executionClass: 'cheap-preflight',
        dependencies: []
      });
      let ownedReady: CompilerDepsReadyState | null = null;
      const outcome = await runner.execute({
        repositoryRoot,
        action,
        plan,
        executionDomain: 'compiler-dependency-materialization',
        ownerToken: `dependency-bootstrap:${process.pid}:${randomUUID()}`,
        leaseDurationMs: maximumDurationMs,
        executor: async ({ action: ownedAction }) => {
          const ready = await ensure();
          const currentInput = await dependencyRuntime
            .observeCompilerDependencyMaterializationInput(repositoryRoot);
          if (currentInput.projectionDigest !== materializationInput.projectionDigest) {
            throw new Error('Dependency bootstrap inputs changed during materialization.');
          }
          ownedReady = ready;
          return issueDependencyBootstrapTerminal(
            ownedAction,
            currentInput,
            ready,
            deadlineAtUnixMs,
            maximumDurationMs
          );
        }
      });
      if (outcome.terminal !== null) {
        if (outcome.terminal.status !== 'passed') {
          throw new Error('Dependency bootstrap reused a known failed terminal.');
        }
        if (ownedReady !== null) return ownedReady;
        const current = await readback();
        if (current === null) {
          if (recoveryPredecessorActionKeys.includes(action.actionKey)) {
            throw new Error('Dependency bootstrap recovery repeated an unavailable generation Action.');
          }
          runner.invalidate(repositoryRoot, action,
            'Dependency bootstrap terminal has no compatible current generation readback.');
          recoveryPredecessorActionKeys.push(action.actionKey);
          continue;
        }
        return current;
      }
      if (outcome.disposition !== 'joined' || outcome.state !== 'running') {
        const recoverableCancellation = outcome.disposition === 'blocked'
          && outcome.reason !== null
          && (
            /^abandoned (?:queued|running) Action was durably cancelled; a new Action identity is required$/u
              .test(outcome.reason)
            || outcome.reason.startsWith('action is already cancelled;')
          );
        const recoverableInvalidation = outcome.disposition === 'blocked'
          && outcome.state === 'invalidated';
        if ((recoverableCancellation || recoverableInvalidation)
            && !recoveryPredecessorActionKeys.includes(action.actionKey)) {
          recoveryPredecessorActionKeys.push(action.actionKey);
          continue;
        }
        throw new Error(`Dependency bootstrap Action blocked: ${outcome.reason ?? 'unknown reason'}`);
      }
      await waitForDependencyBootstrapJoin(deadlineAtUnixMs, options.signal);
    }
  } finally {
    await runner.close();
  }
}

/**
 * Materializes exactly the capability closure compiled by the canonical
 * operation-demand graph. There is intentionally no test-specific convenience
 * entrypoint: an ambient caller cannot select a dependency effect by function
 * name, installed package, cache presence or environment state.
 */
export async function ensureOperationDependencies(
  demandGraph: OperationDemandGraph,
  options: OperationDependencyBootstrapOptions = {}
): Promise<MaterializedOperationDependencyBootstrapResult> {
  assertOperationDemandGraph(demandGraph);
  if (!demandGraph.capabilityDemands.includes('compiler-dependency-tree')) {
    throw new Error('Dependency bootstrap requires an operation demand for compiler-dependency-tree.');
  }
  const ready = await materializeCompilerDependenciesSingleFlight(options);
  if (demandGraph.capabilityDemands.includes('managed-git-hooks')) {
    if (demandGraph.input.operation !== 'dependency-setup') {
      throw new Error('Managed Git hook demand must originate from dependency-setup.');
    }
    if (demandGraph.input.hookPolicy !== 'if-installed' || ready.source === 'installed') {
      await (options.ensureHooks ?? ensureManagedHooks)(ready.root);
    }
  }
  return publishOperationDependencyResult(demandGraph, {
    ...dependencyBootstrapResult(ready)
  });
}
