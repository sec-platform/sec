import path from 'node:path';

import { sha256 } from '../../../../contracts/canonical.ts';
import type { CommitFence } from '../../../../contracts/commit-fence.ts';
import { issueOperationRequirementBindingContext } from '../../../../execution/operation/requirement-binding-context.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileSemanticOperationPlan,
  issueSemanticOperationAttemptContext,
  type OperationDigest
} from '../../../../execution/operation/semantic.ts';
import { settleResources } from '../../../../execution/resource-settlement.ts';
import {
  inspectNoFollowDirectoryChain,
  retainNoFollowDirectoryForChildProcess,
  retainNoFollowOrdinaryFile
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import type { ObservedCommandOutcome } from '../../../runtime-state/physical/runtime/observed-process.ts';
import {
  assertProcessResourceSessionReceipt,
  openProcessResourceSession
} from '../../../runtime-state/physical/runtime/process-resource-session.ts';
import {
  issueRetainedCommandBoundary,
  RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
  RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
  RetainedCommandTransportError
} from '../../../runtime-state/physical/runtime/process.ts';

const PROCESS_OPERATION = 'verification.semantic-mutation-isolated-child-process';
const PROCESS_REQUIREMENT = 'verification.semantic-mutation-isolated-child-process.execute';
const MAX_NATIVE_RESOURCES = 2;

export type IsolatedProcessObservation = Readonly<{
  code: number;
  stdout: Uint8Array;
  stderr: string;
  outcome: ObservedCommandOutcome;
}>;

function compileOperation(input: Readonly<{
  command: string;
  args: readonly string[];
  cwd: string;
  timeoutMs: number;
  outputLimitBytes: number;
  providerIdentityDigest: OperationDigest;
}>) {
  const contractDigest = sha256({
    domain: 'verification.semantic-mutation-isolated-child-process.contract',
    timeoutMs: input.timeoutMs,
    outputLimitBytes: input.outputLimitBytes,
    nativeResources: MAX_NATIVE_RESOURCES
  }) as OperationDigest;
  const plan = compileSemanticOperationPlan({
    operation: PROCESS_OPERATION,
    intentDigest: sha256({
      domain: 'verification.semantic-mutation-isolated-child-process.intent',
      command: input.command,
      args: input.args,
      cwd: input.cwd
    }) as OperationDigest,
    decisionDigest: contractDigest,
    deadlineAtUnixMs: Date.now() + input.timeoutMs,
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: input.timeoutMs },
      { resource: 'input-bytes', maximum: 0 },
      { resource: 'output-bytes', maximum: input.outputLimitBytes * 2 },
      { resource: 'processes', maximum: MAX_NATIVE_RESOURCES }
    ],
    requirements: [{
      id: PROCESS_REQUIREMENT,
      contractDigest,
      effectKinds: ['process'],
      failureKinds: [
        'process.cancelled',
        'process.deadline-exhausted',
        'process.identity-drift',
        'process.output-budget-exhausted',
        'process.settlement-unproven',
        'process.unavailable'
      ]
    }],
    attempt: issueSemanticOperationAttemptContext({
      authorityGrantDigest: sha256({
        domain: 'verification.semantic-mutation-isolated-child-process.local-admission',
        command: input.command,
        cwd: input.cwd
      }) as OperationDigest
    })
  });
  return bindSemanticOperation(plan, [compileCapabilityBinding({
    requirementId: PROCESS_REQUIREMENT,
    contractDigest,
    providerIdentityDigest: input.providerIdentityDigest
  })]);
}

export async function runSemanticMutationIsolatedProcess(input: Readonly<{
  command: string;
  args: readonly string[];
  cwd: string;
  environment: NodeJS.ProcessEnv;
  timeoutMs: number;
  outputLimitBytes: number;
  commitFence: CommitFence;
}>): Promise<IsolatedProcessObservation> {
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1) {
    throw new Error('Semantic Mutation isolated process timeout must be a positive safe integer.');
  }
  if (!Number.isSafeInteger(input.outputLimitBytes) || input.outputLimitBytes < 1) {
    throw new Error('Semantic Mutation isolated process output limit must be a positive safe integer.');
  }
  const command = path.resolve(input.command);
  const cwd = path.resolve(input.cwd);
  const executable = retainNoFollowOrdinaryFile(
    inspectNoFollowDirectoryChain(path.dirname(command), 'Semantic Mutation isolated executable parent'),
    path.basename(command),
    undefined,
    'Semantic Mutation isolated executable',
    RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
    'executable'
  );
  const workingDirectoryChain = inspectNoFollowDirectoryChain(
    cwd,
    'Semantic Mutation isolated child working directory'
  );
  const workingDirectory = retainNoFollowDirectoryForChildProcess(
    workingDirectoryChain,
    RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
    'Semantic Mutation isolated child working directory'
  );
  const providerIdentityDigest = sha256({
    domain: 'verification.semantic-mutation-isolated-child-process.provider',
    executable: {
      path: executable.path,
      physical: executable.physical,
      digest: executable.digest()
    },
    workingDirectory: workingDirectoryChain.target
  }) as OperationDigest;
  const operation = compileOperation({
    command,
    args: input.args,
    cwd,
    timeoutMs: input.timeoutMs,
    outputLimitBytes: input.outputLimitBytes,
    providerIdentityDigest
  });
  const session = openProcessResourceSession({
    operation,
    requirementBindingContext: issueOperationRequirementBindingContext({
      operation,
      requirementId: PROCESS_REQUIREMENT,
      resourceCeilings: operation.plan.execution.aggregateBudgets
    })
  });
  const boundary = issueRetainedCommandBoundary({ executable, workingDirectory });
  let result: IsolatedProcessObservation | undefined;
  let primaryFailure: Readonly<{ error: unknown }> | undefined;
  let observedOutputBytes = 0;
  try {
    const executed = await session.run(boundary, input.args, {
      beforeSpawn: input.commitFence,
      whileRunning: input.commitFence,
      env: input.environment,
      envMode: 'replace',
      maxStdoutBytes: input.outputLimitBytes,
      maxStderrBytes: input.outputLimitBytes,
      admitProgress: (chunk) => {
        observedOutputBytes += chunk.byteLength;
        if (observedOutputBytes > input.outputLimitBytes) {
          throw new Error('Semantic Mutation isolated child exceeded its output budget');
        }
        return true;
      }
    });
    result = Object.freeze({
      code: executed.result.code,
      stdout: new Uint8Array(executed.result.stdout),
      stderr: executed.result.stderr,
      outcome: executed.outcome
    });
  } catch (error) {
    if (error instanceof RetainedCommandTransportError) {
      result = Object.freeze({
        code: error.outcome.exitCode ?? 1,
        stdout: new Uint8Array(),
        stderr: '',
        outcome: error.outcome
      });
    } else {
      primaryFailure = Object.freeze({ error });
    }
  }
  settleResources({
    ...(primaryFailure === undefined ? {} : {
      primary: { label: 'Semantic Mutation isolated process', error: primaryFailure.error }
    }),
    cleanup: [
      {
        label: 'Semantic Mutation isolated process session',
        settle: () => assertProcessResourceSessionReceipt(session.close(), {
          operationIdentityDigest: operation.plan.identity.identityDigest,
          boundAttemptDigest: operation.boundAttemptDigest,
          requirementId: PROCESS_REQUIREMENT
        })
      },
      { label: 'Semantic Mutation isolated working directory', settle: () => workingDirectory.dispose() },
      { label: 'Semantic Mutation isolated executable', settle: () => executable.dispose() }
    ]
  });
  if (result === undefined) {
    throw new Error('Semantic Mutation isolated process settled without one observation.');
  }
  return result;
}
