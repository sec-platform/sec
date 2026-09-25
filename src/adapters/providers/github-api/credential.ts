import path from 'node:path';

import { sha256 } from '../../../contracts/canonical.ts';
import { issueOperationRequirementBindingContext } from '../../../execution/operation/requirement-binding-context.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileSemanticOperationPlan,
  issueSemanticOperationAttemptContext,
  type BoundSemanticOperation,
  type OperationDigest
} from '../../../execution/operation/semantic.ts';
import { withAcquiredResource } from '../../../execution/resource-settlement.ts';
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
import { GITHUB_HOST } from './contract.ts';

const MAX_CREDENTIAL_LIFETIME_MS = 30_000;
const MAX_TOKEN_BYTES = 4_096;
const MAX_ERROR_BYTES = 8_192;
const GITHUB_CREDENTIAL_OPERATION = 'external-capabilities.github-api.credential';
const GITHUB_CREDENTIAL_REQUIREMENT = 'github-api.credential-process';
const GITHUB_CREDENTIAL_CONTRACT_DIGEST = sha256({
  operation: GITHUB_CREDENTIAL_OPERATION,
  provider: 'github-cli',
  hostname: GITHUB_HOST,
  args: ['auth', 'token', '--hostname', GITHUB_HOST],
  credentialOutput: 'ascii-token',
  maximumTokenBytes: MAX_TOKEN_BYTES,
  maximumErrorBytes: MAX_ERROR_BYTES
}) as OperationDigest;

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
  providerIdentityDigest: OperationDigest;
}>): BoundSemanticOperation {
  const durationMs = input.deadlineAtUnixMs - Date.now();
  if (!Number.isSafeInteger(durationMs) || durationMs < 1
      || durationMs > MAX_CREDENTIAL_LIFETIME_MS) {
    throw new GitHubCredentialUnavailableError('deadline');
  }
  const plan = compileSemanticOperationPlan({
    operation: GITHUB_CREDENTIAL_OPERATION,
    intentDigest: sha256({
      cwd: input.cwd,
      hostname: GITHUB_HOST,
      environment: input.environment,
      providerIdentityDigest: input.providerIdentityDigest
    }) as OperationDigest,
    decisionDigest: GITHUB_CREDENTIAL_CONTRACT_DIGEST,
    deadlineAtUnixMs: input.deadlineAtUnixMs,
    attempt: issueSemanticOperationAttemptContext({
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
  return bindSemanticOperation(plan, [compileCapabilityBinding({
    requirementId: GITHUB_CREDENTIAL_REQUIREMENT,
    contractDigest: GITHUB_CREDENTIAL_CONTRACT_DIGEST,
    providerIdentityDigest: input.providerIdentityDigest
  })]);
}

function assertGitHubCredentialReceipt(
  receipt: ProcessResourceSessionReceipt,
  operation: BoundSemanticOperation
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
  const { cwd, hostname, deadlineAtUnixMs } = input;
  const startedAt = Date.now();
  if (hostname !== GITHUB_HOST
      || !path.isAbsolute(cwd) || path.resolve(cwd) !== cwd
      || !Number.isSafeInteger(deadlineAtUnixMs)) {
    throw new GitHubCredentialUnavailableError('admission');
  }
  const deadlineAt = Math.min(deadlineAtUnixMs, startedAt + MAX_CREDENTIAL_LIFETIME_MS);
  const deadlineMonotonicAt = performance.now() + Math.max(0, deadlineAt - startedAt);
  const remainingMs = (): number => Math.min(
    deadlineAt - Date.now(),
    Math.floor(deadlineMonotonicAt - performance.now())
  );
  if (remainingMs() < 1) throw new GitHubCredentialUnavailableError('deadline');

  // Retain the returned byte buffer even when a later receipt/dispose fails.
  // Only the successful final token copy is transferred to the caller. Native
  // process copies and immutable stderr strings remain the provider's domain.
  const output: { value?: Awaited<ReturnType<ProcessResourceSession['run']>> } = {};
  let processAdmitted = false;
  try {
    const locator = resolveExecutableLocator('gh', {
      cwd,
      pathValue: environmentValue(process.env, 'PATH') ?? ''
    });
    const expectedExecutableName = process.platform === 'win32' ? 'gh.exe' : 'gh';
    if (locator === null || !path.isAbsolute(locator)
        || path.basename(locator).toLowerCase() !== expectedExecutableName) {
      throw new GitHubCredentialUnavailableError('admission');
    }
    const result = await withAcquiredResource({
      operationLabel: 'github-credential',
      resourceLabel: 'github-credential-executable',
      acquire: () => retainNoFollowOrdinaryFile(
        inspectNoFollowDirectoryChain(path.dirname(locator), 'GitHub CLI executable parent'),
        path.basename(locator),
        undefined,
        'GitHub CLI executable',
        RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
        'executable'
      ),
      async use(executable) {
        const workingDirectoryChain = inspectNoFollowDirectoryChain(cwd, 'GitHub credential working directory');
        return withAcquiredResource({
          operationLabel: 'github-credential-execution',
          resourceLabel: 'github-credential-working-directory',
          acquire: () => retainNoFollowDirectoryForChildProcess(
            workingDirectoryChain,
            RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
            'GitHub credential working directory'
          ),
          async use(workingDirectory) {
            if (remainingMs() < 1) throw new GitHubCredentialUnavailableError('deadline');
            const boundary = issueRetainedCommandBoundary({ executable, workingDirectory });
            const environment = githubCredentialEnvironment(process.env);
            const providerIdentityDigest = sha256({
              provider: 'github-cli',
              hostname: GITHUB_HOST,
              executable: {
                path: executable.path,
                parent: executable.parent,
                physical: executable.physical,
                size: executable.size,
                digest: executable.digest()
              },
              workingDirectory: workingDirectoryChain.target
            }) as OperationDigest;
            const operation = compileGitHubCredentialOperation({
              cwd, deadlineAtUnixMs: deadlineAt, environment, providerIdentityDigest
            });
            return withAcquiredResource({
              operationLabel: 'github-credential-command',
              resourceLabel: 'github-credential-process-session',
              acquire() {
                const session = openProcessResourceSession({
                  operation,
                  requirementBindingContext: issueOperationRequirementBindingContext({
                    operation,
                    requirementId: GITHUB_CREDENTIAL_REQUIREMENT,
                    resourceCeilings: operation.plan.execution.aggregateBudgets
                  })
                });
                processAdmitted = true;
                return session;
              },
              async use(session) {
                const completed = await session.run(boundary, ['auth', 'token', '--hostname', GITHUB_HOST], {
                  env: environment,
                  envMode: 'replace',
                  maxStderrBytes: MAX_ERROR_BYTES,
                  maxStdoutBytes: MAX_TOKEN_BYTES
                });
                output.value = completed;
                return completed;
              },
              release(session) {
                assertGitHubCredentialReceipt(session.close(), operation);
              }
            });
          },
          release: (workingDirectory) => workingDirectory.dispose()
        });
      },
      release: (executable) => executable.dispose()
    });
    if (result.result.code !== 0 || remainingMs() < 1) {
      throw new GitHubCredentialUnavailableError(remainingMs() < 1 ? 'deadline' : 'transport');
    }
    return tokenBytes(result.result.stdout);
  } catch (error) {
    // Raw provider and teardown errors may contain sensitive environment data.
    // Preserve the public redacted error contract, not a raw aggregate/cause.
    if (error instanceof GitHubCredentialUnavailableError) throw error;
    throw new GitHubCredentialUnavailableError(
      remainingMs() < 1 ? 'deadline' : processAdmitted ? 'transport' : 'admission'
    );
  } finally {
    output.value?.result.stdout.fill(0);
  }
}
