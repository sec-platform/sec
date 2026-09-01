import { sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import {
  bindSecSemanticOperation,
  compileSecCapabilityBinding,
  compileSecSemanticOperationPlan,
  issueSecSemanticOperationAttemptContext,
  type SecBoundSemanticOperation,
  type SecOperationDigest
} from '../../system-architecture/operation/semantic.ts';
import {
  assertGitReadSessionReceipt,
  createAuthorityGitReadSession,
  isProductionGitReadSession,
  resolveGitReadSessionBudget,
  type GitReadProviderResolutionFailure,
  type GitReadSession,
  type GitReadSessionFailure
} from './runtime/session.ts';

const GIT_READ_AUTHORITY_OPERATION = 'external-capabilities.git-read.observe';
const GIT_READ_AUTHORITY_REQUIREMENT = 'git-read.host-process';
const GIT_READ_AUTHORITY_CONTRACT_DIGEST = sha256({
  operation: GIT_READ_AUTHORITY_OPERATION,
  provider: 'host-local-git-v1',
  commandPolicy: 'canonical-read-only-git-command-set',
  retainedBoundary: 'cwd-and-executable-physical-identity-v1'
}) as SecOperationDigest;
const GIT_READ_AUTHORITY_PROVIDER_DIGEST = sha256({
  provider: 'external-capabilities.git-read',
  route: 'host-local-git-v1',
  retainedBoundary: 'cwd-and-executable-physical-identity-v1'
}) as SecOperationDigest;

type AuthorityGitReadSessionInput = Omit<
  Parameters<typeof createAuthorityGitReadSession>[0],
  'operation'
> & Readonly<{
  /** A broader caller-owned operation may share its already-frozen process budget. */
  operation?: SecBoundSemanticOperation;
}>;

function issueGitReadAuthorityOperation(
  input: Omit<AuthorityGitReadSessionInput, 'operation'>
): SecBoundSemanticOperation {
  const budget = resolveGitReadSessionBudget(input.budget);
  const deadlineAtUnixMs = Date.now() + budget.deadlineMs;
  const plan = compileSecSemanticOperationPlan({
    operation: GIT_READ_AUTHORITY_OPERATION,
    intentDigest: sha256({
      cwd: input.cwd,
      environment: input.environment ?? {},
      budget
    }) as SecOperationDigest,
    decisionDigest: GIT_READ_AUTHORITY_CONTRACT_DIGEST,
    deadlineAtUnixMs,
    attempt: issueSecSemanticOperationAttemptContext({
      authorityGrantDigest: GIT_READ_AUTHORITY_CONTRACT_DIGEST
    }),
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: budget.deadlineMs },
      { resource: 'input-bytes', maximum: budget.maxStdinBytes },
      {
        resource: 'output-bytes',
        maximum: budget.maxStdoutBytes + budget.maxStderrBytes
      },
      { resource: 'processes', maximum: budget.maxProcesses },
      { resource: 'records', maximum: budget.maxRecords }
    ],
    requirements: [{
      id: GIT_READ_AUTHORITY_REQUIREMENT,
      contractDigest: GIT_READ_AUTHORITY_CONTRACT_DIGEST,
      effectKinds: ['process', 'provider'],
      failureKinds: [
        'provider.cancelled',
        'provider.deadline-exhausted',
        'provider.drift',
        'provider.execution-failed',
        'provider.unavailable',
        'provider.unverified'
      ]
    }]
  });
  return bindSecSemanticOperation(plan, [compileSecCapabilityBinding({
    requirementId: GIT_READ_AUTHORITY_REQUIREMENT,
    contractDigest: GIT_READ_AUTHORITY_CONTRACT_DIGEST,
    providerIdentityDigest: GIT_READ_AUTHORITY_PROVIDER_DIGEST
  })]);
}

export class GitReadAuthorityError extends Error {
  constructor(
    message: string,
    readonly failure: GitReadProviderResolutionFailure | GitReadSessionFailure
  ) {
    super(message);
    this.name = 'GitReadAuthorityError';
  }
}

/**
 * One authority-owned session lifetime. A result cannot leave this boundary
 * until terminal provider settlement has completed and the session remains
 * failure-free.
 */
export async function withAuthorityGitReadSession<T>(
  input: AuthorityGitReadSessionInput,
  operation: (session: GitReadSession) => Promise<T>
): Promise<T> {
  const { operation: suppliedOperation, ...sessionInput } = input;
  const boundOperation = suppliedOperation ?? issueGitReadAuthorityOperation(sessionInput);
  const resolution = createAuthorityGitReadSession({
    ...sessionInput,
    operation: boundOperation
  });
  if (resolution.status !== 'ready') {
    throw new GitReadAuthorityError('Git read provider is unavailable.', resolution);
  }
  const session = resolution.session;
  let result: T | undefined;
  let primaryError: unknown;
  try {
    if (!isProductionGitReadSession(session)) {
      throw new GitReadAuthorityError(
        'Git read provider returned a session without a production issuer capability.',
        Object.freeze({
          kind: 'unresolved-git-read-session' as const,
          reason: 'operation-not-permitted' as const,
          detail: 'Only the canonical production GitRead issuer may cross this authority boundary.'
        })
      );
    }
    result = await operation(session);
  } catch (error) {
    primaryError = error;
  }
  try {
    const receipt = await session.close?.();
    const processRequirements = boundOperation.plan.execution.requirements.filter(
      ({ effectKinds }) => effectKinds.includes('process')
    );
    if (receipt === undefined || processRequirements.length !== 1) {
      throw new Error('Git read authority did not receive one terminal provider receipt.');
    }
    assertGitReadSessionReceipt(receipt, {
      operationIdentityDigest: boundOperation.plan.identity.identityDigest,
      boundAttemptDigest: boundOperation.boundAttemptDigest,
      requirementId: processRequirements[0]!.id
    });
  } catch (error) {
    primaryError ??= error;
  }
  if (primaryError !== undefined) throw primaryError;
  if (session.failure !== null) {
    throw new GitReadAuthorityError('Git read session failed terminal settlement.', session.failure);
  }
  return result as T;
}
