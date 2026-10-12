import { readFileSync } from 'node:fs';

import { createRepositoryCompilationCacheProvider } from '../../src/adapters/repository/source-program-model/repository-compilation-cache-provider.ts';
import { inspectNoFollowDirectoryChain } from '../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import { openContentAddressedWorkspaceCacheSession } from '../../src/adapters/runtime-state/workspace-state/content-addressed-workspace-cache.ts';
import { sha256 } from '../../src/contracts/canonical.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileSemanticOperationPlan,
  issueSemanticOperationAttemptContext,
  type OperationDigest
} from '../../src/execution/operation/semantic.ts';

const marker = 'SEC_GENERATION_RESULT=';
const payloadPath = process.env.SEC_GENERATION_PAYLOAD;
const mode = process.env.SEC_GENERATION_MODE;
if (payloadPath === undefined || mode !== 'load' && mode !== 'publish') {
  throw new Error('Repository compilation cache test worker input is invalid');
}
const payload = JSON.parse(readFileSync(payloadPath, 'utf8')) as Readonly<{
  repositoryRoot: string;
  generation: import('../../src/adapters/repository/source-program-model/repository-compilation-cache.ts').RepositoryCompilationGenerationReceipt;
  shards: readonly import('../../src/adapters/repository/source-program-model/typescript-fact-shards.ts').TypeScriptSourceProgramFactShard[];
}>;
const requirementId = 'brownfield.repository-compilation-cache.test-worker';
const contractDigest = sha256({ requirementId }) as OperationDigest;
const operation = bindSemanticOperation(compileSemanticOperationPlan({
  operation: 'brownfield.repository-compilation-cache.test-worker',
  intentDigest: sha256({ repositoryRoot: payload.repositoryRoot, mode }) as OperationDigest,
  decisionDigest: contractDigest,
  deadlineAtUnixMs: Date.now() + 30_000,
  attempt: issueSemanticOperationAttemptContext({ authorityGrantDigest: contractDigest }),
  aggregateBudgets: [
    { resource: 'duration-ms', maximum: 30_000 },
    { resource: 'input-bytes', maximum: 1024 * 1024 * 1024 },
    { resource: 'output-bytes', maximum: 1024 * 1024 * 1024 },
    { resource: 'records', maximum: 1024 }
  ],
  requirements: [{
    id: requirementId,
    contractDigest,
    effectKinds: ['filesystem'],
    failureKinds: ['cache.cancelled', 'cache.deadline-exhausted', 'cache.physical-replacement']
  }]
}), [compileCapabilityBinding({
  requirementId,
  contractDigest,
  providerIdentityDigest: sha256('repository-compilation-cache-test-worker-provider') as OperationDigest
})]);
const session = openContentAddressedWorkspaceCacheSession({
  operation,
  requirementId,
  repository: inspectNoFollowDirectoryChain(payload.repositoryRoot, 'cache test worker repository').target
});
try {
  const hint = createRepositoryCompilationCacheProvider({ session })
    .openContentAddressedHint(Object.freeze(payload.generation));
  const result = mode === 'publish' ? hint.publish(payload.shards) : hint.loadExact();
  console.log(marker + JSON.stringify({ pid: process.pid, result }));
} finally {
  session.close();
}
