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
import { resolveLinuxEffectiveUserHome } from '../../runtime-state/physical/runtime/linux-user-home.ts';
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
import { currentGitHubCredentialStore } from './credential-store.ts';

const MAX_CREDENTIAL_LIFETIME_MS = 30_000;
const MAX_TOKEN_BYTES = 4_096;
const MAX_ERROR_BYTES = 8_192;
const GITHUB_CREDENTIAL_OPERATION = 'external-capabilities.github-api.credential';
const GITHUB_CREDENTIAL_REQUIREMENT = 'github-api.credential-process';
const GITHUB_CREDENTIAL_CONTRACT_DIGEST = sha256({
  operation: GITHUB_CREDENTIAL_OPERATION,
  provider: 'github-cli',
  credentialSources: ['stored-gh-auth', 'explicit-private-gh-config', 'github-actions-token'],
  linuxStoredAuthHome: 'effective-user-database',
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
  repository: string;
  hostname: typeof GITHUB_HOST;
  deadlineAtUnixMs: number;
  signal?: AbortSignal;
}>;

export type GitHubActionsRepositoryMaintenanceCredentialIdentity = Readonly<{
  repository: string;
  workflowRef: string;
  workflowSha: string;
  actor: string;
  requestDigest: `sha256:${string}`;
  executionDigest: `sha256:${string}`;
  resumeReceiptDigest: `sha256:${string}` | null;
  runId: string;
  runAttempt: number;
}>;

type GitHubCredentialSource = 'stored-gh-auth' | 'explicit-private-gh-config' | 'github-actions-token';

type GitHubCredentialProcessEnvironment = Readonly<{
  child: NodeJS.ProcessEnv;
  identity: Readonly<NodeJS.ProcessEnv>;
  source: GitHubCredentialSource;
}>;

function environmentValue(source: Readonly<NodeJS.ProcessEnv>, key: string): string | undefined {
  const actual = Object.keys(source).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
  return actual === undefined ? undefined : source[actual];
}

export function inspectGitHubActionsRepositoryMaintenanceCredentialIdentity(
  source: Readonly<NodeJS.ProcessEnv>,
  repository: string
): GitHubActionsRepositoryMaintenanceCredentialIdentity | null {
  const workflowRef = `${repository}/.github/workflows/repository-maintenance.yml@refs/heads/main`;
  const get = (key: string) => environmentValue(source, key);
  const workflowSha = get('GITHUB_WORKFLOW_SHA');
  const token = get('GH_TOKEN');
  const actor = get('GITHUB_ACTOR');
  const requestSource = get('SEC_MAINTENANCE_REQUEST_JSON');
  const runId = get('GITHUB_RUN_ID');
  const runAttempt = get('GITHUB_RUN_ATTEMPT');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)
      || get('GITHUB_ACTIONS') !== 'true' || get('GITHUB_SERVER_URL') !== 'https://github.com'
      || get('GITHUB_API_URL') !== 'https://api.github.com' || get('GITHUB_REPOSITORY') !== repository
      || get('GITHUB_EVENT_NAME') !== 'workflow_dispatch' || get('GITHUB_REF') !== 'refs/heads/main'
      || get('GITHUB_WORKFLOW_REF') !== workflowRef || typeof workflowSha !== 'string'
      || !/^[0-9a-f]{40}$/u.test(workflowSha) || get('GITHUB_SHA') !== workflowSha
      || typeof actor !== 'string' || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(actor)
      || typeof requestSource !== 'string' || Buffer.byteLength(requestSource, 'utf8') > 60 * 1024
      || typeof runId !== 'string' || !/^[1-9][0-9]*$/u.test(runId) || !Number.isSafeInteger(Number(runId))
      || typeof runAttempt !== 'string' || !/^[1-9][0-9]*$/u.test(runAttempt)
      || Number(runAttempt) !== 1 || token === undefined) return null;
  if (token.length === 0 || token !== token.trim() || Buffer.byteLength(token, 'utf8') > MAX_TOKEN_BYTES
      || !/^[^\s\u0000-\u001f\u007f-\u009f]+$/u.test(token)) {
    throw new GitHubCredentialUnavailableError('token');
  }
  let request: unknown;
  try { request = JSON.parse(requestSource); } catch { return null; }
  if (request === null || typeof request !== 'object' || Array.isArray(request)) return null;
  const value = request as Record<string, unknown>;
  if (value.schema !== 'sec-repository-maintenance-request-v2'
      || value.repository !== repository || value.expectedMainSha !== workflowSha) return null;
  const resumeSource = get('SEC_MAINTENANCE_RESUME_RECEIPT');
  let resumeReceipt: unknown = null;
  try { if (resumeSource !== undefined && resumeSource.trim() !== '') resumeReceipt = JSON.parse(resumeSource); }
  catch { return null; }
  const requestDigest = sha256(request);
  return Object.freeze({ repository, workflowRef, workflowSha, actor, requestDigest,
    executionDigest: sha256({ requestDigest, resumeReceipt }),
    resumeReceiptDigest: resumeReceipt === null ? null : sha256(resumeReceipt),
    runId, runAttempt: 1 });
}

function githubActionsCredentialToken(
  source: Readonly<NodeJS.ProcessEnv>,
  repository: string
): string | undefined {
  const maintenance = inspectGitHubActionsRepositoryMaintenanceCredentialIdentity(source, repository);
  if (maintenance === null) {
    if (environmentValue(source, 'GITHUB_ACTIONS') === 'true'
        && environmentValue(source, 'GH_TOKEN') !== undefined) {
      throw new GitHubCredentialUnavailableError('admission');
    }
    return undefined;
  }
  return environmentValue(source, 'GH_TOKEN');
}

/**
 * The credential child never inherits PATH, host, config, HOME or XDG selectors.
 * Linux stored auth receives HOME from the effective OS account instead; an
 * absent HOME makes gh resolve its config relative to the candidate directory.
 * A GitHub Actions token is forwarded only as GH_TOKEN from an exact github.com
 * Actions environment; the secret is excluded from the semantic operation digest.
 */
async function githubCredentialEnvironment(
  source: Readonly<NodeJS.ProcessEnv>,
  repository: string,
  store: ReturnType<typeof currentGitHubCredentialStore>
): Promise<GitHubCredentialProcessEnvironment> {
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
  if (actionsToken !== undefined && store !== undefined) {
    throw new GitHubCredentialUnavailableError('admission');
  }
  const credentialSource: GitHubCredentialSource = actionsToken === undefined
    ? store === undefined ? 'stored-gh-auth' : 'explicit-private-gh-config'
    : 'github-actions-token';
  if (store !== undefined) {
    child.GH_CONFIG_DIR = store.directory.childPath;
    identity.GH_CONFIG_DIR = store.directory.childPath;
  } else if (actionsToken === undefined && process.platform === 'linux') {
    const home = await resolveLinuxEffectiveUserHome();
    child.HOME = home;
    identity.HOME = home;
  }
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
      environment: input.environmentIdentity,
      credentialSource: input.credentialSource,
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
        const store = currentGitHubCredentialStore(cwd);
        const workingDirectoryChain = store?.chain ??
          inspectNoFollowDirectoryChain(cwd, 'GitHub credential working directory');
        return withAcquiredResource({
          operationLabel: 'github-credential-execution',
          resourceLabel: 'github-credential-working-directory',
          acquire: () => store?.directory ?? retainNoFollowDirectoryForChildProcess(
              workingDirectoryChain,
              RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
              'GitHub credential working directory'
            ),
          async use(workingDirectory) {
            if (remainingMs() < 1) throw new GitHubCredentialUnavailableError('deadline');
            const boundary = issueRetainedCommandBoundary({ executable, workingDirectory });
            store?.assertCurrent();
            const environment = await githubCredentialEnvironment(process.env, repository, store);
            if (remainingMs() < 1) throw new GitHubCredentialUnavailableError('deadline');
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
              workingDirectory: workingDirectoryChain.target,
              credentialStoreIdentity: store?.identityDigest ?? null
            }) as OperationDigest;
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
                  ...(input.signal === undefined ? {} : { signal: input.signal }),
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
                  env: environment.child,
                  envMode: 'replace',
                  maxStderrBytes: MAX_ERROR_BYTES,
                  maxStdoutBytes: MAX_TOKEN_BYTES
                });
                output.value = completed;
                store?.assertCurrent();
                return completed;
              },
              release(session) {
                assertGitHubCredentialReceipt(session.close(), operation);
              }
            });
          },
          release: (workingDirectory) => {
            // The bootstrap owns the explicitly selected directory lifecycle.
            if (store === undefined) workingDirectory.dispose();
          }
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

type TrustedGitHubActionsWorkflowIdentity = Readonly<{
  workflowRef: string;
  workflowSha: string;
  runId: string;
  runAttempt: number;
}>;

function inspectTrustedGitHubActionsWorkflowIdentity(
  source: Readonly<NodeJS.ProcessEnv>, repository: string, includeHostedBootstrap = false
): TrustedGitHubActionsWorkflowIdentity | null {
  const get = (key: string) => environmentValue(source, key);
  const workflowSha = get('GITHUB_WORKFLOW_SHA');
  const workflowRef = get('GITHUB_WORKFLOW_REF');
  const runId = get('GITHUB_RUN_ID');
  const runAttempt = get('GITHUB_RUN_ATTEMPT');
  const workflow = workflowRef === `${repository}/.github/workflows/compiler-pr-validation.yml@refs/heads/main`
    ? 'repository_dispatch'
    : workflowRef === `${repository}/.github/workflows/merge-gate.yml@refs/heads/main` ? 'workflow_run'
      : includeHostedBootstrap && ['trusted-bootstrap.yml', 'compiler-release-validation.yml'].some(name =>
        workflowRef === `${repository}/.github/workflows/${name}@refs/heads/main`) ? 'repository_dispatch' : null;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository) || workflow === null ||
      get('GITHUB_ACTIONS') !== 'true' || get('GITHUB_SERVER_URL') !== 'https://github.com' ||
      get('GITHUB_API_URL') !== 'https://api.github.com' || get('GITHUB_REPOSITORY') !== repository ||
      get('GITHUB_EVENT_NAME') !== workflow || get('GITHUB_REF') !== 'refs/heads/main' ||
      typeof workflowSha !== 'string' || !/^[0-9a-f]{40}$/u.test(workflowSha) ||
      get('GITHUB_SHA') !== workflowSha || typeof runId !== 'string' || !/^[1-9][0-9]*$/u.test(runId) ||
      typeof runAttempt !== 'string' || !/^[1-9][0-9]*$/u.test(runAttempt) || !Number.isSafeInteger(Number(runAttempt))) return null;
  return Object.freeze({ workflowRef: workflowRef!, workflowSha, runId, runAttempt: Number(runAttempt) });
}

/** Credential-source admission only; existing CI owners still verify live run and Effect authority. */
export function inspectGitHubActionsVerificationCredentialIdentity(
  source: Readonly<NodeJS.ProcessEnv>, repository: string
): TrustedGitHubActionsWorkflowIdentity | null {
  const identity = inspectTrustedGitHubActionsWorkflowIdentity(source, repository, true);
  if (identity === null) return null;
  const token = environmentValue(source, 'GH_TOKEN');
  if (token === undefined) return null;
  if (token.length === 0 || Buffer.byteLength(token, 'utf8') > MAX_TOKEN_BYTES ||
      !/^[\x21-\x7e]+$/u.test(token)) throw new GitHubCredentialUnavailableError('token');
  return identity;
}

/**
 * The separately provisioned auditor secret is never a generic GH_TOKEN
 * fallback. Invalid hosted context fails closed before stored auth is read.
 * This context is not a principal or capability; the API owner authenticates
 * the actual principal and live workflow run before issuing ruleset-read.
 */
export function inspectGitHubActionsRulesetAuditorCredentialIdentity(
  source: Readonly<NodeJS.ProcessEnv>, repository: string
): TrustedGitHubActionsWorkflowIdentity | null {
  const secretKeys = Object.keys(source).filter((key) =>
    key.toLowerCase() === 'sec_github_ruleset_auditor_token');
  const hosted = ['GITHUB_ACTIONS', 'GITHUB_SERVER_URL', 'GITHUB_API_URL', 'GITHUB_REPOSITORY',
    'GITHUB_EVENT_NAME', 'GITHUB_REF', 'GITHUB_SHA', 'GITHUB_WORKFLOW_REF', 'GITHUB_WORKFLOW_SHA',
    'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT'].some((key) => environmentValue(source, key) !== undefined);
  if (!hosted && secretKeys.length === 0) return null;
  const identity = inspectTrustedGitHubActionsWorkflowIdentity(source, repository);
  if (identity === null || secretKeys.length !== 1) {
    throw new GitHubCredentialUnavailableError('admission');
  }
  const token = source[secretKeys[0]!];
  if (token === undefined || token.length === 0 || Buffer.byteLength(token, 'utf8') > MAX_TOKEN_BYTES
      || !/^[\x21-\x7e]+$/u.test(token)) {
    throw new GitHubCredentialUnavailableError('token');
  }
  return identity;
}
