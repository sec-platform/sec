import { randomUUID } from 'node:crypto';

import {
  assertSecOperationDemandGraph,
  type SecOperationDemandGraph
} from '../../control/operation/demand.ts';
import { canonicalJson, digest } from '../../system-architecture/foundation/runtime/canonical.ts';
import {
  COMPILER_DEPENDENCY_EXECUTION_RETENTION_POLICY,
  ensureCompilerDepsReady,
  observeCompilerDependencyExecutionGenerationAuthority,
  observeCompilerDependencyMaterializationInput,
  projectCompilerDepsReadyState,
  type CompilerDependencyExecutionGenerationAuthority,
  type CompilerDependencyMaterializationInputProjection,
  type CompilerDepsReadyState
} from '../../toolchain/dependencies/runtime.ts';
import type {
  VerificationActionKey,
  VerificationActionKeyInput,
  VerificationActionTerminalSettlement
} from '../../verification/action/contract/action.ts';

export interface DevDependencyBootstrapResult {
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
  SecOperationDemandGraph
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

const DEPENDENCY_BOOTSTRAP_ACTION_REVISION = 'compiler-dependency-materialization-v1' as const;
const DEPENDENCY_BOOTSTRAP_RESULT_REVISION = 'compiler-dependency-ready-state-v1' as const;
const DEPENDENCY_BOOTSTRAP_REQUIREMENT = 'development.compiler-dependency-materialization' as const;
const DEPENDENCY_BOOTSTRAP_JOIN_POLL_MS = 50;

function actionDigest(value: unknown): `sha256:${string}` {
  return `sha256:${digest(JSON.stringify(canonicalJson(value)))}`;
}

function compileDependencyBootstrapActionInput(
  projection: CompilerDependencyMaterializationInputProjection
): VerificationActionKeyInput {
  return Object.freeze({
    actionKind: 'compiler-dependency-materialization',
    producer: Object.freeze({
      identity: 'development.dependency-bootstrap',
      revision: DEPENDENCY_BOOTSTRAP_ACTION_REVISION
    }),
    operation: Object.freeze({
      identity: 'development.compiler-dependency-materialization',
      revision: DEPENDENCY_BOOTSTRAP_ACTION_REVISION,
      semanticDigest: projection.projectionDigest,
      workingDirectory: '.',
      declaredEnvironment: Object.freeze([{
        name: 'compiler-dependency-materialization-input',
        digest: projection.projectionDigest
      }])
    }),
    inputClosure: Object.freeze([{
      path: 'compiler-dependency-materialization-input',
      digest: projection.projectionDigest
    }]),
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
  demandGraph: SecOperationDemandGraph,
  result: MaterializedOperationDependencyBootstrapResult
): MaterializedOperationDependencyBootstrapResult {
  const published = Object.freeze(result);
  materializedOperationDemands.set(published, demandGraph);
  return published;
}

export function reuseOperationDependencies(
  result: OperationDependencyBootstrapResult,
  demandGraph: SecOperationDemandGraph
): OperationDependencyBootstrapResult {
  assertSecOperationDemandGraph(demandGraph);
  const materializedDemand = materializedOperationDemands.get(result);
  if (materializedDemand === undefined) {
    throw new Error('Operation dependency result was not materialized by this process.');
  }
  if (demandGraph.capabilityDemands.some(
    (capability) => !materializedDemand.capabilityDemands.includes(capability)
  )) {
    throw new Error('Operation dependency result does not cover the requested capability closure.');
  }
  return result;
}

async function issueDependencyBootstrapTerminal(
  action: VerificationActionKey,
  projection: CompilerDependencyMaterializationInputProjection,
  ready: CompilerDepsReadyState,
  deadlineAtUnixMs: number
): Promise<VerificationActionTerminalSettlement> {
  const [{
    bindSecSemanticOperation,
    compileSecCapabilityBinding,
    compileSecProviderSettlementSet,
    compileSecSemanticOperationPlan,
    issueSecNormalDomainReadbackReceipt,
    issueSecNormalOwnerTerminalJoinReceipt,
    issueSecProviderSettlementReceipt,
    issueSecSemanticOperationAttemptContext
  }, {
    issueNonProcessVerificationActionTerminalSettlement,
    issueVerificationActionOwnerTerminalReceipt
  }] = await Promise.all([
    import('../../system-architecture/operation/semantic.ts'),
    import('../../verification/action/contract/action.ts')
  ]);
  const contractDigest = actionDigest(DEPENDENCY_BOOTSTRAP_ACTION_REVISION);
  const readyDigest = actionDigest({
    generationDigest: ready.executionGenerationAuthority.generationDigest,
    manifestHash: ready.manifestHash,
    materializationInputDigest: projection.projectionDigest,
    transitionDigest: ready.transitionDigest
  });
  const operationPlan = compileSecSemanticOperationPlan({
    operation: 'development.compiler-dependency-materialization',
    intentDigest: action.actionKey,
    decisionDigest: contractDigest,
    deadlineAtUnixMs,
    aggregateBudgets: [{
      resource: 'duration-ms',
      maximum: COMPILER_DEPENDENCY_EXECUTION_RETENTION_POLICY.maximumDurationMs
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
    attempt: issueSecSemanticOperationAttemptContext({ authorityGrantDigest: contractDigest })
  });
  const operation = bindSecSemanticOperation(operationPlan, [compileSecCapabilityBinding({
    requirementId: DEPENDENCY_BOOTSTRAP_REQUIREMENT,
    contractDigest,
    providerIdentityDigest: contractDigest
  })]);
  const provider = issueSecProviderSettlementReceipt(operation, {
    requirementId: DEPENDENCY_BOOTSTRAP_REQUIREMENT,
    physicalDisposition: 'settled',
    providerSettlementReferenceDigest: readyDigest
  });
  const providerSet = compileSecProviderSettlementSet(operation, [provider]);
  const readback = issueSecNormalDomainReadbackReceipt(operation, providerSet, {
    readbackContractDigest: contractDigest,
    readbackReferenceDigest: readyDigest,
    currentPhysicalEpochDigest: ready.transitionDigest,
    disposition: 'applied'
  });
  const ownerTerminal = issueSecNormalOwnerTerminalJoinReceipt(
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
  await new Promise<void>((resolve, reject) => {
    const complete = () => {
      signal?.removeEventListener('abort', abort);
      resolve();
    };
    const timeout = setTimeout(complete, Math.min(
      DEPENDENCY_BOOTSTRAP_JOIN_POLL_MS,
      Math.max(1, deadlineAtUnixMs - Date.now())
    ));
    function abort(): void {
      clearTimeout(timeout);
      reject(new Error('Dependency bootstrap operation was cancelled.'));
    }
    signal?.addEventListener('abort', abort, { once: true });
  });
}

async function materializeCompilerDependenciesSingleFlight(
  options: OperationDependencyBootstrapOptions
): Promise<CompilerDepsReadyState> {
  const repositoryRoot = options.repositoryRoot ?? process.cwd();
  const deadlineAtUnixMs = options.deadlineAtUnixMs
    ?? Date.now() + COMPILER_DEPENDENCY_EXECUTION_RETENTION_POLICY.maximumDurationMs;
  assertDependencyBootstrapLive(deadlineAtUnixMs, options.signal);
  const [{ createVerificationActionKey, createVerificationActionPlan }, {
    VerificationActionRunner
  }] = await Promise.all([
    import('../../verification/action/contract/action.ts'),
    import('../../verification/action/runner.ts')
  ]);
  const materializationInput = await observeCompilerDependencyMaterializationInput(repositoryRoot);
  const action = createVerificationActionKey(
    compileDependencyBootstrapActionInput(materializationInput)
  );
  const plan = createVerificationActionPlan({
    action,
    executionClass: 'cheap-preflight',
    dependencies: []
  });
  const ensure = options.ensureCompilerDeps ?? (() => ensureCanonicalCompilerDependencies(
    options,
    repositoryRoot
  ));
  const readback = options.ensureCompilerDeps !== undefined
    ? async () => {
      const ready = await options.ensureCompilerDeps!();
      return ready.source === 'existing' ? ready : null;
    }
    : async () => {
    const observed = await observeCompilerDependencyExecutionGenerationAuthority(
      { deadlineAtUnixMs, signal: options.signal },
      repositoryRoot
    );
    if (observed === null) return null;
    return projectCompilerDepsReadyState(observed);
    };
  const runner = new VerificationActionRunner();
  try {
    while (true) {
      assertDependencyBootstrapLive(deadlineAtUnixMs, options.signal);
      let ownedReady: CompilerDepsReadyState | null = null;
      const outcome = await runner.execute({
        repositoryRoot,
        action,
        plan,
        executionDomain: 'compiler-dependency-materialization',
        ownerToken: `dependency-bootstrap:${process.pid}:${randomUUID()}`,
        leaseDurationMs: COMPILER_DEPENDENCY_EXECUTION_RETENTION_POLICY.maximumDurationMs,
        executor: async ({ action: ownedAction }) => {
          const ready = await ensure();
          const currentInput = await observeCompilerDependencyMaterializationInput(repositoryRoot);
          if (currentInput.projectionDigest !== materializationInput.projectionDigest) {
            throw new Error('Dependency bootstrap inputs changed during materialization.');
          }
          ownedReady = ready;
          return issueDependencyBootstrapTerminal(
            ownedAction,
            currentInput,
            ready,
            deadlineAtUnixMs
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
          throw new Error('Dependency bootstrap terminal has no current dependency generation readback.');
        }
        return current;
      }
      if (outcome.disposition !== 'joined' || outcome.state !== 'running') {
        throw new Error(`Dependency bootstrap Action blocked: ${outcome.reason ?? 'unknown reason'}`);
      }
      await waitForDependencyBootstrapJoin(deadlineAtUnixMs, options.signal);
    }
  } finally {
    await runner.close();
  }
}

function ensureCanonicalCompilerDependencies(
  options: Pick<OperationDependencyBootstrapOptions, 'deadlineAtUnixMs' | 'signal'>,
  repositoryRoot = process.cwd()
): Promise<CompilerDepsReadyState> {
  if (options.deadlineAtUnixMs !== undefined && (!Number.isSafeInteger(options.deadlineAtUnixMs)
      || options.deadlineAtUnixMs <= Date.now())) {
    throw new Error('Dependency bootstrap operation deadline is exhausted.');
  }
  if (options.signal?.aborted === true) {
    throw new Error('Dependency bootstrap operation was cancelled.');
  }
  return ensureCompilerDepsReady({
    deadlineAtUnixMs: options.deadlineAtUnixMs,
    signal: options.signal
  }, repositoryRoot);
}

/**
 * Materializes exactly the capability closure compiled by the canonical
 * operation-demand graph. There is intentionally no test-specific convenience
 * entrypoint: an ambient caller cannot select a dependency effect by function
 * name, installed package, cache presence or environment state.
 */
export async function ensureOperationDependencies(
  demandGraph: SecOperationDemandGraph,
  options: OperationDependencyBootstrapOptions = {}
): Promise<MaterializedOperationDependencyBootstrapResult> {
  assertSecOperationDemandGraph(demandGraph);
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
