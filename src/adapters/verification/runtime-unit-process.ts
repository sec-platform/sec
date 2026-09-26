import path from 'node:path';

import { sha256 } from '../../contracts/canonical.ts';
import type { CommitFence } from '../../contracts/commit-fence.ts';
import { issueOperationRequirementBindingContext } from '../../execution/operation/requirement-binding-context.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileSemanticOperationPlan,
  issueSemanticOperationAttemptContext,
  type OperationDigest
} from '../../execution/operation/semantic.ts';
import { settleResources } from '../../execution/resource-settlement.ts';
import {
  inspectNoFollowDirectoryChain,
  retainNoFollowDirectoryForChildProcess,
  retainNoFollowOrdinaryFile
} from '../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  assertProcessResourceSessionReceipt,
  openProcessResourceSession
} from '../runtime-state/physical/runtime/process-resource-session.ts';
import {
  issueRetainedCommandBoundary,
  resolveExecutableLocator,
  RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
  RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
  type CommandResult
} from '../runtime-state/physical/runtime/process.ts';

const PROCESS_OPERATION = 'verification.runtime-unit-process';
const PROCESS_REQUIREMENT = 'verification.runtime-unit-process.execute';
const MAX_DURATION_MS = 5 * 60 * 1_000;
const MAX_STDOUT_BYTES = 16 * 1024 * 1024;
const MAX_STDERR_BYTES = 16 * 1024 * 1024;
const MAX_OUTPUT_BYTES = MAX_STDOUT_BYTES + MAX_STDERR_BYTES;
const MAX_NATIVE_RESOURCES = 2;
const PROCESS_CONTRACT = sha256({
  domain: 'verification.runtime-unit-process.contract',
  durationMs: MAX_DURATION_MS,
  outputBytes: MAX_OUTPUT_BYTES,
  nativeResources: MAX_NATIVE_RESOURCES
}) as OperationDigest;

function pathValue(environment: NodeJS.ProcessEnv): string {
  const key = Object.keys(environment).find((candidate) => candidate.toLowerCase() === 'path');
  const value = key === undefined ? undefined : environment[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Runtime verification process requires one explicit PATH value.');
  }
  return value;
}

function executablePath(
  command: string,
  workspaceRoot: string,
  environment: NodeJS.ProcessEnv
): string {
  if (path.isAbsolute(command)) return path.resolve(command);
  const resolved = resolveExecutableLocator(command, {
    cwd: workspaceRoot,
    pathValue: pathValue(environment)
  });
  if (resolved === null) throw new Error(`Runtime verification executable is unavailable: ${command}`);
  return path.resolve(resolved);
}

function compileOperation(input: Readonly<{
  workspaceRoot: string;
  command: string;
  args: readonly string[];
  isolated: boolean;
  providerIdentityDigest: OperationDigest;
}>) {
  const aggregateBudgets = Object.freeze([
    { resource: 'duration-ms' as const, maximum: MAX_DURATION_MS },
    { resource: 'input-bytes' as const, maximum: 0 },
    { resource: 'output-bytes' as const, maximum: MAX_OUTPUT_BYTES },
    { resource: 'processes' as const, maximum: MAX_NATIVE_RESOURCES }
  ]);
  const plan = compileSemanticOperationPlan({
    operation: PROCESS_OPERATION,
    intentDigest: sha256({
      domain: 'verification.runtime-unit-process.intent',
      workspaceRoot: input.workspaceRoot,
      command: input.command,
      args: input.args,
      isolated: input.isolated
    }) as OperationDigest,
    decisionDigest: sha256({
      domain: 'verification.runtime-unit-process.decision',
      requirement: PROCESS_REQUIREMENT,
      contract: PROCESS_CONTRACT
    }) as OperationDigest,
    deadlineAtUnixMs: Date.now() + MAX_DURATION_MS,
    aggregateBudgets,
    requirements: [{
      id: PROCESS_REQUIREMENT,
      contractDigest: PROCESS_CONTRACT,
      effectKinds: ['process'],
      failureKinds: [
        'process.cancelled',
        'process.deadline-exhausted',
        'process.output-budget-exhausted',
        'process.settlement-unproven',
        'process.unavailable'
      ]
    }],
    attempt: issueSemanticOperationAttemptContext({
      authorityGrantDigest: sha256({
        domain: 'verification.runtime-unit-process.local-admission',
        workspaceRoot: input.workspaceRoot,
        isolated: input.isolated
      }) as OperationDigest
    })
  });
  return bindSemanticOperation(plan, [compileCapabilityBinding({
    requirementId: PROCESS_REQUIREMENT,
    contractDigest: PROCESS_CONTRACT,
    providerIdentityDigest: input.providerIdentityDigest
  })]);
}

export async function runRuntimeUnitProcess(input: Readonly<{
  workspaceRoot: string;
  command: string;
  args: readonly string[];
  environment: NodeJS.ProcessEnv;
  isolated: boolean;
  beforeCommit?: CommitFence;
  signal?: AbortSignal;
}>): Promise<CommandResult> {
  const selectedExecutable = executablePath(input.command, input.workspaceRoot, input.environment);
  const executableParent = inspectNoFollowDirectoryChain(
    path.dirname(selectedExecutable),
    'Runtime verification executable parent'
  );
  const workspaceChain = inspectNoFollowDirectoryChain(
    input.workspaceRoot,
    'Runtime verification workspace root'
  );
  const executable = retainNoFollowOrdinaryFile(
    executableParent,
    path.basename(selectedExecutable),
    undefined,
    'Runtime verification executable',
    RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
    'executable'
  );
  const workingDirectory = retainNoFollowDirectoryForChildProcess(
    workspaceChain,
    RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
    'Runtime verification workspace root'
  );
  const providerIdentityDigest = sha256({
    domain: 'verification.runtime-unit-process.provider',
    executable: {
      path: executable.path,
      physical: executable.physical,
      digest: executable.digest()
    },
    workspace: workspaceChain.target
  }) as OperationDigest;
  const operation = compileOperation({
    workspaceRoot: input.workspaceRoot,
    command: input.command,
    args: input.args,
    isolated: input.isolated,
    providerIdentityDigest
  });
  const session = openProcessResourceSession({
    operation,
    requirementBindingContext: issueOperationRequirementBindingContext({
      operation,
      requirementId: PROCESS_REQUIREMENT,
      resourceCeilings: operation.plan.execution.aggregateBudgets
    }),
    signal: input.signal
  });
  const boundary = issueRetainedCommandBoundary({ executable, workingDirectory });
  let result: CommandResult | undefined;
  let primaryFailure: Readonly<{ error: unknown }> | undefined;
  try {
    const executed = await session.run(boundary, input.args, {
      beforeSpawn: input.isolated ? input.beforeCommit : undefined,
      env: input.environment,
      envMode: input.isolated ? 'replace' : 'inherit',
      maxStdoutBytes: MAX_STDOUT_BYTES,
      maxStderrBytes: MAX_STDERR_BYTES
    });
    result = Object.freeze({
      code: executed.result.code,
      stdout: Buffer.from(executed.result.stdout).toString('utf8'),
      stderr: executed.result.stderr
    });
  } catch (error) {
    primaryFailure = { error };
  }
  settleResources({
    ...(primaryFailure === undefined ? {} : {
      primary: { label: 'runtime verification process', error: primaryFailure.error }
    }),
    cleanup: [
      {
        label: 'runtime verification process session',
        settle: () => assertProcessResourceSessionReceipt(session.close(), {
          operationIdentityDigest: operation.plan.identity.identityDigest,
          boundAttemptDigest: operation.boundAttemptDigest,
          requirementId: PROCESS_REQUIREMENT
        })
      },
      { label: 'runtime verification working directory', settle: () => workingDirectory.dispose() },
      { label: 'runtime verification executable', settle: () => executable.dispose() }
    ]
  });
  if (result === undefined) throw new Error('Runtime verification process settled without a result.');
  return result;
}
