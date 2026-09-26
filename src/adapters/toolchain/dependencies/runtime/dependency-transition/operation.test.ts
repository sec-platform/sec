import { expect, test } from 'bun:test';

import { FailureError } from '../../../../../contracts/failure.ts';
import { runtimeDependencyOperationOptions } from '../operation-context.ts';
import { DEPENDENCY_TRANSITION_SCHEMA } from './contract.ts';
import { advanceDependencyTransition } from './operation.ts';

test('journal successor rejects a caller-constructed structural record before any filesystem effect', async () => {
  const digest = `sha256:${'0'.repeat(64)}` as const;
  const forged = Object.freeze({
    schema: DEPENDENCY_TRANSITION_SCHEMA,
    recordDigest: digest,
    previousRecordDigest: null,
    sequence: 1,
    operationKey: digest,
    attemptNonce: 'caller-constructed',
    kind: 'compiler-generation' as const,
    ownerRoot: 'Z:\\unobserved-owner',
    ownerRootPhysical: Object.freeze({ device: 'caller', inode: 'caller', objectId: 'caller' }),
    destination: Object.freeze({
      path: 'Z:\\unobserved-owner\\node_modules',
      kind: 'absent' as const,
      physical: null,
      linkTarget: null,
      bindingDigest: null
    }),
    preimage: Object.freeze({
      path: 'Z:\\unobserved-owner\\node_modules',
      kind: 'absent' as const,
      physical: null,
      linkTarget: null,
      bindingDigest: null
    }),
    stage: null,
    stageRoot: null,
    backup: null,
    sourceGeneration: Object.freeze({
      schema: 'sec-runtime-dependency-source-generation-v1' as const,
      ownerRoot: 'Z:\\unobserved-owner',
      ownerRootPhysical: Object.freeze({ device: 'caller', inode: 'caller', objectId: 'caller' }),
      sourcePath: 'Z:\\unobserved-owner\\source',
      physical: Object.freeze({ device: 'caller', inode: 'caller', objectId: 'caller' }),
      bindingDigest: digest,
      treeDigest: digest,
      treeEntryCount: 0,
      epoch: digest
    }),
    phase: 'prepared' as const,
    durability: 'known' as const,
    failure: null
  });

  await expect(advanceDependencyTransition(
    forged,
    { phase: 'complete' },
    runtimeDependencyOperationOptions({ lockTimeoutMs: 1_000 })
  )).rejects.toMatchObject({
    code: 'RUNTIME-DEPS-004',
    message: 'Dependency transition write requires an owner-admitted immutable record'
  } satisfies Partial<FailureError>);
});
