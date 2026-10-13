/** Operation and resource lifetime for VerificationSession's local native Git work. */
import { sha256 } from '../../../../../contracts/canonical.ts';
import { issueOperationRequirementBindingContext } from '../../../../../execution/operation/requirement-binding-context.ts';
import {
  bindSemanticOperation, compileCapabilityBinding, compileSemanticOperationPlan,
  issueSemanticOperationAttemptContext, type OperationDigest
} from '../../../../../execution/operation/semantic.ts';
import { settleResources, settleResourcesAsync } from '../../../../../execution/resource-settlement.ts';
import { canonicalGitChildEnvironment, gitEnvironmentValue } from '../../../../providers/git/environment.ts';
import { retainLocalGitRepository, type LocalGitRepository } from '../../../../providers/git/local-worktree.ts';
import {
  assertGitPhysicalProviderReceipt, closeGitPhysicalProvider, openGitPhysicalProvider,
  type GitPhysicalProviderCapability
} from '../../../../providers/git/physical-provider.ts';
import { assertProcessResourceSessionReceipt, openProcessResourceSession } from '../../../../runtime-state/physical/runtime/process-resource-session.ts';
import { resolveExecutableLocator } from '../../../../runtime-state/physical/runtime/process.ts';

const REQUIREMENT = 'verification-session.local-worktree.git';
const CONTRACT = sha256({ operation: REQUIREMENT, scope: 'exact-local-detached-candidate' }) as OperationDigest;
const PROVIDER = sha256({ provider: 'external-capabilities.git.physical-provider', operation: REQUIREMENT }) as OperationDigest;

export type SessionLocalRepository = Omit<LocalGitRepository, 'close'> & Readonly<{ release(): Promise<void> }>;

export function openSessionLocalRepository(root: string, maximumProcesses: number): SessionLocalRepository {
  if (!Number.isSafeInteger(maximumProcesses) || maximumProcesses < 1) throw new Error('Local Git process budget is invalid.');
  const duration = 60 * 60 * 1000;
  const plan = compileSemanticOperationPlan({
    operation: REQUIREMENT, intentDigest: sha256({ root, maximumProcesses }) as OperationDigest,
    decisionDigest: CONTRACT, deadlineAtUnixMs: Date.now() + duration,
    attempt: issueSemanticOperationAttemptContext({ authorityGrantDigest: CONTRACT }),
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: duration }, { resource: 'processes', maximum: maximumProcesses },
      { resource: 'input-bytes', maximum: 0 },
      { resource: 'output-bytes', maximum: maximumProcesses * (4 * 1024 * 1024 + 64 * 1024) }
    ],
    requirements: [{ id: REQUIREMENT, contractDigest: CONTRACT, effectKinds: ['process', 'provider'],
      failureKinds: ['provider.cancelled', 'provider.deadline-exhausted', 'provider.drift',
        'provider.execution-failed', 'provider.unavailable', 'provider.unverified'] }]
  });
  const operation = bindSemanticOperation(plan, [compileCapabilityBinding({
    requirementId: REQUIREMENT, contractDigest: CONTRACT, providerIdentityDigest: PROVIDER
  })]);
  const processes = openProcessResourceSession({ operation,
    requirementBindingContext: issueOperationRequirementBindingContext({ operation, requirementId: REQUIREMENT,
      resourceCeilings: operation.plan.execution.aggregateBudgets }) });
  let provider: GitPhysicalProviderCapability | undefined;
  let repository: LocalGitRepository | undefined;
  let released = false;
  const release = async (): Promise<void> => {
    if (released) return;
    released = true;
    await settleResourcesAsync({ cleanup: [
      { label: 'local-git-metadata', settle: async () => repository?.close() },
      { label: 'local-git-provider', settle: async () => {
        if (provider === undefined) return;
        const receipt = closeGitPhysicalProvider(provider);
        assertGitPhysicalProviderReceipt(receipt, provider);
      } },
      { label: 'local-git-processes', settle: async () => {
        const receipt = await processes.close();
        assertProcessResourceSessionReceipt(receipt, { operationIdentityDigest: operation.plan.identity.identityDigest,
          boundAttemptDigest: operation.boundAttemptDigest, requirementId: REQUIREMENT });
      } }
    ] });
  };
  try {
    const environment = canonicalGitChildEnvironment();
    const executablePath = resolveExecutableLocator('git', { cwd: root, pathValue: gitEnvironmentValue(environment, 'PATH') ?? '' });
    if (executablePath === null) throw new Error('Local native Git is unavailable.');
    const resolution = openGitPhysicalProvider({ cwd: root, executablePath, operation, processSession: processes,
      environment, maximumExecutableBytes: 64 * 1024 * 1024 });
    if (resolution.status !== 'ready') throw new Error(`Local retained Git is unavailable: ${resolution.reason}.`);
    provider = resolution.capability;
    repository = retainLocalGitRepository(provider);
    const { close: _closeMetadata, ...publicRepository } = repository;
    return Object.freeze({ ...publicRepository, release });
  } catch (error) {
    // Admission acquired no running child; all resource owners settle synchronously here.
    settleResources({ primary: { label: 'local-git-admission', error }, cleanup: [
      { label: 'local-git-metadata', settle: () => repository?.close() },
      { label: 'local-git-provider', settle: () => { if (provider !== undefined) closeGitPhysicalProvider(provider); } },
      { label: 'local-git-processes', settle: () => processes.close() }
    ] });
    throw error;
  }
}
