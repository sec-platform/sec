import path from 'node:path';

import { withAcquiredResource } from '../../../../execution/resource-settlement.ts';

import { sha256 } from '../../../../contracts/canonical.ts';
import { issueOperationRequirementBindingContext } from '../../../../execution/operation/requirement-binding-context.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileSemanticOperationPlan,
  issueSemanticOperationAttemptContext,
  type OperationDigest
} from '../../../../execution/operation/semantic.ts';
import { withAuthorityGitReadSession } from '../../../providers/git-read/authority.ts';
import type { GitReadSession, GitReadSessionCommand } from '../../../providers/git-read/runtime/session.ts';
import {
  assertGitConfigEffectReceipt,
  closeGitConfigTargetCapability,
  issueGitConfigTargetCapability,
  replaceAllGitConfigValue
} from '../../../providers/git/config-effect.ts';
import {
  assertGitPhysicalProviderReceipt,
  closeGitPhysicalProvider,
  openGitPhysicalProvider
} from '../../../providers/git/physical-provider.ts';
import {
  assertProcessResourceSessionReceipt,
  openProcessResourceSession
} from '../../../runtime-state/physical/runtime/process-resource-session.ts';
import {
  assertGitBranchName,
  type BranchPruneConfigurationObservation
} from './branch-lifecycle-contract.ts';

const BRANCH_CONFIG_DURATION_MS = 120_000;
const BRANCH_CONFIG_PROCESS_REQUIREMENT = 'branch-lifecycle.clone-config.process';
const BRANCH_CONFIG_PROCESS_CONTRACT = sha256({
  owner: 'control.branch-lifecycle',
  operation: 'configureBranchLifecycleClone',
  processBoundary: 'one-parent-process-resource-session'
}) as OperationDigest;
const BRANCH_CONFIG_PROCESS_PROVIDER = sha256({
  owner: 'runtime-state.physical',
  provider: 'process-resource-session'
}) as OperationDigest;
const BRANCH_CONFIG_PROCESS_COUNT = 8;
const BRANCH_CONFIG_INPUT_BYTES = 1;
const BRANCH_CONFIG_OUTPUT_BYTES = 2 * 1024 * 1024;
const BRANCH_CONFIG_GIT_READ_BUDGET = Object.freeze({
  deadlineMs: BRANCH_CONFIG_DURATION_MS,
  maxProcesses: 2,
  maxTotalArgumentBytes: 64 * 1024,
  maxStdinBytes: 1,
  maxStdoutBytes: 128 * 1024,
  maxStderrBytes: 128 * 1024,
  maxRecords: 16,
  maxRootObservedBytes: 128 * 1024 * 1024,
  maxReopenRefreshes: 8,
  maxSettlementAttempts: 4,
  maxCommandStdoutBytes: 64 * 1024,
  maxCommandStderrBytes: 64 * 1024,
  maxExecutableBytes: 64 * 1024 * 1024
});

function commandText(command: GitReadSessionCommand, label: string): string {
  if (command.kind !== 'completed' || command.result.code !== 0) {
    throw new Error(`Branch lifecycle ${label} observation is unresolved.`);
  }
  const value = new TextDecoder('utf-8', { fatal: true }).decode(command.result.stdout).trim();
  if (value.length === 0) throw new Error(`Branch lifecycle ${label} observation is empty.`);
  return value;
}

function compileBranchConfigOperation(input: Readonly<{
  repositoryRoot: string;
  remote: string;
  deadlineAtUnixMs: number;
}>) {
  const plan = compileSemanticOperationPlan({
    operation: 'control.branch-lifecycle.configure-clone',
    intentDigest: sha256({ repositoryRoot: input.repositoryRoot, remote: input.remote }) as OperationDigest,
    decisionDigest: BRANCH_CONFIG_PROCESS_CONTRACT,
    deadlineAtUnixMs: input.deadlineAtUnixMs,
    attempt: issueSemanticOperationAttemptContext({
      authorityGrantDigest: BRANCH_CONFIG_PROCESS_CONTRACT
    }),
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: BRANCH_CONFIG_DURATION_MS },
      { resource: 'input-bytes', maximum: BRANCH_CONFIG_INPUT_BYTES },
      { resource: 'output-bytes', maximum: BRANCH_CONFIG_OUTPUT_BYTES },
      { resource: 'processes', maximum: BRANCH_CONFIG_PROCESS_COUNT }
    ],
    requirements: [{
      id: BRANCH_CONFIG_PROCESS_REQUIREMENT,
      contractDigest: BRANCH_CONFIG_PROCESS_CONTRACT,
      effectKinds: ['filesystem', 'process', 'provider'],
      failureKinds: [
        'filesystem.identity-drift',
        'filesystem.write-failed',
        'process.cancelled',
        'process.deadline-exhausted',
        'process.output-budget-exhausted',
        'process.settlement-unproven',
        'process.unavailable'
      ]
    }]
  });
  return bindSemanticOperation(plan, [compileCapabilityBinding({
    requirementId: BRANCH_CONFIG_PROCESS_REQUIREMENT,
    contractDigest: BRANCH_CONFIG_PROCESS_CONTRACT,
    providerIdentityDigest: BRANCH_CONFIG_PROCESS_PROVIDER
  })]);
}

async function configureWithSession(
  session: GitReadSession,
  repositoryRoot: string,
  remote: string,
  operation: ReturnType<typeof compileBranchConfigOperation>,
  processSession: ReturnType<typeof openProcessResourceSession>
): Promise<BranchPruneConfigurationObservation> {
  const observedRoot = path.resolve(commandText(
    await session.run(['rev-parse', '--show-toplevel']),
    'repository root'
  ));
  if (observedRoot !== repositoryRoot) {
    throw new Error('repositoryRoot must be the exact repository worktree root.');
  }
  const configLocator = commandText(
    await session.run(['rev-parse', '--git-path', 'config']),
    'local config path'
  );
  const configPath = path.resolve(repositoryRoot, configLocator);
  const executablePath = session.gitExecutableIdentity?.realPath;
  if (executablePath === undefined) {
    throw new Error('Branch lifecycle Git provider did not retain one executable identity.');
  }
  return withAcquiredResource({
    operationLabel: 'branch-lifecycle-config',
    resourceLabel: 'git-physical-provider',
    acquire() {
      const resolution = openGitPhysicalProvider({
        cwd: repositoryRoot,
        executablePath,
        operation,
        processSession,
        environmentSource: process.env,
        maximumExecutableBytes: BRANCH_CONFIG_GIT_READ_BUDGET.maxExecutableBytes
      });
      if (resolution.status !== 'ready') {
        throw new Error(`Branch lifecycle Git config provider is unavailable: ${resolution.reason}`);
      }
      return resolution.capability;
    },
    async use(provider) {
      for (const key of ['fetch.prune', `remote.${remote}.prune`, 'fetch.pruneTags'] as const) {
        await withAcquiredResource({
          operationLabel: 'branch-lifecycle-config-write',
          resourceLabel: 'git-config-target',
          acquire: () => issueGitConfigTargetCapability({ path: configPath }),
          async use(target) {
            assertGitConfigEffectReceipt(await replaceAllGitConfigValue({
              provider, target, key, value: 'true'
            }));
          },
          release: closeGitConfigTargetCapability
        });
      }
      return Object.freeze({
        observation: 'resolved' as const,
        fetchPrune: true,
        remotePrune: true,
        fetchPruneTags: true,
        reason: null
      });
    },
    release(provider) {
      assertGitPhysicalProviderReceipt(closeGitPhysicalProvider(provider), provider);
    }
  });
}

export async function configureBranchLifecycleClone(
  input: Readonly<{ repositoryRoot: string; remote?: string }>
): Promise<BranchPruneConfigurationObservation> {
  const { repositoryRoot: suppliedRoot, remote: suppliedRemote } = input;
  const repositoryRoot = path.resolve(suppliedRoot);
  if (!path.isAbsolute(suppliedRoot) || repositoryRoot !== suppliedRoot) {
    throw new Error('repositoryRoot must be canonical and absolute.');
  }
  const remote = suppliedRemote ?? 'origin';
  assertGitBranchName(remote, 'remote name');
  const deadlineAtUnixMs = Date.now() + BRANCH_CONFIG_DURATION_MS;
  const operation = compileBranchConfigOperation({ repositoryRoot, remote, deadlineAtUnixMs });
  return withAcquiredResource({
    operationLabel: 'branch-lifecycle-config-session',
    resourceLabel: 'process-resource-session',
    acquire: () => openProcessResourceSession({
      operation,
      requirementBindingContext: issueOperationRequirementBindingContext({
        operation,
        requirementId: BRANCH_CONFIG_PROCESS_REQUIREMENT,
        resourceCeilings: operation.plan.execution.aggregateBudgets
      })
    }),
    use: (processSession) => withAuthorityGitReadSession({
      cwd: repositoryRoot,
      operation,
      processSession,
      budget: BRANCH_CONFIG_GIT_READ_BUDGET,
      deadlineAtUnixMs
    }, (session) => configureWithSession(session, repositoryRoot, remote, operation, processSession)),
    release(processSession) {
      assertProcessResourceSessionReceipt(processSession.close(), {
        operationIdentityDigest: operation.plan.identity.identityDigest,
        boundAttemptDigest: operation.boundAttemptDigest,
        requirementId: BRANCH_CONFIG_PROCESS_REQUIREMENT
      });
    }
  });
}
