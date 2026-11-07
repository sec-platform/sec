import path from 'node:path';

import { CodedFailure } from '../../../../contracts/failure.ts';
import { CodexDevelopmentIsCanonicalRepositoryPath } from '../../../../contracts/repository-path.ts';
import { settleResources, type ResourceSettlementFailure } from '../../../../execution/resource-settlement.ts';
import {
  assertSameNoFollowDirectoryIdentity,
  createNoFollowOrdinaryDirectoryChain,
  inspectNoFollowDirectoryChain,
  physicallyContainsDirectoryChain,
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  createRepositoryDerivedOutput,
  retireRepositoryDerivedOutput,
  type RepositoryDerivedOutput
} from '../../../runtime-state/physical/runtime/repository-derived-output.ts';

/** Own exactly one exclusive child for an oracle, then retire that identity.
 * Parent paths select a proven location, never ownership of an existing tree. */
export async function withNativeTestWorkspace<T>(
  workspaceRoot: string,
  execute: (work: string, derivedOutput: RepositoryDerivedOutput) => Promise<T>,
  parentRelative = '.tmp',
  lifecycle: Readonly<{ parentOwnsCleanup?: boolean; retirementAllowed?: () => boolean }> = {}
): Promise<T> {
  if (!CodexDevelopmentIsCanonicalRepositoryPath(parentRelative)
      || parentRelative !== '.tmp' && !parentRelative.startsWith('.tmp/')) {
    throw new Error('Native test workspace parent must be a canonical path under workspace .tmp');
  }
  if (lifecycle.parentOwnsCleanup && parentRelative === '.tmp') {
    throw new Error('Borrowed native work requires a specific parent-owned directory');
  }
  const workspace = inspectNoFollowDirectoryChain(path.resolve(workspaceRoot), 'Native test workspace');
  const temporary = createNoFollowOrdinaryDirectoryChain(workspace.target, ['.tmp']);
  const temporaryChain = assertSameNoFollowDirectoryIdentity(temporary, 'Native test temporary parent');
  const parent = inspectNoFollowDirectoryChain(path.join(workspace.target.path, ...parentRelative.split('/')),
    'Native test selected parent');
  if (!physicallyContainsDirectoryChain(workspace, parent) || !physicallyContainsDirectoryChain(temporaryChain, parent)) {
    throw new Error('Native test workspace parent is outside the proven workspace temporary tree');
  }
  const derivedOutput = createRepositoryDerivedOutput(parent);
  const work = derivedOutput.root;
  let primary: ResourceSettlementFailure | undefined;
  try {
    return await execute(work.path, derivedOutput);
  } catch (error) {
    primary = { label: 'native test oracle', error };
    throw error;
  } finally {
    settleResources({
      ...(primary === undefined ? {} : { primary }),
      cleanup: [{ label: 'native test workspace retirement', settle: () => {
        // The contained parent retires this child only after its execution tree
        // has settled. A child cannot prove that its own descendants are closed.
        if (lifecycle.parentOwnsCleanup) return;
        if (lifecycle.retirementAllowed?.() === false) {
          throw new CodedFailure('NATIVE-TEST-WORKSPACE-PENDING',
            'Native workspace retained until execution-tree termination is proven',
            { pendingRecovery: { root: work, parent: parent.target } });
        }
        retireRepositoryDerivedOutput(derivedOutput);
      } }]
    });
  }
}
