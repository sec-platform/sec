import path from 'node:path';

import { sha256 } from '../../../contracts/canonical.ts';
import { issueSecOperationRequirementBindingContext } from '../../../execution/operation/requirement-binding-context.ts';
import {
  bindSecSemanticOperation,
  compileSecCapabilityBinding,
  compileSecSemanticOperationPlan,
  issueSecSemanticOperationAttemptContext,
  type SecBoundSemanticOperation,
  type SecOperationDigest
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
  credentialSources: ['stored-gh-auth', 'github-actions-token'],
  githubActionsTokenEnvironment: {
    token: 'GH_TOKEN',
    actions: 'true',
    serverUrl: 'https://github.com',
    apiUrl: 'https://api.github.com'
  },
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
  repository: string;
  hostname: typeof GITHUB_HOST;
  deadlineAtUnixMs: number;
}>;

export type GitHubActionsProjectionCredentialIdentity = Readonly<{
  repository: string;
  workflowRef: string;
  workflowSha: string;
}>;

type GitHubCredentialSource = 'stored-gh-auth' | 'github-actions-token';

type GitHubCredentialProcessEnvironment = Readonly<{
  child: NodeJS.ProcessEnv;
  identity: Readonly<NodeJS.ProcessEnv>;
  source: GitHubCredentialSource;
}>;

function environmentValue(source: Readonly<NodeJS.ProcessEnv>, key: string): string | undefined {
  const actual = Object.keys(source).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
  return actual === undefined ? undefined : source[actual];
}

export function inspectGitHubActionsProjectionCredentialIdentity(
  source: Readonly<NodeJS.ProcessEnv>,
  repository: string
): GitHubActionsProjectionCredentialIdentity | null {
  const workflowRef = `${repository}/.github/workflows/code-scanning-projection.yml@refs/heads/main`;
  const workflowSha = environmentValue(source, 'GITHUB_WORKFLOW_SHA');
  const token = environmentValue(source, 'GH_TOKEN');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)
      || environmentValue(source, 'GITHUB_ACTIONS') !== 'true'
      || environmentValue(source, 'GITHUB_SERVER_URL') !== 'https://github.com'
      || environmentValue(source, 'GITHUB_API_URL') !== 'https://api.github.com'
      || environmentValue(source, 'GITHUB_REPOSITORY') !== repository
      || environmentValue(source, 'GITHUB_EVENT_NAME') !== 'pull_request_target'
      || environmentValue(source, 'GITHUB_REF') !== 'refs/heads/main'
      || environmentValue(source, 'GITHUB_WORKFLOW_REF') !== workflowRef
      || typeof workflowSha !== 'string'
      || !/^[0-9a-f]{40}$/u.test(workflowSha)
      || environmentValue(source, 'GITHUB_SHA') !== workflowSha
      || token === undefined) {
    return null;
  }
  if (token.length === 0 || token !== token.trim()
      || Buffer.byteLength(token, 'utf8') > MAX_TOKEN_BYTES
      || !/^[^\s\u0000-\u001f\u007f-\u009f]+$/u.test(token)) {
    throw new GitHubCredentialUnavailableError('token');
  }
  return Object.freeze({ repository, workflowRef, workflowSha });
}

function githubActionsCredentialToken(
  source: Readonly<NodeJS.ProcessEnv>,
  repository: string
): string | undefined {
  if (inspectGitHubActionsProjectionCredentialIdentity(source, repository) === null) return undefined;
  return environmentValue(source, 'GH_TOKEN');
}

/**
 * The credential child never inherits PATH, host, config, HOME or XDG selectors.
 * A GitHub Actions token is forwarded only as GH_TOKEN from an exact github.com
 * Actions environment; the secret is excluded from the semantic operation digest.
 */
function githubCredentialEnvironment(
  source: Readonly<NodeJS.ProcessEnv>,
  repository: string
): GitHubCredentialProcessEnvironment {
  const child: NodeJS.ProcessEnv = {
    GH_PROMPT_DISABLED: '1',
    NO_COLOR: '1'
  };
  const identity: NodeJS.ProcessEnv = {
    GH_PROMPT_DISABLED: '1',
    NO_COLOR: '1'
  };
  for (const key of ['SYSTEMROOT', 'WINDIR', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE'] as const) {
    const value = environmentValue(source, key);
    if (value !== undefined) {
      child[key] = value;
      identity[key] = value;
    }
  }
  const actionsToken = githubActionsCredentialToken(source, repository);
  const credentialSource: GitHubCredentialSource = actionsToken === undefined
    ? 'stored-gh-auth'
    : 'github-actions-token';
  if (actionsToken !== undefined) child.GH_TOKEN = actionsToken;
  return Object.freeze({
    child,
    identity: Object.freeze(identity),
    source: credentialSource
  });
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
  environmentIdentity: Readonly<NodeJS.ProcessEnv>;
  credentialSource: GitHubCredentialSource;
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
      environment: input.environmentIdentity,
      credentialSource: input.credentialSource,
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
  const { cwd, repository, hostname, deadlineAtUnixMs } = input;
  const startedAt = Date.now();
  if (hostname !== GITHUB_HOST
      || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)
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
            const environment = githubCredentialEnvironment(process.env, repository);
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
            }) as SecOperationDigest;
            const operation = compileGitHubCredentialOperation({
              cwd,
              deadlineAtUnixMs: deadlineAt,
              environmentIdentity: environment.identity,
              credentialSource: environment.source,
              providerIdentityDigest
            });
            return withAcquiredResource({
              operationLabel: 'github-credential-command',
              resourceLabel: 'github-credential-process-session',
              acquire() {
                const session = openProcessResourceSession({
                  operation,
                  requirementBindingContext: issueSecOperationRequirementBindingContext({
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
                  env: environment.child,
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
