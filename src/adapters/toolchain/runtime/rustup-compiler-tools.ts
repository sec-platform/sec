import path from 'node:path';
import { rawSha256, sha256 } from '../../../contracts/canonical.ts';
import { CodedFailure } from '../../../contracts/failure.ts';
import { isCanonicalPortableLogicalPath } from '../../../contracts/logical-path.ts';
import { throwIfNativeAborted } from '../../../contracts/native-abort.ts';
import { issueOperationRequirementBindingContext } from '../../../execution/operation/requirement-binding-context.ts';
import {
  bindSemanticOperation, compileCapabilityBinding, compileSemanticOperationPlan,
  issueSemanticOperationAttemptContext, type OperationDigest
} from '../../../execution/operation/semantic.ts';
import { settleResources } from '../../../execution/resource-settlement.ts';
import {
  inspectNoFollowDirectoryChain, retainNoFollowDirectoryForChildProcess, retainNoFollowOrdinaryFile,
  type RetainedNoFollowChildProcessDirectory, type RetainedNoFollowOrdinaryFile
} from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  assertProcessResourceRunResult, assertProcessResourceSessionReceipt, openProcessResourceSession,
  type ProcessResourceRunResult, type ProcessResourceSession
} from '../../runtime-state/physical/runtime/process-resource-session.ts';
import {
  issueRetainedCommandBoundary, resolveExecutableLocator,
  RETAINED_EXECUTABLE_CHILD_DESCRIPTOR, RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
  RetainedCommandTransportError
} from '../../runtime-state/physical/runtime/process.ts';
import { decodeExactUtf8 } from '../../runtime-state/physical/runtime/retained-file-read.ts';

const MAXIMUM_DURATION_MS = 5 * 60_000;
const MAXIMUM_STREAM_BYTES = 64 * 1024;
const REQUIREMENT = 'toolchain.rustup.compiler-tools.select';
const COMMANDS = Object.freeze([Object.freeze(['which', 'cargo']), Object.freeze(['which', 'rustc'])]);
const CONTRACT_DIGEST = sha256({ domain: REQUIREMENT, commands: COMMANDS,
  maximumDurationMs: MAXIMUM_DURATION_MS, managedRoots: 2, nativeResources: 4,
  inputBytes: 1, stdoutBytesPerCommand: MAXIMUM_STREAM_BYTES, stderrBytesPerCommand: MAXIMUM_STREAM_BYTES
}) as OperationDigest;
const toolsBrand: unique symbol = Symbol('retained-rustup-compiler-tools');

export interface RetainedRustupCompilerTools {
  readonly [toolsBrand]: never;
  readonly cargo: RetainedNoFollowOrdinaryFile;
  readonly rustc: RetainedNoFollowOrdinaryFile;
  readonly identityDigest: `sha256:${string}`;
  assertCurrent(): void;
  retire(): void;
}

const issuedTools = new WeakMap<object, { retired: boolean; retirementFailure: unknown }>();
const issuedPendingErrors = new WeakSet<object>();
type PendingResources = Readonly<{
  selector: RetainedNoFollowOrdinaryFile;
  cwd: RetainedNoFollowChildProcessDirectory;
  tools: readonly RetainedNoFollowOrdinaryFile[];
  session: ProcessResourceSession;
}>;

class RustupCompilerToolsPendingError extends Error {
  readonly code = 'RUSTUP-COMPILER-TOOLS-PENDING';
  readonly #resources: PendingResources;
  constructor(cause: unknown, resources: PendingResources) {
    super('Rustup selection process-tree settlement is unproven; retained capabilities remain live.', { cause });
    this.name = 'RustupCompilerToolsPendingError';
    this.#resources = resources;
  }
  override toString(): string {
    return `${this.name}: ${this.message} (${this.#resources.tools.length} selected tools retained)`;
  }
}

/** Only this process's original pending error, never code/message/DTO inference. */
export function rustupCompilerToolFailureHasPendingResources(error: unknown): boolean {
  return typeof error === 'object' && error !== null && issuedPendingErrors.has(error);
}

export function assertRetainedRustupCompilerTools(value: unknown): asserts value is RetainedRustupCompilerTools {
  const state = typeof value === 'object' && value !== null ? issuedTools.get(value) : undefined;
  if (state === undefined || state.retired || state.retirementFailure !== undefined) {
    throw new CodedFailure('RUSTUP-COMPILER-TOOLS-INVALID', 'A live original-issued Rustup compiler tool generation is required.');
  }
}

/** The fixed which protocol is one canonical absolute file path, not a shell command. */
export function parseRustupCompilerToolPath(stdout: Uint8Array): string {
  if (!(stdout instanceof Uint8Array) || stdout.byteLength === 0 || stdout.byteLength > MAXIMUM_STREAM_BYTES) {
    throw new CodedFailure('RUSTUP-COMPILER-TOOLS-OUTPUT', 'Rustup which output is empty or exceeds its bounded protocol.');
  }
  const text = decodeExactUtf8(stdout, 'Rustup which output');
  const value = text.endsWith('\r\n') ? text.slice(0, -2) : text.endsWith('\n') ? text.slice(0, -1) : text;
  const parsed = path.parse(value);
  if (/[\u0000-\u001f\u007f]/u.test(value) || value.trim() !== value || !path.isAbsolute(value)
      || path.normalize(value) !== value || value === parsed.root
      || !isCanonicalPortableLogicalPath(value.slice(parsed.root.length).replaceAll('\\', '/'))) {
    throw new CodedFailure('RUSTUP-COMPILER-TOOLS-OUTPUT', 'Rustup which must return one safe canonical absolute executable path.');
  }
  return value;
}

function selectionEnvironment(input: NodeJS.ProcessEnv): Readonly<NodeJS.ProcessEnv> {
  const result: NodeJS.ProcessEnv = {};
  const names = new Set<string>();
  for (const [name, value] of Object.entries(input)) {
    if (name.toLowerCase() === 'rustup_auto_install') continue;
    if (value === undefined) continue;
    const key = process.platform === 'win32' ? name.toLowerCase() : name;
    if (names.has(key) || name.includes('\0') || name.includes('=') || value.includes('\0')) {
      throw new CodedFailure('RUSTUP-COMPILER-TOOLS-ENVIRONMENT', 'Rustup selection environment is ambiguous or unsafe.');
    }
    names.add(key);
    result[name] = value;
  }
  result.RUSTUP_AUTO_INSTALL = '0';
  return Object.freeze(result);
}

export async function retainRustupCompilerTools(input: Readonly<{
  repositoryRoot: string;
  environment: NodeJS.ProcessEnv;
  deadlineAtUnixMs: number;
  signal?: AbortSignal;
}>): Promise<RetainedRustupCompilerTools> {
  if (!path.isAbsolute(input.repositoryRoot) || path.resolve(input.repositoryRoot) !== input.repositoryRoot
      || !Number.isSafeInteger(input.deadlineAtUnixMs) || input.deadlineAtUnixMs <= Date.now()) {
    throw new CodedFailure('RUSTUP-COMPILER-TOOLS-INPUT', 'Rustup selection requires a canonical repository root and live absolute deadline.');
  }
  throwIfNativeAborted(input.signal);
  const environment = selectionEnvironment(input.environment);
  const pathValue = Object.entries(environment).find(([name]) => process.platform === 'win32'
    ? name.toLowerCase() === 'path' : name === 'PATH')?.[1] ?? '';
  const locator = resolveExecutableLocator('rustup', { cwd: input.repositoryRoot, pathValue });
  if (locator === null) throw new CodedFailure('RUSTUP-COMPILER-TOOLS-UNAVAILABLE', 'Installed Rustup is unavailable; no installation was attempted.');
  const deadlineAtUnixMs = Math.min(input.deadlineAtUnixMs, Date.now() + MAXIMUM_DURATION_MS);
  const deadlineAtMonotonicMs = performance.now() + Math.max(0, deadlineAtUnixMs - Date.now());
  const assertSelectionCurrent = (): void => {
    throwIfNativeAborted(input.signal);
    if (performance.now() >= deadlineAtMonotonicMs || Date.now() >= deadlineAtUnixMs) {
      throw new CodedFailure('RUSTUP-COMPILER-TOOLS-DEADLINE', 'Rustup selection absolute deadline is exhausted.');
    }
  };
  let selector: RetainedNoFollowOrdinaryFile | undefined;
  let cwd: RetainedNoFollowChildProcessDirectory | undefined;
  let session: ProcessResourceSession | undefined;
  const selected: RetainedNoFollowOrdinaryFile[] = [];
  const records: { run: ProcessResourceRunResult; args: readonly string[] }[] = [];
  let treeClosed = true;
  let failure: Readonly<{ label: string; error: unknown }> | undefined;
  let boundary: ReturnType<typeof issueRetainedCommandBoundary> | undefined;
  let identityDigest: `sha256:${string}` | undefined;
  try {
    assertSelectionCurrent();
    selector = retainNoFollowOrdinaryFile(inspectNoFollowDirectoryChain(path.dirname(locator), 'Rustup selector parent'),
      path.basename(locator), undefined, 'Rustup selector', RETAINED_EXECUTABLE_CHILD_DESCRIPTOR, 'executable');
    const root = inspectNoFollowDirectoryChain(input.repositoryRoot, 'Rustup selection repository');
    cwd = retainNoFollowDirectoryForChildProcess(root, RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR, 'Rustup selection repository');
    boundary = issueRetainedCommandBoundary({ executable: selector, workingDirectory: cwd });
    const selectorIdentity = { path: selector.path, physical: selector.physical, digest: selector.digest() };
    const providerIdentityDigest = sha256({ domain: REQUIREMENT, selector: selectorIdentity, root }) as OperationDigest;
    const plan = compileSemanticOperationPlan({
      operation: REQUIREMENT,
      intentDigest: sha256({ commands: COMMANDS, selector: selectorIdentity, root, environment }) as OperationDigest,
      decisionDigest: CONTRACT_DIGEST, deadlineAtUnixMs,
      attempt: issueSemanticOperationAttemptContext({ authorityGrantDigest: CONTRACT_DIGEST }),
      aggregateBudgets: [
        { resource: 'duration-ms', maximum: MAXIMUM_DURATION_MS },
        { resource: 'input-bytes', maximum: 1 },
        { resource: 'output-bytes', maximum: 4 * MAXIMUM_STREAM_BYTES },
        { resource: 'processes', maximum: 4 }
      ],
      requirements: [{ id: REQUIREMENT, contractDigest: CONTRACT_DIGEST, effectKinds: ['process'],
        failureKinds: ['process.cancelled', 'process.deadline-exhausted', 'process.identity-drift',
          'process.output-budget-exhausted', 'process.settlement-unproven', 'process.unavailable'] }]
    });
    const operation = bindSemanticOperation(plan, [compileCapabilityBinding({
      requirementId: REQUIREMENT, contractDigest: CONTRACT_DIGEST, providerIdentityDigest
    })]);
    session = openProcessResourceSession({ operation,
      requirementBindingContext: issueOperationRequirementBindingContext({ operation, requirementId: REQUIREMENT,
        resourceCeilings: operation.plan.execution.aggregateBudgets }), signal: input.signal });
    for (const args of COMMANDS) {
      assertSelectionCurrent();
      const beforeProcessCount = session.processCount;
      treeClosed = false;
      let run: ProcessResourceRunResult;
      try {
        run = await session.run(boundary, args, { env: environment, envMode: 'replace',
          maxStdoutBytes: MAXIMUM_STREAM_BYTES, maxStderrBytes: MAXIMUM_STREAM_BYTES,
          beforeSpawn: async () => { assertSelectionCurrent(); selector!.assertCurrent(); cwd!.assertCurrent(); } });
        treeClosed = true;
      } catch (error) {
        treeClosed = session.processCount === beforeProcessCount
          || error instanceof RetainedCommandTransportError && error.outcome.termination.treeClosed;
        throw error;
      }
      records.push({ run, args });
      if (run.result.code !== 0) throw new CodedFailure('RUSTUP-COMPILER-TOOLS-UNAVAILABLE', `Rustup ${args.join(' ')} failed with exit ${run.result.code}.`);
      const executablePath = parseRustupCompilerToolPath(run.result.stdout);
      selected.push(retainNoFollowOrdinaryFile(inspectNoFollowDirectoryChain(path.dirname(executablePath), 'Selected Rust compiler tool parent'),
        path.basename(executablePath), undefined, `Selected Rust ${args[1]}`, RETAINED_EXECUTABLE_CHILD_DESCRIPTOR, 'executable'));
      assertSelectionCurrent();
    }
    identityDigest = sha256({ domain: REQUIREMENT, selector: selectorIdentity, root, environment,
      selections: records.map(({ run, args }) => ({ args, code: run.result.code, stdout: rawSha256(run.result.stdout), stderr: rawSha256(run.result.stderr) })),
      tools: selected.map(tool => ({ path: tool.path, physical: tool.physical, digest: tool.digest() }))
    }) as `sha256:${string}`;
    assertSelectionCurrent();
  } catch (error) { failure = { label: 'Rustup compiler tool selection', error }; }
  if (!treeClosed && selector !== undefined && cwd !== undefined && session !== undefined) {
    const error = new RustupCompilerToolsPendingError(failure?.error,
      Object.freeze({ selector, cwd, tools: Object.freeze([...selected]), session }));
    issuedPendingErrors.add(error);
    throw error;
  }
  try {
    settleResources({ primary: failure, cleanup: [
      { label: 'Rustup selection terminal session', settle: () => {
        if (session === undefined) return;
        const receipt = session.close();
        assertProcessResourceSessionReceipt(receipt, session);
        for (const record of records) assertProcessResourceRunResult(record.run, receipt, {
          ...session, boundary: boundary!, args: record.args, env: environment, envMode: 'replace'
        });
        if (failure === undefined) assertSelectionCurrent();
      } },
      { label: 'Rustup selection cwd', settle: () => { cwd?.dispose(); } },
      { label: 'Rustup selector', settle: () => { selector?.dispose(); } }
    ] });
  } catch (error) {
    settleResources({ primary: { label: 'Rustup selection admission', error },
      cleanup: [...selected].reverse().map((tool, index) => ({ label: `selected compiler tool[${index}]`, settle: () => tool.dispose() })) });
    throw error;
  }
  const state = { retired: false, retirementFailure: undefined as unknown };
  const generation: RetainedRustupCompilerTools = Object.freeze({ [toolsBrand]: undefined as never,
    cargo: selected[0]!, rustc: selected[1]!, identityDigest: identityDigest!,
    assertCurrent: () => {
      assertRetainedRustupCompilerTools(generation);
      for (const tool of selected) tool.assertCurrent();
    },
    retire: () => {
      if (state.retired) return;
      if (state.retirementFailure !== undefined) throw state.retirementFailure;
      try {
        settleResources({ cleanup: [...selected].reverse().map((tool, index) => ({
          label: `selected compiler tool[${index}]`, settle: () => tool.dispose()
        })) });
        state.retired = true;
      } catch (error) { state.retirementFailure = error; throw error; }
    }
  });
  issuedTools.set(generation, state);
  return generation;
}
