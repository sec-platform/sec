import path from 'node:path';

import { assertIsolatedStagingTree } from '../compiler/verify/assert-isolated-staging-tree.ts';
import { isSemanticMutationStagingWorkspace } from '../compiler/verify/semantic-mutation-staging-boundary.ts';
import { listFilesRecursive, pathExists } from '../shared/fs.ts';
import { ISOLATED_VERIFICATION_ENV_KEY } from '../shared/process.ts';
import { readProjectBaseline } from '../shared/project-baseline.ts';
import { mintIsolatedVerificationCapability } from './isolated-verification-capability.ts';
import { compileWorkspace } from './pipeline-orchestrator.ts';

const EXPECTED_STAGES = ['resolve', 'semantic', 'compose', 'adapt', 'verify'] as const;

function sameStages(actual: readonly string[]): boolean {
  return actual.length === EXPECTED_STAGES.length &&
    actual.every((stage, index) => stage === EXPECTED_STAGES[index]);
}

async function main(): Promise<void> {
  const stagingWorkspaceRoot = path.resolve(process.cwd());
  if (process.env[ISOLATED_VERIFICATION_ENV_KEY] !== '1' ||
    !isSemanticMutationStagingWorkspace(stagingWorkspaceRoot)) {
    throw new Error('Semantic Mutation isolated runner boundary is invalid');
  }

  let boundaryEstablished = false;
  try {
    await assertIsolatedStagingTree(stagingWorkspaceRoot);
    boundaryEstablished = true;
    if (await pathExists(path.join(stagingWorkspaceRoot, 'source', 'schema', 'db.prisma.template'))) {
      throw new Error('Semantic Mutation isolated runner cannot execute Prisma without a staged toolchain');
    }
    const opaqueModulesRoot = path.join(stagingWorkspaceRoot, 'source', 'code', 'opaque');
    if ((await pathExists(opaqueModulesRoot)) &&
      (await listFilesRecursive(opaqueModulesRoot)).some((file) => path.basename(file) === 'module.yaml')) {
      throw new Error('Semantic Mutation isolated runner cannot install linked opaque modules');
    }
    const isolatedVerificationCapability = mintIsolatedVerificationCapability(stagingWorkspaceRoot);
    const compiled = await compileWorkspace(stagingWorkspaceRoot, {
      source: 'api',
      from: 'resolve',
      through: 'verify',
      isolatedVerificationCapability,
      verificationLane: 'all'
    });
    const baseline = await readProjectBaseline(stagingWorkspaceRoot);
    if (!baseline || !sameStages(compiled.completedStages) ||
      !compiled.semanticContext ||
      compiled.verificationReport?.summary.status !== 'passed' ||
      compiled.verificationReport.summary.requestedLane !== 'all') {
      throw new Error('Semantic Mutation isolated runner did not complete verify-all');
    }
  } finally {
    if (boundaryEstablished) await assertIsolatedStagingTree(stagingWorkspaceRoot);
  }
}

try {
  await main();
} catch {
  console.error('Semantic Mutation isolated verification failed');
  process.exitCode = 1;
}
