import path from 'node:path';

import {
  inspectNoFollowDirectoryChain,
  retainNoFollowDirectoryForChildProcess,
  retainNoFollowOrdinaryFile
} from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  assertProcessResourceSessionReceipt,
  openProcessResourceSession,
  type ProcessResourceSession,
  type ProcessResourceSessionReceipt
} from '../../runtime-state/physical/runtime/process-resource-session.ts';
import {
  RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
  RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
  issueRetainedCommandBoundary,
  resolveExecutableLocator
} from '../../runtime-state/physical/runtime/process.ts';
import { sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import { issueSecOperationRequirementBindingContext } from '../../system-architecture/operation/requirement-binding-context.ts';
import {
  bindSecSemanticOperation,
  compileSecCapabilityBinding,
  compileSecSemanticOperationPlan,
  issueSecSemanticOperationAttemptContext,
  type SecBoundSemanticOperation,
  type SecOperationDigest
} from '../../system-architecture/operation/semantic.ts';
import { GITHUB_HOST } from './contract.ts';

const MAX_CREDENTIAL_LIFETIME_MS = 30_000;
const MAX_TOKEN_BYTES = 4_096;
const MAX_ERROR_BYTES = 8_192;
const GITHUB_CREDENTIAL_OPERATION = 'external-capabilities.github-read.credential';
const GITHUB_CREDENTIAL_REQUIREMENT = 'github-read.credential-process';
const GITHUB_CREDENTIAL_CONTRACT_DIGEST = sha256({
  operation: GITHUB_CREDENTIAL_OPERATION,
  provider: 'github-cli',
  hostname: GITHUB_HOST,
  args: ['auth', 'token', '--hostname', GITHUB_HOST],
  credentialOutput: 'ascii-token',
  maximumTokenBytes: MAX_TOKEN_BYTES,
  maximumErrorBytes: MAX_ERROR_BYTES
}) as SecOperationDigest;

export class GitHubCredentialUnavailableError extends Error {
  readonly code = 'github-credential-unavailable' as const;

  constructor(readonly reason: 'admission' | 'deadline' | 'transport' | 'token') {
    super(`GitHub credential provider is unavailable (${reason})`);
    this.name = 'GitHubCredentialUnavailableError';
  }
}

export type GitHubCredentialInput = Readonly<{
  cwd: string;
  hostname: typeof GITHUB_HOST;
  deadlineAtUnixMs: number;
}>;

function environmentValue(source: Readonly<NodeJS.ProcessEnv>, key: string): string | undefined {
  const actual = Object.keys(source).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
  return actual === undefined ? undefined : source[actual];
}

/** The credential child never inherits PATH, token, host, config, HOME or XDG selectors. */
function githubCredentialEnvironment(source: Readonly<NodeJS.ProcessEnv>): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    GH_PROMPT_DISABLED: '1',
    NO_COLOR: '1'
  };
  for (const key of ['SYSTEMROOT', 'WINDIR', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE'] as const) {
    const value = environmentValue(source, key);
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

function tokenBytes(stdout: Uint8Array): Uint8Array {
  let start = 0;
  let end = stdout.byteLength;
  while (start < end && stdout[start]! <= 0x20) start += 1;
  while (end > start && stdout[end - 1]! <= 0x20) end -= 1;
  if (end === start || end - start > MAX_TOKEN_BYTES) {
    throw new GitHubCredentialUnavailableError('token');
  }
  const token = stdout.slice(start, end);
  if (token.some((byte) => byte < 0x21 || byte > 0x7e)) {
    token.fill(0);
    throw new GitHubCredentialUnavailableError('token');
  }
  return token;
}

function compileGitHubCredentialOperation(input: Readonly<{
  cwd: string;
  deadlineAtUnixMs: number;
  environment: Readonly<NodeJS.ProcessEnv>;
  providerIdentityDigest: SecOperationDigest;
}>): SecBoundSemanticOperation {
  const durationMs = input.deadlineAtUnixMs - Date.now();
  if (!Number.isSafeInteger(durationMs) || durationMs < 1
      || durationMs > MAX_CREDENTIAL_LIFETIME_MS) {
    throw new GitHubCredentialUnavailableError('deadline');
  }
  const plan = compileSecSemanticOperationPlan({
    operation: GITHUB_CREDENTIAL_OPERATION,
    intentDigest: sha256({
      cwd: input.cwd,
      hostname: GITHUB_HOST,
      environment: input.environment,
      providerIdentityDigest: input.providerIdentityDigest
    }) as SecOperationDigest,
    decisionDigest: GITHUB_CREDENTIAL_CONTRACT_DIGEST,
    deadlineAtUnixMs: input.deadlineAtUnixMs,
    attempt: issueSecSemanticOperationAttemptContext({
      authorityGrantDigest: GITHUB_CREDENTIAL_CONTRACT_DIGEST
    }),
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: durationMs },
      { resource: 'input-bytes', maximum: 0 },
      { resource: 'output-bytes', maximum: MAX_TOKEN_BYTES + MAX_ERROR_BYTES },
      { resource: 'processes', maximum: 1 }
    ],
    requirements: [{
      id: GITHUB_CREDENTIAL_REQUIREMENT,
      contractDigest: GITHUB_CREDENTIAL_CONTRACT_DIGEST,
      effectKinds: ['process', 'provider'],
      failureKinds: [
        'process.cancelled',
        'process.deadline-exhausted',
        'process.identity-drift',
        'process.output-budget-exhausted',
        'process.settlement-unproven',
        'provider.unavailable',
        'provider.unverified'
      ]
    }]
  });
  return bindSecSemanticOperation(plan, [compileSecCapabilityBinding({
    requirementId: GITHUB_CREDENTIAL_REQUIREMENT,
    contractDigest: GITHUB_CREDENTIAL_CONTRACT_DIGEST,
    providerIdentityDigest: input.providerIdentityDigest
  })]);
}

function assertGitHubCredentialReceipt(
  receipt: ProcessResourceSessionReceipt,
  operation: SecBoundSemanticOperation
): void {
  assertProcessResourceSessionReceipt(receipt, {
    operationIdentityDigest: operation.plan.identity.identityDigest,
    boundAttemptDigest: operation.boundAttemptDigest,
    requirementId: GITHUB_CREDENTIAL_REQUIREMENT
  });
  if (receipt.processCount !== 1
      || receipt.settledProcessCount !== 1
      || receipt.inputBytes !== 0
      || receipt.outputBytes > MAX_TOKEN_BYTES + MAX_ERROR_BYTES) {
    throw new GitHubCredentialUnavailableError('transport');
  }
}

export async function readGitHubToken(input: GitHubCredentialInput): Promise<Uint8Array> {
  const startedAt = Date.now();
  if (input.hostname !== GITHUB_HOST
      || !path.isAbsolute(input.cwd) || path.resolve(input.cwd) !== input.cwd
      || !Number.isSafeInteger(input.deadlineAtUnixMs)) {
    throw new GitHubCredentialUnavailableError('admission');
  }
  const deadlineAt = Math.min(input.deadlineAtUnixMs, startedAt + MAX_CREDENTIAL_LIFETIME_MS);
  const deadlineMonotonicAt = performance.now() + Math.max(0, deadlineAt - startedAt);
  const remainingMs = (): number => Math.min(
    deadlineAt - Date.now(),
    Math.floor(deadlineMonotonicAt - performance.now())
  );
  if (remainingMs() < 1) throw new GitHubCredentialUnavailableError('deadline');

  let executable: ReturnType<typeof retainNoFollowOrdinaryFile> | null = null;
  let workingDirectory: ReturnType<typeof retainNoFollowDirectoryForChildProcess> | null = null;
  let processSession: ProcessResourceSession | null = null;
  let operation: SecBoundSemanticOperation | null = null;
  let receipt: ProcessResourceSessionReceipt | null = null;
  let result: Awaited<ReturnType<ProcessResourceSession['run']>> | null = null;
  let primaryError: unknown;
  try {
    const locator = resolveExecutableLocator('gh', {
      cwd: input.cwd,
      pathValue: environmentValue(process.env, 'PATH') ?? ''
    });
    if (locator === null || !path.isAbsolute(locator) || path.basename(locator).toLowerCase() !== 'gh.exe') {
      throw new GitHubCredentialUnavailableError('admission');
    }
    executable = retainNoFollowOrdinaryFile(
      inspectNoFollowDirectoryChain(path.dirname(locator), 'GitHub CLI executable parent'),
      path.basename(locator),
      undefined,
      'GitHub CLI executable',
      RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
      'executable'
    );
    const workingDirectoryChain = inspectNoFollowDirectoryChain(
      input.cwd,
      'GitHub credential working directory'
    );
    workingDirectory = retainNoFollowDirectoryForChildProcess(
      workingDirectoryChain,
      RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
      'GitHub credential working directory'
    );
    if (remainingMs() < 1) throw new GitHubCredentialUnavailableError('deadline');
    const boundary = issueRetainedCommandBoundary({ executable, workingDirectory });
    const environment = githubCredentialEnvironment(process.env);
    const executableDigest = executable.digest();
    const providerIdentityDigest = sha256({
      provider: 'github-cli',
      hostname: GITHUB_HOST,
      executable: {
        path: executable.path,
        parent: executable.parent,
        physical: executable.physical,
        size: executable.size,
        digest: executableDigest
      },
      workingDirectory: workingDirectoryChain.target
    }) as SecOperationDigest;
    operation = compileGitHubCredentialOperation({
      cwd: input.cwd,
      deadlineAtUnixMs: deadlineAt,
      environment,
      providerIdentityDigest
    });
    processSession = openProcessResourceSession({
      operation,
      requirementBindingContext: issueSecOperationRequirementBindingContext({
        operation,
        requirementId: GITHUB_CREDENTIAL_REQUIREMENT,
        resourceCeilings: operation.plan.execution.aggregateBudgets
      })
    });
    result = await processSession.run(
      boundary,
      ['auth', 'token', '--hostname', GITHUB_HOST],
      {
        env: environment,
        envMode: 'replace',
        maxStderrBytes: MAX_ERROR_BYTES,
        maxStdoutBytes: MAX_TOKEN_BYTES
      }
    );
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      if (processSession !== null) receipt = processSession.close();
    } catch (error) {
      primaryError ??= error;
    }
    try { workingDirectory?.dispose(); } catch (error) { primaryError ??= error; }
    try { executable?.dispose(); } catch (error) { primaryError ??= error; }
  }
  if (operation !== null && receipt !== null) {
    try {
      assertGitHubCredentialReceipt(receipt, operation);
    } catch (error) {
      primaryError ??= error;
    }
  }
  if (primaryError !== undefined) {
    if (primaryError instanceof GitHubCredentialUnavailableError) throw primaryError;
    throw new GitHubCredentialUnavailableError(
      remainingMs() < 1 ? 'deadline' : processSession === null ? 'admission' : 'transport'
    );
  }
  if (operation === null || receipt === null || result === null) {
    throw new GitHubCredentialUnavailableError('transport');
  }
  try {
    if (result.result.code !== 0 || remainingMs() < 1) {
      throw new GitHubCredentialUnavailableError(remainingMs() < 1 ? 'deadline' : 'transport');
    }
    return tokenBytes(result.result.stdout);
  } finally {
    result.result.stdout.fill(0);
  }
}
